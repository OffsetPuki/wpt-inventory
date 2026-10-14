import {useQuery} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';
import {useBusiness} from './useBusiness';
import {todayYmd,setBusinessTimeZone} from '@/lib/format';
export function useBusinessDay(){
 const clock=useQuery<{date:string;timeZone:string}>({queryKey:['business-clock'],queryFn:async()=>{const data=await(await apiRequest('GET','/api/suite/clock')).json();setBusinessTimeZone(data.timeZone);return data;},staleTime:30000,refetchInterval:60000});
 return clock.data?.date||todayYmd();
}
export function useBusinessReport(from?:string,to?:string,kind='all',search='',page=0){const site=useBusiness(),today=useBusinessDay(),start=from??today.slice(0,7)+'-01',end=to??today;return useQuery<any>({queryKey:['business-report',site,start,end,kind,search,page],queryFn:async()=>(await apiRequest('GET','/api/business-report?'+new URLSearchParams({site,from:start,to:end,kind,q:search,page:String(page)}))).json(),enabled:!!start&&!!end&&start<=end,staleTime:60000,refetchInterval:300000});}
