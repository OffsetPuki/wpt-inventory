import {useEffect,useRef,useState} from 'react';

export default function WalnutModel({parts,selected,isolate,showTop,hiddenParts,onSelect}){
  const host=useRef(null),control=useRef(null),latest=useRef({selected,isolate,showTop,hiddenParts,onSelect});
  latest.current={selected,isolate,showTop,hiddenParts,onSelect};
  const [error,setError]=useState('');
  useEffect(()=>{control.current?.apply();},[selected,isolate,showTop,hiddenParts]);
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
      let frame=0,lastFit='',lastView='3d';
      const draw=()=>{if(!frame&&!stopped&&!document.hidden)frame=requestAnimationFrame(()=>{frame=0;renderer.render(scene,camera);});};
      const bounds=()=>{const box=new T.Box3();for(const obj of objects)if(obj.visible)box.union(new T.Box3().setFromObject(obj));return box;};
      const fit=(view='3d')=>{
        lastView=view;
        const box=bounds();if(box.isEmpty())return;
        const center=box.getCenter(new T.Vector3()),radius=Math.max(box.getBoundingSphere(new T.Sphere()).radius,2);
        const ratio=host.current.clientWidth/Math.max(host.current.clientHeight,1);
        const dirs={end:[-1,0,0],side:[0,0,1],top:[0,1,.0001],'3d':[1.3,.8,1.4]};
        camera.position.copy(center).add(new T.Vector3(...dirs[view]).normalize().multiplyScalar(radius*4+100));
        camera.up.set(0,1,0);camera.lookAt(center);
        const inverse=camera.quaternion.clone().invert();let width=0,height=0;
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          const projected=new T.Vector3(x,y,z).sub(center).applyQuaternion(inverse);width=Math.max(width,Math.abs(projected.x));height=Math.max(height,Math.abs(projected.y));
        }
        const half=Math.max(height,width/ratio,2)*1.12;
        camera.left=-half*ratio;camera.right=half*ratio;camera.top=half;camera.bottom=-half;camera.zoom=1;
        camera.updateProjectionMatrix();orbit.target.copy(center);orbit.update();draw();
      };
      const apply=()=>{
        const state=latest.current;
        for(const obj of objects){obj.visible=!state.hiddenParts.includes(obj.userData.id)&&(state.isolate&&state.selected?obj.userData.id===state.selected:obj.userData.group!=='top'||state.showTop||obj.userData.id===state.selected);
          obj.material.color.setHex(obj.userData.id===state.selected?0xbd7a2b:obj.userData.color);}
        const key=state.isolate&&state.selected?state.selected:'assembly';if(key!==lastFit){lastFit=key;fit();}else draw();
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
  return <div className="wt-viewer"><div className="wt-view-buttons">{[['3d','3D'],['end','End'],['side','Side'],['top','Top']].map(([id,label])=><button key={id} onClick={()=>control.current?.fit(id)}>{label}</button>)}<button onClick={()=>control.current?.fit()}>Fit view</button></div><div ref={host} className="wt-canvas" aria-label="Walnut parts 3D view"/>{error&&<p role="alert">{error}</p>}<p className="wt-hint">Drag to rotate · Scroll to zoom · Click a part to inspect it</p></div>;
}
