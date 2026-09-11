import assert from "node:assert/strict";
import { testApp } from "./test-app.mjs";
const app = await testApp();
try {
  const { businessMidnight } = await import("../server/growth.ts");
  const { safeGooglePage } = await import("../server/google-reporting.ts");
  assert.equal(
    safeGooglePage("/services/steel-gates?email=private@example.test"),
    "/services/steel-gates",
  );
  assert.equal(
    safeGooglePage(
      "https://www.cjmmetals.com/es/review/private-token?secret=value",
    ),
    "/private",
  );
  assert.equal(safeGooglePage("/api/quotes/private-token"), "/private");
  const { queueLeadOutcome, deliverLeadOutcomes, saveLeadAttribution } =
    await import("../server/lead-measurement.ts");
  assert.equal(
    new Date(businessMidnight("2026-03-08")).toISOString(),
    "2026-03-08T06:00:00.000Z",
  );
  assert.equal(
    new Date(businessMidnight("2026-03-09")).toISOString(),
    "2026-03-09T05:00:00.000Z",
  );
  const owner = app.owner;
  const touch = {
    site: "www.cjmtrades.com",
    page: "/plan",
    source: "google",
    medium: "cpc",
    campaign: "gates",
    referrer: "google.com",
    at: Date.now(),
  };
  const attribution = {
    first: touch,
    last: touch,
    entrySite: "www.cjmtrades.com",
    handoffs: 1,
    mode: "normal",
    landingPage: "/plan",
    submittedPage: "/",
    analyticsConsent: true,
    clientId: "123456.789012",
  };
  const lead = await app.api(
    "/api/public/leads",
    "POST",
    {
      name: "Synthetic growth check",
      site: "metals",
      email: "growth@example.test",
      attribution,
    },
    null,
    { "X-Lead-Key": "test-intake-key" },
  );
  assert.equal(lead.status, 201);
  assert.equal(
    app.sqlite
      .prepare("SELECT entry_site FROM mk_lead_attribution WHERE lead_id=?")
      .get(lead.data.id).entry_site,
    "www.cjmtrades.com",
  );
  const id = lead.data.id;
  queueLeadOutcome(id, "qualify_lead");
  queueLeadOutcome(id, "qualify_lead");
  assert.equal(
    app.sqlite.prepare("SELECT count(*) n FROM mk_measurement_events").get().n,
    1,
  );
  process.env.GA4_METALS_API_SECRET = "synthetic-secret";
  const requests = [];
  await deliverLeadOutcomes(async (url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(null, { status: 204 });
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].client_id, "123456.789012");
  assert.ok(!JSON.stringify(requests).includes("growth@example.test"));
  assert.equal(requests[0].events[0].name, "qualify_lead");
  await deliverLeadOutcomes(async () => {
    throw new Error("duplicate delivery");
  });
  assert.equal(requests.length, 1);
  assert.equal(
    app.sqlite.prepare("SELECT state FROM mk_measurement_events").get().state,
    "accepted",
  );
  const rejected = await app.api("/api/marketing/growth?site=metals");
  assert.equal(rejected.status, 401);
  const token = owner;
  const report = await app.api(
    "/api/marketing/growth?site=metals",
    "GET",
    undefined,
    token,
  );
  assert.equal(report.status, 200);
  assert.equal(
    report.data.current.totals.leads,
    0,
    "Current incomplete day excluded",
  );
  const yesterday = businessMidnight(report.data.current.end) + 3600000;
  app.sqlite
    .prepare(
      "UPDATE crm_leads SET created_at=?,stage=?,revenue_closed_cents=? WHERE id=?",
    )
    .run(yesterday, "won", 250000, id);
  app.sqlite
    .prepare(
      "UPDATE crm_lead_intake SET qualified_at=?,survey_at=? WHERE lead_id=?",
    )
    .run(yesterday, yesterday + 86400000, id);
  app.sqlite
    .prepare(
      "INSERT INTO quotes(number,type,lead_id,status,sent_at) VALUES('GROWTH-Q1','table',?,'sent',?)",
    )
    .run(id, yesterday);
  app.sqlite
    .prepare(
      "INSERT INTO quotes(number,type,lead_id,status,sent_at) VALUES('GROWTH-Q2','table',?,'sent',?)",
    )
    .run(id, yesterday);
  const invoice = app.sqlite
    .prepare(
      "INSERT INTO fin_invoices(number,lead_id,status) VALUES('GROWTH-I1',?,'paid')",
    )
    .run(id).lastInsertRowid;
  app.sqlite
    .prepare(
      "INSERT INTO fin_invoice_payments(invoice_id,amount_cents) VALUES(?,?)",
    )
    .run(invoice, 30000);
  app.sqlite
    .prepare(
      "INSERT INTO fin_invoice_payments(invoice_id,amount_cents) VALUES(?,?)",
    )
    .run(invoice, 20000);
  const voided = app.sqlite
    .prepare(
      "INSERT INTO fin_invoices(number,lead_id,status) VALUES('GROWTH-VOID',?,'void')",
    )
    .run(id).lastInsertRowid;
  app.sqlite
    .prepare(
      "INSERT INTO fin_invoice_payments(invoice_id,amount_cents) VALUES(?,?)",
    )
    .run(voided, 99000);
  const spend = await app.api(
    "/api/marketing/growth/spend",
    "POST",
    { site: "metals", end: report.data.current.end, amountCents: 10000 },
    token,
  );
  assert.equal(spend.status, 200);
  const cohort = await app.api(
    "/api/marketing/growth?site=metals",
    "GET",
    undefined,
    token,
  );
  assert.deepEqual(
    [
      cohort.data.current.totals.leads,
      cohort.data.current.totals.qualified,
      cohort.data.current.totals.quoted,
      cohort.data.current.totals.won,
    ],
    [1, 1, 1, 1],
  );
  assert.equal(
    cohort.data.current.totals.collectedCents,
    50000,
    "Exclude void invoice and count each payment once despite two quotes",
  );
  assert.equal(cohort.data.current.totals.bookedCents, 250000);
  assert.equal(cohort.data.current.costPerQualifiedPaidLeadCents, 10000);
  assert.equal(cohort.data.current.bySource[0].page, "/plan");
  const invalid = await app.api(
    "/api/marketing/growth/spend",
    "POST",
    { site: "metals", end: "2099-01-01", amountCents: 10 },
    token,
  );
  assert.equal(invalid.status, 400);
  saveLeadAttribution(id, "metals", {
    ...attribution,
    analyticsConsent: false,
  });
  assert.equal(
    app.sqlite
      .prepare("SELECT client_id FROM mk_lead_attribution WHERE lead_id=?")
      .get(id).client_id,
    null,
  );
  queueLeadOutcome(id, "working_lead");
  assert.equal(
    app.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM mk_measurement_events WHERE event_name='working_lead'",
      )
      .get().n,
    0,
  );
  saveLeadAttribution(id, "metals", { ...attribution, mode: "staff" });
  const staff = await app.api(
    "/api/marketing/growth?site=metals",
    "GET",
    undefined,
    token,
  );
  assert.equal(staff.data.current.totals.leads, 0);
  const tests = await app.api(
    "/api/marketing/growth?site=metals&includeTests=1",
    "GET",
    undefined,
    token,
  );
  assert.equal(tests.data.current.totals.leads, 1);
  const reviewToken = "aa".repeat(24);
  app.sqlite
    .prepare("INSERT INTO review_requests(token,lead_id,name) VALUES(?,?,?)")
    .run(reviewToken, id, "Synthetic review");
  const review = await app.api("/api/public/review-request/" + reviewToken);
  assert.equal(review.data.brand, "CJM Metals");
  assert.match(review.data.googleProfileUrl, /15884306771721707171/);
  app.sqlite
    .prepare("UPDATE review_requests SET submitted_at=? WHERE token=?")
    .run(Date.now(), reviewToken);
  const used = await app.api("/api/public/review-request/" + reviewToken);
  assert.equal(used.data.reason, "used");
  assert.equal(used.data.googleProfileUrl, review.data.googleProfileUrl);
  app.sqlite.prepare("UPDATE crm_leads SET site='concrete' WHERE id=?").run(id);
  const concrete = await app.api("/api/public/review-request/" + reviewToken);
  assert.equal(
    concrete.data.googleProfileUrl,
    "https://share.google/lzboKjzQ5ozdqaEjP",
  );
  app.sqlite
    .prepare("UPDATE crm_leads SET site='insulation' WHERE id=?")
    .run(id);
  const unverified = await app.api("/api/public/review-request/" + reviewToken);
  assert.equal(unverified.data.googleProfileUrl, undefined);
  console.log(
    "Growth checks passed: source persistence, consented outcomes, duplicate protection, access and complete periods.",
  );
} finally {
  await app.close();
}
