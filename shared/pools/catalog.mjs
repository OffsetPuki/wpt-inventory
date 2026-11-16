// All customer prices, labels, quantities and configuration rules live here.
// Preliminary USD planning allowances; not supplier quotes or engineering approval.
import {courtSegments,courtOutline,planArea} from './court-plan.mjs';
export const BRAND = { name: 'ORILLA', endorsement: 'By CJM Metals', email: 'support@cjmmetals.com', phone: '+12146039142' };
export const VERSION = '2026-11-15.site-included';
export const CURRENCY = 'USD';
export const WATER_DEPTHS = [4.5,5,6];
export const STANDARD_DEPTH = 4.5;
export const INSTALLATIONS = {
  above:{label:['Above ground','Sobre el terreno']},
  partial:{label:['Partly in ground','Semienterrada']},
  inground:{label:['Fully in ground','A nivel del terreno']}
};
// The finished coping top sits 0.65 ft above the configured usable water depth.
export const burialAmount = c => c.installation==='inground'?c.depth+.65:c.installation==='partial'?Math.min(c.depth,Math.max(.5,Number(c.burial)||.5)):0;
export const installationLabel = (c,lang='en') => localLabel(INSTALLATIONS[c.installation]||INSTALLATIONS.above,lang)+(c.installation==='partial'?' · '+depthLabel(burialAmount(c),lang)+(lang==='es'?' bajo terreno':' below ground'):'');
export const MODELS = {
  patio: { name: 'Patio 12', length: 12, width: 8, base: 30100, depths: WATER_DEPTHS, maxWindows: 1, lounge: 1050, tagline: ['A quiet corner, transformed.', 'Un rincón para desconectar.'] },
  terrace: { name: 'Terrace 20', length: 20, width: 8, base: 38100, depths: WATER_DEPTHS, maxWindows: 2, lounge: 1450, tagline: ['Everyday, a little more open.', 'Más espacio para disfrutar.'] },
  estate: { name: 'Estate 24', length: 24, width: 10, base: 48100, depths: WATER_DEPTHS, maxWindows: 2, lounge: 1800, tagline: ['Make room for everyone.', 'Espacio para compartir.'] },
  court: { name: 'Court', shape: 'court', length: 24, width: 16, base: 63000, customDesign: true, depths: WATER_DEPTHS, maxWindows: 2, lounge: 2400, tagline: ['A courtyard shaped around you.', 'Un patio diseñado a tu medida.'] }
};
export const DEPTH_PRICES = {"patio":{"5":1600,"6":4750,"4.5":0},"terrace":{"5":2150,"6":6400,"4.5":0},"estate":{"5":2650,"6":7950,"4.5":0},"court":{"5":3450,"6":10350,"4.5":0}};
export const HEAT_PUMP_PRICES = {"patio":4600,"terrace":4950,"estate":5950,"court":6150};
// Standard site work is included in MODELS.base. Freight remains separate.
export const SITE_RATES = {
  patio:{freight:3500},
  terrace:{freight:4500},
  estate:{freight:6000},
  court:{freight:8000}
};
export const FINISHES = {
  metal: { label: ['Painted metal', 'Metal pintado'], rate: 0, color: '#333c3a' },
  wpc: { label: ['Wood-look WPC', 'WPC efecto madera'], rate: 41.94, color: '#a47c55' },
  stone: { label: ['Stone-look panels', 'Paneles efecto piedra'], rate: 51.62, color: '#c9c1ad' },
};
export const COLORS = {
  charcoal: { label: ['Charcoal', 'Carbón'], hex: '#303b38' },
  sand: { label: ['Warm sand', 'Arena'], hex: '#b9ae97' },
  bronze: { label: ['Soft bronze', 'Bronce'], hex: '#786653' }
};
export const INTERIORS = {
  pearl: { label: ['Pearl', 'Perla'], hex: '#61b8bf', liner: '#cddbd3' },
  lagoon: { label: ['Lagoon', 'Laguna'], hex: '#278c99', liner: '#65a6ad' },
  slate: { label: ['Deep slate', 'Pizarra'], hex: '#195764', liner: '#527b7f' }
};
export const WINDOW_SIZES = {
  compact: { label: ['3 × 2 ft', '0.91 × 0.61 m'], width: 3, height: 2, price: 4850 },
  classic: { label: ['4 × 2 ft', '1.22 × 0.61 m'], width: 4, height: 2, price: 6300 },
  panorama: { label: ['6 × 2 ft', '1.83 × 0.61 m'], width: 6, height: 2, price: 9200 }
};
export const POSITIONS = {
  front: { label: ['Long side A · center', 'Lado largo A · centro'], extra: 0 },
  back: { label: ['Long side B · center', 'Lado largo B · centro'], extra: 0 },
  end: { label: ['Far end · center', 'Extremo opuesto · centro'], extra: 500 }
};
export const PACKAGES = {
  filtration: {
    standard: { label: ['Matched pump + cartridge filter', 'Bomba + filtro de cartucho dimensionados'], price: 0 },
    extended: { label: ['Larger-capacity cartridge filter', 'Filtro de cartucho de mayor capacidad'], price: 1000 }
  },
  lighting: {
    white: { label: ['White rim strip + one light', 'Tira blanca perimetral + una luz'], price: 0 },
    rgb2: { label: ['Color rim strip + two lights', 'Tira de color perimetral + dos luces'], rate: 6.46, fixed: 1290.33 },
    rgb4: { label: ['Color rim strip + four lights', 'Tira de color perimetral + cuatro luces'], rate: 6.46, fixed: 3064.52 }
  },
  heating: {
    none: { label: ['No heater', 'Sin calentador'], price: 0 },
    heatpump: { label: ['Electric heat pump', 'Bomba de calor eléctrica'], byModel: HEAT_PUMP_PRICES },
    gas: { label: ['Gas heater', 'Calentador de gas'], price: 5900 }
  },
  treatment: {
    standard: { label: ['Standard chlorine care', 'Cloración convencional'], price: 0 },
    salt: { label: ['Salt chlorination', 'Cloración salina'], byModel: {"patio":1950,"terrace":2150,"estate":2400,"court":2400} },
    uv: { label: ['UV + standard chlorine', 'UV + cloración convencional'], price: 2200 },
    saltuv: { label: ['Salt + UV', 'Sal + UV'], byModel: {"patio":3850,"terrace":4000,"estate":4250,"court":4250} }
  },
  cover: {
    none: { label: ['No cover', 'Sin cubierta'], price: 0 },
    thermal: { label: ['Thermal blanket + reel', 'Manta térmica + enrollador'], rate: 2.42, fixed: 1129.04 },
    fitted: { label: ['Fitted manual cover', 'Cubierta manual a medida'], rate: 8.88, fixed: 1451.62 }
  },
  seating: {
    standard: { label: ['On · standard relaxation ledge', 'Con zona de descanso estándar'], price: 0 },
    none: { label: ['Off · entry steps only', 'Sin zona de descanso · solo escalones'], price: 0 },
    lounge: { label: ['On · ledge + extended bench', 'Zona de descanso + banca extendida'], modelPrice: 'lounge' }
  },
  decking: {
    none: { label: ['No attached deck', 'Sin terraza adosada'], price: 0 },
    side: { label: ['3 ft deck · side B', 'Terraza de 0.91 m · lado B'], byModel: {"patio":3700,"terrace":5250,"estate":6050,"court":6050}, depth: 3 }
  },
  stairs: {
    none: { label: ['Standard exterior access · included', 'Acceso exterior estándar · incluido'], price: 0 },
    access: { label: ['Linear · wood-look treads', 'Linear · peldaños efecto madera'], detail:['Straight steel frame · 6 horizontal slats','Estructura recta de acero · 6 lamas horizontales'], fixed:1774.2, perRiser:282.26 },
    fold: { label: ['Fold · folded steel', 'Fold · acero plegado'], detail:['Closed metal treads and risers','Peldaños y contrahuellas de metal'], fixed:2177.42, perRiser:362.91 },
    turn: { label: ['Turn · L-shaped stair', 'Turn · escalera en L'], detail:['Corner landing · wood-look treads','Descanso en esquina · efecto madera'], fixed:2822.59, perRiser:322.59 },
  },
  landscape: {
    none: {label:['No new patio or planting','Sin patio ni plantas nuevos'],price:0},
    garden: {label:['Patio + planting allowance','Provisión para patio y plantas'],rate:32.26,fixed:1935.49}
  }
};
export const DEFAULT = { model: 'terrace', depth: STANDARD_DEPTH, installation:'above', burial:2, finish: 'metal', color: 'charcoal', interior: 'pearl', windows: [], seating: 'standard', lighting: 'white', heating: 'none', filtration: 'standard', treatment: 'standard', cover: 'none', decking: 'none', stairs: 'none', landscape:'none' };
export const copyDefault = () => structuredClone(DEFAULT);
export const round50 = n => Math.round(n / 50) * 50;
export const roundUp50 = n => n<=0?0:Math.ceil((n-1e-8) / 50) * 50;
export const localLabel = (item, lang='en') => item.label[lang === 'es' ? 1 : 0];
export const money = (n, lang='en') => new Intl.NumberFormat(lang === 'es' ? 'es-MX' : 'en-US', {style:'currency',currency:CURRENCY,currencyDisplay:'narrowSymbol',maximumFractionDigits:0}).format(n) + ' USD';
export const depthLabel = (depth,lang='en') => lang==='es'?(depth*.3048).toFixed(2)+' m':depth+' ft';
export function windowPositions(config) {
  // Windows begin 1.27 ft above the shell base. Keep their full height above grade.
  if(burialAmount(config)>1.15)return [];
  return Object.keys(POSITIONS).filter(p => !(config.model === 'patio' && p !== 'front') && !(p === 'back' && config.decking === 'side') && !(p === 'back' && config.seating === 'lounge'));
}
export function windowSizes(config, position) {
  return Object.keys(WINDOW_SIZES).filter(s => s !== 'panorama' || (config.model !== 'patio' && position !== 'end'));
}
export function normalize(input) {
  const c = copyDefault(); const changes = [];
  if (!input || typeof input !== 'object') return {config:c, changes};
  if (Object.hasOwn(MODELS,input.model)) c.model=input.model;
  const m=MODELS[c.model];
  if(m.depths.includes(Number(input.depth))) c.depth=Number(input.depth); else if(input.depth != null) changes.push('depth');
  if(Object.hasOwn(INSTALLATIONS,input.installation))c.installation=input.installation;
  if(input.burial!=null){const n=Number(input.burial);c.burial=Number.isFinite(n)?Math.min(c.depth,Math.max(.5,Math.round(n*2)/2)):2;}
  for(const [key,options] of Object.entries({finish:FINISHES,color:COLORS,interior:INTERIORS,...PACKAGES})) {
    if(Object.hasOwn(options,input[key])) c[key]=input[key];
  }
  if(input.finish==='aluminum'){c.finish='metal';changes.push('finish');}
  if(input.stairs==='stone'){c.stairs='access';changes.push('stairs');}
  if(c.model==='patio' && c.lighting==='rgb4'){c.lighting='rgb2';changes.push('lighting');}
  if(c.installation==='inground'&&c.stairs!=='none'){c.stairs='none';changes.push('stairs');}
  const seen=new Set();
  for(const w of (Array.isArray(input.windows)?input.windows:[]).slice(0,20)) {
    if(!w || c.windows.length>=m.maxWindows || !windowPositions(c).includes(w.position) || seen.has(w.position)){changes.push('window');continue;}
    let size=w.size;
    if(!windowSizes(c,w.position).includes(size)){size='classic';changes.push('window-size');}
    seen.add(w.position);c.windows.push({size,position:w.position});
  }
  return {config:c,changes:[...new Set(changes)]};
}
export function optionPrice(key,id,c) {
  const m=MODELS[c.model];const o=PACKAGES[key][id];
  if(o.byModel)return o.byModel[c.model];
  if(o.modelPrice) return m[o.modelPrice];
  if(key==='cover' && o.rate) return roundUp50((poolArea(c)*o.rate+o.fixed)*(m.customDesign?1.3:1));
  if(key==='lighting' && o.rate) return roundUp50(poolPerimeter(c)*o.rate+o.fixed);
  if(key==='decking' && o.rate) return round50(m.length*o.depth*o.rate);
  if(key==='stairs' && id!=='none'){const risers=stairRisers(c),rate=id==='turn'&&risers<4?PACKAGES.stairs.access:o;return c.installation==='inground'?0:roundUp50(rate.fixed+risers*rate.perRiser);}
  if(key==='landscape' && o.rate)return roundUp50(patioArea(c)*o.rate+o.fixed);
  return o.price||0;
}
export const poolArea=c=>MODELS[c.model].customDesign?planArea(courtOutline()):MODELS[c.model].length*MODELS[c.model].width;
export const poolPerimeter=c=>MODELS[c.model].customDesign?courtSegments().reduce((n,s)=>n+s.length,0):2*(MODELS[c.model].length+MODELS[c.model].width);
export const stairRisers=c=>Math.max(0,Math.ceil((c.depth+.65-burialAmount(c))/.625));
export const patioArea=c=>{const m=MODELS[c.model];return Math.max(0,(m.length+10)*(m.width+10)-poolArea(c)-(c.decking==='side'?m.length*3:0));};
export const depthPrice=c=>DEPTH_PRICES[c.model][c.depth];
export function finishPrice(id,c) {
  return roundUp50(poolPerimeter(c)*Math.max(0,c.depth+.5-burialAmount(c))*FINISHES[id].rate);
}
export function windowPrice(w,c){return roundUp50((WINDOW_SIZES[w.size].price+POSITIONS[w.position].extra)*(1+Math.max(0,c.depth-4.5)*.15));}
// Incremental excavation, haul-off, drainage and below-grade protection allowance.
// Assumes accessible, ordinary soil. The 4 ft working envelope is not the water area.
export function groundPrice(c){
  if(c.installation==='above')return 0;
  const m=MODELS[c.model],yards=(m.length+4)*(m.width+4)*burialAmount(c)/27;
  return roundUp50(3548.39+yards*120.97+poolPerimeter(c)*40.33+(c.installation==='inground'?806.46:0));
}
export function siteBudget(c,lang='en'){
  const r=SITE_RATES[c.model],es=lang==='es',lines=[];
  const add=(id,en,sp,total)=>{if(total>0)lines.push({id,label:es?sp:en,qty:1,unit:total,total,allowance:true});};
  add('freight','US freight allowance','Provisión para flete en EE. UU.',r.freight);
  // Charge only work beyond the standard above-ground installation. The base
  // already covers unloading, foundation/pad, basic connections, planning,
  // standard barrier/access and their contingency. Do not add them again.
  add('foundation','Extra deck & stair footings','Apoyos adicionales para terraza y escalera',(c.decking==='side'?450:0)+(c.stairs!=='none'?250:0)+(c.stairs==='turn'&&stairRisers(c)>=4?250:0));
  add('ground','Excavation, drainage & below-grade work','Excavación, drenaje y obra bajo terreno',groundPrice(c));
  add('connections','Additional heater connections','Conexiones adicionales para calentador',c.heating==='gas'?800:c.heating==='heatpump'?600:0);
  const standardRisers=stairRisers({...c,depth:STANDARD_DEPTH,installation:'above'});
  if(c.stairs==='none'&&c.installation!=='inground')add('local-access','Extra access height','Altura adicional de acceso',Math.max(0,stairRisers(c)-standardRisers)*200);
  add('landscape','Patio & planting allowance','Provisión para patio y plantas',optionPrice('landscape',c.landscape,c));
  const upgrades=lines.filter(l=>l.id!=='freight').reduce((sum,l)=>sum+l.total,0);
  add('site-reserve','Site upgrades contingency · 10%','Reserva para mejoras de obra · 10%',round50(upgrades*.1));
  return lines;
}
export function quote(input,lang='en') {
  const c=normalize(input).config;const m=MODELS[c.model];const es=lang==='es';
  const lines=[{id:'base',label:m.name+(es?' · obra estándar incluida':' · standard site work included'),qty:1,unit:m.base,total:m.base}];
  const add=(id,label,price,qty=1)=>{if(price)lines.push({id,label,qty,unit:price,total:price*qty});};
  add('depth',es?'Profundidad de agua '+depthLabel(c.depth,lang):depthLabel(c.depth,lang)+' water depth',depthPrice(c));
  add('finish',localLabel(FINISHES[c.finish],lang),finishPrice(c.finish,c));
  c.windows.forEach((w,i)=>add('window-'+i,`${es?'Ventana':'Window'} ${i+1} · ${localLabel(WINDOW_SIZES[w.size],lang)} · ${localLabel(POSITIONS[w.position],lang)}`,windowPrice(w,c)));
  for(const k of Object.keys(PACKAGES).filter(k=>k!=='landscape'))add(k,localLabel(PACKAGES[k][c[k]],lang),optionPrice(k,c[k],c));
  const total=lines.reduce((s,l)=>s+l.total,0),siteLines=siteBudget(c,lang),siteTotal=siteLines.reduce((s,l)=>s+l.total,0);
  return {config:c,lines,total,siteLines,siteTotal,projectTotal:total+siteTotal,currency:CURRENCY,version:VERSION,status:'preliminary'};
}
export function dimensions(c,lang='en') {
  const m=MODELS[c.model];
  return lang==='es'?`${(m.length*.3048).toFixed(2)} × ${(m.width*.3048).toFixed(2)} m`:`${m.length} × ${m.width} ft`;
}
export function serialize(c){return encodeURIComponent(JSON.stringify({v:1,...normalize(c).config}));}
export function deserialize(raw){try {return normalize(JSON.parse(raw)).config;}catch{return null;}}
