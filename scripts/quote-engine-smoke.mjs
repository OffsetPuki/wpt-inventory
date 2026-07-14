// =============================================================================
//  Quote engine smoke test — exercises the material-library pricing end to end.
//  Run:  node scripts/quote-engine-smoke.mjs
//  Pure JS, no server needed. Fails loudly (exit 1) if any invariant breaks.
// =============================================================================

import { DEFAULT_PRICE_BOOK } from '../client/src/quote/data/priceBook.js';
import {
  deriveItems, buildLineState, deriveWarnings, materialTotals, lineCost, matRate,
} from '../client/src/quote/lib/estimate.js';
import { computeTotals } from '../client/src/quote/lib/quote.js';
import { defaultState } from '../client/src/quote/data/configurators.js';
import { deepMerge } from '../client/src/quote/lib/store.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}
function approx(a, b, eps = 0.01) { return Math.abs(a - b) < eps; }
const pb = DEFAULT_PRICE_BOOK;
const item = (items, key) => items.find((i) => i.key === key);

// ── 1. Fence — horizontal slat, the owner's core shop math ───────────────────
console.log('\nFence (horizontal slat, 40 ft × 6 ft, 6 ft sections):');
{
  const s = defaultState('fence'); // 40ft, 6ft tall, 6ft panels, underground 3, 4 bags
  const { items, laborHours, installHours } = deriveItems('fence', s, pb);

  // 7 panels → 8 posts × (6+3) ft = 72 ft of 4×4×3/16
  const posts = item(items, 'posts');
  check('posts = 8 × (6+3) = 72 ft of 4×4×3/16', posts && approx(posts.qty, 72) && posts.materialId === 'tube_4x4_316', `got ${posts?.qty}`);
  check('post rate = $12 × 1.10 waste = $13.20/ft', approx(posts.rate, 13.2), `got ${posts?.rate}`);

  // 8 posts × 4 bags = 32 bags of concrete
  const conc = item(items, 'concrete');
  check('concrete = 32 bags (4/post)', conc && approx(conc.qty, 32) && conc.materialId === 'concrete_bag', `got ${conc?.qty}`);

  // auto slats: round(72" / (4+1)") = 14 per section × 7 sections × 6 ft = 588 ft
  const slats = item(items, 'slats');
  check('slats auto = 14/section → 588 ft of 4×1', slats && approx(slats.qty, 588) && slats.materialId === 'tube_4x1', `got ${slats?.qty}`);

  // manual slat count wins
  const manual = deriveItems('fence', { ...s, slatCount: 5 }, pb);
  check('manual slat count 5 → 210 ft', approx(item(manual.items, 'slats').qty, 5 * 7 * 6));

  // 4×2 selection swaps material
  const m42 = deriveItems('fence', { ...s, slatMaterial: '4x2' }, pb);
  check('4×2 slat material selected', item(m42.items, 'slats').materialId === 'tube_4x2');

  check('labor split present', laborHours > 0 && installHours > 0, `${laborHours}/${installHours}`);

  // demo adds tear-out + dump fee
  const demo = deriveItems('fence', { ...s, demoFt: 40 }, pb);
  check('demo 40 ft + dump fee', item(demo.items, 'demo')?.qty === 40 && lineCost(item(demo.items, 'dump')) === pb.dumpFeeFlat);
}

// ── 2. Fence — wood + mesh (the 6×6 example: 2 posts, 3 rails, wood by area) ─
console.log('\nFence (wood+mesh, one 6×6 section):');
{
  const s = { ...defaultState('fence'), type: 'wood-mesh', totalLengthFt: 6, height: 6, panelWidth: 6, meshRatio: 50 };
  const { items } = deriveItems('fence', s, pb);
  check('1 section → 2 posts × 9 ft = 18 ft', approx(item(items, 'posts').qty, 18));
  check('3 horizontal 4×4 members × 6 ft = 18 ft', approx(item(items, 'rails').qty, 18) && item(items, 'rails').materialId === 'tube_4x4_316');
  check('mesh = 18 sq ft (50% of 36)', approx(item(items, 'mesh').qty, 18));
  check('wood = 18 sq ft × 3 board-ft = 54 ft of 4×1 wood', approx(item(items, 'wood').qty, 54) && item(items, 'wood').materialId === 'wood_4x1');
  check('concrete still 2 × 4 = 8 bags', approx(item(items, 'concrete').qty, 8));
}

