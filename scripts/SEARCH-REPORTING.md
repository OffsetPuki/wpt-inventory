# Business Suite search reporting

Marketing supports CJM Metals, Concrete, Insulation and Trades. Existing Google Analytics, Search Console, lead attribution and consented outcome delivery stay in place. Bing Webmaster reports are a separate source; do not add Bing search clicks to Analytics visits.

## Server configuration

- Keep the existing `GOOGLE_REPORTING_OAUTH_JSON` (or service-account fallback) and site-specific GA4 outcome secrets unchanged. Google requires Analytics and Search Console read access to the configured properties.
- Add `BING_REPORTING_API_KEY` to the server environment. The approved key was verified for all four sites and saved locally in ignored `.env.bing.local`. It is not in source control, client responses, browser bundles or audit records. Bing keys grant account-wide API access; this integration calls only five reporting GET methods. Never paste the key into a client variable or commit it.
- `npm run dev:marketing` loads the existing `.env` and the private Bing environment. Regular production startup reads its hosting environment; a local credential file does not configure Railway.
- The owner requested local review. No deployment or production environment change is part of this batch. A later approved release needs both this code and the private server variable. Keep the existing Google credentials and database volume intact.

## Behavior and limits

- Owner-only Growth endpoints return Google and Bing totals, an all-four-site comparison and provider-specific connection health. Workers cannot read or refresh these reports.
- Successful reports are cached. Failed refreshes retain previous data and record a safe connection error. Empty Bing responses show unavailable/waiting, never an invented zero.
- Manual **Refresh search data** updates the selected site. The existing Suite worker refreshes configured reports every six hours while running.
- Bing rank/traffic rows are daily; selected-period totals include only those dates. Bing page/query reports are weekly snapshots and are shown separately. Bing's reported surfaces include web, images, news and chat, so these are not solely web-search figures or AI citation counts.
- Bing crawl statistics and submitted sitemap statuses are imported. Google adds sitemap results and a read-only homepage URL inspection. The homepage result is not proof that every page is indexed. Current indexing/sitemap snapshots are separate from historical traffic periods.
- Bing AI Performance, IndexNow and Google Business Profiles open their native dashboards. No AI citation or Business Profile statistics are imported. Website IndexNow code remains a separate local change and starts only after publication.
- Live checks on September 12, 2026: all four Google refreshes succeeded and outcome delivery showed configured. All twenty Bing GET checks succeeded; all four sitemaps reported Success. Bing activity/crawl/page/query reports were empty at the time of checking.

## Local preview and verification

Build, then `npm run preview:marketing` opens the service at `http://127.0.0.1:4451/#/marketing`. It uses an isolated temporary database and real read-only Bing reports. No production business data, emails, payments or Google credentials are copied. The banner explains the local Google connection state. This script must never be deployed.

Checks: `npm run check`, `tsx scripts/check-google-auth.mjs`, `tsx scripts/check-growth.mjs`, `tsx scripts/check-bing-reporting.mjs`, `playwright test --project=growth`. The optional `node scripts/check-marketing-preview.mjs` verifies the running local preview and captures screenshots.

References: [Bing API access](https://learn.microsoft.com/en-us/bingwebmaster/getting-access), [JSON API protocol](https://learn.microsoft.com/en-us/bingwebmaster/api-protocols), [daily rank and traffic](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getrankandtrafficstats?view=bing-webmaster-dotnet), [weekly query reports](https://learn.microsoft.com/en-us/dotnet/api/microsoft.bing.webmaster.api.interfaces.iwebmasterapi.getquerystats?view=bing-webmaster-dotnet), [Google URL inspection](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect).
