import { eq } from "drizzle-orm";
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
    const clientId =
      lead?.clientId ??
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
      .where(eq(projects.jobNumber, quote.number))
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
    const projectId = project.id;
    const depositPct = Math.min(
      100,
      Math.max(0, Number(session.depositPct) || 0),
    );
    const depositCents = depositPct
      ? Math.round((quote.totalCents * depositPct) / 100)
      : null;
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
        const qty = Math.ceil(
          (Number(material.qty) || 0) *
            (1 +
              Math.max(
                0,
                Number(book.materials?.[material.id]?.wastePct) || 0,
              ) /
                100),
        );
        if (qty <= 0) continue;
        const item = sqlite
          .prepare(
            "SELECT id FROM items WHERE material_key = ? AND deleted_at IS NULL",
          )
          .get(material.id) as any;
        sqlite
          .prepare(
            `INSERT INTO project_checklist (project_id, label, qty, unit, category, item_id, status, notes, order_index)
          VALUES (?, ?, ?, ?, 'raw_materials', ?, 'pending', ?, ?)`,
          )
          .run(
            projectId,
            material.name,
            String(qty),
            material.unit || null,
            item?.id ?? null,
            `auto:quote-seed:${quote.number}`,
            index,
          );
        if (item)
          sqlite
            .prepare(
              "UPDATE items SET quantity_reserved = quantity_reserved + ? WHERE id = ?",
            )
            .run(qty, item.id);
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
    return {
      quote,
      customer,
      alreadyAccepted,
      leadId,
      projectId,
      invoiceId: invoice!.id,
    };
  })();
  if (!result.alreadyAccepted && mailEnabled()) {
    setImmediate(async () => {
      try {
        await sendOwnerMail({
          subject: `[CJM Trades] Quote accepted — ${result.quote.number}`,
          text: `${result.customer.name || "Customer"} accepted ${result.quote.number}. The linked project and draft invoice are ready for review.`,
        });
        if (result.customer.email) {
          const message = renderTemplate("quote.accepted", {
            customerName: result.customer.name || "there",
            firstName: firstNameOf(result.customer.name),
            quoteNumber: result.quote.number,
          });
          if (message)
            await sendMail({ to: result.customer.email, ...message });
        }
      } catch (error) {
        console.error("[quote] acceptance notification failed", error);
      }
    });
  }
  return {
    ok: true,
    status: "accepted",
    alreadyAccepted: result.alreadyAccepted,
    leadId: result.leadId,
    projectId: result.projectId,
    invoiceId: result.invoiceId,
  };
}
