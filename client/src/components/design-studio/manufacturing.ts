import type {ShopPart} from './types';
import {dimension,exactMm} from './fractions';

export const fitNotes=(p:ShopPart)=>p.notes.filter(n=>/provisional|unconfirmed|verify|measure actual|estimated|confirm |indicative|not specified|thread envelope|tap-drill/i.test(n));
export function cuttingSize(p:ShopPart){
 return {mm:p.cutLengthMm||p.dimensions[0],basis:p.cutLengthMm?'Recorded stock cut length':'Finished model length; allow for the cutting process'};
}
export const stockName=(p:ShopPart)=>p.stock||p.material||'Stock not specified';
export function partChecks(p:ShopPart){
 const checks=[...fitNotes(p)];
 if(p.kind==='custom'){
  if(!p.fabrication?.materialGrade||/unconfirmed/i.test(p.fabrication.materialGrade))checks.push('Material grade is not confirmed. The displayed material describes the model.');
  if((p.fabrication?.componentCount||0)>1&&!/plain L angle/i.test(p.stock))checks.push('This is a 3D machined shape. Overall dimensions describe its envelope, not a developed flat blank.');
  if(/thread|tapped/i.test(p.name))checks.push('Confirm thread form, pitch, engagement and tap-drill size before machining. A modeled bore diameter is not a tap-drill specification.');
 }
 return [...new Set(checks)];
}
export function cutCsv(parts:ShopPart[],revision:string){
 const cell=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"';
 const rows=[['Revision','Part','Name','Variant','Quantity','Stock','Finished length mm','Finished width mm','Finished depth mm','Cut length mm (if specified)','Length inches nearest 1/16','Holes','Review notes'],...parts.filter(p=>p.kind==='custom').map(p=>[revision,p.id,p.name,p.variant||'',p.quantity,stockName(p),...p.dimensions,p.cutLengthMm||'',dimension(p.dimensions[0]),p.holeCount??p.holes?.length,partChecks(p).join(' | ')])];
 return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
export function downloadFile(text:string,name:string,type='text/plain'){
 const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function exactCoordinate(p:number[]){return p.map(exactMm).join(' / ');}
