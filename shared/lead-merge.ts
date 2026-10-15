import type { LeadStage, LeadSource, LeadSite } from './crm-schema';

export interface MergeLeadSummary {
  id: number; name: string; phone: string | null; email: string | null;
  site: LeadSite; source: LeadSource; stage: LeadStage; service: string | null;
  estimatedValueCents: number; revenueClosedCents: number; createdAt: number;
  match?: string;
}
export interface LeadMergePreview {
  source: MergeLeadSummary; target: MergeLeadSummary; version: string;
  photos: number; activities: number; quotes: number; jobs: number; invoices: number; tasks: number; designs: number;
  differences: { label: string; kept: string; other: string }[];
}
