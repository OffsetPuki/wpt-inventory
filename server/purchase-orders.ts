import type { Express, Request } from 'express';
import { z } from 'zod';
import { eq, desc, and, isNull } from 'drizzle-orm';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sqlite, db, uploadsDir } from './storage';
import { requireElevated } from './auth';
import { purchaseOrders, insertPurchaseOrderSchema } from '../shared/finance-schema';
import { orderInputSchema, orderTotals, ORDER_TRANSITIONS, emptyOrderDetails, ORDER_STATUSES } from '../shared/purchase-orders';
import { parseLineItems, computeDocTotals } from '../shared/biz-common';
import { insertNumbered } from './numbering';
import { docUpload, DOC_EXT_TO_MIME } from './pm';
import { receivePoRemaining } from './inventory-receiving';
import { audit } from './audit';
import { pid } from './http-util';
import { specRows, summaryLine, finishLabel } from '../client/src/quote/data/configurators.js';
import { quoteBusiness } from '../shared/business.js';
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const json = (s: any, fallback: any = {}) => { try {
    return typeof s === 'string' ? JSON.parse(s) : s ?? fallback;
}
catch {
    return fallback;
} };
const digest = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function initializePurchaseOrders() {
    fs.mkdirSync(path.join(uploadsDir, 'po-documents'), { recursive: true });
    const fields: Record<string, string> = {
        order_type: "TEXT NOT NULL DEFAULT 'supplier'", customer_name: "TEXT NOT NULL DEFAULT ''", client_id: 'INTEGER', lead_id: 'INTEGER', quote_id: 'INTEGER',
        customer_po_number: "TEXT NOT NULL DEFAULT ''", customer_project_number: "TEXT NOT NULL DEFAULT ''", details: "TEXT NOT NULL DEFAULT '{}'", quote_snapshot: 'TEXT',
        subtotal_cents: 'INTEGER NOT NULL DEFAULT 0', discount_cents: 'INTEGER NOT NULL DEFAULT 0', shipping_cents: 'INTEGER NOT NULL DEFAULT 0', tax_rate_bp: 'INTEGER NOT NULL DEFAULT 0', tax_shipping: 'INTEGER NOT NULL DEFAULT 0', tax_cents: 'INTEGER NOT NULL DEFAULT 0', deposit_cents: 'INTEGER NOT NULL DEFAULT 0', revision: 'INTEGER NOT NULL DEFAULT 0',
    };
    sqlite.transaction(() => {
        const present = new Set((sqlite.prepare('PRAGMA table_info(fin_purchase_orders)').all() as any[]).map(r => r.name));
        // Only the first migration remaps pre-workflow statuses. Never rewrite a
        // new draft or a closed customer order during application startup.
        if (!present.has('order_type'))
            sqlite.exec("UPDATE fin_purchase_orders SET status='open' WHERE status IN ('draft','sent'); UPDATE fin_purchase_orders SET status='received' WHERE status='closed';");
        for (const [column, type] of Object.entries(fields))
            if (!present.has(column))
                sqlite.exec(`ALTER TABLE fin_purchase_orders ADD COLUMN ${column} ${type}`);
        if (!present.has('subtotal_cents'))
            sqlite.exec('UPDATE fin_purchase_orders SET subtotal_cents=total_cents');
        sqlite.exec(`
      CREATE INDEX IF NOT EXISTS fin_po_type_customer ON fin_purchase_orders(order_type,client_id,quote_id);
      CREATE TABLE IF NOT EXISTS fin_po_events(id INTEGER PRIMARY KEY,po_id INTEGER NOT NULL REFERENCES fin_purchase_orders(id),revision INTEGER NOT NULL,action TEXT NOT NULL,reason TEXT,user_id INTEGER,user_name TEXT,created_at INTEGER NOT NULL,snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS fin_po_events_order ON fin_po_events(po_id,id);
      CREATE TABLE IF NOT EXISTS fin_po_documents(id INTEGER PRIMARY KEY,po_id INTEGER NOT NULL REFERENCES fin_purchase_orders(id),revision INTEGER NOT NULL,name TEXT NOT NULL,file TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,document_date TEXT,user_id INTEGER,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS fin_po_docs_order ON fin_po_documents(po_id,id);
    `);
    })();
}
function load(id: number) {
    const row = db.select().from(purchaseOrders).where(and(eq(purchaseOrders.id, id), isNull(purchaseOrders.deletedAt))).get();
    if (!row)
        throw fail('Purchase order not found.', 404);
    return row;
}
function version(id: number) { return (sqlite.prepare("SELECT version FROM suite_record_versions WHERE entity='finance/purchase-orders' AND id=?").get(id) as any)?.version || 1; }
function checkVersion(req: Request, row: ReturnType<typeof load>) {
    if (row.revision > 0 && req.headers['if-match'] !== `"${version(row.id)}"`)
        throw fail('This order changed or was not loaded. Reopen it before saving.', 409);
}
function documents(id: number) { return sqlite.prepare('SELECT id,revision,name,kind,size,sha256,document_date AS documentDate,created_at AS createdAt FROM fin_po_documents WHERE po_id=? ORDER BY id DESC').all(id) as any[]; }
function present(row: ReturnType<typeof load>) {
    return { ...row, details: { ...emptyOrderDetails(), ...json(row.details) }, quoteSnapshot: json(row.quoteSnapshot, null), _version: version(row.id),
        partiallyReceived: row.orderType === 'supplier' && ['open', 'sent'].includes(row.status) && !!sqlite.prepare('SELECT 1 FROM inventory_receipts WHERE po_id=?').get(row.id),
        documents: documents(row.id) };
}
function record(req: Request, row: ReturnType<typeof load>, action: string, reason = '') {
    sqlite.prepare('INSERT INTO fin_po_events(po_id,revision,action,reason,user_id,user_name,created_at,snapshot) VALUES(?,?,?,?,?,?,?,?)').run(row.id, row.revision, action, reason, req.user!.userId, req.user!.name, Date.now(), JSON.stringify(present(row)));
    audit(req, `finance.po_${action}`, { targetType: 'purchase_order', targetId: row.id, targetName: row.number, details: { revision: row.revision, orderType: row.orderType, reason } });
}
function quoteData(id: number) {
    const q: any = sqlite.prepare('SELECT * FROM quotes WHERE id=? AND deleted_at IS NULL').get(id);
    if (!q)
        throw fail('The linked quote is unavailable.');
    const session = json(q.payload), customer = session.customer || {}, state = session.state || {};
    let specs: any[] = [];
    let summary = '';
    try {
        specs = specRows(q.type, state).map((s:any)=>({...s,value:/finish/i.test(s.label)&&/^#[0-9a-f]{6}$/i.test(String(s.value))?finishLabel(s.value):s.value}));
        summary = summaryLine(q.type, state);
    }
    catch { }
    return { id: q.id, number: q.number, version: q.version, status: q.status, business: quoteBusiness({ ...session, type: q.type }), totalCents: q.total_cents, leadId: q.lead_id, clientId: customer.clientId || null,
        customerName: customer.company || customer.name || q.customer_name || '', contactName: customer.name || q.customer_name || '', email: customer.email || '', phone: customer.phone || '', billingAddress: customer.location || '',
        scope: String(session.notes || ''), specifications: specs.map(s => `${s.label}: ${s.value}`).join('\n'), finish: specs.filter(s => /finish|coating/i.test(s.label)).map(s => s.value).join('; '),
        paymentTerms: Array.isArray(session.shopSnapshot?.terms) ? session.shopSnapshot.terms.join('\n') : String(session.shopSnapshot?.terms || ''),
        depositCents: Math.round(q.total_cents * Math.min(100, Math.max(0, Number(session.depositPct) || 0)) / 100), summary, payloadHash: digest(session) };
}
function validateLinks(input: any) {
    for (const [key, table] of [['clientId', 'crm_clients'], ['leadId', 'crm_leads'], ['quoteId', 'quotes'], ['projectId', 'projects']]) {
        if (input[key] && !sqlite.prepare(`SELECT id FROM ${table} WHERE id=? AND deleted_at IS NULL`).get(input[key]))
            throw fail(`${key.replace('Id', '')} no longer exists.`);
    }
    if (input.orderType === 'supplier' && (input.clientId || input.leadId || input.customerPoNumber || input.customerName))
        throw fail('Customer identity and customer PO numbers belong on a customer order.');
    if (input.orderType === 'customer' && !input.customerName.trim())
        throw fail('Customer/company name is required.');
    if (input.orderType === 'supplier' && !input.vendor.trim())
        throw fail('Supplier name is required.');
    if (input.orderType === 'customer') {
        const q = input.quoteId ? quoteData(input.quoteId) : null;
        const project: any = input.projectId ? sqlite.prepare('SELECT client_id,quote_id,lead_id FROM projects WHERE id=?').get(input.projectId) : null;
        if (q?.clientId && input.clientId && q.clientId !== input.clientId)
            throw fail('The customer and quote belong to different accounts.');
        if (q?.leadId && input.leadId && q.leadId !== input.leadId)
            throw fail('The lead and quote belong to different jobs.');
        if (project?.client_id && input.clientId && project.client_id !== input.clientId)
            throw fail('The job belongs to another customer.');
        if (project?.quote_id && input.quoteId && project.quote_id !== input.quoteId)
            throw fail('This job links to a different quote.');
        if (input.customerPoNumber) {
            const conflict = sqlite.prepare("SELECT id FROM fin_purchase_orders WHERE order_type='customer' AND (client_id=? OR lower(trim(customer_name))=lower(trim(?))) AND lower(trim(customer_po_number))=lower(trim(?)) AND deleted_at IS NULL AND status!='cancelled' AND id!=?").get(input.clientId || null, input.customerName, input.customerPoNumber, input.id || 0);
            if (conflict)
                throw fail('This customer PO number is already recorded. Open that order instead.', 409);
        }
    }
}
function review(row: ReturnType<typeof load>) {
    const available = row.quoteId && sqlite.prepare('SELECT id FROM quotes WHERE id=? AND deleted_at IS NULL').get(row.quoteId);
    const current = available ? quoteData(row.quoteId!) : null, saved = json(row.quoteSnapshot, null), d = json(row.details), differences: any[] = [];
    if (row.quoteId && !available)
        differences.push({ field: 'Linked quote unavailable', quote: 'Deleted or unavailable', order: 'Use the saved quote snapshot and original documents' });
    const compare = (field: string, quote: any, order: any) => { if (String(quote ?? '').trim() !== String(order ?? '').trim())
        differences.push({ field, quote: quote ?? '', order: order ?? '' }); };
    if (current && row.orderType === 'customer') {
        compare('Business', current.business, d.business || 'metals');
        compare('Total (cents)', current.totalCents, row.totalCents);
        compare('Deposit (cents)', current.depositCents, row.depositCents);
        compare('Customer', current.customerName, row.customerName);
        compare('Finish', current.finish, d.finish);
        compare('Scope / quote notes', current.scope, d.scope);
        compare('Specifications', current.specifications, d.specifications);
        compare('Payment terms', current.paymentTerms, d.paymentTerms);
        if (current.status === 'declined')
            differences.push({ field: 'Quote status', quote: 'Declined / superseded', order: 'Review the current quote' });
        if (saved?.payloadHash !== current.payloadHash || saved?.version !== current.version)
            differences.push({ field: 'Quote revision', quote: `${current.number} version ${current.version}`, order: `Linked version ${saved?.version ?? 'unknown'}` });
    }
    const docs = documents(row.id), checks = { scope: false, dates: false, payment: false, documents: false };
    return { quote: current, linkedSnapshot: saved, differences, checks, reviewToken: digest({ row, quote: current, documents: docs }),
        reminder: 'Compare the original PO, scope, exclusions, customer-supplied materials, delivery dates and payment terms. Text comparison does not interpret attachments.' };
}
function changes(input: any, existing?: ReturnType<typeof load>) {
    const normalized = orderInputSchema.parse(input);
    validateLinks({ ...normalized, id: existing?.id });
    const t = orderTotals(normalized.items, normalized);
    const { items, details, ...values } = normalized;
    return { ...values, items: JSON.stringify(items), details: JSON.stringify(details), ...t, quoteSnapshot: normalized.quoteId ? JSON.stringify(existing?.quoteId === normalized.quoteId ? json(existing.quoteSnapshot, quoteData(normalized.quoteId)) : quoteData(normalized.quoteId)) : null };
}
function saveValues(values: any) { const { balanceCents, ...rest } = values; return rest; }
function assertNoReceipts(id: number) { if (sqlite.prepare('SELECT 1 FROM inventory_receipts WHERE po_id=?').get(id))
    throw fail('This order has received quantities. Create an additional order for changes.', 409); }
export function registerPurchaseOrders(app: Express) {
    const route = (method: 'get' | 'post' | 'patch' | 'delete', url: string, fn: (req: Request) => any) => app[method](url, requireElevated, (req, res) => { try {
        const data = fn(req);
        res.status(method === 'post' && url.endsWith('purchase-orders') ? 201 : 200).json(data);
    }
    catch (e: any) {
        res.status(e.status || 400).json({ message: e.message });
    } });
    route('get', '/api/finance/purchase-orders/options/search', req => {
        const q = String(req.query.q || '').trim().slice(0, 100);
        const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
        return {
            clients: sqlite.prepare("SELECT id,name,company,email,phone,address,city,zip FROM crm_clients WHERE deleted_at IS NULL AND (name||coalesce(company,'')||coalesce(email,'')) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100").all(pattern),
            leads: sqlite.prepare("SELECT id,name,email,phone,client_id AS clientId FROM crm_leads WHERE deleted_at IS NULL AND (name||coalesce(email,'')) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100").all(pattern),
            quotes: sqlite.prepare("SELECT id,number,customer_name AS customerName,status,total_cents AS totalCents FROM quotes WHERE deleted_at IS NULL AND (number||coalesce(customer_name,'')) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100").all(pattern),
            projects: sqlite.prepare("SELECT id,name,job_number AS jobNumber,client_id AS clientId,quote_id AS quoteId FROM projects WHERE deleted_at IS NULL AND (name||job_number||coalesce(customer,'')) LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 100").all(pattern),
        };
    });
    route('get', '/api/finance/purchase-orders/quote/:id', req => quoteData(pid(req.params.id)));
    route('get', '/api/finance/purchase-orders', req => {
        let rows = db.select().from(purchaseOrders).where(isNull(purchaseOrders.deletedAt)).orderBy(desc(purchaseOrders.id)).all();
        if (req.query.orderType)
            rows = rows.filter(r => r.orderType === req.query.orderType);
        if (req.query.status)
            rows = rows.filter(r => r.status === req.query.status);
        const needle = String(req.query.q || '').toLowerCase();
        if (needle)
            rows = rows.filter(r => [r.number, r.vendor, r.customerName, r.customerPoNumber, r.customerProjectNumber].some(v => v.toLowerCase().includes(needle)));
        return rows.map(present);
    });
    // /detail avoids the older suite's lightweight GET /:id handler.
    route('get', '/api/finance/purchase-orders/:id/detail', req => {
        const row = load(pid(req.params.id));
        return { ...present(row), review: review(row), history: sqlite.prepare('SELECT id,revision,action,reason,user_name AS userName,created_at AS createdAt FROM fin_po_events WHERE po_id=? ORDER BY id DESC').all(row.id) };
    });
    route('get', '/api/finance/purchase-orders/:id/history/:eventId', req => {
        load(pid(req.params.id));
        const event: any = sqlite.prepare('SELECT * FROM fin_po_events WHERE po_id=? AND id=?').get(pid(req.params.id), pid(req.params.eventId));
        if (!event)
            throw fail('Revision not found.', 404);
        return { ...event, snapshot: json(event.snapshot) };
    });
    route('post', '/api/finance/purchase-orders', req => sqlite.transaction(() => {
        // Existing inventory/buy-list callers keep their open-order contract.
        if (!req.body.orderType) {
            const raw = { ...req.body };
            if (Array.isArray(raw.items))
                raw.items = JSON.stringify(raw.items);
            const parsed = insertPurchaseOrderSchema.parse(raw);
            const totals = computeDocTotals(parsed.items || '[]', 0);
            if (!parsed.vendor?.trim())
                throw fail('Supplier is required.');
            const row = insertNumbered('fin_purchase_orders', 'PO', number => db.insert(purchaseOrders).values({ vendor: parsed.vendor, projectId: parsed.projectId, expectedDate: parsed.expectedDate, notes: parsed.notes, items: parsed.items, number, status: 'open', orderType: 'supplier', ...totals }).returning().get());
            record(req, row, 'created');
            return present(row);
        }
        const values = saveValues(changes(req.body));
        const prefix = values.orderType === 'customer' ? 'CPO' : 'PO';
        const numberPrefix = `${prefix}-${new Date().getFullYear()}-`;
        const seed = () => Number((sqlite.prepare('SELECT coalesce(max(CAST(substr(number,?) AS INTEGER)),0)+1 n FROM fin_purchase_orders WHERE number LIKE ?').get(numberPrefix.length + 1, numberPrefix + '%') as any).n);
        const row = insertNumbered('fin_purchase_orders', prefix, number => db.insert(purchaseOrders).values({ ...values, number, status: 'draft', revision: 1 }).returning().get(), { seed });
        record(req, row, 'created');
        return present(row);
    })());
    route('patch', '/api/finance/purchase-orders/:id', req => sqlite.transaction(() => {
        const existing = load(pid(req.params.id));
        checkVersion(req, existing);
        if (existing.revision === 0) {
            if (existing.status !== 'open')
                throw fail('This order is closed.', 409);
            const raw = { ...req.body };
            if (Array.isArray(raw.items))
                raw.items = JSON.stringify(raw.items);
            const body = insertPurchaseOrderSchema.partial().parse(raw);
            if (body.orderType && body.orderType !== 'supplier')
                throw fail('Order category cannot be changed.');
            if (Object.keys(body).some(k => k !== 'status'))
                assertNoReceipts(existing.id);
            const allowed: any = {};
            for (const k of ['vendor', 'items', 'expectedDate', 'projectId', 'notes'] as const)
                if (body[k] !== undefined)
                    allowed[k] = body[k];
            if (allowed.items)
                Object.assign(allowed, computeDocTotals(allowed.items, 0));
            if (Object.keys(allowed).length)
                db.update(purchaseOrders).set(allowed).where(eq(purchaseOrders.id, existing.id)).run();
            if (body.status === 'received') {
                try {
                    receivePoRemaining(existing.id, req.user!.userId);
                }
                catch (e: any) {
                    throw fail(e.message, 409);
                }
            }
            else if (body.status === 'cancelled')
                db.update(purchaseOrders).set({ status: 'cancelled' }).where(eq(purchaseOrders.id, existing.id)).run();
            else if (body.status && body.status !== 'open')
                throw fail('Use the order workflow for status changes.');
        }
        else {
            if (!['draft', 'review'].includes(existing.status))
                throw fail('Create a revision before changing an approved order.', 409);
            if (req.body.orderType !== existing.orderType)
                throw fail('Order category cannot be changed.');
            assertNoReceipts(existing.id);
            db.update(purchaseOrders).set(saveValues(changes(req.body, existing))).where(eq(purchaseOrders.id, existing.id)).run();
        }
        const row = load(existing.id);
        record(req, row, 'updated');
        return present(row);
    })());
    route('post', '/api/finance/purchase-orders/:id/transition', req => sqlite.transaction(() => {
        const row = load(pid(req.params.id));
        checkVersion(req, row);
        const b = z.object({ status: z.enum(ORDER_STATUSES), reason: z.string().trim().max(2000).default(''), reviewToken: z.string().optional(), reviewed: z.boolean().optional() }).strict().parse(req.body);
        if (!(ORDER_TRANSITIONS[row.orderType][row.status] || []).includes(b.status))
            throw fail('That status change is not available.', 409);
        if (['approved', 'confirmed'].includes(b.status)) {
            if (!b.reviewed || b.reviewToken !== review(row).reviewToken)
                throw fail('Review the current order and quote comparison before approval.', 409);
            if (review(row).differences.length && !b.reason)
                throw fail('Explain how the quote differences were resolved.');
            if (row.orderType === 'customer' && (!row.customerPoNumber || !documents(row.id).some(d => d.kind === 'original_po')))
                throw fail('Add the actual customer PO number and original PO document before confirming.');
            if (!json(row.details).scope)
                throw fail('Describe the scope before approving.');
        }
        if (['sent', 'cancelled'].includes(b.status) && !b.reason)
            throw fail('Record the recipient/method or cancellation reason.');
        db.update(purchaseOrders).set({ status: b.status }).where(eq(purchaseOrders.id, row.id)).run();
        const next = load(row.id);
        record(req, next, b.status, b.reason);
        return present(next);
    })());
    route('post', '/api/finance/purchase-orders/:id/revise', req => sqlite.transaction(() => {
        const row = load(pid(req.params.id));
        checkVersion(req, row);
        assertNoReceipts(row.id);
        if (['cancelled', 'closed', 'received', 'invoiced'].includes(row.status))
            throw fail('This order is closed. Create a separate order for additional work.', 409);
        const b = z.object({ reason: z.string().trim().min(3).max(2000) }).strict().parse(req.body);
        record(req, row, 'revision_snapshot', b.reason);
        db.update(purchaseOrders).set({ revision: row.revision + 1, status: 'draft' }).where(eq(purchaseOrders.id, row.id)).run();
        const next = load(row.id);
        record(req, next, 'revised', b.reason);
        return present(next);
    })());
    route('delete', '/api/finance/purchase-orders/:id', req => sqlite.transaction(() => {
        const row = load(pid(req.params.id));
        checkVersion(req, row);
        if (row.status !== 'draft')
            throw fail('Only an unissued draft can be deleted. Cancel an issued order to preserve its history.');
        assertNoReceipts(row.id);
        record(req, row, 'deleted');
        db.update(purchaseOrders).set({ deletedAt: Date.now() }).where(eq(purchaseOrders.id, row.id)).run();
        return { ok: true };
    })());
    app.post('/api/finance/purchase-orders/:id/documents', requireElevated, (req, res) => {
        try {
            const row = load(pid(req.params.id));
            checkVersion(req, row);
            if (['cancelled', 'closed'].includes(row.status))
                throw fail('This order is closed.');
        }
        catch (e: any) {
            return res.status(e.status || 400).json({ message: e.message });
        }
        docUpload.single('file')(req, res, (error: any) => {
            try {
                if (error)
                    throw error;
                if (!req.file)
                    throw fail('Choose a document.');
                const result = sqlite.transaction(() => {
                    const row = load(pid(req.params.id));
                    checkVersion(req, row);
                    const kind = z.enum(['original_po', 'drawing', 'correspondence', 'delivery', 'other']).parse(req.body.kind || 'other');
                    if (documents(row.id).length >= 30)
                        throw fail('This order already has 30 documents.');
                    const file = req.file!, bytes = fs.readFileSync(file.path);
                    if (!DOC_EXT_TO_MIME[path.extname(file.originalname).toLowerCase()])
                        throw fail('Use a PDF, Word document or supported image.');
                    const privatePath = path.join(uploadsDir, 'po-documents', file.filename);
                    fs.renameSync(file.path, privatePath);
                    file.path = privatePath;
                    const filename = file.originalname.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 160);
                    sqlite.prepare('INSERT INTO fin_po_documents(po_id,revision,name,file,kind,size,sha256,document_date,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(row.id, row.revision, filename, file.filename, kind, file.size, crypto.createHash('sha256').update(bytes).digest('hex'), null, req.user!.userId, Date.now());
                    // Touch the order for optimistic concurrency and live query invalidation.
                    db.update(purchaseOrders).set({ notes: row.notes }).where(eq(purchaseOrders.id, row.id)).run();
                    record(req, load(row.id), 'document_added', `${kind}: ${filename}`);
                    return present(load(row.id));
                })();
                res.status(201).json(result);
            }
            catch (e: any) {
                if (req.file && fs.existsSync(req.file.path))
                    fs.unlinkSync(req.file.path);
                res.status(e.status || 400).json({ message: e.message });
            }
        });
    });
    app.get('/api/finance/purchase-orders/:id/documents/:documentId', requireElevated, (req, res) => {
        try {
            load(pid(req.params.id));
            const d: any = sqlite.prepare('SELECT * FROM fin_po_documents WHERE po_id=? AND id=?').get(pid(req.params.id), pid(req.params.documentId));
            if (!d)
                throw fail('Document not found.', 404);
            const file = path.join(uploadsDir, 'po-documents', path.basename(d.file));
            if (!fs.existsSync(file))
                throw fail('Document file is unavailable.', 404);
            res.setHeader('Content-Type', DOC_EXT_TO_MIME[path.extname(d.file)] || 'application/octet-stream');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`);
            res.sendFile(file);
        }
        catch (e: any) {
            res.status(e.status || 400).json({ message: e.message });
        }
    });
}
