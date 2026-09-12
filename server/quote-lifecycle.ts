import { enqueueFollowup } from "./outbox";
import { reserveStock } from "./inventory-core";
import { normalizeStockUnit, fractionalUnit, stockRound } from "../shared/inventory";
import { eq,or } from "drizzle-orm";
import { db, sqlite, storage } from "./storage";
import { quotes, QUOTE_TYPE_LABELS } from "../shared/quote-schema";
import { projects } from "../shared/schema";
import { leads, crmActivities } from "../shared/crm-schema";
import { invoices } from "../shared/finance-schema";
import { pmTasks } from "../shared/pm-schema";
import { findOrCreateClientByContact } from "./crm";
import { insertNumbered } from "./numbering";
function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
import { todayLocal } from "./http-util";
import {
  buildLineState,
  materialTotals,
} from "../client/src/quote/lib/estimate.js";
import { deepMerge } from "../client/src/quote/lib/store.js";
import { DEFAULT_PRICE_BOOK } from "../client/src/quote/data/priceBook.js";
import { sendOwnerMail, sendMail, mailEnabled } from "./mailer";
import { renderTemplate, firstNameOf } from "./email-templates";

// All required records commit together. Retries reuse explicit foreign links;
// customer contact information never determines which job is being accepted.
export function acceptQuote(
  id: number,
  note = "",
  ip: string | null = null,
  source = "Customer",
) {
  const result = sqlite.transaction(() => {
    const quote = db.select().from(quotes).where(eq(quotes.id, id)).get();
    if (!quote || quote.deletedAt != null) throw new Error("Quote not found");
    const optionSet=sqlite.prepare('SELECT s.* FROM quote_option_sets s JOIN quote_option_members m ON m.set_id=s.id WHERE m.quote_id=?').get(id) as any;
    if(optionSet?.accepted_quote_id&&optionSet.accepted_quote_id!==id)throw new Error('Another option has already been accepted for this job.');
    if (quote.status === "declined")
      throw new Error("This quote was declined. Request a new revision.");
    const alreadyAccepted = quote.status === "accepted";
    const session = parseJson<any>(quote.payload, {});
    const design = quote.designRef
      ? (sqlite
          .prepare("SELECT * FROM web_designs WHERE upper(ref) = upper(?)")
          .get(quote.designRef) as any)
      : null;
    const customer = {
      name: quote.customerName,
      email: session.customer?.email || design?.email,
      phone: session.customer?.phone || design?.phone,
    };
    let leadId = quote.leadId ?? design?.lead_id ?? null;
    let lead =
      leadId == null
        ? undefined
        : db.select().from(leads).where(eq(leads.id, leadId)).get();
    if (lead?.deletedAt != null)
      throw new Error("Restore the linked lead before accepting this quote.");
    const selectedClientId = session.customer?.clientId;
    if (selectedClientId != null && (!Number.isInteger(selectedClientId) || !sqlite.prepare('SELECT 1 FROM crm_clients WHERE id=? AND deleted_at IS NULL').get(selectedClientId))) throw new Error('Restore or choose the linked customer before accepting.');
    if (lead?.clientId != null && selectedClientId != null && lead.clientId !== selectedClientId) throw new Error('The selected customer differs from the linked lead. Review the customer link first.');
    const clientId =
      lead?.clientId ?? selectedClientId ??
      findOrCreateClientByContact({
        ...customer,
        designRef: quote.designRef,
        preferredLanguage:
          lead?.preferredLanguage ??
          design?.lang ??
          session.customer?.preferredLanguage,
      });
    if (!lead) {
      lead = db
        .insert(leads)
        .values({
          name: customer.name || customer.email || "Customer",
          email: customer.email || null,
          phone: customer.phone || null,
          clientId,
          preferredLanguage:
            design?.lang ?? session.customer?.preferredLanguage ?? "en",
          source: quote.designRef ? "website" : "other",
          site:
            quote.type === "concrete"
              ? "concrete"
              : quote.type === "insulation"
                ? "insulation"
                : "metals",
          serviceRequested: QUOTE_TYPE_LABELS[quote.type],
          notes: `From quote ${quote.number}`,
        })
        .returning()
        .get();
      leadId = lead.id;
    }
    if (!alreadyAccepted) {
      const other = sqlite
        .prepare(
          "SELECT number FROM quotes WHERE lead_id=? AND status='accepted' AND id!=? AND deleted_at IS NULL",
        )
        .get(leadId, id) as any;
      if (other)
        throw new Error(
          `This job already accepted quote ${other.number}. Use a project change order or a separate lead for a new job.`,
        );
    }
    const now = Date.now();
    if(optionSet){
      sqlite.prepare('UPDATE quote_option_sets SET accepted_quote_id=? WHERE id=?').run(id,optionSet.id);
      sqlite.prepare("UPDATE quotes SET status='declined',declined_at=?,decline_reason='scope_changed',decline_note=? WHERE id IN (SELECT quote_id FROM quote_option_members WHERE set_id=? AND quote_id!=?) AND status='sent'")
        .run(now,`Customer selected alternative ${quote.number}`,optionSet.id,id);
    }
    db.update(quotes)
      .set({
        leadId,
        status: "accepted",
        acceptedAt: quote.acceptedAt ?? now,
        acceptNote: quote.acceptNote ?? (note.trim().slice(0, 1000) || null),
        acceptIp: quote.acceptIp ?? ip,
      })
      .where(eq(quotes.id, id))
      .run();
    // A lead represents one job. A revision replaces its amount; it does not
    // add the same job's revenue again.
    db.update(leads)
      .set({
        stage: "won",
        clientId,
        revenueClosedCents: alreadyAccepted
          ? lead.revenueClosedCents
          : quote.totalCents,
        winLossReason: lead.winLossReason ?? "good_fit",
        lastContactAt: now,
        stale: false,
      })
      .where(eq(leads.id, leadId))
      .run();
    let project = db
      .select()
      .from(projects)
      .where(or(eq(projects.quoteId,id),eq(projects.jobNumber, quote.number)))
      .get();
    if (!project)
      project = db
        .insert(projects)
        .values({
          jobNumber: quote.number,
          name: `${QUOTE_TYPE_LABELS[quote.type]}${quote.customerName ? ` — ${quote.customerName}` : ""}`,
          customer: quote.customerName,
          clientId,
          notes: `From quote ${quote.number}`,
        })
        .returning()
        .get();
    else if (project.deletedAt != null)
      db.update(projects)
        .set({ deletedAt: null })
        .where(eq(projects.id, project.id))
        .run();
    if(project.quoteId&&project.quoteId!==id)throw new Error('This job is already linked to a different accepted quote. Review its source records.');
    const projectId = project.id;
    sqlite.prepare(`UPDATE projects SET quote_id=?,lead_id=?,site=?,site_address=coalesce(site_address,?),preferred_language=?,billing_mode=CASE WHEN billing_mode='review' THEN 'fixed' ELSE billing_mode END WHERE id=?`)
      .run(id,leadId,lead.site,session.customer?.location || null,lead.preferredLanguage || 'en',projectId);
    const depositPct = Math.min(
      100,
      Math.max(0, Number(session.depositPct) || 0),
    );
    const depositCents = depositPct
      ? Math.round((quote.totalCents * depositPct) / 100)
      : null;
    sqlite.prepare("INSERT OR IGNORE INTO suite_job_rules(project_id,deposit_required) VALUES(?,?)").run(projectId,depositCents?1:0);
    let invoice = db
      .select()
      .from(invoices)
      .where(eq(invoices.quoteId, id))
      .get();
    if (!invoice) {
      // Recognize only the exact legacy hook prefix, never arbitrary notes
      // containing a quote number. This permits safe, repeatable legacy repair.
      invoice = sqlite
        .prepare(
          "SELECT id FROM fin_invoices WHERE notes LIKE ? AND quote_id IS NULL LIMIT 1",
        )
        .get(`From quote ${quote.number} — %`) as any;
      if (invoice) {
        db.update(invoices)
          .set({ quoteId: id, leadId, projectId })
          .where(eq(invoices.id, invoice.id))
          .run();
        invoice = db
          .select()
          .from(invoices)
          .where(eq(invoices.id, invoice.id))
          .get();
      }
    }
    if (!invoice) {
      const taxRateBp = Math.max(
        0,
        Math.round((Number(session.taxPct) || 0) * 100),
      );
      const subtotalCents = Math.round(
        quote.totalCents / (1 + taxRateBp / 10000),
      );
      invoice = insertNumbered("fin_invoices", "INV", (number) =>
        db
          .insert(invoices)
          .values({
            number,
            quoteId: id,
            leadId,
            projectId,
            clientId,
            clientName: quote.customerName,
            status: "draft",
            subtotalCents,
            taxRateBp,
            taxCents: quote.totalCents - subtotalCents,
            totalCents: quote.totalCents,
            depositCents,
            items: JSON.stringify([
              {
                description: `Quote ${quote.number} — ${QUOTE_TYPE_LABELS[quote.type]}`,
                qty: 1,
                unitPriceCents: subtotalCents,
              },
            ]),
            notes: `From quote ${quote.number} — accepted by ${source}`,
          })
          .returning()
          .get(),
      );
    }
    if (
      session.state &&
      !sqlite
        .prepare("SELECT 1 FROM project_checklist WHERE project_id = ? LIMIT 1")
        .get(projectId)
    ) {
      const settings = sqlite
        .prepare("SELECT price_book FROM quote_settings WHERE id = 1")
        .get() as any;
      const book: any = deepMerge(
        DEFAULT_PRICE_BOOK,
        session.priceBookSnapshot ?? parseJson(settings?.price_book, {}),
      );
      const line: any = buildLineState(
        quote.type,
        session.state,
        book,
        session.overrides,
      );
      const materials: any[] = materialTotals(line.items, book);
      for (const [index, material] of materials.entries()) {
        const rawQty = (
          (Number(material.qty) || 0) *
            (1 +
              Math.max(
                0,
                Number(book.materials?.[material.id]?.wastePct) || 0,
              ) /
                100)
        );
        const qty = fractionalUnit(normalizeStockUnit(material.unit)) ? stockRound(rawQty) : Math.ceil(rawQty);
        if (qty <= 0) continue;
        const item = sqlite
          .prepare(
            "SELECT id,unit FROM items WHERE material_key = ? AND deleted_at IS NULL LIMIT 2",
          )
          .all(material.id) as any[];
        const linked = item.length === 1 && normalizeStockUnit(material.unit) === item[0].unit ? item[0] : null;
        const checklist = sqlite
          .prepare(
            `INSERT INTO project_checklist (project_id, label, qty, unit, category, item_id, status, notes, order_index)
          VALUES (?, ?, ?, ?, 'raw_materials', ?, 'pending', ?, ?)`,
          )
          .run(
            projectId,
            material.name,
            String(qty),
            material.unit || null,
            linked?.id ?? null,
            `auto:quote-seed:${quote.number}`,
            index,
          );
        if (linked) reserveStock(sqlite, linked.id, projectId, qty, Number(checklist.lastInsertRowid), true);
      }
    }
    const title = `Schedule the job — quote ${quote.number} accepted${quote.customerName ? ` by ${quote.customerName}` : ""}`;
    if (!db.select().from(pmTasks).where(eq(pmTasks.title, title)).get()) {
      db.insert(pmTasks)
        .values({
          title,
          projectId,
          leadId,
          kind: "other",
          autoCreated: true,
          dueDate: todayLocal(),
          description:
            `Review draft invoice ${invoice!.number} and schedule job ${quote.number}.` +
            (depositCents
              ? ` Deposit: $${(depositCents / 100).toFixed(2)}.`
              : ""),
        })
        .run();
    }
    if (!alreadyAccepted) {
      db.insert(crmActivities)
        .values({
          entityType: "lead",
          entityId: leadId,
          kind: "note",
          notes: `Accepted quote ${quote.number} — ${source}`,
        })
        .run();
      storage.appendAudit({
        userName: source,
        action: "quote.accepted",
        targetType: "quote",
        targetId: id,
        targetName: quote.number,
        ip,
        details: {
          leadId,
          projectId,
          invoiceId: invoice!.id,
          totalCents: quote.totalCents,
        },
      });
    }
    if (!alreadyAccepted) {
      enqueueFollowup(`accept-owner:${id}`,'quote-accepted-owner',{quoteId:id});
      enqueueFollowup(`accept-customer:${id}`,'quote-accepted-customer',{quoteId:id});
    }
    return {
      quote,
      customer,
      alreadyAccepted,
      leadId,
      projectId,
      invoiceId: invoice!.id,
    };
  })();
  return {
    ok: true,
    status: "accepted",
    alreadyAccepted: result.alreadyAccepted,
    leadId: result.leadId,
    projectId: result.projectId,
    invoiceId: result.invoiceId,
  };
}