// ── 3. Gates — single / double / slide ───────────────────────────────────────
console.log('\nGates (10 ft × 6 ft):');
{
  const g = defaultState('gate'); // single, slat infill, 6h × 10w
  const single = deriveItems('gate', g, pb);
  check('single frame = 2×6 + 2×10 = 32 ft of 4×4', approx(item(single.items, 'frame').qty, 32));
  check('support posts = 2 × (6+3) = 18 ft of 6×6', approx(item(single.items, 'posts').qty, 18) && item(single.items, 'posts').materialId === 'tube_6x6');
  check('single hardware set', item(single.items, 'hardware').materialId === 'hw_single');
  check('gate slats are 4×4×3/16', item(single.items, 'slats').materialId === 'tube_4x4_316');

  const double = deriveItems('gate', { ...g, type: 'double', extraPosts: 'yes' }, pb);
  check('double frame = 4×6 + 2×10 = 44 ft', approx(item(double.items, 'frame').qty, 44));
  check('double + extras = 4 posts × 9 ft = 36 ft of 6×6', approx(item(double.items, 'posts').qty, 36));
  check('double hardware = 2× single price', approx(matRate(pb, 'hw_double'), matRate(pb, 'hw_single') * 2));
  check('double concrete = 16 bags', approx(item(double.items, 'concrete').qty, 16));

  const slide = deriveItems('gate', { ...g, type: 'slide', operator: 'one' }, pb);
  check('slide counterbalance tail = 10+6 = 16 ft', approx(item(slide.items, 'counterbalance').qty, 16));
  check('slide hardware set', item(slide.items, 'hardware').materialId === 'hw_slide');
  check('operator kit priced', item(slide.items, 'operator').materialId === 'hw_operator' && item(slide.items, 'operator').qty === 1);

  const wood = deriveItems('gate', { ...g, infill: 'metal-wood', mesh: 'yes', meshRatio: 25 }, pb);
  check('metal+wood: wood 45 sq ft → 135 board-ft', approx(item(wood.items, 'wood').qty, 135));
  check('metal+wood: mesh 15 sq ft', approx(item(wood.items, 'mesh').qty, 15));
}

// ── 4. Pergola — designer legs & side screens use shared 1×1 ────────────────
console.log('\nPergola (12 × 16 ft, 8 ft clearance):');
{
  const p = defaultState('pergola');
  const std = deriveItems('pergola', p, pb);
  check('4 posts × 8 ft (base plate) = 32 ft of 4×4', approx(item(std.items, 'posts').qty, 32) && item(std.items, 'posts').materialId === 'tube_4x4_316');
  check('no concrete on base-plate mount', !item(std.items, 'concrete'));

  const designer = deriveItems('pergola', { ...p, legs: 'designer' }, pb);
  check('designer: 5 pieces/leg × 4 legs × 8 ft = 160 ft of 1×1', approx(item(designer.items, 'legDeco').qty, 160) && item(designer.items, 'legDeco').materialId === 'tube_1x1');
  check('designer fabrication per post', item(designer.items, 'legs').qty === 4);

  const sides = deriveItems('pergola', { ...p, legs: 'sides' }, pb);
  check('side screens: 12 pieces/leg × 4 × 8 ft = 384 ft of 1×1', approx(item(sides.items, 'legDeco').qty, 384));

  const embedded = deriveItems('pergola', { ...p, anchor: 'embedded' }, pb);
  check('embedded: posts 4 × (8+3) = 44 ft + concrete 16 bags',
    approx(item(embedded.items, 'posts').qty, 44) && approx(item(embedded.items, 'concrete').qty, 16));
}

// ── 5. THE core requirement: one material price moves every product ──────────
console.log('\nShared material propagation (4×4×3/16 +$3/ft):');
{
  const bumped = deepMerge(pb, { materials: { tube_4x4_316: { cost: 15 } } });
  for (const [type, st] of [['fence', defaultState('fence')], ['gate', defaultState('gate')], ['pergola', defaultState('pergola')], ['carport', defaultState('carport')]]) {
    const before = deriveItems(type, st, pb).items.reduce((s, i) => s + lineCost(i), 0);
    const after = deriveItems(type, st, bumped).items.reduce((s, i) => s + lineCost(i), 0);
    check(`${type} repriced (+$${(after - before).toFixed(2)})`, after > before);
  }
}

