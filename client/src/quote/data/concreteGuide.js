// Owner-supplied CJM pricing guides, September 2026. Ranges are allowances,
// not engineering specifications. Keep legacy estimates on their original engine.
export const concreteServices = {
  driveway: ['Driveway', 8, 9.5], patio: ['Patio', 9, 12],
  slab: ['Shop / garage / RV slab', 8.5, 11.5], walkway: ['Walkway', 9, 12],
  retaining: ['Retaining wall', 35, 65], repair: ['Concrete repair', 3, 8],
};
export const brickRepairs = {
  hairline: ['Hairline cracks', 15, 25, 'linear ft'],
  mortar: ['Mortar repointing', 15, 30, 'sq ft'],
  vertical: ['Vertical cracks', 30, 60, 'linear ft'],
  horizontal: ['Horizontal cracks', 30, 60, 'linear ft'],
  separation: ['Separation at bottom', 40, 100, 'linear ft'],
  leaning: ['Leaning / bowing wall', 100, 300, 'linear ft'],
  cap: ['Damaged cap', 25, 75, 'linear ft'],
  bricks: ['Broken / spalling bricks', 35, 75, 'brick'],
  column: ['Column rebuild', 500, 2000, 'column'],
  panel: ['Full panel replacement', 25, 50, 'sq ft'],
  footing: ['Foundation / footing repair', 50, 150, 'linear ft'],
  drainage: ['Drainage repair', 500, 2000, 'job'],
  roots: ['Tree root damage', 500, 3000, 'job'],
  paint: ['Paint / finish repair', 2, 5, 'sq ft'],
  wall: ['Complete wall replacement', 40, 80, 'sq ft'],
};
export const finishAddons = { broom: [0, 0], smooth: [.5, 1.5], aggregate: [2, 4], stamped: [3, 6], stained: [3, 6], salt: [2, 4] };
export const isFlatwork = s => !['retaining', 'repair', 'brick'].includes(s.project);
const n = v => Math.max(0, Number(v) || 0);
export function concreteGuide(s) {
  const area = n(s.lengthFt) * n(s.widthFt);
  const brick = s.project === 'brick';
  let entry = brick ? brickRepairs[s.repairType] || brickRepairs.hairline : concreteServices[s.project] || concreteServices.driveway;
  if (!brick && isFlatwork(s) && s.pricingBasis === 'size') {
    entry = area < 250 ? ['Small job', 10, 20] : area < 750 ? ['Medium job', 9, 12] : area < 2000 ? ['Large job', 8, 9.5] : ['Extra large job', 7.5, 8.5];
  }
  const unit = brick ? entry[3] : 'sq ft';
  const qty = brick ? n(s.repairQty) : area;
  const pick = (lo, hi) => s.priceLevel === 'low' ? lo : s.priceLevel === 'high' ? hi : (lo + hi) / 2;
  const rate = n(s.baseRate) || pick(entry[1], entry[2]);
  const minimum = isFlatwork(s) && qty > 0 ? n(s.minimumCharge ?? 2000) : 0;
  return { label: entry[0], low: entry[1], high: entry[2], unit, qty, rate, minimum, pick };
}
export function concreteGuideItems(s) {
  const g = concreteGuide(s);
  const kind = g.unit === 'sq ft' ? 'area' : g.unit === 'linear ft' ? 'length' : 'unit';
  const items = [{ key: 'guide-base', name: g.label + (isFlatwork(s) ? ' — installed, mesh, forms, normal prep, broom finish, joints & cleanup' : ''), kind, unit: g.unit, qty: g.qty, rate: g.rate }];
  const add = (key, name, rate) => { if (rate > 0 && g.qty > 0) items.push({ key, name, kind: 'area', qty: g.qty, rate }); };
  if (isFlatwork(s)) {
    const finish = finishAddons[s.finish] || finishAddons.broom;
    add('guide-finish', `${s.finish} finish upgrade`, g.pick(...finish));
    if (s.rebar === 'yes' || s.rebar === true) add('guide-rebar', 'Rebar grid upgrade instead of mesh', g.pick(.75, 1.5));
    if (s.demo === 'yes' || s.demo === true) add('guide-demo', 'Existing concrete demolition & haul-off', g.pick(3, 6));
    if (Number(s.thickness) > 4) add('guide-thickness', `${s.thickness}" thickness allowance`, n(s.thicknessAddon));
  }
  if (n(s.siteAllowance)) items.push({ key: 'guide-site', name: 'Additional site work allowance', kind: 'flat', qty: 1, rate: n(s.siteAllowance) });
  const subtotal = items.reduce((sum, i) => sum + i.qty * i.rate, 0);
  if (subtotal > 0 && subtotal < g.minimum) items.push({ key: 'minimum', name: 'Small-job minimum', kind: 'flat', qty: 1, rate: g.minimum - subtotal });
  return { items, laborHours: 0, installHours: 0 };
}
