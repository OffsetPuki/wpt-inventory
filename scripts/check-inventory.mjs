import assert from "node:assert/strict";
import crypto from "node:crypto";
import { testApp } from "./test-app.mjs";
const app = await testApp();
const { api, owner, sqlite, storage } = app;
const key = () => crypto.randomUUID();
const post = (path, body, token = owner) => api(path, "POST", body, token);
const get = (path) => api(path, "GET", undefined, owner);
const ok = (r, status = 200) => {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
};
const create = async (data) =>
  ok(
    await post("/api/items", {
      name: "Inventory test",
      category: "raw_materials",
      itemType: "raw_material",
      quantity: 10,
      unit: "each",
      ...data,
    }),
    201,
  );
const current = async (id) => ok(await get(`/api/items/${id}`));
const check = (message) => console.log(`PASS ${message}`);
try {
  ok(
    await post("/api/users", { name: "Worker", pin: "1234", role: "worker" }),
    201,
  );
  const worker = ok(
    await post("/api/auth/login", { name: "Worker", pin: "1234" }),
  );
  const item = await create({
    name: "Test tube",
    unit: "ft",
    quantity: 10,
    area: "main_shop",
    rackLetter: "F",
    shelf: "7",
    bin: "Blue",
  });
  const checkout = { quantity: 2.5, requestKey: key() };
  const tx = ok(await post(`/api/items/${item.id}/checkout`, checkout), 201);
  assert.equal(
    ok(await post(`/api/items/${item.id}/checkout`, checkout), 201).id,
    tx.id,
  );
  assert.equal((await current(item.id)).quantity, 7.5);
  ok(
    await api(
      `/api/items/${item.id}`,
      "PATCH",
      {
        name: "Test tube renamed",
        quantity: 10,
        quantityReserved: 900,
        detailVersion: item.detailVersion,
      },
      owner,
    ),
  );
  assert.equal((await current(item.id)).quantity, 7.5);
  assert.equal((await current(item.id)).quantityReserved, 0);
  assert.equal(
    (
      await api(
        `/api/items/${item.id}`,
        "PATCH",
        { name: "stale", detailVersion: item.detailVersion },
        owner,
      )
    ).status,
    409,
  );
  check(
    "Metadata cannot overwrite stock; duplicate requests and stale metadata are protected",
  );
  const job = ok(
    await post("/api/projects", {
      name: "Stock test job",
      jobNumber: "STOCK-JOB",
    }),
    201,
  );
  const other = ok(
    await post("/api/projects", {
      name: "Other stock job",
      jobNumber: "STOCK-OTHER",
    }),
    201,
  );
  const reserve = ok(
    await post(`/api/items/${item.id}/reservations`, {
      projectId: job.id,
      quantity: 6,
      requestKey: key(),
    }),
    201,
  );
  assert.equal(
    (
      await post(`/api/items/${item.id}/checkout`, {
        quantity: 2,
        projectId: other.id,
      })
    ).status,
    400,
  );
  ok(
    await post(`/api/items/${item.id}/checkout`, {
      quantity: 2,
      projectId: job.id,
      requestKey: key(),
    }),
    201,
  );
  assert.equal((await current(item.id)).quantityReserved, 4);
  assert.equal((await current(item.id)).quantity, 5.5);
  const before = await current(item.id);
  ok(
    await post(`/api/items/${item.id}/checkin`, {
      quantity: 1,
      action: "receive",
    }),
    201,
  );
  assert.equal(
    (
      await post(`/api/items/${item.id}/adjust`, {
        countedQuantity: 7,
        expectedVersion: before.stockVersion,
        reason: "count_correction",
      })
    ).status,
    400,
  );
  const now = await current(item.id),
    count = {
      countedQuantity: 7.25,
      expectedVersion: now.stockVersion,
      reason: "count_correction",
      requestKey: key(),
    };
  const adjustment = ok(await post(`/api/items/${item.id}/adjust`, count), 201);
  assert.equal(
    ok(await post(`/api/items/${item.id}/adjust`, count), 201).id,
    adjustment.id,
  );
  assert.equal(
    (
      await post(`/api/items/${item.id}/adjust`, {
        delta: -100,
        reason: "missing",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        `/api/items/${item.id}/adjust`,
        { delta: 1, reason: "count_correction" },
        worker.token,
      )
    ).status,
    403,
  );
  check(
    "Job reservations, decimal movements, count conflicts and permissions hold",
  );
  const tool = await create({
    name: "Test drill",
    itemType: "tool",
    category: "tools",
    quantity: 2,
  });
  const loan = ok(
    await post(
      `/api/items/${tool.id}/checkout`,
      { quantity: 1, projectId: job.id, requestKey: key() },
      worker.token,
    ),
    201,
  );
  assert.equal(
    ok(await get(`/api/items/${tool.id}/availability`)).loans[0].borrowerName,
    "Worker",
  );
  assert.equal(
    (
      await post(`/api/items/${tool.id}/checkin`, {
        quantity: 2,
        loanId: loan.id,
      })
    ).status,
    400,
  );
  ok(
    await post(`/api/items/${tool.id}/checkin`, {
      quantity: 1,
      loanId: loan.id,
      requestKey: key(),
    }),
    201,
  );
  assert.equal(
    (
      await post(`/api/items/${tool.id}/checkin`, {
        quantity: 1,
        loanId: loan.id,
      })
    ).status,
    400,
  );
  assert.equal((await current(tool.id)).quantity, 2);
  assert.equal(
    (await post(`/api/items/${tool.id}/checkout`, { quantity: 0.5 })).status,
    400,
  );
  check("Tool borrowers and returns are tracked without over-returning");
  const checklistItem = await create({
    name: "Checklist material",
    unit: "ft",
    quantity: 20,
  });
  const row = storage.createChecklistRow(job.id, {
    label: "Cut stock",
    qty: 6,
    unit: "ft",
    itemId: checklistItem.id,
  });
  assert.equal((await current(checklistItem.id)).quantityReserved, 6);
  ok(
    await post(`/api/items/${checklistItem.id}/checkout`, {
      quantity: 2,
      projectId: job.id,
    }),
    201,
  );
  storage.updateChecklistRow(row.id, { status: "done" }, 1);
  assert.equal((await current(checklistItem.id)).quantity, 14);
  assert.equal((await current(checklistItem.id)).quantityReserved, 0);
  storage.updateChecklistRow(row.id, { status: "pending" }, 1);
  storage.updateChecklistRow(row.id, { status: "done" }, 1);
  assert.equal((await current(checklistItem.id)).quantity, 14);
  const reservation2 = ok(
    await post(`/api/items/${checklistItem.id}/reservations`, {
      projectId: other.id,
      quantity: 4,
      requestKey: key(),
    }),
    201,
  );
  storage.releaseProjectReservations(job.id);
  storage.releaseProjectReservations(job.id);
  assert.equal((await current(checklistItem.id)).quantityReserved, 4);
  check(
    "Checklist completion deducts only unused stock and repeated releases preserve other jobs",
  );
  const stick = await create({
    name: "Receiving sticks",
    unit: "stick",
    quantity: 0,
  });
  const po = ok(
    await post("/api/finance/purchase-orders", {
      vendor: "Synthetic supplier",
      items: [
        {
          description: "Steel in feet",
          qty: 40,
          unit: "ft",
          unitPriceCents: 100,
          inventoryItemId: stick.id,
        },
      ],
    }),
    201,
  );
  assert.equal(
    (
      await api(
        `/api/finance/purchase-orders/${po.id}`,
        "PATCH",
        { status: "received" },
        owner,
      )
    ).status,
    409,
  );
  const delivery = {
    requestKey: key(),
    lines: [
      {
        lineIndex: 0,
        quantity: 20,
        itemId: stick.id,
        stockQuantity: 1,
        conversionNote: "20 feet makes one stick",
      },
    ],
  };
  const delivered = ok(
    await post(`/api/finance/purchase-orders/${po.id}/receive`, delivery),
  );
  assert.equal(delivered.partial, true);
  ok(await post(`/api/finance/purchase-orders/${po.id}/receive`, delivery));
  assert.equal((await current(stick.id)).quantity, 1);
  assert.equal(
    sqlite
      .prepare(
        "SELECT amount_cents FROM fin_expenses WHERE id=(SELECT expense_id FROM inventory_po_expenses WHERE po_id=?)",
      )
      .get(po.id).amount_cents,
    2000,
  );
  assert.equal(
    (
      await api(
        `/api/finance/purchase-orders/${po.id}`,
        "PATCH",
        { vendor: "Changed" },
        owner,
      )
    ).status,
    409,
  );
  const receiptBefore = sqlite
    .prepare("SELECT count(*) n FROM inventory_receipts WHERE po_id=?")
    .get(po.id).n;
  assert.equal(
    (
      await post(`/api/finance/purchase-orders/${po.id}/receive`, {
        requestKey: key(),
        lines: [
          {
            lineIndex: 0,
            quantity: 21,
            itemId: stick.id,
            stockQuantity: 1,
            conversionNote: "Invalid excess",
          },
        ],
      })
    ).status,
    409,
  );
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM inventory_receipts WHERE po_id=?")
      .get(po.id).n,
    receiptBefore,
  );
  const linkedExpense = sqlite
    .prepare("SELECT expense_id FROM inventory_po_expenses WHERE po_id=?")
    .get(po.id).expense_id;
  sqlite
    .prepare(
      "UPDATE fin_expenses SET notes='Reviewed material delivery',amount_cents=9999 WHERE id=?",
    )
    .run(linkedExpense);
  assert.equal(
    (
      await post(`/api/finance/purchase-orders/${po.id}/receive`, {
        ...delivery,
        requestKey: key(),
      })
    ).status,
    409,
  );
  assert.equal((await current(stick.id)).quantity, 1);
  sqlite
    .prepare("UPDATE fin_expenses SET amount_cents=2000 WHERE id=?")
    .run(linkedExpense);
  const final = ok(
    await post(`/api/finance/purchase-orders/${po.id}/receive`, {
      ...delivery,
      requestKey: key(),
    }),
  );
  assert.equal(final.status, "received");
  assert.equal((await current(stick.id)).quantity, 2);
  assert.equal(
    sqlite
      .prepare(
        "SELECT amount_cents FROM fin_expenses WHERE id=(SELECT expense_id FROM inventory_po_expenses WHERE po_id=?)",
      )
      .get(po.id).amount_cents,
    4000,
  );
  check(
    "Partial receiving, explicit conversions, costs and expenses commit once and reject excess delivery",
  );
  const restockInput = {
    requestKey: key(),
    vendor: "Synthetic restock",
    lines: [{ itemId: stick.id, quantity: 3, unitCostCents: 1700 }],
  };
  const order = ok(await post("/api/inventory/restock", restockInput), 201);
  assert.equal(
    ok(await post("/api/inventory/restock", restockInput), 201).id,
    order.id,
  );
  const receivedOrder = ok(
    await api(
      `/api/finance/purchase-orders/${order.id}`,
      "PATCH",
      { status: "received" },
      owner,
    ),
  );
  assert.equal(receivedOrder.status, "received");
  assert.equal((await current(stick.id)).quantity, 5);
  check(
    "Restocking creates one order and same-unit receipt uses the chosen location",
  );
  const insert = sqlite.prepare(
    "INSERT INTO items(name,category,quantity,area,rack_letter,photo_url,notes,custom_attrs) VALUES(?,'raw_materials',1,'main_shop','Z',NULL,?,?)",
  );
  sqlite.transaction(() => {
    for (let i = 0; i < 551; i++)
      insert.run(
        `Page fixture ${String(i).padStart(4, "0")}`,
        "x".repeat(1000),
        JSON.stringify({ notes: "x".repeat(1000) }),
      );
  })();
  const pages = ok(await get("/api/inventory/items?q=Page%20fixture&limit=50"));
  assert.equal(pages.total, 551);
  assert.equal(pages.items.length, 50);
  assert.equal(pages.pages, 12);
  assert.ok(!("notes" in pages.items[0]));
  const last = ok(
    await get("/api/inventory/items?q=Page%20fixture&limit=50&page=12"),
  );
  assert.equal(last.items.length, 1);
  assert.equal(last.items[0].name, "Page fixture 0550");
  assert.equal(
    ok(await get("/api/inventory/items?q=rack%20F%20Blue")).items[0].id,
    item.id,
  );
  assert.ok(ok(await get("/api/inventory/map-items")).length > 551);
  assert.ok(
    ok(await get("/api/inventory/duplicates?name=Test%20drill")).some(
      (i) => i.id === tool.id,
    ),
  );
  const zero = await create({ name: "Zero without threshold", quantity: 0 });
  assert.ok(
    ok(await get("/api/inventory/items?filter=out")).items.some(
      (i) => i.id === zero.id,
    ),
  );
  const history = ok(await get(`/api/inventory/history?itemId=${item.id}`));
  assert.ok(history.rows.some((r) => r.before === 6.5 && r.after === 7.25));
  assert.ok(ok(await get("/api/inventory/jobs?q=STOCK")).length >= 2);
  check(
    "Location search, honest pagination beyond 500, map completeness, duplicate hints and history work",
  );
  // A failing ledger insert must roll back the quantity change and retry record.
  const beforeFailure = (await current(stick.id)).quantity;
  sqlite.exec(
    "CREATE TRIGGER test_receipt_failure BEFORE INSERT ON adjustments WHEN NEW.notes LIKE 'PO-%' BEGIN SELECT RAISE(ABORT,'test ledger failure'); END",
  );
  const failedOrder = ok(
    await post("/api/inventory/restock", {
      ...restockInput,
      requestKey: key(),
    }),
    201,
  );
  assert.equal(
    (
      await post(`/api/finance/purchase-orders/${failedOrder.id}/receive`, {
        requestKey: key(),
        lines: [
          { lineIndex: 0, quantity: 1, itemId: stick.id, stockQuantity: 1 },
        ],
      })
    ).status,
    409,
  );
  assert.equal((await current(stick.id)).quantity, beforeFailure);
  assert.equal(
    sqlite
      .prepare("SELECT count(*) n FROM inventory_receipts WHERE po_id=?")
      .get(failedOrder.id).n,
    0,
  );
  sqlite.exec("DROP TRIGGER test_receipt_failure");
  check(
    "Injected receiving failure leaves stock, receipt and expense unchanged",
  );
  const legacy = await create({ name: "Legacy reserved stock", quantity: 8 });
  sqlite
    .prepare("UPDATE items SET quantity_reserved=4 WHERE id=?")
    .run(legacy.id);
  const legacyBefore = await current(legacy.id);
  const review = {
    action: "assign",
    projectId: job.id,
    quantity: 2,
    expectedVersion: legacyBefore.stockVersion,
    requestKey: key(),
  };
  ok(await post(`/api/items/${legacy.id}/legacy-reservation`, review));
  ok(await post(`/api/items/${legacy.id}/legacy-reservation`, review));
  assert.equal((await current(legacy.id)).quantityReserved, 4);
  assert.equal(
    ok(await get(`/api/items/${legacy.id}/availability`)).reservations.length,
    1,
  );
  const reviewed = await current(legacy.id);
  ok(
    await post(`/api/items/${legacy.id}/legacy-reservation`, {
      action: "release",
      quantity: 1,
      expectedVersion: reviewed.stockVersion,
      requestKey: key(),
    }),
  );
  assert.equal((await current(legacy.id)).quantityReserved, 3);
  assert.equal((await current(legacy.id)).quantity, 8);
  const late = await create({
    name: "Initially short checklist stock",
    unit: "ft",
    quantity: 2,
  });
  const shortRow = storage.createChecklistRow(job.id, {
    label: "Needs ten",
    qty: 10,
    unit: "ft",
    itemId: late.id,
  });
  ok(
    await post(`/api/items/${late.id}/checkin`, {
      quantity: 10,
      action: "receive",
    }),
    201,
  );
  ok(
    await post(`/api/items/${late.id}/checkout`, {
      quantity: 10,
      projectId: job.id,
    }),
    201,
  );
  storage.updateChecklistRow(shortRow.id, { status: "done" }, 1);
  assert.equal((await current(late.id)).quantity, 2);
  check(
    "Reviewed legacy reservations preserve counts; later deliveries cannot cause duplicate checklist usage",
  );
  const priorAttention=ok(await get("/api/dashboard/attention")).lowStock;
  const noThreshold=await create({name:"No reorder alerts",quantity:0,lowStockThreshold:0});
  assert.equal(ok(await get("/api/dashboard/attention")).lowStock,priorAttention);
  sqlite.prepare("UPDATE items SET photo_url=NULL,photos=? WHERE id=?").run(JSON.stringify(["","/uploads/legacy-image.jpg"]),noThreshold.id);
  assert.equal(ok(await get("/api/inventory/items?q=No%20reorder%20alerts")).items[0].photoUrl,"/uploads/legacy-image.jpg");
  check("Disabled reorder alerts stay disabled and older photo arrays still show a thumbnail");
  console.log("Inventory regression checks passed.");
} finally {
  await app.close();
}
