import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { testApp } from "./test-app.mjs";
const app = await testApp(),
  { sqlite, api, owner, uploadsDir } = app;
const call = async (url, method = "GET", body, token = owner) => {
  const r = await api(url, method, body, token);
  assert.ok(r.status < 300, `${url}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
};
try {
  const workerUser = await call("/api/users", "POST", {
      name: "Recovery Worker",
      pin: "4321",
      role: "worker",
    }),
    worker = (
      await call("/api/auth/login", "POST", {
        name: "Recovery Worker",
        pin: "4321",
      })
    ).token;
  const job = await call("/api/projects", "POST", {
    jobNumber: "RECOVERY-1",
    name: "Isolated recovery job",
  });
  const photo = "suite-test.png",
    thumbnail = "suite-thumb.png";
  for (const name of [photo, thumbnail])
    fs.writeFileSync(
      path.join(uploadsDir, name),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
  await call("/api/suite/photo-preview", "POST", {
    url: "/uploads/" + photo,
    thumbnailUrl: "/uploads/" + thumbnail,
  });
  const file = await call(`/api/suite/jobs/${job.id}/files`, "POST", {
    requestKey: crypto.randomUUID(),
    title: "Measurements",
    url: "/uploads/" + photo,
    kind: "measurement",
    replacesId: null,
  });
  await call(`/api/suite/jobs/${job.id}/files`, "POST", {
    requestKey: crypto.randomUUID(),
    title: "Measurements revised",
    url: "/uploads/" + photo,
    kind: "measurement",
    replacesId: file.id,
  });
  assert.equal(
    (
      await api(
        `/api/suite/jobs/${job.id}/files`,
        "POST",
        {
          requestKey: crypto.randomUUID(),
          title: "Stale revision",
          url: "/uploads/" + photo,
          kind: "measurement",
          replacesId: file.id,
        },
        owner,
      )
    ).status,
    409,
  );
  const publication = {
    requestKey: crypto.randomUUID(),
    title: "Approved sample job",
    photoUrl: "/uploads/" + photo,
    site: "concrete",
    approved: true,
  };
  assert.equal(
    (
      await api(
        `/api/projects/${job.id}/publish-portfolio`,
        "POST",
        publication,
        owner,
      )
    ).status,
    400,
  );
  await call(`/api/projects/${job.id}`, "PATCH", { status: "done" });
  sqlite.prepare("UPDATE projects SET site='concrete' WHERE id=?").run(job.id);
  assert.equal(
    (
      await api(
        `/api/projects/${job.id}/publish-portfolio`,
        "POST",
        { ...publication, approved: false },
        owner,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        `/api/projects/${job.id}/publish-portfolio`,
        "POST",
        publication,
        worker,
      )
    ).status,
    403,
  );
  const published = await call(
    `/api/projects/${job.id}/publish-portfolio`,
    "POST",
    publication,
  );
  assert.equal(
    (
      await call(
        `/api/projects/${job.id}/publish-portfolio`,
        "POST",
        publication,
      )
    ).id,
    published.id,
  );
  assert.equal(
    (await call("/api/public/portfolio?site=concrete")).items.length,
    1,
  );
  assert.equal(
    (await call("/api/public/portfolio?site=metals")).items.length,
    0,
  );
  const { queueMail, sendMail, optOutEmail } = await import(
    "../server/mailer.ts"
  );
  process.env.RESEND_API_KEY = "synthetic";
  process.env.MAIL_FROM = "test@example.test";
  queueMail({
    to: "fixture@example.test",
    subject: "Attachment recovery",
    text: "Synthetic only",
    deliveryKey: "recovery-file",
    attachments: [
      { filename: "drawing.txt", content: Buffer.from("recover these bytes") },
    ],
  });
  const queued = JSON.parse(
    sqlite
      .prepare("SELECT payload FROM suite_mail WHERE key=?")
      .get("recovery-file").payload,
  );
  const { createFullBackup } = await import("../server/full-backup.ts");
  const { restoreBackup } = await import("./restore-backup.mjs");
  const snapshot = await createFullBackup(),
    dest = path.join(process.env.DATA_DIR, "restore-queue");
  await restoreBackup(snapshot.file, dest);
  assert.equal(
    fs.readFileSync(
      path.join(dest, "mail-attachments", queued.msg.attachments[0].file),
      "utf8",
    ),
    "recover these bytes",
  );
  const restored = new Database(path.join(dest, "inventory.db"), {
    readonly: true,
  });
  assert.equal(
    restored
      .prepare(
        "SELECT status FROM suite_outbox WHERE event_key='delivery:recovery-file'",
      )
      .get().status,
    "pending",
  );
  restored.close();
  queueMail({
    to: "fixture@example.test",
    subject: "Old ambiguous send",
    text: "Synthetic only",
    deliveryKey: "expired-window",
  });
  sqlite
    .prepare(
      "UPDATE suite_mail SET first_attempt_at=? WHERE key='expired-window'",
    )
    .run(Date.now() - 24 * 3600000);
  assert.equal(
    await sendMail({
      to: "fixture@example.test",
      subject: "Old ambiguous send",
      text: "Synthetic only",
      deliveryKey: "expired-window",
    }),
    false,
  );
  assert.equal(
    sqlite
      .prepare(
        "SELECT status FROM suite_outbox WHERE event_key='delivery:expired-window'",
      )
      .get().status,
    "review",
  );
  optOutEmail("fixture@example.test");
  await sendMail({
    to: "fixture@example.test",
    subject: "Obsolete reminder",
    text: "Synthetic only",
    deliveryKey: "stopped-reminder",
    condition: { kind: "quote-pending", id: 999999 },
  });
  assert.equal(
    sqlite
      .prepare(
        "SELECT status FROM suite_outbox WHERE event_key='delivery:stopped-reminder'",
      )
      .get().status,
    "stopped",
  );
  for (const type of ["clients", "jobs", "quotes"])
    assert.ok(
      Array.isArray(await call("/api/suite/pickers/" + type + "?q=RECOVERY")),
    );
  console.log(
    "PASS approved trade publishing, revision conflicts, restored mail attachments, delivery uncertainty hold, obsolete reminders and small pickers",
  );
} finally {
  await app.close();
}
