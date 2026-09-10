import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { TOTP } from "otpauth";
import { testApp } from "./test-app.mjs";
const t = await testApp();
const { api, owner, sqlite, event, sessions, uploadsDir } = t;
const check = (label) => console.log("PASS: " + label);
const invoice = (name) => {
  const token = crypto.randomBytes(24).toString("hex");
  const id = Number(
    sqlite
      .prepare(
        `INSERT INTO fin_invoices(number,client_name,status,items,subtotal_cents,total_cents,paid_cents,share_token,sent_at) VALUES (?,'Test','sent','[]',10000,10000,0,?,?)`,
      )
      .run(name, token, Date.now()).lastInsertRowid,
  );
  return { id, token };
};
const paid = (inv, ref, amount = 10000) => ({
  id: "cs_" + ref,
  payment_intent: "pi_" + ref,
  payment_status: "paid",
  currency: "usd",
  amount_total: amount,
  metadata: { invoiceId: String(inv.id), which: "balance" },
});
try {
  const inv = invoice("ATOMIC");
  sqlite.exec(
    `CREATE TEMP TRIGGER fail_payment BEFORE UPDATE OF paid_cents ON fin_invoices WHEN NEW.id=${inv.id} BEGIN SELECT RAISE(ABORT,'Injected failure'); END;`,
  );
  assert.equal((await event(paid(inv, "atomic"))).status, 500);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM fin_invoice_payments WHERE invoice_id=?")
      .get(inv.id).n,
    0,
    "Failed transaction must roll back payment",
  );
  sqlite.exec("DROP TRIGGER fail_payment");
  assert.equal((await event(paid(inv, "atomic"))).status, 200);
  assert.equal((await event(paid(inv, "atomic"))).status, 200);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM fin_invoice_payments WHERE invoice_id=?")
      .get(inv.id).n,
    1,
  );
  assert.equal(
    sqlite.prepare("SELECT paid_cents FROM fin_invoices WHERE id=?").get(inv.id)
      .paid_cents,
    10000,
  );
  check(
    "Payment transaction rolls back, retries safely, and never records the same payment twice",
  );
  const delayed = invoice("DELAYED");
  assert.equal(
    (
      await event(
        paid(delayed, "delayed"),
        "checkout.session.async_payment_succeeded",
      )
    ).status,
    200,
  );
  assert.equal(
    sqlite
      .prepare("SELECT paid_cents FROM fin_invoices WHERE id=?")
      .get(delayed.id).paid_cents,
    10000,
  );
  await event(
    {
      payment_intent: "pi_delayed",
      id: "charge_refund",
      amount_refunded: 5000,
    },
    "charge.refunded",
    "evt_refund",
  );
  await event(
    {
      payment_intent: "pi_delayed",
      id: "charge_refund",
      amount_refunded: 5000,
    },
    "charge.refunded",
    "evt_refund",
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM fin_payment_exceptions WHERE event_id='evt_refund'",
      )
      .get().n,
    1,
  );
  await event(paid(delayed, "extra", 1000));
  assert.ok(
    sqlite
      .prepare(
        "SELECT 1 FROM fin_payment_exceptions WHERE invoice_id=? AND kind='overpayment'",
      )
      .get(delayed.id),
  );
  const bad = invoice("BAD-CURRENCY");
  await event({ ...paid(bad, "eur"), currency: "eur" });
  assert.equal(
    sqlite.prepare("SELECT paid_cents FROM fin_invoices WHERE id=?").get(bad.id)
      .paid_cents,
    0,
  );
  check(
    "Delayed payments, refunds, overpayments, and wrong-currency events have explicit outcomes",
  );
  const twice = invoice("CHECKOUT");
  const [first, second] = await Promise.all([
    api(`/api/public/invoice/${twice.token}/checkout`, "POST", {
      which: "balance",
    }),
    api(`/api/public/invoice/${twice.token}/checkout`, "POST", {
      which: "balance",
    }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.data.url, second.data.url);
  assert.equal(sessions.size, 1);
  const live = [...sessions.values()][0];
  live.status = "complete";
  live.payment_intent = "pi_pending";
  live.payment_status = "paid";
  assert.equal(
    (
      await api(`/api/public/invoice/${twice.token}/checkout`, "POST", {
        which: "balance",
      })
    ).status,
    409,
  );
  await event({
    ...live,
    metadata: { invoiceId: String(twice.id), which: "balance" },
  });
  assert.equal(
    (
      await api(`/api/public/invoice/${twice.token}/checkout`, "POST", {
        which: "balance",
      })
    ).status,
    409,
  );
  check(
    "Concurrent checkout requests share a session and completed payments cannot reopen it",
  );
  const options = invoice("OPTIONS");
  sqlite
    .prepare("UPDATE fin_invoices SET deposit_cents=5000 WHERE id=?")
    .run(options.id);
  const one = await api(
    `/api/public/invoice/${options.token}/checkout`,
    "POST",
    { which: "deposit" },
  );
  const two = await api(
    `/api/public/invoice/${options.token}/checkout`,
    "POST",
    { which: "balance" },
  );
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);
  assert.notEqual(one.data.url, two.data.url);
  assert.equal(
    [...sessions.values()].filter(
      (s) => s.metadata.invoiceId === String(options.id) && s.status === "open",
    ).length,
    1,
  );
  check("Changing payment amount expires the older checkout first");

  const nearExpiry = invoice("NEAR-EXPIRY");
  const near = (
    await api(`/api/public/invoice/${nearExpiry.token}/checkout`, "POST", {
      which: "balance",
    })
  ).data;
  sqlite
    .prepare("UPDATE fin_checkout_sessions SET expires_at=? WHERE invoice_id=?")
    .run(Date.now() + 1000, nearExpiry.id);
  assert.equal(
    (
      await api(`/api/public/invoice/${nearExpiry.token}/checkout`, "POST", {
        which: "balance",
      })
    ).data.url,
    near.url,
  );
  const pendingSession = [...sessions.values()].find(
    (s) => s.metadata.invoiceId === String(nearExpiry.id),
  );
  pendingSession.status = "complete";
  pendingSession.payment_intent = "pi_bank_pending";
  sqlite
    .prepare("UPDATE fin_invoices SET total_cents=12000 WHERE id=?")
    .run(nearExpiry.id);
  assert.equal(
    (
      await api(`/api/public/invoice/${nearExpiry.token}/checkout`, "POST", {
        which: "balance",
      })
    ).status,
    502,
  );
  await event(
    pendingSession,
    "checkout.session.async_payment_failed",
    "evt_bank_failed",
  );
  assert.equal(
    (
      await api(`/api/public/invoice/${nearExpiry.token}/checkout`, "POST", {
        which: "balance",
      })
    ).status,
    200,
  );
  check(
    "Near-expiry checkouts are reused; pending bank payments block competing checkout until failure is confirmed",
  );

  const item = (
    await api(
      "/api/items",
      "POST",
      {
        name: "Last test tool",
        quantity: 1,
        category: "tools",
        itemType: "tool",
      },
      owner,
    )
  ).data;
  const stock = await Promise.all([
    api(`/api/items/${item.id}/checkout`, "POST", { quantity: 1 }, owner),
    api(`/api/items/${item.id}/checkout`, "POST", { quantity: 1 }, owner),
  ]);
  assert.equal(stock.filter((r) => r.status === 201).length, 1);
  assert.ok(stock.some((r) => r.status === 400 || r.status === 409));
  assert.equal(
    (await api(`/api/items/${item.id}`, "GET", undefined, owner)).data.quantity,
    0,
  );
  check("Simultaneous checkouts cannot take the last item twice");

  const q = (
    await api(
      "/api/quotes",
      "POST",
      {
        type: "concrete",
        customerName: "Bilingual customer",
        totalCents: 10000,
        payload: {
          customer: {
            name: "Bilingual customer",
            email: "test@example.test",
            preferredLanguage: "es",
          },
        },
      },
      owner,
    )
  ).data;
  const edits = await Promise.all([
    api(
      `/api/quotes/${q.id}`,
      "PATCH",
      { version: q.version, totalCents: 11000 },
      owner,
    ),
    api(
      `/api/quotes/${q.id}`,
      "PATCH",
      { version: q.version, totalCents: 12000 },
      owner,
    ),
  ]);
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409]);
  const share = await api(`/api/quotes/${q.id}/share`, "POST", {}, owner);
  assert.equal(share.status, 200);
  assert.match(share.data.url, /\/es\/quote\//);
  assert.equal(
    (
      await api(
        `/api/quotes/${q.id}`,
        "PATCH",
        { version: 2, totalCents: 99999 },
        owner,
      )
    ).status,
    409,
  );
  const rev = await api(`/api/quotes/${q.id}/revision`, "POST", {}, owner);
  assert.equal(rev.status, 201);
  assert.equal(rev.data.revisionOf, q.id);
  assert.equal(
    (await api(`/api/quotes/${q.id}`, "GET", undefined, owner)).data.totalCents,
    edits.find((r) => r.status === 200).data.totalCents,
  );
  check(
    "Conflicting draft saves are rejected, issued content is immutable, and Spanish revisions preserve the original",
  );

  const worker = (
    await api(
      "/api/users",
      "POST",
      { name: "Test Worker", pin: "5678", role: "worker" },
      owner,
    )
  ).data;
  const employee = (
    await api(
      "/api/hr/employees",
      "POST",
      {
        userId: worker.id,
        firstName: "Test",
        lastName: "Worker",
        payType: "hourly",
        payRateCents: 2000,
        status: "active",
      },
      owner,
    )
  ).data;
  const workerToken = (
    await api("/api/auth/login", "POST", { name: "Test Worker", pin: "5678" })
  ).data.token;
  const start = new Date("2026-01-05T08:00:00-06:00").getTime();
  const hours = (
    await api(
      "/api/pm/time",
      "POST",
      { startedAt: start, endedAt: start + 8 * 3600000 },
      workerToken,
    )
  ).data;
  const period = "/api/hr/payroll/summary?from=2026-01-05&to=2026-01-11";
  const summary = await api(period, "GET", undefined, owner);
  assert.equal(summary.data[0].grossCents, 16000);
  assert.equal(
    (
      await api(
        `/api/hr/employees/${employee.id}`,
        "PATCH",
        { payRateCents: 3000, payEffectiveDate: "2026-02-01" },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api(period, "GET", undefined, owner)).data[0].grossCents,
    16000,
  );
  assert.equal(
    (
      await api(
        "/api/hr/payroll/record-expense",
        "POST",
        { from: "2026-01-05", to: "2026-01-11", amountCents: 16000 },
        owner,
      )
    ).status,
    201,
  );
  assert.equal(
    (await api(`/api/pm/time/${hours.id}`, "DELETE", undefined, workerToken))
      .status,
    409,
  );
  assert.equal(
    (await api(`/api/pm/time/${hours.id}`, "PATCH", { durationMin: 1 }, owner))
      .status,
    409,
  );
  assert.equal(
    (
      await api(
        `/api/pm/time/${hours.id}/corrections`,
        "POST",
        {
          effectiveDate: "2026-02-02",
          minutesDelta: 60,
          reason: "Missed setup hour",
        },
        owner,
      )
    ).status,
    201,
  );
  assert.equal(
    (await api(period, "GET", undefined, owner)).data[0].grossCents,
    16000,
  );
  const correction = (
    await api(
      "/api/hr/payroll/summary?from=2026-02-02&to=2026-02-02",
      "GET",
      undefined,
      owner,
    )
  ).data[0];
  assert.equal(
    correction.grossCents,
    2000,
    "Correction uses the original rate",
  );
  assert.equal(
    (
      await api(
        `/api/hr/employees/${employee.id}`,
        "PATCH",
        { status: "terminated", endDate: "2026-03-01" },
        owner,
      )
    ).status,
    200,
  );
  assert.equal(
    (await api("/api/auth/me", "GET", undefined, workerToken)).status,
    401,
  );
  assert.equal(
    (await api(period, "GET", undefined, owner)).data[0].grossCents,
    16000,
  );
  assert.equal(
    (await api(`/api/users/${worker.id}`, "DELETE", undefined, owner)).status,
    200,
  );
  assert.ok(
    sqlite.prepare("SELECT 1 FROM pm_time_entries WHERE id=?").get(hours.id),
  );
  const ownerId = sqlite
    .prepare("SELECT id FROM users WHERE name='Owner'")
    .get().id;
  assert.equal(
    (
      await api(
        `/api/users/${ownerId}/access`,
        "PATCH",
        { active: false },
        owner,
      )
    ).status,
    400,
  );
  assert.throws(() => t.storage.setUserAccess(ownerId, false), /owner/i);
  check(
    "Dated rates, closed payroll, corrections, termination, and last-owner protection",
  );

  const photo =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=";
  const body = {
    name: "Cliente de prueba",
    email: "cliente@example.test",
    lang: "es",
    site: "concrete",
    message: "a".repeat(4000),
    designSpec: "b".repeat(4000),
    photos: [photo],
    submissionId: crypto.randomUUID(),
  };
  const intake = await api("/api/public/leads", "POST", body, undefined, {
    "X-Lead-Key": "test-intake-key",
  });
  assert.equal(intake.status, 201);
  const retry = await api("/api/public/leads", "POST", body, undefined, {
    "X-Lead-Key": "test-intake-key",
  });
  assert.equal(retry.data.id, intake.data.id);
  assert.equal(
    sqlite
      .prepare("SELECT preferred_language FROM crm_leads WHERE id=?")
      .get(intake.data.id).preferred_language,
    "es",
  );
  const image = fs.readdirSync(uploadsDir).find((n) => n.endsWith(".png"));
  assert.ok(image);
  assert.equal((await api("/uploads/" + image)).status, 401);
  assert.equal(
    (await api("/uploads/" + image, "GET", undefined, owner)).status,
    200,
  );
  assert.equal((await api('/uploads/'+image,'GET',undefined,undefined,{'X-Lead-Key':'test-intake-key'})).status,200);
  process.env.NODE_ENV='production';assert.equal((await api('/uploads/'+image,'GET',undefined,owner)).status,428);process.env.NODE_ENV='development';
  sqlite.prepare("INSERT INTO mk_portfolio(title,photo_url,published) VALUES ('Approved test project',?,1)").run('/uploads/'+image);
  assert.equal((await api('/uploads/'+image)).status,200);
  sqlite.prepare("UPDATE mk_portfolio SET published=0 WHERE photo_url=?").run('/uploads/'+image);
  assert.equal((await api('/uploads/'+image)).status,401);
  check(
    "Long bilingual intake, retry receipts, photo persistence, and private image access",
  );

  const { reconcileRecords } = await import("./reconcile-records.mjs");
  const reconciliation = reconcileRecords(
    path.join(process.env.DATA_DIR, "inventory.db"),
  );
  assert.deepEqual(reconciliation.negativeStock, []);
  assert.deepEqual(reconciliation.paymentMismatches, []);
  const { createFullBackup } = await import("../server/full-backup.ts");
  const { restoreBackup } = await import("./restore-backup.mjs");
  const snapshot = await createFullBackup();
  const destination = path.join(process.env.DATA_DIR, "restore-drill");
  const restored = await restoreBackup(snapshot.file, destination);
  assert.ok(restored.uploads >= 1);
  assert.deepEqual(
    fs.readFileSync(path.join(destination, "uploads", image)),
    fs.readFileSync(path.join(uploadsDir, image)),
  );
  const recovered = new Database(path.join(destination, "inventory.db"), {
    readonly: true,
  });
  assert.equal(
    recovered
      .prepare("SELECT paid_cents FROM fin_invoices WHERE id=?")
      .get(inv.id).paid_cents,
    10000,
  );
  assert.equal(recovered.pragma("integrity_check", { simple: true }), "ok");
  recovered.close();
  await assert.rejects(
    () => restoreBackup(snapshot.file, destination),
    /new, nonexistent/,
  );
  const { create: tarCreate, extract: tarExtract } = await import("tar");
  const corruptSource = path.join(process.env.DATA_DIR, "tampered-source");
  fs.mkdirSync(corruptSource);
  await tarExtract({ file: snapshot.file, cwd: corruptSource });
  fs.appendFileSync(path.join(corruptSource, "uploads", image), "tampered");
  const corruptFile = path.join(process.env.DATA_DIR, "tampered.tar.gz");
  await tarCreate(
    { cwd: corruptSource, file: corruptFile, gzip: true },
    fs.readdirSync(corruptSource),
  );
  await assert.rejects(
    () =>
      restoreBackup(
        corruptFile,
        path.join(process.env.DATA_DIR, "tampered-restore"),
      ),
    /checksum/i,
  );
  check(
    "Full backup restores actual invoices and uploaded photos, verifies checksums, and rejects overwriting a directory",
  );

  const {setDraftUser,saveSession,loadSession,clearSession}=await import('../client/src/quote/lib/store.js');
  const browserStore=new Map([['cjm.session.v1',JSON.stringify({private:'legacy'})]]);
  globalThis.localStorage={getItem:key=>browserStore.get(key)??null,setItem:(key,value)=>browserStore.set(key,value),removeItem:key=>browserStore.delete(key)};
  setDraftUser(100);assert.equal(loadSession(),null);saveSession({private:'first account draft'});
  setDraftUser(200);assert.equal(loadSession(),null);saveSession({private:'second account draft'});clearSession();
  setDraftUser(100);assert.equal(loadSession().private,'first account draft');
  setDraftUser(null);assert.equal(loadSession(),null);assert.equal(saveSession({private:'signed out'}),false);delete globalThis.localStorage;
  check('A shared browser never loads another user’s draft or the unowned legacy draft');

  const enroll = await api(
    "/api/security/enroll",
    "POST",
    { currentPassword: "1234" },
    owner,
  );
  assert.equal(enroll.status, 200);
  const otp = new TOTP({ secret: enroll.data.secret }).generate();
  const complete = await api(
    "/api/security/complete",
    "POST",
    { password: "Synthetic password 2026", otp },
    owner,
  );
  assert.equal(complete.status, 200);
  assert.equal(complete.data.recoveryCodes.length, 10);
  assert.equal(
    (await api("/api/auth/me", "GET", undefined, owner)).status,
    401,
  );
  const recovery = complete.data.recoveryCodes[0];
  const login = await api("/api/auth/login", "POST", {
    name: "Owner",
    pin: "Synthetic password 2026",
    otp: recovery,
  });
  assert.equal(login.status, 200);
  assert.equal(
    (
      await api("/api/auth/login", "POST", {
        name: "Owner",
        pin: "Synthetic password 2026",
        otp: recovery,
      })
    ).status,
    401,
  );
  sqlite
    .prepare("UPDATE sessions SET created_at=? WHERE token=?")
    .run(Date.now() - 13 * 3600000, login.data.token);
  assert.equal(
    (await api("/api/auth/me", "GET", undefined, login.data.token)).status,
    401,
  );
  check(
    "Owner password and MFA enrollment, old-session revocation, one-use recovery codes, and absolute session expiry",
  );
  console.log("ALL RELEASE REGRESSIONS PASSED");
} finally {
  await t.close();
}
