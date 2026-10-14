import {useSyncExternalStore} from 'react';
import {BUSINESSES} from '@shared/business.js';
const event='suite-business-changed';
export const getBusiness=()=>read();
function read(){try{const params=new URLSearchParams(window.location.hash.split('?')[1]||'');const value=params.get('business')||localStorage.getItem('suite-business')||'all';return value==='all'||(BUSINESSES as Record<string,string>)[value]?value:'all';}catch{return 'all';}}
export function setBusiness(value:string){
 if(value!=='all'&&!(BUSINESSES as Record<string,string>)[value])return;
 try{localStorage.setItem('suite-business',value);}catch{}
 const [base,search]=window.location.hash.split('?'),params=new URLSearchParams(search||'');params.set('business',value);params.set('page','0');
 history.replaceState(history.state,'',window.location.pathname+window.location.search+base+'?'+params.toString());
 window.dispatchEvent(new HashChangeEvent('hashchange'));window.dispatchEvent(new Event(event));
}
export function useBusiness(){return useSyncExternalStore(callback=>{window.addEventListener(event,callback);window.addEventListener('storage',callback);window.addEventListener('hashchange',callback);return()=>{window.removeEventListener(event,callback);window.removeEventListener('storage',callback);window.removeEventListener('hashchange',callback);};},read,()=> 'all');}
