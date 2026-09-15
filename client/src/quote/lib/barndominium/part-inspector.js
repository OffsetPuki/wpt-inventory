import * as THREE from 'three';

const names={
 'primary-column':'Primary I-column','endwall-column':'Endwall I-column','column-base':'Column base plate',
 'cee-rafter-tab':'CEE-to-rafter tab','upper-girt-rafter':'Upper ZEE-to-rafter tab','upper-girt-seat':'Upper ZEE seat',
 'endwall-primary-web':'Endwall ZEE tab','column-girt-web':'Column ZEE tab','endwall-rafter-cap':'Sloped column cap plate',
 'girt-jamb':'ZEE-to-jamb tab','header-jamb':'Header-to-jamb tab','sill-jamb':'Sill-to-jamb tab','jamb-base':'Jamb base connection','header-tie':'Garage header tie'
};
const num=n=>Number(n.toFixed(3)).toString();
// Fractions describe the current geometry; rounding never changes the model.
export function fractionalInches(value){
 if(!Number.isFinite(value)||value<0)return 'Not specified';
 const ticks=Math.round(value*16),whole=Math.floor(ticks/16);let numerator=ticks%16,denominator=16;
 while(numerator&&numerator%2===0){numerator/=2;denominator/=2;}
 const fraction=numerator?`${numerator}/${denominator}`:'';
 const text=whole?`${whole}${fraction?' '+fraction:''}`:fraction||'0';
 return `${Math.abs(value-ticks/16)>1e-6?'≈ ':''}${text} in`;
}
export function describePart(mesh){
 const info=mesh.geometry.userData.part||{},connection=mesh.userData.connection||'',kind=mesh.userData.memberKind||'';
 const weld=connection.includes('weld')||kind==='weld'||info.name==='Weld';
 const name=weld?'Weld':info.name==='Bolt assembly'?'Bolt assembly':names[connection]||info.name||({cee:'CEE member',zee:'ZEE wall girt',jamb:'Opening jamb',header:'Opening header',sill:'Window sill'}[kind])||'Steel connection part';
 const rows=[['Material',info.material||(weld?'Weld metal · filler not specified':'Steel · grade not specified')]];
 if(info.designation)rows.push(['Catalog section (preview)',info.designation],['Nominal weight',`${info.weightPerFoot} lb/ft`]);
 if(info.section){const [d,b,tw,tf]=info.section;rows.push(['Modeled section',`${fractionalInches(d)} deep × ${fractionalInches(b)} flange`]);if(info.gauge)rows.push(['Web / flange thickness',`${info.gauge} ga (${fractionalInches(tw)})`]);else rows.push(['Web thickness',fractionalInches(tw)],['Flange thickness',fractionalInches(tf)]);}
 if(info.profile)rows.push(['Modeled channel profile',info.profile.map(fractionalInches).join(' × ')]);
 const thickness=info.thickness??(info.dimensions?Math.min(...info.dimensions):null);
 if(thickness)rows.push(['Modeled thickness',fractionalInches(thickness)]);
 if(info.dimensions)rows.push(['Modeled plate dimensions',info.dimensions.map(fractionalInches).join(' × ')]);
 if(info.diameter)rows.push(['Modeled diameter',fractionalInches(info.diameter)]);
 if(info.grip)rows.push(['Modeled grip',fractionalInches(info.grip)],['Bolt grade / purchase length','Not specified']);
 if(info.length)rows.push(['Modeled length',fractionalInches(info.length*12)]);
 if(info.weightPerFoot&&info.length)rows.push(['Approx. member weight',`${Math.round(info.length*info.weightPerFoot)} lb · excludes plates and hardware`]);
 if(info.designation)rows.push(['Section selection','Preview only · capacity not verified']);
 if(weld)rows.push(['Weld size / specification','Not specified · visual illustration']);
 if(!info.section&&!info.profile&&!info.dimensions&&!info.diameter&&!weld){
  mesh.geometry.computeBoundingBox();const size=mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld).getSize(new THREE.Vector3());
  rows.push(['Model envelope (X × Y × Z)',size.toArray().map(n=>fractionalInches(n*12)).join(' × ')],['Section / plate specification','Not specified']);
 }
 if(mesh.userData.attachment)rows.push(['Attachment',mesh.userData.attachment]);
 if(mesh.userData.wall)rows.push(['Wall',mesh.userData.wall]);
 return {name,rows,catalogUrl:info.catalogUrl};
}

