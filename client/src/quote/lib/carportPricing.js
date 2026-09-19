import { CARPORT_PACKAGE_RATES, CARPORT_COST_FIELDS } from '../data/carportPricing.js';
import { carportSupports } from './carport-supports.js';
import { round2 } from './format.js';

const positive = v => Number.isFinite(Number(v)) ? Math.max(0,Number(v)) : 0;
const chosen = (value,fallback) => value === '' || value == null ? positive(fallback) : positive(value);
export const isCarportPackage = (type,state) => type === 'carport' && state?.pricingMode === 'package';
export function carportPackage(state,book) {
  const s=state||{}, rates={...CARPORT_PACKAGE_RATES,...book?.carport?.package};
  const area=round2(positive(s.width)*positive(s.depth));
  const slope=s.roof==='gable'?Math.sqrt(1+(positive(s.pitch)/12)**2):s.roof==='lean-to'?1/Math.cos(Math.min(80,positive(s.elevation))*Math.PI/180):1;
  const roofArea=round2(area*slope);
  const posts=carportSupports(s).posts.length;
  const baseRate=chosen(s.packageRate,rates[s.roof==='lean-to'?'leanTo':s.roof]);
  const minimum=chosen(s.packageMinimum,rates.minimum);
  const margin=chosen(s.targetMargin,rates.targetMargin);
  const items=[];
  const add=(key,name,kind,qty,rate)=>{if(qty>0)items.push({key,name,kind,qty:round2(qty),rate:round2(rate),unpriced:!(rate>0)});};
  add('carport-package',`Installed carport package — ${s.width} × ${s.depth} ft`, 'area',area,baseRate);
  const extraHeight=Math.max(0,positive(s.height)-positive(rates.standardHeight));
  add('carport-height',`Extra column height above ${rates.standardHeight} ft`, 'length',extraHeight*posts,chosen(s.heightRate,rates.heightPerPostFt));
  const sideArea=positive(s.depth)*(positive(s.height)+(s.roof==='gable'&&s.gableFrame==='rigid'?1.8:0))*(s.sides==='two'?2:s.sides==='one'?1:0);
  add('carport-sides','Enclosed side panels','area',sideArea,chosen(s.sideRate,rates.sidePerSqFt));
  if(s.gutters==='yes')add('carport-gutters','Gutters','length',positive(s.depth)*(s.roof==='gable'?2:1),chosen(s.gutterRate,rates.guttersPerFt));
  if(s.panel==='standing-seam')add('carport-premium-roof','Standing-seam roof upgrade','area',roofArea,chosen(s.premiumRoofRate,rates.standingSeamPerSqFt));
  if(s.includeSlab==='yes')add('carport-slab','Concrete slab — broom finish, 4 in allowance','area',area,chosen(s.slabRate,rates.slabPerSqFt));
  if(s.anchor==='embedded')add('carport-footings','New footings — design and quantity to confirm','unit',chosen(s.footingQty,posts),chosen(s.footingRate,rates.footingEach));
  const special=[];
  if(s.gableFrame==='rigid'&&s.roof==='gable')special.push('rigid frame');
  if(s.frameMaterial==='pipe')special.push('pipe frame');
  if(s.mounting==='attached')special.push('building attachment');
  if(s.panel==='polycarbonate')special.push('polycarbonate');
  if(s.coating&&s.coating!=='standard')special.push('special coating');
  if(special.length||positive(s.customAllowance)>0)add('carport-custom',`Custom upgrade allowance${special.length?' — '+special.join(', '):''}`,'flat',1,positive(s.customAllowance));
  for(const [key,label] of [['demoAllowance','Demolition & disposal'],['accessAllowance','Difficult access / equipment'],['deliveryAllowance','Delivery / travel'],['permitAllowance','Permits'],['engineeringAllowance','Engineering'],['siteAllowance','Site preparation']]){
    if(positive(s[key])>0)add('carport-'+key,label,'flat',1,positive(s[key]));
  }
  return {invalidFootings:s.anchor==='embedded'&&!(chosen(s.footingQty,posts)>0),items,area,roofArea,posts,baseRate,minimum,margin,rates,special,laborHours:0,installHours:0};
}

export function carportCostCheck(state,book,raw,items) {
  const pack=carportPackage(state,book);
  const costs=Object.fromEntries(CARPORT_COST_FIELDS.map(([key])=>[key,chosen(state[key],raw[key]||0)]));
  const estimatedCost=round2(Object.values(costs).reduce((sum,v)=>sum+v,0));
  const costMissing=(state.costMaterials==null||state.costMaterials==='')?raw.missing||[]:[];
  const required=pack.margin<100?Math.ceil(estimatedCost/(1-pack.margin/100)*100)/100:0;
  const reviewKey=JSON.stringify([state.width,state.depth,state.height,state.roof,state.mounting,state.gableFrame,state.frameMaterial,state.panel,state.sides,state.anchor,state.pitch,state.elevation,items.map(i=>[i.key,i.qty,i.rate]),costs,costMissing,pack.minimum,pack.margin]);
  return {...pack,costs,estimatedCost,required,costMissing,reviewKey,reviewed:state.costReviewKey===reviewKey};
}

export function carportPricingIssues(lines) {
  const c=lines?.carportPricing;
  if(!c)return [];
  const issues=[];
  if(c.invalidFootings)issues.push('Enter the number of new footings.');
  if(!(c.area>0)||!(c.baseRate>0))issues.push('Enter the covered area and installed package rate.');
  if(c.margin>=100)issues.push('Target margin must be below 100%.');
  if(lines.items.some(i=>i.unpriced||!(Number(i.rate)>0)))issues.push('Price every selected carport upgrade before sending.');
  if(c.costMissing.length)issues.push('Enter confirmed material costs for the custom frame or unpriced materials.');
  if(!(c.estimatedCost>0)||!c.reviewed)issues.push('Review and confirm all job costs before sending.');
  return issues;
}
