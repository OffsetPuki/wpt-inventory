import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
export async function suiteWorkflow(page, browser, app, expect) {
  app.sqlite
    .prepare(
      "UPDATE users SET credential_type='password',totp_secret=COALESCE(totp_secret,'JBSWY3DPEHPK3PXP') WHERE id=1",
    )
    .run();
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const token = crypto.randomBytes(32).toString("hex");
  app.sqlite
    .prepare(
      "INSERT INTO sessions(token,user_id,role,name,expires_at) VALUES(?,1,'owner','Owner',?)",
    )
    .run(token, Date.now() + 3600000);
  await page.addInitScript(
    (t) => localStorage.setItem("wpt-auth-token", t),
    token,
  );
  const api = async (url, method = "GET", body) => {
    const r = await app.api(url, method, body, token);
    expect(r.status, JSON.stringify(r.data)).toBeLessThan(300);
    return r.data;
  };
  const client = await api("/api/crm/clients", "POST", {
    name: "Suite workflow customer",
    email: "owner@example.test",
  });
  const job = await api("/api/projects", "POST", {
    jobNumber: "UI-CONNECTED",
    name: "Connected mobile job",
    clientId: client.id,
  });
  const requests = [];
  page.on("requestfinished", (r) =>
    requests.push(r.url().replace(app.base, "")),
  );
  const loadStarted = performance.now();
  await page.goto(app.base + `/#/project/${job.id}`);
  await expect(
    page.getByRole("heading", { name: "Connected mobile job", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Live updates", { exact: true })).toBeVisible();
  const evidenceDir = path.resolve("../_audit/2026-09-10/evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, "suite-browser-metrics.json"),
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        scenario:
          "Fresh mobile job overview until heading and live indicator are visible; local loopback, no throttling",
        elapsedMs: Math.round(performance.now() - loadStarted),
        completedRequests: requests.length,
        uniqueRequests: [...new Set(requests)],
        resources: await page.evaluate(() =>
          performance
            .getEntriesByType("resource")
            .map((r) => ({
              path: new URL(r.name).pathname,
              bytes: r.transferSize,
              durationMs: Math.round(r.duration),
            })),
        ),
      },
      null,
      2,
    ),
  );
  await page.getByRole("link", { name: "work", exact: true }).click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill("Connected crew task");
  await dialog.getByRole("button", { name: /Create task|Save task/ }).click();
  await expect(
    page.getByRole("link", { name: /Connected crew task/ }),
  ).toBeVisible();
  const task = app.sqlite
    .prepare("SELECT * FROM pm_tasks WHERE title='Connected crew task'")
    .get();
  expect(task.project_id).toBe(job.id);

  const other = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const second = await other.newPage();
  await second.addInitScript(
    (t) => localStorage.setItem("wpt-auth-token", t),
    token,
  );
  try {
    await second.goto(app.base + `/#/project/${job.id}?tab=work`);
    await expect(
      second.getByText("Live updates", { exact: true }),
    ).toBeVisible();
    await api(`/api/pm/tasks/${task.id}`, "PATCH", {
      title: "Crew task updated on another screen",
    });
    await expect(
      page.getByRole("link", { name: /Crew task updated on another screen/ }),
    ).toBeVisible();
    await expect(
      second.getByRole("link", { name: /Crew task updated on another screen/ }),
    ).toBeVisible();
    await second.goto(app.base + `/#/project/${job.id}?tab=files`);
    await expect(
      second.getByText("Photos, drawings & measurements", { exact: true }),
    ).toBeVisible();
    fs.writeFileSync(
      path.join(app.uploadsDir, "live-file.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    await api(`/api/suite/jobs/${job.id}/files`, "POST", {
      requestKey: crypto.randomUUID(),
      title: "Live shared measurement",
      url: "/uploads/live-file.png",
      kind: "measurement",
      replacesId: null,
    });
    await expect(
      second.getByRole("link", { name: /Live shared measurement/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: "activity", exact: true }).click();
    await page
      .getByLabel("Comment", { exact: true })
      .fill("Measurements verified by the crew.");
    await page
      .getByRole("button", { name: "Post internal comment", exact: true })
      .click();
    await expect(
      page.getByText("Measurements verified by the crew.", { exact: true }),
    ).toBeVisible();
    await second.goto(app.base + `/#/project/${job.id}?tab=activity`);
    await expect(
      second.getByText("Measurements verified by the crew.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Job settings", exact: true })
      .click();
    await page
      .getByLabel("Job address", { exact: true })
      .fill("Unfinished address edit");
    await api(`/api/projects/${job.id}`, "PATCH", {
      name: "Connected job renamed remotely",
    });
    await expect(
      page.getByText("This job changed while this draft was open.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save job settings", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Discard draft and reopen current settings",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Exact search opens the customer even outside the current list page.
    await page
      .locator('input[placeholder="Search clients, invoices, items…"]:visible')
      .fill("Suite workflow customer");
    await page.getByRole("button", { name: /Suite workflow customer/ }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Suite workflow customer",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.goto(app.base + "/#/crm/clients");
    await page.getByRole("button", { name: "New client", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByLabel("Name", { exact: true })
      .fill("Recovered unsaved customer");
    await page.reload();
    await page.getByRole("button", { name: "New client", exact: true }).click();
    await expect(
      page.getByRole("dialog").getByLabel("Name", { exact: true }),
    ).toHaveValue("Recovered unsaved customer");
    await expect(page.getByRole("dialog")).toContainText(
      "Recovered your unfinished draft.",
    );
    await page
      .getByRole("button", { name: "Discard recovered edits", exact: true })
      .click();
    await page.getByRole("button", { name: "Close", exact: true }).click();

    await page.goto(app.base + "/#/suite-health");
    await expect(
      page.getByRole("heading", { name: "Owner controls", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Received material costs", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.goto(app.base + `/#/project/${job.id}?tab=money`);
    await expect(page.getByText("Job money", { exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const dir = path.resolve("../_audit/2026-09-10/evidence");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({
      path: path.join(dir, "suite-job-mobile.png"),
      fullPage: true,
    });
    await second.goto(app.base + `/#/project/${job.id}`);
    await expect(
      second.getByRole("heading", {
        name: "Connected job renamed remotely",
        exact: true,
      }),
    ).toBeVisible();
    await second.screenshot({
      path: path.join(dir, "suite-job-desktop.png"),
      fullPage: true,
    });
  } finally {
    await other.close();
  }
  expect(errors).toEqual([]);
}
