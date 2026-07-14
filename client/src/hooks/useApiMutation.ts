import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";

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
  return useMutation<TData, Error, TVars>({
    mutationFn: async (vars: TVars) => {
      const { method, url, body } = opts.request(vars);
      return (await apiRequest(method, url, body)).json();
    },
    onSuccess: (data, vars) => {
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
