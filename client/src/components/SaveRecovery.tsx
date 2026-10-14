import SupportReference from './SupportReference';
import { useState } from 'react';
import { Link } from 'wouter';
import Modal from './Modal';
import { useSaveIssues, dismissSaveIssue } from '@/lib/save-status';
import { secondaryBtn } from '@/lib/ui-styles';
export default function SaveRecovery() {
  const issues = useSaveIssues(), [open, setOpen] = useState(false);
  if (!issues.length) return null;
  return <><button type="button" className="min-h-11 rounded-lg border border-amber-500/50 bg-amber-50 px-3 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100" onClick={()=>setOpen(true)}>{issues.length} {issues.length===1?'save needs':'saves need'} attention · Review</button>
    {open && <Modal open title="Saves needing attention" onClose={()=>setOpen(false)}><div className="space-y-4"><p className="text-sm text-muted-foreground">Open the related form and review its latest details before retrying. Dismissing a notice does not retry the save or delete a draft.</p>{issues.map(issue=><article key={issue.key} className="space-y-3 rounded-xl border p-4"><h2 className="font-semibold">{issue.label}</h2><p className="break-words text-sm" role="status">{issue.message}</p><SupportReference reference={issue.supportReference}/><p className="text-xs text-muted-foreground">{new Date(issue.at).toLocaleTimeString()}</p><div className="flex flex-wrap gap-2"><Link className={secondaryBtn} href={issue.href} onClick={()=>setOpen(false)}>Review {issue.label.toLowerCase()}</Link><button className="min-h-11 rounded-lg px-3 text-sm underline" onClick={()=>dismissSaveIssue(issue.key)}>Dismiss notice</button></div></article>)}</div></Modal>}
  </>;
}
