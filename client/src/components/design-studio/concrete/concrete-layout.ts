import {concreteKeys,feet,sectionArea,type ConcreteEstimate,type ConcreteKey} from '@shared/concrete-estimate';
import reference from './reference-scene.json';
export type Point=[number,number];
export function concreteLayout(data:ConcreteEstimate){
 const driveWidth=feet(data.sections.drive.width)||17.5,driveLength=feet(data.sections.drive.length)||34;
 const origins:Record<ConcreteKey,Point>={drive:[0,0],rv:[driveWidth,-driveLength],walk:[0,-4.5],trash:[-36,2],sidewalk:[21.5,-5]};
 return concreteKeys.map(key=>{
  const s=data.sections[key];let polygons:Point[][]=[];
  if(sectionArea(s)===null){const o:any=reference.objects.find(o=>o.group==='new'&&(key==='drive'?o.name.startsWith('Driveway'):key==='rv'?o.name.startsWith('RV pad'):key==='walk'?o.name.startsWith('Tapered'):key==='trash'?o.name.startsWith('Left trash'):o.name.startsWith('Right-side walkway')));polygons=[o.points||[[o.center[0]-o.size[0]/2,o.center[2]-o.size[2]/2],[o.center[0]+o.size[0]/2,o.center[2]-o.size[2]/2],[o.center[0]+o.size[0]/2,o.center[2]+o.size[2]/2],[o.center[0]-o.size[0]/2,o.center[2]+o.size[2]/2]]];}
  else{const l=feet(s.length)!,w=feet(s.width)!,end=s.shape==='taper'?feet(s.endWidth)!:w;polygons=[[[0,0],[w,0],[end,l],[0,l]]];if(s.shape==='two-rectangles')polygons.push([[-feet(s.returnLength)!,0],[0,0],[0,feet(s.returnWidth)!],[-feet(s.returnLength)!,feet(s.returnWidth)!]]);polygons=polygons.map(p=>p.map(([x,z])=>[origins[key][0]+x*(key==='walk'||key==='trash'?-1:1),origins[key][1]+z*(key==='drive'||key==='walk'?-1:1)]));}
  const all=polygons.flat(),minX=Math.min(...all.map(p=>p[0])),maxX=Math.max(...all.map(p=>p[0])),minZ=Math.min(...all.map(p=>p[1])),maxZ=Math.max(...all.map(p=>p[1]));
  return {key,polygons,center:[(minX+maxX)/2,(minZ+maxZ)/2] as Point,bounds:[minX,maxX,minZ,maxZ],included:s.included};
 });
}
