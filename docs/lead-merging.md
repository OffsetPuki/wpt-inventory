# Merge duplicate leads

Owners and managers can open a lead, choose **Merge duplicate**, find the other
request, and choose which lead to keep. A contact match is a suggestion only;
separate projects for the same customer should stay separate.

The kept lead retains its stage, estimated value, won value, name, language, and
source. Empty contact/project/assignment fields are filled from the other lead.
Both notes, unique photo URLs, all designs, activity, and connected records stay
available. Differing original fields and intake details are preserved in Notes;
a complete before-merge snapshot is retained privately for audit. The earliest
received date and latest contact date describe the combined request.

Quotes, jobs, invoices, POs, tasks, review requests, design references, submission
receipts, and upload capabilities are relinked transactionally. Existing quote
and invoice contents, prices, payment records, customer links, and public share
tokens remain unchanged. No quote is accepted and no invoice is created by a
merge. Same-business and compatible-customer checks prevent accidental joins.

Both records and all referenced rows are fingerprinted for the review. Changes
invalidate confirmation; an idempotency receipt makes a retry safe after a lost
response. The removed lead is archived, excluded from Trash, and cannot be
restored separately. Old lead links resolve through merge chains. Stale edits
and activity writes against the removed lead fail rather than altering the
survivor. A merge cannot be undone through the app.

When both leads have analytics identities, original attribution/events stay on
the archived request. Existing milestones suppress new duplicate measurement;
they are not resent to a different browser identity. If the survivor has no
attribution, the original attribution and non-conflicting events are transferred.

Website intake only automatically combines rapid resubmissions for the same
business/design/contact within ten minutes. Quotes created without an explicit
lead/design link may create a separate lead marked Other. Starting with the
lead's **Create quote** action carries its identity into the quote builder.

Validation: `scripts/check-lead-merge.mjs` covers reference inventory, original
documents and balances, upload receipts, ChatGPT context, old links, permissions,
stale reviews, rollback, retries, conflicting customers and malformed photo data.
`tests/lead-merge.spec.mjs` exercises desktop/mobile review and confirmation,
unsaved edits, searching, selecting the survivor, conflict recovery and reopening.
