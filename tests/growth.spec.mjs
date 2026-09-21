import { test, expect } from "@playwright/test";
import { testApp } from "../scripts/test-app.mjs";
let app;
test.beforeAll(async () => {
  app = await testApp({ serve: true });
  const id=app.sqlite.prepare("INSERT INTO crm_leads(name,site,created_at) VALUES('Synthetic project','metals',?)").run(Date.now()-2*86400000).lastInsertRowid;
  app.sqlite.prepare("INSERT INTO web_designs(ref,lead_id,name,design_state) VALUES('CJT-BROWSER',?,'Synthetic',?)").run(id,JSON.stringify({type:'trades-planner',project:'shop'}));
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
  const projects=page.getByRole('region',{name:'Project results'});
  await expect(projects.getByText('Shop / barn',{exact:true})).toBeVisible();
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
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  const connections=page.getByRole('region',{name:'Search connections and visibility'});
  await expect(connections.getByText('Not connected',{exact:true})).toHaveCount(3);
  await expect(connections.getByRole('link',{name:'Open Bing',exact:false})).toHaveAttribute('href',/siteUrl=https%3A%2F%2Fwww.cjmtrades.com%2F/);
  await expect(connections.getByRole('region',{name:'Bing search results'}).getByText('Unavailable',{exact:true})).toHaveCount(2);
  await connections.getByText('Indexing, sitemaps and search tools',{exact:true}).click();
  await expect(connections.getByRole('link',{name:'Manage Google sitemaps'})).toHaveAttribute('href',/www.cjmtrades.com/);
  await expect(connections.getByText(/Homepage inspection not available yet/)).toBeVisible();
  await page.getByRole('button',{name:'Campaigns',exact:true}).click();
  await expect(page.getByLabel('Campaign link',{exact:true})).toHaveValue(/www.cjmtrades.com/);
  await page.getByLabel('Campaign name',{exact:true}).fill('Synthetic campaign');
  await page.getByLabel('Placement',{exact:true}).selectOption('facebook|paid_social');
  await page.getByRole('button',{name:'Save campaign',exact:true}).click();
  await expect(page.getByText('Campaign saved.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Overview',exact:true}).click();
  await expect(page.getByLabel(/^Website/)).toHaveValue('trades');
  await page.getByLabel('Amount ($)',{exact:true}).fill('100.25');
  await page.getByRole('button',{name:'Add spending',exact:true}).click();
  await expect(page.getByText('$100.25',{exact:true})).toBeVisible();
  await page.getByLabel('Amount ($)',{exact:true}).fill('999');
  await page.getByLabel(/^Website/).selectOption('concrete');
  await expect(page.getByLabel('Amount ($)',{exact:true})).toHaveValue('');
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

test('Marketing failures show recovery and current-period errors cannot be hidden',async({page})=>{
 await page.addInitScript(token=>localStorage.setItem('wpt-auth-token',token),app.owner);
 await page.route('**/api/marketing/settings',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'Synthetic failure'})}));
 await page.goto(app.base+'/#/marketing?tab=settings');
 await expect(page.getByText('Could not load settings.',{exact:false})).toBeVisible();
 await page.unroute('**/api/marketing/settings');await page.getByRole('button',{name:'Retry',exact:true}).click();
 await expect(page.getByRole('button',{name:'Save settings',exact:true})).toBeVisible();
 await page.route('**/api/marketing/reviews?**',route=>route.fulfill({status:500,contentType:'application/json',body:'{"message":"Synthetic failure"}'}));
 await page.getByRole('button',{name:'Reviews',exact:true}).click();
 await expect(page.getByText('Could not load reviews.',{exact:false})).toBeVisible();
 await page.unroute('**/api/marketing/reviews?**');await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByRole('button',{name:'Log review',exact:true}).click();const dialog=page.getByRole('dialog');
 await dialog.getByLabel('Author (optional)').fill('Regression review');await dialog.getByRole('button',{name:'Log review',exact:true}).click();await expect(dialog).toBeHidden();
 await page.getByRole('button',{name:'Edit',exact:true}).click();await dialog.getByLabel('Review text (optional)').fill('Corrected text');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Corrected text',{exact:true})).toBeVisible();
 await page.route('**/api/marketing/growth?**',async route=>{const response=await route.fetch();const data=await response.json();data.connection.reportingEmail='fixture@example.test';await route.fulfill({json:data});});
 await page.route('**/api/marketing/growth/refresh',route=>route.fulfill({json:{current:{traffic:'Synthetic current failure'},previous:{traffic:'updated'}}}));
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('button',{name:'Refresh search data',exact:true}).click();
 await expect(page.getByText('current: traffic — Synthetic current failure',{exact:true})).toBeVisible();await expect(page.getByText('Search reports updated.',{exact:true})).toHaveCount(0);
});
