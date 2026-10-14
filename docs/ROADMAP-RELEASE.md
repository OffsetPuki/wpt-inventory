# Business Suite roadmap release

Approved scope: `approved-roadmap-2026-10-13.json` (64 items). Item-level evidence belongs in `roadmap-progress.json`. This document is an operating checklist, not a declaration that the release is complete.

The user requires the whole approved scope to be ready before production deployment. On October 14 the user waived waiting for plant measurements (“dont worry about that”). Unmeasured film-table parts remain reference-only and incomplete for manufacturing; the waiver is not a source of dimensions or tolerances. Physical phone verification remains separate from browser emulation.

## Event ownership and dependent records

| Event | Authoritative record / write owner | Connected effects and checks |
| --- | --- | --- |
| Website request | Intake transaction and stable request identity | Private attachments, lead, attribution and frozen mail references; `check-intake-reliability.mjs` covers all four sites and replay. |
| Quote accepted | Quote acceptance handler / accepted revision | Job and invoice linked by IDs, staff attribution retained, repeated acceptance creates no second effect; quote-policy, manual-quotes-jobs and lead-quote-close checks. |
| Customer combined | Reviewed customer-merge transaction | Registered customer references, explicit company contacts, quote identity and design history move together. Issued document snapshots remain historical. Reference-registry coverage fails when a new customer column is omitted. |
| Job planned or confirmed | Versioned job plan | Customer/quote/billing review, dates, crew, deposits and documents; payment and planning views use shared deposit rules. Harmless settings do not require a new exception. |
| Invoice issued / payment corrected | Finance transaction, payment ledger and stored invoice version | Remaining contract billing, receivable, readiness and cash reports; drafts and void invoices are not issued obligations. Paid invoices are preserved. A stale final bill is rejected. |
| Material received / consumed / returned | Inventory receipt/movement identity and cost ledger | Stock, reservations, job material cost and remaining supplier commitment; partial deliveries and replay covered by purchase-order and suite-connection checks. |
| Time approved / corrected | Employee time approval and dated correction records | Eligible payroll, job costs and billing; only approved hours enter payroll. Closed periods keep history. |
| File uploaded | Private attachment transaction and request identity | Job file plus audit reference commit once; lost responses can retry the same bytes and metadata. Employee access is checked before and during attachment. |
| Design reviewed / measured | Design revision and immutable history | Explicit job/customer/quote context, source measurement log and offline reference pack. Layout review is neither customer approval nor fabrication approval. |
| Website improvement recorded | Improvement task, immutable baseline and versioned change details | Source page/site/campaign attribution, equal-period comparison and task notes; no automatic publishing or causal claim. |
| Email submitted | Frozen outbox message and delivery identity | Original recipient, document version and attachments retained. Provider acceptance is not proof of inbox delivery. Uncertain delivery is held for review. |
| Job completed | Job completion review | Internal handover, feedback and portfolio checklist. Public media and customer communication still require their explicit actions. |

Database revision topics invalidate affected client cache prefixes. CRM, jobs and finance refresh connected-record summaries; quote changes refresh design/forecast reviews; stock receipts refresh remaining commitments; marketing changes refresh saved improvement work. Employee counters expose no finance payload. `suite-create-once.ts` wraps only synchronous JSON transactions; multipart uploads and workers own their separate retry identities.

## Phone performance gate

`roadmap-performance.spec.mjs` uses a cold cache, 390 × 844 viewport, 4× CPU slowdown, 1.6 Mbps download, 750 Kbps upload and 150 ms latency. It waits for usable content, not just the shell heading. These are simulated checks, not physical-device results.

| Page | Usable content ceiling | Used JS heap ceiling |
| --- | ---: | ---: |
| Today, Jobs, Customer search | 6 seconds | 96 MB |
| Job files | 8 seconds | 96 MB |
| Marketing graphs, Film 2D fallback | 10 seconds | 160 MB |

Each page has a 1.5 MB cold-transfer ceiling. Customer/page-search interaction and opening help during a pending upload have a 250 ms response ceiling. Reports include measured values and are retained with browser artifacts. Initial measured usable times were 2.66–4.03 seconds; final measurements must come from the release commit. Heavy 3D is optional and a usable 2D reference remains available without WebGL.

`roadmap-phone.spec.mjs` covers every navigation page at 360, 390 and 430 pixels, landscape, enlarged text, file retry, record links, design history and cost plans. Physical iPhone/Android checks must include the on-screen keyboard, file picker/camera, saved drafts, clock action, job file download and model fallback.

## Required release evidence

1. Finish each roadmap acceptance criterion and record evidence. Unavailable provider data must stay explicitly unavailable; do not claim external account configuration was repaired by a UI change.
2. Commit the finished code. Run type check, complete build, API, browser, security, restore and performance checks against that exact commit. A changed file invalidates final release evidence.
3. Record the SHA and successful commands in the ignored `roadmap-release-evidence.json`. The release gate also requires a clean working tree, all 64 items complete and applicable physical verification. Run `npm run release:check` before production deployment.
4. Create and verify a current production backup. Record its timestamp, checksum and private storage location outside Git. Restore into a new directory, never over the live data directory. Verify SQLite integrity, linked records, private uploads, frozen mail attachments and new roadmap tables. A failed checksum or restore blocks release.
5. Record the current production deployment ID and release SHA before switching versions. The starting reference for this work was `791960d51f92ec1745d41822bbb44df9df5d022a`; confirm the actual current release before deployment.
6. Deploy the tested commit, then check authenticated release status, navigation, job/customer links and read-only public document states. Do not send customer email, charge money or alter business records as a deployment smoke test.

## Rollback and compatibility

New roadmap tables and columns are additive. Keep production uploads and the database volume intact during an application rollback. Roll back the application to the recorded prior successful deployment first; do not automatically replace its database with an older backup, which would discard transactions made after that backup.

If database recovery is necessary, stop workers and writes, preserve the current database/uploads/mail attachments, restore the verified snapshot into a new location, and reconcile later transactions before cutover. Retain outbox uncertainty holds so restart cannot resend an old financial message. The restore checker rejects path traversal, links, duplicate entries, unsafe archives and checksum failures.

The full repository is part of the runtime package: design catalog revisions use the plant model source and stored model metadata. A deployment containing only `dist/` is insufficient until those references are packaged separately. Never delete a model file merely because it is not imported by the client bundle.

The offline `field-book.html` and its size metadata are generated by every build and tested before release. They remain in the runtime image but are excluded from Git to avoid duplicating the reproducible 2 MB bundle in source history. The source drawings, catalog, generator and entry point stay tracked.

No production deployment has been performed by creating this checklist. The prior September verification notes in other documents do not certify this roadmap revision.
