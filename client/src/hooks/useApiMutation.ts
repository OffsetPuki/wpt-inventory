import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiRequest,getAuthToken } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { useRef } from 'react';

// ─── Shared CRUD mutation hook ────────────────────────────────────────────────
// Every create/update/delete on the CRUD pages was the same shape:
//
//   useMutation({
//     mutationFn: () => apiRequest(method, url, body).then((r) => r.json()),
//     onSuccess: () => { keys.forEach(k => qc.invalidateQueries({ queryKey: k }));
//                        toast({ variant: "success", title }); closeDialog(); },
//     onError: (e) => toast({ variant: "destructive", title, description: e?.message }),
//   })
//
// useApiMutation captures exactly that. `request` builds the call from the
// mutate() argument (so the url/body can be dynamic and read component state);
// `invalidate` lists the query keys to refresh; `successTitle` is the success
// toast (static or derived from the response/vars); `onSuccess` is an extra
// effect that runs after invalidation + toast (close a dialog, reset a form).

/** The HTTP call a mutation makes, derived per-invocation from mutate()'s arg. */
export interface ApiRequestSpec {
  method: string;
  url: string;
  body?: unknown;
  expectedVersion?: number;
}

type SuccessTitle<TData, TVars> =
  | string
  | ((data: TData, vars: TVars) => string | undefined);

export interface ApiMutationOptions<TData, TVars> {
  /** Build method/url/body from the mutate() argument (read component state here). */
  request: (vars: TVars) => ApiRequestSpec;
  /** Query keys to invalidate on success — each is a full queryKey array. */
  invalidate?: QueryKey[];
  /** Success toast title: a fixed string, or derived from (data, vars). Omit for none. */
  successTitle?: SuccessTitle<TData, TVars>;
  /** Title of the destructive error toast; its description is the thrown message. */
  errorTitle: string;
  /** Extra effect after invalidation + toast (close a dialog, reset a form, …). */
  onSuccess?: (data: TData, vars: TVars) => void;
}

export function useApiMutation<TData = any, TVars = void>(
  opts: ApiMutationOptions<TData, TVars>,
): UseMutationResult<TData, Error, TVars> {
  const qc = useQueryClient();
  const retryIdentity=useRef<{request:string,key:string,storageKey:string}|null>(null);
  return useMutation<TData, Error, TVars>({
    mutationFn: async (vars: TVars) => {
      const { method, url, body,expectedVersion } = opts.request(vars);
      const request=JSON.stringify({method,url,body});
      if(retryIdentity.current?.request!==request){
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(getAuthToken()+request));
        const storageKey='suite-request:'+Array.from(new Uint8Array(bytes)).map(b=>b.toString(16).padStart(2,'0')).join('');
        let key:string=crypto.randomUUID();try{key=sessionStorage.getItem(storageKey)||key;sessionStorage.setItem(storageKey,key);}catch{}
        retryIdentity.current={request,key,storageKey};
      }
      return (await apiRequest(method, url, body,{expectedVersion,idempotencyKey:method==='POST'?retryIdentity.current.key:undefined})).json();
    },
    onSuccess: (data, vars) => {
      if(retryIdentity.current)try{sessionStorage.removeItem(retryIdentity.current.storageKey);}catch{}
      retryIdentity.current=null;
      opts.invalidate?.forEach((key) => qc.invalidateQueries({ queryKey: key }));
      const title =
        typeof opts.successTitle === "function"
          ? opts.successTitle(data, vars)
          : opts.successTitle;
      if (title) toast({ variant: "success", title });
      opts.onSuccess?.(data, vars);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: opts.errorTitle, description: e?.message }),
  });
}
