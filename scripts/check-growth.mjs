import assert from "node:assert/strict";
import { testApp } from "./test-app.mjs";
const app = await testApp();
try {
  const { businessMidnight } = await import("../server/growth.ts");
  const { safeGooglePage, googleReport, refreshGoogleReports } = await import("../server/google-reporting.ts");
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
  let projectLead;
  for (const page of ["/work/17", "/es/work/17", "/work", "/es/work/"]) {
    projectLead = app.sqlite.prepare("INSERT INTO crm_leads(name,site) VALUES('Synthetic project attribution','metals')").run().lastInsertRowid;
    saveLeadAttribution(projectLead, "metals", {...attribution, first: {...touch, page}, landingPage: page});
    assert.equal(app.sqlite.prepare("SELECT landing_page FROM mk_lead_attribution WHERE lead_id=?").get(projectLead).landing_page, page);
  }
  for (const page of ["/work/private-token", "/work/0", "/es/invoice/private-token"]) {
    saveLeadAttribution(projectLead, "metals", {...attribution, first: {...touch, page}, landingPage: page});
    assert.equal(app.sqlite.prepare("SELECT landing_page FROM mk_lead_attribution WHERE lead_id=?").get(projectLead).landing_page, "/es/work/", "Invalid input must not replace recorded attribution");
  }
  saveLeadAttribution(id, "metals", attribution);

  // Old preview-contaminated cache must be hidden until refreshed, without deleting history.
  const cache = app.sqlite.prepare("INSERT OR REPLACE INTO mk_google_reports(site,start_date,end_date,kind,payload,fetched_at) VALUES(?,?,?,?,?,?)");
  cache.run("metals", "2026-08-01", "2026-08-28", "traffic", JSON.stringify({rows:[{sessions:99}]}), Date.now());
  assert.equal(googleReport("metals", "2026-08-01", "2026-08-28", "traffic"), null);
  const previousFetch = globalThis.fetch;
  const requestsToGoogle = [];
  process.env.GOOGLE_REPORTING_OAUTH_JSON = JSON.stringify({type:"authorized_user",client_id:"fixture-client",client_secret:"fixture-secret",refresh_token:"fixture-refresh"});
  globalThis.fetch = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({access_token:"fixture-access",expires_in:3600}));
    assert.match(url, /^https:\/\/(analyticsdata|www)\.googleapis\.com\//);
    requestsToGoogle.push(JSON.parse(options.body));
    return new Response(JSON.stringify({rows:[]}));
  };
  try { await refreshGoogleReports("metals", "2026-08-01", "2026-08-28"); }
  finally { globalThis.fetch = previousFetch; delete process.env.GOOGLE_REPORTING_OAUTH_JSON; }
  const trafficRequest = requestsToGoogle.find(r=>r.metrics?.some(m=>m.name==="sessions"));
  assert.deepEqual(trafficRequest.dimensionFilter.andGroup.expressions[0], {filter:{fieldName:"hostName",stringFilter:{matchType:"EXACT",value:"www.cjmmetals.com",caseSensitive:false}}});
  assert.deepEqual(trafficRequest.dimensionFilter.andGroup.expressions[1].notExpression.filter.inListFilter.values, ["release_check","qa"]);
  assert.equal(googleReport("metals", "2026-08-01", "2026-08-28", "traffic").productionHost, "www.cjmmetals.com");
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
  assert.equal((await app.api("/api/marketing/growth/overview")).status, 401);
  app.sqlite.prepare("UPDATE mk_lead_attribution SET first_touch=? WHERE lead_id=?").run(JSON.stringify({...touch,medium:"organic"}), id);
  cache.run("metals", cohort.data.current.start, cohort.data.current.end, "searchTotals", JSON.stringify({totals:{clicks:7,impressions:100}}), Date.now());
  cache.run("metals", cohort.data.current.start, cohort.data.current.end, "traffic", JSON.stringify({productionHost:"www.cjmmetals.com",rows:[{medium:"organic",sessions:3},{medium:"cpc",sessions:4}]}), Date.now());
  const summary = await app.api("/api/marketing/growth/overview", "GET", undefined, token);
  assert.equal(summary.data.rows.length, 4);
  const metals = summary.data.rows.find(row=>row.site==="metals");
  assert.deepEqual([metals.leads,metals.qualified,metals.quoted,metals.won,metals.clicks,metals.impressions,metals.sessions], [1,1,1,1,7,100,3]);
  assert.equal(summary.data.rows.find(row=>row.site==="concrete").sessions, null, "Missing Google data is not zero");
  app.sqlite.prepare("UPDATE mk_lead_attribution SET first_touch=? WHERE lead_id=?").run(JSON.stringify(touch), id);
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
