import assert from "node:assert/strict";
import { testApp } from "./test-app.mjs";
const t = await testApp();
const { api, owner, sqlite } = t;
try {
  const lead = async (name) =>
    (
      await api(
        "/api/crm/leads",
        "POST",
        {
          name,
          email: "same@example.test",
          phone: "8175550100",
          site: "metals",
        },
        owner,
      )
    ).data;
  const quote = async (leadId, totalCents = 10000) =>
    (
      await api(
        "/api/quotes",
        "POST",
        {
          type: "custom",
          customerName: "Same customer",
          leadId,
          totalCents,
          payload: {
            type: "custom",
            customer: { name: "Same customer", email: "same@example.test" },
            depositPct: 50,
          },
        },
        owner,
      )
    ).data;
  const a = await lead("Gate job"),
    b = await lead("Slab job");
  const qa = await quote(a.id),
    qb = await quote(b.id);
  assert.equal(
    (
      await api(
        `/api/crm/leads/${a.id}`,
        "PATCH",
        { stage: "won", winLossReason: "good_fit" },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM quotes WHERE id=?").get(qa.id).status,
    "accepted",
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM quotes WHERE id=?").get(qb.id).status,
    "draft",
    "Same contact must not close another job",
  );
  const invoice = sqlite
    .prepare("SELECT * FROM fin_invoices WHERE quote_id=?")
    .get(qa.id);
  assert.equal(invoice.lead_id, a.id);
  assert.ok(invoice.project_id);
  assert.equal(invoice.deposit_cents, 5000);
  const again = await api(`/api/quotes/${qa.id}/accept`, "POST", {}, owner);
  assert.equal(again.status, 200);
  assert.equal(again.data.alreadyAccepted, true);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) AS n FROM fin_invoices WHERE quote_id=?")
      .get(qa.id).n,
    1,
  );
  assert.equal(
    (
      await api(
        `/api/quotes/${qa.id}`,
        "PATCH",
        { version: 1, totalCents: 90000 },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (await api(`/api/quotes/${qa.id}`, "DELETE", undefined, owner)).status,
    409,
  );
  const c = await lead("Alternatives");
  const qc = await quote(c.id),
    qd = await quote(c.id, 15000);
  assert.equal(
    (
      await api(
        `/api/crm/leads/${c.id}`,
        "PATCH",
        { stage: "won", winLossReason: "good_fit" },
        owner,
      )
    ).status,
    409,
    "Require a specific offer",
  );
  assert.equal(
    (
      await api(
        `/api/crm/leads/${c.id}`,
        "PATCH",
        { stage: "won", winLossReason: "good_fit", quoteId: qd.id },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM quotes WHERE id=?").get(qc.id).status,
    "draft",
  );
  assert.equal(
    (await api(`/api/quotes/${qc.id}/accept`, "POST", {}, owner)).status,
    409,
    "Do not book the same lead twice",
  );
  assert.equal(
    (
      await api(
        `/api/crm/leads/${b.id}`,
        "PATCH",
        { stage: "lost", winLossReason: "price" },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    sqlite.prepare("SELECT status FROM quotes WHERE id=?").get(qb.id).status,
    "declined",
  );
  const job = await api(
    `/api/crm/leads/${a.id}/detail`,
    "GET",
    undefined,
    owner,
  );
  assert.equal(job.status, 200);
  assert.equal(job.data.projects.length, 1);
  assert.equal(job.data.invoices[0].id, invoice.id);
  console.log(
    "PASS: explicit job links, acceptance transaction, repeated acceptance, quote selection, issued immutability and connected workspace",
  );
} finally {
  await t.close();
}
