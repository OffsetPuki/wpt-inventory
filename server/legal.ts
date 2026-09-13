import type { Express } from "express";

// ─── Legal pages: Privacy Policy + End User License Agreement ────────────────
// Served as standalone, publicly accessible HTML (no auth) at /privacy and /eula.
//
// ▼▼▼ EDIT THESE before going to production ▼▼▼
// Replace the contact email and governing-law jurisdiction with your real
// details, and bump effectiveDate when you change the text. companyName/appName
// match the app's branding defaults.
const LEGAL = {
  companyName: "CJM Metals",
  appName: "CJM Metals Business Suite",
  // A real, monitored inbox. Users use this to reach you about privacy
  // questions and data requests.
  contactEmail: "support@cjmmetals.com",
  // Used by the EULA's governing law / exclusive-jurisdiction clause.
  governingLaw: "the State of Texas, United States",
  effectiveDate: "September 12, 2026",
};
// ▲▲▲ EDIT THESE before going to production ▲▲▲

export function renderPublicPage(
  title: string,
  body: string,
  opts: { effective?: boolean } = {}
): string {
  const showEffective = opts.effective !== false;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="all" />
<title>${title} — ${LEGAL.appName}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.65;
    color: #1f2933;
    background: #f7f8fa;
  }
  .wrap { max-width: 820px; margin: 0 auto; padding: 48px 24px 96px; }
  header.doc { border-bottom: 1px solid #e4e7eb; padding-bottom: 24px; margin-bottom: 32px; }
  .brand { font-size: 14px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280; }
  h1 { font-size: 32px; line-height: 1.2; margin: 8px 0 4px; color: #111827; }
  .eff { font-size: 14px; color: #6b7280; margin: 0; }
  h2 { font-size: 20px; margin: 36px 0 8px; color: #111827; }
  h3 { font-size: 16px; margin: 24px 0 4px; color: #111827; }
  p, li { font-size: 15.5px; }
  ul { padding-left: 22px; }
  li { margin: 4px 0; }
  a { color: #b45309; }
  .lead { font-size: 16.5px; color: #374151; }
  .toc { background: #fff; border: 1px solid #e4e7eb; border-radius: 12px; padding: 16px 20px; margin: 24px 0 8px; }
  .toc h2 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; }
  .toc ol { margin: 0; padding-left: 20px; columns: 2; column-gap: 32px; }
  .toc a { color: #374151; text-decoration: none; }
  .toc a:hover { text-decoration: underline; }
  .callout { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 14px 18px; margin: 20px 0; }
  footer.doc { border-top: 1px solid #e4e7eb; margin-top: 48px; padding-top: 20px; font-size: 14px; color: #6b7280; display: flex; gap: 18px; flex-wrap: wrap; }
  footer.doc a { color: #6b7280; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #e4e7eb; padding: 8px 12px; text-align: left; font-size: 14.5px; vertical-align: top; }
  th { background: #f3f4f6; font-weight: 600; }
  @media (max-width: 600px) { .toc ol { columns: 1; } .wrap { padding: 32px 18px 72px; } }
</style>
</head>
<body>
  <div class="wrap">
    <header class="doc">
      <div class="brand">${LEGAL.companyName}</div>
      <h1>${title}</h1>
      ${showEffective ? `<p class="eff">Effective ${LEGAL.effectiveDate}</p>` : ""}
    </header>
    ${body}
    <footer class="doc">
      <a href="/privacy">Privacy Policy</a>
      <a href="/eula">End User License Agreement</a>
      <span>&copy; ${new Date().getFullYear()} ${LEGAL.companyName}</span>
    </footer>
  </div>
</body>
</html>`;
}

function privacyBody(): string {
  return `
  <p class="lead">${LEGAL.companyName} ("we," "us," or the "Company") operates ${LEGAL.appName} (the "Service"), an internal inventory and job-management application. This Privacy Policy explains what information the Service collects, how we use and protect it, and the choices available to you. It applies to authorized users of the Service and to data processed through it.</p>

  <div class="toc">
    <h2>Contents</h2>
    <ol>
      <li><a href="#info">Information we collect</a></li>
      <li><a href="#use">How we use information</a></li>
      <li><a href="#ai">AI photo identification</a></li>
      <li><a href="#share">How we share information</a></li>
      <li><a href="#security">Storage &amp; security</a></li>
      <li><a href="#retention">Data retention</a></li>
      <li><a href="#rights">Your rights &amp; choices</a></li>
      <li><a href="#cookies">Cookies &amp; local storage</a></li>
      <li><a href="#children">Children's privacy</a></li>
      <li><a href="#changes">Changes</a></li>
      <li><a href="#contact">Contact</a></li>
    </ol>
  </div>

  <h2 id="info">1. Information we collect</h2>

  <h3>Account &amp; authentication</h3>
  <p>When an administrator creates your account, we store your display name, assigned role (e.g. owner, worker), and a one-way <strong>bcrypt hash</strong> of your password or PIN. Owners use passwords; worker accounts may use PINs. We do not store these sign-in credentials in plain text. We create a session token when you sign in to keep you logged in.</p>

  <h3>Inventory &amp; operational data</h3>
  <p>The Service stores the business records you enter: items and their quantities, locations, part numbers, notes and photos; projects, job numbers and checklists; and the check-out, check-in, and stock-adjustment transactions you record. It also stores customer inquiries and contacts, quotes and acceptance activity, contracts, invoices, payment references, job files, employee time and payroll records, internal communications and related audit history.</p>

  <h3>Photos and images</h3>
  <p>Photos you attach to items are stored by the Service. If you use the optional "Identify by photo" feature, a downscaled copy of the image is sent to our AI provider for processing — see <a href="#ai">Section 3</a>.</p>

  <h3>Security &amp; audit logs</h3>
  <p>To protect the Service and maintain an accurate record of sensitive actions, we keep an audit log of privileged events (such as item deletion, account changes, settings changes, and sign-in outcomes). Each entry may include the acting user, the action, a timestamp, and the originating IP address. We also apply rate limiting and account-lockout protections that temporarily record failed sign-in attempts.</p>

  <h3>Technical data</h3>
  <p>The Service stores a sign-in token in your browser's local storage and a small cookie recording your light/dark theme preference. The internal application does not load third-party advertising trackers. Connected public websites use optional Analytics and campaign/outcome measurement as described in their notices; related permissions and identifiers may be stored in this suite.</p>

  <h2 id="use">2. How we use information</h2>
  <ul>
    <li>To authenticate users and provide customer, quoting, contracting, job, inventory, finance, payroll, communication and reporting functions.</li>
    <li>To generate suggested item names and categories when you choose to identify an item by photo.</li>
    <li>To secure the Service, prevent abuse, troubleshoot problems, and maintain an audit trail of sensitive actions.</li>
  </ul>
  <p>We do <strong>not</strong> sell your information, and we do not use it for advertising or for any purpose unrelated to operating the Service.</p>

  <h2 id="ai">3. AI photo identification</h2>
  <p>The optional "Identify by photo" feature sends a downscaled copy of the photo you capture to <strong>Anthropic, PBC</strong> (the Claude API) to generate a suggested item name, category, and short description. We send only the image for that request; we do not send your inventory database or account credentials. Anthropic processes the image to return a result and, under its commercial API terms, does not use API inputs to train its models. If you prefer not to use this feature, simply enter item details manually.</p>

  <h2 id="share">4. How we share information</h2>
  <p>We share information as described below and as needed to operate the Service and carry out your project:</p>
  <ul>
    <li><strong>Anthropic, PBC</strong> — to process photos you submit for AI identification (Section 3).</li>
    <li><strong>Hosting, storage and backups</strong> — infrastructure providers hosting the suite, uploaded files and backup archives.</li>
    <li><strong>Email and payment providers</strong> — customer communications and invoice payments; Stripe processes online payments and supplies payment status and transaction references.</li>
    <li><strong>Google services, when connected</strong> — authorized reporting and consent-based website outcome measurement.</li>
    <li><strong>Customers and the public</strong> — customer quote/invoice links expose the associated document to anyone with that link. Specifically approved project photos or reviews may be published on CJM websites.</li>
    <li><strong>Legal</strong> — where required by law, regulation, or valid legal process, or to protect the rights, safety, and security of the Company and its users.</li>
  </ul>
  <p>We do not sell personal information. Optional website campaign and outcome measurement may send permitted identifiers to Google under the choices described in the website privacy notice. Authorized CJM personnel use shared records across the involved trades; customer document links and approved public content are shared as described above.</p>
  <p>Third-party providers process information under their applicable service agreements and privacy terms. Contact us for questions about a provider used for your project.</p>

  <h2 id="security">5. Storage &amp; security</h2>
  <p>The Service stores data in a database on the server operated by your organization. We apply reasonable technical and organizational safeguards, including: one-way hashing of passwords and PINs; role-based access controls; session expiry; login rate limiting and account lockout; HTTP security headers and a content security policy; and validation of uploaded files. When the Service is deployed for production use it is served over HTTPS so data is encrypted in transit (TLS). No method of transmission or storage is completely secure, and we cannot guarantee absolute security.</p>
  <p><strong>Breach handling.</strong> In the event of a security incident affecting personal information, we will investigate, take appropriate remedial action, and notify affected users without undue delay, as required by applicable law.</p>

  <h2 id="retention">6. Data retention</h2>
  <ul>
    <li><strong>Inventory &amp; project records:</strong> retained while your organization uses the Service. Deleted items and projects are soft-deleted and recoverable from Trash for 30 days before being permanently purged.</li>
    <li><strong>Audit logs:</strong> retained for up to 24 months to support security and accountability, then purged, unless a longer period is required to investigate an incident or comply with law.</li>
    <li><strong>Photos sent for AI identification:</strong> not retained by us beyond producing the suggestion; the photo you choose to save remains attached to the item until you remove it.</li>
  </ul>

  <h2 id="rights">7. Your rights &amp; choices</h2>
  <p>Because the Service is administered by your organization, your employer is the controller of most data within it. You may ask your administrator to access, correct, or delete records about you. Depending on where you live, you may have rights to access, correct, delete, or restrict processing of your personal information; to exercise these rights, or if you have questions, contact us using the details below. We will not discriminate against you for exercising your privacy rights.</p>
  <p>We review privacy requests under applicable law. Recordkeeping obligations, security, dispute preservation and backup retention may limit immediate deletion. Contact us using the details below to request a review.</p>

  <h2 id="cookies">8. Cookies &amp; local storage</h2>
  <p>The Service uses only what it needs to function: a sign-in token kept in your browser's local storage, and a cookie that remembers your light/dark theme. These are strictly necessary for the Service and are not used for tracking or advertising. Clearing them will sign you out and reset your theme.</p>

  <h2 id="children">9. Children's privacy</h2>
  <p>The Service is a workplace tool intended for use by employees and authorized personnel. It is not directed to children under 16, and we do not knowingly collect personal information from children.</p>

  <h2 id="changes">10. Changes to this policy</h2>
  <p>We may update this Privacy Policy from time to time. When we do, we will revise the "Effective" date above and, where appropriate, provide additional notice. We will seek consent where required for a new use of personal information.</p>

  <h2 id="contact">11. Contact</h2>
  <p>Questions, requests, or concerns about this Privacy Policy or your data can be directed to:</p>
  <p>${LEGAL.companyName}<br/>Email: <a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a></p>`;
}

function eulaBody(): string {
  return `
  <p class="lead">This End User License Agreement ("Agreement") is a binding agreement between you ("you" or "User") and ${LEGAL.companyName} ("we," "us," or the "Company") governing your use of ${LEGAL.appName} (the "Service"). By accessing or using the Service, you agree to be bound by this Agreement. If you do not agree, do not use the Service.</p>

  <div class="toc">
    <h2>Contents</h2>
    <ol>
      <li><a href="#license">License grant</a></li>
      <li><a href="#restrictions">Restrictions</a></li>
      <li><a href="#accounts">Accounts &amp; responsibilities</a></li>
      <li><a href="#third">Third-party services</a></li>
      <li><a href="#ip">Intellectual property</a></li>
      <li><a href="#privacy">Data &amp; privacy</a></li>
      <li><a href="#warranty">Disclaimer of warranties</a></li>
      <li><a href="#liability">Limitation of liability</a></li>
      <li><a href="#indemnity">Indemnification</a></li>
      <li><a href="#term">Term &amp; termination</a></li>
      <li><a href="#law">Governing law</a></li>
      <li><a href="#changes">Changes</a></li>
      <li><a href="#contact">Contact</a></li>
    </ol>
  </div>

  <h2 id="license">1. License grant</h2>
  <p>Subject to your compliance with this Agreement, the Company grants you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Service for your organization's internal business purposes, in your capacity as an authorized user.</p>

  <h2 id="restrictions">2. Restrictions</h2>
  <p>You agree not to, and not to permit anyone else to:</p>
  <ul>
    <li>copy, modify, distribute, sell, lease, or sublicense the Service;</li>
    <li>reverse engineer, decompile, or attempt to extract the source code of the Service, except to the extent this restriction is prohibited by applicable law;</li>
    <li>access the Service to build a competing product, or use it other than for its intended inventory and job-management purpose;</li>
    <li>circumvent or interfere with security, authentication, rate-limiting, or access-control features;</li>
    <li>upload unlawful, infringing, or malicious content, or use the Service in violation of any applicable law or third-party rights;</li>
    <li>use the Service to access data you are not authorized to access.</li>
  </ul>

  <h2 id="accounts">3. Accounts &amp; responsibilities</h2>
  <p>You are responsible for activity that occurs under your account. Keep your password or PIN confidential, do not share your account, and notify your administrator promptly of any suspected unauthorized use. Your administrator is responsible for provisioning accounts and assigning roles appropriately.</p>

  <h2 id="third">4. Third-party services</h2>
  <p>The Service integrates with third-party services, including <strong>Anthropic's Claude API</strong> (optional AI photo identification). Your use of those features may also be subject to the third party's own terms and policies. The Company is not responsible for third-party services, and their availability or behavior may change. References to third parties do not imply endorsement or partnership.</p>

  <h2 id="ip">5. Intellectual property</h2>
  <p>The Service, including its software, design, and content (excluding your business data), is owned by the Company and its licensors and is protected by intellectual-property laws. Except for the license granted above, no rights are transferred to you. Data you enter into the Service remains the property of your organization.</p>

  <h2 id="privacy">6. Data &amp; privacy</h2>
  <p>Your use of the Service is also governed by our <a href="/privacy">Privacy Policy</a>, which describes how information is collected, used, and protected. By using the Service you acknowledge that policy.</p>

  <h2 id="warranty">7. Disclaimer of warranties</h2>
  <p>THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING WITHOUT LIMITATION IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.</p>

  <h2 id="liability">8. Limitation of liability</h2>
  <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE COMPANY WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS, REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE SERVICE WILL NOT EXCEED ONE HUNDRED U.S. DOLLARS (US$100). SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.</p>

  <h2 id="indemnity">9. Indemnification</h2>
  <p>You agree to indemnify and hold harmless the Company and its officers, employees, and agents from any claims, damages, liabilities, and expenses (including reasonable legal fees) arising from your misuse of the Service or your violation of this Agreement or applicable law.</p>

  <h2 id="term">10. Term &amp; termination</h2>
  <p>This Agreement remains in effect while you use the Service. We or your administrator may suspend or terminate your access at any time, including for violation of this Agreement. Upon termination, the license granted to you ends and you must stop using the Service. Sections that by their nature should survive termination (including ownership, disclaimers, limitation of liability, and indemnification) will survive.</p>

  <h2 id="law">11. Governing law</h2>
  <p>This Agreement is governed by the laws of ${LEGAL.governingLaw}, without regard to its conflict-of-laws principles. The courts located in that jurisdiction will have exclusive jurisdiction over any dispute arising from this Agreement, subject to any mandatory consumer-protection laws that apply to you.</p>

  <h2 id="changes">12. Changes</h2>
  <p>We may update this Agreement from time to time. We will revise the "Effective" date above when we do. Your continued use of the Service after changes take effect constitutes acceptance of the updated Agreement.</p>

  <h2 id="contact">13. Contact</h2>
  <p>${LEGAL.companyName}<br/>Email: <a href="mailto:${LEGAL.contactEmail}">${LEGAL.contactEmail}</a></p>`;
}

export function registerLegalRoutes(app: Express): void {
  const send = (html: string) => (_req: any, res: any) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Don't cache legal pages — edits (company name, effective date, policy
    // text) must show immediately for users, not be served stale from a
    // browser or edge cache for up to an hour.
    res.setHeader("Cache-Control", "no-store");
    res.send(html);
  };
  const privacy = send(renderPublicPage("Privacy Policy", privacyBody()));
  const eula = send(renderPublicPage("End User License Agreement", eulaBody()));

  app.get("/privacy", privacy);
  app.get("/legal/privacy", privacy);
  app.get("/eula", eula);
  app.get("/legal/eula", eula);
}
