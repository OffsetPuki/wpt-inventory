# Restoring a database backup

Backups are gzipped SQLite snapshots (`cjm-YYYY-MM-DD.db.gz`) — from the
nightly rotation in `<DATA_DIR>/backups/`, the weekly backup email, or
Settings → Download backup.

## Steps

1. **Stop the server first.** The live app holds the DB open (WAL mode);
   swapping the file under it corrupts data. On Railway: scale the service
   down (or be ready to redeploy immediately after the swap).
2. Gunzip the snapshot:
   ```sh
   gunzip -k cjm-2026-07-19.db.gz        # → cjm-2026-07-19.db
   ```
   (Windows: 7-Zip extracts .gz, or `tar -xf` on the file.)
3. Replace the live DB in `DATA_DIR` (`/data` on Railway, `./data` locally):
   ```sh
   mv /data/inventory.db /data/inventory.db.bad   # keep the old one, just in case
   cp cjm-2026-07-19.db /data/inventory.db
   rm -f /data/inventory.db-wal /data/inventory.db-shm   # stale WAL files must go
   ```
4. Start / redeploy the server. It recreates WAL files and runs its additive
   migrations automatically.

## Caveats

- Everything after the snapshot's date is lost — invoices, time entries, all
  of it. Restore is a last resort, not an undo button.
- Uploaded photos live in `<DATA_DIR>/uploads/`, not in the DB. The snapshot
  does not include them.
- The snapshot is a plain SQLite file — you can open it locally with
  `sqlite3 cjm-2026-07-19.db` to check its contents before restoring.
