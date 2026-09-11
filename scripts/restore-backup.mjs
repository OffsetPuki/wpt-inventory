// Restores only into a NEW directory. Never touches a running/live database.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { list, extract } from "tar";
import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";

const checksum = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
export async function restoreBackup(archive, destination) {
  archive = path.resolve(archive);
  destination = path.resolve(destination);
  if (fs.existsSync(destination))
    throw new Error(
      "Restore destination must be a new, nonexistent directory.",
    );
  const allowed = (name) =>
    !name.includes("\\") &&
    !name.includes(":") &&
    !name.startsWith("/") &&
    !name.split("/").includes("..") &&
    (/^snapshot-[a-f0-9-]+\.db$/.test(name) ||
      /^manifest-[a-f0-9-]+\.json$/.test(name) ||
      /^uploads\/[\w./-]*$/.test(name) || /^mail-attachments\/[a-f0-9-]+$/.test(name));
  const entries = [];
  let bytes = 0;
  let invalid = null;
  await list({
    file: archive,
    strict: true,
    onReadEntry: (entry) => {
      if (!allowed(entry.path) || !["File", "Directory"].includes(entry.type))
        invalid = "Unexpected or unsafe archive entry.";
      bytes += entry.size;
      if (bytes > 10 * 1024 ** 3)
        invalid = "Archive exceeds the 10 GB restore limit.";
      entries.push(entry.path);
    },
  });
  if (invalid) throw new Error(invalid);
  if (new Set(entries).size !== entries.length)
    throw new Error("Duplicate archive entry.");
  if (entries.filter((n) => /^manifest-/.test(n)).length !== 1)
    throw new Error("Backup manifest missing or ambiguous.");
  fs.mkdirSync(destination, { recursive: true });
  await extract({
    file: archive,
    cwd: destination,
    strict: true,
    preservePaths: false,
    noChmod: true,
  });
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(
        destination,
        entries.find((n) => /^manifest-/.test(n)),
      ),
      "utf8",
    ),
  );
  if (
    manifest.format !== "cjm-full-v1" ||
    !allowed(manifest.database) ||
    !Array.isArray(manifest.uploads)
  )
    throw new Error("Unsupported backup format.");
  const dbFile = path.join(destination, manifest.database);
  if (checksum(dbFile) !== manifest.databaseSha256)
    throw new Error("Database checksum mismatch.");
  for (const item of manifest.uploads) {
    if (!allowed(item.path) || !/^(uploads|mail-attachments)\//.test(item.path))
      throw new Error("Unsafe manifest path.");
    const file = path.join(destination, item.path);
    if (fs.statSync(file).size !== item.bytes || checksum(file) !== item.sha256)
      throw new Error(`Upload checksum mismatch: ${item.path}`);
  }
  const db = new Database(dbFile, { readonly: true });
  try {
    if (db.pragma("integrity_check", { simple: true }) !== "ok")
      throw new Error("Database integrity check failed.");
  } finally {
    db.close();
  }
  fs.renameSync(dbFile, path.join(destination, "inventory.db"));
  return {
    destination,
    uploads: manifest.uploads.length,
    createdAt: manifest.createdAt,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [archive, flag, destination] = process.argv.slice(2);
  if (!archive || flag !== "--to" || !destination)
    throw new Error(
      "Usage: node scripts/restore-backup.mjs backup.tar.gz --to NEW_DIRECTORY",
    );
  console.log(JSON.stringify(await restoreBackup(archive, destination)));
}
