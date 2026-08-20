// =============================================================================
//  Quote engine smoke test — exercises the material-library pricing end to end.
//  Run:  node scripts/quote-engine-smoke.mjs
//  Pure JS, no server needed. Fails loudly (exit 1) if any invariant breaks.
// =============================================================================

import { DEFAULT_PRICE_BOOK } from '../client/src/quote/data/priceBook.js';
import {
  deriveItems, buildLineState, deriveWarnings, materialTotals, materialLibrary, lineCost, matRate,
} from '../client/src/quote/lib/estimate.js';
import { computeTotals } from '../client/src/quote/lib/quote.js';
import { defaultState, summaryLine, specRows } from '../client/src/quote/data/configurators.js';
import { deepMerge, duplicateSession } from '../client/src/quote/lib/store.js';

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

  // auto slats match the SVG preview: floor((72" − 5 + 1) / (3 + 1)) = 17 per
  // section × 7 sections × 6 ft = 714 ft (3" slat face — see slatCountFor)
  const slats = item(items, 'slats');
  check('slats auto = 17/section → 714 ft of 4×1', slats && approx(slats.qty, 714) && slats.materialId === 'tube_4x1', `got ${slats?.qty}`);

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

// ── 11. Hand-added lines (the "+ Add line" form) ──────────────────────────────
console.log('\nCustom lines:');
{
  // An owner-added material line: 3×2 angle iron they added to the library,
  // 14 ft of it, on a table quote. It must price by the foot AND show up in
  // the buy list — not sit there as a flat dollar amount.
  const book = deepMerge(pb, {
    materials: { angle_3x2: { name: '3×2 angle iron', unit: 'ft', cost: 4, wastePct: 10 } },
  });
  const ov = {
    items: {
      custom_1: {
        custom: true, name: '3×2 angle iron — table frame', kind: 'length',
        materialId: 'angle_3x2', unit: 'ft', qty: 14, rate: matRate(book, 'angle_3x2'),
      },
      custom_2: { custom: true, name: 'Core drilling', kind: 'flat', qty: 1, rate: 120 },
    },
  };
  const ls = buildLineState('table', defaultState('table'), book, ov);
  const angle = item(ls.items, 'custom_1');
  check('length line costs qty × rate', angle && approx(lineCost(angle), 14 * 4.4), `got ${angle && lineCost(angle)}`);
  check('flat line still costs the amount', approx(lineCost(item(ls.items, 'custom_2')), 120));
  const sum = materialTotals(ls.items, book);
  const bought = sum.find((m) => m.id === 'angle_3x2');
  check('added material lands in the buy list', bought && approx(bought.qty, 14) && bought.name === '3×2 angle iron', JSON.stringify(bought));
}

// ── 11b. Renaming a derived line ──────────────────────────────────────────────
console.log('\nRenamed lines:');
{
  const s = defaultState('table');
  const ov = { items: { legs: { name: '4x Legs For the Table (3×2 Rectangular Tubing)' } } };
  const ls = buildLineState('table', s, pb, ov);
  const legs = item(ls.items, 'legs');
  const plain = item(buildLineState('table', s, pb, {}).items, 'legs');
  check('the customer sees the new wording', legs.name === ov.items.legs.name, legs && legs.name);
  check('renaming does not move the price', approx(lineCost(legs), lineCost(plain)));
  check('the line is flagged as edited', legs.edited === true);
  // The rename is keyed by role, so changing the design keeps it.
  const resized = buildLineState('table', { ...s, lengthFt: 10 }, pb, ov);
  check('rename survives an option change', item(resized.items, 'legs').name === ov.items.legs.name);
  // Blank falls back to the formula's own name — never an unlabelled row.
  const blank = buildLineState('table', s, pb, { items: { legs: { name: '   ' } } });
  check('blank falls back to the formula name', item(blank.items, 'legs').name === plain.name);
  check('and is not counted as an edit', item(blank.items, 'legs').edited !== true);
  // The buy list stays canonical — it names materials, not line descriptions.
  const bought = materialTotals(ls.items, pb).find((m) => m.id === 'tube_2x3');
  check('buy list keeps the material name', bought && bought.name === pb.materials.tube_2x3.name, JSON.stringify(bought));
}