// ── 6. Overrides, custom lines, labor/install ────────────────────────────────
console.log('\nOverrides & custom lines:');
{
  const s = defaultState('fence');
  const ls = buildLineState('fence', s, pb, {
    items: { posts: { qty: 90 }, custom_1: { custom: true, name: 'Core drilling', kind: 'flat', qty: 1, rate: 200 } },
    labor: { hours: 20 },
    install: { hours: 10, rate: 60 },
  });
  check('post qty override wins', approx(item(ls.items, 'posts').qty, 90));
  check('custom line kept', item(ls.items, 'custom_1') && lineCost(item(ls.items, 'custom_1')) === 200);
  check('labor override', ls.labor.hours === 20 && ls.labor.edited);
  check('install override', ls.install.hours === 10 && ls.install.rate === 60);

  const totals = computeTotals(ls, {
    materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 8.25,
    deliveryMiles: 20, deliveryPerMile: 2, discountPct: 10, minJobCharge: 500,
  });
  check('install priced into totals', totals.lines.finishing.total > 0);
  check('discount computed', totals.discountAmt > 0 && totals.discountPct === 10);
  check('total = subtotal − discount + tax', approx(totals.total, totals.subtotal - totals.discountAmt + totals.tax, 0.02));
}

// ── 7. Minimum job charge ─────────────────────────────────────────────────────
console.log('\nMinimum job charge:');
{
  const s = { ...defaultState('railing'), lengthFt: 3 }; // tiny job
  const ls = buildLineState('railing', s, pb, {});
  const totals = computeTotals(ls, { materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 0, minJobCharge: 500 });
  check('small job floored at $500', totals.total === 500 && totals.minAdjustment > 0, `total ${totals.total}`);
}

// ── 8. Materials summary (cut list) ──────────────────────────────────────────
console.log('\nMaterials summary:');
{
  const s = defaultState('fence');
  const ls = buildLineState('fence', s, pb, {});
  const sum = materialTotals(ls.items, pb);
  const tube = sum.find((m) => m.id === 'tube_4x4_316');
  const bags = sum.find((m) => m.id === 'concrete_bag');
  check('aggregates 4×4 tubing ft', tube && tube.qty === 72, JSON.stringify(tube));
  check('aggregates concrete bags', bags && bags.qty === 32);
}

// ── 9. Warnings checklist ─────────────────────────────────────────────────────
console.log('\nDid-you-forget checklist:');
{
  const s = { ...defaultState('gate'), type: 'slide', operator: 'none', bagsPerPost: 0, undergroundFt: 0 };
  const ls = buildLineState('gate', s, pb, {});
  const warns = deriveWarnings('gate', s, ls, { materialMarkupPct: 0, laborMarkupPct: 0, taxPct: 0, deliveryMiles: 0 });
  const msgs = warns.map((w) => w.msg).join(' | ');
  check('flags missing concrete', /concrete/i.test(msgs), msgs);
  check('flags missing underground', /underground/i.test(msgs));
  check('flags slide without operator', /operator/i.test(msgs));
  check('flags zero markup', /markup/i.test(msgs));
}

// ── 10. Old saved-quote payloads (no new fields) still price ─────────────────
console.log('\nBackward compatibility (pre-materials sessions):');
{
  const oldState = { totalLengthFt: 40, type: 'horizontal-slat', height: 6, panelWidth: 6, slatSpacing: 1, style: 'flat', meshRatio: 25, color: '#0A0A0A', topEdge: 'flat' };
  const ls = buildLineState('fence', oldState, pb, {});
  const totals = computeTotals(ls, { materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 8.25 });
  check('old fence state prices (defaults: 3 ft underground, 4 bags)', totals.total > 0 && item(ls.items, 'concrete') && approx(item(ls.items, 'posts').qty, 72));

  const oldPergola = { style: 'rectangular', legs: 'designer', width: 12, depth: 16, height: 8, shade: 'open', color: '#0A0A0A' };
  const lp = buildLineState('pergola', oldPergola, pb, {});
  check('old pergola state prices with 1×1 deco', item(lp.items, 'legDeco') != null);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED ✓' : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
