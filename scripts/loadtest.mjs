// Quick load tester. Logs in once, then ramps concurrent virtual users
// against a mix of the hot endpoints the app actually polls, and reports
// throughput + p50 / p95 / p99 latency per level. Run with:
//   node scripts/loadtest.mjs
// Optional env: BASE=http://localhost:5000 USER=Manager PIN=1234

const BASE = process.env.BASE || "http://localhost:5000";
const USER = process.env.USER_NAME || "Manager";
const PIN = process.env.PIN || "1234";

// Mix that mirrors what a logged-in worker page actually fires every 15s.
const ENDPOINTS = [
  { path: "/api/items", weight: 4 },          // Find Items, dashboards
  { path: "/api/stats", weight: 1 },          // Dashboard
  { path: "/api/projects", weight: 2 },       // Projects list
  { path: "/api/transactions?limit=20", weight: 2 }, // Activity
  { path: "/api/auth/me", weight: 1 },        // session ping
];
const POOL = ENDPOINTS.flatMap((e) => Array(e.weight).fill(e.path));

const CONCURRENCY_LEVELS = [1, 10, 25, 50, 100, 200, 400];
const REQUESTS_PER_LEVEL = 2000;

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: USER, pin: PIN }),
  });
  if (!r.ok) throw new Error(`Login failed: ${r.status}`);
  return (await r.json()).token;
}

async function worker(token, count, lat, errs) {
  for (let i = 0; i < count; i++) {
    const path = POOL[Math.floor(Math.random() * POOL.length)];
    const t0 = performance.now();
    try {
      const r = await fetch(`${BASE}${path}`, { headers: { "X-Auth": token } });
      const dt = performance.now() - t0;
      if (r.ok) lat.push(dt);
      else errs.push({ path, status: r.status });
      // Drain body so the connection is reusable.
      await r.arrayBuffer();
    } catch (e) {
      errs.push({ path, err: e.message });
    }
  }
}

async function runLevel(token, concurrency) {
  const perWorker = Math.ceil(REQUESTS_PER_LEVEL / concurrency);
  const lat = [];
  const errs = [];
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, () => worker(token, perWorker, lat, errs))
  );
  const totalSec = (performance.now() - start) / 1000;
  const sorted = lat.slice().sort((a, b) => a - b);
  return {
    concurrency,
    totalRequests: lat.length + errs.length,
    successes: lat.length,
    errors: errs.length,
    durationSec: totalSec.toFixed(2),
    rps: (lat.length / totalSec).toFixed(1),
    p50: pct(sorted, 50).toFixed(1),
    p95: pct(sorted, 95).toFixed(1),
    p99: pct(sorted, 99).toFixed(1),
    max: (sorted[sorted.length - 1] ?? 0).toFixed(1),
    sampleErrors: errs.slice(0, 3),
  };
}

(async () => {
  console.log(`Target: ${BASE}`);
  const token = await login();
  console.log(`Logged in as ${USER}; warming up...`);

  // Warm up so JIT / connection pool aren't measured.
  await worker(token, 200, [], []);

  console.log(
    "\nconc | success | errors | sec   |   rps  |  p50 |  p95 |  p99 |   max"
  );
  console.log(
    "-----+---------+--------+-------+--------+------+------+------+------"
  );
  for (const c of CONCURRENCY_LEVELS) {
    const r = await runLevel(token, c);
    console.log(
      `${String(r.concurrency).padStart(4)} | ${String(r.successes).padStart(7)} | ${String(r.errors).padStart(6)} | ${String(r.durationSec).padStart(5)} | ${String(r.rps).padStart(6)} | ${String(r.p50).padStart(4)} | ${String(r.p95).padStart(4)} | ${String(r.p99).padStart(4)} | ${String(r.max).padStart(5)}`
    );
    if (r.errors > 0 && r.sampleErrors.length) {
      console.log("   first errors:", JSON.stringify(r.sampleErrors));
    }
  }
})();
