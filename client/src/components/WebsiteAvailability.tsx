import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiRequest} from '@/lib/queryClient';

type Status={site:string;active:boolean;version:number;updatedAt:number};
const key=['insulation-website-status'];
export default function WebsiteAvailability(){
 const cache=useQueryClient();
 const status=useQuery<Status>({queryKey:key,queryFn:async()=>(await apiRequest('GET','/api/settings/website/insulation')).json()});
 const save=useMutation({mutationFn:async(active:boolean)=>(await apiRequest('PUT','/api/settings/website/insulation',{active,version:status.data?.version})).json() as Promise<Status>,onSuccess:data=>cache.setQueryData(key,data),onError:()=>{cache.invalidateQueries({queryKey:key});}});
 return <section id="website-availability" className="scroll-mt-24 rounded-xl border bg-card p-5" aria-labelledby="website-availability-title">
  <h2 id="website-availability-title" className="text-lg font-semibold">Website availability</h2>
  <p className="mt-1 text-sm text-muted-foreground">Control whether customers can visit your Insulation website.</p>
  <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border p-4">
   <div><h3 className="font-semibold">CJM Insulation</h3><p className="break-all text-sm text-muted-foreground">cjminsulation.com</p><p role="status" className="mt-2 text-sm font-medium">{save.isPending?'Saving…':status.isLoading?'Loading status…':status.data?(status.data.active?'Active · Public website is on':'Inactive · Public website is off'):'Status unavailable'}</p></div>
   <button type="button" role="switch" aria-checked={status.data?.active??false} aria-label="Activate Insulation website" disabled={!status.data||status.isError||save.isPending} onClick={()=>save.mutate(!status.data!.active)} className={'relative inline-flex h-11 w-20 shrink-0 items-center rounded-full border-2 p-1 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50 '+(status.data?.active?'border-primary bg-primary':'border-border bg-muted')}><span className={'h-8 w-8 rounded-full bg-white shadow transition-transform '+(status.data?.active?'translate-x-8':'translate-x-0')}/></button>
  </div>
  <p className="mt-3 text-sm text-muted-foreground">Your Insulation customers, jobs, quotes and tools remain available in the Business Suite. Changes to the website take effect within 15 seconds.</p>
  <p className="mt-2 text-sm text-muted-foreground">Turning it on restores the Insulation website. Links and promotions on other CJM websites stay removed. Search results may take time to update.</p>
  {(status.error||save.error)&&<div role="alert" className="mt-3 text-sm text-destructive">{(save.error||status.error)?.message}<button className="ml-2 min-h-11 underline" onClick={()=>{save.reset();status.refetch();}}>Refresh status</button></div>}
 </section>;
}
