import crypto from "crypto";
import type { Express, Request } from "express";
import { storage } from "./storage";
import { requireAuth, requireElevated } from "./auth";
import { renderPublicPage } from "./legal";

// ─── QuickBooks Online integration ───────────────────────────────────────────
// Direction of truth: QBO owns the books (bookkeeper enters POs and Bills);
// this app owns the shop floor (receive/issue/adjust). We PULL items, projects
// and open POs; we PUSH project-linked issues as $0 sales documents (job cost
// without charging the customer — the boss's "track as internal cost only").
// Receives stay local: the bookkeeper converts the PO to a Bill in QBO when
// the vendor invoice arrives, which is what raises QBO's quantity on hand.

const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
const SCOPE = "com.intuit.quickbooks.accounting";
const MINORVERSION = "75";
const APP_NAME = "Flipnob Business Suite";

function qbEnv() {
  return {
    clientId: process.env.QB_CLIENT_ID || "",
    clientSecret: process.env.QB_CLIENT_SECRET || "",
    redirectUri: process.env.QB_REDIRECT_URI || "http://localhost:5000/api/qb/callback",
    environment: process.env.QB_ENVIRONMENT === "production" ? "production" : "sandbox",
  };
}

function apiBase(environment: string): string {
  return environment === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
}

