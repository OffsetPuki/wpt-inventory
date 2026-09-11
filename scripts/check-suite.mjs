import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testApp } from "./test-app.mjs";
const app = await testApp();
const { api, owner, sqlite } = app;
const call = async (path, method = "GET", body, token = owner) => {
  const r = await api(path, method, body, token);
  assert.equal(
    r.status,
    method === "POST" && path === "/api/projects" ? 201 : 200,
    JSON.stringify(r.data),
  );
  return r.data;
};
try {
  await call("/api/suite/people");
  const job = await call("/api/projects", "POST", {
    jobNumber: "SUITE-1",
    name: "Connected job",
  });
  const before = await call(`/api/suite/jobs/${job.id}`);
  assert.equal(before.job.billing_mode, "review");
  await call("/api/suite/today");
  sqlite
    .prepare(
      `INSERT INTO fin_invoices(number,project_id,status,total_cents,subtotal_cents) VALUES('SUITE-DRAFT',?,'draft',10000,10000)`,
    )
    .run(job.id);
  const summary = await call(`/api/finance/projects/${job.id}/summary`);
  assert.equal(summary.totals.invoicedCents, 0);
  assert.equal(summary.totals.draftCents, 10000);
  const body = {
    version: before.job.version,
    clientId: null,
    site: "metals",
    siteAddress: "Test site",
    preferredLanguage: "en",
    billingMode: "fixed",
    startDate: null,
    dueDate: null,
    scheduleState: "tentative",
    depositRequired: false,
    documentsRequired: [],
    tools: [],
  };
  await call(`/api/suite/jobs/${job.id}`, "PATCH", body);
  assert.equal(
    (await api(`/api/suite/jobs/${job.id}`, "PATCH", body, owner)).status,
    409,
  );
  const comment = {
    requestKey: crypto.randomUUID(),
    body: "Internal job note",
    visibility: "team",
    mentions: [],
    attachments: [],
  };
  await call(`/api/suite/jobs/${job.id}/comments`, "POST", comment);
  await call(`/api/suite/jobs/${job.id}/comments`, "POST", comment);
  assert.equal((await call(`/api/suite/jobs/${job.id}/activity`)).length, 1);
  console.log(
    "Suite foundation: draft totals, job versions, comments and connected views passed.",
  );
} finally {
  await app.close();
}
