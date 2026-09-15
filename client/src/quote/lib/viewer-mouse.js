// Keep browser scrolling/autoscroll out of the model without stopping
// propagation: OrbitControls must still receive the original mouse events.
export function containViewerMouse(canvas){
 const abort=new AbortController();
 const options={capture:true,passive:false,signal:abort.signal};
 canvas.addEventListener('wheel',event=>event.preventDefault(),options);
 const middle=event=>{if(event.button===1)event.preventDefault();};
 canvas.addEventListener('mousedown',middle,options);
 canvas.addEventListener('auxclick',middle,options);
 return ()=>abort.abort();
}
