# Business Suite consistency and recovery

The October 2026 audit corrections keep the existing job workspace as the main place to run work.

## Daily use

- Today prioritizes jobs, tasks and money to collect. Other workspaces and follow-ups are collapsible.
- Select a business to scope jobs, tasks, time, finance totals, invoices, expenses, purchase orders and schedule. Customers, employees and shared resources remain available across businesses and are labeled accordingly.
- Explicit links, including Money to collect, override remembered filters. List controls display the active scope and allow clearing filters.
- Use the job workspace for customer/quote context, hours, materials, billing and files. Customer-request photos and related design previews are referenced from their existing sources. Private team files and shared previews have separate visibility labels.
- Search selectors find older jobs and customers without downloading their full records. List pages have continuation controls; time and expense totals cover every matching record, not just the visible page.

## Corrections preserve history

- A billed expense cannot silently change jobs, amount, billable state or be deleted. Review correction records the cost change and customer adjustment separately. The user must supply a reason and acknowledge both amounts.
- An unpaid draft can receive an explicit adjustment line. An issued or paid invoice is preserved; a positive adjustment can create a separate draft. A negative adjustment needs an unpaid draft for the same job/customer with sufficient charges. This is not a refund or standalone credit-note workflow.
- Void/remove a separate adjustment before voiding/deleting its original invoice. This prevents releasing an already adjusted expense for duplicate billing. A correction’s cost and invoice links remain in its audit history.
- Tasks with recorded or running time cannot move between jobs. Copy to another job starts a new task while keeping the original hours and history.
- Customer merges include every registered customer reference, including design previews; a changed merge review must be refreshed.
- Time-entry validation checks both supplied minutes and the final timestamp interval, limited to one day. Split multi-day work into daily entries. Task dates must be valid and ordered.

## Recovery and updates

Temporary session-verification failures retain the session token and local drafts but block workspace content until Retry succeeds. A confirmed invalid session still signs out. The status bar distinguishes saving, failed saves, offline state and live connectivity.

Revision topics drive shared updates, including crew changes. The client coalesces local invalidations and recognizes its own server revision to reduce duplicate reads. Team revision counters contain no employee or financial payload; finance counters remain restricted. Report views share equivalent cache keys, refresh at the date boundary and retain a five-minute fallback.

## Verification

`npm run check` enforces unused declarations/parameters. `npm test` includes the cross-module audit regression, customer-reference registry coverage, paid/void corrections, retry behavior, task/time history, business isolation and optimized readiness equivalence with stock and crew conflicts. `npm run test:browser` covers connection recovery, remembered filter precedence, two-session updates and phone layouts alongside the existing workflows. Renderer checks exercise the active preview adapters rather than deleted legacy renderers.

Synthetic measurements with 100 jobs reduced schedule statement preparations from 707 to 20 and Today from 93 to 22. These are local fixture measurements, not production latency promises.
