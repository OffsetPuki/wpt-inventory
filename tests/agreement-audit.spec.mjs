import { test, expect } from '@playwright/test';
import { testApp } from '../scripts/test-app.mjs';
test.use({ actionTimeout: 15000 });
let app;
test.beforeAll(async () => { test.setTimeout(180000); app = await testApp({ serve: true }); app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run(); });
test.afterAll(async () => app?.close());
test.beforeEach(async ({ page }) => {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.addInitScript(token => localStorage.setItem('wpt-auth-token', token), app.owner);
});
const create = async (url, body) => { const r = await app.api(url, 'POST', body, app.owner); expect(r.status).toBe(201); return r.data; };
const pdf = { name: 'signed-audit.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') };
const job = () => create('/api/projects', { name: 'Agreement audit job', jobNumber: 'AUDIT-' + Date.now() });
const contract = projectId => create('/api/pm/contracts', { title: 'Audit agreement', kind: 'other', projectId, body: 'Fabrication scope.' });
const card = (page, title) => page.getByRole('heading', { name: title, exact: true }).locator('..');

test('A failed signed-copy upload stays open and retries without creating a duplicate contract', async ({ page }) => {
  await page.goto(app.base + '/#/pm/contracts');
  await page.getByRole('button', { name: 'New contract', exact: true }).first().click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Title', { exact: true }).fill('Retry upload agreement');
  await modal.locator('input[type=file]').setInputFiles(pdf);
  let unavailable = true, release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/pm/contracts/*/file', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    if (unavailable) return r.fulfill({ status: 503, json: { message: 'Attachment service unavailable' } });
    const response = await r.fetch(); await gate; await r.fulfill({ response });
  });
  await modal.getByRole('button', { name: 'Create contract', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Contract saved');
  await expect(modal.getByText(pdf.name, { exact: true })).toBeVisible();
  expect(app.sqlite.prepare("SELECT count(*) AS n FROM pm_contracts WHERE title='Retry upload agreement'").get().n).toBe(1);
  await modal.getByLabel('Notes (optional)', { exact: true }).fill('Retained while retrying');
  unavailable = false;
  try {
    await modal.getByRole('button', { name: 'Retry save & upload', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await expect(modal.getByLabel('Title', { exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(page.getByRole('dialog', { name: 'Retry upload agreement', exact: true })).toBeVisible();
  const rows = app.sqlite.prepare("SELECT * FROM pm_contracts WHERE title='Retry upload agreement'").all();
  expect(rows).toHaveLength(1); expect(rows[0].file_url).toBeTruthy(); expect(rows[0].notes).toBe('Retained while retrying');
});

test('Removing a signed copy can be cancelled and later editing keeps the current version', async ({ page }) => {
  const row = await contract(), url = `/api/pm/contracts/${row.id}`;
  expect((await page.request.post(app.base + url + '/file', { headers: { 'X-Auth': app.owner }, multipart: { file: pdf } })).ok()).toBe(true);
  await page.goto(app.base + `/#/pm/contracts?contract=${row.id}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit contract', exact: true });
  await editor.getByRole('button', { name: 'Remove', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Remove signed copy?', exact: true });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(editor.getByText('A signed copy is attached')).toBeVisible();
  await editor.getByRole('button', { name: 'Remove', exact: true }).click();
  await confirm.getByRole('button', { name: 'Remove signed copy', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await editor.getByLabel('Title', { exact: true }).fill('Updated after file removal');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  const saved = (await app.api(url, 'GET', undefined, app.owner)).data;
  expect(saved.title).toBe('Updated after file removal'); expect(saved.fileUrl).toBeNull();
  await page.goto(app.base + `/#/pm/contracts?contract=${row.id}`);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.getByRole('button', { name: 'Delete', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete contract?', exact: true });
  await expect(deletion).toContainText('Updated after file removal');
  await deletion.getByRole('button', { name: 'Delete contract', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await app.api(url, 'GET', undefined, app.owner)).status).toBe(404);
});

test('Job contract cards show outages and open the saved contract directly', async ({ page }) => {
  const project = await job(), row = await contract(project.id);
  await page.route('**/api/suite/events', r => r.abort());
  let unavailable = true;
  await page.route(`**/api/pm/contracts?projectId=${project.id}`, r => unavailable ? r.fulfill({ status: 503, json: { message: 'Contracts unavailable' } }) : r.continue());
  await page.goto(app.base + `/#/project/${project.id}?tab=files`);
  const section = card(page, 'Contracts');
  await expect(section.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(section.getByText('No contract on this job yet.')).toHaveCount(0);
  unavailable = false; await section.getByRole('button', { name: 'Retry', exact: true }).click();
  await section.getByRole('link', { name: row.title, exact: true }).click();
  await expect(page.getByRole('dialog', { name: row.title, exact: true })).toBeVisible();
});

test('Change orders recover from outages, clear discarded edits and confirm price changes', async ({ page }) => {
  const project = await job();
  await page.route('**/api/suite/events', r => r.abort());
  let unavailable = true;
  await page.route(`**/api/pm/change-orders?projectId=${project.id}`, r => unavailable ? r.fulfill({ status: 503, json: { message: 'Changes unavailable' } }) : r.continue());
  await page.goto(app.base + `/#/project/${project.id}?tab=money`);
  const section = card(page, 'Change orders').locator('..');
  await expect(section.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(section.getByText(/No change orders/)).toHaveCount(0);
  unavailable = false; await section.getByRole('button', { name: 'Retry', exact: true }).click();
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'New change order', exact: true });
  await editor.getByLabel('Title', { exact: true }).fill('Discard this');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(editor.getByLabel('Title', { exact: true })).toHaveValue('');
  await editor.getByLabel('Title', { exact: true }).fill('Extra railing');
  await editor.getByLabel('Amount $', { exact: false }).fill('250');
  await editor.getByLabel('Description (optional)').fill('Add twenty feet of railing.');
  let release; const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/pm/change-orders', async r => { if (r.request().method() !== 'POST') return r.continue(); const response = await r.fetch(); await gate; await r.fulfill({ response }); });
  try {
    await editor.getByRole('button', { name: 'Add change order', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await expect(editor.getByLabel('Amount $', { exact: false })).toBeDisabled();
  } finally { release(); }
  await expect(editor).toHaveCount(0);
  await expect(section.getByText('Add twenty feet of railing.', { exact: true })).toBeVisible();
  await section.getByRole('button', { name: 'Approve', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: 'Approve change order?', exact: true });
  await expect(confirm).toContainText('$250');
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(app.sqlite.prepare('SELECT status FROM pm_change_orders WHERE project_id=?').get(project.id).status).toBe('draft');
  await section.getByRole('button', { name: 'Approve', exact: true }).click();
  await confirm.getByRole('button', { name: 'Approve change order', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await section.getByRole('button', { name: 'Void', exact: true }).click();
  confirm = page.getByRole('dialog', { name: 'Void change order?', exact: true });
  await expect(confirm).toContainText('Extra railing');
  await confirm.getByRole('button', { name: 'Void change order', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect(app.sqlite.prepare('SELECT status FROM pm_change_orders WHERE project_id=?').get(project.id).status).toBe('void');
});

test('A stale signed-copy request cannot remove a newer attachment', async ({ page }) => {
  const row = await contract(), url = `/api/pm/contracts/${row.id}`;
  const first = await page.request.post(app.base + url + '/file', { headers: { 'X-Auth': app.owner }, multipart: { file: pdf } });
  expect(first.ok()).toBe(true);
  const old = (await app.api(url, 'GET', undefined, app.owner)).data;
  const replace = await page.request.post(app.base + url + '/file', { headers: { 'X-Auth': app.owner, 'If-Match': `"${old._version}"` }, multipart: { file: { ...pdf, name: 'new-signed-copy.pdf' } } });
  expect(replace.ok()).toBe(true);
  const stale = await page.request.delete(app.base + url + '/file', { headers: { 'X-Auth': app.owner, 'If-Match': `"${old._version}"` } });
  expect(stale.status()).toBe(409);
  const staleUpload = await page.request.post(app.base + url + '/file', { headers: { 'X-Auth': app.owner, 'If-Match': `"${old._version}"` }, multipart: { file: pdf } });
  expect(staleUpload.status()).toBe(409);
  expect((await app.api(url, 'GET', undefined, app.owner)).data.fileUrl).toBe((await replace.json()).fileUrl);
});
