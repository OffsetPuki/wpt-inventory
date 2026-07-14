import type { Express, Request } from "express";
import { and, isNull, or, sql } from "drizzle-orm";
import { db } from "./storage";
import { requireAuth } from "./auth";
import { items, projects } from "../shared/schema";
import { clients, leads, deals, products, estimates } from "../shared/crm-schema";
import { pmTasks, kbArticles } from "../shared/pm-schema";
import { invoices, purchaseOrders } from "../shared/finance-schema";
import { employees, candidates } from "../shared/hr-schema";
import { campaigns } from "../shared/marketing-schema";

// ─── Global search (top bar) ─────────────────────────────────────────────────
// One LIKE sweep per source, 5 hits each, ~20 total. Sources the caller's role
// can't open in the UI are skipped server-side so a worker never sees invoice
// numbers or employee names in the dropdown.

export interface SearchHit {
  type: string; // section label shown in the dropdown
  label: string;
  sublabel?: string | null;
  href: string; // hash route the client navigates to
}

const PER_SOURCE = 5;
const TOTAL_CAP = 20;

// Escape LIKE metacharacters (\, %, _) in a user term so they match literally
// instead of acting as wildcards. Backslash is escaped first.
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// LIKE condition that treats the (already-escaped) pattern's metacharacters as
// literals via `ESCAPE '\'`. Drop-in for drizzle's `like`, which has no
// ESCAPE support. `col` may be a column or a raw sql expression.
const likeEsc = (col: any, pattern: string) => sql`${col} LIKE ${pattern} ESCAPE '\\'`;

function elevated(req: Request): boolean {
  const role = req.user?.role;
  return role === "manager" || role === "technician";
}

export function registerSearchRoutes(app: Express): void {
  app.get("/api/search", requireAuth, (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (q.length < 2) return res.json({ results: [] });
    const p = `%${escapeLike(q)}%`;
    const hits: SearchHit[] = [];
    const isElev = elevated(req);

    // Each source is independent — a failure in one (e.g. a table missing on
    // a partial install) must not blank the whole dropdown.
    const source = (fn: () => void) => {
      try {
        fn();
      } catch {
        /* skip source */
      }
    };

    source(() => {
      for (const r of db.select({ id: items.id, name: items.name, partNumber: items.partNumber })
        .from(items)
        .where(and(isNull(items.deletedAt), or(likeEsc(items.name, p), likeEsc(items.partNumber, p))))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Items", label: r.name, sublabel: r.partNumber, href: `/item/${r.id}` });
      }
    });

    source(() => {
      for (const r of db.select({ id: projects.id, name: projects.name, jobNumber: projects.jobNumber, customer: projects.customer })
        .from(projects)
        .where(and(isNull(projects.deletedAt), or(likeEsc(projects.name, p), likeEsc(projects.jobNumber, p), likeEsc(projects.customer, p))))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Projects", label: r.name, sublabel: r.jobNumber, href: `/project/${r.id}` });
      }
    });

    source(() => {
      for (const r of db.select({ id: clients.id, name: clients.name, company: clients.company })
        .from(clients)
        .where(and(isNull(clients.deletedAt), or(likeEsc(clients.name, p), likeEsc(clients.company, p))))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Clients", label: r.name, sublabel: r.company, href: "/crm/clients" });
      }
    });

    source(() => {
      for (const r of db.select({ id: leads.id, name: leads.name, service: leads.serviceRequested })
        .from(leads)
        .where(and(isNull(leads.deletedAt), or(likeEsc(leads.name, p), likeEsc(leads.serviceRequested, p))))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Leads", label: r.name, sublabel: r.service, href: "/crm/leads" });
      }
    });

    source(() => {
      for (const r of db.select({ id: deals.id, title: deals.title })
        .from(deals)
        .where(and(isNull(deals.deletedAt), likeEsc(deals.title, p)))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Deals", label: r.title, href: "/crm/deals" });
      }
    });

    source(() => {
      for (const r of db.select({ id: products.id, name: products.name, sku: products.sku })
        .from(products)
        .where(and(isNull(products.deletedAt), or(likeEsc(products.name, p), likeEsc(products.sku, p))))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Products", label: r.name, sublabel: r.sku, href: "/crm/products" });
      }
    });

    source(() => {
      for (const r of db.select({ id: estimates.id, number: estimates.number, title: estimates.title })
        .from(estimates)
        .where(and(isNull(estimates.deletedAt), or(likeEsc(estimates.number, p), likeEsc(estimates.title, p))))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Estimates", label: r.number, sublabel: r.title, href: "/crm/estimates" });
      }
    });

    source(() => {
      for (const r of db.select({ id: pmTasks.id, title: pmTasks.title })
        .from(pmTasks)
        .where(and(isNull(pmTasks.deletedAt), likeEsc(pmTasks.title, p)))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Tasks", label: r.title, href: "/pm/board" });
      }
    });

    source(() => {
      for (const r of db.select({ id: kbArticles.id, title: kbArticles.title, category: kbArticles.category })
        .from(kbArticles)
        .where(and(isNull(kbArticles.deletedAt), likeEsc(kbArticles.title, p)))
        .limit(PER_SOURCE).all()) {
        hits.push({ type: "Knowledge Base", label: r.title, sublabel: r.category, href: "/pm/kb" });
      }
    });

    if (isElev) {
      source(() => {
        for (const r of db.select({ id: invoices.id, number: invoices.number, clientName: invoices.clientName })
          .from(invoices)
          .where(and(isNull(invoices.deletedAt), or(likeEsc(invoices.number, p), likeEsc(invoices.clientName, p))))
          .limit(PER_SOURCE).all()) {
          hits.push({ type: "Invoices", label: r.number, sublabel: r.clientName, href: "/finance/invoices" });
        }
      });

      source(() => {
        for (const r of db.select({ id: purchaseOrders.id, number: purchaseOrders.number, vendor: purchaseOrders.vendor })
          .from(purchaseOrders)
          .where(and(isNull(purchaseOrders.deletedAt), or(likeEsc(purchaseOrders.number, p), likeEsc(purchaseOrders.vendor, p))))
          .limit(PER_SOURCE).all()) {
          hits.push({ type: "Purchase Orders", label: r.number, sublabel: r.vendor, href: "/finance/purchase-orders" });
        }
      });

      source(() => {
        for (const r of db.select({
          id: employees.id,
          name: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
          title: employees.jobTitle,
        })
          .from(employees)
          .where(and(
            isNull(employees.deletedAt),
            likeEsc(sql`${employees.firstName} || ' ' || ${employees.lastName}`, p),
          ))
          .limit(PER_SOURCE).all()) {
          hits.push({ type: "Employees", label: r.name, sublabel: r.title, href: "/hr/employees" });
        }
      });

      source(() => {
        for (const r of db.select({ id: candidates.id, name: candidates.name })
          .from(candidates)
          .where(likeEsc(candidates.name, p))
          .limit(PER_SOURCE).all()) {
          hits.push({ type: "Candidates", label: r.name, href: "/hr/recruitment" });
        }
      });

      source(() => {
        for (const r of db.select({ id: campaigns.id, name: campaigns.name })
          .from(campaigns)
          .where(and(isNull(campaigns.deletedAt), likeEsc(campaigns.name, p)))
          .limit(PER_SOURCE).all()) {
          hits.push({ type: "Campaigns", label: r.name, href: "/marketing" });
        }
      });
    }

    res.json({ results: hits.slice(0, TOTAL_CAP) });
  });
}
