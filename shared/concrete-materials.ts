import {z} from 'zod';

export const rebarSizes={'#3':'#3 · 3/8 in diameter','#4':'#4 · 1/2 in diameter','#5':'#5 · 5/8 in diameter'} as const;
export const concreteMaterialsSchema=z.object({
 thicknessIn:z.number().finite().min(2).max(24).nullable(),
 strengthPsi:z.number().finite().int().min(2500).max(10000).nullable(),
 rebarSize:z.enum(['#3','#4','#5']),rebarSpacingIn:z.number().finite().min(3).max(48).nullable(),
 steel:z.string().max(200),baseDepthIn:z.number().finite().min(0).max(48).nullable(),
 baseMaterial:z.string().max(1000),placement:z.string().max(1000),joints:z.string().max(1200),
 finish:z.string().max(300),drainage:z.string().max(800),curing:z.string().max(1000),
 loading:z.string().max(1000),siteNotes:z.string().max(1500),pricingReviewed:z.boolean(),
}).strict();
export type ConcreteMaterials=z.infer<typeof concreteMaterialsSchema>;

// Estimating proposals, not engineered designs or verified local requirements.
// Persist with estimates so later defaults cannot alter saved specifications.
export function defaultConcreteMaterials(key:string):ConcreteMaterials{return {
 thicknessIn:key==='drive'?5:key==='rv'?6:4,strengthPsi:4000,rebarSize:key==='rv'?'#4':'#3',rebarSpacingIn:18,
 steel:'Deformed steel rebar · ASTM A615 Grade 60',baseDepthIn:null,
 baseMaterial:key==='trash'?'Suitable compacted structural fill to rebuild washed-out areas; crushed-stone base where specified. Determine material, depth and compaction requirements after opening the area.':'Proposed crushed-stone base over stable, prepared subgrade. Confirm whether aggregate, soil treatment or other preparation is appropriate for the existing soil; depth is not yet established.',
 placement:'Tie the grid and support it on proper chairs or concrete supports. Confirm concrete cover, bar elevations, laps and joint details for this slab before pouring. Keep steel off the ground; do not assume fiber replaces the specified bars.',
 joints:'Plan contraction joints before pouring; use near-square panels and break up L-shaped areas. Provide compressible isolation material at walls and retained footings where the detail requires movement. Confirm any dowels; do not automatically drill into the house or carport footings.',
 finish:'Broom finish with neatly tooled edges',
 drainage:'Set finished elevations to drain away from the house without trapping water or covering brick weep holes. Verify outlet, thresholds and walkway slopes onsite.',
 curing:'Proposed ASTM C309 curing compound, applied at the manufacturer’s coverage rate after finishing; verify compatibility with future coatings. Plan moisture/temperature protection for the specified curing period, typically 3–7 days, adjusted for the mix and weather.',
 loading:key==='rv'?'RV model, loaded weight, axle loads and jack/outrigger loads are UNKNOWN. Confirm slab/base design and any jack pads or thickened areas. Allow RV loading only after the required in-place strength is established.':key==='drive'?'Confirm passenger-car/light-truck loading. Reopen only when the mix supplier or project specification permits the actual vehicle loads; 28-day PSI is not an early loading clearance.':'Pedestrian/trash-can use only unless reviewed for other loads. Confirm when foot traffic and bins may return with the crew and mix supplier.',
 siteNotes:key==='drive'?'Inspect carport posts, anchors and footings before demolition. Preserve verified supports. Engineered shoring, replacement footings and structural repairs are not covered by a dedicated allowance in the current estimate.':key==='rv'?'6 in slab and #4 bars at 18 in each way are provisional estimating assumptions, not an RV load rating. Confirm soil support, turning loads, allowable widening and concentrated jack loads before final specification.':key==='trash'?'Investigate the washout source and repair support before pouring. The $1,000 washout allowance is provisional. Remove the specified chain-link fence/gate; no replacement.':key==='walk'?'Confirm the taper from the white carport post to the porch, covering the dead-grass area. Retain the porch; verify elevations and accessible passage.':'Measure the right-side path and any return. Retain access to equipment and utilities. Divide corners into suitable joint panels.',
 pricingReviewed:false,
};}
export function materialsQuantity(area:number|null,m:ConcreteMaterials){return area===null||m.thicknessIn===null?null:area*m.thicknessIn/324;}
export function materialsSummary(m:ConcreteMaterials){return `${m.thicknessIn===null?'Thickness TBD':m.thicknessIn+' in slab'} · ${m.strengthPsi===null?'PSI TBD':m.strengthPsi.toLocaleString('en-US')+' PSI at 28 days'} · ${rebarSizes[m.rebarSize]} at ${m.rebarSpacingIn===null?'TBD':m.rebarSpacingIn+' in'} each way`;}
export function materialsReport(m:ConcreteMaterials,area:number|null){const volume=materialsQuantity(area,m);return `PROPOSED MATERIALS — site and supplier review required\n${materialsSummary(m)}\nSteel: ${m.steel}\nNet slab concrete: ${volume===null?'Awaiting dimensions/thickness':volume.toFixed(2)+' yd³ (excludes waste, over-excavation, thickened edges and footings; not an order quantity)'}\nBase depth: ${m.baseDepthIn===null?'To be confirmed':m.baseDepthIn+' in compacted'}\nBase: ${m.baseMaterial}\nRebar placement: ${m.placement}\nJoints: ${m.joints}\nFinish: ${m.finish}\nDrainage: ${m.drainage}\nCuring: ${m.curing}\nLoading: ${m.loading}\nSite notes: ${m.siteNotes}\nSelling-rate review: ${m.pricingReviewed?'Marked reviewed by estimator':'Pending — materials do not automatically change the price'}`;}
export const materialsSources=[
 {label:'NRMCA · Ordering ready-mixed concrete',url:'https://www.nrmca.org/wp-content/uploads/2021/01/31pr.pdf'},
 {label:'NRMCA · Joints in slabs on grade',url:'https://www.nrmca.org/wp-content/uploads/2021/01/06pr.pdf'},
 {label:'NRMCA · Curing concrete',url:'https://www.nrmca.org/wp-content/uploads/2021/01/11pr.pdf'},
 {label:'CRSI · Reinforcing bar dimensions',url:'https://www.crsi.org/wp-content/uploads/CRSI_MSP_29th_Ed_Errata-Nov2019.pdf'},
 {label:'NRH · Public Works Design Manual',url:'https://www.nrhtx.com/DocumentCenter/View/326/Design-manual?bidId='},
];
