import { test, expect } from '@playwright/test';
import { testApp } from '../scripts/test-app.mjs';

let app;
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
const create = async (url, body) => {
  const response = await app.api(url, 'POST', body, app.owner);
  expect(response.status).toBe(201);
  return response.data;
};
const invoice = () => create('/api/finance/invoices', { clientName: 'Payment audit customer', items: [{ description: 'Welding', qty: 1, unitPriceCents: 10000 }] });
const documents = page => page.getByRole('heading', { name: 'Company documents', exact: true }).locator('../..');

test('Document outages show recovery instead of an empty folder', async ({ page }) => {
  await page.route('**/api/suite/events', r => r.abort());
  let unavailable = true;
  await page.route('**/api/pm/documents?company=1', r => unavailable ? r.fulfill({ status: 503, json: { message: 'Documents temporarily unavailable' } }) : r.continue());
  await page.goto(app.base + '/#/settings');
  const card = documents(page);
  await expect(card.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(card.getByText(/Nothing here yet/)).toHaveCount(0);
  unavailable = false;
  await card.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(card.getByText(/Nothing here yet/)).toBeVisible();
});

test('Document uploads protect pending work and deletion has recoverable confirmation', async ({ page }) => {
  await page.goto(app.base + '/#/settings');
  const card = documents(page);
  await card.getByRole('button', { name: 'Upload', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Upload document', exact: true });
  await modal.getByLabel('Title (optional)').fill('Audit document');
  await modal.locator('input[type=file]').setInputFiles({ name: 'audit-document.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/pm/documents', async r => {
    if (r.request().method() !== 'POST') return r.continue();
    const response = await r.fetch(); await gate; await r.fulfill({ response });
  });
  try {
    await modal.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await expect(modal.getByLabel('Title (optional)')).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
  } finally { release(); }
  await expect(modal).toHaveCount(0);
  const row = card.getByRole('listitem').filter({ hasText: 'Audit document' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Delete/ }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete document?', exact: true });
  await expect(confirmation).toContainText('Audit document');
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(row).toBeVisible();
  let unavailable = true;
  await page.route('**/api/pm/documents/*', r => r.request().method() === 'DELETE' && unavailable ? r.fulfill({ status: 503, json: { message: 'Try deleting again' } }) : r.continue());
  await row.getByRole('button', { name: /Delete/ }).click();
  await confirmation.getByRole('button', { name: 'Delete document', exact: true }).click();
  await expect(confirmation.getByRole('alert')).toContainText('Try deleting again');
  unavailable = false;
  await confirmation.getByRole('button', { name: 'Delete document', exact: true }).click();
  await expect(confirmation).toHaveCount(0); await expect(row).toHaveCount(0);
  await card.getByRole('button', { name: 'Upload', exact: true }).click();
  await modal.getByLabel('Title (optional)').fill('Discarded upload title');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await card.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(modal.getByLabel('Title (optional)')).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('Payment dialog retains edits, protects slow saves and closes cleanly after payment', async ({ page }) => {
  const row = await invoice(), url = `/api/finance/invoices/${row.id}`;
  expect((await app.api(url, 'PATCH', { status: 'sent' }, app.owner)).status).toBe(200);
  await page.goto(app.base + `/#/finance/invoices?invoice=${row.id}`);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Record payment', exact: true });
  await expect(payment).toBeVisible();
  await payment.getByLabel('Reference', { exact: true }).fill('AUDIT-PAID');
  await page.screenshot({ path: 'test-results/payment-dialog-mobile.png', animations: 'disabled' });
  await payment.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(payment.getByLabel('Reference', { exact: true })).toHaveValue('AUDIT-PAID');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**${url}/payments`, async r => { const response = await r.fetch(); await gate; await r.fulfill({ response }); });
  try {
    await payment.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(payment.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await expect(payment.getByLabel('Amount $', { exact: true })).toBeDisabled();
    // The live invoice may already become Paid while the payment response is delayed.
    await expect(page.getByRole('dialog').first()).toContainText('Paid');
    await page.keyboard.press('Escape'); await expect(payment).toBeVisible();
  } finally { release(); }
  await expect(payment).toHaveCount(0);
  const saved = (await app.api(url, 'GET', undefined, app.owner)).data;
  expect(saved.payments).toHaveLength(1); expect(saved.invoice.paidCents).toBe(10000);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Invoice reversal, void and deletion clearly confirm the selected action', async ({ page }) => {
  const row = await invoice(), url = `/api/finance/invoices/${row.id}`;
  await app.api(url, 'PATCH', { status: 'sent' }, app.owner);
  await create(url + '/payments', { amountCents: 2500, method: 'cash' });
  await page.goto(app.base + `/#/finance/invoices?invoice=${row.id}`);
  await page.getByRole('button', { name: 'Reverse payment', exact: true }).click();
  let confirm = page.getByRole('dialog', { name: 'Reverse payment?', exact: true });
  await expect(confirm).toContainText('$25 payment');
  await page.screenshot({ path: 'test-results/payment-confirmation-mobile.png', animations: 'disabled' });
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await app.api(url, 'GET', undefined, app.owner)).data.payments).toHaveLength(1);
  await page.getByRole('button', { name: 'Reverse payment', exact: true }).click();
  await confirm.getByRole('button', { name: 'Reverse payment', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('button', { name: 'Void', exact: true }).click();
  confirm = page.getByRole('dialog', { name: 'Void invoice?', exact: true });
  await expect(confirm).toContainText(row.number);
  await confirm.getByRole('button', { name: 'Void invoice', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  confirm = page.getByRole('dialog', { name: 'Delete invoice?', exact: true });
  await expect(confirm).toContainText(row.number);
  await confirm.getByRole('button', { name: 'Delete invoice', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect((await app.api(url, 'GET', undefined, app.owner)).status).toBe(404);
});

test('Retrying a lost payment response keeps the form and records the payment once', async ({ page }) => {
  const row = await invoice(), url = `/api/finance/invoices/${row.id}`;
  await app.api(url, 'PATCH', { status: 'sent' }, app.owner);
  await page.goto(app.base + `/#/finance/invoices?invoice=${row.id}`);
  await page.getByRole('button', { name: 'Record payment', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Record payment', exact: true });
  await modal.getByLabel('Reference', { exact: true }).fill('RECOVER-PAYMENT');
  let first = true;
  await page.route(`**${url}/payments`, async r => {
    if (!first) return r.continue();
    first = false; await r.fetch();
    await r.fulfill({ status: 503, json: { message: 'Payment response interrupted' } });
  });
  await modal.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Payment response interrupted');
  await expect(modal.getByLabel('Reference', { exact: true })).toHaveValue('RECOVER-PAYMENT');
  await modal.getByRole('button', { name: 'Record payment', exact: true }).click();
  await expect(modal).toHaveCount(0);
  const saved = (await app.api(url, 'GET', undefined, app.owner)).data;
  expect(saved.payments).toHaveLength(1); expect(saved.invoice.paidCents).toBe(10000);
});

test('Purchase order saves block overlapping actions and document outages offer retry', async ({ page }) => {
  const row = await create('/api/finance/purchase-orders', { orderType: 'supplier', vendor: 'Audit steel supplier', items: [{ description: 'Steel', qty: 1, unitPriceCents: 5000 }] });
  const url = `/api/finance/purchase-orders/${row.id}`;
  await page.goto(app.base + `/#/finance/purchase-orders?po=${row.id}`);
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Supplier / vendor', { exact: true }).fill('Updated audit supplier');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route(`**${url}`, async r => {
    if (r.request().method() !== 'PATCH') return r.continue();
    const response = await r.fetch(); await gate; await r.fulfill({ response });
  });
  try {
    await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    await expect(modal.getByRole('button', { name: 'Review', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
  } finally { release(); }
  await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeEnabled();
  expect((await app.api(url, 'GET', undefined, app.owner)).data.vendor).toBe('Updated audit supplier');
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.route(`**${url}/detail`, r => r.fulfill({ status: 503, json: { message: 'Order documents unavailable' } }));
  await page.reload(); await page.goto(app.base + `/#/finance/purchase-orders?po=${row.id}`);
  await modal.getByRole('button', { name: 'Documents', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
});

for (const mode of ['details', 'editor']) test(`Invoice ${mode} waits for attachments before closing or saving`, async ({ page }) => {
  const row = await invoice(), url = `/api/finance/invoices/${row.id}`;
  await page.goto(app.base + `/#/finance/invoices?invoice=${row.id}`);
  if (mode === 'editor') await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const modal = page.getByRole('dialog');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/finance/attachments', async r => { const response = await r.fetch(); await gate; await r.fulfill({ response }); });
  try {
    await modal.locator('input[type=file]').setInputFiles({ name: 'audit-invoice.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
    await expect(modal.getByRole('button', { name: 'Close', exact: true })).toBeDisabled();
    if (mode === 'editor') await expect(modal.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
  } finally { release(); }
  await expect(modal.getByText('audit-invoice.pdf', { exact: true })).toBeVisible();
  if (mode === 'editor') await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect.poll(async () => {
    const saved = (await app.api(url, 'GET', undefined, app.owner)).data.invoice.attachments;
    return (typeof saved === 'string' ? JSON.parse(saved) : saved).map(file => file.name);
  }).toEqual(['audit-invoice.pdf']);
  if (mode === 'details') await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});
