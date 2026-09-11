# Connected business suite

Implemented on September 10, 2026. The owner subsequently approved pushing this connected-suite release live. Release checks retain a verified offsite backup and the preceding Railway deployment IDs.

## Daily use

Start at **Today** for jobs, assigned work, messages, tools to return and time needing review. The main menu groups Customers, Jobs, Inventory and Money, with supporting pages under More.

Open a job once and work in its six tabs:

- **Overview:** customer, scope, trade, dates and the next action.
- **Work:** tasks, crew, scheduling warnings and time entries. Start work here; the running timer stays visible elsewhere.
- **Materials:** needed, reserved, ordered and missing stock. Reserve available stock or create a purchase order for shortages. Partial receipts update the linked records.
- **Money:** quoted scope, approved extras, drafts, billed amounts, collections, due balances, retainage and actual costs.
- **Files:** photos, measurements, drawings, revisions and linked paperwork. Completed jobs can publish a specifically approved photo to their own trade website.
- **Activity:** internal comments, replies, mentions and events from linked records. Owner-only notes stay restricted.

## What was implemented

| Review item | Result |
|---|---|
| 1. Accurate money and labor | Drafts separated from billed totals; dated rates, overnight allocation and corrections feed job labor. Unknown rates and opening-stock costs remain visibly incomplete. Salary allocation is marked as an estimate. |
| 2. Customer and source links | Selected customer IDs survive quoting and acceptance. Jobs carry quote/lead/trade/language/address links. Reviewed duplicate merges retain issued document snapshots. Conflicting invoice/job customers are rejected. |
| 3. Job workspace | Six focused tabs with job context carried into tasks, purchasing, expenses, invoices and time. Secondary content loads when opened. |
| 4. Search/navigation | Exact record links, balanced groups, additional matches, phone/email/address/document search, cancellation, visible errors, keyboard traversal and remembered list context/scroll. |
| 5. Daily home/menu | Today, Customers, Jobs, Inventory, Money and More; worker views use assigned work and restrict financial controls. |
| 6. Readiness | Approval, billing, deposit, dates, crew, stock, paperwork and tool checks. Confirming dates despite blockers requires an audited reason. Payment does not complete the job. |
| 7. Purchasing | Linked shortage orders, duplicate protection, partial receipts, explicit stock reservation and shared availability. |
| 8. Billing/changes | Fixed-price and time-and-materials modes; old jobs start in review. Approved extras create one reviewed draft charge. T&M pulls known stock, labor and expenses into a draft; source stamps prevent repeat billing. Void releases sources. Linked invoice lines cannot be silently removed/rebilled. |
| 9. Scheduling | Visible date-range queries, job readiness, task/crew overlap, approved leave, shared tools and tentative/confirmed dates. |
| 10. Time | Job/task agreement checks, one running timer, missing-job/long-running review and dated cost allocation. Closed payroll snapshots remain intact. |
| 11. Communication | Internal job comments, replies, attachments, mentions, assignment notifications and a personal read/snooze/resolve inbox. |
| 12. Live updates | Authenticated revision stream; targeted cache refresh, reconnect handling, protected drafts and version conflicts on important records. |
| 13. Reliable follow-ups | Durable email payloads and work queue, stable delivery keys, retries and owner controls. Obsolete reminders stop. Provider acceptance is distinguished from inbox delivery. |
| 14. Shared files/publishing | Shared photo references, thumbnails, current/older revisions, existing document/contract tools and explicit completed-work publishing by trade. Sister-site galleries refresh through a cached runtime feed. |
| 15. Material costs | FIFO receipt layers and exact-cost returns, received-cost proposals with reviewed unit conversion, and exclusion of stocked purchases from job expenses when consumption is costed separately. |
| 16. Loading performance | 50-row client/lead/invoice/expense lists, 12-row searchable invoice/job pickers, bounded activity history, visible calendar range, lazy tabs and thumbnails. Local measurements recorded separately. |
| 17. Forms/edit safety | Job context, account-scoped recovery, prompt persistence of edits, retry identities for important creates/payments, useful conflict messages and shared Retry sections. |
| 18. Owner controls | Intake activity, mail configuration/failures, queued follow-ups, payment exceptions, record review, cost proposals, backup freshness and recorded restore evidence. |

## Decisions and limits

- Existing jobs need an explicit billing classification. Historical customer links, imported opening pay rates and stock with unknown purchase provenance are never invented. Run `node scripts/reconcile-records.mjs PATH_TO_RESTORED_DATABASE` against a restored backup to review them.
- Won contract value in CRM stays distinct from collected cash. Collections are derived from the invoice/payment ledger.
- T&M charges use the existing owner-configured labor/expense markups. Review the unbilled amount and draft before sending. Unknown source costs block an automatic pull. A stock return can create a credit against other draft lines; a total below zero is rejected.
- Price-book approvals affect future estimates; saved quote price snapshots remain unchanged.
- Confirmed dates can develop new conflicts when crew, leave, materials or tools change. The app shows updated warnings; it does not silently move the appointment.
- Existing owner/worker permissions remain in place. This adds server checks for the new features; it does not invent new employee permission assignments.
- Files and comments are internal unless a photo is explicitly approved for public publishing. External inbound email replies and SMS are outside this implementation. Reusable quote templates remain excluded as previously requested.
- Restore evidence is clearly marked as owner-recorded. Local synthetic restore tests are separate from evidence of a production offsite restore.
- The mail worker retries up to eight times. An uncertain send older than 23 hours requires provider-history review before another send, because the provider's idempotency window is limited. Completed delivery work means provider-accepted, not delivered.
- The runtime requires the existing persistent single-process SQLite deployment. Verify the authenticated update stream through Railway during release checks.

## Validation and release

The test fixture uses isolated temporary databases and blocks real external requests. Added checks cover linked jobs across trades, payment/customer retries, stock consumption/returns, stale writes, private notes, approved publishing, restored queued-mail attachments and delivery uncertainty. Browser checks cover mobile workflows and two simultaneous sessions.

See the audit folder for final logs, local measurements and mobile/desktop screenshots. Sister-site type checks use their existing diagnostic baselines; no baseline was loosened.

For deployment: retain a verified backup, review the read-only historical-record report, deploy the suite and the three sister-site gallery changes together, and verify authenticated live updates and correct-trade photo feeds on Railway. The release preparation restored the latest R2 archive and verified startup against an isolated copy with outbound requests blocked. Record counts and payment rows were preserved. One existing job needs link/billing review and one invoice has a customer-link conflict; these require owner review, not automatic repair. No credentials, customer messages or public photos were changed by this implementation.
