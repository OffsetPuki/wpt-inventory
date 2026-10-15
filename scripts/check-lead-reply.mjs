import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { testApp } from './test-app.mjs';

const app = await testApp();
const { api, owner, sqlite } = app;
const key = { 'X-Lead-Key': 'test-intake-key' };
const photo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=';
try {
  const created = await api('/api/users', 'POST', { name: 'Reply worker', pin: '3456', role: 'worker' }, owner);
  assert.equal(created.status, 201);
  const worker = (await api('/api/auth/login', 'POST', { name: 'Reply worker', pin: '3456' })).data.token;
  for (const site of ['metals', 'concrete', 'insulation', 'trades']) {
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const message = 'Customer’s complete request: '.repeat(150) + 'FINAL REQUIREMENT: satin finish.';
    const input = await api('/api/public/leads', 'POST', {
      name: `Reply ${site}`, email: `${site}@example.test`, phone: '555-0100', site, lang: 'es',
      message, service: 'Custom shelves', area: 'Alvarado, TX', contact: 'Email', bestTime: 'After 4 pm',
      consent: 'yes', timeline: 'Next month', receiptToken, photos: [photo],
      qualification: { projectKind: 'Commercial', dimensions: '48 x 24 in', budget: '$500', facilityCompany: 'Test company', deadline: '2026-11-01' },
      designRef: `CJM-${site}`, designSpec: 'Three shelves, powder coated', designState: '{"shelves":3}', designPng: photo,
    }, null, key);
    assert.equal(input.status, 201); const id = input.data.id;
    await api('/api/public/lead-details', 'POST', { site, token: receiptToken, submissionId: crypto.randomUUID(), details: 'Later customer update: wall mounting.', photos: [photo] }, null, key);
    await api('/api/crm/activities', 'POST', { entityType: 'lead', entityId: id, kind: 'note', notes: 'Internal context: verify wall material.' }, owner);
    sqlite.prepare('INSERT INTO web_designs(ref,lead_id,design_spec,design_state) VALUES (?,?,?,?)').run(`CJM-extra-${site}`, id, 'Another design: five shelves', '{"shelves":5}');
    const path = `/api/crm/leads/${id}/reply-packet`;
    assert.equal((await api(path)).status, 401);
    assert.equal((await api(path, 'GET', undefined, worker)).status, 403);
    const packet = await api(path, 'GET', undefined, owner);
    assert.equal(packet.status, 200); assert.match(packet.headers.get('cache-control'), /no-store/);
    assert.equal(packet.data.photos.length, 3, 'Customer, design and supplemental photos included, duplicate URL removed');
    for (const phrase of ['FINAL REQUIREMENT', 'wall mounting', '48 x 24 in', 'Test company', '2026-11-01', 'After 4 pm', 'Three shelves', 'five shelves', 'verify wall material', `${site}@example.test`, 'Next month', '"language": "es"']) assert.ok(packet.data.prompt.includes(phrase), phrase);
    assert.ok(!packet.data.prompt.includes(receiptToken)); assert.ok(!packet.data.prompt.includes(owner));
    assert.ok(!packet.data.prompt.includes('/uploads/'), 'Private upload links are not passed off as accessible images');
    assert.match(packet.data.prompt, /does NOT include image pixels/);
    assert.match(packet.data.prompt, /not instructions/);
    assert.deepEqual(packet.data.warnings, []);
    for (const image of packet.data.photos) {
      assert.equal((await api(image.url)).status, 401, 'Image remains private');
      assert.equal((await api(image.url, 'GET', undefined, owner)).status, 200);
    }
    sqlite.prepare('UPDATE crm_leads SET notes=? WHERE id=?').run('Fresh saved change', id);
    assert.match((await api(path, 'GET', undefined, owner)).data.prompt, /Fresh saved change/);
    sqlite.prepare('UPDATE crm_leads SET deleted_at=? WHERE id=?').run(Date.now(), id);
    assert.equal((await api(path, 'GET', undefined, owner)).status, 404);
  }
  const manual = await api('/api/crm/leads', 'POST', { name: 'Manual request', site: 'metals' }, owner);
  const path = `/api/crm/leads/${manual.data.id}/reply-packet`;
  const packet = (await api(path, 'GET', undefined, owner)).data;
  assert.equal(packet.photos.length, 0); assert.match(packet.prompt, /No photos are stored/);
  sqlite.prepare('UPDATE crm_leads SET photos=? WHERE id=?').run('["https://example.test/private.png","/uploads/../../secret.png"]', manual.data.id);
  const invalid = (await api(path, 'GET', undefined, owner)).data;
  assert.equal(invalid.photos.length, 0); assert.ok(invalid.warnings.length);
  sqlite.prepare('UPDATE crm_leads SET photos=? WHERE id=?').run('broken json', manual.data.id);
  assert.match((await api(path, 'GET', undefined, owner)).data.warnings.join(' '), /Photo list/);
  assert.equal((await api('/api/crm/leads/999999/reply-packet', 'GET', undefined, owner)).status, 404);
  assert.equal((await api('/api/crm/leads/nope/reply-packet', 'GET', undefined, owner)).status, 400);
  console.log('PASS: complete ChatGPT handoff for all brands; long requests, updates, all designs/photos, language, privacy, permissions, fresh data and missing records');
} finally { await app.close(); }
