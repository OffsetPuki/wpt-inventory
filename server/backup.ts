import type { Express } from "express";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { sqlite, dataDir } from "./storage";
import { requireTechnician } from "./auth";
import { audit } from "./audit";

// ─── Database backup (Phase E) ───────────────────────────────────────────────
// One SQLite file on one volume holds the whole business, so: a nightly
// gzipped snapshot with 7-day rotation (driven by the automations sweep — no
// new cron mechanism), plus an on-demand download endpoint that is the true
// offsite path (owner pulls a fresh copy to his PC/OneDrive).
//
// Snapshots use `VACUUM INTO ?` — a single statement that writes a
// consistent, defragmented copy even mid-traffic under WAL (supported by the
// bundled SQLite in better-sqlite3 12.x). See RESTORE.md for the swap-back.

const backupsDir = path.join(dataDir, "backups");
const dbPath = path.join(dataDir, "inventory.db");
const HOUR_MS = 60 * 60 * 1000;
const SNAP_RE = /^cjm-\d{4}-\d{2}-\d{2}\.db\.gz$/;
const KEEP = 7;

// Local calendar date, same as automations.ts (copied, not imported — this
// module stays a leaf so automations.ts can import it without a cycle).
function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Consistent snapshot → gzip bytes. Shared by the nightly job and the
// download endpoint (which always serves a fresh copy, never the nightly).
// ponytail: whole-DB buffer in memory — stream via spawn/pipeline if the DB
// ever outgrows a few hundred MB.
function snapshotGz(): Buffer {
  fs.mkdirSync(backupsDir, { recursive: true });
  const tmp = path.join(backupsDir, `.snap-${process.pid}-${Date.now()}.db`);
  try {
    sqlite.prepare("VACUUM INTO ?").run(tmp);
    return zlib.gzipSync(fs.readFileSync(tmp));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Newest rotated snapshot on disk, or null before the first nightly run. */
export function latestSnapshot(): { file: string; mtimeMs: number; bytes: number } | null {
  let names: string[];
  try {
    names = fs.readdirSync(backupsDir).filter((f) => SNAP_RE.test(f)).sort();
  } catch {
    return null; // backups/ not created yet
  }
  const name = names[names.length - 1];
  if (!name) return null;
  const file = path.join(backupsDir, name);
  const st = fs.statSync(file);
  return { file, mtimeMs: st.mtimeMs, bytes: st.size };
}

/**
 * Nightly snapshot with rotation, called from every hourly sweep tick: no-op
 * unless the newest snapshot is >20h old (so it fires about once a day,
 * whatever hour the process happened to boot). Keeps the KEEP newest .db.gz,
 * deletes the rest. Throws are the caller's problem — automations.ts wraps
 * every step in its own try/catch.
 */
export function maybeNightlyBackup(now = Date.now()): boolean {
  const latest = latestSnapshot();
  if (latest && now - latest.mtimeMs < 20 * HOUR_MS) return false;
  const file = path.join(backupsDir, `cjm-${localDate(now)}.db.gz`);
  fs.writeFileSync(file, snapshotGz());
  const names = fs.readdirSync(backupsDir).filter((f) => SNAP_RE.test(f)).sort();
  for (const old of names.slice(0, -KEEP)) {
    fs.rmSync(path.join(backupsDir, old), { force: true });
  }
  console.log(`[backup] nightly snapshot ${path.basename(file)} written`);
  return true;
}

// ─── Admin endpoints ─────────────────────────────────────────────────────────
// Technician-only, like PUT /api/settings — the highest role in the suite.
// The client must fetch with the x-auth header and trigger a blob download
// (settings.tsx); a plain browser navigation can't authenticate.

export function registerBackupRoutes(app: Express): void {
  // Fresh gzipped snapshot, made on demand — the real offsite path.
  app.get("/api/admin/backup", requireTechnician, (req, res) => {
    let gz: Buffer;
    try {
      gz = snapshotGz();
    } catch (e) {
      console.error("[backup] on-demand snapshot failed", e);
      res.status(500).json({ message: "Backup failed" });
      return;
    }
    audit(req, "backup_download", { details: { bytes: gz.length } });
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="cjm-${localDate(Date.now())}.db.gz"`,
    );
    res.send(gz);
  });

  // DB size + last nightly snapshot time, for the settings card. Size counts
  // the -wal file too — under WAL, recent writes live there until checkpoint.
  app.get("/api/admin/backup/status", requireTechnician, (_req, res) => {
    let dbBytes = 0;
    for (const f of [dbPath, `${dbPath}-wal`]) {
      try {
        dbBytes += fs.statSync(f).size;
      } catch { /* fresh install / already checkpointed */ }
    }
    const snap = latestSnapshot();
    res.json({
      dbBytes,
      lastSnapshotAt: snap ? Math.round(snap.mtimeMs) : null,
      lastSnapshotBytes: snap?.bytes ?? null,
    });
  });
}
