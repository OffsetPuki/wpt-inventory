import FullscreenButton from './FullscreenButton.jsx';
import {useEffect,useRef} from 'react';
import {mountBarndominium} from '../lib/barndominium/editor.js';
import '../lib/barndominium/editor.css';
export default function Barndominium({state,onChange}){
 const root=useRef(null),editor=useRef(null),callback=useRef(onChange);callback.current=onChange;
 useEffect(()=>{editor.current=mountBarndominium(root.current,{state,technical:true,onChange:s=>callback.current(s)});return()=>editor.current?.destroy();},[]);
 useEffect(()=>editor.current?.setState(state),[state]);
 return <div className="barndo-product"><FullscreenButton target={()=>root.current?.parentElement}/><div ref={root}/></div>;
}
