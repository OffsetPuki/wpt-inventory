import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { testApp } from '../scripts/test-app.mjs';

test('ChatGPT reply hands off full text and actual photos on phone and desktop with honest fallbacks', async ({ page, context }) => {
  test.setTimeout(120000);
  const app = await testApp({ serve: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // No customer information or test message ever leaves the isolated fixture.
  await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>ChatGPT test destination</title>' }));
  try {
    app.sqlite.prepare("UPDATE users SET credential_type='password',totp_secret='JBSWY3DPEHPK3PXP' WHERE id=1").run();
    const token = crypto.randomBytes(32).toString('hex');
    app.sqlite.prepare("INSERT INTO sessions(token,user_id,role,name,expires_at) VALUES(?,1,'owner','Owner',?)").run(token, Date.now() + 3600000);
    await page.addInitScript(t => localStorage.setItem('wpt-auth-token', t), token);
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
    await page.goto(app.base);
    const photo = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 120;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 120, 120); return c.toDataURL('image/png');
    });
    const receiptToken = crypto.randomBytes(32).toString('hex');
    const input = await app.api('/api/public/leads', 'POST', {
      name: 'Synthetic photo request', site: 'metals', email: 'customer@example.test', lang: 'es',
      message: 'Long project message. '.repeat(200) + 'Final requirement: brass finish.',
      contact: 'Email', bestTime: 'After 3 pm', photos: [photo, photo, photo], receiptToken,
      qualification: { dimensions: '48 x 24 in', facilityCompany: 'Synthetic company' },
    }, null, { 'X-Lead-Key': 'test-intake-key' });
    expect(input.status).toBe(201); const id = input.data.id;
    await app.api('/api/public/lead-details', 'POST', { site: 'metals', token: receiptToken, submissionId: crypto.randomUUID(), details: 'Supplemental detail', photos: [photo, photo] }, null, { 'X-Lead-Key': 'test-intake-key' });
    const packet = (await app.api(`/api/crm/leads/${id}/reply-packet`, 'GET', undefined, token)).data;
    let failRequest = true;
    await page.route(`**/api/crm/leads/${id}/reply-packet`, route => failRequest ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Request temporarily unavailable"}' }) : route.continue());
    let failPhoto = true;
    await page.route(`**${packet.photos[0].url}`, route => failPhoto ? route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"Photo unavailable"}' }) : route.continue());
    await page.goto(`${app.base}/#/crm/leads?lead=${id}`);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Reply with ChatGPT', exact: true }).click();
    const reply = dialog.getByRole('region', { name: 'Reply with ChatGPT', exact: true });
    await expect(reply.getByRole('alert')).toContainText('Request temporarily unavailable');
    failRequest = false; await reply.getByRole('button', { name: 'Retry request' }).click();
    await expect(reply.getByRole('alert')).toContainText('Photo 1 could not load');
    failPhoto = false; await reply.getByRole('button', { name: 'Retry photos' }).click();
    await expect(reply.getByRole('link', { name: 'Download photo sheet 2' })).toBeVisible();
    await expect(reply.getByRole('alert')).toHaveCount(0);
    const sheet = reply.getByRole('link', { name: 'Download photo sheet 1' });
    const pixel = await sheet.evaluate(async link => {
      const bitmap = await createImageBitmap(await (await fetch(link.href)).blob());
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
      return { width: bitmap.width, height: bitmap.height, pixel: [...ctx.getImageData(600, 666, 1, 1).data] };
    });
    expect(pixel).toEqual({ width: 2400, height: 2560, pixel: [255, 0, 0, 255] });
    const downloaded = page.waitForEvent('download'); await sheet.click();
    expect((await downloaded).suggestedFilename()).toBe(`lead-${id}-photos-1.png`);
    const popupPromise = page.waitForEvent('popup'); await reply.getByRole('link', { name: 'Copy request & open ChatGPT' }).click();
    const popup = await popupPromise; await popup.waitForLoadState();
    expect(popup.url()).toBe('https://chatgpt.com/'); expect(await popup.evaluate(() => window.opener)).toBeNull(); await popup.close();
    await page.bringToFront();
    await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(packet.prompt);
    await reply.getByRole('button', { name: 'Copy photo sheet 1' }).click();
    await expect(reply.getByRole('status')).toContainText('Photo 1, Photo 2, Photo 3, Photo 4 copied');
    const clipboardTypes = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap(item => item.types));
    expect(clipboardTypes).toContain('image/png');
    fs.mkdirSync('test-results', { recursive: true });
    await page.screenshot({ path: 'test-results/lead-chatgpt-mobile.png' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: 'test-results/lead-chatgpt-desktop.png' });
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); }; });
    const deniedPopupPromise = page.waitForEvent('popup'); await reply.getByRole('link', { name: 'Copy request & open ChatGPT' }).click();
    await (await deniedPopupPromise).close(); await page.bringToFront();
    await expect(reply.getByLabel('ChatGPT request')).toBeVisible();
    await expect(reply.getByLabel('ChatGPT request')).toHaveValue(packet.prompt);
    await expect(reply.getByRole('status')).toContainText('Copy is unavailable');
    const textDownload = page.waitForEvent('download'); await reply.getByRole('button', { name: 'Download request', exact: true }).click();
    expect(fs.readFileSync(await (await textDownload).path(), 'utf8')).toBe(packet.prompt);
    await dialog.getByRole('tab', { name: 'Details', exact: true }).click();
    await dialog.getByLabel('Name', { exact: true }).fill('Unsaved name');
    await expect(reply).toContainText('Save your changes');
    await expect(reply.getByRole('link', { name: 'Copy request & open ChatGPT' })).toHaveCount(0);
    await dialog.getByLabel('Name', { exact: true }).fill('Synthetic photo request');
    await expect(reply.getByRole('link', { name: 'Copy request & open ChatGPT' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    const plain = await app.api('/api/crm/leads', 'POST', { name: 'Manual no photos', site: 'trades' }, token);
    await page.goto(`${app.base}/#/crm/leads?lead=${plain.data.id}`);
    await page.getByRole('button', { name: 'Reply with ChatGPT', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Copy request & open ChatGPT' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Add the photos/ })).toHaveCount(0);
    expect(app.sqlite.prepare('SELECT last_contact_at FROM crm_leads WHERE id=?').get(id).last_contact_at).toBeNull();
    expect(errors).toEqual([]);
  } finally { await page.close(); await app.close(); }
});
