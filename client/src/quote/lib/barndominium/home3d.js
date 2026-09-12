import {THREE,buildBackyard,corrugatedGeometry,mergeByMaterial} from './scenery.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {wallPoint} from './drawing.js';
import {framePositions,wallLength,ridgeHeight,WALLS} from './model.js';

// CEE/ZEE and I profiles are schematic. Their engineering size is not inferred
// from a customer's sketch. All member paths, panels and openings use feet.
function profile(kind){
 const shape=new THREE.Shape(),d=.65,w=.32,t=.045;
 const pts=kind==='cee'?[[0,0],[w,0],[w,t],[t,t],[t,d-t],[w,d-t],[w,d],[0,d]]:
 kind==='zee'?[[0,0],[w,0],[w,d-t],[2*w-t,d-t],[2*w-t,d],[w-t,d],[w-t,t],[0,t]]:
 [[-w,-d/2],[w,-d/2],[w,-d/2+t],[t,-d/2+t],[t,d/2-t],[w,d/2-t],[w,d/2],[-w,d/2],[-w,d/2-t],[-t,d/2-t],[-t,-d/2+t],[-w,-d/2+t]];
 pts.forEach(([x,y],i)=>i?shape.lineTo(x,y):shape.moveTo(x,y));shape.closePath();return shape;
}
function disposeGroup(group,materials=false){if(!group)return;const textures=new Set(),mats=new Set();group.traverse(o=>{o.geometry?.dispose();if(materials&&o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});textures.forEach(t=>t.dispose());mats.forEach(m=>m.dispose());}
export function createHomeViewer(wrap,initial){
 let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{return null;}
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.setSize(Math.max(1,wrap.clientWidth),Math.max(1,wrap.clientHeight),false);wrap.appendChild(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,3000),controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=false;controls.maxPolarAngle=Math.PI/2-.015;controls.minDistance=8;controls.maxDistance=1200;controls.enablePan=true;
 scene.add(new THREE.HemisphereLight(0xf6f1df,0x566758,2));const sun=new THREE.DirectionalLight(0xffffff,2.5);sun.position.set(-35,70,-50);scene.add(sun);
 const yard=buildBackyard({scene,renderer},{patio:false,furniture:false});
 if(yard.dressing){scene.remove(yard.dressing);disposeGroup(yard.dressing,true);}
 scene.fog=null;
 let group=null,active=true,disposed=false,frame=0,key='',s=initial,fit=1;
 const draw=()=>{if(active&&!disposed){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(active&&!disposed)renderer.render(scene,camera);});}};
 const resize=()=>{if(wrap.clientWidth&&wrap.clientHeight){renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);camera.aspect=wrap.clientWidth/wrap.clientHeight;const nextFit=Math.max(1,1.5/camera.aspect);camera.position.sub(controls.target).multiplyScalar(nextFit/fit).add(controls.target);fit=nextFit;camera.updateProjectionMatrix();draw();}};
 const observer=new ResizeObserver(resize);observer.observe(wrap);controls.addEventListener('change',draw);
 const reset=()=>{const radius=Math.hypot(s.width,s.depth,ridgeHeight(s))/2;controls.target.set(0,s.height*.5,0);camera.position.set(radius*1.55,s.height+radius*.75,radius*1.9).sub(controls.target).multiplyScalar(fit).add(controls.target);controls.update();draw();};
 function update(next,mode='shell'){
  s=next;const nextKey=JSON.stringify([s,mode]);if(key===nextKey)return;key=nextKey;
  if(group){scene.remove(group);disposeGroup(group,true);}
  const buckets=new Map(),mat=(color,metalness=.1)=>new THREE.MeshStandardMaterial({color,metalness,roughness:.68,side:THREE.DoubleSide});
  const steel=mat(s.trimColor,.6),cee=mat('#aa864e',.65),zee=mat('#597a87',.65),roof=mat(mode==='insulation'&&s.roofInsulation!=='none'?'#d1b570':s.roofColor,.45),wall=mat(mode==='insulation'&&s.wallInsulation!=='none'?'#ddcba0':s.wallColor,.3),glass=mat('#799ba8',.35),door=mat('#e5e1d6'),concrete=mat('#c9c5b9');
  const add=(geo,m)=>{if(geo.index){const copy=geo.toNonIndexed();geo.dispose();geo=copy;}if(!geo.attributes.uv)geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count*2),2));if(!buckets.has(m))buckets.set(m,[]);buckets.get(m).push(geo);};
  const beam=(a,b,m,kind='box',size=.25)=>{
   const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),v=end.sub(start),length=v.length();if(length<.001)return;
   const geo=kind==='box'?new THREE.BoxGeometry(size,size,length):new THREE.ExtrudeGeometry(profile(kind),{depth:length,bevelEnabled:false,steps:1});
   if(kind!=='box')geo.translate(0,0,-length/2);
   geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),v.normalize()));geo.translate(...start.addScaledVector(v,length/2).toArray());add(geo,m);
  };
  const flatWall=(geo,w)=>{const a=geo.attributes.position;for(let i=0;i<a.count;i++){const [x,y,z]=wallPoint(s,w,a.getX(i),a.getY(i),a.getZ(i));a.setXYZ(i,x,y,z);}geo.computeVertexNormals();return geo;};
  const W=s.width,D=s.depth,H=s.height,R=ridgeHeight(s),framing=mode==='frame';
  const slab=new THREE.BoxGeometry(W,.15,D);slab.translate(W/2,-.08,D/2);add(slab,concrete);
  for(const z of framePositions(s)){
   for(const x of [.35,W-.35])beam([x,0,z],[x,H-1.05,z],steel,s.frame==='ibeam'?'ibeam':'box',.5);
   beam([.35,H-1.05,z],[W/2,R-1.05,z],steel,'ibeam');beam([W/2,R-1.05,z],[W-.35,H-1.05,z],steel,'ibeam');
  }
  const rows=Math.ceil(W/2*Math.hypot(1,s.pitch/12)/s.roofSpacing);
  for(let i=0;i<=rows;i++)for(const side of [0,1]){const x=side?W-i*W/2/rows:i*W/2/rows,y=H+Math.min(x,W-x)*s.pitch/12-.8;beam([x,y,0],[x,y,D],cee,'cee');}
  for(const w of WALLS){
   const L=wallLength(s,w),wp=(u,y)=>wallPoint(s,w,u,y),girt=(u,y)=>wallPoint(s,w,u,y-.7,-.7),openings=s.openings.filter(o=>o.wall===w);
   const count=Math.ceil(H/s.wallSpacing);
   for(let i=1;i<=count;i++){const y=i*H/count;let x=0;for(const o of openings.filter(o=>y>o.sill&&y<o.sill+o.height).sort((a,b)=>a.x-b.x)){beam(girt(x,y),girt(o.x,y),zee,'zee');x=o.x+o.width;}beam(girt(x,y),girt(L,y),zee,'zee');}
   if(['front','back'].includes(w))for(let y=H+s.wallSpacing;y<R;y+=s.wallSpacing){const inset=(y-H)*12/s.pitch;beam(girt(inset,y),girt(L-inset,y),zee,'zee');}
   if(!framing&&s.wallPanel){
    // Split vertical strips at opening edges so real corrugated geometry has
    // actual holes, not doors pasted on a solid wall. No CSG or large textures.
    const xs=[0,L,...openings.flatMap(o=>[o.x,o.x+o.width])].sort((a,b)=>a-b);
    for(let i=1;i<xs.length;i++){const a=xs[i-1],b=xs[i];if(b-a<.001)continue;const blocks=openings.filter(o=>(a+b)/2>o.x&&(a+b)/2<o.x+o.width).sort((a,b)=>a.sill-b.sill);let bottom=0;
     const panel=(low,high)=>{if(high-low<=0)return;const geo=corrugatedGeometry(b-a,high-low,{pitch:.75,amp:.035});geo.translate((a+b)/2,(low+high)/2,0);add(flatWall(geo,w),wall);};
     for(const o of blocks){panel(bottom,o.sill);bottom=o.sill+o.height;}panel(bottom,H);
    }
    if(['front','back'].includes(w)){const shape=new THREE.Shape();shape.moveTo(0,H);shape.lineTo(L/2,R);shape.lineTo(L,H);shape.closePath();add(flatWall(new THREE.ShapeGeometry(shape),w),wall);}
   }
   for(const o of openings){const y=o.sill;beam(wp(o.x,y),wp(o.x,y+o.height),steel);beam(wp(o.x+o.width,y),wp(o.x+o.width,y+o.height),steel);beam(wp(o.x,y+o.height),wp(o.x+o.width,y+o.height),steel);if(o.kind==='window')beam(wp(o.x,y),wp(o.x+o.width,y),steel);
    if(!framing){const geo=new THREE.PlaneGeometry(o.width,o.height);geo.translate(o.x+o.width/2,y+o.height/2,.02);add(flatWall(geo,w),o.kind==='window'?glass:door);
     if(o.kind==='window'){beam(wp(o.x+o.width/2,y),wp(o.x+o.width/2,y+o.height),steel,'box',.08);beam(wp(o.x,y+o.height/2),wp(o.x+o.width,y+o.height/2),steel,'box',.08);}
     if(o.kind==='overhead')for(let h=1;h<o.height;h++)beam(wp(o.x,y+h),wp(o.x+o.width,y+h),steel,'box',.035);
    }
   }
  }
  const roofPanel=(start,end,z0,length,m)=>{
   const run=end[0]-start[0],rise=end[1]-start[1],slope=Math.hypot(run,rise),geo=corrugatedGeometry(length,slope,{pitch:.75,amp:.035}),a=geo.attributes.position;
   for(let i=0;i<a.count;i++){const across=a.getX(i)+length/2,along=(a.getY(i)+slope/2)/slope,rib=a.getZ(i);a.setXYZ(i,start[0]+run*along,start[1]+rise*along+rib,z0+across);}geo.computeVertexNormals();add(geo,m);
  };
  if(!framing&&s.roofPanel){const e=s.overhang,edge=H-e*s.pitch/12;roofPanel([-e,edge],[W/2,R],-e,D+2*e,roof);roofPanel([W/2,R],[W+e,edge],-e,D+2*e,roof);beam([W/2,R+.05,-e],[W/2,R+.05,D+e],steel,'box',.16);}
  for(const p of s.porches){const n=Math.ceil(p.width/10),outer=p.height-p.depth*p.pitch/12,wp=(u,y,d=0)=>wallPoint(s,p.wall,u,y,d);for(let i=0;i<=n;i++){const u=p.x+i*p.width/n;beam(wp(u,0,p.depth),wp(u,outer,p.depth),steel,'box',.35);beam(wp(u,p.height),wp(u,outer,p.depth),steel,'cee');}beam(wp(p.x,outer,p.depth),wp(p.x+p.width,outer,p.depth),steel,'ibeam');
   const c=Math.ceil(p.depth/Math.max(1,s.roofSpacing));for(let i=0;i<=c;i++){const d=i*p.depth/c,y=p.height-d*p.pitch/12;beam(wp(p.x,y,d),wp(p.x+p.width,y,d),cee,'cee');}
   if(!framing){const g=corrugatedGeometry(p.width,Math.hypot(p.depth,p.depth*p.pitch/12),{pitch:.75,amp:.035}),a=g.attributes.position,sl=Math.hypot(p.depth,p.depth*p.pitch/12);for(let i=0;i<a.count;i++){const u=p.x+a.getX(i)+p.width/2,d=(a.getY(i)+sl/2)/sl*p.depth,y=p.height-d*p.pitch/12+a.getZ(i);a.setXYZ(i,...wp(u,y,d));}g.computeVertexNormals();add(g,roof);}
  }
  // Map drawing depth to world -Z so all outside wall views preserve left/right.
  group=mergeByMaterial(buckets);group.scale.z=-1;group.position.set(-W/2,0,D/2);scene.add(group);
  // Context house is separate, never intersecting the customer's building.
  yard.houseGrp.position.set(-W/2-55,0,-D/2-30);
  resize();draw();
 }
 update(initial);reset();resize();
 const visibility=()=>{if(!document.hidden)draw();};document.addEventListener('visibilitychange',visibility);
 return {update,reset,setActive(v){active=v;if(v)resize();},destroy(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();document.removeEventListener('visibilitychange',visibility);disposeGroup(scene,true);scene.background?.dispose?.();scene.environment?.dispose?.();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
