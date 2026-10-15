# ChatGPT help with lead replies

Owners and managers can open any lead and choose **Reply with ChatGPT**. The handoff reads the latest saved lead, complete notes and customer updates, intake preferences and qualification, every linked website design, activity history and all referenced customer photos/design previews. Unsaved changes must be saved first.

**Copy request & open ChatGPT** opens a new ChatGPT tab and copies the complete request. Paste it into the composer. When the lead has photos, return to the Suite and copy each numbered photo sheet into the same message, or download and attach the sheets. Original images remain downloadable for fine details. Review the suggested reply before sending it to the customer.

A website link cannot attach private images in another site's composer. The UI therefore keeps the text and actual image transfer explicit. It does not expose customer information in the ChatGPT URL, publish photos, use an API key, send customer replies, or log a contact event. Existing ChatGPT sign-in and plan limits apply. Clipboard restrictions have a full-text download/manual-copy fallback; image failures are named and can be retried.

The prompt asks for the customer's language, essential missing questions, and a separate private checklist. It labels saved notes/activity as context, treats customer text/images as source material, and forbids invented pricing, commitments or claims about unseen images.

Validation: `scripts/check-lead-reply.mjs` covers all four brands, long text, updates, multiple designs, photos, access control, fresh records and deleted/malformed data. `tests/lead-reply.spec.mjs` exercises phone and desktop layouts, actual image pixels, multiple photo sheets, clipboard and downloads, the external-tab boundary, request/photo retries and unsaved edits using synthetic records and an intercepted ChatGPT destination.
