# Website results and Google reporting

The Marketing overview compares two completed 28-day inquiry cohorts. Dates use America/Chicago; linked quotes, won value and payments show each cohort's outcomes to date. Google reports use their property's reporting timezone and may revise recent dates. Booked value and collected payments are separate. Deleted records and void invoices are excluded. Staff and labeled release-test inquiries are hidden by default.

Original campaign and public landing page are saved with new inquiries. CJM-to-CJM links carry bounded campaign labels, never contact details or Google browser identifiers. Older inquiries keep their existing attribution; missing history is not invented. Treat campaign labels as untrusted reporting input, never authorization.

## Connection settings in Railway

Set these only on the suite service. Never commit values or paste them into chat.

- `GOOGLE_REPORTING_OAUTH_JSON`: Preferred for this setup. An internal CJM OAuth connection with only `analytics.readonly` and `webmasters.readonly` scopes. Its JSON contains `type: "authorized_user"`, `client_id`, `client_secret`, `refresh_token`, and an optional account display label. Keep it only in Railway. The application requests reports for the four fixed properties below. If the owner revokes access, reconnect; failures preserve the previous cached reports.
- `GOOGLE_REPORTING_SERVICE_ACCOUNT_JSON`: Alternative JSON key for a dedicated Google service account with Viewer access to GA4 and Restricted access to matching Search Console properties. It needs no broad Cloud project role. **Do not weaken the organization's service-account-key policy to use this alternative.** The CJM setup uses OAuth instead and preserves `iam.managed.disableServiceAccountKeyCreation`.
- `GA4_METALS_API_SECRET`, `GA4_CONCRETE_API_SECRET`, `GA4_INSULATION_API_SECRET`, `GA4_TRADES_API_SECRET`: Measurement Protocol secrets from the corresponding web streams.

| Trade | GA4 property | Measurement ID | Search Console property |
|---|---|---|---|
| Metals | 543542920 | G-GQQJGFH304 | https://www.cjmmetals.com/ |
| Concrete | 552153527 | G-JW21V0EZ9S | https://www.cjm-concrete.com/ |
| Insulation | 552155140 | G-78LHR7B0MJ | https://www.cjminsulation.com/ |
| Trades | 552153288 | G-VJKTXNP21H | https://www.cjmtrades.com/ |

Use Railway's `--skip-deploys` when preparing credentials ahead of an approved release. The current dashboard distinguishes configured credentials from imported report data; configuration alone does not prove Google access. Google reporting refreshes every six hours and on owner request. A failed refresh preserves the previous cache and its timestamp. An entered ad-spend total overrides Google spend only for that exact 28-day period.

## Lead events

`generate_lead` is emitted by a website only after a successful save, with receipt/session and server deduplication. Direct confirmation-page visits and contact-button clicks are not inquiries. Mark it as a GA4 key event without an invented monetary value. Do not import it into Google Ads alongside an existing primary inquiry conversion without reviewing campaign/custom-goal dependencies.

The optional form permission is unchecked by default. Only opted-in visitors with a valid Analytics browser identifier receive later Measurement Protocol events: `qualify_lead`, `working_lead`, `site_visit_scheduled`, `quote_sent`, `close_convert_lead`. The queue stores each milestone once per lead. It sends no names, contact information, project notes, or internal record IDs. Ad-user-data and ad-personalization permission are denied in the payload.

Outcome transport acceptance is not verified Analytics reception. Validate the payload against Google's debug endpoint and check the real property reports during setup. Events older than 72 hours expire. Ambiguous requests are held without automatic replay to avoid duplicates. Missing credentials leave events pending until expiration. Historical inquiries without attribution are never backfilled.

## Staff and test measurement

Marketing → Campaign links, staff mode and connections provides enable/disable links for each website. Staff mode persists separately on each website and browser; it suppresses browser Analytics and labels submitted inquiries. `?cjm_analytics=off` disables browser Analytics; `?cjm_analytics=on` allows it again. Browser Do Not Track / Global Privacy Control also disable Analytics. Local preview hosts disable the Google tag.

The owner supplied IPv4 `156.146.153.193`, with no IPv6 detected. On September 11, all four tags received an exact-IP rule named `CJM shop — owner supplied IPv4` with `traffic_type=cjm_shop_candidate`. Each matching GA4 property has a `CJM shop IP verification` filter in **Testing**. Original Internal Traffic filters remain in Testing too. The supplied address's stability and whether it is a direct shop connection remain unverified. Observe genuine shop visits under `Test data filter name` before activating any exclusion.

## Verified account setup — September 11, 2026

The internal Google Auth app is `FLIPNOB Website Reporting` in Cloud project `cjm-website-reporting`. Analytics Data API and Search Console API are enabled. The authorized account is `support@cjmmetals.com`; the read-only OAuth credential is stored in Railway's suite production service with `--skip-deploys`. All four properties successfully returned traffic, ad-cost, Search Console page and query reports for August 14–September 10 and July 17–August 13. An empty result is distinct from an access failure. The three newer Search Console properties did not yet have historical search rows for these periods.

Trades now has a verified Search Console property, a successful sitemap (42 URLs), its matching GA4 link, and the code-based `generate_lead` key event with no default monetary value. Concrete and Insulation sitemaps are now both successful (52 and 46 URLs respectively).

Metals Google tag diagnostics were cleared by ignoring nine intentionally untagged private/staging URLs in coverage monitoring, removing the staging-domain suggestion and accepting only the exact public `cjmmetals.com` domain. Google confirmed **Excellent — no issues detected**. Private pages did not gain Analytics tracking.

The owner explicitly approved the four outcome-ingestion credentials and Railway storage, and separately approved Google's Insulation privacy acknowledgment. Each stream now has **FLIPNOB consented job outcomes**, stored only in Railway with `--skip-deploys`. All five outcome payloads passed Google's strict debug validation. One clearly labeled `cjm_outcome_connection_test` event was sent per property; all four appeared exactly once in the Realtime API on September 11 at 17:51 UTC. This verifies ingestion access without inventing qualified leads, quotes or sales. The first real consented business outcome remains a separate production observation.

The owner reported visiting all four websites from the shop with VPN off. Today's available `testDataFilterName` reports have not yet identified the shop filter; keep it in Testing until that evidence arrives. The owner also confirmed that the full Ads customer ID remains inaccessible under the available sign-ins. Preserve its legacy Primary conversion until the original administrator grants access. Insulation Business Profile verification currently requires its private street mailing address; the owner was asked to enter it directly in Google.

## Review cycle

1. Select a website and a complete 28-day period. Check the Google cache timestamps and connection state.
2. Compare saved, qualified, quoted and won inquiries with the previous cohort. Use collected payments separately from booked value.
3. Review source/landing-page results, unanswered inquiries and response time. Use paid-qualified leads as the denominator for paid acquisition cost.
4. Review high-impression, low-click pages in Search Console. Inspect indexing/canonicals and mobile usability before editing; preserve intentional redirects and private/API exclusions.
5. Publish only approved project photos/details. Existing feed approval rules remain in place. Review invitations offer the correct verified Google profile equally for every rating.
6. Review Google Ads dependencies before conversion cutover; budgets and targeting are separate owner decisions.

Validation: `npm run check`, `npm test` (includes `scripts/check-growth.mjs`), and `npm run test:browser -- --project=growth`. Website browser tests cover both languages, persisted lead events, prefill attribution, double-submit protection and exclusion of private query values.
