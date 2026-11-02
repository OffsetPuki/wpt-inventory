# Website controls
The Business Suite's **Websites** page is available at /#/websites, through Settings and the administration menu. Website access never deletes trade records, jobs, estimates or internal tools.

## Owner workflow
- The large switch changes the requested public state. Turning a site on requires passing the private preflight.
- **Check live status** verifies the public English and Spanish homepages and the website's applied policy revision. A saved setting is not labeled confirmed until these agree. Confirmation expires after two minutes or a policy change.
- **Private preview** opens a read-only, noindex view in a new tab for 15 minutes. The public website stays unchanged. Preview launch tickets expire after 60 seconds and cannot be reused. **Exit preview** clears the browser cookie.
- **Shared trade catalogue** controls cross-site Metals and Concrete links, tagged family cards, forms, planner choices, structured data and trade service discovery. Each site's own trade stays available on its own active website. The Insulation exclusion is enforced on the server and cannot be re-enabled by activating its website.
- Change history lives with each website. Search cleanup is a separate checklist; checking a box does not submit anything to a search provider.

## Runtime and recovery
The Suite owns a persistent SQLite table for settings, synchronous change history and a persistent Ed25519 signing key. Public policy contains only website configuration and the verification key. It does not expose customer data or the private key.

Every public site includes the same versioned scripts/website-gate.mjs. It polls the Suite policy at most once every ten seconds and atomically saves the last verified policy to its own Railway volume mounted at /website-state (RAILWAY_VOLUME_MOUNT_PATH). A Suite outage retains the last published state, including after restart/redeploy. Without any valid policy, a connected site fails closed. A disabled site returns 410 and noindex; its robots.txt permits crawlers to observe the removal response.

The volume is required for outage protection across deployments. /__cjm/status reports whether the copy is durable and whether its last Suite sync succeeded. /healthz stays available when the public site is off and must be the Railway deployment healthcheck.

Preview cookies are Secure, HttpOnly, SameSite=Lax, signed, site-bound and time limited. All API paths and non-GET/HEAD requests are blocked during preview. Responses are private/no-store, forms inert, analytics disabled, and the preview banner is visible. Do not log preview POST bodies, copy Suite credentials into URLs, or expose private keys.

When restoring a Suite backup, preserve website_control_keys and website_availability. A new setting change uses its update time in the policy revision, allowing a deliberate post-restore change to supersede newer website copies. Verify every live site afterward.

## Release checks
Suite: npm run check, npm run build, npm test and tests/website-controls.spec.mjs.
Public sites: npm run check, npm run build, npm test; the shared controls tests cover activation, deactivation, outage/restart persistence, preview tampering/expiry/site boundaries and real server assets/forms.
Trades: tests/website-controls.spec.mjs additionally exercises the published server in English/Spanish on mobile, with hidden-trade legacy planner URLs and a signed private browser session.

Update shared-contracts.json and every website consumer together when changing shared runtime files. Do not reactivate a real retired site just to test a release; use the isolated fixtures.

