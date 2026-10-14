import { useSyncExternalStore } from 'react';
export type SaveIssue = { key: string; label: string; href: string; message: string; at: number; status?: number;supportReference?:string };
type SaveContext = Pick<SaveIssue, 'key' | 'label' | 'href'>;
let pending = 0, value = 'Saved', snapshot: SaveIssue[] = [];
const failed = new Map<string, SaveIssue>(), listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function notify() { value = pending ? 'Saving…' : failed.size ? 'Retry needed' : 'Saved'; snapshot = [...failed.values()]; for (const f of listeners) f(); }
const destinations: [RegExp, string, string, string?][] = [
  [/^\/api\/quotes(?:\/(\d+))?/, 'Quote', '/crm/quotes', 'quote'],
  [/^\/api\/finance\/invoices(?:\/(\d+))?/, 'Invoice', '/finance/invoices', 'invoice'],
  [/^\/api\/crm\/clients(?:\/(\d+))?/, 'Customer', '/crm/clients', 'client'],
  [/^\/api\/crm\/leads(?:\/(\d+))?/, 'Lead', '/crm/leads', 'lead'],
  [/^\/api\/pm\/tasks(?:\/(\d+))?/, 'Task', '/pm/board', 'task'],
  [/^\/api\/(?:suite\/jobs|projects)(?:\/(\d+))?/, 'Job', '/projects'],
  [/^\/api\/finance\/expenses/, 'Expense', '/finance/expenses'],
  [/^\/api\/finance\/purchase-orders/, 'Purchase order', '/finance/purchase-orders'],
  [/^\/api\/pm\/time/, 'Work time', '/pm/time'],
];
export function beginSave(url = '', method = 'POST'): SaveContext {
  pending++;
  const path = url.split('?')[0];
  let label = 'Your changes', href = typeof window === 'undefined' ? '/today' : window.location.hash.slice(1) || '/today';
  for (const [pattern, name, route, parameter] of destinations) {
    const match = path.match(pattern);
    if (!match) continue;
    label = name; href = route;
    if (match[1]) href = parameter ? `${route}?${parameter}=${match[1]}` : `/project/${match[1]}`;
    break;
  }
  notify(); return { key: method + ' ' + path, label, href };
}
export function endSave(url: string, ok: boolean, context?: SaveContext, error?: unknown) {
  pending = Math.max(0, pending - 1);
  const key = context?.key || url;
  if (ok) failed.delete(key);
  else {
    const e = error as { message?: string; status?: number;supportReference?:string } | undefined;
    if (!url.startsWith('/api/auth/')) failed.set(key, { key, label: context?.label || 'Your changes', href: context?.href || '/today', message: e?.message || 'The save was not confirmed. Review the form before retrying.', status: e?.status,supportReference:e?.supportReference, at: Date.now() });
  }
  notify();
}
export function dismissSaveIssue(key: string) { failed.delete(key); notify(); }
export function resetSaveStatus() { pending = 0; failed.clear(); notify(); }
export function useSaveStatus() { return useSyncExternalStore(subscribe, () => value, () => 'Saved'); }
export function useSaveIssues() { return useSyncExternalStore(subscribe, () => snapshot, () => snapshot); }
