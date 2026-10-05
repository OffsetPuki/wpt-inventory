export type Unit='inch'|'fraction'|'mm';
export type Measure={label:string;inches:number};
export type Part={id:string;name:string;sourceName:string;category:string;quantity:number;location:string;material:string;stock:string;bounds:number[];min:number[];max:number[];measurements:Measure[];notes:string[];p:number[];n:number[];e:number[];materialIndex:number;group:string};
export type Variant={topThickness:number;table:number[];frame:number[];supportHeight:number;parts:Part[];assemblyDimensions:Measure[];integratedDetails:{name:string;quantity:number;profile:number[];note:string}[]};
export type Catalog={revision:string;modelRevision:string;notes:string[];variants:Record<string,Variant>};
type Point=number[];
export type ModelDimension={label:string;value:number;a:Point;b:Point;from:Point;to:Point};
export const dimensionGroups=[['table','Table size'],['frame','Steel frame'],['layout','Leg layout'],['rails','Rail spacing'],['clearance','Floor & clearance']];
export function format(value:number,unit:Unit):string{
  if(unit==='mm')return `${Math.round((value*25.4+1e-9)*100)/100} mm`;
  if(unit==='inch')return `${Number(value.toFixed(4))}″`;
  if(value!==0&&Math.abs(value)<1/32)return `${value<0?'−':''}<1/16″`;
  const n=Math.round(Math.abs(value)*16),whole=Math.floor(n/16);let numerator=n%16,denominator=16;
  while(numerator&&numerator%2===0){numerator/=2;denominator/=2;}
  return `${value<0?'−':''}${whole||!numerator?whole:''}${whole&&numerator?' ':''}${numerator?`${numerator}/${denominator}`:''}″`;
}
const line=(label:string,a:Point,b:Point,offset:Point):ModelDimension=>({label,value:Math.hypot(...b.map((v,i)=>v-a[i])),a,b,from:a.map((v,i)=>v+offset[i]),to:b.map((v,i)=>v+offset[i])});
export function boxDimensions(min:number[],max:number[],labels=['Outside · X','Outside · Y','Outside · Z']):ModelDimension[]{
  const [x,y,z]=min,[X,Y,Z]=max,gap=Math.max(...max.map((v,i)=>v-min[i]))*.08;
  return [line(labels[0],[x,y,z],[X,y,z],[0,-gap,-gap*.3]),line(labels[1],[X,y,z],[X,Y,z],[gap,0,-gap*.3]),line(labels[2],[x,y,z],[x,y,Z],[-gap,-gap,0])];
}
export function modelDimensions(variant:Variant,selected:string,group:string):ModelDimension[]{
  const part=variant.parts.find(p=>p.id===selected);
  if(part)return boxDimensions(part.min,part.max);
  const wood=variant.parts.find(p=>p.group==='top')!;
  const headers=variant.parts.filter(p=>p.name==='Top trestle header').sort((a,b)=>a.min[0]-b.min[0]);
  const rails=variant.parts.filter(p=>p.name==='Long upper rail').sort((a,b)=>a.min[1]-b.min[1]);
  const feet=variant.parts.filter(p=>p.name==='Flush-cut outward foot');
  const steel=variant.parts.filter(p=>p.group!=='top'&&p.category!=='Bearing strips');
  const min=[0,1,2].map(i=>Math.min(...steel.map(p=>p.min[i]))),max=[0,1,2].map(i=>Math.max(...steel.map(p=>p.max[i])));
  const cx=(p:Part)=>(p.min[0]+p.max[0])/2,cy=(p:Part)=>(p.min[1]+p.max[1])/2;
  if(group==='frame')return boxDimensions(min,max,['Frame length','Frame width','Steel height']);
  if(group==='layout')return [
    line('End setback',[wood.min[0],wood.min[1],0],[headers[0].min[0],wood.min[1],0],[0,-5,0]),
    line('End setback',[headers[1].max[0],wood.min[1],0],[wood.max[0],wood.min[1],0],[0,-5,0]),
    line('Trestle centers',[cx(headers[0]),0,0],[cx(headers[1]),0,0],[0,30,0]),
    line('Feet span',[cx(headers[0]),Math.min(...feet.map(p=>p.min[1])),0],[cx(headers[0]),Math.max(...feet.map(p=>p.max[1])),0],[-7,0,0])
  ];
  if(group==='rails')return [
    line('Clear gap',[50,rails[0].max[1],max[2]],[50,rails[1].min[1],max[2]],[0,0,3]),
    line('Rail centers',[77,cy(rails[0]),max[2]],[77,cy(rails[1]),max[2]],[0,0,3]),
    line('To side edge',[102,rails[1].max[1],max[2]],[102,wood.max[1],max[2]],[0,0,3]),
    line('Rail length',[rails[0].min[0],rails[0].min[1],max[2]],[rails[0].max[0],rails[0].min[1],max[2]],[0,-8,0])
  ];
  if(group==='clearance'){
    const bridge=variant.parts.find(p=>p.name==='Raised lower bridge')!,crossbar=variant.parts.find(p=>p.name==='Shallow crossbar segment')!;
    return [line('Bridge top',[cx(headers[0]),0,0],[cx(headers[0]),0,bridge.max[2]],[-9,0,0]),
      line('Under bridge',[cx(headers[1]),0,0],[cx(headers[1]),0,bridge.min[2]],[9,0,0]),
      line('Side knee height',[66,wood.min[1],0],[66,wood.min[1],crossbar.min[2]],[0,-6,0]),
      line('Bearing height',[cx(headers[1]),wood.max[1],0],[cx(headers[1]),wood.max[1],variant.supportHeight],[8,5,0])];
  }
  return boxDimensions([wood.min[0],wood.min[1],0],wood.max,['Top length','Top width','Finished height']);
}
export const partFamily=(p:Part)=>[p.name,p.stock,...p.bounds.map(v=>v.toFixed(4))].join('|');
export function partGroups(parts:Part[]){const groups=new Map<string,Part[]>();for(const p of parts){const key=partFamily(p);groups.set(key,[...(groups.get(key)||[]),p]);}return [...groups.values()];}
