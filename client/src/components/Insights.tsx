import {lazy,Suspense} from 'react';
import {useAuth} from '@/lib/auth';
import type {InsightArea} from '@shared/insights';
const Panel=lazy(()=>import('./InsightsPanel'));
/** Keep report code out of worker pages and load only when a report is mounted. */
export default function Insights({area}:{area:InsightArea}){
 const {isElevated}=useAuth();
 return isElevated?<Suspense fallback={<p role="status" className="p-4 text-sm text-muted-foreground">Loading insights…</p>}><Panel area={area}/></Suspense>:null;
}
