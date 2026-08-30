// =============================================================================
//  Trade types check — concrete + insulation build types, sister-site refs and
//  designState envelopes, end to end against the sister sites' published math.
//  Run:  node scripts/check-quote-trades.mjs
//  Pure JS, no server needed. Fails loudly (exit 1) if any invariant breaks.
// =============================================================================

import { DEFAULT_PRICE_BOOK } from '../client/src/quote/data/priceBook.js';
import { deriveItems, buildLineState, deriveWarnings, lineCost } from '../client/src/quote/lib/estimate.js';
import { defaultState, summaryLine, specRows } from '../client/src/quote/data/configurators.js';
import { normalizeRef, refTool } from '../client/src/quote/lib/refs.js';
import { parseLead } from '../client/src/quote/lib/designSpec.js';
import { renderConcrete } from '../client/src/quote/lib/preview/concrete.js';
import { renderInsulation } from '../client/src/quote/lib/preview/insulation.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures++;
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
}
const pb = DEFAULT_PRICE_BOOK;
const item = (items, key) => items.find((i) => i.key === key);
const total = (items) => items.reduce((s, i) => s + lineCost(i), 0);
const noNaN = (items) => items.every((i) => Number.isFinite(lineCost(i)));

// ── (a) Concrete — 30×20 ft, 4", broom driveway vs the site's $8–14/sq ft ────
console.log('\nConcrete (30 × 20 ft driveway, 4" broom):');
{
  const s = defaultState('concrete'); // driveway, 30×20, 4", broom
  const { items, laborHours, installHours } = deriveItems('concrete', s, pb);
  const sum = total(items);
  // The site's FINISH_RATES band for 4" broom: $8–14/sq ft installed × 600.
  check('no NaN lines', noNaN(items), JSON.stringify(items));
  check('lines total inside the site band ($4,800–8,400)', sum >= 4800 && sum <= 8400, `got $${sum.toFixed(2)}`);
  check('ready-mix = 8.15 cu yd incl. 10% waste', Math.abs(item(items, 'readymix').qty - 8.15) < 0.01, `got ${item(items, 'readymix')?.qty}`);
  check('crew labor rides in the rates (no hour split)', laborHours === 0 && installHours === 0);

  // Rebar grid rule: 18" at 4", 12" once the slab is 5"+.
  const at4 = deriveItems('concrete', { ...s, rebar: 'yes' }, pb);
  const at5 = deriveItems('concrete', { ...s, rebar: 'yes', thickness: 5 }, pb);
  check('rebar names the 18" grid at 4"', /18" grid/.test(item(at4.items, 'rebar').name), item(at4.items, 'rebar')?.name);
  check('rebar names the 12" grid at 5"', /12" grid/.test(item(at5.items, 'rebar').name), item(at5.items, 'rebar')?.name);
  // rebarFeet(30, 20, 18): 14 bars × 30 ft + 21 bars × 20 ft = 840 ft.
  check('~840 ft of bar on the 4" slab', /~840 ft/.test(item(at4.items, 'rebar').name), item(at4.items, 'rebar')?.name);

  // Demo adds tear-out + the dump fee, like the metals types.
  const demo = deriveItems('concrete', { ...s, demo: 'yes' }, pb);
  check('tear-out + dump fee on demo', item(demo.items, 'demo')?.qty === 600 && lineCost(item(demo.items, 'dump')) === pb.dumpFeeFlat);

  // No welding-consumables line on a field trade — those live in the rates.
  check('no consumables line on concrete', !item(items, 'consumables'));

  // The site's $1,800 mobilization floor on a small pad (8 × 5 ft).
  const pad = deriveItems('concrete', { ...s, lengthFt: 8, widthFt: 5 }, pb);
  const floor = item(pad.items, 'minimum');
  check('small pad floored at the $1,800 job minimum', floor && Math.abs(total(pad.items) - 1800) < 0.05, `got $${total(pad.items).toFixed(2)}`);
  const big = item(deriveItems('concrete', s, pb).items, 'minimum');
  check('no floor line on a full-size job', !big);

  // The floor reconciles against POST-override lines, both directions.
  const padState = { ...s, lengthFt: 8, widthFt: 5 };
  const lifted = buildLineState('concrete', padState, pb, { items: { finish: { rate: 40 } } });
  check('a rate edit past the minimum drops the floor', !item(lifted.items, 'minimum'),
    JSON.stringify(item(lifted.items, 'minimum')));
  const sunk = buildLineState('concrete', { ...s, lengthFt: 14, widthFt: 10 }, pb, { items: { finish: { removed: true } } });
  check('a struck line below the minimum restores the floor', Math.abs(total(sunk.items) - 1800) < 0.05,
    `got $${total(sunk.items).toFixed(2)}`);

  // The customer document path renders.
  check('summary reads', summaryLine('concrete', s) === `Driveway · 30' × 20' · 4" slab · Broom finish`, summaryLine('concrete', s));
  const rows = specRows('concrete', s);
  check('spec rows carry size + yards + joints', /600 sq ft/.test(rows[1].value) && /8.1 cu yd/.test(rows[4].value) && rows.some((r) => r.label === 'Control joints'));
}

// ── (b) Insulation — 200 ft of 4" pipe @ 350°F, mineral wool ─────────────────
console.log('\nInsulation (200 ft of 4" pipe @ 350°F, 2" mineral wool):');
{
  const s = defaultState('insulation'); // pipe, 4", 200 ft, 350°F, 2" mineralwool
  const { items, laborHours, installHours } = deriveItems('insulation', s, pb);
  const sum = total(items);
  check('no NaN lines', noNaN(items), JSON.stringify(items));
  // The site's headline band for this exact job is $7,850–13,700 — order of
  // magnitude is the point, so anywhere within 2× of the band passes.
  check('lines total near the site band ($7,850–13,700, ±2×)', sum >= 7850 / 2 && sum <= 13700 * 2, `got $${sum.toFixed(2)}`);
  check('…and actually inside it with the seeded rates', sum >= 7850 && sum <= 13700, `got $${sum.toFixed(2)}`);
  // areas(): π × (4.5 + 2×2) / 12 × 200 = 445.06 sq ft of jacket.
  check('finished jacket surface = 445.06 sq ft', Math.abs(item(items, 'material').qty - 445.06) < 0.01, `got ${item(items, 'material')?.qty}`);
  check('crew labor rides in the rates (no hour split)', laborHours === 0 && installHours === 0);
  check('no consumables line on insulation', !item(items, 'consumables'));

  // Stainless jacket upcharges per finished sq ft; aluminum doesn't.
  const ss = deriveItems('insulation', { ...s, jacket: 'stainless' }, pb);
  check('stainless jacket upcharge line', item(ss.items, 'jacket')?.qty === item(ss.items, 'material').qty);
  check('aluminum jacket adds no line', !item(items, 'jacket'));

  // Blanket covers price per sewn cover by line size.
  const bl = deriveItems('insulation', { ...s, system: 'blanket', nps: '6', count: 10 }, pb);
  check('10 × 6" covers at the seeded $520', Math.abs(lineCost(item(bl.items, 'covers')) - 5200) < 0.01, `got ${lineCost(item(bl.items, 'covers'))}`);

  // Tank geometry: shell π·d·h + one head, ×1.05 jacket allowance.
  const tank = deriveItems('insulation', { ...s, system: 'tank', diaFt: 8, heightFt: 12 }, pb);
  const tankSqft = (Math.PI * 8 * 12 + (Math.PI / 4) * 64) * 1.05;
  check('tank jacket sq ft matches areas()', Math.abs(item(tank.items, 'material').qty - tankSqft) < 0.05, `got ${item(tank.items, 'material')?.qty} vs ${tankSqft.toFixed(2)}`);

  check('summary reads', summaryLine('insulation', s) === `Pipe · 4" × 200' @ 350°F · 2" Mineral Wool`, summaryLine('insulation', s));
  check('spec rows carry the finished surface', specRows('insulation', s).some((r) => /445 sq ft/.test(r.value)));
}

// ── Warnings — the trade-specific nudges ─────────────────────────────────────
console.log('\nDid-you-forget checklist:');
{
  const cs = defaultState('concrete');
  const cls = buildLineState('concrete', cs, pb, {});
  const cw = deriveWarnings('concrete', cs, cls, { materialMarkupPct: 35, laborMarkupPct: 35, taxPct: 8.25 }).map((w) => w.msg).join(' | ');
  check('no shop-labor nag on a field trade', !/fabrication labor|installation labor/i.test(cw), cw);
  check('nudges a driveway without rebar', /rebar/i.test(cw), cw);
  const thick = deriveWarnings('concrete', { ...cs, project: 'patio', thickness: 6 }, cls, {}).map((w) => w.msg).join(' | ');
  check('flags a 6" patio as thicker than needed', /thicker/i.test(thick), thick);

  const is = { ...defaultState('insulation'), material: 'fiberglass', tempF: 900 };
  const iw = deriveWarnings('insulation', is, buildLineState('insulation', is, pb, {}), {}).map((w) => w.msg).join(' | ');
  check('fiberglass above 850°F → mineral wool warning', /850°F/.test(iw) && /mineral wool/i.test(iw), iw);
  const thin = { ...defaultState('insulation'), tempF: 600, thickness: 1 };
  const tw = deriveWarnings('insulation', thin, buildLineState('insulation', thin, pb, {}), {}).map((w) => w.msg).join(' | ');
  check('under-recommended thickness noted', /minimum/i.test(tw), tw);
}

// ── (c) Refs — all four family prefixes ──────────────────────────────────────
console.log('\nDesign codes:');
{
  check("normalizeRef('cjc-d7k2q') === 'CJC-D7K2Q'", normalizeRef('cjc-d7k2q') === 'CJC-D7K2Q', normalizeRef('cjc-d7k2q'));
  check('sister code with spaces', normalizeRef('CJI P7K2Q') === 'CJI-P7K2Q', normalizeRef('CJI P7K2Q'));
  check('sister code in an email subject', normalizeRef('[DESIGN CJC-D7K2Q] New quote request') === 'CJC-D7K2Q', normalizeRef('[DESIGN CJC-D7K2Q] New quote request'));
  // The sister brand names contain "CJM" — the strict sister match must win
  // over the loose CJM token when both appear in a paste.
  check('sister ref wins over domain noise', normalizeRef('New quote request from cjm-concrete.com Design: CJC-D7K2Q') === 'CJC-D7K2Q',
    normalizeRef('New quote request from cjm-concrete.com Design: CJC-D7K2Q'));
  // Metals behavior preserved: subject extraction + the CJM-CJMxx ambiguity.
  check('metals subject still extracts', normalizeRef('[DESIGN CJM-F7K2] New quote request') === 'CJM-F7K2');
  check('bare body still gets the CJM prefix', normalizeRef('f7k2') === 'CJM-F7K2');
  check("carport 'cjm2k' ambiguity intact", normalizeRef('cjm2k') === 'CJM-CJM2K', normalizeRef('cjm2k'));
  check("a metals 'cjc2k' body is NOT read as a sister ref", normalizeRef('cjc2k') === 'CJM-CJC2K', normalizeRef('cjc2k'));

  check('refTool CJM-F… → fence', refTool('CJM-F7K2') === 'fence');
  check('refTool CJC-… → concrete', refTool('CJC-D7K2Q') === 'concrete');
  check('refTool CJI-… → insulation', refTool('cji-p7k2q') === 'insulation');
  check('refTool CJT-… → null (multi-trade)', refTool('CJT-A1B2C') === null);
}

// ── (d) designState envelopes round-trip ─────────────────────────────────────
console.log('\nWebsite designState envelopes:');
{
  // The concrete site's estimateState, verbatim shape (Calculator.astro).
  const concrete = parseLead({
    ref: 'CJC-D7K2Q',
    service: 'Driveway',
    designState: JSON.stringify({
      type: 'concrete-calculator', ref: 'CJC-D7K2Q',
      state: { project: 'driveway', lengthFt: 40, widthFt: 18, thickness: 5, finish: 'stamped', demo: true, rebar: true },
      result: { area: 720, cubicYards: 12.2, price: { lo: 11500, hi: 19350 } },
    }),
  });
  check('maps to the concrete type', concrete?.type === 'concrete');
  check('lengths ride through', concrete?.state.lengthFt === 40 && concrete?.state.widthFt === 18, JSON.stringify(concrete?.state));
  check('thickness / finish ride through', concrete?.state.thickness === 5 && concrete?.state.finish === 'stamped');
  check('booleans land as segment values', concrete?.state.demo === 'yes' && concrete?.state.rebar === 'yes');

  // Junk values clamp to the defaults instead of poisoning the estimate.
  const junk = parseLead({
    designState: JSON.stringify({
      type: 'concrete-calculator',
      state: { project: 'constructor', lengthFt: 'NaN', widthFt: -4, thickness: 7, finish: 'gold-leaf' },
    }),
  });
  check('junk clamps to defaults', junk?.state.project === 'driveway' && junk?.state.lengthFt === 30
    && junk?.state.widthFt === 20 && junk?.state.thickness === 4 && junk?.state.finish === 'broom', JSON.stringify(junk?.state));

  // The insulation site's estimateState — its client state says shellFt.
  const tank = parseLead({
    ref: 'CJI-T9X2A',
    designState: JSON.stringify({
      type: 'insulation-calculator', ref: 'CJI-T9X2A',
      state: { system: 'tank', tempF: 180, nps: '4', lengthFt: 200, diaFt: 8, shellFt: 14, count: 12, thickness: 2, material: 'fiberglass', jacket: 'stainless', hours: 'continuous' },
      result: { areaSqft: 460 },
    }),
  });
  check('maps to the insulation type', tank?.type === 'insulation');
  check("the site's shellFt lands as heightFt", tank?.state.heightFt === 14, JSON.stringify(tank?.state));
  check('system / material / jacket ride through', tank?.state.system === 'tank' && tank?.state.material === 'fiberglass' && tank?.state.jacket === 'stainless');

  // The trades planner's planState → an honest hand-priced Custom quote.
  const plan = parseLead({
    ref: 'CJT-A1B2C',
    designSpec: 'CJT-A1B2C\nMetals: driveway gate\nConcrete: 600 sq ft driveway\nTimeline: 6 weeks',
    designState: JSON.stringify({ type: 'trades-planner', ref: 'CJT-A1B2C', ids: ['gate', 'driveway'], shops: ['metals', 'concrete'], weeks: 6 }),
  });
  check('trades plan lands as custom', plan?.type === 'custom');
  check('the plan ref titles the build', /CJT-A1B2C/.test(plan?.state.title || ''), plan?.state.title);
  check('the prose scope rides into the notes', /600 sq ft driveway/.test(plan?.notes || ''), plan?.notes);

  // A CJC lead with no designState still opens the right configurator.
  const bare = parseLead({ ref: 'CJC-D7K2Q', service: 'Patio', designSpec: 'CJC-D7K2Q\nPatio — 20 × 15 ft' });
  check('bare sister lead opens concrete at defaults', bare?.type === 'concrete' && bare?.state.project === 'driveway' && bare?.hasSpec === false);
}

// ── Previews stay renderable strings ─────────────────────────────────────────
console.log('\nPreviews:');
{
  const slab = renderConcrete(defaultState('concrete'));
  check('concrete plan renders joints + dims', slab.includes('stroke-dasharray') && slab.includes("30'"), slab.slice(0, 80));
  const pipe = renderInsulation(defaultState('insulation'));
  check('pipe section renders the cutaway', pipe.includes('<circle') && pipe.includes('350°F'));
  const clave = renderInsulation({ ...defaultState('insulation'), system: 'autoclave' });
  check('autoclave section renders', clave.includes('<path') && clave.includes('⌀'));
}

console.log(failures === 0 ? '\nALL CHECKS PASSED ✓' : `\n${failures} CHECK(S) FAILED ✗`);
process.exit(failures === 0 ? 0 : 1);
