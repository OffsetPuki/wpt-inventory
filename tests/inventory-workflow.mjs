import crypto from "node:crypto";
import QRCode from "qrcode";
export async function inventoryWorkflow(page, app, expect) {
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const token = crypto.randomBytes(32).toString("hex");
  app.sqlite
    .prepare(
      "UPDATE users SET credential_type='password',totp_secret=COALESCE(totp_secret,'JBSWY3DPEHPK3PXP') WHERE id=1",
    )
    .run();
  app.sqlite
    .prepare(
      "INSERT INTO sessions(token,user_id,role,name,expires_at) VALUES(?,1,'owner','Owner',?)",
    )
    .run(token, Date.now() + 3600000);
  await page.addInitScript(
    (token) => localStorage.setItem("wpt-auth-token", token),
    token,
  );
  const api = async (path, method = "GET", body) => {
    const r = await app.api(path, method, body, token);
    expect(r.status, JSON.stringify(r.data)).toBeLessThan(300);
    return r.data;
  };
  const steel = await api("/api/items", "POST", {
    name: "UI Steel tube",
    category: "raw_materials",
    itemType: "raw_material",
    unit: "ft",
    quantity: 20,
    area: "main_shop",
    rackLetter: "W",
    shelf: "4",
    lowStockThreshold: 2,
    reorderTarget: 30,
    supplier: "UI Supplier",
    lastCostCents: 250,
  });
  const job = await api("/api/projects", "POST", {
    name: "UI Inventory job",
    jobNumber: "UI-STOCK",
  });
  await api(`/api/items/${steel.id}/reservations`, "POST", {
    quantity: 6,
    projectId: job.id,
    requestKey: crypto.randomUUID(),
  });
  for (let i = 0; i < 61; i++)
    app.sqlite
      .prepare(
        "INSERT INTO items(name,quantity,category,area,rack_letter) VALUES(?,1,'raw_materials','main_shop','W')",
      )
      .run(`UI Page ${String(i).padStart(3, "0")}`);
  await page.goto(app.base + "/#/home?lowStock=1");
  await expect(
    page.getByRole("button", { name: "Low stock", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByLabel("Search inventory").fill("UI Page");
  await expect(page.getByText("61 matching items")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByRole("link").filter({ hasText: "UI Page 050" }).click();
  await expect(
    page.getByRole("heading", { name: "UI Page 050" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Back to inventory/ }).click();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  await page.getByLabel("Search inventory").fill("rack W UI Steel");
  await expect(
    page.getByText("1 matching items", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await page.screenshot({
    path: "test-results/inventory-mobile.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/inventory-desktop.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Select UI Steel tube", { exact: true }).check();
  await page.getByRole("button", { name: "Print labels", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByAltText("QR for UI Steel tube")).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Scan QR" }).click();
  const qr = await QRCode.toBuffer(`${app.base}/#/item/${steel.id}`);
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({ name: "label.png", mimeType: "image/png", buffer: qr });
  await expect(
    page.getByRole("heading", { name: "UI Steel tube" }),
  ).toBeVisible();
  await expect(
    page.getByText("Reserved for jobs", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use on job", exact: true }).click();
  await page.getByLabel("Find job", { exact: true }).fill("UI-STOCK");
  await page.getByLabel("Job", { exact: true }).selectOption(String(job.id));
  await page.getByLabel("Quantity (ft)").fill("2.5");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Use on job", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await api(`/api/items/${steel.id}`)).quantity).toBe(17.5);
  expect((await api(`/api/items/${steel.id}`)).quantityReserved).toBe(3.5);
  await page.getByText("More actions", { exact: true }).click();
  await page.getByRole("button", { name: "Count stock", exact: true }).click();
  await page.getByLabel("I counted", { exact: true }).fill("16.75");
  await page.getByRole("button", { name: "Record count", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("17.5 → 16.75", { exact: true })).toBeVisible();
  while (
    await page.getByRole("button", { name: "Dismiss", exact: true }).count()
  )
    await page
      .getByRole("button", { name: "Dismiss", exact: true })
      .first()
      .click();
  await page.screenshot({
    path: "test-results/inventory-item-mobile.png",
    animations: "disabled",
  });
  await page.goto(app.base + "/#/add");
  await page.getByLabel("Name", { exact: true }).fill("UI Photo protected");
  await page.getByLabel("Stock unit", { exact: true }).selectOption("ft");
  await page.getByLabel("Starting quantity", { exact: true }).fill("3.25");
  await page.getByLabel("Location", { exact: true }).selectOption("main_shop");
  await page.getByLabel("Rack", { exact: true }).fill("Q");
  await page.route("**/api/ai/identify-item", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        name: "AI suggestion",
        category: "raw_materials",
        notes: "Synthetic photo suggestion",
      }),
    }),
  );
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: qr,
  });
  await expect(
    page.getByText("Prefilled from photo", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "UI Photo protected",
  );
  await expect(
    page.getByLabel("Starting quantity", { exact: true }),
  ).toHaveValue("3.25");
  await expect(page.getByLabel("Rack", { exact: true })).toHaveValue("Q");
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "UI Photo protected",
  );
  let lostCreate = false;
  await page.route("**/api/items", async (route) => {
    if (route.request().method() === "POST" && !lostCreate) {
      lostCreate = true;
      await route.fetch();
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Save and add another", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "UI Photo protected",
  );
  await page
    .getByRole("button", { name: "Save and add another", exact: true })
    .click();
  await page.unroute("**/api/items");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Rack", { exact: true })).toHaveValue("Q");
  const saved = app.sqlite
    .prepare("SELECT id,quantity FROM items WHERE name='UI Photo protected'")
    .get();
  expect(saved.quantity).toBe(3.25);
  expect(
    app.sqlite
      .prepare("SELECT count(*) n FROM items WHERE name='UI Photo protected'")
      .get().n,
  ).toBe(1);
  await page.goto(app.base + `/#/item/${saved.id}/edit`);
  await page.getByLabel("Name", { exact: true }).fill("UI Renamed safely");
  await api(`/api/items/${saved.id}/checkout`, "POST", { quantity: 1 });
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "UI Renamed safely" }),
  ).toBeVisible();
  expect((await api(`/api/items/${saved.id}`)).quantity).toBe(2.25);
  await page.goto(app.base + `/#/home?q=UI%20Steel`);
  await page.getByLabel("Select UI Steel tube", { exact: true }).check();
  await page
    .getByRole("button", { name: "Restock selected", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Order quantity (ft)").fill("10");
  await page
    .getByRole("button", { name: "Create purchase order", exact: true })
    .click();
  await expect(page.getByText(/created for UI Supplier/)).toBeVisible();
  const po = app.sqlite
    .prepare(
      "SELECT * FROM fin_purchase_orders WHERE vendor='UI Supplier' ORDER BY id DESC",
    )
    .get();
  await page.getByRole("link", { name: "Open purchase orders" }).click();
  await page.getByRole("row").filter({ hasText: po.number }).click();
  await page
    .getByRole("button", { name: "Receive delivery", exact: true })
    .click();
  await page.getByLabel("Received this delivery (ft)").fill("4");
  await page
    .getByRole("button", { name: "Record delivery", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    app.sqlite
      .prepare("SELECT status FROM fin_purchase_orders WHERE id=?")
      .get(po.id).status,
  ).toBe("open");
  expect((await api(`/api/items/${steel.id}`)).quantity).toBe(20.75);
  await page.getByRole("row").filter({ hasText: po.number }).click();
  await page
    .getByRole("button", { name: "Receive delivery", exact: true })
    .click();
  await expect(page.getByLabel("Received this delivery (ft)")).toHaveValue("6");
  await page.screenshot({
    path: "test-results/inventory-receiving-mobile.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Record delivery", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    app.sqlite
      .prepare("SELECT status FROM fin_purchase_orders WHERE id=?")
      .get(po.id).status,
  ).toBe("received");
  await page.route("**/api/inventory/items?**", (r) =>
    r.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Synthetic temporary failure" }),
    }),
  );
  await page.goto(app.base + "/#/home?q=loadfailure");
  await expect(page.getByRole("alert")).toContainText(
    "Could not load inventory",
  );
  await page.unroute("**/api/inventory/items?**");
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No items match these filters.")).toBeVisible();
  expect(errors).toEqual([]);
}
