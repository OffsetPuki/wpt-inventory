import {z} from 'zod';
import {concreteMaterialsSchema,defaultConcreteMaterials,materialsReport} from './concrete-materials';

export const concreteKeys=['drive','rv','walk','trash','sidewalk'] as const;
export type ConcreteKey=typeof concreteKeys[number];
export const concreteLabels:Record<ConcreteKey,string>={drive:'Driveway',rv:'RV parking',walk:'Front walkway',trash:'Left trash pad',sidewalk:'Right-side walkway'};
export const concreteColors:Record<ConcreteKey,string>={drive:'#3b82c4',rv:'#22a585',walk:'#da9b26',trash:'#a66ac7',sidewalk:'#c8724c'};
const measureSchema=z.object({feet:z.number().finite().min(0).max(1000).nullable(),inches:z.number().finite().min(0).lt(12).nullable()}).strict();
const sectionSchema=z.object({included:z.boolean(),shape:z.enum(['rectangle','taper','two-rectangles']),length:measureSchema,width:measureSchema,endWidth:measureSchema,returnLength:measureSchema,returnWidth:measureSchema,rate:z.number().finite().min(0).max(1000),allowance:z.number().finite().min(0).max(1000000),measured:z.boolean(),notes:z.string().max(1500),materials:concreteMaterialsSchema.optional()}).strict();
export const concreteEstimateSchema=z.object({schemaVersion:z.literal(1),sections:z.object({drive:sectionSchema,rv:sectionSchema,walk:sectionSchema,trash:sectionSchema,sidewalk:sectionSchema}).strict(),washout:z.number().finite().min(0).max(1000000),permits:z.number().finite().min(0).max(1000000),extra:z.number().finite().min(0).max(1000000),extraLabel:z.string().max(120),discount:z.number().finite().min(0).max(1000000),notes:z.string().max(3000)}).strict().superRefine((data,ctx)=>{
 for(const key of concreteKeys){const s=data.sections[key];if(s.measured&&sectionArea(s)===null)ctx.addIssue({code:z.ZodIssueCode.custom,path:['sections',key,'measured'],message:'Complete this section’s positive dimensions before marking it measured.'});}
 if(data.discount>calculateConcrete(data).subtotal)ctx.addIssue({code:z.ZodIssueCode.custom,path:['discount'],message:'Discount cannot exceed the subtotal.'});
}).transform(data=>{
 for(const key of concreteKeys)data.sections[key].materials??=defaultConcreteMaterials(key);
 return data;
});
export type ConcreteEstimate=z.infer<typeof concreteEstimateSchema>;
export type ConcreteSection=z.infer<typeof sectionSchema>;
export type ConcreteMeasure=z.infer<typeof measureSchema>;
export function feet(m:ConcreteMeasure){return m.feet===null||m.inches===null||!Number.isFinite(m.feet)||!Number.isFinite(m.inches)||m.feet<0||m.inches<0||m.inches>=12?null:m.feet+m.inches/12;}
export function sectionArea(s:ConcreteSection){
 const l=feet(s.length),w=feet(s.width),e=feet(s.endWidth),rl=feet(s.returnLength),rw=feet(s.returnWidth);
 if(l===null||w===null||l<=0||w<=0)return null;
 if(s.shape==='taper')return e===null||e<=0?null:l*(w+e)/2;
 if(s.shape==='two-rectangles')return rl===null||rw===null||rl<=0||rw<=0?null:l*w+rl*rw;
 return l*w;
}
const cents=(n:number)=>Math.round((n+Number.EPSILON)*100);
export function calculateConcrete(data:ConcreteEstimate){
 const rows=concreteKeys.map(key=>{const s=data.sections[key],area=sectionArea(s),usingAllowance=area===null;return {key,label:concreteLabels[key],included:s.included,area,usingAllowance,measured:s.measured,amount:s.included?cents(usingAllowance?s.allowance:area*s.rate)/100:0};});
 const workCents=rows.reduce((sum,r)=>sum+cents(r.amount),0),subtotalCents=workCents+cents(data.washout)+cents(data.permits)+cents(data.extra);
 return {rows,area:rows.reduce((sum,r)=>sum+(r.included?(r.area||0):0),0),unmeasured:rows.filter(r=>r.included&&!r.measured).length,allowances:rows.filter(r=>r.included&&r.usingAllowance).length,subtotal:subtotalCents/100,total:Math.max(0,subtotalCents-cents(data.discount))/100};
}
const m=(feet:number|null,inches=0):ConcreteMeasure=>({feet,inches});
const section=(length:ConcreteMeasure,width:ConcreteMeasure,rate:number,allowance:number):ConcreteSection=>({included:true,shape:'rectangle',length,width,endWidth:m(null),returnLength:m(null),returnWidth:m(null),rate,allowance,measured:false,notes:''});
export function defaultConcreteEstimate():ConcreteEstimate{return concreteEstimateSchema.parse({schemaVersion:1,sections:{
 drive:{...section(m(34),m(17,6),12.10,7200),notes:'Preserve carport and street approach. Verify post foundations before demolition.'},
 rv:{...section(m(29),m(12,1),13.70,4800),notes:'Width assumes the existing 8′1″ plus 4′ widening. Verify property line and city allowance.'},
 walk:{...section(m(17),m(5,6),16.61,1200),shape:'taper',endWidth:m(3),notes:'5.5′ at porch; 3′ narrow end is assumed. Retain the porch.'},
 trash:{...section(m(12),m(8),18.75,1800),notes:'Left side. Remove specified chain-link fence and gate. Washout repair is a separate allowance.'},
 sidewalk:{...section(m(null),m(null),18,1400),notes:'Right side. Measure the actual path. Use two rectangles for an L shape; exclude the overlap.'}
 },washout:1000,permits:500,extra:0,extraLabel:'Additional work',discount:0,notes:'Selling rates include demolition/haul-off, ordinary preparation, reinforced concrete, broom finish, joints, curing and cleanup. Confirm thickness, reinforcement, access, drainage and city requirements before issuing a firm proposal. No tax calculation is applied here; review the final written quote.'});}
export function formatMeasure(m:ConcreteMeasure){return feet(m)===null?'Unmeasured':`${m.feet}′ ${m.inches}″`;}
export function concreteReport(data:ConcreteEstimate,title:string){const c=calculateConcrete(data),money=(n:number)=>n.toLocaleString('en-US',{style:'currency',currency:'USD'});return `${title}\nCJM Concrete · Site estimate\n\n${c.rows.map(r=>{const s=data.sections[r.key];return `${r.label}: ${r.included?money(r.amount):'Excluded'}\n${formatMeasure(s.length)} × ${formatMeasure(s.width)}${s.shape==='taper'?' → '+formatMeasure(s.endWidth):s.shape==='two-rectangles'?' + '+formatMeasure(s.returnLength)+' × '+formatMeasure(s.returnWidth):''}\n${r.area===null?'Allowance; dimensions missing':r.area.toFixed(2)+' sq ft × '+money(s.rate)+'/sq ft'} · ${s.measured?'Measured on site':'Verify dimensions'}${s.notes?'\n'+s.notes:''}\n${materialsReport(s.materials??defaultConcreteMaterials(r.key),r.area)}`;}).join('\n\n')}\n\nWashout/base allowance: ${money(data.washout)}\nPermit administration/coordination allowance: ${money(data.permits)}\n${data.extraLabel}: ${money(data.extra)}\nDiscount: ${money(data.discount)}\nTOTAL: ${money(c.total)}\n${c.unmeasured} included sections await measurement confirmation.\n\n${data.notes}`;}
