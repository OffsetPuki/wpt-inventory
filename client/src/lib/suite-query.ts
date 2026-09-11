import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "./queryClient";
export function useSuiteQuery<T = any>(
  key: any[],
  url: string,
  enabled = true,
) {
  return useQuery<T>({
    queryKey: key,
    queryFn: async ({ signal }) =>
      (await apiRequest("GET", url, undefined, { signal })).json(),
    enabled,
  });
}
