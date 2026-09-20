# Business Suite Marketing — deeper audit

September 19, 2026. Scope: Marketing Overview, Reviews, Portfolio, Settings, Google/Bing reporting, lead attribution and outcomes, review invitations, publishing, shared permissions and failure recovery.

**Original audit record (before implementation).** Testing used disposable databases, simulated provider failures and blocked external requests. No customers were contacted. This is a source-and-fixture audit of the current implementation, not confirmation of the live Google/Bing accounts, website feed synchronization or real customer records. It cannot prove the absence of other bugs.

## Fix first: business data and customer-facing mistakes

| ID | Finding / impact | Evidence | Recommended fix |
|---|---|---|---|
| B1 | **Concrete and Insulation customer reviews are saved as Metals.** Publishing those records can put testimonials on the wrong website. | Reproduced both trades through public review submission. `server/public-portal.ts:765` inserts without `site`, so the Metals default applies. | Resolve trade from the invitation’s linked lead/job/invoice; store trade on the invitation and review. Audit existing request-linked reviews before migrating them. Do not guess the trade of manual reviews. |
| B2 | **Paid-lead cost mixes channels.** Google-linked spend can be divided by qualified leads from Google AND Facebook. The number can look artificially inexpensive. | Reproduced $100 Google spend + one Google and one Facebook qualified lead: the report shows $50. `server/growth.ts:154–192`. | Match spend and leads by channel and period. Show combined cost only when all relevant spend is supplied; otherwise show Google-only cost and missing channels. |
| B3 | **Ad-spend draft carries across businesses/dates.** Enter a Metals amount, switch to Concrete, then Save: the old amount is stored under Concrete. | Browser and database reproduction in the first audit. `GrowthReport.tsx:80–85,175,192,221,535–549`. | Key drafts by business and date range; load the saved amount, warn about unsaved changes and show the destination clearly. |
| B4 | **Private customer-link paths escape report redaction.** `/q/customer-name-…`, `/p/customer-name-…` and `/preview/…` are retained by the report path sanitizer. | Direct reproductions of `safeGooglePage`, `server/google-reporting.ts:10`. Bing page reports reuse this helper. | Redact all private routes, including short aliases and translated variants. Clean affected cached reports if present. This demonstrates a sanitizer gap, not proof that private URLs reached production Analytics. |

## Confirmed reliability and workflow defects

| ID | Finding / impact | Evidence | Recommended fix |
|---|---|---|---|
| B5 | **Review retries create duplicates.** Two identical requests with the same retry key create two reviews. | Reproduced against `/api/marketing/reviews`; route ignores the idempotency header. `server/marketing.ts:526–550`. | Make review creation retry-safe and add a duplicate-review warning. |
| B6 | **Internal review validation accepts invalid ratings/dates.** Rating 99 and `not-a-date` were saved successfully. This can corrupt averages and published testimonials. | Reproduced. `shared/marketing-schema.ts:130`, `server/marketing.ts:529`. Public submissions correctly restrict ratings to 1–5. | Apply the same bounded integer rating, real-date and length validation to internal create/update routes. Flag existing invalid rows. |
| B7 | **Different reviews collapse into one response task.** Two three-star reviews from the same author name on different businesses produce one task. | Reproduced; deduplication uses only task title. `server/marketing.ts:205–225,548`. | Use review ID as the task identity; include trade/source and link back to the review. |
| B8 | **Mark responded leaves its automatic task open.** The review says answered while the board still says action is needed. | Reproduced. `server/marketing.ts:553–573` does not update linked tasks. | Connect review/task state, including reopening and deletion behavior. |
| B9 | **Refresh failures can be overwritten by success.** A current-period error followed by previous-period success can produce “Search reports updated.” The stored health status also loses the earlier failure. | UI failure simulation plus reporting-status reproduction. `GrowthReport.tsx:112`; `server/reporting-status.ts:3–17`. | Evaluate both result sets independently; store health by provider, business, report type AND period. |
| B10 | **Loading failures look like empty data or endless loading.** Reviews/Portfolio can show an empty state; Settings can remain on Loading. Overview alerts also silently disappear if their request fails. | Reviews/Settings reproduced with HTTP 500; Portfolio/alerts confirmed by source. `pages/marketing/index.tsx:121,230,284,358,392,550–556`. | Distinct loading, empty, stale and error states with Retry. Retain good cached data and show its timestamp. |
| B11 | **A stale Settings form overwrites another user’s changes.** A second save silently restored the old stale-lead value. | Reproduced with two snapshots and an old version header. `server/marketing.ts:451–461`; `SettingsForm` sends all settings. | Add version checks and a conflict/reload message; save only changed fields. Apply equivalent protection to Portfolio and Reviews edits. |
| B12 | **CJM Trades project pages cannot pass readiness.** The editor offers project pages, but Trades has no selectable services and readiness requires a matching service. | Readiness function reproduction. `shared/portfolio.ts:5,14`. | Support Trades service mappings or hide/disable this option with a clear explanation. |

