import {useSuiteQuery} from '@/lib/suite-query';
import {RetryBlock} from './RetryBlock';
export function useDeletionReview(kind:'job'|'customer'|'lead'|'item',id:number,enabled=true){return useSuiteQuery(['deletion-review',kind,id],`/api/suite/deletion-review/${kind}/${id}`,enabled);}
export default function DeletionReview({query}:{query:ReturnType<typeof useDeletionReview>}){
 if(query.isError)return <RetryBlock query={query}/>;
 if(!query.data)return <p role="status">Checking connected records…</p>;
 return <section className="space-y-2 rounded-xl border p-3"><h3 className="font-medium">Connected records kept with this history</h3>{query.data.rows.length?<ul className="space-y-1">{query.data.rows.map((r:any)=><li key={r.label}>{r.label}: {r.count}</li>)}</ul>:<p>No direct linked records found.</p>}<p className="text-xs text-muted-foreground">{query.data.explanation}</p></section>;
}
