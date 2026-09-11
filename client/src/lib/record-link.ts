import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
import { useDeepLink } from "./deep-link";
import { toast } from "@/components/ui/toaster";
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
  const opened = useRef<string | null>(null);
  const q = useQuery({
    queryKey: ["record-link", name, id],
    queryFn: async ({ signal }) =>
      (
        await apiRequest("GET", `${endpoint}/${id}`, undefined, { signal })
      ).json(),
    enabled: !!id && /^\d+$/.test(id),
  });
  useEffect(() => {
    if (!id) opened.current = null;
  }, [id]);
  useEffect(() => {
    if (q.data && id && opened.current !== id) {
      opened.current = id;
      onOpen(q.data);
      const [base, search] = window.location.hash.split("?");
      const params = new URLSearchParams(search || "");
      params.delete(name);
      history.replaceState(
        history.state,
        "",
        window.location.pathname +
          window.location.search +
          base +
          (params.size ? "?" + params.toString() : ""),
      );
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  }, [q.data, id]);
  useEffect(() => {
    if (q.error)
      toast({
        title: "Could not open this record",
        description: q.error.message,
        variant: "destructive",
      });
  }, [q.error]);
}
