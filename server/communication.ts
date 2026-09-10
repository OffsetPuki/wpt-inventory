import { sqlite } from "./storage";

export function communicationContext(info: {
  quoteNumber?: string;
  invoiceNumber?: string;
  leadId?: number | null;
}) {
  try {
    let leadId = info.leadId;
    let designRef: string | undefined;
    let clientId: number | undefined;
    let quoteLang: string | undefined;
    let quoteSite: string | undefined;
    if (info.quoteNumber) {
      const row = sqlite
        .prepare(
          "SELECT lead_id,design_ref,payload,type FROM quotes WHERE number=?",
        )
        .get(info.quoteNumber) as any;
      leadId ??= row?.lead_id;
      designRef = row?.design_ref;
      quoteLang = JSON.parse(row?.payload || "{}").customer?.preferredLanguage;
      quoteSite = row
        ? row.type === "concrete"
          ? "concrete"
          : row.type === "insulation"
            ? "insulation"
            : "metals"
        : undefined;
    }
    if (info.invoiceNumber) {
      const row = sqlite
        .prepare(
          `SELECT coalesce(i.lead_id,q.lead_id) AS lead_id,q.design_ref,i.client_id
      FROM fin_invoices i LEFT JOIN quotes q ON q.id=i.quote_id WHERE i.number=?`,
        )
        .get(info.invoiceNumber) as any;
      leadId ??= row?.lead_id;
      designRef ??= row?.design_ref;
      clientId = row?.client_id;
    }
    if (leadId == null && designRef)
      leadId = (
        sqlite
          .prepare("SELECT lead_id FROM web_designs WHERE upper(ref)=upper(?)")
          .get(designRef) as any
      )?.lead_id;
    const lead =
      leadId == null
        ? null
        : (sqlite
            .prepare("SELECT preferred_language,site FROM crm_leads WHERE id=?")
            .get(leadId) as any);
    const client =
      clientId == null
        ? null
        : (sqlite
            .prepare("SELECT preferred_language FROM crm_clients WHERE id=?")
            .get(clientId) as any);
    return {
      lang: (lead?.preferred_language ||
        quoteLang ||
        client?.preferred_language ||
        "en") as "en" | "es",
      brand:
        (
          {
            metals: "CJM Metals",
            concrete: "CJM Concrete",
            insulation: "CJM Insulation",
            trades: "CJM Trades",
          } as Record<string, string>
        )[lead?.site || quoteSite || ""] || undefined,
    };
  } catch {
    return { lang: "en" as const, brand: undefined };
  }
}
export function localizedLink(url: string, lang: string) {
  if (lang !== "es") return url;
  const target = new URL(url);
  if (!target.pathname.startsWith("/es/"))
    target.pathname = "/es" + target.pathname;
  return target.toString();
}
