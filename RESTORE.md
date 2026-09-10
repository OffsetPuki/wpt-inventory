# Backups and recovery

The suite now creates `cjm-full-<timestamp>.tar.gz` archives with a consistent SQLite snapshot, uploaded photos/documents, and a SHA-256 manifest. It keeps 14 completed archives in `<DATA_DIR>/backups`. Download one in **Settings → Download backup**. The app stages the files before compression so a later edit cannot change a file while it is being archived.

A local archive shares the Railway volume's failure risk. Configure an independent destination and verify **Settings → Last verified automatic offsite copy**. A successful email notification alone does not establish an independent backup.

## Independent storage

Set secrets in Railway variables, never in Git. Cloudflare R2 is the selected destination. The owner activated R2; private bucket `cjm-suite-backups` has a 30-day expiration rule for the `cjm-backups/` prefix. Credentials belong in Railway variables.

For AWS S3 or Cloudflare R2:

| Variable | Meaning |
|---|---|
| `BACKUP_S3_BUCKET` | Private bucket name; enables the S3 adapter |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Credentials restricted to this bucket/prefix, with PutObject and GetObject |
| `BACKUP_S3_REGION` | AWS region; defaults to `auto` for a custom endpoint |
| `BACKUP_S3_ENDPOINT` | HTTPS R2/S3-compatible endpoint; omit for AWS S3 |
| `BACKUP_S3_PREFIX` | Object prefix, default `cjm-backups` |

The adapter uploads the archive, downloads its actual bytes, and verifies the hash before recording success. Configure bucket lifecycle retention separately (for example 30 daily copies), private access, and encryption in the provider. Local retention does not delete offsite objects. Archives contain customer records and authentication material; access must be limited accordingly.

Alternatively, set `BACKUP_UPLOAD_URL` and optional `BACKUP_UPLOAD_TOKEN` for an existing HTTPS endpoint. The suite sends PUT with `X-Backup-Filename`, `X-Checksum-Sha256`, and a gzip body. The endpoint must persist and hash the received bytes, then return success with the matching `X-Checksum-Sha256` response header. It must not merely echo the request header. S3 takes priority if both adapters are configured.

The hourly automation loop creates a snapshot when the newest is at least 20 hours old, retries an unverified offsite copy, and surfaces failures. Allow disk space for the live data, staged snapshot, compressed archive and retained copies. The app requires **one process/replica writing the SQLite volume**. Monitor snapshot duration and storage as uploads grow.

## Restore drill (does not touch the live service)

Use Node 22.12 or newer and this repository's installed dependencies. Restore only into a NEW directory:

```sh
node scripts/restore-backup.mjs /path/cjm-full-TIMESTAMP.tar.gz --to /path/new-recovery-folder
node scripts/reconcile-records.mjs /path/new-recovery-folder/inventory.db > reconciliation.json
```

The restore command rejects existing destinations, unsafe paths/links, duplicate entries, archives over 10 GB, missing manifests, changed checksums and failed SQLite integrity checks. On success the destination contains `inventory.db` and `uploads/`. A failed restore can leave an incomplete destination for inspection; use a different new directory when retrying. Do not start the app against it until restore succeeds. Review the reconciliation report before changing existing business records.

Before replacing production: record the backup time and expected data loss since then, stop the suite completely, preserve the current volume as the rollback copy, and restore into a separate volume/directory. Point `DATA_DIR` at the successfully restored location, start one process, and verify representative invoices, payments, payroll and attachments. Do not copy over a running SQLite database or reuse stale WAL/SHM files. Switching production data requires the owner's explicit recovery approval.

Legacy `.db.gz` archives contain only SQLite. Recover uploads independently; the new restore command intentionally requires a full archive. Migrating to the new format does not delete legacy backups.

## Verification recorded for this release

Synthetic restore tests recover a paid invoice and its actual uploaded photo, verify file hashes and SQLite integrity, reject overwriting an existing directory, and reject a tampered upload. On September 9, 2026, real bucket-scoped R2 credentials and 30-day retention were configured. The application adapter uploaded and read back a 112.6 MB current production archive; a separate download restored the database plus all 146 uploads with valid hashes and SQLite integrity. Read-only reconciliation found no payment, stock or quote-handoff anomalies.
