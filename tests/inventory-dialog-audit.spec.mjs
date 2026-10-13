import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import { testApp } from '../scripts/test-app.mjs';

let app;
test.use({ actionTimeout: 15000 });
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await testApp({ serve: true });
  app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
});
test.afterAll(async () => app?.close());
test.beforeEach(async ({ page }) => {
  await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
  await page.addInitScript(token => localStorage.setItem('wpt-auth-token', token), app.owner);
});
const api = async (path, method = 'GET', body) => {
  const result = await app.api(path, method, body, app.owner);
  expect(result.status, JSON.stringify(result.data)).toBeLessThan(300);
  return result.data;
};
const item = () => api('/api/items', 'POST', {
  name: 'Inventory dialog ' + crypto.randomUUID().slice(0, 8), category: 'raw_materials',
  itemType: 'raw_material', unit: 'ft', quantity: 10, area: 'main_shop', rackLetter: 'A',
  supplier: 'Audit supplier', lastCostCents: 200, reorderTarget: 20,
});
async function openAction(page, row, name, more = false) {
  await page.goto(app.base + `/#/item/${row.id}`);
  if (more) await page.getByText('More actions', { exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  return page.getByRole('dialog');
}

for (const action of [
  { name: 'Count stock', more: true, field: 'I counted', value: '8', button: 'Record count', endpoint: 'adjust' },
  { name: 'Use on job', field: 'Quantity (ft)', value: '7', button: 'Use on job', endpoint: 'checkout' },
]) test(`${action.name} protects pending fields and retries a lost response once`, async ({ page }) => {
  const row = await item(), modal = await openAction(page, row, action.name, action.more);
  await modal.getByLabel(action.field, { exact: true }).fill(action.value);
  let detailUnavailable = false;
  await page.route(`**/api/items/${row.id}/detail`, r => detailUnavailable ? r.fulfill({ status: 503, json: { message: 'Item refresh interrupted' } }) : r.continue());
  let release, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/items/${row.id}/${action.endpoint}`, async r => {
    requests++;
    const response = await r.fetch();
    if (requests === 1) { await gate; detailUnavailable = action.endpoint === 'checkout'; return r.fulfill({ status: 503, json: { message: 'Confirmation interrupted. Retry.' } }); }
    await r.fulfill({ response });
  });
  try {
    await modal.getByRole('button', { name: action.button, exact: true }).click();
    await expect(modal.getByLabel(action.field, { exact: true })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
  } finally { release(); }
  await expect(modal.getByRole('alert')).toContainText('Confirmation interrupted');
  if (action.endpoint === 'checkout') await expect(page.getByText('Item refresh interrupted', { exact: true })).toBeVisible();
  await expect.poll(async () => (await api(`/api/items/${row.id}`)).quantity).toBe(action.endpoint === 'adjust' ? 8 : 3);
  await modal.getByRole('button', { name: action.button, exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(requests).toBe(2);
  expect((await api(`/api/items/${row.id}`)).quantity).toBe(action.endpoint === 'adjust' ? 8 : 3);
  expect(app.sqlite.prepare(`SELECT COUNT(*) n FROM ${action.endpoint === 'adjust' ? 'adjustments' : 'transactions'} WHERE item_id=?`).get(row.id).n).toBe(action.endpoint === 'adjust' ? 2 : 1);
});

for (const reservation of [false, true]) test(`${reservation ? 'Reservation' : 'Stock use'} job lookup retries without submitting and preserves the selected job`, async ({ page }) => {
  const row = await item();
  const job = await api('/api/projects', 'POST', { name: 'Original inventory job', jobNumber: 'INV-' + row.id });
  let unavailable = true, writes = 0;
  await page.route('**/api/inventory/jobs?*', r => unavailable ? r.fulfill({ status: 503, json: { message: 'Job lookup unavailable' } }) : r.continue());
  await page.route(`**/api/items/${row.id}/${reservation ? 'reservations' : 'checkout'}`, r => { writes++; return r.continue(); });
  const modal = await openAction(page, row, reservation ? 'Reserve for job' : 'Use on job', reservation);
  await expect(modal.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  unavailable = false;
  await modal.getByRole('button', { name: 'Retry', exact: true }).click();
  expect(writes).toBe(0);
  await modal.getByLabel('Job', { exact: true }).selectOption(String(job.id));
  const search = 'no-match-' + crypto.randomUUID();
  const searchLoaded = page.waitForResponse(response => response.url().includes('/api/inventory/jobs?q=' + search));
  await modal.getByLabel('Find job', { exact: true }).fill(search);
  await searchLoaded;
  await expect.poll(() => modal.getByLabel('Job', { exact: true }).locator('option').count()).toBe(2);
  await expect(modal.getByLabel('Job', { exact: true })).toHaveValue(String(job.id));
  await expect(modal.getByLabel('Job', { exact: true }).locator('option:checked')).toContainText('Original inventory job');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/items/${row.id}/${reservation ? 'reservations' : 'checkout'}`, async r => { const response = await r.fetch(); await gate; await r.fulfill({ response }); });
  try {
    await modal.getByRole('button', { name: reservation ? 'Reserve stock' : 'Use on job', exact: true }).click();
    await expect(modal.getByLabel('Job', { exact: true })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(modal).toHaveCount(0);
});

test('Tool return keeps its checkout available after a lost confirmation', async ({ page }) => {
  const row = await api('/api/items', 'POST', { name: 'Return audit drill', category: 'tools', itemType: 'tool', unit: 'each', quantity: 2, area: 'main_shop', rackLetter: 'T' });
  await api(`/api/items/${row.id}/checkout`, 'POST', { quantity: 2, requestKey: crypto.randomUUID() });
  const loan = (await api(`/api/items/${row.id}/availability`)).loans[0];
  const modal = await openAction(page, row, 'Return tool');
  await modal.getByLabel('Checkout being returned', { exact: true }).selectOption(String(loan.id));
  await modal.getByLabel('Quantity (each)', { exact: true }).fill('2');
  let requests = 0;
  await page.route(`**/api/items/${row.id}/checkin`, async r => {
    requests++; const response = await r.fetch();
    return requests === 1 ? r.fulfill({ status: 503, json: { message: 'Return confirmation interrupted' } }) : r.fulfill({ response });
  });
  await modal.getByRole('button', { name: 'Return tool', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Return confirmation interrupted');
  await expect.poll(async () => (await api(`/api/items/${row.id}/availability`)).loans.length).toBe(0);
  await expect(modal.getByLabel('Checkout being returned', { exact: true })).toHaveValue(String(loan.id));
  await modal.getByRole('button', { name: 'Return tool', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(requests).toBe(2);
  expect((await api(`/api/items/${row.id}`)).quantity).toBe(2);
});

test('Stock availability failure can be retried without losing entered notes', async ({ page }) => {
  const row = await item(); let unavailable = true;
  await page.route(`**/api/items/${row.id}/availability`, r => unavailable ? r.fulfill({ status: 503, json: { message: 'Stock lookup unavailable' } }) : r.continue());
  const modal = await openAction(page, row, 'Use on job');
  await modal.getByLabel('Notes (optional)', { exact: true }).fill('Keep this note');
  await expect(modal.getByRole('button', { name: 'Use on job', exact: true })).toBeDisabled();
  unavailable = false;
  await modal.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Use on job', exact: true })).toBeEnabled();
  await expect(modal.getByLabel('Notes (optional)', { exact: true })).toHaveValue('Keep this note');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
});

test('Reopening a stock dialog does not use cached availability after a failed refresh', async ({ page }) => {
  const row = await item(); let unavailable = false;
  await page.route(`**/api/items/${row.id}/availability`, r => unavailable ? r.fulfill({ status: 503, json: { message: 'Current stock lookup unavailable' } }) : r.continue());
  const modal = await openAction(page, row, 'Use on job');
  await expect(modal.getByRole('button', { name: 'Use on job', exact: true })).toBeEnabled();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  unavailable = true;
  await page.getByRole('button', { name: 'Use on job', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Current stock lookup unavailable');
  await expect(modal.getByRole('button', { name: 'Use on job', exact: true })).toBeDisabled();
  unavailable = false;
  await modal.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Use on job', exact: true })).toBeEnabled();
});

test('Restock stays protected while saving, closes cleanly and opens the created purchase order', async ({ page }) => {
  const row = await item();
  const modal = await openAction(page, row, 'Restock', true);
  await modal.getByLabel('Supplier', { exact: true }).fill('Confirmed audit supplier');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/inventory/restock', async r => { const response = await r.fetch(); await gate; await r.fulfill({ response }); });
  try {
    await modal.getByRole('button', { name: 'Create purchase order', exact: true }).click();
    await expect(modal.getByLabel('Supplier', { exact: true })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
  } finally { release(); }
  await expect(modal).toContainText('created for Confirmed audit supplier');
  const po = app.sqlite.prepare("SELECT * FROM fin_purchase_orders WHERE vendor='Confirmed audit supplier' ORDER BY id DESC").get();
  await expect(modal.getByRole('link', { name: 'Open purchase order', exact: true })).toHaveAttribute('href', new RegExp('po=' + po.id + '$'));
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.goto(app.base + `/#/finance/purchase-orders?po=${po.id}`);
  await expect(page.getByRole('dialog')).toContainText(po.number);
});

test('Receiving retries an outage and a lost confirmation without duplicating stock', async ({ page }) => {
  const row = await item();
  const po = await api('/api/inventory/restock', 'POST', { requestKey: crypto.randomUUID(), vendor: 'Receipt audit supplier', lines: [{ itemId: row.id, quantity: 10, unitCostCents: 200 }] });
  let unavailable = true;
  await page.route(`**/api/finance/purchase-orders/${po.id}/receiving`, r => unavailable ? r.fulfill({ status: 503, json: { message: 'Order lookup unavailable' } }) : r.continue());
  await page.goto(app.base + `/#/finance/purchase-orders?po=${po.id}`);
  await page.getByRole('button', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Receive delivery', exact: true }).click();
  const modal = page.getByRole('dialog', { name: /Receive delivery/ });
  await expect(modal.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  unavailable = false;
  await modal.getByRole('button', { name: 'Retry', exact: true }).click();
  await modal.getByLabel('Received this delivery (ft)', { exact: true }).fill('7');
  let release, requests = 0;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/finance/purchase-orders/${po.id}/receive`, async r => {
    requests++; const response = await r.fetch();
    if (requests === 1) { await gate; return r.fulfill({ status: 503, json: { message: 'Confirmation interrupted. Retry.' } }); }
    await r.fulfill({ response });
  });
  try {
    await modal.getByRole('button', { name: 'Record delivery', exact: true }).click();
    await expect(modal.getByLabel('Received this delivery (ft)', { exact: true })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
  } finally { release(); }
  await expect(modal.getByRole('alert')).toContainText('Confirmation interrupted');
  await expect.poll(async () => (await api(`/api/finance/purchase-orders/${po.id}/receiving`)).lines[0].remaining).toBe(3);
  await expect(modal.getByLabel('Received this delivery (ft)', { exact: true })).toHaveAttribute('max', '10');
  await modal.getByRole('button', { name: 'Record delivery', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(requests).toBe(2);
  expect((await api(`/api/items/${row.id}`)).quantity).toBe(17);
  expect(app.sqlite.prepare('SELECT COUNT(*) n FROM inventory_receipts WHERE po_id=?').get(po.id).n).toBe(1);
});
