import {useEffect,useRef,useState} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {Play,Pause,RotateCcw,Eye,EyeOff} from 'lucide-react';
import {createPlantFilmModel,PLANT_FACTS,PLANT_STEPS} from './plant-film-model';
import {useUnit} from './MeasurementContext';
import {dimension} from './fractions';

const VIEWS=[['overall','Whole setup'],['photo','Plant photo angle'],['rack','Film & tape rack'],['bar','Wheeled bar'],['guides','Side guide wheels'],['supports','Pipe supports'],['top','Top view']];
export default function PlantFilmModel({inspect=false}){
 const host=useRef(null),control=useRef(null),inspectRef=useRef(inspect),unit=useUnit();inspectRef.current=inspect;
 const [ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[parts,setParts]=useState([]),[selected,setSelected]=useState(''),[hidden,setHidden]=useState([]),[playing,setPlaying]=useState(false),[time,setTime]=useState(0),[view,setView]=useState('overall');
 useEffect(()=>{control.current?.select('');control.current?.pause();},[inspect]);
 useEffect(()=>{
  let disposed=false,cleanup=()=>{};setReady(false);setError('');setSelected('');setHidden([]);setPlaying(false);setTime(0);
  try{
   const el=host.current,renderer=new T.WebGLRenderer({antialias:true,powerPreference:'default'});el.appendChild(renderer.domElement);
   const model=createPlantFilmModel(),scene=new T.Scene();scene.background=new T.Color('#eaf0ed');scene.add(model.root);
   renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;
   renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
   model.root.traverse(o=>{if(o.isMesh&&!o.userData.filmWeb){o.castShadow=true;o.receiveShadow=true;}});
   const camera=new T.PerspectiveCamera(38,1,.015,100),orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.minDistance=.12;orbit.maxDistance=45;orbit.maxPolarAngle=Math.PI*.52;
   const environment=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer),env=pmrem.fromScene(environment,.04);scene.environment=env.texture;scene.environmentIntensity=.65;environment.dispose();pmrem.dispose();
   scene.add(new T.HemisphereLight('#f5faff','#8e9a90',1));const light=new T.DirectionalLight('#fff5df',2.4);light.position.set(-4,9,-2);light.castShadow=true;light.shadow.mapSize.set(1024,1024);Object.assign(light.shadow.camera,{left:-7,right:7,top:7,bottom:-7,near:.1,far:25});light.shadow.bias=-.0001;light.shadow.normalBias=.009;scene.add(light);
   const floor=new T.Mesh(new T.PlaneGeometry(100,100),new T.MeshStandardMaterial({color:'#dbe3dc',roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.005;floor.receiveShadow=true;scene.add(floor);
   const outline=new T.Box3Helper(new T.Box3(),0x168876);outline.material.depthTest=false;outline.renderOrder=10;outline.visible=false;scene.add(outline);
   const map=new Map(model.parts.map(p=>[p.id,p])),ray=new T.Raycaster(),pointer=new T.Vector2(),hiddenIds=new Set();
   let raf=0,play=false,clock=0,last=performance.now(),lastUi=0,inView=true,selection='',hover='',preset='overall',down=null;
   function request(){if(!raf&&!disposed&&!document.hidden&&inView)raf=requestAnimationFrame(render);}
   function render(now){raf=0;if(disposed)return;const delta=Math.min((now-last)/1000,.08);last=now;
    if(play){clock=Math.min(28,clock+delta);model.pose(clock);if(now-lastUi>120){setTime(clock);lastUi=now;}if(clock===28){play=false;setPlaying(false);setTime(clock);}}
    el.dataset.time=clock.toFixed(2);const moving=orbit.update();renderer.render(scene,camera);if(play||moving)request();
   }
   function bounds(objects){const b=new T.Box3();for(const o of objects)b.expandByObject(o);return b;}
   function fit(b,direction){
    const center=b.getCenter(new T.Vector3()),dir=direction.normalize(),right=new T.Vector3().crossVectors(camera.up,dir).normalize(),up=new T.Vector3().crossVectors(dir,right);
    const tanY=Math.tan(T.MathUtils.degToRad(camera.fov/2)),tanX=tanY*camera.aspect;let distance=.15;
    for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const p=new T.Vector3(x,y,z).sub(center),depth=p.dot(dir);distance=Math.max(distance,depth+Math.abs(p.dot(right))/tanX,depth+Math.abs(p.dot(up))/tanY);}
    distance*=1.16;orbit.target.copy(center);camera.position.copy(center).add(dir.multiplyScalar(distance));camera.near=Math.max(.003,distance/2000);camera.far=Math.max(100,distance*4);camera.updateProjectionMatrix();orbit.update();request();
   }
   function frame(){
    if(selection){fit(bounds([map.get(selection).group]),new T.Vector3(1,.7,1));return;}
    let targets=model.parts,dir=new T.Vector3(1,.85,-1.3);
    if(preset==='rack'){targets=targets.filter(p=>['Supply rack','Film and tape'].includes(p.category));dir.set(.16,1.9,-.9);}
    if(preset==='photo'){targets=targets.filter(p=>['Supply rack','Moving bar','Table-side supports'].includes(p.category));dir.set(-1,.40,-.27);}
    if(preset==='bar'){targets=targets.filter(p=>p.id==='caster-2.83-1'||p.id==='bar-drop-3.05');dir.set(1,.7,1);}
    if(preset==='guides'){targets=targets.filter(p=>p.id==='side-guide-wheel-right'||p.id==='side-guide-mount-right');dir.set(.75,.5,1.5);}
    if(preset==='supports'){targets=targets.filter(p=>p.id==='pipe-support-2.92'||p.id==='arm-2.92');dir.set(1,.8,-1);}
    if(preset==='top')dir.set(0,1,-.001);
    fit(bounds(targets.map(p=>p.group)),dir);
   }
   function refresh(){for(const p of model.parts)p.group.visible=!hiddenIds.has(p.id)&&(!selection||p.id===selection);for(const web of model.webs)web.visible=!selection;outline.visible=false;el.dataset.selectedPart=selection;el.dataset.hiddenCount=String(hiddenIds.size);request();}
   function pause(){play=false;setPlaying(false);}
   function select(id){pause();selection=map.has(id)?id:'';if(selection)hiddenIds.delete(selection);setSelected(selection);setHidden([...hiddenIds]);refresh();frame();}
   control.current={select,pause,view(id){select('');preset=id;setView(id);frame();},hide(){if(!selection)return;hiddenIds.add(selection);selection='';setSelected('');setHidden([...hiddenIds]);refresh();frame();},showAll(){hiddenIds.clear();setHidden([]);refresh();},seek(t){pause();clock=Math.max(0,Math.min(28,t));model.pose(clock);setTime(clock);refresh();},toggle(){if(clock===28)clock=0;play=!play;setPlaying(play);last=performance.now();request();}};
   function resize(){const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,1.25,Math.sqrt(900000/(w*h))));renderer.setSize(w,h);frame();}
   const ro=new ResizeObserver(resize);ro.observe(el);resize();
   const io=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;last=performance.now();if(inView)request();else{cancelAnimationFrame(raf);raf=0;}});io.observe(el);
   function visibility(){last=performance.now();if(document.hidden){cancelAnimationFrame(raf);raf=0;}else request();}document.addEventListener('visibilitychange',visibility);orbit.addEventListener('change',request);
   function hit(e){const r=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);ray.setFromCamera(pointer,camera);return ray.intersectObjects(model.pickable.filter(o=>map.get(o.userData.plantPartId).group.visible),false)[0]?.object.userData.plantPartId||'';}
   function move(e){if(!inspectRef.current||selection||down)return;const id=hit(e);if(id===hover)return;hover=id;renderer.domElement.style.cursor=id?'pointer':'grab';outline.visible=!!id;if(id)outline.box.setFromObject(map.get(id).group);request();}
   function pointerDown(e){down={x:e.clientX,y:e.clientY};}
   function pointerUp(e){if(inspectRef.current&&down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5){const id=hit(e);if(id)select(id);}down=null;}
   function leave(){down=null;hover='';outline.visible=false;request();}
   function contextLost(e){e.preventDefault();pause();setReady(false);setError('The 3D view paused. Reopen it to continue.');}
   const canvas=renderer.domElement;canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerdown',pointerDown);canvas.addEventListener('pointerup',pointerUp);canvas.addEventListener('pointerleave',leave);canvas.addEventListener('webglcontextlost',contextLost);
   el.dataset.ready='true';setParts(model.parts.map(({group,...p})=>p));setReady(true);refresh();request();
   cleanup=()=>{cancelAnimationFrame(raf);ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',visibility);orbit.dispose();canvas.removeEventListener('webglcontextlost',contextLost);const gs=new Set(),ms=new Set(),textures=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])ms.add(m);});gs.forEach(g=>g.dispose());ms.forEach(m=>{if(m.map)textures.add(m.map);m.dispose();});textures.forEach(t=>t.dispose());env.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();control.current=null;delete el.dataset.ready;};
  }catch(e){setError(e.message||'Could not open the plant preview.');}
  return()=>{disposed=true;cleanup();};
 },[retry]);
 const part=parts.find(p=>p.id===selected),step=PLANT_STEPS.find(s=>time<s.end)||PLANT_STEPS.at(-1);
 return <section aria-label="Plant film setup" className="plant-model">
  <div className="plant-summary"><span><b>6 × 6 m</b> work table</span><span><b>6 film rolls</b> staggered on 2 pipes</span><span><b>5 tape seams</b> from the rear pipe</span></div>
  <div className="fs-actions" aria-label="Plant camera views">{VIEWS.map(([id,label])=><button key={id} disabled={!ready} aria-pressed={view===id&&!selected} onClick={()=>control.current?.view(id)}>{label}</button>)}</div>
  {inspect&&<div className="plant-inspect"><label className="fs-unit-label">Choose a part<select aria-label="Choose plant part" value={selected} disabled={!ready} onChange={e=>control.current?.select(e.target.value)}><option value="">Hover and click a part in the model</option>{[...new Set(parts.map(p=>p.category))].map(category=><optgroup key={category} label={category}>{parts.filter(p=>p.category===category).map(p=><option key={p.id} value={p.id}>{p.name}{hidden.includes(p.id)?' (hidden)':''}</option>)}</optgroup>)}</select></label><div className="fs-actions">{selected&&<><button onClick={()=>control.current?.select('')}><Eye size={15}/>Back to all parts</button><button onClick={()=>control.current?.hide()}><EyeOff size={15}/>Hide this part</button></>}{hidden.length>0&&<button onClick={()=>control.current?.showAll()}>Show all ({hidden.length} hidden)</button>}</div></div>}
  {error&&<div role="alert" className="fs-notice">{error} <button onClick={()=>setRetry(n=>n+1)}>Reopen model</button></div>}
  {!ready&&!error&&<p role="status">Opening the plant setup…</p>}
  <div className="plant-canvas" ref={host} aria-label="Interactive plant model" data-selected-part=""/>
  <div className="plant-caption"><span>{selected?'Isolated part · drag to rotate':inspect?'Hover to highlight · click to isolate':'Drag to rotate · scroll to zoom'}</span><span>Photo-based layout · dimensions provisional</span></div>
  {part&&<article aria-label="Selected plant part" className="plant-part"><div><span className="fs-eyebrow">{part.category}</span><h3>{part.name}</h3><p>{part.note}</p></div><dl className="fs-dimensions">{part.dimensions.map((n,i)=><div key={i}><dt>{['Length','Height','Depth'][i]}</dt><dd>{dimension(n*1000,unit)}</dd><small>Preview envelope · approximate</small></div>)}</dl><p className="fs-notice">Field measurements are needed before making a cutting or drilling drawing for this plant part. Drawings under “Earlier bolted design” belong to that earlier design.</p></article>}
  {!inspect&&<div className="fs-player" aria-label="Plant animation controls"><div className="fs-player-top"><button disabled={!ready} className="fs-primary" onClick={()=>control.current?.toggle()}>{playing?<Pause size={16}/>:<Play size={16}/>} {playing?'Pause animation':'Play animation'}</button><button disabled={!ready} onClick={()=>control.current?.seek(0)}><RotateCcw size={16}/>Restart</button><label className="fs-unit-label">Step<select aria-label="Plant process step" value={step.id} onChange={e=>control.current?.seek(PLANT_STEPS.find(s=>s.id===e.target.value).start)}>{PLANT_STEPS.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label></div><div className="fs-player-title">{step.title}</div><p className="fs-muted">{step.description}</p><input aria-label="Plant process time" type="range" disabled={!ready} min="0" max="28" step=".1" value={time} onChange={e=>control.current?.seek(Number(e.target.value))}/><div className="fs-player-meta"><span>{Math.floor(time)} / 28 seconds</span><span>Illustrative sequence · not machine timing</span></div></div>}
  <details className="plant-notes"><summary>What is confirmed and what needs measuring</summary><p>{PLANT_FACTS.known}</p><p>{PLANT_FACTS.unconfirmed}</p><p>Based on your seven plant photos, IMG_0716–IMG_0722, and your roll-and-tape instructions.</p></details>
 </section>;
}
