import type { Express } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sqlite } from './storage';
import { requireElevated } from './auth';
import { inventoryOnce } from './inventory-core';
import { audit } from './audit';
import type { LeadMergePreview, MergeLeadSummary } from '../shared/lead-merge';

// Explicit inventory: a regression test fails if a new lead reference lacks a policy.
export const LEAD_MERGE_REFERENCES = ['quotes', 'projects', 'fin_invoices', 'fin_purchase_orders', 'pm_tasks', 'mk_tasks', 'review_requests', 'web_designs', 'web_lead_receipts', 'web_lead_access'] as const;
export const LEAD_MERGE_SPECIAL = ['crm_lead_intake', 'mk_lead_attribution', 'mk_measurement_events'] as const;
sqlite.exec(`CREATE TABLE IF NOT EXISTS crm_lead_merges (
  source_id INTEGER PRIMARY KEY, target_id INTEGER NOT NULL, merged_at INTEGER NOT NULL,
  merged_by INTEGER NOT NULL, snapshot TEXT NOT NULL
); CREATE INDEX IF NOT EXISTS idx_crm_lead_merges_target ON crm_lead_merges(target_id);`);

// Old bookmarks still open the surviving record. Never redirect stale edits.
export function canonicalLeadId(id: number): number {
  const seen = new Set<number>();
  while (!seen.has(id)) {
    seen.add(id);
    const row = sqlite.prepare('SELECT target_id FROM crm_lead_merges WHERE source_id=?').get(id) as { target_id: number } | undefined;
    if (!row) return id;
    id = row.target_id;
  }
  throw new Error('Lead merge link is invalid.');
}
type Row = Record<string, any>;
const positive = z.coerce.number().int().positive().safe();
const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };
const summary = (r: Row): MergeLeadSummary => ({ id: r.id, name: r.name, phone: r.phone, email: r.email, site: r.site, source: r.source, stage: r.stage, service: r.service_requested, estimatedValueCents: r.estimated_value_cents, revenueClosedCents: r.revenue_closed_cents, createdAt: r.created_at });
const active = (id: number): Row => sqlite.prepare('SELECT * FROM crm_leads WHERE id=? AND deleted_at IS NULL').get(id) as Row || fail('One of these leads changed or was removed. Choose two active leads.', 409);
function photos(row: Row): string[] {
  try { const value = JSON.parse(row.photos || '[]'); if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value; } catch {}
  return fail('A photo list could not be read. Repair it before merging so no photos are lost.');
}
const fieldLabels: Record<string, string> = {
  name: 'Name', phone: 'Phone', email: 'Email', preferred_language: 'Language', source: 'Source',
  service_requested: 'Service', service_area: 'Location', stage: 'Stage', estimated_value_cents: 'Estimated value (cents)',
  revenue_closed_cents: 'Won value (cents)', next_follow_up_at: 'Follow-up date', win_loss_reason: 'Win/loss reason',
  assigned_to: 'Assigned user', campaign_id: 'Campaign', utm_source: 'Original source', utm_medium: 'Original medium', utm_campaign: 'Original campaign',
};
function review(sourceId: number, targetId: number) {
  if (sourceId === targetId) fail('Choose two different leads.');
  const source = active(sourceId), target = active(targetId);
  if (source.site !== target.site) fail('Choose leads from the same business. Separate business requests should stay separate.');
  if (source.client_id && target.client_id && source.client_id !== target.client_id) fail('These leads belong to different customer records. Merge the customers first.');
  const tables: Record<string, Row[]> = {};
  for (const table of [...LEAD_MERGE_REFERENCES, ...LEAD_MERGE_SPECIAL]) {
    tables[table] = sqlite.prepare(`SELECT * FROM ${table} WHERE lead_id IN (?,?) ORDER BY rowid`).all(sourceId, targetId) as Row[];
  }
  tables.crm_activities = sqlite.prepare("SELECT * FROM crm_activities WHERE entity_type='lead' AND entity_id IN (?,?) ORDER BY id").all(sourceId, targetId) as Row[];
  const snapshot = JSON.stringify({ source, target, tables });
  const combinedPhotos = [...new Set([...photos(target), ...photos(source)])];
  const differences = Object.entries(fieldLabels).filter(([key]) => source[key] != null && source[key] !== '' && String(source[key]) !== String(target[key] ?? '')).map(([key, label]) => ({ label, kept: String(target[key] ?? ''), other: String(source[key]) }));
  const preview: LeadMergePreview = {
    source: summary(source), target: summary(target), version: createHash('sha256').update(snapshot).digest('hex'),
    photos: combinedPhotos.length, activities: tables.crm_activities.length,
    quotes: tables.quotes.length, jobs: tables.projects.length, invoices: tables.fin_invoices.length,
    tasks: tables.pm_tasks.length + tables.mk_tasks.length, designs: tables.web_designs.length, differences,
  };
  return { source, target, tables, snapshot, combinedPhotos, preview };
}
function fillMissing(kept: Row, other: Row): Row {
  const result = { ...kept };
  for (const [key, value] of Object.entries(other)) {
    if (result[key] == null || result[key] === '') result[key] = value;
    else if (Array.isArray(result[key]) && Array.isArray(value)) result[key] = [...new Set([...result[key], ...value])];
    else if (typeof result[key] === 'object' && typeof value === 'object' && value && !Array.isArray(value)) result[key] = fillMissing(result[key], value);
  }
  return result;
}
const earliest = (...values: (number | null | undefined)[]) => { const dates = values.filter((n): n is number => n != null); return dates.length ? Math.min(...dates) : null; };
function mergeIntake(source: number, target: number, now: number) {
  const s = sqlite.prepare('SELECT * FROM crm_lead_intake WHERE lead_id=?').get(source) as Row | undefined;
  const t = sqlite.prepare('SELECT * FROM crm_lead_intake WHERE lead_id=?').get(target) as Row | undefined;
  if (!s) return;
  if (!t) { sqlite.prepare('UPDATE crm_lead_intake SET lead_id=? WHERE lead_id=?').run(target, source); return; }
  const context = fillMissing(JSON.parse(t.context), JSON.parse(s.context));
  sqlite.prepare('UPDATE crm_lead_intake SET context=?,first_contact_at=?,qualified_at=?,survey_at=?,updated_at=? WHERE lead_id=?').run(JSON.stringify(context), earliest(t.first_contact_at, s.first_contact_at), earliest(t.qualified_at, s.qualified_at), t.survey_at ?? s.survey_at, now, target);
  sqlite.prepare('DELETE FROM crm_lead_intake WHERE lead_id=?').run(source);
}
function mergeMeasurement(source: number, target: number, now: number) {
  // An already recorded (or ambiguous) milestone must not be sent a second
  // time from a pending copy on the kept lead.
  sqlite.prepare("UPDATE mk_measurement_events SET state='merged',last_error='Duplicate milestone on merged lead',updated_at=? WHERE lead_id=? AND state='pending' AND event_name IN (SELECT event_name FROM mk_measurement_events WHERE lead_id=? AND state NOT IN ('pending','skipped','expired'))").run(now, target, source);
  const targetAttribution = sqlite.prepare('SELECT 1 FROM mk_lead_attribution WHERE lead_id=?').get(target);
  if (!targetAttribution) {
    sqlite.prepare('UPDATE mk_lead_attribution SET lead_id=? WHERE lead_id=?').run(target, source);
    // Move only non-conflicting events; the snapshot retains any historical collisions.
    sqlite.prepare('UPDATE mk_measurement_events SET lead_id=? WHERE lead_id=? AND event_name NOT IN (SELECT event_name FROM mk_measurement_events WHERE lead_id=?)').run(target, source, target);
  } else {
    // Two browser identities: retain the original attribution and events on the archived
    // request. Suppress duplicate milestones instead of replaying them to a new identity.
    sqlite.prepare("INSERT OR IGNORE INTO mk_measurement_events(lead_id,site,event_name,occurred_at,state,last_error,updated_at) SELECT ?,site,event_name,occurred_at,'merged','Already recorded on merged lead',? FROM mk_measurement_events WHERE lead_id=?").run(target, now, source);
  }
}
export function registerLeadMerge(app: Express) {
  app.get('/api/crm/lead-merge/candidates', requireElevated, (req, res) => {
    try {
      const current = active(positive.parse(req.query.lead));
      const q = String(req.query.q || '').trim().slice(0, 100).toLowerCase();
      const phone = (v: unknown) => { const n = String(v || '').replace(/\D/g, ''); return n.length === 11 && n[0] === '1' ? n.slice(1) : n; };
      const email = (v: unknown) => String(v || '').trim().toLowerCase();
      const rows = sqlite.prepare('SELECT * FROM crm_leads WHERE deleted_at IS NULL AND site=? AND id<>? ORDER BY created_at DESC,id DESC').all(current.site, current.id) as Row[];
      const candidates = rows.map(r => ({ ...summary(r), match: phone(current.phone).length >= 7 && phone(current.phone) === phone(r.phone) ? 'Same phone' : email(current.email) && email(current.email) === email(r.email) ? 'Same email' : email(current.name) === email(r.name) ? 'Same name' : '' })).filter(r => q ? `${r.name} ${r.phone || ''} ${r.email || ''} ${r.service || ''} #${r.id}`.toLowerCase().includes(q) || (q.replace(/\D/g, '').length >= 7 && phone(r.phone).includes(phone(q))) : r.match).sort((a, b) => Number(!!b.match) - Number(!!a.match)).slice(0, 30);
      res.set('Cache-Control', 'no-store').json(candidates);
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message }); }
  });
  app.get('/api/crm/lead-merge/preview', requireElevated, (req, res) => {
    try { res.set('Cache-Control', 'no-store').json(review(positive.parse(req.query.source), positive.parse(req.query.target)).preview); }
    catch (error: any) { res.status(error.status || 400).json({ message: error.message }); }
  });
  app.post('/api/crm/lead-merge', requireElevated, (req, res) => {
    try {
      const b = z.object({ source: positive, target: positive, version: z.string().length(64), requestKey: z.string().min(8).max(100), reviewed: z.literal(true) }).parse(req.body);
      const result = inventoryOnce(sqlite, req.user!.userId, b.requestKey, { operation: 'lead-merge', ...b }, () => {
        const r = review(b.source, b.target);
        if (r.preview.version !== b.version) fail('These leads changed. Refresh the preview and review them again.', 409);
        const now = Date.now();
        sqlite.prepare('INSERT INTO crm_lead_merges(source_id,target_id,merged_at,merged_by,snapshot) VALUES(?,?,?,?,?)').run(b.source, b.target, now, req.user!.userId, r.snapshot);
        const sourceIntake = r.tables.crm_lead_intake.find(i => i.lead_id === b.source);
        const retained = Object.entries(fieldLabels).filter(([key]) => r.source[key] != null && r.source[key] !== '').map(([key, label]) => `${label}: ${r.source[key]}`).join('\n');
        const notes = [r.target.notes, `Merged request #${b.source} — ${r.source.name}\n${retained}`, r.source.notes, sourceIntake ? `Original customer request details:\n${sourceIntake.context}\nConfirmed site visit: ${sourceIntake.survey_at ? new Date(sourceIntake.survey_at).toISOString() : 'Not recorded'}` : null].filter(Boolean).join('\n\n');
        const updates: Row = { notes, photos: JSON.stringify(r.combinedPhotos), created_at: Math.min(r.source.created_at, r.target.created_at), last_contact_at: Math.max(r.source.last_contact_at || 0, r.target.last_contact_at || 0) || null, stale: Math.min(r.source.stale, r.target.stale) };
        for (const key of ['phone', 'email', 'service_requested', 'service_area', 'assigned_to', 'client_id', 'campaign_id', 'utm_source', 'utm_medium', 'utm_campaign', 'next_follow_up_at']) updates[key] = r.target[key] == null || r.target[key] === '' ? r.source[key] : r.target[key];
        sqlite.prepare(`UPDATE crm_leads SET ${Object.keys(updates).map(k => `${k}=?`).join(',')} WHERE id=?`).run(...Object.values(updates), b.target);
        mergeIntake(b.source, b.target, now);
        mergeMeasurement(b.source, b.target, now);
        for (const table of LEAD_MERGE_REFERENCES) {
          // Increment revisions to reject editors opened before the relink. Issued
          // document contents, amounts, status, payments and snapshots never change.
          sqlite.prepare(`UPDATE ${table} SET lead_id=?${['quotes', 'projects'].includes(table) ? ',version=version+1' : table === 'fin_purchase_orders' ? ',revision=revision+1' : ''} WHERE lead_id=?`).run(b.target, b.source);
        }
        for (const task of r.tables.pm_tasks.filter(t => t.lead_id === b.source && t.auto_key)) {
          const key = String(task.auto_key).replace(new RegExp(`^(auto:(?:lead-follow-up|lead-quote-chase|stale-lead):)${b.source}(:|$)`), (_, prefix, suffix) => `${prefix}${b.target}${suffix}`);
          sqlite.prepare('UPDATE pm_tasks SET auto_key=? WHERE id=?').run(key, task.id);
        }
        sqlite.prepare("UPDATE crm_activities SET entity_id=? WHERE entity_type='lead' AND entity_id=?").run(b.target, b.source);
        sqlite.prepare("INSERT INTO crm_activities(entity_type,entity_id,user_id,kind,notes,created_at) VALUES('lead',?,?,'note',?,?)").run(b.target, req.user!.userId, `Merged duplicate lead #${b.source} into #${b.target}. Kept ${r.target.stage} status and its recorded values. Original details are in Notes.`, now);
        sqlite.prepare('UPDATE crm_leads SET deleted_at=? WHERE id=?').run(now, b.source);
        audit(req, 'crm.lead_merge', { targetType: 'lead', targetId: b.target, targetName: r.target.name, details: { source: b.source, target: b.target } });
        return { id: b.target };
      });
      res.json(result);
    } catch (error: any) { res.status(error.status || 400).json({ message: error.message }); }
  });
}
