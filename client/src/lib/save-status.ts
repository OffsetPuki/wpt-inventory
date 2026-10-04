import {useSyncExternalStore} from 'react';
let pending=0, failed=new Set<string>(), value='Saved';
const listeners=new Set<()=>void>();
function notify(){value=pending?'Saving…':failed.size?'Retry needed':'Saved';for(const f of listeners)f();}
export function beginSave(){pending++;notify();}
export function endSave(url:string,ok:boolean){pending=Math.max(0,pending-1);if(ok)failed.delete(url);else failed.add(url);notify();}
export function useSaveStatus(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},()=>value,()=> 'Saved');}
