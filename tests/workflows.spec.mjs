import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { TOTP } from "otpauth";
import { testApp } from "../scripts/test-app.mjs";
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
  await expect(
    page.getByRole("heading", { name: "Dashboard", exact: true }),
  ).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: "Save to suite", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save to suite", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({
        has: page.getByRole("button", { name: "Save to suite", exact: true }),
      }),
  ).toContainText("Saved to suite");
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
    .getByRole("button", { name: /Continue to customer details/ })
    .click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Latest customer edit");
  await page
    .getByLabel("Notes for the customer (optional)", { exact: true })
    .fill("Latest scope must be saved before issuing.");
  await page
    .getByRole("button", { name: "Create share link", exact: true })
    .click();
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
    page.getByRole("button", { name: "Save to suite", exact: true }),
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
  await page.waitForLoadState("networkidle");
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
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button").filter({ has: page.getByRole("heading", { name: "Table", exact: true }) }).click();
  await expect(page.getByRole("heading", { name: "Table", exact: true })).toBeVisible();
  for (const [label, input, shown] of [
    ["Top length", "1 ft", "1 ft"],
    ["Top width", "60 in", "60 in"],
    ["Frame height", "80 in", "80 in"],
    ["Top length", "20 ft", "20 ft"],
    ["Top width", "8.2 in", "8.2 in"],
    ["Frame height", "12.2 in", "12.2 in"],
  ]) {
    const field = page.getByLabel(label, { exact: true });
    await field.fill(input);
    await field.press("Tab");
    await expect(field).toHaveValue(shown);
  }
  const tableSaved = page.waitForResponse((r) => r.url().endsWith("/api/quotes") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save to suite", exact: true }).click();
  expect((await tableSaved).ok()).toBe(true);
  const tableDraft = JSON.parse(app.sqlite.prepare("SELECT payload FROM quotes ORDER BY id DESC LIMIT 1").get().payload);
  expect(tableDraft.type).toBe("table");
  expect(tableDraft.state).toMatchObject({ lengthFt: 20, widthIn: 8.2, frameHeightIn: 12.2 });
  await page.reload();
  await page.getByRole("button", { name: /Continue draft/ }).click();
  await expect(page.getByLabel("Frame height", { exact: true })).toHaveValue("12.2 in");
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveCount(0);
  await expect(page.locator("svg").filter({ hasText: '12.2" FRAME' })).toBeVisible();
  await page.getByLabel("Frame height", { exact: true }).fill("0");
  await page.getByLabel("Frame height", { exact: true }).press("Tab");
  await expect(page.getByLabel("Frame height", { exact: true })).toHaveValue("12.2 in");
  await page.screenshot({ animations: "disabled", path: "test-results/table-custom-dimensions.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("radio", { name: "Frame only", exact: true })).toBeChecked();
  await expect(page.getByLabel("Tabletop material", { exact: true })).toHaveCount(0);
  await page.getByText("Frame + tabletop", { exact: true }).click();
  await expect(page.getByText(/Enter the included tabletop material\./)).toBeVisible();
  await expect(page.getByText(/Tabletop included but no cost charged — enter the cost per top\./)).toBeVisible();
  await page.getByLabel("Tabletop material", { exact: true }).fill("Finished white oak");
  await page.getByLabel("Tabletop cost ($ each)", { exact: true }).fill("450.25");
  for (const [input, shown] of [["6 in", "6 in"], ["1/32 in", "0.03125 in"]]) {
    const thickness = page.getByLabel("Tabletop thickness", { exact: true });
    await thickness.fill(input);
    await thickness.press("Tab");
    await expect(thickness).toHaveValue(shown);
  }
  await page.getByLabel("How many", { exact: true }).fill("3");
  const topLine = page.locator(".line").filter({ has: page.locator('input[value="Tabletop — Finished white oak"]') });
  await expect(topLine.locator(".line-cost")).toHaveText("$1,350.75");
  await expect(page.locator("svg").filter({ hasText: "TABLETOP INCLUDED" })).toBeVisible();
  await page.getByText("Frame only", { exact: true }).click();
  await expect(topLine).toHaveCount(0);
  await expect(page.getByLabel("Tabletop cost ($ each)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveCount(0);
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
  const includedSaved = page.waitForResponse((r) => /\/api\/quotes\/\d+$/.test(r.url()) && r.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save to suite", exact: true }).click();
  expect((await includedSaved).ok()).toBe(true);
  const includedRow = app.sqlite.prepare("SELECT id, payload FROM quotes ORDER BY id DESC LIMIT 1").get();
  const includedDraft = JSON.parse(includedRow.payload);
  expect(includedDraft.state).toMatchObject({ includeTop: "yes", topMaterial: "Finished white oak", topCost: "450.25", qty: "3", frameHeightIn: 12.2, topThicknessIn: 0.03125 });
  // Exercise the real public document builder against this isolated saved quote.
  const token = "ab".repeat(24);
  app.sqlite.prepare("UPDATE quotes SET share_token = ? WHERE id = ?").run(token, includedRow.id);
  const docResponse = await fetch(`${app.base}/api/public/quote/${token}?preview=1`);
  expect(docResponse.ok).toBe(true);
  const doc = (await docResponse.json()).quote.doc;
  expect(doc.specs).toContainEqual({ label: "Scope", value: "Steel frame and tabletop included" });
  expect(doc.specs).toContainEqual({ label: "Tabletop material", value: "Finished white oak" });
  expect(doc.materials.find(m => m.name === "Tabletop — Finished white oak").amountCents).toBeGreaterThan(135075);
  expect(JSON.stringify(doc)).not.toContain('"topCost"');
  await page.reload();
  await page.getByRole("button", { name: /Continue draft/ }).click();
  await expect(page.getByRole("radio", { name: "Frame + tabletop", exact: true })).toBeChecked();
  await expect(page.getByLabel("Tabletop thickness", { exact: true })).toHaveValue("0.03125 in");
  await expect(page.getByLabel("Tabletop material", { exact: true })).toHaveValue("Finished white oak");
  await expect(page.getByLabel("Tabletop cost ($ each)", { exact: true })).toHaveValue("450.25");
  await page.getByLabel("Tabletop cost ($ each)", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: "disabled", path: "test-results/tabletop-options-mobile.png" });
  expect(errors).toEqual([]);
});
