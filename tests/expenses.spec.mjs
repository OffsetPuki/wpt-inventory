import { test, expect } from '@playwright/test';
import { testApp } from '../scripts/test-app.mjs';

let app;
test.beforeAll(async () => {
  test.setTimeout(180000);
  app = await testApp({ serve: true });
  app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
});
test.afterAll(async () => app?.close());

test('Saved expense opens from its record link with receipt and editable details', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.addInitScript(token => localStorage.setItem('wpt-auth-token', token), app.owner);
  await page.setContent('<article style="width:280px;padding:24px;background:white;color:black;font:18px monospace"><h2>Test Steel Supply</h2><p>Welding supplies</p><hr><p>Total: $124.50</p><p>Test receipt</p></article>');
  const receipt = await page.locator('article').screenshot();
  const job = await app.api('/api/projects', 'POST', { jobNumber: 'EXP-TEST', name: 'Expense test job' }, app.owner);
  expect(job.status).toBe(201);

  await page.goto(app.base + '/#/finance/expenses');
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add expense' });
  await dialog.getByLabel('Date', { exact: true }).fill('2026-10-12');
  await dialog.getByLabel('Vendor', { exact: true }).fill('Test Steel Supply');
  await dialog.getByLabel('Amount $', { exact: true }).fill('124.50');
  await dialog.getByRole('combobox', { name: /^Method/ }).selectOption('cash');
  await dialog.getByRole('combobox', { name: 'Select jobs', exact: true }).selectOption(String(job.data.id));
  await dialog.getByLabel('Charge this expense to the customer').check();
  await dialog.getByLabel('Notes (optional)').fill('Welding supplies and consumables');
  await dialog.getByLabel('Upload receipt photo',{exact:true}).setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: receipt });
  await expect(dialog.getByRole('link', { name: 'View attached receipt', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const list = await app.api('/api/finance/expenses?q=Test%20Steel%20Supply', 'GET', undefined, app.owner);
  expect(list.data.rows).toHaveLength(1);
  const saved = list.data.rows[0];
  expect(saved.receiptUrl).toMatch(/^\/uploads\/.+\.jpg$/);
  const search = await app.api('/api/search?q=Test%20Steel%20Supply', 'GET', undefined, app.owner);
  const link = search.data.results.find(row => row.href === `/finance/expenses?expense=${saved.id}`);
  expect(link).toBeTruthy();

  await page.goto(app.base + '/#' + link.href);
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await expect(edit).toBeVisible();
  await expect(edit.getByLabel('Vendor', { exact: true })).toHaveValue('Test Steel Supply');
  await expect(edit.getByLabel('Date', { exact: true })).toHaveValue('2026-10-12');
  await expect(edit.getByLabel('Amount $', { exact: true })).toHaveValue('124.50');
  await expect(edit.getByRole('combobox', { name: /^Method/ })).toHaveValue('cash');
  await expect(edit.getByRole('combobox', { name: /^Category/ })).toHaveValue('materials');
  await expect(edit.getByRole('combobox', { name: 'Select jobs', exact: true })).toHaveValue(String(job.data.id));
  await expect(edit.getByLabel('Charge this expense to the customer')).toBeChecked();
  await expect(edit.getByLabel('Notes (optional)')).toHaveValue('Welding supplies and consumables');
  const image = edit.getByRole('img', { name: 'Expense receipt' });
  await expect(image).toHaveAttribute('src', saved.receiptUrl);
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  await image.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/expense-receipt-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const popupPromise = page.waitForEvent('popup');
  await edit.getByRole('link', { name: 'View attached receipt', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  await expect.poll(() => popup.locator('img').evaluate(img => img.naturalWidth > 0)).toBe(true);
  await popup.close();

  await edit.getByLabel('Notes (optional)').fill('Receipt reviewed');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'Test Steel Supply' }).click();
  await expect(edit.getByLabel('Notes (optional)')).toHaveValue('Receipt reviewed');
  await expect(edit.getByRole('img', { name: 'Expense receipt' })).toHaveAttribute('src', saved.receiptUrl);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await image.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/expense-receipt-desktop.png', fullPage: true });
  expect(errors).toEqual([]);

  let failPhoto = true;
  await page.route('**' + saved.receiptUrl + '*', route => failPhoto ? route.fulfill({ status: 503, body: 'Test photo outage' }) : route.continue());
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'Test Steel Supply' }).click();
  await expect(edit.getByText('Receipt preview could not load.')).toBeVisible();
  await expect(edit.getByLabel('Notes (optional)')).toHaveValue('Receipt reviewed');
  failPhoto = false;
  await edit.getByRole('button', { name: 'Retry receipt' }).click();
  await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
});

test('Expense details retain versions and restrict missing, deleted and unauthorized records', async () => {
  const created = await app.api('/api/finance/expenses', 'POST', { date: '2026-10-12', vendor: 'Private expense', category: 'fuel', amountCents: 2400, paymentMethod: 'card' }, app.owner);
  expect(created.status).toBe(201);
  const path = `/api/finance/expenses/${created.data.id}`;
  const detail = await app.api(path, 'GET', undefined, app.owner);
  expect(detail.status).toBe(200);
  expect(detail.data.amountCents).toBe(2400);
  expect(detail.data._version).toBeGreaterThan(0);
  expect(detail.headers.get('etag')).toBeTruthy();
  expect((await app.api(path)).status).toBe(401);
  await app.api('/api/users', 'POST', { name: 'Expense Worker', pin: '4321', role: 'worker' }, app.owner);
  const worker = await app.api('/api/auth/login', 'POST', { name: 'Expense Worker', pin: '4321' });
  expect((await app.api(path, 'GET', undefined, worker.data.token)).status).toBe(403);
  expect((await app.api('/api/finance/expenses/99999999', 'GET', undefined, app.owner)).status).toBe(404);
  expect((await app.api(path, 'DELETE', undefined, app.owner)).status).toBe(200);
  expect((await app.api(path, 'GET', undefined, app.owner)).status).toBe(404);
});
