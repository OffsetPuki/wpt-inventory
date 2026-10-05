import {useEffect,useRef,useState} from 'react';
import {format,modelDimensions} from './walnut-dimensions';

export default function WalnutModel({parts,selected,isolate,showTop,hiddenParts,onSelect,variant,unit,dimensions,dimensionMode}){
  const host=useRef(null),control=useRef(null),latest=useRef({selected,isolate,showTop,hiddenParts,onSelect,variant,unit,dimensions,dimensionMode});
  latest.current={selected,isolate,showTop,hiddenParts,onSelect,variant,unit,dimensions,dimensionMode};
  const [error,setError]=useState(''),[overlay,setOverlay]=useState({width:1,height:1,items:[]});
  useEffect(()=>{control.current?.apply();},[selected,isolate,showTop,hiddenParts,variant,unit,dimensions,dimensionMode]);
  useEffect(()=>{
    let stopped=false,cleanup;setError('');
    (async()=>{
      const [T,{OrbitControls}]=await Promise.all([import('three'),import('three/addons/controls/OrbitControls.js')]);
      if(stopped)return;
      const scene=new T.Scene();scene.background=new T.Color('#eef1ed');
      const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
      renderer.domElement.tabIndex=0;renderer.domElement.setAttribute('aria-label','Walnut frame: drag to rotate, scroll to zoom, click a part');
      host.current.appendChild(renderer.domElement);
      const camera=new T.OrthographicCamera(-80,80,60,-60,.01,3000);
      const orbit=new OrbitControls(camera,renderer.domElement);orbit.enableDamping=false;orbit.minZoom=.2;orbit.maxZoom=30;
      scene.add(new T.HemisphereLight(0xffffff,0x606b64,2.0));
      const light=new T.DirectionalLight(0xffffff,2);light.position.set(-60,100,80);scene.add(light);
      const root=new T.Group();scene.add(root);const objects=[];
      for(const part of parts){
        const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(part.p,3));geo.setAttribute('normal',new T.Float32BufferAttribute(part.n,3));
        const color=part.group==='top'?0x775039:part.materialIndex===3?0x252925:0x485258;
        const mat=new T.MeshStandardMaterial({color,metalness:part.group==='top'?0:.35,roughness:.7});
        const obj=new T.Mesh(geo,mat);obj.userData={id:part.id,group:part.group,color};
        const lineGeo=new T.BufferGeometry();lineGeo.setAttribute('position',new T.Float32BufferAttribute(part.e,3));
        const edges=new T.LineSegments(lineGeo,new T.LineBasicMaterial({color:0x25362f,transparent:true,opacity:.45}));obj.add(edges);
        root.add(obj);objects.push(obj);
      }
      const ghostGeo=new T.EdgesGeometry(new T.BoxGeometry(...[variant.table[0],variant.topThickness,variant.table[1]]));
      const ghost=new T.LineSegments(ghostGeo,new T.LineBasicMaterial({color:0x89978e,transparent:true,opacity:.45}));
      ghost.position.set(0,variant.table[2]-variant.topThickness/2,0);scene.add(ghost);
      const point=p=>new T.Vector3(p[0]-66,p[2],-p[1]);
      const measures=()=>latest.current.dimensions?modelDimensions(latest.current.variant,latest.current.isolate?latest.current.selected:'',latest.current.dimensionMode):[];
      const updateDimensions=()=>{
        const width=host.current.clientWidth,height=host.current.clientHeight;if(!width||!height)return;
        const project=p=>{const v=point(p).project(camera);return [(v.x+1)*width/2,(1-v.y)*height/2];};
        const occupied=[];
        const items=measures().map(d=>{
          const a=project(d.a),b=project(d.b),from=project(d.from),to=project(d.to),dx=to[0]-from[0],dy=to[1]-from[1],length=Math.hypot(dx,dy);
          if(length<.5)return null;
          const text=format(d.value,latest.current.unit),boxWidth=Math.min(width-12,Math.max(96,text.length*7.5+16,d.label.length*6+16));
          const mid=[(from[0]+to[0])/2,(from[1]+to[1])/2];
          let x=Math.max(boxWidth/2+5,Math.min(width-boxWidth/2-5,mid[0]-dy/length*25)),y=Math.max(25,Math.min(height-25,mid[1]+dx/length*25));
          for(let attempt=0;attempt<8&&occupied.some(o=>Math.abs(x-o.x)<(boxWidth+o.w)/2+4&&Math.abs(y-o.y)<46);attempt++)y=Math.max(25,Math.min(height-25,y+(y<height/2?48:-48)));
          occupied.push({x,y,w:boxWidth});return {...d,a,b,from,to,x,y,mid,text,boxWidth};
        }).filter(Boolean);
        setOverlay({width,height,items});
      };
      let frame=0,lastFit='',lastView='3d';
      const draw=()=>{if(!frame&&!stopped&&!document.hidden)frame=requestAnimationFrame(()=>{frame=0;renderer.render(scene,camera);updateDimensions();});};
      const bounds=()=>{const box=new T.Box3();for(const obj of objects)if(obj.visible)box.union(new T.Box3().setFromObject(obj));return box;};
      const fit=(view='3d')=>{
        lastView=view;
        const box=bounds();for(const d of measures())for(const p of [d.a,d.b,d.from,d.to])box.expandByPoint(point(p));if(box.isEmpty())return;
        const center=box.getCenter(new T.Vector3()),radius=Math.max(box.getBoundingSphere(new T.Sphere()).radius,2);
        const ratio=Math.max(host.current.clientWidth,1)/Math.max(host.current.clientHeight,1);
        const dirs={end:[-1,0,0],side:[0,0,1],top:[0,1,.0001],'3d':[1.3,.8,1.4]};
        camera.position.copy(center).add(new T.Vector3(...dirs[view]).normalize().multiplyScalar(radius*4+100));
        camera.up.set(0,1,0);camera.lookAt(center);
        const inverse=camera.quaternion.clone().invert();let width=0,height=0;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          const projected=new T.Vector3(x,y,z).sub(center).applyQuaternion(inverse);width=Math.max(width,Math.abs(projected.x));height=Math.max(height,Math.abs(projected.y));
        }
        const half=Math.max(height,width/ratio,2)*(latest.current.dimensions?1.28:1.12);
        camera.left=-half*ratio;camera.right=half*ratio;camera.top=half;camera.bottom=-half;camera.zoom=1;
        camera.updateProjectionMatrix();orbit.target.copy(center);orbit.update();draw();
      };
      const apply=()=>{
        const state=latest.current;
        for(const obj of objects){obj.visible=!state.hiddenParts.includes(obj.userData.id)&&(state.isolate&&state.selected?obj.userData.id===state.selected:obj.userData.group!=='top'||state.showTop||obj.userData.id===state.selected);
          obj.material.color.setHex(obj.userData.id===state.selected?0xbd7a2b:obj.userData.color);}
        ghost.visible=state.dimensions&&!state.showTop&&!(state.isolate&&state.selected);
        const key=(state.isolate&&state.selected?state.selected:'assembly')+state.dimensionMode+state.dimensions;if(key!==lastFit){lastFit=key;fit(state.isolate?'3d':['layout','rails'].includes(state.dimensionMode)?'top':state.dimensionMode==='clearance'?'side':'3d');}else draw();
        if(host.current){host.current.dataset.selectedPart=state.selected;host.current.dataset.visibleParts=String(objects.filter(o=>o.visible).length);host.current.dataset.ready='true';}
      };
      const resize=new ResizeObserver(()=>{if(stopped||!host.current)return;const w=host.current.clientWidth,h=host.current.clientHeight;if(!w||!h)return;renderer.setSize(w,h);fit(lastView);});resize.observe(host.current);
      renderer.setSize(host.current.clientWidth,host.current.clientHeight);
      orbit.addEventListener('change',draw);
      const visibility=()=>{if(!document.hidden)draw();};document.addEventListener('visibilitychange',visibility);
      let down=null;
      const pointerdown=e=>{down=[e.clientX,e.clientY];};
      const pointerup=e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;down=null;
        const rect=renderer.domElement.getBoundingClientRect();const ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
        const hit=ray.intersectObjects(objects.filter(o=>o.visible),false)[0];if(hit)latest.current.onSelect(hit.object.userData.id);};
      const lost=e=>{e.preventDefault();setError('The 3D view paused. Close and reopen this section; the dimensions remain available below.');};
      renderer.domElement.addEventListener('pointerdown',pointerdown);renderer.domElement.addEventListener('pointerup',pointerup);renderer.domElement.addEventListener('webglcontextlost',lost);
      control.current={apply,fit};apply();
      cleanup=()=>{cancelAnimationFrame(frame);resize.disconnect();orbit.dispose();document.removeEventListener('visibilitychange',visibility);
        renderer.domElement.removeEventListener('pointerdown',pointerdown);renderer.domElement.removeEventListener('pointerup',pointerup);renderer.domElement.removeEventListener('webglcontextlost',lost);
        scene.traverse(o=>{o.geometry?.dispose();if(o.material)o.material.dispose();});renderer.dispose();renderer.domElement.remove();control.current=null;};
    })().catch(()=>{if(!stopped)setError('3D graphics could not start. The parts list and drawings still work.');});
    return()=>{stopped=true;cleanup?.();};
  },[parts]);
  return <div className="wt-viewer"><div className="wt-view-buttons">{[['3d','3D'],['end','End'],['side','Side'],['top','Top']].map(([id,label])=><button key={id} onClick={()=>control.current?.fit(id)}>{label}</button>)}<button onClick={()=>control.current?.fit()}>Fit view</button></div>
    <div className="wt-stage"><div ref={host} className="wt-canvas" aria-label="Walnut parts 3D view"/>
      {dimensions&&<svg className="wt-dimension-overlay" viewBox={`0 0 ${overlay.width} ${overlay.height}`} aria-label="Dimensions on model" role="img">
        {overlay.items.map((d,i)=>{const dx=d.to[0]-d.from[0],dy=d.to[1]-d.from[1],n=Math.hypot(dx,dy),tick=[-dy/n*5,dx/n*5];return <g key={i} data-dimension={d.label} data-value={d.value}>
          <path d={`M${d.a}L${d.from} M${d.b}L${d.to}`} className="wt-dim-extension"/>
          <path d={`M${d.from}L${d.to} M${d.from[0]-tick[0]},${d.from[1]-tick[1]}l${tick[0]*2},${tick[1]*2} M${d.to[0]-tick[0]},${d.to[1]-tick[1]}l${tick[0]*2},${tick[1]*2}`} className="wt-dim-line"/>
          <path d={`M${d.mid}L${d.x},${d.y}`} className="wt-dim-extension"/>
          <rect x={d.x-d.boxWidth/2} y={d.y-21} width={d.boxWidth} height="42" rx="7"/><text x={d.x} y={d.y-3} textAnchor="middle" className="wt-dim-value">{d.text}</text><text x={d.x} y={d.y+12} textAnchor="middle" className="wt-dim-caption">{d.label}</text>
        </g>;})}
      </svg>}
    </div>{error&&<p role="alert">{error}</p>}<p className="wt-hint">Drag to rotate · Scroll to zoom · Click a part</p></div>;
}
