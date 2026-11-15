import type {Express} from 'express';
import crypto from 'node:crypto';
import {z} from 'zod';
import {db,sqlite} from './storage';
import {hasLeadKey} from './public-api';
import {insertQuoteWithNumber} from './quotes';
import {clients,leads} from '../shared/crm-schema';
import {DEFAULT_PRICE_BOOK} from '../client/src/quote/data/priceBook.js';
import {MODELS,FINISHES,COLORS,INTERIORS,WINDOW_SIZES,POSITIONS,PACKAGES,INSTALLATIONS,VERSION,normalize,quote,dimensions,installationLabel,serialize} from '../shared/pools/catalog.mjs';

const choice=(options:Record<string,unknown>)=>z.string().refine(v=>Object.hasOwn(options,v),'Invalid pool option');
const configSchema=z.object({model:choice(MODELS),depth:z.union([z.literal(4.5),z.literal(5),z.literal(6)]),installation:choice(INSTALLATIONS),burial:z.number().min(.5).max(6).multipleOf(.5),finish:choice(FINISHES),color:choice(COLORS),interior:choice(INTERIORS),windows:z.array(z.object({size:choice(WINDOW_SIZES),position:choice(POSITIONS)})).max(2),...Object.fromEntries(Object.entries(PACKAGES).map(([k,v])=>[k,choice(v as Record<string,unknown>)]))});
const short=(max:number)=>z.string().trim().min(1).max(max);
export const poolRequestSchema=z.object({
 submissionId:z.string().uuid(),catalogVersion:z.literal(VERSION),expectedTotal:z.number().finite().positive(),consent:z.literal(true),lang:z.enum(['en','es']),
 contact:z.object({name:short(120),email:z.string().trim().email().max(180),phone:z.string().trim().max(40).optional().default(''),country:z.enum(['US','MX']),city:short(160),postal:z.string().regex(/^\d{5}(-\d{4})?$/),timeline:z.enum(['exploring','3-6','6-12','12+']),site:z.enum(['residential','hospitality','other']),access:z.string().trim().min(10).max(2000)}),
 config:configSchema,
});

// One atomic job: customer + lead + saved design + unsent quote. Retries reuse it.
sqlite.exec(`CREATE TABLE IF NOT EXISTS pool_requests (
 submission_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, reference TEXT NOT NULL UNIQUE,
 lead_id INTEGER NOT NULL, quote_id INTEGER NOT NULL, total_cents INTEGER NOT NULL,
 catalog_version TEXT NOT NULL, created_at INTEGER NOT NULL
)`);

export function preparePoolRequest(raw:unknown){
 const data=poolRequestSchema.parse(raw),normalized=normalize(data.config);
 // Reject incompatible states rather than silently dropping paid selections.
 if(normalized.changes.length||JSON.stringify(normalized.config)!==JSON.stringify(normalize(normalized.config).config))throw new Error('Review your pool selections and try again.');
 for(const [key,value] of Object.entries(data.config))if(JSON.stringify(value)!==JSON.stringify(normalized.config[key as keyof typeof normalized.config]))throw new Error('Review your pool selections and try again.');
 const estimate=quote(normalized.config,data.lang);
 if(Math.abs(estimate.projectTotal-data.expectedTotal)>.005)throw new Error('The estimate has changed. Reload the designer and review the updated price.');
 const hash=crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
 return {data,estimate,hash};
}

