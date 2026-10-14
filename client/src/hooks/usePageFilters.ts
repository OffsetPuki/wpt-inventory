import { useSyncExternalStore } from 'react';
const subscribe=(listener:()=>void)=>{window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener);};
/** URL-backed filters preserve context when a record is opened and Back is used. */
export function usePageFilters<T extends Record<string,string>>(defaults:T){
  const hash=useSyncExternalStore(subscribe,()=>window.location.hash,()=>''),params=new URLSearchParams(hash.split('?')[1]||'');
  const values=Object.fromEntries(Object.entries(defaults).map(([k,v])=>[k,params.get(k)??v])) as T;
  const update=(patch:Partial<T>)=>{
    const current=new URLSearchParams(window.location.hash.split('?')[1]||'');
    for(const [key,value] of Object.entries(patch))if(value!==undefined)current.set(key,value);
    if('page' in defaults && !('page' in patch))current.set('page','0');
    const base=window.location.hash.split('?')[0];
    history.replaceState(history.state,'',window.location.pathname+window.location.search+base+'?'+current.toString());
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  return [values,update] as const;
}
