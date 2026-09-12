import {THREE,buildBackyard,corrugatedGeometry,mergeByMaterial,setupDaylight,finishTexture} from './scenery.js';
import {buildFraming,memberGeometry,openingFrameGeometry} from './framing3d.js';
import {rPanelGeometry,foldedTrim,porchFascia} from './panels.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {wallPoint} from './drawing.js';
import {wallLength,ridgeHeight,WALLS} from './model.js';

function disposeGroup(group,materials=false){if(!group)return;const textures=new Set(),mats=new Set();group.traverse(o=>{o.geometry?.dispose();if(materials&&o.material)for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);for(const v of Object.values(m))if(v?.isTexture)textures.add(v);}});textures.forEach(t=>t.dispose());mats.forEach(m=>m.dispose());}
export function createHomeViewer(wrap,initial){
 let renderer;try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});}catch{return null;}
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.setSize(Math.max(1,wrap.clientWidth),Math.max(1,wrap.clientHeight),false);wrap.appendChild(renderer.domElement);
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(42,1,.1,3000),controls=new OrbitControls(camera,renderer.domElement);
 controls.enableDamping=false;controls.maxPolarAngle=Math.PI/2-.015;controls.minDistance=8;controls.maxDistance=1200;controls.enablePan=true;
 const daylight=setupDaylight(renderer,scene);
 // Tiny panel ribs are lit by their folded normals. A larger normal bias keeps
 // the building's shadow map from stippling those narrow faces when zoomed out.
 daylight.sun.shadow.normalBias=.06;
 const yard=buildBackyard({scene,renderer},{patio:false,furniture:false});
 if(yard.dressing){scene.remove(yard.dressing);disposeGroup(yard.dressing,true);}
 scene.fog=null;
 let group=null,active=true,disposed=false,frame=0,key='',s=initial,fit=1;
 const draw=()=>{if(active&&!disposed){cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(active&&!disposed)renderer.render(scene,camera);});}};
 const resize=()=>{if(wrap.clientWidth&&wrap.clientHeight){renderer.setSize(wrap.clientWidth,wrap.clientHeight,false);camera.aspect=wrap.clientWidth/wrap.clientHeight;const nextFit=Math.max(1,1.5/camera.aspect);camera.position.sub(controls.target).multiplyScalar(nextFit/fit).add(controls.target);fit=nextFit;camera.updateProjectionMatrix();draw();}};
 const observer=new ResizeObserver(resize);observer.observe(wrap);controls.addEventListener('change',draw);
 const reset=()=>{const radius=Math.hypot(s.width,s.depth,ridgeHeight(s))/2;controls.target.set(0,s.height*.5,0);camera.position.set(radius*1.8,s.height+radius*.55,radius*1.65).sub(controls.target).multiplyScalar(fit).add(controls.target);controls.update();draw();};
 function update(next,mode='shell'){
  s=next;const nextKey=JSON.stringify([s,mode]);if(key===nextKey)return;key=nextKey;
  if(group){scene.remove(group);disposeGroup(group,true);}
  const finish=finishTexture(renderer),buckets=new Map(),mat=(color,metalness=.1)=>new THREE.MeshStandardMaterial({color,metalness,roughness:metalness>.2?.48:.8,roughnessMap:finish,side:THREE.DoubleSide});
  const steel=mat(s.trimColor,.6),cee=mat('#aa864e',.65),zee=mat('#597a87',.65),roof=mat(mode==='insulation'&&s.roofInsulation!=='none'?'#d1b570':s.roofColor,.18),wall=mat(mode==='insulation'&&s.wallInsulation!=='none'?'#ddcba0':s.wallColor,.18),glass=mat('#799ba8',.35),door=mat('#e5e1d6'),concrete=mat('#c9c5b9');
  roof.roughness=.42;wall.roughness=.5;steel.roughness=.32;
  const hardware=mat('#a5afb4',.65);
  glass.roughness=.12;glass.metalness=.65;glass.roughnessMap=null;
  const add=(geo,m)=>{if(geo.index){const copy=geo.toNonIndexed();geo.dispose();geo=copy;}if(!geo.attributes.uv)geo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count*2),2));if(!buckets.has(m))buckets.set(m,[]);buckets.get(m).push(geo);};
  const beam=(a,b,m,kind='box',size=.25)=>{const geo=memberGeometry(a,b,kind==='box'?'post':kind,size);if(geo)add(geo,m);};
  const flatWall=(geo,w)=>{const a=geo.attributes.position;for(let i=0;i<a.count;i++){const [x,y,z]=wallPoint(s,w,a.getX(i),a.getY(i),a.getZ(i));a.setXYZ(i,x,y,z);}geo.computeVertexNormals();return geo;};
  const W=s.width,D=s.depth,H=s.height,R=ridgeHeight(s),framing=mode==='frame';
  const slab=new THREE.BoxGeometry(W,.15,D);slab.translate(W/2,-.08,D/2);add(slab,concrete);
  // Hidden interior members are omitted from the finished closed shell. The
  // same bounded geometry remains available in technical and open-panel views.
  for(const member of buildFraming(s,{includeMain:framing||!s.roofPanel||!s.wallPanel})){
   add(member.geometry,member.kind==='bolt'?hardware:framing&&member.kind==='cee'?cee:framing&&['zee','girt-web'].includes(member.kind)?zee:steel);
  }
  for(const w of WALLS){
   const L=wallLength(s,w),wp=(u,y)=>wallPoint(s,w,u,y,.14),openings=s.openings.filter(o=>o.wall===w);
   if(!framing&&s.wallPanel){
    // Split vertical strips at opening edges so real R-panel geometry has
    // actual holes, not doors pasted on a solid wall. No CSG or large textures.
    const xs=[0,L,...openings.flatMap(o=>[o.x,o.x+o.width])].sort((a,b)=>a-b);
    for(let i=1;i<xs.length;i++){const a=xs[i-1],b=xs[i];if(b-a<.001)continue;const blocks=openings.filter(o=>(a+b)/2>o.x&&(a+b)/2<o.x+o.width).sort((a,b)=>a.sill-b.sill);let bottom=0;
     const panel=(low,high)=>{if(high-low<=0)return;const geo=rPanelGeometry(b-a,high-low,{offset:a});geo.translate((a+b)/2,(low+high)/2,0);add(flatWall(geo,w),wall);};
     for(const o of blocks){panel(bottom,o.sill);bottom=o.sill+o.height;}panel(bottom,H);
    }
    if(['front','back'].includes(w)){const g=rPanelGeometry(L,R-H,{top:x=>Math.min(x,L-x)*s.pitch/12,breaks:[L/2]});g.translate(L/2,H+(R-H)/2,0);add(flatWall(g,w),wall);}
   }
   for(const o of openings){const y=o.sill;add(flatWall(openingFrameGeometry(o),w),steel);
    if(!framing){const geo=o.kind==='overhead'?corrugatedGeometry(o.width,o.height,{pitch:.25,amp:.025,ribAxis:'x'}):new THREE.PlaneGeometry(o.width,o.height);geo.translate(o.x+o.width/2,y+o.height/2,.02);add(flatWall(geo,w),o.kind==='window'?glass:door);
     if(o.kind==='window'){beam(wp(o.x+o.width/2,y),wp(o.x+o.width/2,y+o.height),steel,'box',.08);beam(wp(o.x,y+o.height/2),wp(o.x+o.width,y+o.height/2),steel,'box',.08);}
     if(o.kind==='door'){
      // Six shallow panels and a handle give the entry door scale.
      const inset=Math.min(.25,o.width*.12),gap=Math.min(.18,o.width*.08),pw=(o.width-2*inset-gap)/2,ph=o.height*.31,pad=o.height*.026;
      for(let row=0;row<3;row++)for(let col=0;col<2;col++){
       const x=o.x+inset+col*(pw+gap),lo=y+o.height*.035+row*ph;
       for(const [a,b] of [[[x,lo],[x+pw,lo]],[[x,lo+ph-pad],[x+pw,lo+ph-pad]],[[x,lo],[x,lo+ph-pad]],[[x+pw,lo],[x+pw,lo+ph-pad]]])
        beam(wallPoint(s,w,a[0],a[1],.0425),wallPoint(s,w,b[0],b[1],.0425),door,'box',.045);
      }
      const handleY=y+Math.min(3,o.height*.45),handleX=o.x+o.width-Math.min(.28,o.width*.15);
      beam(wallPoint(s,w,handleX,handleY,.02),wallPoint(s,w,handleX,handleY,.23),steel,'box',.06);
      beam(wallPoint(s,w,handleX,handleY,.23),wallPoint(s,w,handleX-Math.min(.22,o.width*.12),handleY,.23),steel,'box',.06);
     }
    }
   }
  }
  const roofPanel=(start,end,z0,length,m)=>{
   const run=end[0]-start[0],rise=end[1]-start[1],slope=Math.hypot(run,rise),geo=rPanelGeometry(length,slope,{offset:z0}),a=geo.attributes.position;
   for(let i=0;i<a.count;i++){const across=a.getX(i)+length/2,along=(a.getY(i)+slope/2)/slope,rib=a.getZ(i);a.setXYZ(i,start[0]+run*along-rise/slope*rib,start[1]+rise*along+run/slope*rib,z0+across);}geo.computeVertexNormals();add(geo,m);
  };
  if(!framing&&s.roofPanel){const e=s.overhang,edge=H-e*s.pitch/12;roofPanel([-e,edge],[W/2,R],-e,D+2*e,roof);roofPanel([W/2,R],[W+e,edge],-e,D+2*e,roof);const cap=foldedTrim([[-.7,.16-.7*s.pitch/12],[0,.16],[.7,.16-.7*s.pitch/12]],D+2*e);cap.translate(W/2,R,-e);add(cap,steel);
   // Rake and eave trim cover exposed sheet edges, as on a finished shell.
   for(const z of [-e,D+e]){beam([-e,edge+.04,z],[W/2,R+.04,z],steel,'box',.2);beam([W/2,R+.04,z],[W+e,edge+.04,z],steel,'box',.2);}
   for(const [x,side] of [[-e,1],[W+e,-1]]){const fascia=foldedTrim([[side*.25,.08],[0,.08],[0,-.3],[-side*.07,-.33]],D+2*e);fascia.translate(x,edge,-e);add(fascia,steel);}
  }
  if(!framing&&s.wallPanel)for(const w of WALLS){const L=wallLength(s,w);for(const u of [.065,L-.065]){const g=new THREE.PlaneGeometry(.37,H);g.translate(u,H/2,.12);add(flatWall(g,w),steel);}}
  for(const p of s.porches){const wp=(u,y,d=0)=>wallPoint(s,p.wall,u,y,d);
   if(!framing){const g=rPanelGeometry(p.width,Math.hypot(p.depth,p.depth*p.pitch/12),{offset:p.x}),a=g.attributes.position,sl=Math.hypot(p.depth,p.depth*p.pitch/12);for(let i=0;i<a.count;i++){const u=p.x+a.getX(i)+p.width/2,d=(a.getY(i)+sl/2)/sl*p.depth,rib=a.getZ(i),ratio=Math.hypot(1,p.pitch/12),y=p.height-d*p.pitch/12+rib/ratio;a.setXYZ(i,...wp(u,y,d+rib*(p.pitch/12)/ratio));}g.computeVertexNormals();add(g,roof);}
   if(!framing)for(const fascia of porchFascia(s,p)){
    const a=fascia.attributes.position;
    for(let i=0;i<a.count;i++)a.setXYZ(i,...wp(p.x+a.getX(i),a.getY(i),a.getZ(i)));
    fascia.computeVertexNormals();add(fascia,steel);
   }
  }
  // Map drawing depth to world -Z so all outside wall views preserve left/right.
  group=mergeByMaterial(buckets);group.scale.z=-1;group.position.set(-W/2,0,D/2);scene.add(group);
  for(const material of [steel,cee,zee,roof,wall,glass,door,concrete,hardware])if(!buckets.has(material))material.dispose();
  // Context house is separate, never intersecting the customer's building.
  yard.houseGrp.position.set(-W/2-55,0,-D/2-30);
  const houseBounds=new THREE.Box3().setFromObject(yard.houseGrp),leftEdge=-W/2-Math.max(0,...s.porches.filter(p=>p.wall==='left').map(p=>p.depth));
  yard.houseGrp.position.x-=Math.max(0,houseBounds.max.x-leftEdge+12);
  daylight.fit(0,H/2,0,Math.hypot(W,D,R)/2+Math.max(0,...s.porches.map(p=>p.depth)));
  resize();draw();
 }
 update(initial);reset();resize();
 const visibility=()=>{if(!document.hidden)draw();};document.addEventListener('visibilitychange',visibility);
 return {update,reset,setActive(v){active=v;if(v)resize();},destroy(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();document.removeEventListener('visibilitychange',visibility);daylight.dispose();disposeGroup(scene,true);scene.background?.dispose?.();scene.environment?.dispose?.();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
}
