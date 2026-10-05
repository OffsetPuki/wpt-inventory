import * as T from 'three';

// Photo reconstruction, metres. These envelopes are for the preview, not a
// fabrication release. No measured dimensions are inferred from perspective.
export const PLANT_REVISION='plant-photo-construction-2026-10-04';
export const PLANT_FACTS={
  tableSize:6, tableEdgeHalf:3.006, pipeOD:.073025, pipeWall:.0051562, rackPipes:3,
  references:['IMG_0716','IMG_0717','IMG_0718','IMG_0719','IMG_0720','IMG_0721','IMG_0722'],
  known:'Confirmed: 6 × 6 m table, PVC pipes, six staggered film rolls, tape behind both film rows, four upper wheels in a zigzag, and two separate wheels on the vertical end guides touching the table sides. Guide pipe: 2½″ Schedule 40 from your earlier specification.',
  unconfirmed:'Roll width, overlap, tape width, rack spacing, extrusion sections, wheel positions and bracket hole centers need field measurements. Preview sizes are not cutting dimensions.',
};
export const PLANT_STEPS=[
  {id:'setup',title:'Film in front · tape at the back',description:'Six film rolls on two PVC pipes. The tape pipe sits behind both film rows, furthest from the table.',start:0,end:4},
  {id:'feed',title:'Bring the strips together',description:'Tape feeds from the rear pipe, underneath the film rolls and onto the back of the five overlaps. Routing clearances are illustrative.',start:4,end:9},
  {id:'draw',title:'Pull film and apply tape',description:'As the bar moves, the film and tape unwind together. Travel, roll sizes and routing are illustrative.',start:9,end:22},
  {id:'hold',title:'Joined film on the table',description:'Five taped seams join the six strips. Exact overlap, tape contact and clamping details need field measurements.',start:22,end:28},
];

