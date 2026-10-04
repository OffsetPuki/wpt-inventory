import { useEffect, useState } from "react";
import {useBusiness} from "@/hooks/useBusiness";
import { useAuth } from "./auth";
export function useRememberedState<T>(name: string, initial: T, urlParam?: string) {
  const { user } = useAuth();
  const key = `suite-view:${user?.id}:${name}`;
  const urlValue=()=>{const p=new URLSearchParams(window.location.hash.split('?')[1]||window.location.search);return urlParam && p.has(urlParam)?p.get(urlParam) as T:undefined;};
  const [value, set] = useState<T>(() => {
    if(urlValue()!==undefined) return urlValue()!;
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null") ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  useEffect(()=>{const apply=()=>{const v=urlValue();if(v!==undefined)set(v);};window.addEventListener('hashchange',apply);window.addEventListener('popstate',apply);return()=>{window.removeEventListener('hashchange',apply);window.removeEventListener('popstate',apply);};},[urlParam]);
  return [value, set] as const;
}
export function useListPage(name: string, filters: any[]) {
  const business=useBusiness();
  filters=[...filters,business];
  const [saved, set] = useRememberedState(name, {
    filters: JSON.stringify(filters),
    page: 0,
  });
  const signature = JSON.stringify(filters);
  const page = saved.filters === signature ? saved.page : 0;
  return { page, setPage: (page: number) => set({ filters: signature, page }) };
}
export function PageButtons({
  page,
  setPage,
  count,
  total,
  limit=50,
}: {
  page: number;
  setPage: (n: number) => void;
  count: number;
  total?: number;
  limit?: number;
}) {
  return (
    <nav
      aria-label="List pages"
      className="my-4 flex items-center justify-between gap-4"
    >
      <button
        className="min-h-11 rounded border px-4 disabled:opacity-40"
        disabled={!page}
        onClick={() => setPage(page - 1)}
      >
        Previous
      </button>
      <span className="text-sm">
        Page {page + 1}
        {total !== undefined && ` · ${total} records`}
      </span>
      <button
        className="min-h-11 rounded border px-4 disabled:opacity-40"
        disabled={total !== undefined ? (page + 1) * limit >= total : count < limit}
        onClick={() => setPage(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
