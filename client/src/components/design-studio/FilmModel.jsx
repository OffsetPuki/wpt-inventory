import {useEffect,useRef,useState} from 'react';
import {loadStudioModel} from './studio-model';
import {secondaryBtn,inputCls} from '@/lib/ui-styles';
import {Play,Pause,RotateCcw,SkipBack,SkipForward} from 'lucide-react';
import {createDetailRender} from './detail-render';

export default function FilmModel({revision,hiddenParts}){
 const hiddenRef=useRef(hiddenParts);hiddenRef.current=hiddenParts;
 const host=useRef(null),control=useRef(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0),[playing,setPlaying]=useState(false),[clock,setClock]=useState(0),[steps,setSteps]=useState([]),[duration,setDuration]=useState(1),[speed,setSpeed]=useState(1);
 useEffect(()=>{control.current?.refresh();},[hiddenParts]);
 useEffect(()=>{
  let stopped=false,destroy;const abort=new AbortController();setReady(false);setError('');setPlaying(false);setSpeed(1);
  (async()=>{
   const [T,{model,lib},{OrbitControls},{RoomEnvironment}]=await Promise.all([import('three'),loadStudioModel(revision),import('three/addons/controls/OrbitControls.js'),import('three/addons/environments/RoomEnvironment.js')]);
   if(stopped)return;
   const process=lib.createProcess(model),scene=new T.Scene();scene.background=new T.Color('#edf0eb');scene.add(model.root);
   const selectable=[],overridden=new Map();model.root.traverse(o=>{if(o.userData.shopInstanceId)selectable.push(o);});
   const applyPose=t=>{for(const [o,v] of overridden)o.visible=v;overridden.clear();process.apply(t);const hidden=new Set(hiddenRef.current);for(const o of selectable)if(hidden.has(o.userData.shopInstanceId)){overridden.set(o,o.visible);o.visible=false;}};
   const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'default'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;host.current.appendChild(renderer.domElement);
   const camera=new T.PerspectiveCamera(36,1,.015,100),orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=true;orbit.minDistance=.18;orbit.maxDistance=23;orbit.maxPolarAngle=Math.PI/2-.005;
   const env=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer),lightmap=pmrem.fromScene(env,.03);scene.environment=lightmap.texture;scene.environmentIntensity=.72;env.dispose();pmrem.dispose();
   scene.add(new T.HemisphereLight('#eef5ff','#78877a',1.25));const sun=new T.DirectionalLight('#fff5df',2.4);sun.position.set(-3,7,4);scene.add(sun);
   const floor=new T.Mesh(new T.PlaneGeometry(50,50),new T.MeshStandardMaterial({color:'#e6ebe3',roughness:.9}));floor.rotation.x=-Math.PI/2;floor.position.y=-.004;scene.add(floor);
   const draw=createDetailRender(renderer,model.root);
   let raf=0,time=lib.PROCESS_STEPS.find(s=>s.id==='cutFar').start,play=false,last=performance.now(),ui=0,rate=1,started=false,inView=false;
   const request=()=>{if(!raf&&!stopped&&!document.hidden)raf=requestAnimationFrame(render);};
   const apply=()=>{applyPose(time);host.current.dataset.ready='true';host.current.dataset.time=time.toFixed(2);setClock(time);request();};
   const views={overall:[[7.3,6,8.1],[-.28,.58,-.65]],supply:[[0,6.5,-6],[0,.6,-3.68]],top:[[0,17.5,-.749],[0,.6,-.75]],mounts:[[3.55,.84,-3.28],[3.05,.744,-2.96]],pipe:[[3.48,1.08,-3.63],[3.015,.855,-3.34]],braces:[[3.72,.90,3.70],[2.99,.64,3.22]],drive:[[.30,1.18,3.92],[0,.948,3.505]]};
   const view=name=>{const [p,t]=views[name]||views.overall;camera.position.set(...p);orbit.target.set(...t);const factor=Math.max(1,(name==='overall'||name==='supply'?1.35:.9)/camera.aspect);camera.position.sub(orbit.target).multiplyScalar(factor).add(orbit.target);orbit.update();request();};
   function render(now){raf=0;if(play&&now-last<1000/30){request();return;}if(play){time=Math.min(lib.PROCESS_DURATION,time+Math.min((now-last)/1000,.1)*rate);applyPose(time);host.current.dataset.time=time.toFixed(2);if(now-ui>150){setClock(time);ui=now;}if(time===lib.PROCESS_DURATION){play=false;setPlaying(false);setClock(time);}}last=now;const moving=orbit.update();if(inView)draw(scene,camera);if(play||moving)request();}
   const seek=t=>{play=false;setPlaying(false);time=Math.max(0,Math.min(lib.PROCESS_DURATION,t));started=true;last=performance.now();apply();};
   control.current={view,seek,refresh:apply,setRate(value){rate=value;},restart(){seek(0);},toggle(){if(!started||time===lib.PROCESS_DURATION)time=0;started=true;play=!play;setPlaying(play);last=performance.now();request();}};
   const resize=new ResizeObserver(()=>{if(!host.current)return;const w=host.current.clientWidth,h=host.current.clientHeight;if(!w||!h)return;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,1.25,Math.sqrt(900000/(w*h))));renderer.setSize(w,h);request();});resize.observe(host.current);
   orbit.addEventListener('change',request);
   const visibility=()=>{last=performance.now();if(document.hidden){cancelAnimationFrame(raf);raf=0;}else request();};document.addEventListener('visibilitychange',visibility);
   const intersection=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;if(inView)request();});intersection.observe(host.current);
   renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();if(stopped)return;play=false;setPlaying(false);setError('The 3D view paused. Reopen it below.');});
   apply();camera.aspect=host.current.clientWidth/host.current.clientHeight;view('overall');setSteps(lib.PROCESS_STEPS);setDuration(lib.PROCESS_DURATION);setReady(true);
   destroy=()=>{cancelAnimationFrame(raf);resize.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',visibility);orbit.dispose();const gs=new Set(),ms=new Set();scene.traverse(o=>{if(o.geometry)gs.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:o.material?[o.material]:[])ms.add(m);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());lightmap.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();control.current=null;};
  })().catch(e=>{if(!stopped)setError(e.message||'Could not open the table model.');});
  return()=>{stopped=true;abort.abort();destroy?.();};
 },[retry,revision]);
 const current=steps.find(s=>clock>=s.start&&clock<s.end)||steps.at(-1);
 return <section aria-label="Current table model" className="space-y-3">
  <div className="fs-player" aria-label="Animation controls"><div className="fs-player-top"><button disabled={!ready} className="fs-primary" onClick={()=>control.current?.toggle()}>{playing?<Pause size={17}/>:<Play size={17}/>} {playing?'Pause animation':'Play animation'}</button><button disabled={!ready} aria-label="Restart animation" onClick={()=>control.current?.restart()}><RotateCcw size={16}/></button><button disabled={!ready||!current||current.index===0} aria-label="Previous animation step" onClick={()=>control.current?.seek(steps[Math.max(0,current.index-1)].start)}><SkipBack size={16}/></button><button disabled={!ready||!current||current.index===steps.length-1} aria-label="Next animation step" onClick={()=>control.current?.seek(steps[Math.min(steps.length-1,current.index+1)].start)}><SkipForward size={16}/></button><label className="fs-unit-label">Speed<select aria-label="Animation speed" value={speed} onChange={e=>{setSpeed(Number(e.target.value));control.current?.setRate(Number(e.target.value));}}>{[.5,1,2,4].map(v=><option value={v} key={v}>{v}×</option>)}</select></label></div><div className="fs-player-title">{current?String(current.index+1).padStart(2,'0')+' · '+current.title:'Opening animation…'}</div>{current?.description&&<p className="fs-muted">{current.description}</p>}<input aria-label="Table process time" disabled={!ready} type="range" min="0" max={duration} step=".1" value={clock} onChange={e=>control.current?.seek(Number(e.target.value))}/><div className="fs-player-meta"><span>{Math.floor(clock/60)}:{String(Math.floor(clock%60)).padStart(2,'0')} / {Math.floor(duration/60)}:{String(Math.floor(duration%60)).padStart(2,'0')}</span><span>{steps.length} steps · Drag the timeline to any action</span></div><label className="fs-actions">Jump to step<select aria-label="Table process step" disabled={!ready} value={current?.id||''} onChange={e=>control.current?.seek(steps.find(s=>s.id===e.target.value).start)}>{steps.map(s=><option key={s.id} value={s.id}>{s.index+1}. {s.title}</option>)}</select></label></div>
  <div className="flex flex-wrap gap-2">{[['overall','Whole table'],['supply','Six rolls'],['mounts','Support angles'],['pipe','Fixed pipe'],['braces','Brace plates'],['drive','Turnbuckle'],['top','Top']].map(([id,label])=><button key={id} disabled={!ready} className={secondaryBtn} onClick={()=>control.current?.view(id)}>{label}</button>)}</div>
  {error&&<div role="alert" className="rounded-lg border border-destructive p-4"><p>{error}</p><button className={secondaryBtn} onClick={()=>setRetry(n=>n+1)}>Reopen model</button></div>}
  {!ready&&!error&&<p role="status">Loading the current 6 × 6 m model…</p>}
  <div ref={host} aria-label="Interactive table; drag to rotate and scroll to zoom" style={{height:'min(65vh,650px)',minHeight:350,background:'#edf0eb',borderRadius:12,overflow:'hidden'}}/>
  <p className="text-xs text-muted-foreground">Drag to rotate · Scroll to zoom · Right-drag to pan</p>

 </section>;
}