## Code-confirmed behavior needing correction or a product decision

These were traced through the implementation; they were not exercised against real mail or provider accounts.

- **B13 — Review automation label is wrong.** Settings says “on won jobs”; creation happens when an invoice is paid (`finance.ts:342–382`). Rename it to the actual trigger, or deliberately implement a completed-job trigger. Winning a quote, finishing a job and receiving payment are different events.
- **B14 — Turning off automatic review requests does not cancel existing queued invitations.** The setting is checked at creation, but the retry and delivery conditions do not recheck it (`automations.ts:466–490`, `mailer.ts:254–273`). Decide whether the switch stops new invitations only or all unsent invitations; state that clearly and enforce it consistently.
- **B15 — Partial Analytics totals can look complete in the comparison table.** Google imports at most 10,000 traffic/spend rows. Detailed traffic shows a partial warning, but the cross-business summary drops that flag; paid-cost calculations do not surface incomplete spend. Paginate where supported or mark affected totals and avoid definitive efficiency comparisons.
- **B16 — Invalid/future reporting dates silently fall back.** The date control permits future dates while the server substitutes yesterday (`GrowthReport.tsx:189`, `growth.ts:58–79`). The selected input can disagree with the report being displayed. Limit selection to completed days and normalize or reject invalid dates visibly.

## Improvements: simpler daily use

| Area | Gap today | Better experience |
|---|---|---|
| Navigation | Switching away from Overview resets business/date; active tab is not in the URL. | One persistent business selector, saved date range, back-button support and shareable report URLs. |
| Overview | A long page mixes results, diagnostics, campaign links, staff mode and spend entry. | Start with inquiries, qualified leads, won value and spend. Follow with a short actionable list. Put provider diagnostics under Connections. |
| Reporting periods | Only rolling 28-day periods; entered spend belongs to an exact window. | This month, last month, last 28 days and custom range. Store dated spend entries and aggregate them. Never invent daily allocation from a period total. |
| Spend management | No history, campaign breakdown or remove-override control. A manual total replaces provider spend. | Date/channel/campaign ledger, visible saved values, edit history and “Use provider spend again.” |
| Campaign links | Homepage destinations only; Facebook/Instagram are tagged social, with no explicit paid-social choice. | Choose the service/project landing page; separate paid ads from organic posts; save reusable campaigns and provide a QR code when useful. |
| Reviews | No edit/delete controls, business/source/status filters, review URL or external review ID. | Searchable inbox, correction controls, duplicate detection and links to the original review. Label “Mark responded” as a tracking action, not a Google reply. |
| Portfolio | One photo per item; no ordering controls despite an order field; no search/trade/status filters. | Project albums, cover selection, before/after photos, draft/published filters and drag-to-order. |
| Services | Barndominium/shop is absent from the Metals project-service map. | Align Portfolio choices with CJM’s actual service catalog and verify each public service URL. |
| Editing | Review/project dialogs have no unsaved-change recovery; editing a published project defaults form submission to saving it privately. | Preserve drafts; make “Update published page,” “Save private draft” and “Discard” explicit. Guard accidental dismissal. |
| Recovery | Portfolio and review deletion is permanent; review mutations lack a dedicated audit trail. | Archive/restore, publication history and clear “who changed what” records. |
| Connections | Status and external dashboard links exist, but setup/reconnection is server-managed. | A guided per-business connection check with last successful fetch, last failed fetch, data coverage and next action. |
| Outcome events | Failed/uncertain/expired events appear as counts; no event detail or resolution workflow. | Show safe event metadata and errors; retry only failures known not to have been accepted. Keep uncertain deliveries protected against duplicates. |
| Search opportunities | Suggestions rank largely by impressions minus clicks and display generic guidance. | Compare against the page’s prior period; separate brand/local/service intent, show evidence and let the owner create a follow-up task. |
| Alerts | Overdue tasks appear as plain text; the report does not prioritize a concrete next action. | Clickable “Respond to review,” “Contact inquiry,” “Fix connection” and “Publish finished job” actions. |
| Mobile and scale | Many wide tables; internal review/portfolio endpoints return all rows at once. | Compact mobile cards, pagination/search, lazy image loading and larger labeled tap targets. Load tests are still needed to measure actual scale limits. |
| Accessibility | Marketing tabs lack tab/selected semantics; repeated Portfolio Edit/Delete buttons do not identify their item. | Accessible selected states, item-specific button names and keyboard/focus checks. |
| Exports | No concise owner-ready Marketing export or scheduled summary in this screen. | CSV/PDF with business/date/source definitions and an optional concise digest. Keep booked revenue separate from collected payments. |

