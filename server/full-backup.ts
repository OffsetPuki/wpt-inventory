import type { Express } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { create } from "tar";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { sqlite, dataDir } from "./storage";
import { requireElevated } from "./auth";
import { auditQuiet as audit } from "./audit";

const backupsDir = path.join(dataDir, "backups");
const SNAP_RE = /^cjm-full-[\dTZ-]+\.tar\.gz$/;
async function hash(file: string) {
  const digest = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
let building: Promise<{ file: string; bytes: number }> | null = null;
let lastOffsiteError: string | null = null;
let lastOffsiteAt: number | null = null;
const statusFile = path.join(backupsDir, "offsite-status.json");
try {
  lastOffsiteAt =
    JSON.parse(fs.readFileSync(statusFile, "utf8")).lastOffsiteAt ?? null;
} catch {}

function uploadedFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? uploadedFiles(file)
      : entry.isFile()
        ? [path.relative(dataDir, file).replace(/\\/g, "/")]
        : [];
  });
}
export function latestSnapshot(): {
  file: string;
  mtimeMs: number;
  bytes: number;
} | null {
  if (!fs.existsSync(backupsDir)) return null;
  const name = fs
    .readdirSync(backupsDir)
    .filter((name) => SNAP_RE.test(name))
    .sort()
    .at(-1);
  if (!name) return null;
  const file = path.join(backupsDir, name);
  const stat = fs.statSync(file);
  return { file, mtimeMs: stat.mtimeMs, bytes: stat.size };
}
export function createFullBackup(): Promise<{ file: string; bytes: number }> {
  if (building) return building;
  building = (async () => {
    fs.mkdirSync(backupsDir, { recursive: true });
    const id = crypto.randomUUID();
    const database = `snapshot-${id}.db`;
    const manifest = `manifest-${id}.json`;
    const stage = path.join(backupsDir, `staging-${id}`);
    fs.mkdirSync(stage);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(backupsDir, `cjm-full-${stamp}.tar.gz`);
    const partial = file + ".partial";
    try {
      sqlite.prepare("VACUUM INTO ?").run(path.join(stage, database));
      const uploads = [...uploadedFiles(path.join(dataDir, "uploads")),...uploadedFiles(path.join(dataDir,"mail-attachments"))];
      // Freeze uploaded files before yielding. This process is the sole writer
      // to the Railway SQLite volume, so edits cannot race the snapshot copy.
      for (const name of uploads) {
        const target = path.join(stage, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(dataDir, name), target);
      }
      const uploadManifest = [];
      for (const name of uploads)
        uploadManifest.push({
          path: name,
          sha256: await hash(path.join(stage, name)),
          bytes: fs.statSync(path.join(stage, name)).size,
        });
      fs.writeFileSync(
        path.join(stage, manifest),
        JSON.stringify(
          {
            format: "cjm-full-v1",
            createdAt: new Date().toISOString(),
            database,
            databaseSha256: await hash(path.join(stage, database)),
            uploads: uploadManifest,
          },
          null,
          2,
        ),
      );
      await create(
        { cwd: stage, file: partial, gzip: true, portable: true, strict: true },
        [database, manifest, ...uploads],
      );
      fs.renameSync(partial, file);
      const old = fs
        .readdirSync(backupsDir)
        .filter((name) => SNAP_RE.test(name))
        .sort()
        .slice(0, -14);
      for (const name of old) fs.unlinkSync(path.join(backupsDir, name));
      return { file, bytes: fs.statSync(file).size };
    } finally {
      const resolvedStage = path.resolve(stage);
      if (
        path.dirname(resolvedStage) === path.resolve(backupsDir) &&
        /^staging-[a-f0-9-]+$/.test(path.basename(resolvedStage))
      )
        fs.rmSync(resolvedStage, { recursive: true, force: true });
      try {
        fs.unlinkSync(partial);
      } catch {}
    }
  })().finally(() => {
    building = null;
  });
  return building;
}
const offsiteConfigured = () =>
  !!(process.env.BACKUP_S3_BUCKET || process.env.BACKUP_UPLOAD_URL);