export function createPlantFilmModel(){
 const root=new T.Group();root.name='Plant film stretching setup';root.userData.revision=PLANT_REVISION;
 const parts=[],geometries=new Map();
 const mat={
  aluminum:new T.MeshStandardMaterial({color:'#c7cdd0',metalness:.65,roughness:.37}),
  steel:new T.MeshStandardMaterial({color:'#313a3b',metalness:.45,roughness:.55}),
  brown:new T.MeshStandardMaterial({color:'#635147',metalness:.3,roughness:.65}),
  dark:new T.MeshStandardMaterial({color:'#343736',metalness:.12,roughness:.65}),
  cream:new T.MeshStandardMaterial({color:'#dddccf',roughness:.85}),
  rubber:new T.MeshStandardMaterial({color:'#202725',roughness:.9}),
  white:new T.MeshStandardMaterial({color:'#ecebe0',roughness:.4,metalness:.03}),
  blue:new T.MeshStandardMaterial({color:'#376195',roughness:.65}),
  gold:new T.MeshStandardMaterial({color:'#b19353',metalness:.2,roughness:.65}),
  tape:new T.MeshStandardMaterial({color:'#d0c9bb',roughness:.85}),
  film:new T.MeshPhysicalMaterial({color:'#edd576',transparent:true,opacity:.24,roughness:.26,side:T.DoubleSide,depthWrite:false}),
 };
 // A repeating dot texture represents the perforated light worktop without
 // thousands of tiny meshes. Only its upper face uses this material.
 const dotPixels=new Uint8Array(64*64*4);
 for(let y=0;y<64;y++)for(let x=0;x<64;x++){
  const k=(y*64+x)*4,d=Math.hypot(x-31.5,y-31.5),shade=d<2.5?90:d<3.3?173:235;
  dotPixels.set([shade,shade,Math.round(shade*.95),255],k);
 }
 const dotTexture=new T.DataTexture(dotPixels,64,64);dotTexture.colorSpace=T.SRGBColorSpace;
 dotTexture.wrapS=dotTexture.wrapT=T.RepeatWrapping;dotTexture.repeat.set(240,60);
 dotTexture.generateMipmaps=true;dotTexture.minFilter=T.LinearMipmapLinearFilter;dotTexture.magFilter=T.LinearFilter;dotTexture.needsUpdate=true;
 mat.perforated=mat.cream.clone();mat.perforated.map=dotTexture;
 const geo=(key,create)=>{if(!geometries.has(key))geometries.set(key,create());return geometries.get(key);};
 function mesh(g,m,p,parent){const o=new T.Mesh(g,m);o.position.set(...p);parent.add(o);return o;}
 function box(size,p,m,parent){return mesh(geo('box:'+size.join(','),()=>new T.BoxGeometry(...size)),m,p,parent);}
 function cyl(radius,length,p,m,parent,axis='y'){
  const o=mesh(geo(`cyl:${radius}:${length}`,()=>new T.CylinderGeometry(radius,radius,length,20)),m,p,parent);
  if(axis==='x')o.rotation.z=Math.PI/2;if(axis==='z')o.rotation.x=Math.PI/2;return o;
 }
 function part(id,name,category,dimensions,note,parent=root){
  const group=new T.Group();group.name=name;group.userData.plantPartId=id;parent.add(group);
  parts.push({id,name,category,dimensions,note,group});return group;
 }
 // Concave T slots are geometry, so the open extrusion ends and grooves stay
 // visible from all angles without stacking decorative strips along the bar.
 function profile(length,p,parent,axis='x',width=.08,height=.04,tall=false){
  const geometry=geo(`slot:${width}:${height}:${length}`,()=>{
   const w=width/2,h=height/2,s=.0032,inner=.006,d=.0085,lip=.0025,cells=width>.06?[-.02,.02]:[0];
   const points=[[-w,-h]];
   for(const x of cells)points.push([x-s,-h],[x-s,-h+lip],[x-inner,-h+lip],[x-inner,-h+d],[x+inner,-h+d],[x+inner,-h+lip],[x+s,-h+lip],[x+s,-h]);
   points.push([w,-h],[w,-s],[w-lip,-s],[w-lip,-inner],[w-d,-inner],[w-d,inner],[w-lip,inner],[w-lip,s],[w,s],[w,h]);
   for(const x of [...cells].reverse())points.push([x+s,h],[x+s,h-lip],[x+inner,h-lip],[x+inner,h-d],[x-inner,h-d],[x-inner,h-lip],[x-s,h-lip],[x-s,h]);
   points.push([-w,h],[-w,s],[-w+lip,s],[-w+lip,inner],[-w+d,inner],[-w+d,-inner],[-w+lip,-inner],[-w+lip,-s],[-w,-s]);
   const shape=new T.Shape(points.map(q=>new T.Vector2(...q)));shape.closePath();
   for(const x of cells){
    const hole=new T.Path(),r=.010;
    hole.moveTo(x-r,-.004);hole.lineTo(x-r,.004);hole.quadraticCurveTo(x-r,r,x-.004,r);hole.lineTo(x+.004,r);hole.quadraticCurveTo(x+r,r,x+r,.004);hole.lineTo(x+r,-.004);hole.quadraticCurveTo(x+r,-r,x+.004,-r);hole.lineTo(x-.004,-r);hole.quadraticCurveTo(x-r,-r,x-r,-.004);shape.holes.push(hole);
    for(const dx of [-.013,.013])for(const dy of [-.013,.013]){const core=new T.Path();core.absarc(x+dx,dy,.0028,0,Math.PI*2,true);shape.holes.push(core);}
   }
   const g=new T.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,curveSegments:8});g.translate(0,0,-length/2);return g;
  });
  const o=mesh(geometry,mat.aluminum,p,parent);if(axis==='x')o.rotation.y=Math.PI/2;if(axis==='y')o.rotation.x=-Math.PI/2;if(tall)o.rotateZ(Math.PI/2);o.userData.extrusion={width,height,length,axis,tall};return o;
 }
 function pipe(length,p,parent,od=PLANT_FACTS.pipeOD,wall=PLANT_FACTS.pipeWall,material=mat.white){
  const g=geo(`pipe:${od}:${wall}:${length}`,()=>{
   const shape=new T.Shape();shape.absarc(0,0,od/2,0,Math.PI*2,false);
   const hole=new T.Path();hole.absarc(0,0,od/2-wall,0,Math.PI*2,true);shape.holes.push(hole);
   const g=new T.ExtrudeGeometry(shape,{depth:length,bevelEnabled:false,curveSegments:32});g.translate(0,0,-length/2);return g;
  });const o=mesh(g,material,p,parent);o.rotation.y=Math.PI/2;return o;
 }
 function bolt(p,parent,axis='z'){
  cyl(.0085,.002,p,mat.aluminum,parent,axis);
  const head=mesh(geo('socket-head',()=>new T.CylinderGeometry(.006,.006,.005,6)),mat.aluminum,p,parent);
  if(axis==='x')head.rotation.z=Math.PI/2;if(axis==='z')head.rotation.x=Math.PI/2;
 }
 function strap(a,b,width,thickness,parent,material=mat.aluminum){
  const start=new T.Vector3(...a),end=new T.Vector3(...b),o=box([width,start.distanceTo(end),thickness],start.clone().add(end).multiplyScalar(.5).toArray(),material,parent);
  o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize());return o;
 }
 function angle(p,parent,reverse=false){
  box([.075,.006,.055],[p[0],p[1],p[2]],mat.aluminum,parent);
  box([.075,.055,.006],[p[0],p[1]+.025,p[2]+(reverse?1:-1)*.025],mat.aluminum,parent);
  bolt([p[0],p[1]+.025,p[2]+(reverse?1:-1)*.03],parent);
 }
 const table=part('table','Existing work table','Table',[6,.9,6],PLANT_FACTS.known+' Height and supporting frame are approximate.');
 for(const z of [-2.93,0,2.93]){
  box([6,.1,.055],[0,.765,z],mat.brown,table);
  for(const x of [-2.9,0,2.9]){
   box([.065,.72,.065],[x,.395,z],mat.steel,table);
   box([.09,.008,.09],[x,.019,z],mat.steel,table);
   cyl(.015,.025,[x,.035,z],mat.aluminum,table);
  }
 }
 for(const x of [-2.94,0,2.94])box([.055,.1,6],[x,.765,0],mat.brown,table);
 for(const x of [-2.9,2.9])for(const z of [-2.93,0]){
  strap([x,.10,z],[x,.71,z+2.93],.025,.004,table);
  bolt([x,.12,z+.08],table,'x');bolt([x,.69,z+2.85],table,'x');
 }
 const feet=part('table-foot-angles','Table foot mounting angles','Table',[5.98,.08,.10],'Low bolted angle plates at the table legs, visible in IMG_0722. Individual dimensions and hole positions are estimated.');
 for(const x of [-2.9,0,2.9]){
  box([.18,.006,.10],[x,.008,-2.93],mat.aluminum,feet);
  box([.18,.08,.004],[x,.046,-2.98],mat.aluminum,feet);
  for(const dx of [-.06,.06])bolt([x+dx,.032,-2.983],feet);
 }
 for(let row=0;row<4;row++){
  const panel=part('panel-'+row,row===0?'Light work-surface panel':'Dark work-surface panel '+row,'Table',[6,.06,1.498],'Panel proportions and surface thickness estimated from photos.');
  box([6,.06,1.498],[0,.87,-2.25+row*1.5],row===0?[mat.cream,mat.cream,mat.perforated,mat.cream,mat.cream,mat.cream]:mat.dark,panel);
  if(row>0)box([6,.0008,.012],[0,.9005,-3+row*1.5],mat.tape,panel);
 }
 // Outer stainless-colored table edge and narrow side trough seen in IMG_0720.
 const edge=part('edge','Table edge and side channel','Table',[6.08,.14,.12],'Existing edge channel; measure its actual section and mounting faces.');
 box([6.08,.12,.006],[0,.82,-3.015],mat.aluminum,edge);
 box([6.08,.006,.12],[0,.762,-3.07],mat.aluminum,edge);
 for(const x of [-3.003,3.003])box([.006,.06,6],[x,.87,0],mat.aluminum,edge);
 box([6,.06,.006],[0,.87,3.003],mat.aluminum,edge);
 for(const x of [-1.5,0,1.5]){
  box([.16,.065,.004],[x,.818,-3.021],mat.aluminum,edge);
  for(const dx of [-.056,0,.056])for(const y of [.798,.838])bolt([x+dx,y,-3.026],edge);
 }
 const fixed=part('fixed-rail','Upright table-side aluminum rail','Table-side supports',[6.16,.08,.04],'The lower rail stands on its narrow edge, with two slots on the vertical face, as in IMG_0720. Section and cut length are approximate.');
 profile(6.16,[0,.794,-3.24],fixed,'x',.08,.04,true);
 for(const x of [-2.92,0,2.92]){
  const arm=part('arm-'+x,'Bolted pipe-support outrigger','Table-side supports',[.04,.08,.70],'Upright extrusion with bolted angle connections, based on the photographed arrangement.');
  profile(.70,[x,.714,-3.31],arm,'z',.08,.04,true);angle([x,.758,-3.025],arm);
  box([.07,.13,.005],[x,.672,-2.963],mat.aluminum,arm);
  for(const y of [.625,.70])bolt([x,y,-2.969],arm);
  angle([x,.756,-3.235],arm,true);
  const support=part('pipe-support-'+x,'Upright plate for the guide pipe','Table-side supports',[.12,.125,.005],'Open round bore shown in the photos. Bore diameter and hole locations require measurement.');
  const shape=new T.Shape([new T.Vector2(-.06,0),new T.Vector2(.06,0),new T.Vector2(.06,.125),new T.Vector2(-.06,.125)]);
  const hole=new T.Path();hole.absarc(0,.075,.039,0,Math.PI*2,true);shape.holes.push(hole);
  const g=geo('guide-support',()=>new T.ExtrudeGeometry(shape,{depth:.005,bevelEnabled:false,curveSegments:20}));
  const plate=mesh(g,mat.aluminum,[x,.754,-3.55],support);plate.rotation.y=Math.PI/2;
  box([.07,.005,.12],[x,.753,-3.55],mat.aluminum,support);
  bolt([x+.006,.772,-3.595],support,'x');bolt([x+.006,.772,-3.505],support,'x');
 }
 const guide=part('guide-pipe','Table-side PVC guide pipe','Table-side supports',[6.28,PLANT_FACTS.pipeOD,PLANT_FACTS.pipeOD],'PVC confirmed. 2½″ Schedule 40 from your earlier specification. Cut length and bracket details require measurement. Shown in its installed position.');
 pipe(6.28,[0,.829,-3.55],guide);
 for(const x of [-2.82,2.82]){
  pipe(.09,[x,.829,-3.55],guide,.084,.0045);
  pipe(.003,[x+.035,.829,-3.55],guide,.0844,.001,mat.blue);
 }
 // A freestanding, three-pipe extrusion rack with a clear aisle beside the table.
 const rackZ=-4.65,pipeZ=[rackZ,rackZ+.235,rackZ-.235],joinZ=rackZ+.57;
 const rack=part('rack-frame','Separate aluminum pipe rack','Supply rack',[6.4,.88,.72],'Separate rectangular extrusion stand. Gap, height, member sections and length are approximate.');
 for(const x of [-3.14,0,3.14]){
  for(const z of [rackZ-.34,rackZ+.34])profile(.81,[x,.465,z],rack,'y',.04,.04);
  profile(.8,[x,.06,rackZ],rack,'z',.04,.04);profile(.72,[x,.88,rackZ],rack,'z',.04,.04);
  for(const z of [rackZ-.32,rackZ+.32])angle([x,.08,z],rack);
 }
 for(const z of [rackZ-.34,rackZ+.34])profile(6.32,[0,.86,z],rack,'x',.04,.04);
 for(let i=0;i<3;i++){
  const z=pipeZ[i];
  const holder=part('rack-pipe-'+i,'PVC pipe '+(i+1)+(i===2?' · tape at the back':' · staggered film rolls'),'Supply rack',[6.6,.073025,.073025],'PVC confirmed. '+(i===2?'Tape pipe is behind both film rows, furthest from the table.':'Three staggered film rolls on this pipe.')+' Rack pipe diameter and cut length require measurement.');
  pipe(6.6,[0,.936,z],holder);
  for(const x of [-2.75,2.75]){
   pipe(.085,[x,.936,z],holder,.084,.0045);
   const band=pipe(.003,[x+.032,.936,z],holder,.0844,.001,mat.blue);band.name='Blue coupling witness mark';
  }
  for(const x of [-3.14,3.14]){
   const collar=part(`rack-collar-${i}-${x}`,'Pipe retaining plate','Supply rack',[.008,.1,.105],'Black end plates around the pipes, as photographed. Confirm the bore and fixing arrangement.');
   const shape=new T.Shape([new T.Vector2(-.0525,-.05),new T.Vector2(.0525,-.05),new T.Vector2(.0525,.05),new T.Vector2(-.0525,.05)]);
   const hole=new T.Path();hole.absarc(0,0,.038,0,Math.PI*2,true);shape.holes.push(hole);
   const g=geo('rack-collar',()=>new T.ExtrudeGeometry(shape,{depth:.008,bevelEnabled:false,curveSegments:16}));
   const o=mesh(g,i===2?mat.aluminum:mat.steel,[x,.936,z],collar);o.rotation.y=Math.PI/2;
   for(const dz of [-.042,.042])bolt([x+.008,.896,z+dz],collar,'x');
  }
 }
 const carriage=new T.Group();carriage.name='Wheeled holding bar';root.add(carriage);
 const beam=part('holding-bar','Long aluminum holding bar','Moving bar',[6.24,.04,.08],'Long T-slot aluminum bar from the photos. Extrusion section and cut length require measurement.',carriage);
 profile(6.24,[0,1.006,0],beam);
 const barPlate=part('bar-top-plate','Small top mounting plate','Moving bar',[.12,.005,.065],'Flat mounting plate visible on top of the holding bar. Purpose, size and screw centers require field confirmation.',carriage);
 box([.12,.005,.065],[0,1.0285,0],mat.aluminum,barPlate);
 for(const x of [-.045,.045])for(const z of [-.020,.020])bolt([x,1.033,z],barPlate,'y');
 const guideWheels=[],guideRadius=.03175/2,guideWidth=.0079375;
 for(const x of [-3.05,3.05]){
  const side=Math.sign(x),label=side>0?'Right':'Left',suffix=label.toLowerCase(),dropX=side*3.08,wheelX=side*(PLANT_FACTS.tableEdgeHalf+guideRadius);
  const drop=part('bar-drop-'+x,'Vertical end guide','Moving bar',[.08,.42,.04],'Vertical extrusion with a side-contact guide wheel. Position and length estimated.',carriage);
  profile(.42,[dropX,.776,0],drop,'y');angle([dropX,.976,.015],drop);
  const wheel=part('side-guide-wheel-'+suffix,label+' side guide wheel','Moving bar',[.03175,guideWidth,.03175],'Touches the vertical table edge and rolls along it to guide the bar. Preview uses the earlier purchased 1¼″ OD × 5/16″ wide wheel; confirm its final mounting.',carriage);
  wheel.position.set(wheelX,.854,0);
  const tire=pipe(guideWidth,[0,0,0],wheel,.03175,guideRadius-.00635,mat.white);tire.rotation.set(-Math.PI/2,0,0);
  const bearing=pipe(guideWidth,[0,0,0],wheel,.0127,.003175,mat.aluminum);bearing.rotation.set(-Math.PI/2,0,0);
  box([.003,.0004,.009],[0,guideWidth/2+.0002,.0105],mat.dark,wheel);
  guideWheels.push({group:wheel,side,radius:guideRadius});
  const mount=part('side-guide-mount-'+suffix,label+' guide-wheel bracket and axle','Moving bar',[.038,.041,.05],'Estimated bracket on the inside of the vertical end guide, with a vertical ¼″ axle. Mounting holes and fastener lengths need measurement.',carriage);
  box([.034,.005,.05],[side*3.024,.873,0],mat.aluminum,mount);
  box([.006,.035,.05],[side*3.037,.883,0],mat.aluminum,mount);
  cyl(.003175,.034,[wheelX,.86,0],mat.aluminum,mount);
  cyl(.0055,.004,[wheelX,.879,0],mat.aluminum,mount);
  cyl(.0055,.004,[wheelX,.846,0],mat.aluminum,mount);
 }
 for(const [i,x] of [-2.83,-.94,.94,2.83].entries()){
  const side=i%2===0?-1:1;
  const g=part(`caster-${x}-${side}`,'Upper wheel '+(i+1)+' and outrigger','Moving bar',[.13,.106,.25],'One of four upper wheels, alternating sides of the bar in a zigzag. The two table-edge guide wheels are separate. Confirm wheel size and spacing.',carriage);
  profile(.23,[x,.986,side*.155],g,'z');
  // The photo shows a vertical wraparound connector with a bolt in each face,
  // not a horizontal shelf between the bar and its short wheel arm.
  const corner=new T.Group();corner.position.set(x+.04,.997,side*.042);if(side<0)corner.rotation.y=Math.PI;g.add(corner);
  const plateShape=new T.Shape();plateShape.moveTo(0,-.025);plateShape.lineTo(.058,-.025);plateShape.lineTo(.058,.014);plateShape.quadraticCurveTo(.058,.025,.047,.025);plateShape.lineTo(.011,.025);plateShape.quadraticCurveTo(0,.025,0,.014);plateShape.closePath();
  const plateGeo=geo('wheel-corner-plate',()=>new T.ExtrudeGeometry(plateShape,{depth:.004,bevelEnabled:false,curveSegments:6}));
  mesh(plateGeo,mat.aluminum,[0,0,0],corner);
  const returnPlate=mesh(plateGeo,mat.aluminum,[0,0,0],corner);returnPlate.rotation.y=-Math.PI/2;
  bolt([.035,0,.006],corner);bolt([-.006,0,.035],corner,'x');
  box([.052,.004,.052],[x,.964,side*.225],mat.aluminum,g);
  cyl(.016,.010,[x,.957,side*.225],mat.aluminum,g);
  const forkShape=new T.Shape();forkShape.moveTo(-.022,.022);forkShape.lineTo(.022,.022);forkShape.lineTo(.012,-.012);forkShape.quadraticCurveTo(0,-.020,-.012,-.012);forkShape.closePath();
  const forkGeo=geo('caster-fork',()=>new T.ExtrudeGeometry(forkShape,{depth:.003,bevelEnabled:false,curveSegments:6}));
  for(const dx of [-.014,.011]){const fork=mesh(forkGeo,mat.aluminum,[x+dx,.933,side*.225],g);fork.rotation.y=Math.PI/2;}
  const tire=cyl(.025,.018,[x,.925,side*.225],mat.rubber,g,'x');tire.userData.upperWheel=true;
  cyl(.009,.021,[x,.925,side*.225],mat.aluminum,g,'x');
  cyl(.004,.034,[x,.925,side*.225],mat.aluminum,g,'x');
 }
 // Loose toggle clamp from IMG_0720/0718; no invented fitted clamp mechanism.
 const toggle=part('loose-clamp','Loose hold-down toggle clamp','Loose hardware',[.18,.07,.07],'One loose red-handled toggle clamp is on the worktop in the photos. Its final mounting is not shown.');
 box([.07,.005,.055],[1.85,.904,-2.35],mat.aluminum,toggle);
 box([.01,.043,.022],[1.85,.926,-2.35],mat.aluminum,toggle);
 box([.1,.013,.021],[1.80,.954,-2.35],mat.aluminum,toggle);
 cyl(.004,.04,[1.765,.931,-2.35],mat.aluminum,toggle);cyl(.01,.015,[1.765,.91,-2.35],mat.rubber,toggle);
 const gripMat=new T.MeshStandardMaterial({color:'#bc4939',roughness:.7});
 const grip=box([.09,.017,.019],[1.906,.944,-2.35],gripMat,toggle);grip.rotation.z=-.3;
 // Six staggered film rolls and five tape lanes, confirmed by the operator.
 // Widths, overlap and diameters remain illustrative until measured on site.
 const filmWidth=1.04,pitch=.98,spinners=[],webs=[],tapes=[];
 const filmMat2=mat.film.clone();filmMat2.color.set('#c6e3da');filmMat2.opacity=.31;
 const woundFilm=new T.MeshStandardMaterial({color:'#e7e3c4',roughness:.4});
 const tapeMat=new T.MeshStandardMaterial({color:'#c4a05e',side:T.DoubleSide,roughness:.55});
 function ribbon(width,x,points,material){
  const coords=[];for(let i=0;i<points.length-1;i++){const [y,z]=points[i],[ny,nz]=points[i+1];coords.push(x-width/2,y,z,x+width/2,y,z,x+width/2,ny,nz,x-width/2,y,z,x+width/2,ny,nz,x-width/2,ny,nz);}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(coords,3));g.computeVertexNormals();
  const o=new T.Mesh(g,material);o.renderOrder=2;o.userData.filmWeb=true;root.add(o);return o;
 }
 const fixedRoutes=[];
 for(let i=0;i<6;i++){
  const x=(i-2.5)*pitch,z=pipeZ[i%2];
  const g=part('film-roll-'+i,'Film roll '+(i+1)+' · row '+(i%2+1),'Film and tape',[filmWidth,.23,.23],'One of six film rolls, staggered across two PVC pipes. Width, diameter and overlap are illustrative.');g.position.set(x,.936,z);
  pipe(filmWidth,[0,0,0],g,.23,.073,woundFilm);pipe(filmWidth+.018,[0,0,0],g,.084,.004,mat.cream);
  box([filmWidth,.002,.012],[0,.115,0],mat.tape,g);spinners.push({group:g,radius:.115,direction:1});
  const clearance=i%2?[]:[[1.055,z+.12],[1.055,pipeZ[1]+.13]];
  fixedRoutes.push(ribbon(filmWidth,x,[[1.051,z],...clearance,[1.024,joinZ],[.869,-3.55],[.905,-2.97]],i%2?filmMat2:mat.film));
  const web=new T.Mesh(new T.PlaneGeometry(filmWidth,1),i%2?filmMat2:mat.film);web.rotation.x=-Math.PI/2;web.position.set(x,.906+i*.00015,0);web.renderOrder=2;web.userData.filmWeb=true;root.add(web);webs.push(web);
 }
 for(let i=0;i<5;i++){
  const x=(i-2)*pitch,z=pipeZ[2];
  const g=part('tape-roll-'+i,'Overlap tape '+(i+1)+' · rear pipe','Film and tape',[.048,.17,.17],'Tape on the third PVC pipe, behind both film rows, joins the back of adjacent film strips. Five overlaps across six strips; tape width and contact geometry need confirmation.');g.position.set(x,.936,z);
  pipe(.048,[0,0,0],g,.17,.043,tapeMat);pipe(.052,[0,0,0],g,.084,.004,mat.cream);box([.048,.002,.01],[0,.085,0],mat.dark,g);spinners.push({group:g,radius:.085,direction:-1});
  const route=ribbon(.048,x,[[.851,z],[.790,z+.1],[.790,pipeZ[1]+.165],[1.0232,joinZ],[.8682,-3.55],[.9042,-2.97]],tapeMat);
  route.userData.tapeFeed=true;fixedRoutes.push(route);
  const seam=new T.Mesh(new T.PlaneGeometry(.048,1),tapeMat);seam.rotation.x=-Math.PI/2;seam.position.set(x,.904,0);seam.userData.filmWeb=true;root.add(seam);tapes.push(seam);
 }
 function pose(seconds){
  const q=T.MathUtils.smoothstep(seconds,9,22),z=-2.72+5.43*q;
  carriage.position.z=z;const length=z+2.97;
  for(const web of [...webs,...tapes]){web.scale.y=length;web.position.z=-2.97+length/2;}
  for(const spinner of spinners)spinner.group.rotation.x=spinner.direction*q*5.43/spinner.radius;
  for(const wheel of guideWheels)wheel.group.rotation.y=wheel.side*q*5.43/wheel.radius;
  root.updateMatrixWorld(true);
  return {progress:q,barZ:z,step:PLANT_STEPS.find(s=>seconds<s.end)||PLANT_STEPS.at(-1)};
 }
 pose(0);
 const pickable=[];root.traverse(o=>{if(o.isMesh&&!o.userData.filmWeb){let p=o;while(p&&!p.userData.plantPartId)p=p.parent;if(p){o.userData.plantPartId=p.userData.plantPartId;pickable.push(o);}}});
 return {root,parts,pickable,pose,duration:28,materials:mat,carriage,webs:[...webs,...tapes,...fixedRoutes]};
}
