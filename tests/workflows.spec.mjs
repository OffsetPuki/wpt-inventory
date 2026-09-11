import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { TOTP } from "otpauth";
import { testApp } from "../scripts/test-app.mjs";
import { inventoryWorkflow } from "./inventory-workflow.mjs";
import { suiteWorkflow } from './suite-workflow.mjs';
let app;

test.beforeAll(async () => {
  app = await testApp({ serve: true });
});
test.afterAll(async () => {
  await app.close();
});
test("Owner enrollment, dashboard recovery, dialog access, drafts and task navigation on mobile", async ({
  page,
}) => {
  test.setTimeout(120000);
  // Customer preview comes from the public site. Route it to a synthetic
  // document; all pricing assertions still use the fixture's real API.
  await page.route('https://www.cjmmetals.com/**', route => route.fulfill({contentType:'text/html',body:'<html><body><h1>Synthetic customer preview</h1><p>Local test document</p></body></html>'}));
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.error("BROWSER ERROR", e.message);
  });
  await page.goto(app.base);
  await page.getByLabel("Your name", { exact: true }).fill("Owner");
  await page.getByLabel(/Password or PIN/i).fill("1234");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Protect your account" }),
  ).toBeVisible();
  await page.getByLabel("Current password or PIN").fill("1234");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await page.getByText("Enter a setup key instead").click();
  const secret = await page.locator("details code").textContent();
  await page
    .getByLabel("2. New password (12+ characters)")
    .fill("Synthetic UI password 2026");
  await page.getByLabel("Confirm password").fill("Synthetic UI password 2026");
  await page
    .getByLabel("3. Six-digit authenticator code")
    .fill(new TOTP({ secret }).generate());
  await page.getByRole("button", { name: "Secure my account" }).click();
  await page.getByLabel("I saved these codes somewhere private.").check();
  await page.getByRole("button", { name: "Continue to the suite" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await page.goto(app.base + '/#/dashboard');
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.route("**/api/finance/stats", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporary test failure" }),
    }),
  );
  await page.reload();
  await expect(
    page.getByText("Finance could not load.", { exact: false }),
  ).toBeVisible();
  await page.unroute("**/api/finance/stats");
  await page
    .getByRole("alert")
    .filter({ hasText: "Finance could not load" })
    .getByRole("button", { name: "Retry" })
    .click();
  await expect(
    page.getByText("Finance could not load.", { exact: false }),
  ).toHaveCount(0);
  await page.goto(app.base + "/#/crm/leads");
  await page
    .getByRole("button", { name: /New lead|Add lead/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox").first().fill("Unsaved UI lead");
  let asked = false;
  page.once("dialog", async (d) => {
    asked = true;
    await d.dismiss();
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  expect(asked).toBe(true);
  for (let i = 0; i < 20; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.goto(app.base + "/#/crm/quotes");
  await expect(
    page.getByRole("heading", { name: "CJM Concrete", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Concrete/ })
    .first()
    .click();
  await expect.poll(() => app.sqlite.prepare('SELECT count(*) n FROM quotes').get().n).toBeGreaterThan(0);
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  const draft = app.sqlite
    .prepare("SELECT * FROM quotes ORDER BY id DESC LIMIT 1")
    .get();
  expect(draft.status).toBe("draft");
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Continue draft/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Continue draft/ }).click();
  await page
    .getByRole("button", { name: /Review quote/ })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Latest customer edit");
  await page.getByText("Notes, deposit & attachments", {exact:true}).click();
  await page
    .getByLabel("Notes for the customer (optional)", { exact: true })
    .fill("Latest scope must be saved before issuing.");
  await page
    .getByRole("button", { name: "Copy link", exact: true })
    .click();
  await page.getByRole("button", {name:"Done",exact:true}).click();
  await expect(
    page.getByRole("button", { name: "Revise", exact: true }),
  ).toBeVisible();
  const issued = app.sqlite
    .prepare("SELECT * FROM quotes WHERE id=?")
    .get(draft.id);
  expect(issued.status).toBe("sent");
  expect(JSON.parse(issued.payload).notes).toBe(
    "Latest scope must be saved before issuing.",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review quote", exact: false }),
  ).toBeVisible();
  const revision = app.sqlite
    .prepare("SELECT * FROM quotes ORDER BY id DESC LIMIT 1")
    .get();
  expect(revision.revision_of).toBe(draft.id);
  expect(revision.status).toBe("draft");
  const taskId = Number(
    app.sqlite
      .prepare(
        "INSERT INTO pm_tasks(title,kind) VALUES ('Review UI test job','other')",
      )
      .run().lastInsertRowid,
  );
  await page.goto(app.base + `/#/pm/board?task=${taskId}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("textbox").first(),
  ).toBeVisible();
  await page.screenshot({ animations: "disabled", path: "test-results/task-mobile.png" });
  await page.keyboard.press("Escape");
  const leadId=Number(app.sqlite.prepare("INSERT INTO crm_leads(name) VALUES ('Direct link test lead')").run().lastInsertRowid);
  await page.goto(app.base+`/#/crm/leads?lead=${leadId}`);
  await expect(page.getByRole('dialog')).toBeVisible();await expect(page.getByRole('dialog')).toContainText('Direct link test lead');
  await page.keyboard.press('Escape');
  const invoiceId=Number(app.sqlite.prepare("INSERT INTO fin_invoices(number,client_name,status,items,subtotal_cents,total_cents) VALUES ('INV-UI-DIRECT','UI Customer','draft','[]',10000,10000)").run().lastInsertRowid);
  await page.goto(app.base+`/#/finance/invoices?invoice=${invoiceId}`);await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('INV-UI-DIRECT');await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app.base + "/#/dashboard");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({ animations: "disabled", path: "test-results/dashboard-desktop.png" });
  await page.goto(app.base + "/?measure=1#/dashboard");
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  const measurement = await page.evaluate(() => ({
    navigation: performance
      .getEntriesByType("navigation")
      .map((n) => ({
        responseMs: n.responseEnd,
        domReadyMs: n.domContentLoadedEventEnd,
      })),
    resources: performance
      .getEntriesByType("resource")
      .map((r) => ({
        path: new URL(r.name).pathname,
        type: r.initiatorType,
        bytes: r.encodedBodySize,
        decodedBytes: r.decodedBodySize,
        durationMs: r.duration,
      })),
  }));
  fs.writeFileSync(
    "test-results/performance.json",
    JSON.stringify(
      {
        note: "Local synthetic data; not field Core Web Vitals.",
        ...measurement,
      },
      null,
      2,
    ),
  );
  await page.goto(app.base + "/#/crm/quotes");
  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Table", exact: true }) }).click();
  await expect(page.getByRole("heading", { name: "Table", exact: true })).toBeVisible();
  for (const [label, input, shown] of [
    ["Frame length", "1 ft", "1 ft"],
    ["Frame width", "60 in", "60 in"],
    ["Frame height", "80 in", "80 in"],
    ["Frame length", "20 ft", "20 ft"],
    ["Frame width", "8.2 in", "8.2 in"],
    ["Frame height", "12.2 in", "12.2 in"],
    ["Frame length", "2 ft 9 in", "2 ft 9 in"],
    ["Frame width", "16-3/4 in", "16-3/4 in"],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(input);
    await field.press("Tab");
    await expect(field).toHaveValue(shown);
  }
  await expect.poll(() => JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes ORDER BY id DESC LIMIT 1').get().payload).state?.frameWidthIn).toBe(16.75);
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  const frameRow = app.sqlite.prepare("SELECT id, payload FROM quotes ORDER BY id DESC LIMIT 1").get();
  const tableDraft = JSON.parse(frameRow.payload);
  expect(tableDraft.type).toBe("table");
  expect(tableDraft.state).toMatchObject({ frameLengthFt: 2.75, frameWidthIn: 16.75, frameHeightIn: 12.2 });
  const frameToken = "cd".repeat(24);
  app.sqlite.prepare("UPDATE quotes SET share_token = ? WHERE id = ?").run(frameToken, frameRow.id);
  const frameDocument = (await (await fetch(`${app.base}/api/public/quote/${frameToken}?preview=1`)).json()).quote.doc;
  expect(frameDocument.specs).toContainEqual({ label: "Frame size", value: "2 ft 9 in × 16-3/4 in" });
  expect(frameDocument.specs.some(s => ["Top size", "Steel base", "Overall height", "Tabletop material"].includes(s.label))).toBe(false);
  expect(frameDocument.project.summary).not.toMatch(/top/i);
  await page.reload();
  await page.getByRole("button", { name: /Continue draft/ }).click();
  await expect(page.getByLabel("Frame height", { exact: true })).toHaveValue("12.2 in");
  await expect(page.getByLabel("Frame length", { exact: true })).toHaveValue("2 ft 9 in");
  await expect(page.getByLabel("Frame width", { exact: true })).toHaveValue("16-3/4 in");
  await expect(page.getByLabel("Top length", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Top width", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveCount(0);
  await expect(page.locator("svg").filter({ hasText: '12.2" FRAME' })).toBeVisible();
  await expect(page.getByRole("img", { name: "Table preview" })).not.toContainText("TOP");
  await page.getByRole("img", { name: "Table preview" }).screenshot({ path: "test-results/table-frame-preview.png" });
  await page.getByLabel("Frame height", { exact: true }).fill("0");
  await page.getByLabel("Frame height", { exact: true }).press("Tab");
  await expect(page.getByLabel("Frame height", { exact: true })).toHaveValue("12.2 in");
  await page.screenshot({ animations: "disabled", path: "test-results/table-custom-dimensions.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("radio", { name: "Frame only", exact: true })).toBeChecked();
  await expect(page.getByLabel("Tabletop material", { exact: true })).toHaveCount(0);
  await page.getByText("Frame + tabletop", { exact: true }).click();
  await page.getByLabel("Top length", { exact: true }).fill("3 ft");
  await page.getByLabel("Top length", { exact: true }).press("Tab");
  await page.getByLabel("Top width", { exact: true }).fill("20 in");
  await page.getByLabel("Top width", { exact: true }).press("Tab");
  await expect(page.getByText(/Enter the included tabletop material\./)).toBeVisible();
  await expect(page.getByText(/Enter the cost per top\./)).toBeVisible();
  await page.getByLabel("Tabletop material", { exact: true }).fill("Finished white oak");
  await page.getByLabel("Tabletop cost ($ each)", { exact: true }).fill("450.25");
  for (const [input, shown] of [["6 in", "6 in"], ["1/32 in", "0.03125 in"]]) {
    const thickness = page.getByLabel("Tabletop thickness", { exact: true });
    await thickness.fill(input);
    await thickness.press("Tab");
    await expect(thickness).toHaveValue(shown);
  }
  await page.getByLabel("How many", { exact: true }).fill("3");
  await page.getByText("Edit pricing", {exact:false}).first().click();
  const topLine = page.locator(".line").filter({ has: page.locator('input[value="Tabletop — Finished white oak"]') });
  await expect(topLine.locator(".line-cost")).toHaveText("$1,350.75");
  await expect(page.locator("svg").filter({ hasText: "TABLETOP INCLUDED" })).toBeVisible();
  await page.getByRole("img", { name: "Table preview" }).screenshot({ path: "test-results/table-included-preview.png" });
  await page.getByText("Frame only", { exact: true }).click();
  await expect(topLine).toHaveCount(0);
  await expect(page.getByLabel("Tabletop cost ($ each)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Top length", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Top width", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Frame length", { exact: true })).toHaveValue("2 ft 9 in");
  await expect(page.getByLabel("Frame width", { exact: true })).toHaveValue("16-3/4 in");
  await page.getByLabel("Frame height", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: "test-results/table-frame-only-mobile.png" });
  await page.getByText("Frame + tabletop", { exact: true }).click();
  await expect(page.getByLabel("Tabletop material", { exact: true })).toHaveValue("Finished white oak");
  await expect(page.getByLabel("Tabletop cost ($ each)", { exact: true })).toHaveValue("450.25");
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveValue("0.03125 in");
  // Rate edits in the itemized list and the cost field stay synchronized.
  await topLine.locator('.line-controls input[type="number"]').nth(1).fill("500");
  await expect(page.getByLabel("Tabletop cost ($ each)", { exact: true })).toHaveValue("500");
  await page.getByLabel("Tabletop cost ($ each)", { exact: true }).fill("450.25");
  await expect(topLine.locator(".line-cost")).toHaveText("$1,350.75");
  await expect.poll(() => JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes ORDER BY id DESC LIMIT 1').get().payload).state?.topCost).toBe('450.25');
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  const includedRow = app.sqlite.prepare("SELECT id, payload FROM quotes ORDER BY id DESC LIMIT 1").get();
  const includedDraft = JSON.parse(includedRow.payload);
  expect(includedDraft.state).toMatchObject({ includeTop: "yes", topMaterial: "Finished white oak", topCost: "450.25", qty: "3", frameLengthFt: 2.75, frameWidthIn: 16.75, frameHeightIn: 12.2, topThicknessIn: 0.03125, lengthFt: 3, widthIn: 20 });
  // Exercise the real public document builder against this isolated saved quote.
  const token = "ab".repeat(24);
  app.sqlite.prepare("UPDATE quotes SET share_token = ? WHERE id = ?").run(token, includedRow.id);
  const docResponse = await fetch(`${app.base}/api/public/quote/${token}?preview=1`);
  expect(docResponse.ok).toBe(true);
  const doc = (await docResponse.json()).quote.doc;
  expect(doc.specs).toContainEqual({ label: "Scope", value: "Steel frame and tabletop included" });
  expect(doc.specs).toContainEqual({ label: "Tabletop material", value: "Finished white oak" });
  expect(doc.specs).toContainEqual({ label: "Frame size", value: "2 ft 9 in × 16-3/4 in" });
  expect(doc.specs).toContainEqual({ label: "Top size", value: "3 ft × 20 in" });
  expect(doc.materials.find(m => m.name === "Tabletop — Finished white oak").amountCents).toBeGreaterThan(135075);
  expect(JSON.stringify(doc)).not.toContain('"topCost"');
  await page.reload();
  await page.getByRole("button", { name: /Continue draft/ }).click();
  await expect(page.getByRole("radio", { name: "Frame + tabletop", exact: true })).toBeChecked();
  await expect(page.getByLabel("Frame length", { exact: true })).toHaveValue("2 ft 9 in");
  await expect(page.getByLabel("Frame width", { exact: true })).toHaveValue("16-3/4 in");
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveValue("0.03125 in");
  await expect(page.getByLabel("Tabletop material", { exact: true })).toHaveValue("Finished white oak");
  await expect(page.getByLabel("Tabletop cost ($ each)", { exact: true })).toHaveValue("450.25");
  await page.getByLabel("Tabletop cost ($ each)", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: "test-results/tabletop-options-mobile.png" });
  // The primary action stays within the phone viewport while scrolling.
  const action = await page.getByRole('button',{name:/Review quote/}).boundingBox();
  expect(action.y + action.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.evaluate(() => window.scrollTo({top:0}));
  await page.screenshot({path:'test-results/quote-workbench-mobile.png',animations:'disabled'});

  // CRM search carries contact and language into the quote.
  app.sqlite.prepare("INSERT INTO crm_clients(name,company,phone,email,preferred_language) VALUES ('UX Search Customer','Oak Works','555-0198','quote-ui@example.test','es')").run();
  const customerSection = page.locator('.quote-workbench details').filter({has:page.locator('summary').filter({hasText:/^Customer/})});
  if(!(await customerSection.getAttribute('open'))) { if(!(await page.getByLabel('Find customer',{exact:true}).isVisible())) await customerSection.locator('summary').click(); }
  await page.getByLabel('Find customer',{exact:true}).fill('555-0198');
  await page.getByRole('button').filter({has:page.getByText('UX Search Customer',{exact:true})}).click();
  await expect(page.getByLabel('Customer name',{exact:true})).toHaveValue('UX Search Customer');
  await expect(page.getByLabel('Customer language',{exact:true})).toHaveValue('es');
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('quote-ui@example.test');

  // A slow PATCH keeps a second edit and never overwrites its customer name.
  let releaseSave; let held = false;
  await page.route(/\/api\/quotes\/\d+$/, async route => {
    if(route.request().method()==='PATCH' && !held) { held=true; await new Promise(r=>releaseSave=r); }
    await route.continue();
  });
  await page.getByLabel('Customer name',{exact:true}).fill('First delayed edit');
  await expect.poll(()=>held).toBe(true);
  await page.getByLabel('Customer name',{exact:true}).fill('Latest delayed edit');
  releaseSave();
  await expect.poll(()=>JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(includedRow.id).payload).customer.name).toBe('Latest delayed edit');
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  await page.unroute(/\/api\/quotes\/\d+$/);

  await page.context().setOffline(true);
  await page.getByLabel('Customer name',{exact:true}).fill('Recovered offline edit');
  await expect(page.locator('.draft-status')).toContainText('Offline');
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('cjm.session.v2.user.')))).customer.name)).toBe('Recovered offline edit');
  await page.context().setOffline(false);
  await expect.poll(()=>JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(includedRow.id).payload).customer.name).toBe('Recovered offline edit');
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  await page.getByRole('button',{name:/Review quote/}).click();
  await expect(page.getByRole('heading',{name:'Review & send'})).toBeVisible();
  await expect(page.locator('iframe[title="Customer quote"]')).toHaveAttribute('src',/preview=1.*embed=1/);
  await expect(page.getByRole('button',{name:'Send email',exact:true})).toBeEnabled();
  const sendBounds = await page.getByRole('button',{name:'Send email',exact:true}).boundingBox();
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(844);
  await expect(page.getByRole('link',{name:'Print / PDF',exact:true})).toHaveAttribute('href',/print=1/);
  expect(app.sqlite.prepare('SELECT status FROM quotes WHERE id=?').get(includedRow.id).status).toBe('draft');
  await page.screenshot({path:'test-results/quote-review-mobile.png',animations:'disabled'});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:'test-results/quote-review-desktop.png',animations:'disabled'});

  // Saved search/filter/page endpoints replace an unbounded list. Selection
  // for the combined buy list remains explicit across pages.
  const insert = app.sqlite.prepare("INSERT INTO quotes(number,type,customer_name,total_cents,payload,status) VALUES (?,?,?,?,?,?)");
  for(let i=0;i<26;i++) insert.run('Q-UX-'+i, i%2?'concrete':'table','UX Paging '+i,10000,'{}',i%2?'sent':'draft');
  await page.getByRole('button',{name:'Saved',exact:true}).click();
  await page.getByLabel('Search quotes',{exact:true}).fill('UX Paging');
  await expect(page.getByText('Page 1 of 2',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:/for buy list/}).first().check();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByText('Page 2 of 2',{exact:true})).toBeVisible();
  await expect(page.getByText('1 selected across pages (up to 50)',{exact:true})).toBeVisible();
  await page.getByLabel('Trade',{exact:true}).selectOption('metals');
  await page.getByLabel('Status',{exact:true}).selectOption('draft');
  await expect(page.getByText('13 quotes',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Next',exact:true})).toBeDisabled();
  await page.getByLabel('Search quotes',{exact:true}).fill('No such customer');
  await expect(page.getByText(/No quotes match/)).toBeVisible();
  // A second screen cannot be overwritten. The owner can retain local edits
  // as a separate draft, at exactly the same locked rates.
  await page.getByRole('button',{name:'New quote',exact:true}).click();
  await page.getByRole('button',{name:/Continue draft/}).click();
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  app.sqlite.prepare('UPDATE quotes SET version=version+1 WHERE id=?').run(includedRow.id);
  await page.getByLabel('Frame height',{exact:true}).fill('11.75 in');
  await page.getByLabel('Frame height',{exact:true}).press('Tab');
  await expect(page.locator('.draft-status')).toContainText('Conflict');
  expect(JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes WHERE id=?').get(includedRow.id).payload).state.frameHeightIn).toBe(12.2);
  page.once('dialog', dialog=>dialog.accept());
  await page.getByRole('button',{name:'Keep edits as new quote',exact:true}).click();
  await expect(page.locator('.draft-status')).toHaveText('Saved');
  const retained=JSON.parse(app.sqlite.prepare('SELECT payload FROM quotes ORDER BY id DESC LIMIT 1').get().payload);
  expect(retained.state.frameHeightIn).toBe(11.75);
  expect(retained.priceBookSnapshot).toEqual(includedDraft.priceBookSnapshot);
  expect(errors).toEqual([]);
});

test("Inventory search, QR, drafts, stock counts, reservations and partial receiving on mobile", async ({ page }) => {
  test.setTimeout(120000);
  await inventoryWorkflow(page,app,expect);
});

test('Connected job workspace, two live sessions, exact search and recovered forms',async({page,browser})=>{
 test.setTimeout(120000);
 await suiteWorkflow(page,browser,app,expect);
});
