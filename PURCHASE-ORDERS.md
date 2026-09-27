# Customer and supplier purchase orders

Finance → Purchase orders has two categories. Customer POs record orders received by CJM. Supplier POs record purchases issued by CJM. The internally generated CPO number is a filing reference; the buyer's actual PO number has its own field and may remain blank while a draft is pending.

## Creating an order

Select the business and customer or supplier. Link the customer, sales lead, quote and CJM job where applicable. Record the customer's project number separately from the internal job. “Fill from quote” explicitly copies the quote's contact, scope, finish, specifications, deposit and total into the draft. Review those copied fields against the buyer's original document.

Scope fields include finish, customer-supplied materials, exclusions and drawing references. For example, record both who supplies paint and who prepares/applies it. Delivery can be included in the line price or charged separately. Prices use integer cents, with explicit discount, freight, tax rate, taxable freight, deposit and balance. Deposits are agreed amounts; entering one does not record a payment.

Save the draft before uploading private originals, drawings, correspondence or delivery records. The application allows up to 30 documents per order, 10 MB each. Files are stored in `uploads/po-documents`, included in complete backups, and downloaded only through the authenticated order endpoint. Original uploads cannot be silently replaced or deleted through the order UI.

## Review and fulfillment

Customer: Draft → Needs review → Confirmed → In production → Delivered → Invoiced → Closed.

Supplier: Draft → Needs review → Approved → Sent to supplier → Received → Closed. Existing open supplier orders retain their receiving workflow. Partial delivery quantities are visible before full receipt.

Approval requires reviewing scope and current quote differences. A customer confirmation additionally requires the actual buyer PO number and an original PO attachment. Automated comparison covers price, deposit, business, customer, scope, finish, specifications, terms and quote revision. A reviewer must resolve differences in writing. Attachments are not automatically interpreted; dates, exclusions and supplied materials still require human review.

Approved records are locked. Create a revision with a reason to edit the order and repeat review. Earlier snapshots and their documents remain available in History. Received supplier quantities cannot be revised; use a separate order for additions. Status actions log who performed them and when. “Record sent” documents the recipient/method; it does not send an email. Customer status changes do not create invoices, record payments, accept quotes or authorize purchases automatically.

Supplier receipts preserve the existing atomic inventory/expense process. Discounts, freight and tax are allocated across received lines with cumulative cent rounding so split deliveries add to the approved total. Customer orders cannot enter this supplier expense path.

## Release and verification

The runtime migration is additive and safe to repeat. Existing orders default to supplier and retain their original pricing/receipts. Do not use `db:push` as the production migration mechanism. Capture a complete backup, deploy through the existing release checks, then verify both PO categories and the review/PDF screens. Rolling application code back after new customer records exist requires care because older code does not understand their category or statuses; prefer a forward fix and retain the pre-update backup for deliberate recovery.

`scripts/check-purchase-orders.mjs` tests permissions, linked records, pricing, approval/document gates, stale revisions, quote changes, private downloads, supplier receipt allocation, retries and repeat initialization. `tests/purchase-orders.spec.mjs` exercises mobile entry, quote import, uploads, confirmation, PDF export, revision history and draft recovery using synthetic records. The existing inventory and suite regression checks remain required.
