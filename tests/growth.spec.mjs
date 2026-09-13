import { test, expect } from "@playwright/test";
import { testApp } from "../scripts/test-app.mjs";
let app;
test.beforeAll(async () => {
  app = await testApp({ serve: true });
  // Synthetic fixture represents an already-enrolled owner; enrollment itself
  // is exercised by the full workflow and release suites.
  app.sqlite
    .prepare(
      "UPDATE users SET credential_type='password',totp_secret='SYNTHETIC-ONLY' WHERE role='owner'",
    )
    .run();
});
test.afterAll(async () => {
  await app.close();
});
test("Marketing report works on mobile and desktop without Google credentials", async ({
  page,
}) => {
  await page.addInitScript(
    (token) => localStorage.setItem("wpt-auth-token", token),
    app.owner,
  );
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.base + "/#/marketing");
  await expect(
    page.getByRole("heading", { name: "Marketing", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Saved inquiries", { exact: true }),
  ).toBeVisible();
  const ai = page.getByRole('region', {name:'AI referral results'});
  await expect(ai.getByText(/Analytics visits unavailable/)).toBeVisible();
  await expect(ai.getByText('AI-referred inquiries', {exact:true})).toBeVisible();
  const comparison = page.getByRole("region", { name: "All websites organic comparison" });
  await expect(comparison.getByRole("row")).toHaveCount(5);
  await comparison.getByRole("button", {name:"CJM Concrete",exact:true}).click();
  await expect(page.getByLabel(/^Website/)).toHaveValue("concrete");
  await expect(
    page.getByRole("button", { name: "Refresh search data" }),
  ).toBeDisabled();
  await page.getByLabel(/^Website/).selectOption("trades");
  const connections=page.getByRole('region',{name:'Search connections and visibility'});
  await expect(connections.getByText('Not connected',{exact:true})).toHaveCount(3);
  await expect(connections.getByRole('link',{name:'Open Bing',exact:false})).toHaveAttribute('href',/siteUrl=https%3A%2F%2Fwww.cjmtrades.com%2F/);
  await expect(connections.getByRole('region',{name:'Bing search results'}).getByText('Unavailable',{exact:true})).toHaveCount(2);
  await connections.getByText('Indexing, sitemaps and search tools',{exact:true}).click();
  await expect(connections.getByRole('link',{name:'Manage Google sitemaps'})).toHaveAttribute('href',/www.cjmtrades.com/);
  await expect(connections.getByText(/Homepage inspection not available yet/)).toBeVisible();
  await expect(
    page.getByText("No inquiries arrived in this period."),
  ).toBeVisible();
  await page
    .getByText("Campaign links, staff mode and connections", { exact: true })
    .click();
  await expect(page.getByLabel("Campaign link", { exact: true })).toHaveValue(
    /www.cjmtrades.com/,
  );
  await page.getByLabel(/Total ad spend/).fill("100.25");
  await page.getByRole("button", { name: "Save period spend" }).click();
  await expect(page.getByText("$100.25", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/growth-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/growth-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
