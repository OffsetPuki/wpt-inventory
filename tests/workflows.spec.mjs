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
  expect(errors).toEqual([]);
});