// Picking uses the original individual solids; the visible model stays batched.
export function createPartInspector({host,canvas,scene,camera,draw,onFocus,lang='en'}){
 const tr=(en,es)=>lang==='es'?es:en,abort=new AbortController(),pickMaterial=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
 const panel=document.createElement('details');panel.className='bd-part-inspector';
 const summary=document.createElement('summary');summary.textContent=tr('Materials & sizes','Materiales y medidas');panel.append(summary);
 const body=document.createElement('div');body.className='bd-part-body';
 const hint=document.createElement('p');hint.textContent=tr('Click a part, or choose a type below. Drag still rotates the view.','Haz clic en una pieza o elige un tipo. Arrastra para girar.');
 const select=document.createElement('select');select.setAttribute('aria-label',tr('Part type','Tipo de pieza'));
 const nav=document.createElement('div');nav.className='bd-part-nav';const prev=document.createElement('button'),next=document.createElement('button'),count=document.createElement('span');
 prev.type=next.type='button';prev.textContent=tr('Previous','Anterior');next.textContent=tr('Next','Siguiente');const zoom=document.createElement('button');zoom.type='button';zoom.textContent=tr('Zoom to part','Acercar a pieza');nav.append(prev,count,next,zoom);
 const content=document.createElement('div');content.className='bd-part-info';content.setAttribute('aria-live','polite');
 const note=document.createElement('p');note.className='bd-part-note';note.textContent=tr('≈ means rounded to the nearest 1/16 inch. Preview dimensions, not a fabrication or purchasing schedule. Grades and unspecified sizes need project-specific selection.','≈ indica redondeo a 1/16 de pulgada. Medidas del modelo, no una lista de fabricación o compra. Los grados y medidas no definidos deben seleccionarse para el proyecto.');
 body.append(hint,select,nav,content,note);panel.append(body);host.append(panel);
 let parts=[],groups=new Map(),selected=null,highlight=null,down=null;
 function clearHighlight(){if(highlight){scene.remove(highlight);highlight.geometry.dispose();highlight.material.dispose();highlight=null;}}
 function show(part){
  selected=part;clearHighlight();content.replaceChildren();if(!part){content.textContent=tr('Expose the frame to inspect its parts.','Muestra la estructura para inspeccionar sus piezas.');count.textContent='';return;}
  select.value=part.description.name;const list=groups.get(select.value),index=list.indexOf(part);count.textContent=tr('Piece ','Pieza ')+`${index+1} / ${list.length}`;
  const title=document.createElement('strong');title.textContent=part.description.name;const dl=document.createElement('dl');
  for(const [label,value] of part.description.rows){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;dl.append(dt,dd);}content.append(title,dl);
  if(part.description.catalogUrl){const a=document.createElement('a');a.href=part.description.catalogUrl;a.target='_blank';a.rel='noopener noreferrer';a.textContent=tr('Manufacturer section catalog ↗','Catálogo de perfiles del fabricante ↗');content.append(a);}
  if(panel.open){const box=new THREE.Box3().setFromObject(part.mesh);highlight=new THREE.Box3Helper(box,0xd57a16);highlight.material.depthTest=false;highlight.renderOrder=10;scene.add(highlight);}draw();
 }
 function clear(){clearHighlight();parts.forEach(p=>p.mesh.geometry.dispose());parts=[];groups=new Map();selected=null;}
 function setParts(meshes,width,depth){
  clear();const transform=new THREE.Matrix4().makeScale(1,1,-1);transform.setPosition(-width/2,0,depth/2);
  for(const source of meshes){
   const description=describePart(source),mesh=new THREE.Mesh(source.geometry.clone(),pickMaterial);
   mesh.matrixAutoUpdate=false;mesh.matrix.copy(transform).multiply(source.matrixWorld);mesh.updateMatrixWorld(true);
   const part={mesh,description};parts.push(part);if(!groups.has(description.name))groups.set(description.name,[]);groups.get(description.name).push(part);
  }
  select.replaceChildren();for(const name of [...groups.keys()].sort()){const o=document.createElement('option');o.value=name;o.textContent=name;select.append(o);}
  select.disabled=!parts.length;prev.disabled=next.disabled=zoom.disabled=!parts.length;show(groups.get(select.value)?.[0]);
 }
 zoom.addEventListener('click',()=>{if(selected)onFocus?.(new THREE.Box3().setFromObject(selected.mesh));},{signal:abort.signal});
 panel.addEventListener('toggle',()=>{show(selected);draw();},{signal:abort.signal});
 select.addEventListener('change',()=>show(groups.get(select.value)?.[0]),{signal:abort.signal});
 for(const [button,delta] of [[prev,-1],[next,1]])button.addEventListener('click',()=>{const list=groups.get(select.value);if(list?.length)show(list[(list.indexOf(selected)+delta+list.length)%list.length]);},{signal:abort.signal});
 canvas.addEventListener('pointerdown',e=>{down=e.button===0?{x:e.clientX,y:e.clientY,id:e.pointerId}:null;},{signal:abort.signal});
 canvas.addEventListener('pointerup',e=>{
  const start=down;down=null;if(!panel.open||!start||start.id!==e.pointerId||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;
  const bounds=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();camera.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2((e.clientX-bounds.left)/bounds.width*2-1,1-(e.clientY-bounds.top)/bounds.height*2),camera);
  const hit=ray.intersectObjects(parts.map(p=>p.mesh),false)[0];if(hit)show(parts.find(p=>p.mesh===hit.object));
 },{signal:abort.signal});
 return {setParts,destroy(){abort.abort();clear();pickMaterial.dispose();panel.remove();}};
}
