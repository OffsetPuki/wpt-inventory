import {takeoff,wallLength,ridgeHeight,WALLS,round} from './barndominium/model.js';

export const SCOPE = [
 ['delivery','Delivery','Entrega'],['installation','Installation','Instalación'],
 ['foundation','Foundation / slab','Cimentación / losa'],['permits','Permits','Permisos'],
 ['engineering','Structural engineering','Cálculo estructural'],['interior','Interior work','Trabajo interior'],
];
export const MATERIALS = [
 ['columns','Columns / posts','Columnas / postes'],['rafters','Roof rafters','Vigas del techo'],
 ['cee','CEE roof purlins','Correas CEE del techo'],['zee','ZEE wall girts','Correas ZEE de muros'],
 ['roof','Roof panels','Lámina de techo'],['walls','Wall panels','Lámina de muros'],
 ['roof-insulation','Roof insulation','Aislamiento de techo'],['wall-insulation','Wall insulation','Aislamiento de muros'],
];
export const PURCHASE_FIELDS = [
 ['columnStock','Column stock length (ft)',0.1,100],['rafterStock','Rafter stock length (ft)',0.1,200],
 ['ceeStock','CEE stock length (ft)',0.1,100],['zeeStock','ZEE stock length (ft)',0.1,100],
 ['lap','Purlin / girt end lap (ft)',0,10],['kerf','Saw cut allowance (in)',0,1],
 ['roofCover','Roof panel usable cover width (ft)',0.1,10],['wallCover','Wall panel usable cover width (ft)',0.1,10],
 ['roofRoll','Roof roll usable coverage (sq ft)',1,10000],['wallRoll','Wall roll usable coverage (sq ft)',1,10000],
 ['waste','Extra material allowance (%)',0,50],
];
export function cleanBarndoQuote(raw={}) {
 const out={specs:{},scope:{},purchase:{},scopeEnabled:raw.scopeEnabled===true};
 for(const [key] of MATERIALS)out.specs[key]=typeof raw.specs?.[key]==='string'?raw.specs[key].slice(0,160):'';
 for(const [key] of SCOPE){const s=raw.scope?.[key]||{};out.scope[key]={status:['included','excluded'].includes(s.status)?s.status:'review',note:typeof s.note==='string'?s.note.slice(0,240):''};}
 for(const [key,,min,max] of PURCHASE_FIELDS){const n=raw.purchase?.[key];if(n==null||n==='')out.purchase[key]='';else if(!Number.isFinite(Number(n))||Number(n)<min||Number(n)>max)throw new Error(`Review ${key} purchasing value.`);else out.purchase[key]=Number(n);}
 return out;
}
export function customerBarndoSpecs(overrides,lang='en') {
 const q=cleanBarndoQuote(overrides?.barndoQuote),es=lang==='es';
 return [...MATERIALS.filter(([k])=>q.specs[k]).map(([k,en,sp])=>({label:es?sp:en,value:q.specs[k]})),
 ...(q.scopeEnabled?SCOPE.map(([k,en,sp])=>({label:es?sp:en,value:`${q.scope[k].status==='included'?(es?'Incluido':'Included'):q.scope[k].status==='excluded'?(es?'Excluido':'Excluded'):(es?'Por confirmar':'To confirm')}${q.scope[k].note?' — '+q.scope[k].note:''}`})):[])];
}
// Purchasing allowances are separate from net takeoff and quote prices. No
// structural splice, offcut reuse, supplier profile or roll coverage is assumed.
export function purchasing(s,raw={}) {
 const q=cleanBarndoQuote(raw),p=q.purchase,t=takeoff(s),rows=[],issues=[];
 const factor=1+(Number(p.waste)||0)/100,kerf=(Number(p.kerf)||0)/12;
 const add=(key,name,qty,unit,detail)=>rows.push({key,name,qty,unit,detail});
 const required=(keys,name)=>{const missing=keys.filter(k=>p[k]==='');if(missing.length){issues.push(`${name}: enter ${missing.map(k=>PURCHASE_FIELDS.find(f=>f[0]===k)[1]).join(', ')}.`);return false;}return true;};
 function pieces(key,name,cuts,stockKey,splice=false){
  if(!cuts.length||!required([stockKey,'waste',...(splice?['lap']:['kerf'])],name))return;
  const stock=p[stockKey],lap=Number(p.lap)||0;let count=0;
  if(splice){if(lap>=stock){issues.push(`${name}: end lap must be shorter than stock.`);return;}count=cuts.reduce((n,cut)=>n+Math.max(1,Math.ceil((cut-lap)/(stock-lap)-1e-9)),0);}
  else {if(cuts.some(c=>c>stock+1e-9)){issues.push(`${name}: stock is shorter than a required ${round(Math.max(...cuts))} ft member. Choose longer stock; structural splices require separate review.`);return;}
   const bins=[];for(const c of [...cuts].sort((a,b)=>b-a)){const i=bins.findIndex(left=>left>=c+kerf-1e-9);if(i<0)bins.push(stock-c);else bins[i]-=c+kerf;}count=bins.length;
  }
  add(key,name,Math.ceil(count*factor-1e-9),'pieces',`${stock} ft stock${splice?`; ${lap} ft end lap; no offcut reuse`:''}`);
 }
 pieces('building-columns','Columns / posts',Array(t.columns).fill(s.height),'columnStock');
 pieces('building-rafters','Roof rafters',Array(t.frames*2).fill(s.width/2*Math.hypot(1,s.pitch/12)),'rafterStock');
 const roofRows=2*(Math.ceil(s.width/2*Math.hypot(1,s.pitch/12)/s.roofSpacing)+1);
 pieces('building-cee','CEE roof purlins',Array(roofRows).fill(s.depth),'ceeStock',true);
 const girtCuts=[],n=Math.ceil(s.height/s.wallSpacing);
 for(const wall of WALLS)for(let i=1;i<=n;i++){
  const y=i*s.height/n,L=wallLength(s,wall);let x=0;
  for(const o of s.openings.filter(o=>o.wall===wall&&y>o.sill&&y<o.sill+o.height).sort((a,b)=>a.x-b.x)){if(o.x>x)girtCuts.push(o.x-x);x=Math.max(x,o.x+o.width);}if(x<L)girtCuts.push(L-x);
 }
 for(let y=s.height+s.wallSpacing;y<ridgeHeight(s);y+=s.wallSpacing){const cut=s.width*(ridgeHeight(s)-y)/(ridgeHeight(s)-s.height);girtCuts.push(cut,cut);}
 pieces('building-zee','ZEE wall girts',girtCuts,'zeeStock',true);
 const panels=(key,name,span,length,cover,mult=1)=>{if(!required([cover,'waste'],name))return;const cutInches=Math.ceil(length*12-1e-8);add(key,name,Math.ceil(mult*Math.ceil(span/p[cover]-1e-9)*factor-1e-9),'panels',`${cutInches} in minimum cut length × ${p[cover]} ft usable cover`);};
 if(s.roofPanel)panels('building-roof','Roof panels',s.depth+2*s.overhang,(s.width/2+s.overhang)*Math.hypot(1,s.pitch/12),'roofCover',2);
 if(s.wallPanel){panels('building-walls-side','Side wall panels',s.depth,s.height,'wallCover',2);panels('building-walls-gable','Gable wall panels',s.width,ridgeHeight(s),'wallCover',2);}
 for(const porch of s.porches)panels(`building-porch-roof-${porch.id}`,`Porch roof (${porch.wall})`,porch.width,porch.depth*Math.hypot(1,porch.pitch/12),'roofCover');
 for(const [key,area,kind,field] of [['roof',s.width*s.depth*Math.hypot(1,s.pitch/12),s.roofInsulation,'roofRoll'],['wall',t.wallNet,s.wallInsulation,'wallRoll']]){
  if(kind==='none')continue;
  if(kind==='spray-foam'){issues.push(`${key} spray foam: confirm thickness and supplier yield separately; no roll conversion applies.`);continue;}
  if(required([field,'waste'],`${key} insulation`))add(`building-${key}-insulation`,`${key==='roof'?'Roof':'Wall'} insulation`,Math.ceil(area*factor/p[field]-1e-9),'rolls',`${p[field]} sq ft usable coverage per roll`);
 }
 return {rows,issues};
}
export function compareBarndo(a,b,lang='en') {
 const fields=[['width','Width (ft)'],['depth','Length (ft)'],['height','Wall height (ft)'],['pitch','Roof pitch'],['overhang','Overhang (ft)'],['frame','Frame'],['roofPanel','Roof panels included'],['wallPanel','Wall panels included'],['roofColor','Roof color'],['wallColor','Wall color'],['trimColor','Trim color'],['roofInsulation','Roof insulation'],['wallInsulation','Wall insulation']];
 const rows=fields.map(([key,label])=>({label,a:String(a.state[key]),b:String(b.state[key])}));
 const designItems=(s,key)=>s.state[key].map(o=>`${o.kind||'Porch'} ${o.wall}: ${o.width}×${key==='porches'?o.depth:o.height} ft, offset ${o.x} ft${key==='porches'?`, height ${o.height} ft, pitch ${o.pitch}:12`:`${o.sill!=null?`, sill ${o.sill} ft`:''}`}`).join('; ')||'None';
 for(const key of ['openings','porches'])rows.push({label:key==='openings'?'Doors & windows':'Porches',a:designItems(a,key),b:designItems(b,key)});
 const left=customerBarndoSpecs(a.overrides,lang),right=customerBarndoSpecs(b.overrides,lang);
 for(const label of new Set([...left,...right].map(r=>r.label)))rows.push({label,a:left.find(r=>r.label===label)?.value||'Not specified',b:right.find(r=>r.label===label)?.value||'Not specified'});
 const spanish={'Width (ft)':'Ancho (ft)','Length (ft)':'Largo (ft)','Wall height (ft)':'Altura de muros (ft)','Roof pitch':'Pendiente del techo','Overhang (ft)':'Voladizo (ft)','Roof panels included':'Lámina de techo incluida','Wall panels included':'Lámina de muros incluida','Trim color':'Color de molduras','Frame':'Estructura','Roof color':'Color del techo','Wall color':'Color de muros','Roof insulation':'Aislamiento de techo','Wall insulation':'Aislamiento de muros','Doors & windows':'Puertas y ventanas','Porches':'Porches'};
 return rows.map(r=>({...r,label:lang==='es'?(spanish[r.label]||r.label):r.label,changed:r.a!==r.b}));
}

export function scopeIssues(session,totals) {
 if(session.type!=='barndominium')return [];
 const q=cleanBarndoQuote(session.overrides?.barndoQuote);
 if(!q.scopeEnabled)return [];
 const issues=SCOPE.filter(([k])=>q.scope[k].status==='review').map(([,label])=>`Choose Included or Excluded for ${label}.`);
 if(q.scope.delivery.status==='excluded'&&totals?.lines?.delivery?.total>0)issues.push('Delivery is excluded but has a charge. Remove the delivery charge or include delivery.');
 if(q.scope.installation.status==='excluded'&&totals?.lines?.finishing?.total>0)issues.push('Installation is excluded but has a charge. Remove the installation charge or include installation.');
 return issues;
}
