import {useBusiness,setBusiness} from './useBusiness';
import {useState,useEffect} from 'react';
export function useMarketingPlace<T extends string>(key:string,fallback:T){
 const business=useBusiness();
 const read=()=>{try{const value=new URLSearchParams(location.hash.split('?')[1]).get(key)||sessionStorage.getItem('marketing:'+key)||fallback;if(key==='site'&&!['metals','concrete','insulation','trades'].includes(value))return fallback;if(key==='tab'&&!['overview','reviews','portfolio','settings','campaigns','connections'].includes(value))return fallback;return value as T;}catch{return fallback;}};
 const [value,setValue]=useState<T>(read);
 useEffect(()=>{const sync=()=>setValue(read());window.addEventListener('popstate',sync);window.addEventListener('hashchange',sync);return()=>{window.removeEventListener('popstate',sync);window.removeEventListener('hashchange',sync)};},[key]);
 useEffect(()=>{try{sessionStorage.setItem('marketing:'+key,value);const [path,search]=location.hash.split('?');if(path.includes('marketing')){const params=new URLSearchParams(search);params.set(key,value);history.replaceState(history.state,'',path+'?'+params.toString());}}catch{}},[key,value]);
 useEffect(()=>{if(key==='site'&&business!=='all')setValue(business as T);},[business,key]);
 const change=(next:T)=>{if(key==='site')setBusiness(next);if(key==='tab'){const [path,search]=location.hash.split('?'),params=new URLSearchParams(search);params.set(key,next);history.pushState(history.state,'',path+'?'+params.toString());}setValue(next);};
 return [value,change] as const;
}
