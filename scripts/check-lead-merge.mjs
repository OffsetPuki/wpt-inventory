import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { testApp } from './test-app.mjs';

const app = await testApp();
const { api, owner, sqlite } = app;
const { LEAD_MERGE_REFERENCES, LEAD_MERGE_SPECIAL } = await import('../server/lead-merge.ts');
const insert = (table, values) => Number(sqlite.prepare(`INSERT INTO ${table}(${Object.keys(values).join(',')}) VALUES(${Object.keys(values).map(() => '?').join(',')})`).run(...Object.values(values)).lastInsertRowid);
const lead = (values = {}) => insert('crm_leads', { name: 'Synthetic Neal', site: 'metals', ...values });
const preview = (source, target) => api(`/api/crm/lead-merge/preview?source=${source}&target=${target}`, 'GET', undefined, owner);
const body = (source, target, version) => ({ source, target, version, requestKey: crypto.randomUUID(), reviewed: true });
const merge = b => api('/api/crm/lead-merge', 'POST', b, owner);
try {
  const references = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name).filter(t => sqlite.pragma(`table_info(${t})`).some(c => c.name === 'lead_id')).sort();
  assert.deepEqual(references, [...LEAD_MERGE_REFERENCES, ...LEAD_MERGE_SPECIAL].sort(), 'Every lead reference needs an explicit merge policy');
  const source = lead({ phone: '(469) 735-3836', source: 'website', notes: 'Original fence request', photos: '["/uploads/fence.png"]', service_requested: 'Fence', preferred_language: 'es', created_at: 10000 });
  const target = lead({ phone: '14697353836', source: 'other', stage: 'quote_sent', notes: 'Quote discussion', photos: '["/uploads/frame.png","/uploads/fence.png"]', estimated_value_cents: 120000, created_at: 20000 });
  const deleted = lead({ phone: '4697353836', deleted_at: Date.now() });
  const differentSite = lead({ phone: '4697353836', site: 'concrete' });
  const receiptToken = crypto.randomBytes(32).toString('hex'), tokenHash = crypto.createHash('sha256').update(receiptToken).digest('hex');
  const refs = {
    quotes: { number: 'Q-MERGE', type: 'custom', status: 'accepted', total_cents: 120000, payload: '{"customer":{"name":"Frozen name"},"state":{"price":1200}}', share_token: 'unchanged-quote-token' },
    projects: { job_number: 'JOB-MERGE', name: 'Fence build' },
    fin_invoices: { number: 'INV-MERGE', client_name: 'Frozen name', total_cents: 120000, paid_cents: 60000, status: 'partial', share_token: 'unchanged-invoice-token' },
    fin_purchase_orders: { number: 'PO-MERGE', vendor: 'Supplier', quote_snapshot: '{"price":1200}', total_cents: 50000 },
    pm_tasks: { title: 'Follow up on fence', kind: 'follow_up', auto_key: `auto:lead-follow-up:${source}` },
    mk_tasks: { title: 'Legacy task' },
    review_requests: { token: 'review-token', name: 'Neal', email: 'neal@example.test' },
    web_designs: { ref: 'CJM-MERGE', design_spec: 'Fence dimensions', design_png_url: '/uploads/design.png' },
    web_lead_receipts: { submission_id: crypto.randomUUID(), created_at: Date.now(), payload_hash: 'original-hash' },
    web_lead_access: { token_hash: tokenHash, site: 'metals', expires_at: Date.now() + 86400000 },
  };
  for (const [table, values] of Object.entries(refs)) insert(table, { lead_id: source, ...values });
  insert('crm_activities', { entity_type: 'lead', entity_id: source, kind: 'call', notes: 'Spoke about fence', user_id: 1 });
  insert('crm_activities', { entity_type: 'lead', entity_id: target, kind: 'note', notes: 'Quoted fence', user_id: 1 });
  insert('crm_lead_intake', { lead_id: source, context: '{"contact":"Text","qualification":{"dimensions":"20 feet","budget":"1000"}}', first_contact_at: 30000, survey_at: 80000, updated_at: 30000 });
  insert('crm_lead_intake', { lead_id: target, context: '{"qualification":{"budget":"1200"}}', first_contact_at: 40000, updated_at: 40000 });
  for (const id of [source, target]) {
    insert('mk_lead_attribution', { lead_id: id, site: 'metals', first_touch: '{}', last_touch: '{}', entry_site: 'metals', landing_page: '/', submitted_page: '/', analytics_consent: 1, client_id: `${id}.12345`, created_at: 10000, updated_at: 10000 });
  }
  insert('mk_measurement_events', { lead_id: source, site: 'metals', event_name: 'qualified_lead', occurred_at: 30000, state: 'sent', updated_at: 30000 });
  insert('mk_measurement_events', { lead_id: source, site: 'metals', event_name: 'working_lead', occurred_at: 30000, state: 'accepted', updated_at: 30000 });
  insert('mk_measurement_events', { lead_id: target, site: 'metals', event_name: 'working_lead', occurred_at: 30000, state: 'pending', updated_at: 30000 });
  const workerResult = await api('/api/users', 'POST', { name: 'Merge worker', pin: '3456', role: 'worker' }, owner);
  assert.equal(workerResult.status, 201);
  const worker = (await api('/api/auth/login', 'POST', { name: 'Merge worker', pin: '3456' })).data.token;
  for (const url of [`/api/crm/lead-merge/candidates?lead=${target}`, `/api/crm/lead-merge/preview?source=${source}&target=${target}`]) {
    assert.equal((await api(url)).status, 401); assert.equal((await api(url, 'GET', undefined, worker)).status, 403);
  }
  assert.equal((await api('/api/crm/lead-merge', 'POST', {}, worker)).status, 403);
  const candidates = await api(`/api/crm/lead-merge/candidates?lead=${target}`, 'GET', undefined, owner);
  assert.equal(candidates.status, 200); assert.match(candidates.headers.get('cache-control'), /no-store/);
  assert.deepEqual(candidates.data.map(r => [r.id, r.match]), [[source, 'Same phone']]);
  assert.equal((await preview(source, source)).status, 400);
  assert.equal((await preview(source, deleted)).status, 409);
  assert.equal((await preview(source, differentSite)).status, 400);
  const old = (await preview(source, target)).data;
  sqlite.prepare("UPDATE web_designs SET design_spec='Updated fence dimensions' WHERE lead_id=?").run(source);
  assert.equal((await merge(body(source, target, old.version))).status, 409, 'Reject updates made during review');
  const p = await preview(source, target); assert.equal(p.status, 200); assert.equal(p.data.photos, 2); assert.equal(p.data.quotes, 1);
  const b = body(source, target, p.data.version);
  const immutable = Object.fromEntries(['quotes', 'fin_invoices', 'fin_purchase_orders'].map(t => [t, sqlite.prepare(`SELECT * FROM ${t} WHERE lead_id=?`).get(source)]));
  sqlite.exec("CREATE TRIGGER test_merge_failure BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT,'Injected failure'); END");
  assert.equal((await merge(b)).status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM crm_lead_merges').get().n, 0, 'Failure rolls back archive and every move');
  assert.equal(sqlite.prepare('SELECT notes FROM crm_leads WHERE id=?').get(target).notes, 'Quote discussion');
  sqlite.exec('DROP TRIGGER test_merge_failure');
  const result = await merge(b); assert.equal(result.status, 200, JSON.stringify(result.data)); assert.equal(result.data.id, target);
  assert.deepEqual((await merge(b)).data, result.data, 'Exact retry returns original result');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM crm_lead_merges').get().n, 1);
  for (const table of LEAD_MERGE_REFERENCES) assert.equal(sqlite.prepare(`SELECT COUNT(*) n FROM ${table} WHERE lead_id=?`).get(source).n, 0, `${table} relinked`);
  const combined = (await api(`/api/crm/leads/${target}`, 'GET', undefined, owner)).data;
  assert.equal(combined.stage, 'quote_sent'); assert.equal(combined.estimatedValueCents, 120000); assert.equal(combined.serviceRequested, 'Fence');
  assert.match(combined.notes, /Original fence request/); assert.match(combined.notes, /Quote discussion/); assert.match(combined.notes, /20 feet/);
  assert.deepEqual(JSON.parse(combined.photos), ['/uploads/frame.png', '/uploads/fence.png']);
  assert.equal(new Date(combined.createdAt).getTime(), 10000);
  const intake = (await api(`/api/crm/leads/${target}/intake`, 'GET', undefined, owner)).data;
  assert.equal(intake.context.contact, 'Text'); assert.equal(intake.context.qualification.dimensions, '20 feet'); assert.equal(intake.context.qualification.budget, '1200');
  assert.equal(intake.first_contact_at, 30000); assert.equal(intake.survey_at, 80000);
  assert.equal(sqlite.prepare('SELECT auto_key FROM pm_tasks WHERE lead_id=?').get(target).auto_key, `auto:lead-follow-up:${target}`);
  for (const [table, before] of Object.entries(immutable)) {
    const after = sqlite.prepare(`SELECT * FROM ${table} WHERE id=?`).get(before.id);
    for (const key of ['lead_id', 'version', 'revision']) { delete before[key]; delete after[key]; }
    assert.deepEqual(after, before, `${table} issued contents, prices, status and payments untouched`);
  }
  assert.equal(sqlite.prepare('SELECT state FROM mk_measurement_events WHERE lead_id=? AND event_name=?').get(target, 'qualified_lead').state, 'merged');
  assert.equal(sqlite.prepare('SELECT state FROM mk_measurement_events WHERE lead_id=? AND event_name=?').get(target, 'working_lead').state, 'merged');
  assert.equal(sqlite.prepare('SELECT state FROM mk_measurement_events WHERE lead_id=? AND event_name=?').get(source, 'qualified_lead').state, 'sent');
  assert.equal((await api(`/api/crm/leads/${source}`, 'GET', undefined, owner)).data.id, target, 'Old link resolves to survivor');
  assert.equal((await api(`/api/crm/leads/${source}/restore`, 'POST', {}, owner)).status, 409);
  assert.ok(!(await api('/api/crm/leads/deleted', 'GET', undefined, owner)).data.some(r => r.id === source));
  assert.notEqual((await api(`/api/crm/leads/${source}`, 'PATCH', { name: 'Stale editor' }, owner)).status, 200);
  assert.equal((await api('/api/crm/activities', 'POST', { entityType: 'lead', entityId: source, kind: 'note', notes: 'Stale activity' }, owner)).status, 409);
  const supplement = await api('/api/public/lead-details', 'POST', { site: 'metals', token: receiptToken, submissionId: crypto.randomUUID(), details: 'Customer update after merge' }, null, { 'X-Lead-Key': 'test-intake-key' });
  assert.equal(supplement.status, 200, JSON.stringify(supplement.data));
  const packet = (await api(`/api/crm/leads/${target}/reply-packet`, 'GET', undefined, owner)).data;
  for (const detail of ['Original fence request', 'Quote discussion', 'Spoke about fence', '20 feet', 'Updated fence dimensions', 'Customer update after merge']) assert.ok(packet.prompt.includes(detail), detail);
  assert.equal(packet.photos.length, 3);
  sqlite.prepare('UPDATE crm_leads SET photos=? WHERE id=?').run(JSON.stringify(Array.from({length: 14}, (_, i) => `/uploads/merged-${i}.png`)), target);
  assert.equal((await api('/api/public/lead-details', 'POST', { site: 'metals', token: receiptToken, submissionId: crypto.randomUUID(), details: 'Text still works with a combined photo collection' }, null, { 'X-Lead-Key': 'test-intake-key' })).status, 200);
  const next = lead({ phone: '4697353836' });
  const nextPreview = await preview(target, next);
  assert.equal((await merge(body(target, next, nextPreview.data.version))).status, 200);
  assert.equal((await api(`/api/crm/leads/${source}`, 'GET', undefined, owner)).data.id, next, 'Chains of merges retain old links');
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM mk_lead_attribution WHERE lead_id=?').get(next).n, 1, 'Original attribution moves when survivor has none');
  const a = lead({ client_id: insert('crm_clients', { name: 'Customer A' }) }), c = lead({ client_id: insert('crm_clients', { name: 'Customer B' }) });
  assert.equal((await preview(a, c)).status, 400, 'Do not silently join different customer accounts');
  const malformed = lead({ photos: 'broken json' });
  assert.equal((await preview(malformed, next)).status, 400);
  console.log('PASS: lead merging preserves all references, photos, intake, history, immutable documents, receipts and old links; permissions, fresh review, atomic rollback and retry safety verified');
} finally { await app.close(); }
