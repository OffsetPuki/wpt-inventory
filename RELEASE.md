# Release preparation — September 2026 audit

The owner approved the live release on September 9, 2026. GitHub pushes trigger Railway. Preserve the verified pre-release backup and recorded deployment IDs when releasing or rolling back.

## Application behavior to review

- Each website acknowledges an inquiry only after the CRM or configured fallback confirms persistence. Failed submissions retain fields and show retry guidance. Up to three 1 MB JPG/PNG/WebP photos attach to the lead. Notes and design specifications have separate 4,000-character limits.
- A lead is one job. Quotes link explicitly to it. Marking it won uses the selected quote and creates/reuses the job and draft invoice atomically. Separate jobs for the same contact remain independent.
- Issued quotes are preserved. Use **Revise** for an unaccepted offer; an accepted job uses a project change order. A new job can start with **Duplicate**. Conflicting saves require reopening the current draft.
- Payment writes and invoice totals commit together. Compatible Stripe checkouts are reused; obsolete pages expire. Bank payments that are processing block competing checkout. Refunds, disputes, overpayments and unmatched payments appear in Finance for owner review; recording an exception does not automatically issue a refund or change a disputed balance.
- **Deactivate access** retains history and revokes sessions. HR termination also blocks access. Owners must replace legacy PINs with a password and authenticator on first use after deployment. Save the one-use recovery codes privately. Sessions expire after 12 hours; the last owner cannot be deactivated. Workers retain PIN sign-in.
- Pay changes require an effective date. Closing payroll preserves the period and books the expense once. Billed/closed time cannot be edited or erased; owner corrections appear in an open period with a reason. Existing past pay rates cannot be reconstructed from information the old system never stored; verify opening rates against prior payroll records.
- Job uploads require login; explicitly published portfolio photos and the logo remain public. Shared quote/invoice attachments continue through their existing token-scoped website proxy. Existing published portfolio rows retain their status; new photos default to private. Only publish actual approved project photos.
- Dashboard failures have Retry; direct links open the selected record; drafts belong to the signed-in user; dialogs trap focus and warn before discarding changes. Customer language follows known leads/clients and editable preferences.

## Required production configuration and staging checks

1. Confirm Railway deployed commits, persistent `/data` volume, **one process/replica**, Node 22.12+, health checks and rollback release. CI runs types, builds, tests, browser checks and dependency audits; configure branch/deployment rules so failed checks prevent release. The workflow files alone cannot change Railway's deployment policy.
2. Each site needs `SUITE_BASE_URL` and `SUITE_LEAD_KEY`, matching the suite's `LEAD_INTAKE_KEY`. Validate optional `LEADS_WEBHOOK_URL` / `LEADS_WEBHOOK_SECRET` fallback persistence and photo handling. Test inquiry success and CRM/fallback outages with test contacts. No real customer inquiries were submitted during implementation.
3. Verify the suite's existing outbound email provider/from-address settings. Test English and Spanish confirmation, quote, invoice and receipt delivery to owner-controlled test addresses. Set `PUBLIC_SITE_URL` to the public Metals site, which hosts the shared quote/invoice pages for all trades; the suite remains FLIPNOB.
4. In Stripe test mode verify `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and subscriptions to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`. Then check payment, delayed payment, changed invoice, refund and dispute behavior. Local automated tests mock Stripe and validate signed events; the real dashboard was not changed.
5. Select/configure the independent backup provider, verify retention, complete an offsite upload/download and restore. See **RESTORE.md**. Local full-archive restore passed; remote credentials are not configured.
6. Download a current production backup, restore it to an isolated directory, and run `scripts/reconcile-records.mjs`. Review accepted quotes missing handoffs, payment/ledger differences, duplicate references, negative stock and historical payroll. This report makes no repairs. Do not infer that synthetic reproductions mean actual records were affected.
7. Review the estimator wording and calculations with the trade owner. The insulation temperature is an estimate to verify for the installation. Retain existing credited imagery until approved completed-work photos are available.

## Checks

`npm run check`, `npm run build`, `npm test`, `npm run test:browser`, `npm audit`. Tests use disposable local databases and block external delivery. The websites also preserve their existing calculation tests. Website `check` rejects new diagnostics against an audited original-source baseline; it does not claim the older inline configurators are fully typed. Reduce that baseline as legacy code is improved.

Browser evidence and measured first-load resources are written to `test-results/` and uploaded by CI. These are local measurements, not field Core Web Vitals. The suite's PDF and quote code remains deferred by route; no speculative dashboard aggregation or architecture migration is required by the current measurements.

## Production verification before this release

- All five deployed commits matched the audited original source revisions.
- FLIPNOB runs Node 22.23.2 with one replica and a persistent `/data` volume (5 GB capacity).
- The four website intake keys match FLIPNOB; the public shared-page host is configured correctly.
- A current online production snapshot was downloaded, checksum verified, and restored with all 146 uploaded files. Read-only reconciliation found zero payment-total mismatches, duplicate payment references, negative-stock rows, or accepted quotes missing handoffs. No employee payroll records were present. No business-record repairs were applied.
- Cloudflare R2 was activated by the owner. The private `cjm-suite-backups` bucket has a 30-day lifecycle rule for `cjm-backups/`. Bucket-scoped credentials are saved in Railway. The actual application adapter uploaded and downloaded the current 112.6 MB production archive; an independent R2 download restored all 146 uploads and passed reconciliation.
- Production has a live Stripe key; real test-mode event verification requires separate test credentials.
- Railway now waits for GitHub checks on all five production branches. The new suite also started successfully against a disposable production-data copy with SQLite integrity intact and outbound requests blocked.
