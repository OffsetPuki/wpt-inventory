import {useSyncExternalStore} from 'react';
import {BUSINESSES} from '@shared/business.js';
const event='suite-business-changed';
function read(){try{const value=localStorage.getItem('suite-business')||'all';return value==='all'||(BUSINESSES as Record<string,string>)[value]?value:'all';}catch{return 'all';}}
export function setBusiness(value:string){if(value!=='all'&&!(BUSINESSES as Record<string,string>)[value])return;try{localStorage.setItem('suite-business',value);}catch{}window.dispatchEvent(new Event(event));}
export function useBusiness(){return useSyncExternalStore(callback=>{window.addEventListener(event,callback);window.addEventListener('storage',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);};},read,()=> 'all');}
