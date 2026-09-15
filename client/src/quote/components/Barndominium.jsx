import ProductStudio from './ProductStudio.jsx';
import FullscreenButton from './FullscreenButton.jsx';
import {useEffect,useRef,useState} from 'react';
import {mountBarndominium} from '../lib/barndominium/editor.js';
import '../lib/barndominium/editor.css';
export default function Barndominium({state,onChange,customer}){
 const [showStudio,setShowStudio]=useState(false);
 const root=useRef(null),editor=useRef(null),callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>{editor.current=mountBarndominium(root.current,{state,technical:true,onChange:s=>callback.current(s)});return()=>editor.current?.destroy();},[]);
 useEffect(()=>editor.current?.setState(state),[state]);
 return <div className="barndo-product"><FullscreenButton target={()=>root.current?.parentElement}/><button type="button" className="btn ghost" onClick={()=>setShowStudio(!showStudio)}>{showStudio?'Back to design & frame':'White background preview'}</button>{showStudio&&<ProductStudio type="barndominium" state={state} customer={customer}/>}<div ref={root} hidden={showStudio}/></div>;
}
