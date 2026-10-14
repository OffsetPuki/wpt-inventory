import {useEffect,useSyncExternalStore} from 'react';
import {useAuth} from './auth';
import {SPANISH} from '@shared/suite-language';
const event='suite-language-changed';
const memory=new Map<string,'en'|'es'>();
const subscribe=(fn:()=>void)=>{window.addEventListener(event,fn);window.addEventListener('storage',fn);return()=>{window.removeEventListener(event,fn);window.removeEventListener('storage',fn);};};
export function useLanguage(){
 const {user}=useAuth(),key='suite-language:'+user?.id;
 const language=useSyncExternalStore(subscribe,()=>{try{return localStorage.getItem(key)==='es'?'es':'en';}catch{return memory.get(key)||'en';}},()=> 'en');
 const setLanguage=(value:string)=>{const next=value==='es'?'es':'en';memory.set(key,next);try{localStorage.setItem(key,next);}catch{}window.dispatchEvent(new Event(event));};
 const t=(value:string)=>language==='es'?SPANISH[value]||value:value;
 return {language,setLanguage,t};
}
export function L({children}:{children:string}){const {t}=useLanguage();return <>{t(children)}</>;}
export function LanguagePicker(){
 const {language,setLanguage}=useLanguage();
 useEffect(()=>{document.documentElement.lang=language;},[language]);
 return <label className="inline-flex min-h-11 items-center"><span className="sr-only">Interface language / Idioma</span><select aria-label="Interface language / Idioma" className="min-h-11 max-w-28 rounded-lg border border-border bg-background px-2 text-sm" value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">English</option><option value="es">Español</option></select></label>;
}