// ── 12. Deleted materials ─────────────────────────────────────────────────────
console.log('\nDeleted materials:');
{
  // A built-in can't just lose its key — the defaults merge it back — so it's
  // tombstoned: out of the library, priced at $0, and flagged on the quote.
  const book = deepMerge(pb, { removedMaterials: ['concrete_bag'] });
  check('leaves the visible library', !materialLibrary(book).includes('concrete_bag'));
  check('other materials stay', materialLibrary(book).includes('tube_4x4_316'));
  check('prices at $0', matRate(book, 'concrete_bag') === 0);
  const ls = buildLineState('fence', defaultState('fence'), book, {});
  const conc = item(ls.items, 'concrete');
  check('its line is flagged, not silently charged', conc && conc.unpriced === true && lineCost(conc) === 0, JSON.stringify(conc));
  // Putting it back restores the seeded price — nothing was destroyed.
  check('restores when put back', matRate(deepMerge(pb, { removedMaterials: [] }), 'concrete_bag') === 7);
}

// ── 13. Custom build type (grills, doors, repairs — hand-priced) ─────────────
console.log('\nCustom build type:');
{
  const s = { ...defaultState('custom'), title: 'Window grills — 6 openings' };

  // Nothing is derived: the only line a fresh custom quote has is consumables.
  const fresh = deriveItems('custom', s, pb);
  check('derives no build items', fresh.items.filter((i) => i.key !== 'consumables').length === 0);
  check('no auto labor hours', fresh.laborHours === 0 && fresh.installHours === 0);

  // A real grill quote: tubing by the foot + a flat fabrication charge.
  const ov = {
    items: {
      custom_1: {
        custom: true, name: '1×1 tube — grill bars', kind: 'length',
        materialId: 'tube_1x1', unit: 'ft', qty: 200, rate: matRate(pb, 'tube_1x1'),
      },
      custom_2: { custom: true, name: 'Anchors & expansion bolts', kind: 'flat', qty: 1, rate: 90 },
    },
    labor: { hours: 24 },
    install: { hours: 8 },
  };
  const ls = buildLineState('custom', s, pb, ov);
  const bars = item(ls.items, 'custom_1');
  check('hand-added length line prices', bars && approx(lineCost(bars), 200 * matRate(pb, 'tube_1x1')), `got ${bars && lineCost(bars)}`);
  check('bars land in the buy list', materialTotals(ls.items, pb).some((m) => m.id === 'tube_1x1' && approx(m.qty, 200)));

  // Consumables recompute off the hand-added FABRICATED material only — the
  // flat anchors line is excluded, same rule every other build type follows.
  const cons = item(ls.items, 'consumables');
  check('consumables = 5% of the tubing (flat lines excluded)', approx(lineCost(cons), lineCost(bars) * 0.05), `got ${lineCost(cons)}`);

  const totals = computeTotals(ls, {
    materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 8.25, minJobCharge: pb.minJobCharge,
  });
  check('quote totals up', totals.total > 0 && totals.lines.labor.total > 0 && totals.lines.finishing.total > 0);

  // The checklist nags an empty custom quote and shuts up once it has lines.
  const empty = deriveWarnings('custom', s, buildLineState('custom', s, pb, {}), { materialMarkupPct: 35, laborMarkupPct: 35 });
  check('flags an empty custom quote', /\+ Add line/.test(empty.map((w) => w.msg).join(' | ')));
  const built = deriveWarnings('custom', s, ls, { materialMarkupPct: 35, laborMarkupPct: 35 });
  check('stops nagging once lines exist', !/\+ Add line/.test(built.map((w) => w.msg).join(' | ')));
  const untitled = deriveWarnings('custom', { ...s, title: '' }, ls, { materialMarkupPct: 35, laborMarkupPct: 35 });
  check('nudges for a missing description', /description/i.test(untitled.map((w) => w.msg).join(' | ')));

  // What the customer's quote page prints (project.summary + spec rows).
  check('summary says what it is', summaryLine('custom', s) === 'Window grills — 6 openings · Matte Black', summaryLine('custom', s));
  check('spec rows carry build + finish', specRows('custom', s).map((r) => r.label).join(',') === 'Build,Finish');
  check('untitled still renders', summaryLine('custom', { ...s, title: '' }) === 'Custom build · Matte Black');
}

