import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { testApp } from "./test-app.mjs";
const app = await testApp(),
  { sqlite, owner, api } = app;
try {
  sqlite.transaction(() => {
    const client = sqlite.prepare(
      "INSERT INTO crm_clients(name,email,notes) VALUES(?,?,?)",
    );
    const lead = sqlite.prepare(
      "INSERT INTO crm_leads(name,phone,notes) VALUES(?,?,?)",
    );
    const invoice = sqlite.prepare(
      "INSERT INTO fin_invoices(number,client_name,items,total_cents) VALUES(?,?,?,?)",
    );
    const expense = sqlite.prepare(
      "INSERT INTO fin_expenses(date,vendor,category,amount_cents) VALUES('2026-09-10',?,'materials',15000)",
    );
    for (let i = 0; i < 3000; i++) {
      client.run(
        "Fixture customer " + i,
        `fixture${i}@example.test`,
        "Synthetic performance record",
      );
      lead.run("Fixture lead " + i, "555-0100", "Synthetic performance record");
      invoice.run("PERF-" + i, "Fixture customer " + i, "[]", 15000);
      expense.run("Fixture supplier " + i);
    }
  })();
  const measurements = [];
  for (const route of [
    "/api/crm/clients",
    "/api/crm/leads",
    "/api/finance/invoices",
    "/api/finance/expenses",
  ]) {
    const variants = [];
    for (const query of ["", "?page=0&limit=50"]) {
      const times = [];
      let payload;
      for (let i = 0; i < 4; i++) {
        const started = performance.now();
        const r = await api(route + query, "GET", undefined, owner);
        assert.equal(r.status, 200);
        times.push(performance.now() - started);
        payload = r.data;
      }
      const rows = Array.isArray(payload) ? payload : payload.rows;
      variants.push({
        query: query || "legacy unpaged",
        rows: rows?.length,
        bytes: Buffer.byteLength(JSON.stringify(payload)),
        medianMs:
          Math.round(times.slice(1).sort((a, b) => a - b)[1] * 100) / 100,
      });
    }
    assert.equal(variants[1].rows, 50);
    measurements.push({ route, variants });
  }
  const pick = await api(
    "/api/suite/pickers/clients?q=Fixture",
    "GET",
    undefined,
    owner,
  );
  assert.equal(pick.data.length, 12);
  const report = {
    createdAt: new Date().toISOString(),
    environment:
      "Local synthetic database; 3,000 records per tested list; loopback HTTP; one warm-up plus three samples. Not a production speed claim.",
    measurements,
    picker: {
      rows: pick.data.length,
      bytes: Buffer.byteLength(JSON.stringify(pick.data)),
    },
    queryPlans: {
      clients: sqlite
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id,name FROM crm_clients WHERE deleted_at IS NULL ORDER BY name LIMIT 50",
        )
        .all(),
      invoices: sqlite
        .prepare(
          "EXPLAIN QUERY PLAN SELECT id,number FROM fin_invoices WHERE deleted_at IS NULL ORDER BY created_at DESC,id DESC LIMIT 50",
        )
        .all(),
    },
  };
  const file = path.resolve("../_audit/2026-09-10/suite-performance.json");
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await app.close();
}
