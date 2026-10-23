import { z } from 'zod';
export const CONTACT_TYPES = ['supplier','provider','subcontractor','customer','other'] as const;
export const CONTACT_LABELS: Record<typeof CONTACT_TYPES[number],string> = {supplier:'Supplier',provider:'Service provider',subcontractor:'Subcontractor',customer:'Customer',other:'Other'};
const field = (max=200) => z.string().trim().max(max).default('');
export const contactInput = z.object({
  name:z.string().trim().min(1,'Contact name is required').max(200),
  type:z.enum(CONTACT_TYPES), company:field(), title:field(),
  email:z.union([z.literal(''),z.string().trim().email().max(254)]).default(''),
  phone:field(60), website:field(500).refine(v=>!v || /^https?:\/\//i.test(v)&&URL.canParse(v),'Use an http:// or https:// website'),
  address:field(500), services:field(500), notes:field(5000), archived:z.boolean().default(false),
});
export type ContactInput = z.infer<typeof contactInput>;
export type BusinessContact = ContactInput & {id:number;version:number;createdAt:number;updatedAt:number};