// ── 14. Line order (the ▲▼ arrows) ───────────────────────────────────────────
console.log('\nLine order:');
{
  const s = defaultState('fence');
  const natural = buildLineState('fence', s, pb, {}).items.map((i) => i.key);
  check('starts in formula order', natural[0] === 'posts', natural.join(','));

  // Move the last line to the front — the order the CUSTOMER reads.
  const moved = [natural[natural.length - 1], ...natural.slice(0, -1)];
  const ls = buildLineState('fence', s, pb, { order: moved });
  check('honors the stored order', ls.items.map((i) => i.key).join(',') === moved.join(','), ls.items.map((i) => i.key).join(','));
  check('flags the quote as reordered', ls.reordered === true);
  check('a natural-order quote is not flagged', buildLineState('fence', s, pb, {}).reordered === false);

  // Reordering must not touch the money.
  const money = (x) => computeTotals(x, { materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 8.25 }).total;
  check('reordering does not move the total', approx(money(ls), money(buildLineState('fence', s, pb, {}))));

  // A line added AFTER the reorder isn't in the list — it lands at the end,
  // which is where a newly added line belongs anyway.
  const withNew = buildLineState('fence', s, pb, {
    order: moved,
    items: { custom_9: { custom: true, name: 'Core drilling', kind: 'flat', qty: 1, rate: 200 } },
  });
  check('unlisted keys sort to the end', withNew.items[withNew.items.length - 1].key === 'custom_9', withNew.items.map((i) => i.key).join(','));

  // Stale keys (a line struck off after the reorder) must not strand anything.
  const withRemoved = buildLineState('fence', s, pb, { order: moved, items: { concrete: { removed: true } } });
  check('a removed line just drops out of the order', !withRemoved.items.some((i) => i.key === 'concrete')
    && withRemoved.items.length === moved.length - 1);

  // Order survives an option change, exactly like a rename does.
  const resized = buildLineState('fence', { ...s, totalLengthFt: 80 }, pb, { order: moved });
  check('order survives an option change', resized.items[0].key === moved[0]);
}

// ── 15. Duplicating a saved quote ─────────────────────────────────────────────
console.log('\nDuplicate a saved quote:');
{
  const saved = {
    sid: 'old-sid', type: 'custom', state: { title: 'Window grills — 6 openings', color: '#0A0A0A' },
    overrides: { items: { custom_1: { custom: true, name: 'Bars', kind: 'length', qty: 200, rate: 2.75 } }, order: ['custom_1'], labor: { hours: 24 } },
    materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 8.25, discountPct: 5,
    customer: { name: 'Ana Ruiz', company: '', phone: '555-0101', email: 'ana@example.com', location: 'Arlington' },
    notes: 'Ships in 3 weeks', features: 'Anchored into brick', attachments: [{ url: '/uploads/a.png', caption: 'Shop drawing' }],
    designRef: 'CJM-F7K2', depositPct: 50,
    priceBookSnapshot: { laborRatePerHour: 40 }, priceBookSnapshotAt: '2026-01-01T00:00:00.000Z',
    number: 'Q-2026-0631', quoteId: 42, createdAt: '2026-01-01T00:00:00.000Z',
  };
  const copy = duplicateSession(saved, 'new-sid');

  // The whole point: it cannot write back over the quote it came from.
  check('drops the quote id', copy.quoteId === null);
  check('drops the quote number', copy.number === null);
  check('gets its own session id', copy.sid === 'new-sid');

  // Nothing that identifies the original customer travels.
  check('customer card is blank', Object.values(copy.customer).every((v) => v === ''));
  check('website design code is dropped', copy.designRef === undefined);

  // Everything you priced does travel.
  check('lines come along', copy.overrides.items.custom_1.qty === 200);
  check('line order comes along', copy.overrides.order.join(',') === 'custom_1');
  check('labor override comes along', copy.overrides.labor.hours === 24);
  check('markups / tax / discount come along', copy.materialMarkupPct === 35 && copy.taxPct === 8.25 && copy.discountPct === 5);
  check('notes, features and drawings come along', copy.notes === saved.notes && copy.features === saved.features && copy.attachments.length === 1);
  check('deposit comes along', copy.depositPct === 50);

  // A new quote prices off today's book, not the original's frozen one.
  check('price lock is released', copy.priceBookSnapshot === null && copy.priceBookSnapshotAt === null);
  check('stamped as created now', copy.createdAt !== saved.createdAt);

  // And the original object is untouched (it is still on screen behind the copy).
  check('the original is not mutated', saved.quoteId === 42 && saved.designRef === 'CJM-F7K2' && saved.customer.name === 'Ana Ruiz');

  // The copy still prices — same total as the original priced at today's rates.
  const lsCopy = buildLineState(copy.type, copy.state, pb, copy.overrides);
  check('the copy prices', lineCost(item(lsCopy.items, 'custom_1')) === 550);
}

console.log(failures === 0 ? '\nALL CHECKS PASSED ✓' : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
