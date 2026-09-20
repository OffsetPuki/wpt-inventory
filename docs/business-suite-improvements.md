# Business Suite improvements — September 20, 2026

## Delivered

- Shared business selection, business-specific quoting rates and identity, and clearer Customers / Jobs / Money / Marketing navigation.
- A business report linked from Today, with date and business filters and links to the actual payment, expense and outstanding invoice records. Cash difference is explicitly not profit.
- Focused Design and Price steps, standard starting packages, private job-cost/margin checks, one primary next action, mobile Save Quote, and product zoom/fit controls.
- Quote comparison for every product type, preserving customer/business context, plus a private customer project page connecting shared quotes, previews and related invoices.
- Preview source tracking, outdated indicators, refresh from the quote, and staged model replacement with explicit publication. Customer approval identifies the published design version. Merging preserves customer/job links.
- Version-checked shared rate edits, verified document totals before issuing, pretax job revenue, and versioned minimum-charge calculations that preserve older quotes.
- Recoverable loading errors, reopened-task notifications, expanded live updates, restricted finance/HR access, and protection against silently promoting existing users.
- Owner-reviewed, dated hourly overtime and labor burden rules. Historical closed payroll remains unchanged; payroll exports are gross calculations, not tax filing or net-pay processing.

## Verification

The complete API regression suite passed. All 40 browser checks passed across the full run and the targeted rerun after adapting old tests to the new Design → Price → Review flow. Final focused calculation/mobile checks, TypeScript, production build and dependency checks are recorded with release evidence outside this repository.

A current Cloudflare R2 backup was downloaded, verified and restored privately. The production build started against a copy with outbound calls blocked; database integrity, record counts and payment rows were preserved. Production data was not changed by these checks.

## Owner review / practical limits

- Configure and approve actual overtime and employer burden rules before activating them. No payroll policy was activated automatically.
- The restored data flags one job/billing linkage and one invoice/customer conflict for owner review. No financial or customer record was guessed or repaired automatically.
- Automated email, payment and provider tests use controlled mocks. No real customer message, charge or bank transaction was performed.
- Phone checks use browser emulation, not a physical iPhone. Continued user testing and real provider verification remain necessary; this release does not claim every possible workflow is flawless.
- Preserve the unrelated untracked drizzle directory. The recorded prior deployment and backup are the rollback references.
