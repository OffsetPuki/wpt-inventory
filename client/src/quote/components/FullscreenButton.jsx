import {useEffect,useState} from 'react';
export default function FullscreenButton({target}){
 const [active,setActive]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const update=()=>setActive(!!document.fullscreenElement);document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update);},[]);
 async function toggle(){try{setError('');if(document.fullscreenElement)await document.exitFullscreen();else await target()?.requestFullscreen();}catch{setError('Full screen is unavailable in this browser.');}}
 return <><button type="button" className="btn ghost product-fullscreen" onClick={toggle}>{active?'Exit full screen':'Full screen'}</button>{error&&<span role="status">{error}</span>}</>;
}