## Permissions and publishing decisions

- `requireElevated` permits owner, manager AND technician. Marketing currently uses it for spend, settings, review publishing, portfolio deletion and financial report access. This is confirmed behavior, not evidence of an unauthorized user accessing data. Decide whether technicians should draft only and reserve publishing/settings/deletion for owners or managers.
- The job-specific publishing route enforces job trade and completion, but generic Portfolio edits do not apply the same job-link guard. Enforce consistent rules when `projectId` is present, while preserving a deliberate way to publish clearly labeled work-in-progress.
- Settings are largely company-wide. Consider per-business review links, invitation wording, follow-up timing and lead time, with clear inheritance from shared defaults.
- Public publishing should include a final destination/URL preview and a visible synchronization check. A saved database change alone does not prove every website has picked it up.

## Recommended order

1. **Data correctness:** review trade assignment, paid-cost channel matching, spend draft isolation and review validation.
2. **Trust and recovery:** retry-safe reviews, linked tasks, honest refresh/errors, private-path redaction and edit conflicts.
3. **Publishing and automation:** Trades/service mappings, explicit review triggers, queued-message behavior and permissions.
4. **Simplification:** persistent business/date filters; Overview, Campaigns, Reviews, Work and Connections; dated spend management.
5. **Polish:** mobile layouts, accessibility, exports, photo albums and better evidence-based recommendations.

## Validation and limits

The first audit reproduced four browser failures and passed the existing Marketing mobile/desktop workflow, growth and Bing checks. The deeper fixture script reproduced wrong-trade reviews (two businesses), invalid review data, duplicate retries, task collisions, stale tasks, private-route redaction gaps, overwritten provider status, impossible Trades project readiness, concurrent Settings loss and mixed-channel paid-lead cost. External requests were blocked by the fixture.

## Implemented follow-up

- Correct review business resolution, input validation, retry-safe creation, review-specific tasks and task completion/reopening.
- Channel-matched costs, partial-data notices, dated spend with business separation, edits, archive/restore and removal of legacy period overrides.
- Provider status by reporting period, truthful refresh messages, private-path redaction (including cached data), error/retry states, guarded concurrent edits.
- Review correction, source links, duplicate warnings, business/status/search filters, pagination and recoverable archiving.
- Portfolio business/status/search filters, pagination, albums with ordering and cover selection, recoverable edits, explicit publication updates and archive/restore.
- Persistent business/date/tab state and shareable URLs; separate Campaigns and Connections; date presets/custom range; CSV and print/PDF.
- Saved landing-page campaigns, separate paid-social tags, downloadable QR codes, actionable navigation and delivery details with restricted retry.
- Business-specific follow-up timing and review links with inherited defaults; optional Marketing content in the existing owner digest (off by default).
- Owner/manager publishing, spending and settings permissions; technicians can prepare work; consistent linked-job publication guards.
- Correct service mappings verified against local CJM site catalogs, including barndominiums/shops and Trades.
- Review data checks show records requiring correction. Proven invitation/business mismatches can be returned to draft under the correct business. Ambiguous manual reviews are not guessed.

The shared Modal already provided discard confirmation; this pass preserves it and adds project-edit recovery. Archived records remain recoverable; no bulk production cleanup or customer communications were performed.

Validation: TypeScript, production build, complete existing regression suite, added Marketing data regressions and all 39 browser checks. Provider permissions, Google/Bing ingestion and website cache refreshes remain external to local tests. Existing website links remain available for checking the published result. Albums are stored and exposed by the Suite public feed; each website controls how that feed is rendered.