function basicAuthHeader(): string {
  const { clientId, clientSecret } = qbEnv();
  return "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

// Pending OAuth state nonces (CSRF protection on the callback). In-memory is
// fine: a server restart mid-connect just means clicking Connect again.
const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function newState(): string {
  for (const [s, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(s);
  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now() + STATE_TTL_MS);
  return state;
}

function consumeState(state: string): boolean {
  const exp = pendingStates.get(state);
  pendingStates.delete(state);
  return exp !== undefined && exp >= Date.now();
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;            // seconds (access token)
  x_refresh_token_expires_in: number; // seconds (refresh token)
}

async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QuickBooks token request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

function saveTokens(t: TokenResponse, realmId?: string): void {
  const now = Date.now();
  const vals = {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    // Refresh 5 minutes early so we never race the expiry.
    accessExpiresAt: now + (t.expires_in - 300) * 1000,
    refreshExpiresAt: now + t.x_refresh_token_expires_in * 1000,
  };
  try {
    if (realmId) {
      storage.qbSaveConnection({ ...vals, realmId, environment: qbEnv().environment });
    } else {
      storage.qbUpdateTokens(vals);
    }
  } catch (e) {
    // QBO has already rotated the refresh token by the time we get here — if
    // this write is lost, the stored token is dead and the connection bricks.
    // One immediate retry covers transient lock contention; past that, log
    // loudly (never the token itself) so the operator knows to reconnect.
    try {
      if (realmId) {
        storage.qbSaveConnection({ ...vals, realmId, environment: qbEnv().environment });
      } else {
        storage.qbUpdateTokens(vals);
      }
    } catch (e2) {
      console.error("[qb] CRITICAL: failed to persist rotated QuickBooks tokens — the stored refresh token is now invalid and Settings → Connect must be re-run", e2);
      throw e2;
    }
  }
}

// Single-flight refresh: concurrent API calls share one token refresh instead
// of racing (a second refresh with the same token would fail — QBO rotates it).
let refreshInFlight: Promise<void> | null = null;

async function ensureFreshAccessToken(): Promise<{ accessToken: string; realmId: string; environment: string }> {
  const conn = storage.qbGetConnection();
  if (!conn) throw new Error("QuickBooks is not connected");
  if (conn.refresh_expires_at < Date.now()) {
    throw new Error("QuickBooks refresh token has expired — reconnect from Settings");
  }
  if (conn.access_expires_at > Date.now()) {
    return { accessToken: conn.access_token, realmId: conn.realm_id, environment: conn.environment };
  }
  if (!refreshInFlight) {
    refreshInFlight = tokenRequest({ grant_type: "refresh_token", refresh_token: conn.refresh_token })
      .then((t) => saveTokens(t))
      .catch((e) => {
        // invalid_grant means the refresh token is dead (revoked, expired, or
        // already rotated) and won't recover on retry. Mark the connection so
        // the status endpoint reports reconnectNeeded and the UI prompts the
        // admin to reconnect, instead of silently failing every later call.
        if (/invalid_grant/i.test(String(e?.message ?? e))) {
          storage.qbMarkRefreshExpired();
        }
        throw e;
      })
      .finally(() => { refreshInFlight = null; });
  }
  await refreshInFlight;
  const fresh = storage.qbGetConnection();
  return { accessToken: fresh.access_token, realmId: fresh.realm_id, environment: fresh.environment };
}

// ─── API client ──────────────────────────────────────────────────────────────

// Pace QBO calls under the per-realm throttle (10 req/s, 500 req/min). Each
// call reserves the next time slot synchronously (safe under concurrency since
// the reservation happens before any await), so a burst of pushes or a sync's
// chained queries can't fire faster than ~8/s and trip a 429.
const MIN_QB_CALL_GAP_MS = 120;
let qbNextSlot = 0;
async function qbRateGate(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, qbNextSlot);
  qbNextSlot = slot + MIN_QB_CALL_GAP_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function qbFetch(pathname: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  await qbRateGate();
  const doFetch = async () => {
    const { accessToken, realmId, environment } = await ensureFreshAccessToken();
    const url = new URL(`${apiBase(environment)}/v3/company/${realmId}${pathname}`);
    url.searchParams.set("minorversion", MINORVERSION);
    return fetch(url, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  };

  let res = await doFetch();
  if (res.status === 401) {
    // Access token rejected despite our clock check — force refresh and retry once.
    const conn = storage.qbGetConnection();
    if (conn) storage.qbUpdateTokens({
      accessToken: conn.access_token,
      refreshToken: conn.refresh_token,
      accessExpiresAt: 0,
      refreshExpiresAt: conn.refresh_expires_at,
    });
    res = await doFetch();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // intuit_tid is Intuit's per-request trace id from the response headers —
    // capturing it in the error makes it land in the push queue's last_error
    // and the logs, so Intuit support can pinpoint the exact failed call.
    const tid = res.headers.get("intuit_tid") || res.headers.get("intuit-tid") || "n/a";
    throw new Error(`QuickBooks API ${init.method || "GET"} ${pathname} failed (${res.status}, intuit_tid=${tid}): ${body.slice(0, 400)}`);
  }
  return res.json();
}

// Query endpoint with pagination. QBO caps MAXRESULTS at 1000.
async function qbQueryAll(entity: string, where = ""): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let start = 1; ; start += pageSize) {
    const q = `select * from ${entity}${where ? " where " + where : ""} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const data = await qbFetch(`/query?query=${encodeURIComponent(q)}`);
    const rows: any[] = data?.QueryResponse?.[entity] ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

// ─── Pull sync ───────────────────────────────────────────────────────────────

async function pullItems(): Promise<number> {
  // QBO queries exclude inactive rows unless asked — without the explicit
  // filter a deactivation in QBO would never reach us.
  const rows = await qbQueryAll("Item", "Active IN (true, false)");
  // One transaction for the whole batch instead of a commit per row.
  storage.qbUpsertItems(rows.map((r: any) => ({
    qbId: String(r.Id),
    name: r.Name ?? "",
    sku: r.Sku ?? null,
    type: r.Type ?? null,
    active: r.Active !== false,
  })));
  return rows.length;
}

async function pullCustomers(): Promise<number> {
  const rows = await qbQueryAll("Customer", "Active IN (true, false)");
  storage.qbUpsertCustomers(rows.map((r: any) => ({
    qbId: String(r.Id),
    displayName: r.FullyQualifiedName || r.DisplayName || "",
    // QBO Projects surface as sub-customers; IsProject needs a recent
    // minorversion. Jobs (legacy) set Job=true.
    isProject: r.IsProject === true || r.Job === true,
    active: r.Active !== false,
  })));
  return rows.length;
}

async function pullPurchaseOrders(): Promise<number> {
  const rows = await qbQueryAll("PurchaseOrder");
  // A PO the bookkeeper deletes in QBO simply stops appearing in query
  // results — flag the local copy so it can't inflate on-order counts or
  // accept receives forever.
  storage.qbMarkMissingPOs(rows.map((r: any) => String(r.Id)));
  for (const r of rows) {
    const lines = (r.Line ?? [])
      .filter((l: any) => l.DetailType === "ItemBasedExpenseLineDetail")
      .map((l: any) => ({
        qbLineId: l.Id != null ? String(l.Id) : null,
        qbItemId: l.ItemBasedExpenseLineDetail?.ItemRef?.value != null
          ? String(l.ItemBasedExpenseLineDetail.ItemRef.value)
          : null,
        description: l.Description ?? l.ItemBasedExpenseLineDetail?.ItemRef?.name ?? null,
        qty: Number(l.ItemBasedExpenseLineDetail?.Qty ?? 0),
        unitCost: l.ItemBasedExpenseLineDetail?.UnitPrice != null
          ? Number(l.ItemBasedExpenseLineDetail.UnitPrice)
          : null,
      }));
    storage.qbUpsertPO({
      qbId: String(r.Id),
      docNumber: r.DocNumber ?? null,
      vendorName: r.VendorRef?.name ?? null,
      txnDate: r.TxnDate ?? null,
      qbStatus: r.POStatus ?? null,
      memo: r.Memo ?? r.PrivateNote ?? null,
      lines,
    });
  }
  return rows.length;
}

export async function runSync(): Promise<{
  items: number; customers: number; purchaseOrders: number;
  autoMatchedItems: number; autoMatchedProjects: number;
  pushed: { done: number; errors: number };
}> {
  const items = await pullItems();
  const customers = await pullCustomers();
  const purchaseOrders = await pullPurchaseOrders();
  const autoMatchedItems = storage.qbAutoMatchItems();
  const autoMatchedProjects = storage.qbAutoMatchProjects();
  const pushed = await processPushQueue();
  storage.qbTouchLastSync();
  return { items, customers, purchaseOrders, autoMatchedItems, autoMatchedProjects, pushed };
}

// ─── Push queue ──────────────────────────────────────────────────────────────

// Called from the checkout/checkin/adjust routes. No-ops when QBO was never
// connected so the shop-floor flows have zero new failure modes.
export function qbEnqueueIssue(txn: { id: number; itemId: number; projectId: number | null; quantity: number; type: string }): void {
  if (!storage.qbHasConnection()) return; // presence check only — no token decrypt
  if (!txn.projectId) return; // no project → no QBO customer to cost it to
  storage.qbEnqueue({
    kind: txn.type === "check_in" ? "issue_return" : "issue",
    localRef: `txn:${txn.id}`,
    payload: { txnId: txn.id, itemId: txn.itemId, projectId: txn.projectId, quantity: txn.quantity },
  });
  setImmediate(() => { processPushQueue().catch(() => {}); });
}

export function qbEnqueueAdjust(adj: { id: number; itemId: number; itemName?: string | null; delta: number; reason: string }): void {
  if (!storage.qbHasConnection()) return; // presence check only — no token decrypt
  storage.qbEnqueue({
    kind: "adjust",
    localRef: `adj:${adj.id}`,
    // itemName rides along so a "manual" queue row tells the bookkeeper WHAT
    // to adjust, not just by how much.
    payload: { adjId: adj.id, itemId: adj.itemId, itemName: adj.itemName ?? null, delta: adj.delta, reason: adj.reason },
  });
  setImmediate(() => { processPushQueue().catch(() => {}); });
}

// InventoryAdjustment needs an adjustment account (debited side, e.g.
// "Inventory Shrinkage"). Auto-discovered once per process; null = not found.
let adjustAccountId: string | null | undefined;

async function findAdjustAccountId(): Promise<string | null> {
  // Only cache a hit — if the account doesn't exist yet, the bookkeeper may
  // create it later and the next adjustment should find it without a restart.
  if (adjustAccountId) return adjustAccountId;
  const exact = await qbQueryAll("Account", "Name = 'Inventory Shrinkage'");
  let acct = exact[0];
  if (!acct) {
    const cogs = await qbQueryAll("Account", "AccountType = 'Cost of Goods Sold'");
    acct = cogs.find((a: any) => /shrink|adjust/i.test(a.Name ?? "")) ?? cogs[0];
  }
  adjustAccountId = acct ? String(acct.Id) : null;
  return adjustAccountId;
}

let processing = false;
let rerunRequested = false;

// Transient failures (throttles, QBO 5xx, network blips) stay 'pending' and
// retry on the next trigger; only validation-style rejections are terminal.
function isTransientError(e: any): boolean {
  const m = String(e?.message || e);
  return /failed \((429|5\d\d)\)/.test(m) || /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(m);
}

// Stop retrying a transient failure after this many attempts so a poisoned
// job can't churn the API forever. Unmapped-item waits don't count toward
// this — they never reach the API.
const MAX_TRANSIENT_ATTEMPTS = 20;

export async function processPushQueue(): Promise<{ done: number; errors: number }> {
  if (processing) {
    // A run is in flight and won't see jobs enqueued after its snapshot —
    // ask it to do one more pass when it finishes.
    rerunRequested = true;
    return { done: 0, errors: 0 };
  }
  processing = true;
  let done = 0, errors = 0;
  // Jobs left 'pending' for retry must not respin within this run.
  const seen = new Set<number>();
  try {
    if (!storage.qbHasConnection()) return { done, errors }; // presence check; tokens decrypted later only when a job actually calls the API
    for (;;) {
      const batch = storage.qbQueuePending().filter((j: any) => !seen.has(j.id));
      if (batch.length === 0) break;
      for (const job of batch) {
        seen.add(job.id);
        try {
          const payload = JSON.parse(job.payload);
          if (job.kind === "issue" || job.kind === "issue_return") {
            const qbItemId = storage.qbItemIdForLocal(payload.itemId);
            const qbCustomerId = storage.qbCustomerIdForProject(payload.projectId);
            if (!qbItemId || !qbCustomerId) {
              // Recoverable: stays pending and goes through on the sync after
              // someone maps the item/project. No API call is wasted waiting.
              storage.qbQueueMark(job.id, "pending", {
                error: !qbItemId
                  ? "Waiting: item is not mapped to a QuickBooks item yet"
                  : "Waiting: project is not mapped to a QuickBooks customer/project yet",
                countAttempt: false,
              });
              continue;
            }
            // $0 sales document: moves cost out of inventory onto the job's
            // P&L (COGS) without billing the customer anything. Invoice for
            // issues; CreditMemo reverses it when parts come back. DocNumber
            // carries our txn id so a crash between create and mark can be
            // detected instead of double-posting.
            const docNumber = `FLP-T${payload.txnId}`.slice(0, 21);
            // Legacy prefix included in the dedup check: jobs that posted as
            // WPT-T… before the Flipnob rebrand must still be recognized so a
            // crashed-then-retried job can't double-post.
            const legacyDocNumber = `WPT-T${payload.txnId}`.slice(0, 21);
            const entity = job.kind === "issue" ? "invoice" : "creditmemo";
            const entityName = job.kind === "issue" ? "Invoice" : "CreditMemo";
            const existing = await qbQueryAll(entityName, `DocNumber IN ('${docNumber}', '${legacyDocNumber}')`);
            if (existing.length > 0) {
              storage.qbQueueMark(job.id, "done", { qbDocId: String(existing[0].Id) });
              done++;
              continue;
            }
            const body = {
              DocNumber: docNumber,
              CustomerRef: { value: qbCustomerId },
              PrivateNote: `Flipnob ${job.kind === "issue" ? "issue" : "return"} (txn #${payload.txnId})`,
              Line: [{
                DetailType: "SalesItemLineDetail",
                Amount: 0,
                SalesItemLineDetail: { ItemRef: { value: qbItemId }, Qty: payload.quantity, UnitPrice: 0 },
              }],
            };
            const created = await qbFetch(`/${entity}`, { method: "POST", body });
            const docId = created?.Invoice?.Id ?? created?.CreditMemo?.Id ?? null;
            storage.qbQueueMark(job.id, "done", { qbDocId: docId ? String(docId) : undefined });
            done++;
          } else if (job.kind === "adjust") {
            const itemLabel = payload.itemName ? `"${payload.itemName}"` : `item #${payload.itemId}`;
            const manualMsg = `Enter manually in QuickBooks: adjust ${itemLabel} by ${payload.delta} (${payload.reason})`;
            const qbItemId = storage.qbItemIdForLocal(payload.itemId);
            if (!qbItemId) {
              storage.qbQueueMark(job.id, "pending", { error: "Waiting: item is not mapped to a QuickBooks item yet", countAttempt: false });
              continue;
            }
            try {
              const acctId = await findAdjustAccountId();
              if (!acctId) {
                storage.qbQueueMark(job.id, "manual", { error: `${manualMsg} — no shrinkage/COGS account found to post against` });
                continue;
              }
              const created = await qbFetch("/inventoryadjustment", {
                method: "POST",
                body: {
                  DocNumber: `FLP-${payload.adjId}`.slice(0, 21),
                  AdjustAccountRef: { value: acctId },
                  TxnDate: new Date().toISOString().slice(0, 10),
                  PrivateNote: `Flipnob adjustment #${payload.adjId} (${payload.reason})`,
                  Line: [{
                    DetailType: "ItemAdjustmentLineDetail",
                    ItemAdjustmentLineDetail: { QtyDiff: payload.delta, ItemRef: { value: qbItemId } },
                  }],
                },
              });
              const docId = created?.InventoryAdjustment?.Id;
              storage.qbQueueMark(job.id, "done", { qbDocId: docId ? String(docId) : undefined });
              done++;
            } catch (e: any) {
              // The InventoryAdjustment API is gated (QBO Plus/Advanced +
              // Intuit partner tier). A 403/entitlement rejection isn't
              // transient — route it to the bookkeeper instead of retrying.
              const msg = String(e?.message || e);
              if (/403|authorization|entitle|not.?supported|access.?denied/i.test(msg)) {
                storage.qbQueueMark(job.id, "manual", { error: `${manualMsg} — QBO plan doesn't allow API adjustments` });
              } else {
                throw e; // classified below with the shared transient logic
              }
            }
          } else {
            storage.qbQueueMark(job.id, "error", { error: `Unknown push kind: ${job.kind}` });
            errors++;
          }
        } catch (e: any) {
          const msg = String(e?.message || e).slice(0, 400);
          const retry = isTransientError(e) && (job.attempts ?? 0) + 1 < MAX_TRANSIENT_ATTEMPTS;
          storage.qbQueueMark(job.id, retry ? "pending" : "error", { error: msg });
          if (!retry) errors++;
        }
      }
    }
  } finally {
    processing = false;
    if (rerunRequested) {
      rerunRequested = false;
      setImmediate(() => { processPushQueue().catch(() => {}); });
    }
  }
  return { done, errors };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Local copy of the audit helper (routes.ts has its own; importing it here
// would create a routes ⇄ qb circular import).
function qbAudit(req: Request, action: string, details: Record<string, unknown> = {}): void {
  const entry = {
    userId: req.user?.userId ?? null,
    userName: req.user?.name ?? null,
    role: req.user?.role ?? null,
    action,
    targetType: "quickbooks",
    targetId: null,
    targetName: null,
    ip: (req.ip || "?") as string,
    details,
  };
  setImmediate(() => {
    try { storage.appendAudit(entry); } catch (e) { console.error("[audit]", e); }
  });
}

export function registerQbRoutes(app: Express): void {
  // Connection status + queue/mapping health for the settings card.
  app.get("/api/qb/status", requireElevated, (_req, res) => {
    const conn = storage.qbGetConnection();
    if (!conn) return res.json({ connected: false, configured: Boolean(qbEnv().clientId) });
    res.json({
      connected: true,
      configured: true,
      realmId: conn.realm_id,
      environment: conn.environment,
      connectedAt: conn.connected_at,
      lastSyncAt: conn.last_sync_at,
      reconnectNeeded: conn.refresh_expires_at < Date.now(),
      queue: storage.qbQueueCounts(),
      unmapped: storage.qbUnmappedCounts(),
    });
  });

  // Connect / Reconnect entry point. Public 302 into Intuit's consent screen —
  // this is the URL given to Intuit as the app's "Connect/Reconnect URL," and
  // the in-app Connect button navigates here too. A full-page navigation can't
  // carry the X-Auth header, so this can't be auth-gated; the state nonce it
  // mints is what protects the callback that actually stores tokens.
  app.get("/api/qb/connect", (_req, res) => {
    const { clientId, redirectUri } = qbEnv();
    if (!clientId) {
      return res.redirect("/?qb=error&qbmsg=" + encodeURIComponent("QB_CLIENT_ID is not set in .env") + "#/settings");
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPE);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", newState());
    res.redirect(url.toString());
  });

  // Public landing page Intuit sends a user to when they disconnect the app
  // from the QuickBooks side (the "Disconnect URL"). Intuit-side disconnects
  // invalidate our tokens; the connection self-heals to a "reconnect needed"
  // state on the next refresh attempt, and an admin can fully clear it from
  // Settings. This page just explains what happened and how to reconnect.
  app.get("/disconnected", (_req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderPublicPage("Disconnected from QuickBooks", `
      <p class="lead">Your QuickBooks Online connection has been removed.</p>
      <p>${APP_NAME} will stop syncing with QuickBooks until it is reconnected. Your inventory data in the app is unaffected.</p>
      <h2>Reconnect</h2>
      <p>To reconnect, sign in to the app, open <strong>Settings &rarr; QuickBooks</strong>, and choose <strong>Connect to QuickBooks</strong>.</p>
      <p style="margin-top:24px"><a href="/">Return to ${APP_NAME}</a></p>
    `, { effective: false }));
  });

  // Unauthenticated by necessity (Intuit redirects the bare browser here);
  // the state nonce is the proof this flow started from our settings page.
  app.get("/api/qb/callback", async (req, res) => {
    const { code, state, realmId, error } = req.query as Record<string, string>;
    const fail = (msg: string) =>
      res.redirect(`/?qb=error&qbmsg=${encodeURIComponent(msg)}#/settings`);
    if (error) return fail(error);
    if (!state || !consumeState(state)) return fail("OAuth state mismatch — try connecting again");
    if (!code || !realmId) return fail("Missing authorization code");
    try {
      const tokens = await tokenRequest({
        grant_type: "authorization_code",
        code,
        redirect_uri: qbEnv().redirectUri,
      });
      saveTokens(tokens, realmId);
      res.redirect("/?qb=connected#/settings");
    } catch (e: any) {
      // Log only the message, never the raw error/response — the token
      // endpoint's payload is the most credential-adjacent thing we touch.
      console.error("[qb] token exchange failed:", e?.message ?? "unknown error");
      fail("Token exchange failed — check the redirect URI matches the Intuit app settings");
    }
  });

  app.post("/api/qb/disconnect", requireElevated, async (req, res) => {
    const conn = storage.qbGetConnection();
    if (conn) {
      try {
        await fetch(REVOKE_URL, {
          method: "POST",
          headers: { Authorization: basicAuthHeader(), "Content-Type": "application/json" },
          body: JSON.stringify({ token: conn.refresh_token }),
        });
      } catch {
        /* revoke is best-effort; we clear locally regardless */
      }
      storage.qbClearConnection();
      qbAudit(req, "qb.disconnect", { realmId: conn.realm_id });
    }
    res.json({ ok: true });
  });

  app.post("/api/qb/sync", requireElevated, async (req, res) => {
    try {
      const summary = await runSync();
      qbAudit(req, "qb.sync", summary as any);
      res.json(summary);
    } catch (e: any) {
      res.status(502).json({ message: String(e?.message || e) });
    }
  });

  // ── Mappings ──
  app.get("/api/qb/mappings/items", requireElevated, (_req, res) => {
    res.json(storage.qbListItems());
  });

  app.post("/api/qb/mappings/items/:qbId", requireElevated, (req, res) => {
    const { itemId, ignore } = req.body ?? {};
    if (ignore) {
      storage.qbMapItem(String(req.params.qbId), null, "ignored");
    } else if (itemId) {
      const item = storage.getItemById(Number(itemId));
      if (!item) return res.status(404).json({ message: "Item not found" });
      storage.qbMapItem(String(req.params.qbId), item.id, "matched");
    } else {
      storage.qbMapItem(String(req.params.qbId), null, "unmatched");
    }
    res.json({ ok: true });
  });

  app.get("/api/qb/mappings/projects", requireElevated, (_req, res) => {
    res.json(storage.qbListCustomers());
  });

  app.post("/api/qb/mappings/projects/:qbId", requireElevated, (req, res) => {
    const projectId = req.body?.projectId ? Number(req.body.projectId) : null;
    storage.qbMapCustomer(String(req.params.qbId), projectId);
    res.json({ ok: true });
  });

  // ── Push queue visibility ──
  app.get("/api/qb/queue", requireElevated, (_req, res) => {
    res.json(storage.qbQueueList(50));
  });

  app.post("/api/qb/queue/process", requireElevated, async (_req, res) => {
    res.json(await processPushQueue());
  });

  // Flip a dead-lettered (error/manual) row back to pending and reprocess.
  app.post("/api/qb/queue/:id/retry", requireElevated, (req, res) => {
    storage.qbQueueRetry(Number(req.params.id));
    setImmediate(() => { processPushQueue().catch(() => {}); });
    res.json({ ok: true });
  });

  // ── Purchase orders + receiving (shop floor — any signed-in user) ──
  app.get("/api/pos", requireAuth, (req, res) => {
    res.json(storage.qbListPOs({ includeClosed: req.query.all === "1" }));
  });

  app.post("/api/pos/lines/:lineId/receive", requireAuth, (req, res) => {
    const lineId = Number(req.params.lineId);
    const qty = Number(req.body?.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      return res.status(400).json({ message: "Quantity must be a positive whole number" });
    }
    const line = storage.qbGetPoLine(lineId);
    if (!line) return res.status(404).json({ message: "PO line not found" });
    if (line.qb_status !== "Open") {
      return res.status(409).json({ message: "This PO is no longer open in QuickBooks — sync and check with the bookkeeper" });
    }
    if (!line.local_item_id) {
      return res.status(409).json({ message: "This QuickBooks item isn't mapped to an inventory item yet — map it on the QuickBooks page first" });
    }
    // getItemById excludes soft-deleted rows, so stock can't silently land
    // on an item sitting in the Trash.
    if (!storage.getItemById(line.local_item_id)) {
      return res.status(409).json({ message: "The mapped inventory item was deleted — restore it from Trash or remap the QuickBooks item" });
    }
    const remaining = Number(line.qty) - Number(line.qty_received);
    if (qty > Math.ceil(remaining)) {
      return res.status(400).json({ message: `Only ${remaining} remaining on this line` });
    }
    // The receive is a normal check-in so it shows in Activity and item
    // history. QBO's quantity rises when the bookkeeper bills the PO — we
    // deliberately do NOT push receives.
    const txn = storage.createTransaction(line.local_item_id, req.user!.userId, "check_in", {
      quantity: qty,
      notes: `Received on PO ${line.doc_number ?? ""}`.trim(),
    });
    storage.qbReceivePoLine(lineId, qty);
    qbAudit(req, "po.receive", { poLine: lineId, doc: line.doc_number, qty, txnId: txn.id });
    res.status(201).json({ ok: true, txnId: txn.id });
  });
}
