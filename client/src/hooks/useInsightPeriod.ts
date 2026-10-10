import {useSyncExternalStore} from 'react';
import {useBusinessDay} from './useBusinessReport';
let saved={from:'',to:'',compare:false};
const listeners=new Set<()=>void>();
const subscribe=(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn);};};
export function useInsightPeriod(){
 const today=useBusinessDay();
 const state=useSyncExternalStore(subscribe,()=>saved,()=>saved);
 return {...state,from:state.from||today.slice(0,7)+'-01',to:state.to||today,today,setPeriod:(next:Partial<typeof saved>)=>{saved={...saved,...next};listeners.forEach(fn=>fn());}};
}
