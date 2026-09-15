import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildBoltedFrame} from './bolted-frame.js';
import {createPartInspector} from './part-inspector.js';
import {wallPoint} from './drawing.js';
import {wallLength} from './model.js';

// One on-demand renderer per editor. No animation loop or additional requests
// while hidden; dimension changes rebuild the model without replacing the canvas.
export function createFrameViewer(wrap,initial,{lang='en',cad=false}={}){
 const tr=(en,es)=>lang==='es'?es:en,abort=new AbortController();
 const renderer=(()=>{try{return new THREE.WebGLRenderer({antialias:true,alpha:true});}catch{return null;}})();
 if(!renderer)return null;
 renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,1,.025,4000);
 scene.add(new THREE.HemisphereLight(0xffffff,0x999999,2.1));
 for(const [x,y,z,power] of [[-25,50,15,2.7],[25,15,-20,1]]){const light=new THREE.DirectionalLight(0xffffff,power);light.position.set(x,y,z);scene.add(light);}
 const colors=['#507eaa','#b68c42','#638c78','#ad7394'];
 const sections=colors.map(color=>new THREE.MeshStandardMaterial({color,roughness:.7,metalness:.2,side:THREE.DoubleSide}));
 const hardware=new THREE.MeshStandardMaterial({color:'#abb4b8',roughness:.45,metalness:.35});
 const groundMaterial=new THREE.MeshBasicMaterial({color:'#d8d4c9',transparent:true,opacity:.35,side:THREE.DoubleSide});
 const modes=[['overall',tr('Whole frame','Estructura completa')],['front',tr('Front frame','Marco frontal')],['base',tr('Column base plate','Placa base de columna')],['knee',tr('Column joint','Unión de columna')],['ridge',tr('Roof peak joint','Unión de cumbrera')],['cee',tr('CEE connection','Conexión CEE')],['zee',tr('ZEE connection','Conexión ZEE')],['upperzee',tr('Upper ZEE connection','Conexión ZEE superior')],['endwall',tr('Endwall connection','Conexión de muro frontal / posterior')],['opening',tr('Door / window connection','Conexión de puerta / ventana')]];
 const tools=document.createElement('div');tools.className='bd-frame-tools';
 const label=document.createElement('label');label.textContent=tr('Inspect','Inspeccionar');
 const select=document.createElement('select');select.setAttribute('aria-label',tr('Inspect frame','Inspeccionar estructura'));
 for(const [value,text] of modes){const o=document.createElement('option');o.value=value;o.textContent=text;select.append(o);}label.append(select);tools.append(label);
 if(cad){
  const directions=document.createElement('div');directions.className='bd-camera-directions';directions.setAttribute('aria-label',tr('Camera direction','Dirección de cámara'));
  for(const [value,name] of [['front',tr('Front','Frente')],['back',tr('Back','Atrás')],['left',tr('Left','Izquierda')],['right',tr('Right','Derecha')],['top',tr('Top','Arriba')],['bottom',tr('Bottom','Abajo')],['fit',tr('Fit all','Ver todo')]]){
   const button=document.createElement('button');button.type='button';button.dataset.cameraView=value;button.textContent=name;
   button.addEventListener('click',()=>{if(value==='fit'){select.value='overall';reset();return;}const distance=camera.position.distanceTo(controls.target),vectors={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,.001],bottom:[0,-1,.001]};camera.position.copy(controls.target).add(new THREE.Vector3(...vectors[value]).normalize().multiplyScalar(distance));controls.update();draw();},{signal:abort.signal});directions.append(button);
  }
  tools.append(directions);
 }
 const stage=document.createElement('div');stage.className='bd-frame-stage';stage.append(renderer.domElement);
 renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label',tr('Rotate frame with arrow keys; + and − to zoom','Gira la estructura con las flechas; + y − para acercar'));
 const legend=document.createElement('div');legend.className='bd-frame-legend';
 [tr('Columns','Columnas'),tr('Rafters','Vigas'),'CEE','ZEE'].forEach((name,i)=>{const el=document.createElement('span'),dot=document.createElement('i');dot.style.background=colors[i];el.append(dot,document.createTextNode(name));legend.append(el);});
 const detail=document.createElement('p');detail.className='bd-frame-detail';detail.setAttribute('aria-live','polite');
 if(cad){const help=document.createElement('p');help.className='bd-frame-detail';help.textContent=tr('Double-click a part to orbit around it · F fits the whole frame','Haz doble clic en una pieza para girar alrededor · F muestra toda la estructura');tools.append(help);}
 const note=document.createElement('p');note.className='bd-frame-note';note.textContent=tr('Illustrative framing. Member sizes, connections and bracing require project-specific engineering.','Estructura ilustrativa. Los perfiles, conexiones y arriostramientos requieren cálculo para cada proyecto.');
 wrap.append(tools,stage,legend,detail,note);
 const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.enablePan=false;controls.rotateSpeed=.7;controls.zoomSpeed=.8;
 if(cad){controls.enablePan=true;controls.screenSpacePanning=true;controls.zoomToCursor=true;controls.mouseButtons.MIDDLE=THREE.MOUSE.PAN;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN;}
 wrap.dataset.navigation=cad?'cad':'simple';
 let active=true,disposed=false,group=null,ground=null,key='',s=initial,focus={},labels=[];
 const inspector=createPartInspector({host:stage,canvas:renderer.domElement,scene,camera,draw,lang,onFocus(box){const center=box.getCenter(new THREE.Vector3()),radius=Math.max(.6,box.getSize(new THREE.Vector3()).length());const direction=camera.position.clone().sub(controls.target).normalize();controls.target.copy(center);controls.minDistance=.15;camera.position.copy(center).addScaledVector(direction,radius*2);controls.update();draw();}});
 const world=p=>new THREE.Vector3(p[0]-s.width/2,p[1],s.depth/2-p[2]);
 function draw(){if(!active||disposed||!stage.clientWidth||!stage.clientHeight)return;camera.updateMatrixWorld();renderer.render(scene,camera);
  for(const l of labels){const p=l.point.clone().project(camera);l.el.hidden=!['overall','front'].includes(select.value)||Math.abs(p.x)>.95||Math.abs(p.y)>.94||p.z>1;if(!l.el.hidden){l.el.style.left=`${(p.x+1)*stage.clientWidth/2}px`;l.el.style.top=`${(1-p.y)*stage.clientHeight/2}px`;}}
 }
 function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;camera.zoom=Math.min(1,camera.aspect/1.5);camera.updateProjectionMatrix();draw();}
 function reset(){
  const mode=select.value,close=!['overall','front'].includes(mode),size=Math.max(s.width,s.depth,s.height),k=Math.min(1,s.width/8,s.depth/8,s.height/5);
  controls.target.copy(world(focus[mode]||focus.overall));
  const openingOffsets={front:[-2.1,1,-2.6],back:[2.1,1,2.6],right:[-2.6,1,2.1],left:[2.6,1,-2.1]};
  const offsets={base:[.8,2.3,2.6],knee:[3.3,1.8,3.3],ridge:[2.4,1.5,3.2],cee:[1.7,1.2,2.4],zee:[2.1,-.7,2.6],endwall:[.2,-.8,3.2],upperzee:[.2,-.8,3.2],opening:openingOffsets[s.openings[0]?.wall]||openingOffsets.front};
  const offset=close?new THREE.Vector3(...offsets[mode]).multiplyScalar(k):mode==='front'?new THREE.Vector3(0,size*.06,size*1.65):new THREE.Vector3(size*1.05,size*.7,size*1.3);
  camera.position.copy(controls.target).add(offset);controls.minDistance=close?k*.5:size*.3;controls.maxDistance=close?k*14:size*6;controls.minPolarAngle=cad?.001:.05;controls.maxPolarAngle=cad?Math.PI-.001:close?2.15:Math.PI/2-.025;
  if(cad){controls.minDistance=k*.15;controls.maxDistance=size*6;}
  detail.textContent=mode==='cee'?tr('Shared tab at middle rafters · two bolts per CEE end','Soporte compartido en vigas intermedias · dos pernos por extremo CEE'):mode==='zee'?tr('Tab welded to column · two diagonal ZEE-to-tab bolts','Soporte soldado a columna · dos pernos diagonales al ZEE'):mode==='knee'?tr('Bolted column-to-rafter end plate','Placa atornillada entre columna y viga'):mode==='ridge'?tr('Paired bolted end plates at the roof peak','Placas atornilladas en la cumbrera'):tr('Drag to rotate · Scroll or pinch to zoom','Arrastra para girar · Rueda o pellizca para acercar');
  wrap.dataset.focus=mode;controls.update();draw();
  if(mode==='upperzee')detail.textContent=tr('Tab welded to rafter · two bolts to the upper ZEE','Soporte soldado a viga · dos pernos al ZEE superior');
  if(mode==='endwall')detail.textContent=tr('Tabs welded to endwall columns · ZEE girts bolted to tabs','Soportes soldados a columnas intermedias · ZEE atornillados a soportes');
  if(mode==='opening')detail.textContent=tr('Channel jambs · continuous header · welded tabs · bolted girts and base anchors','Jambas de canal · dintel continuo · soportes soldados · correas atornilladas y anclas');
  if(mode==='base')detail.textContent=s.frame==='post'?tr('Welded post base · four corner anchors · dimensions require engineering','Base soldada de poste · cuatro anclas en las esquinas · medidas por calcular'):tr('Welded I-column base · four anchors between flanges · dimensions require engineering','Base soldada de columna I · cuatro anclas entre patines · medidas por calcular');
 }
 function disposeModel(){if(group){scene.remove(group);group.traverse(o=>o.geometry?.dispose());}if(ground){scene.remove(ground);ground.geometry.dispose();}labels.forEach(l=>l.el.remove());labels=[];}
 function update(next){
  // Color/insulation edits do not change the exposed frame or its camera.
  const signature=JSON.stringify([next.width,next.depth,next.height,next.pitch,next.frame,next.bay,next.roofSpacing,next.wallSpacing,next.openings,next.porches]);if(signature===key)return;
  const dimensionsChanged=!key||['width','depth','height','pitch'].some(k=>s[k]!==next[k]);key=signature;s=structuredClone(next);
  const built=buildBoltedFrame(s,{sections,hardware});disposeModel();focus=built.focus;built.group.updateMatrixWorld(true);inspector.setParts(built.group.children.filter(o=>o.isMesh),s.width,s.depth);
  // Merge repeated hardware by material for large buildings and mobile devices.
  group=new THREE.Group();const buckets=new Map();built.group.updateMatrixWorld(true);
  built.group.traverse(o=>{if(!o.isMesh)return;const geo=o.geometry.clone().applyMatrix4(o.matrixWorld);if(!buckets.has(o.material))buckets.set(o.material,[]);buckets.get(o.material).push(geo);o.geometry.dispose();});
  for(const [material,geos] of buckets){const flat=geos.map(g=>g.index?g.toNonIndexed():g),merged=mergeGeometries(flat);group.add(new THREE.Mesh(merged,material));for(const g of new Set([...geos,...flat]))g.dispose();}
  group.scale.z=-1;group.position.set(-s.width/2,0,s.depth/2);scene.add(group);
  const bounds=new THREE.Box3().setFromObject(group),extent=bounds.getSize(new THREE.Vector3());
  ground=new THREE.Mesh(new THREE.PlaneGeometry(extent.x+6,extent.z+6),groundMaterial);ground.rotation.x=-Math.PI/2;ground.position.copy(bounds.getCenter(new THREE.Vector3()));ground.position.y=-.02;scene.add(ground);
  for(const [wall,name] of [['front',tr('Front','Frente')],['back',tr('Back','Atrás')],['left',tr('Left','Izquierda')],['right',tr('Right','Derecha')]]){const el=document.createElement('span');el.className='bd-frame-label';el.textContent=name;stage.append(el);const offset=Math.max(2,...s.porches.filter(p=>p.wall===wall).map(p=>p.depth+2));labels.push({el,point:world(wallPoint(s,wall,wallLength(s,wall)/2,0,offset))});}
  for(const option of select.options)option.disabled=!focus[option.value];if(!focus[select.value])select.value='overall';
  wrap.dataset.dimensions=`${s.width}x${s.depth}x${s.height}`;wrap.dataset.ceeConnections=String(built.counts.cee);wrap.dataset.zeeConnections=String(built.counts.zee);
  if(dimensionsChanged||select.value!=='overall')reset();resize();wrap.dataset.ready='true';
 }
 controls.addEventListener('change',draw);select.addEventListener('change',reset,{signal:abort.signal});
 renderer.domElement.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','Home'].includes(event.key))return;event.preventDefault();if(event.key==='Home'){reset();return;}const offset=camera.position.clone().sub(controls.target),p=new THREE.Spherical().setFromVector3(offset);
  if(event.key==='ArrowLeft')p.theta-=.15;if(event.key==='ArrowRight')p.theta+=.15;if(event.key==='ArrowUp')p.phi-=.12;if(event.key==='ArrowDown')p.phi+=.12;if(['+','='].includes(event.key))p.radius*=.9;if(event.key==='-')p.radius*=1.1;
  p.phi=THREE.MathUtils.clamp(p.phi,controls.minPolarAngle,controls.maxPolarAngle);p.radius=THREE.MathUtils.clamp(p.radius,controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(p));controls.update();draw();
 },{signal:abort.signal});
 if(cad){
  renderer.domElement.addEventListener('dblclick',event=>{
   const bounds=renderer.domElement.getBoundingClientRect(),pointer=new THREE.Vector2((event.clientX-bounds.left)/bounds.width*2-1,1-(event.clientY-bounds.top)/bounds.height*2),ray=new THREE.Raycaster();
   ray.setFromCamera(pointer,camera);const hit=group&&ray.intersectObject(group,true)[0];if(!hit)return;
   controls.target.copy(hit.point);controls.update();draw();renderer.domElement.focus({preventScroll:true});
  },{signal:abort.signal});
  renderer.domElement.addEventListener('keydown',event=>{if(event.key.toLowerCase()==='f'){event.preventDefault();select.value='overall';reset();}},{signal:abort.signal});
 }
 const observer=new ResizeObserver(resize);observer.observe(stage);update(initial);
 return {update,reset,setActive(value){active=value;if(active)resize();},destroy(){disposed=true;inspector.destroy();abort.abort();observer.disconnect();controls.dispose();disposeModel();for(const mat of [...sections,hardware,groundMaterial])mat.dispose();renderer.dispose();renderer.forceContextLoss();wrap.replaceChildren();}};
}