export function createPoolRequest(raw:unknown){
 const {data,estimate,hash}=preparePoolRequest(raw);
 return sqlite.transaction(()=>{
  const previous=sqlite.prepare('SELECT * FROM pool_requests WHERE submission_id=?').get(data.submissionId) as any;
  if(previous){if(previous.payload_hash!==hash)throw new Error('This request was changed. Please submit it as a new request.');return {reference:previous.reference,total:previous.total_cents/100,deduped:true,quoteId:previous.quote_id};}
  const now=Date.now(),contact=data.contact,config=estimate.config,model=MODELS[config.model as keyof typeof MODELS];
  const reference='CJM-POOL-'+crypto.randomBytes(5).toString('hex').toUpperCase();
  const location=[contact.city,contact.postal,contact.country].join(', ');
  const existing=sqlite.prepare('SELECT id FROM crm_clients WHERE lower(email)=lower(?) AND deleted_at IS NULL ORDER BY id LIMIT 1').get(contact.email) as {id:number}|undefined;
  const clientId=existing?.id??db.insert(clients).values({name:contact.name,email:contact.email,phone:contact.phone,city:contact.city,zip:contact.postal,preferredLanguage:data.lang,tags:JSON.stringify(['pool-inquiry']),notes:'Pool website inquiry · '+reference}).returning().get().id;
  const spec=[model.name,dimensions(config,data.lang),config.depth+' ft water depth',installationLabel(config,data.lang),'Finish: '+config.finish+' / '+config.color,'Interior: '+config.interior,'Seating: '+config.seating,'Lighting: '+config.lighting,'Heating: '+config.heating,'Filtration: '+config.filtration,'Treatment: '+config.treatment,'Cover: '+config.cover,'Deck: '+config.decking,'Stairs: '+config.stairs,'Landscape: '+config.landscape,'Windows: '+JSON.stringify(config.windows)].join('\n');
  const siteNotes='Timing: '+contact.timeline+'\nSite: '+contact.site+'\nAccess: '+contact.access;
  const origin=(process.env.POOL_WEBSITE_ORIGIN||'https://www.cjmmetals.com').replace(/\/$/,'');
  const designUrl=origin+(data.lang==='es'?'/es':'')+'/customize/pool?design='+serialize(config);
  const lead=db.insert(leads).values({name:contact.name,email:contact.email,phone:contact.phone,preferredLanguage:data.lang,clientId,source:'website',site:'metals',serviceRequested:'Pool · '+model.name,serviceArea:location,estimatedValueCents:Math.round(estimate.projectTotal*100),stage:'new',notes:reference+'\n'+spec+'\n'+siteNotes+'\nDesign: '+designUrl+'\nCustomer agreed to contact for this request.'}).returning().get();
  const lineItems=Object.fromEntries([...estimate.lines.map((l:any)=>({...l,label:l.label})),...estimate.siteLines.map((l:any)=>({...l,label:(data.lang==='es'?'Obra estimada · ':'Site allowance · ')+l.label}))].map((l:any,i:number)=>['pool-'+i,{custom:true,name:l.label,kind:'flat',qty:1,rate:l.total}]));
  const session={sid:'pool-'+data.submissionId,type:'custom',pricingRulesVersion:2,state:{title:model.name+' pool · preliminary estimate',color:'#213d43'},overrides:{items:{...lineItems,consumables:{removed:true}},labor:{hours:0,rate:0},install:{hours:0,rate:0}},materialMarkupPct:0,laborMarkupPct:0,taxPct:0,deliveryMiles:0,deliveryPerMile:0,discountPct:0,depositPct:0,customer:{name:contact.name,email:contact.email,phone:contact.phone,company:'',location},features:spec,notes:'Preliminary estimate before tax. Site and delivery allowances require verification. Final engineering, scope and written pricing approval are required.\n'+siteNotes+'\nDesign: '+designUrl,attachments:[],priceBookSnapshot:{...DEFAULT_PRICE_BOOK,minJobCharge:0},priceBookSnapshotAt:new Date(now).toISOString(),createdAt:new Date(now).toISOString(),pool:{reference,config,estimate,catalogVersion:VERSION,designUrl,contact,consentAt:new Date(now).toISOString()}};
  const saved=insertQuoteWithNumber({type:'custom',customerName:contact.name,designRef:reference,leadId:lead.id,totalCents:Math.round(estimate.projectTotal*100),payload:JSON.stringify(session),status:'draft',draftKey:'website-pool:'+data.submissionId});
  sqlite.prepare(`INSERT INTO web_designs (ref,lead_id,name,email,phone,service,location,consent,source_tool,design_spec,design_state,lang,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(reference,lead.id,contact.name,contact.email,contact.phone,'Pool',location,'Contact for pool quote','configurator-pool',spec,JSON.stringify({type:'custom',state:session.state,pool:session.pool}),data.lang,now);
  sqlite.prepare('INSERT INTO pool_requests VALUES (?,?,?,?,?,?,?,?)').run(data.submissionId,hash,reference,lead.id,saved.id,Math.round(estimate.projectTotal*100),VERSION,now);
  // Deliberately no share token, email, SMS, invoice or acceptance event.
  return {reference,total:estimate.projectTotal,deduped:false,quoteId:saved.id};
 }).immediate();
}

export function registerPoolRequestRoutes(app:Express){
 app.post('/api/public/pool-requests',(req,res)=>{
  if(!hasLeadKey(req))return res.status(403).json({message:'Unauthorized website request.'});
  try{const saved=createPoolRequest(req.body);return res.status(saved.deduped?200:201).json(saved);}
  catch(error){
   if(error instanceof z.ZodError)return res.status(400).json({message:'Please check the contact details and pool selections.'});
   if(error instanceof Error&&/^(Review your|The estimate|This request)/.test(error.message))return res.status(409).json({message:error.message});
   console.error('[pool-intake] Could not save pool request.');return res.status(503).json({message:'Could not save the request. Please retry.'});
  }
 });
}
