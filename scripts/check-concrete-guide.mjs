import assert from 'node:assert/strict';
import { concreteGuide, brickRepairs } from '../client/src/quote/data/concreteGuide.js';
import { defaultState, specRows } from '../client/src/quote/data/configurators.js';
import { buildLineState, lineCost } from '../client/src/quote/lib/estimate.js';
import { DEFAULT_PRICE_BOOK as pb } from '../client/src/quote/data/priceBook.js';
const s = defaultState('concrete');
const lines = (state, overrides={}) => buildLineState('concrete', state, pb, overrides).items;
const total = items => items.reduce((n,i)=>n+lineCost(i),0);
assert.equal(total(lines(s)),5250);
assert.equal(total(lines({...s,finish:'stamped',rebar:'yes',demo:'yes'})),11325);
assert.equal(total(lines({...s,lengthFt:10,widthFt:10})),2000);
assert.equal(total(lines({...s,lengthFt:10,widthFt:10},{items:{'guide-base':{rate:25}}})),2500);
for (const [area, low] of [[249,10],[250,9],[749,9],[750,8],[1999,8],[2000,7.5]]) {
  assert.equal(concreteGuide({...s,pricingBasis:'size',lengthFt:area,widthFt:1}).low,low);
}
for (const [repairType,entry] of Object.entries(brickRepairs)) {
  const state={...s,project:'brick',repairType,repairQty:2,finish:'stamped',demo:'yes',rebar:'yes'};
  assert.equal(total(lines(state)),entry[1]+entry[2]);
  assert.equal(concreteGuide(state).unit,entry[3]);
  assert.equal(specRows('concrete',state)[1].value,`2 ${entry[3]}`);
}
assert.equal(total(lines({...s,project:'retaining',lengthFt:20,widthFt:4})),4000);
assert.equal(total(lines({...s,project:'repair',lengthFt:10,widthFt:10})),550);
assert.equal(total(lines({...s,lengthFt:0})),0);
assert.equal(total(lines({...s,thickness:6,thicknessAddon:2})),6450);
assert.ok(lines({...s,pricingMode:undefined}).some(i=>i.key==='readymix'));
console.log('Concrete guide: rates, tier boundaries, minimums, overrides, add-ons, repair units and legacy pricing passed.');
