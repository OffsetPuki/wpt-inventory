import {defaultState} from '../data/configurators.js';
const packages={
 barndominium:[['30 × 40 shop',{width:30,depth:40}],['40 × 60 shop',{width:40,depth:60}]],
 carport:[['One vehicle',{width:12,depth:20}],['Two vehicles',{width:20,depth:20}],['Extended cover',{width:24,depth:30}]],
 concrete:[['Driveway',{project:'driveway',lengthFt:30,widthFt:20}],['Patio',{project:'patio',lengthFt:20,widthFt:15}],['Shop slab',{project:'slab',lengthFt:40,widthFt:30}]],
 gate:[['Single swing',{type:'single',width:10}],['Double swing',{type:'double',width:16,extraPosts:'yes'}]],
 fence:[['40 ft run',{totalLengthFt:40}],['100 ft run',{totalLengthFt:100}]],
 pergola:[['12 × 16',{width:12,depth:16}],['16 × 20',{width:16,depth:20}]],
 railing:[['12 ft balcony',{lengthFt:12,app:'balcony'}],['24 ft balcony',{lengthFt:24,app:'balcony'}]],
 table:[['Bar base',{tableType:'bar',lengthFt:8,frameHeightIn:40}],['Compact bar base',{tableType:'bar',lengthFt:6,frameHeightIn:40}]],
 insulation:[['Pipe insulation',{system:'pipe'}],['Tank insulation',{system:'tank'}]],
};
export default function StandardPackages({type,onChange}){
 const items=packages[type];if(!items)return null;
 return <details className="quote-section"><summary>Start with a standard size</summary><p className="hint">Replaces this design’s options. Your customer stays selected. Pricing comes from your saved rates.</p><div className="btn-row">{items.map(([name,changes])=><button type="button" className="btn ghost" key={name} onClick={()=>onChange({...defaultState(type),...(type==='carport'?{pricingMode:'package',gableFrame:'truss'}:{}),...changes})}>{name}</button>)}</div></details>;
}