export async function uploadOffsite(file: string) {
  if (process.env.BACKUP_S3_BUCKET) {
    const endpoint = process.env.BACKUP_S3_ENDPOINT;
    if (endpoint && new URL(endpoint).protocol !== "https:")
      throw new Error("Backup storage must use HTTPS.");
    if (
      !process.env.BACKUP_S3_ACCESS_KEY_ID ||
      !process.env.BACKUP_S3_SECRET_ACCESS_KEY
    )
      throw new Error(
        "Set the backup storage access key and secret in Railway.",
      );
    const client = new S3Client({
      endpoint,
      region: process.env.BACKUP_S3_REGION || (endpoint ? "auto" : "us-east-1"),
      credentials: {
        accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 3,
    });
    const Bucket = process.env.BACKUP_S3_BUCKET;
    const Key =
      (process.env.BACKUP_S3_PREFIX || "cjm-backups").replace(
        /^\/+|\/+$/g,
        "",
      ) +
      "/" +
      path.basename(file);
    const checksum = await hash(file);
    const abortSignal = AbortSignal.timeout(120_000);
    try {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: fs.createReadStream(file),
          ContentLength: fs.statSync(file).size,
          ContentType: "application/gzip",
          Metadata: { sha256: checksum },
        }),
        { abortSignal },
      );
      // Read the object back and hash its actual bytes. A successful upload or
      // metadata echo alone is not a verified independent backup.
      const downloaded = await client.send(
        new GetObjectCommand({ Bucket, Key }),
        { abortSignal },
      );
      if (!downloaded.Body)
        throw new Error("Backup storage returned no object.");
      const remoteHash = crypto.createHash("sha256");
      for await (const chunk of downloaded.Body as AsyncIterable<Uint8Array>)
        remoteHash.update(chunk);
      if (remoteHash.digest("hex") !== checksum)
        throw new Error("Offsite backup checksum verification failed.");
      lastOffsiteAt = Date.now();
      lastOffsiteError = null;
      fs.writeFileSync(
        statusFile,
        JSON.stringify({
          lastOffsiteAt,
          filename: path.basename(file),
          checksum,
        }),
      );
      return true;
    } finally {
      client.destroy();
    }
  }
  const destination = process.env.BACKUP_UPLOAD_URL;
  if (!destination) return false;
  const url = new URL(destination);
  if (url.protocol !== "https:")
    throw new Error("Offsite backup destination must use HTTPS.");
  const checksum = await hash(file);
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/gzip",
      "X-Backup-Filename": path.basename(file),
      "X-Checksum-Sha256": checksum,
      ...(process.env.BACKUP_UPLOAD_TOKEN
        ? { Authorization: `Bearer ${process.env.BACKUP_UPLOAD_TOKEN}` }
        : {}),
    },
    body: fs.createReadStream(file) as any,
    duplex: "half",
    signal: AbortSignal.timeout(120_000),
  } as RequestInit);
  if (!response.ok || response.headers.get("x-checksum-sha256") !== checksum)
    throw new Error("Offsite destination did not confirm the backup checksum.");
  lastOffsiteAt = Date.now();
  lastOffsiteError = null;
  fs.writeFileSync(
    statusFile,
    JSON.stringify({ lastOffsiteAt, filename: path.basename(file), checksum }),
  );
  return true;
}
export async function maybeNightlyBackup(now = Date.now()): Promise<boolean> {
  const latest = latestSnapshot();
  const snapshot =
    latest && latest.mtimeMs > now - 20 * 60 * 60 * 1000
      ? latest
      : await createFullBackup();
  if (
    offsiteConfigured() &&
    (!lastOffsiteAt || lastOffsiteAt < now - 20 * 60 * 60 * 1000)
  ) {
    try {
      await uploadOffsite(snapshot.file);
    } catch (error: any) {
      lastOffsiteError = error.message;
      throw error;
    }
  }
  return snapshot !== latest;
}
export function registerBackupRoutes(app: Express) {
  app.get("/api/admin/backup", requireElevated, async (req, res) => {
    try {
      const snapshot = await createFullBackup();
      audit(req, "backup_download", {
        details: { bytes: snapshot.bytes, format: "database-and-uploads" },
      });
      res.setHeader("Cache-Control", "no-store");
      res.download(snapshot.file, path.basename(snapshot.file));
    } catch (error) {
      console.error("[backup] failed", error);
      res.status(500).json({ message: "Backup failed. Please retry." });
    }
  });
  app.get("/api/admin/backup/status", requireElevated, (_req, res) => {
    let dbBytes = 0;
    for (const name of ["inventory.db", "inventory.db-wal"])
      try {
        dbBytes += fs.statSync(path.join(dataDir, name)).size;
      } catch {}
    const snapshot = latestSnapshot();
    res.json({
      dbBytes,
      lastSnapshotAt: snapshot?.mtimeMs ?? null,
      lastSnapshotBytes: snapshot?.bytes ?? null,
      lastOffsiteAt,
      offsiteConfigured: offsiteConfigured(),
      lastOffsiteError,
      includesUploads: true,
      retainedSnapshots: 14,
    });
  });
}
