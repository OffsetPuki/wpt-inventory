import {useEffect,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {useBusiness} from './useBusiness';
import {todayYmd} from '@/lib/format';
export function useBusinessDay(){const [day,setDay]=useState(todayYmd);useEffect(()=>{let timer:ReturnType<typeof setTimeout>;const tick=()=>{setDay(todayYmd());const now=new Date(),next=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1);timer=setTimeout(tick,next.getTime()-now.getTime()+100);};tick();const wake=()=>setDay(todayYmd());window.addEventListener('focus',wake);return()=>{clearTimeout(timer);window.removeEventListener('focus',wake);};},[]);return day;}
export function useBusinessReport(from?:string,to?:string,kind='all',search='',page=0){const site=useBusiness(),today=useBusinessDay(),start=from??today.slice(0,7)+'-01',end=to??today;return useQuery<any>({queryKey:['business-report',site,start,end,kind,search,page],queryFn:async()=>(await apiRequest('GET','/api/business-report?'+new URLSearchParams({site,from:start,to:end,kind,q:search,page:String(page)}))).json(),enabled:!!start&&!!end&&start<=end,staleTime:60000,refetchInterval:300000});}
