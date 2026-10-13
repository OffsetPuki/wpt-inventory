import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { consumeRecordLink, useDeepLink } from "./deep-link";
import { toast, dismissToast } from "@/components/ui/use-toast";
export function readContext(name: string) {
  return (
    new URLSearchParams(window.location.hash.split("?")[1] || "").get(name) ||
    ""
  );
}
export function useRecordLink(
  name: string,
  endpoint: string,
  onOpen: (row: any) => void,
) {
  const id = useDeepLink(name);
  const valid = !!id && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
  const opened = useRef<string | null>(null);
  const open = useRef(onOpen);
  open.current = onOpen;
  const clearLink = () => { if (readContext(name) === id) consumeRecordLink(name); };
  const q = useQuery({
    queryKey: ["record-link", endpoint, id],
    queryFn: async ({ signal }) =>
      (
        await apiRequest("GET", `${endpoint}/${id}`, undefined, { signal })
      ).json(),
    enabled: valid,
    // Editors must start with a fresh record and version, even on a repeated link.
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (!id) opened.current = null;
  }, [id]);
  useEffect(() => {
    if (valid && q.isSuccess && !q.isFetching && q.data && id && opened.current !== id) {
      opened.current = id;
      try {
        open.current(q.data);
        clearLink();
      } catch {
        const notice = toast({ variant: 'destructive', title: 'Could not read this record', description: 'Its saved details could not be opened. Your record has not been changed.', action: { label: 'Back to list', onClick: clearLink } });
        return () => dismissToast(notice);
      }
    }
  }, [q.data, q.isSuccess, q.isFetching, id, valid]);
  useEffect(() => {
    if (!id || (valid && !q.error)) return;
    const status = (q.error as (Error & { status?: number }) | null)?.status;
    const terminal = !valid || status === 404 || status === 403;
    const notice = toast({
      variant: 'destructive',
      title: !valid ? 'Invalid record link' : status === 404 ? 'Record unavailable' : status === 403 ? 'Access unavailable' : 'Could not open this record',
      description: !valid ? 'Open the record from its list.' : status === 404 ? 'This record may have been deleted. Return to the list to choose another.' : status === 403 ? 'Your account does not have access to this record.' : 'Please try again. Your saved information has not been changed.',
      action: terminal ? { label: 'Back to list', onClick: clearLink } : { label: 'Retry', onClick: () => { void q.refetch(); } },
    });
    return () => dismissToast(notice);
  }, [q.error, id, valid]);
}
