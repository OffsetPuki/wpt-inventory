import {format,partGroups,type Part,type Unit,type Variant} from './walnut-dimensions';

export type CutItem={id:string;name:string;quantity:number;stock:string;parts:Part[];kind:'straight'|'angle'|'plate'|'closure';reference:string;suggestedSize:string;suggestedEnds:string;instruction:string};
export type CutEntry={size:string;ends:string;confirmed:boolean;done:number};
export type CutEntries=Record<string,CutEntry>;
const number=(value:number)=>String(Number(value.toFixed(4)));
export function cuttingItems(variant:Variant):CutItem[]{
  const items=partGroups(variant.parts.filter(p=>p.group!=='top'&&p.category!=='Bearing strips')).map(parts=>{
    const p=parts[0],straight=p.measurements.find(m=>['Tube length','Tube length between bridges','Segment length'].includes(m.label));
    const angle=p.category==='Legs'||p.category==='Feet & bridges';
    const ref=p.measurements.find(m=>m.label==='Centerline length')||p.measurements.find(m=>m.label==='Between miter centers');
    const item:CutItem={id:p.id,name:p.name,quantity:parts.reduce((n,p)=>n+p.quantity,0),stock:p.stock.replace(/\.0(?= ×)/g,''),parts,kind:straight?'straight':angle?'angle':'plate',reference:straight?`${number(straight.inches)}″ model length`:ref?`${number(ref.inches)}″ ${ref.label.toLowerCase()}`:p.bounds.map(number).join(' × ')+'″ outside size',suggestedSize:straight?number(straight.inches):'',suggestedEnds:straight?'Square / square':'',instruction:straight?'Check fit and cap placement; confirm the final tube length.':angle?'Confirm the cut reference, end angles and handedness from the drawing.':'Confirm the flat pattern, holes and thickness before cutting.'};
    if(p.name==='Angled leg')item.instruction='15° leg lean. Centerline, vertical rise and long-point envelope are different; confirm the saw reference and paired end cuts.';
    if(p.name==='Flush-cut outward foot')item.instruction='Mitered heel and shaped floor cut. Use the foot profile; its outside box is not a saw length.';
    return item;
  });
  for(const [i,detail] of variant.integratedDetails.entries()){
    const parent=variant.parts.find(p=>p.name===(i===0?'Top trestle header':i===1?'Long upper rail':i===2?'Shallow crossbar segment':'Flush-cut outward foot'))!;
    items.push({id:`closure-${i}`,name:detail.name,quantity:detail.quantity,stock:`${number(detail.profile[2])}″ steel plate`,parts:[parent],kind:'closure',reference:detail.profile.map(number).join(' × ')+'″ nominal profile',suggestedSize:'',suggestedEnds:'',instruction:detail.note+' Confirm the flat blank and inset/cover fit. Parent tube shown in the model.'});
  }
  return items.sort((a,b)=>['straight','angle','plate','closure'].indexOf(a.kind)-['straight','angle','plate','closure'].indexOf(b.kind));
}
export function emptyCutEntry(item:CutItem):CutEntry{return {size:item.suggestedSize,ends:item.suggestedEnds,confirmed:false,done:0};}
export function validCutEntry(value:unknown,item:CutItem):CutEntry{
  if(!value||typeof value!=='object')return emptyCutEntry(item);
  const entry=value as Partial<CutEntry>;
  const size=typeof entry.size==='string'?entry.size.slice(0,120):item.suggestedSize;
  const ends=typeof entry.ends==='string'?entry.ends.slice(0,160):item.suggestedEnds;
  const confirmed=entry.confirmed===true&&!!size.trim()&&!!ends.trim();
  const done=confirmed&&Number.isInteger(entry.done)?Math.max(0,Math.min(item.quantity,entry.done!)):0;
  return {size,ends,confirmed,done};
}
export function readCutEntries(raw:string|null,items:CutItem[]):CutEntries{
  try{const parsed=JSON.parse(raw||'{}');return Object.fromEntries(items.map(item=>[item.id,validCutEntry(parsed?.[item.id],item)]));}
  catch{return Object.fromEntries(items.map(item=>[item.id,emptyCutEntry(item)]));}
}
export const cuttingStorageKey=(userId:number,revision:string,top:string)=>`cjm.dallas.cutting.v1:${userId}:${revision}:${top}`;
export function cuttingCsv(items:CutItem[],entries:CutEntries){
  const rows=[['Part','Quantity','Stock','Model reference (not cut size)','Confirmed shop size (inches)','Confirmed end cuts / profile','Cut quantity','Status']];
  for(const item of items){const e=validCutEntry(entries[item.id],item);rows.push([item.name,String(item.quantity),item.stock,item.reference,e.confirmed?e.size:'',e.confirmed?e.ends:'',String(e.done),e.confirmed?'Shop size confirmed':'Needs cut detail']);}
  return rows.map(row=>row.map(cell=>`"${(/^[=+@-]/.test(cell)?"'":'')+cell.replace(/"/g,'""')}"`).join(',')).join('\r\n');
}
export const itemStatus=(item:CutItem,entry:CutEntry)=>entry.done===item.quantity?'Cut':entry.confirmed?'Ready':'Review size';
export function partMeasures(part:Part,unit:Unit){return part.measurements.filter(m=>!m.label.startsWith('Tube outside')).map(m=>({label:m.label,value:format(m.inches,unit)}));}
