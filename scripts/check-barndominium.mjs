import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fresh,validate,takeoff,normalize,spec} from '../client/src/quote/lib/barndominium/model.js';
import {renderDrawing} from '../client/src/quote/lib/barndominium/drawing.js';
import {parseLead} from '../client/src/quote/lib/designSpec.js';
import {defaultState,specRows} from '../client/src/quote/data/configurators.js';
import {buildLineState} from '../client/src/quote/lib/estimate.js';
import {DEFAULT_PRICE_BOOK} from '../client/src/quote/data/priceBook.js';
import {normalizeRef,refTool} from '../client/src/quote/lib/refs.js';
const s=fresh(),t=takeoff(s);
assert.deepEqual(validate(s),[]);assert.equal(t.floor,2400);assert.equal(t.frames,4);assert.equal(t.columns,8);
assert.equal(t.wallGross,2666.67);assert.equal(t.openingArea,37);assert.equal(t.wallNet,2629.67);assert.equal(t.ridge,18.67);
assert.equal(t.roof,Math.round(42*62*Math.hypot(1,4/12)*100)/100);
const collision=fresh();collision.openings.push({...collision.openings[0],id:'overlap'});assert.ok(validate(collision).some(e=>e.code==='overlap'));
const column=fresh();column.openings=[{id:'garage',kind:'overhead',wall:'right',x:16,width:10,height:10,sill:0}];assert.ok(validate(column).some(e=>e.code==='column'));
column.openings[0].x=5;assert.deepEqual(validate(column),[]);
const outside=fresh();outside.openings[0].height=13;assert.ok(validate(outside).some(e=>e.code==='opening-bounds'));
const porch=fresh();porch.porches=[{id:'porch',wall:'front',x:0,width:16,depth:8,height:11,pitch:2}];assert.deepEqual(validate(porch),[]);assert.ok(takeoff(porch).porchRoof>128);porch.porches[0].height=6;assert.ok(validate(porch).some(e=>e.code==='porch-opening'));
for(const [key,value] of [['width',Infinity],['depth',-2],['pitch',0],['bay',0]]){const bad=fresh();bad[key]=value;assert.ok(validate(bad).length);}
assert.equal(normalize({wallColor:'<script>'}).wallColor,s.wallColor);
for(const view of ['iso','plan','front','back','left','right'])for(const mode of ['shell','frame','insulation']){const svg=renderDrawing(s,{view,mode});assert.ok(!svg.includes('NaN'));assert.ok(!svg.includes('undefined'));}
const state=defaultState('barndominium');state.openings[0].x=9;assert.equal(defaultState('barndominium').openings[0].x,7);
const parsed=parseLead({designState:JSON.stringify({type:'barndominium',state:s})});assert.equal(parsed.type,'barndominium');assert.deepEqual(parsed.state,s);assert.equal(refTool(normalizeRef('CJM-B123ABC')),'barndominium');
assert.ok(specRows('barndominium',s).some(r=>r.value.includes('CEE')));assert.ok(spec(s,'es').some(([k])=>k==='Edificio'));
const ls=buildLineState('barndominium',s,DEFAULT_PRICE_BOOK,{});assert.ok(ls.items.some(i=>i.key==='building-cee'&&i.unpriced));assert.ok(ls.items.some(i=>i.key==='building-zee'));assert.ok(!ls.items.some(i=>i.key==='building-wall-insulation'));
const insulated={...s,wallInsulation:'fiberglass',roofInsulation:'spray-foam'};const edited=buildLineState('barndominium',insulated,DEFAULT_PRICE_BOOK,{items:{'building-cee':{rate:4.5}}});assert.equal(edited.items.find(i=>i.key==='building-cee').rate,4.5);assert.ok(edited.items.some(i=>i.key==='building-wall-insulation'));
// Both deployments own copies, with a release check preventing geometry drift.
const website=new URL('../../CJM/src/lib/barndominium/',import.meta.url);
if(fs.existsSync(website))for(const name of ['model.js','drawing.js','editor.js','editor.css','home3d.js','scenery.js'])assert.equal(fs.readFileSync(new URL(name,website),'utf8'),fs.readFileSync(new URL('../client/src/quote/lib/barndominium/'+name,import.meta.url),'utf8'),name+' must match between apps');
console.log('Barndominium geometry, constraints, takeoff, import, rates and shared-code parity passed.');
