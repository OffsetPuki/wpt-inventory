import crypto from 'node:crypto';
import type {Express} from 'express';
import {z} from 'zod';
import {sqlite} from './storage';
import {requireElevated} from './auth';
import {audit} from './audit';
export function initializeCustomerAccounts(){sqlite.exec(`CREATE TABLE IF NOT EXISTS crm_account_contacts(contact_id INTEGER PRIMARY KEY,account_id INTEGER NOT NULL,primary_billing INTEGER NOT NULL DEFAULT 0,CHECK(contact_id!=account_id));CREATE INDEX IF NOT EXISTS crm_account_contacts_account ON crm_account_contacts(account_id);CREATE UNIQUE INDEX IF NOT EXISTS crm_account_primary_billing ON crm_account_contacts(account_id) WHERE primary_billing=1;`);}
export function accountVersion(){return crypto.createHash('sha256').update(JSON.stringify(sqlite.prepare('SELECT * FROM crm_account_contacts ORDER BY contact_id').all())).digest('hex');}
export function customerAccountIds(id:number):number[]{
 const parent=sqlite.prepare('SELECT a.id FROM crm_account_contacts x JOIN crm_clients a ON a.id=x.account_id AND a.deleted_at IS NULL WHERE x.contact_id=?').get(id) as {id:number}|undefined;
 const root=parent?.id||id;
 return [root,...(sqlite.prepare('SELECT c.id FROM crm_account_contacts x JOIN crm_clients c ON c.id=x.contact_id AND c.deleted_at IS NULL WHERE x.account_id=?').all(root) as {id:number}[]).map(c=>c.id)];
}
export function billingContact(id:number):{id:number;name:string;email:string|null}|undefined{
 const ids=customerAccountIds(id);
 return (sqlite.prepare('SELECT c.id,c.name,c.email FROM crm_account_contacts x JOIN crm_clients c ON c.id=x.contact_id WHERE x.account_id=? AND x.primary_billing=1 AND c.deleted_at IS NULL').get(ids[0])||sqlite.prepare('SELECT id,name,email FROM crm_clients WHERE id=? AND deleted_at IS NULL').get(id)) as {id:number;name:string;email:string|null}|undefined;
}
export function accountSummary(id:number){
 const ids=customerAccountIds(id);
 const rows=sqlite.prepare('SELECT c.id,c.name,c.company,c.email,c.phone,coalesce(x.primary_billing,0) primaryBilling FROM crm_clients c LEFT JOIN crm_account_contacts x ON x.contact_id=c.id WHERE c.id IN (SELECT value FROM json_each(?)) AND c.deleted_at IS NULL ORDER BY c.id').all(JSON.stringify(ids)) as any[];
 const membership=sqlite.prepare('SELECT account_id FROM crm_account_contacts WHERE contact_id=?').get(id) as any;
 return {account:rows.find(c=>c.id===ids[0])||null,contacts:rows.filter(c=>c.id!==ids[0]),membership:membership?.account_id||null,version:accountVersion()};
}
/** Combining identities also preserves the explicitly reviewed company membership. */
export function mergeAccountContacts(source:number,target:number){
 const from=sqlite.prepare('SELECT * FROM crm_account_contacts WHERE contact_id=?').get(source) as any;
 const to=sqlite.prepare('SELECT * FROM crm_account_contacts WHERE contact_id=?').get(target) as any;
 if(from&&to&&from.account_id!==to.account_id)throw new Error('These contacts belong to different companies. Review their company links before combining them.');
 const children=(sqlite.prepare('SELECT count(*) n FROM crm_account_contacts WHERE account_id=?').get(source) as any).n;
 if(children&&to&&to.account_id!==source)throw new Error('The retained contact belongs to another company. Review its company link first.');
 const targetChildren=(sqlite.prepare('SELECT count(*) n FROM crm_account_contacts WHERE account_id=?').get(target) as any).n;
 if(targetChildren&&from&&from.account_id!==target)throw new Error('The source contact belongs to another company. Review its company link first.');
 if(to?.account_id===source)sqlite.prepare('DELETE FROM crm_account_contacts WHERE contact_id=?').run(target);
 if(children){
   const hasPrimary=sqlite.prepare('SELECT 1 FROM crm_account_contacts WHERE account_id=? AND primary_billing=1').get(target);
   if(hasPrimary)sqlite.prepare('UPDATE crm_account_contacts SET primary_billing=0 WHERE account_id=?').run(source);
   sqlite.prepare('UPDATE crm_account_contacts SET account_id=? WHERE account_id=?').run(target,source);
 }
 if(from){
   sqlite.prepare('DELETE FROM crm_account_contacts WHERE contact_id=?').run(source);
   if(from.account_id!==target&&!to&&!targetChildren)sqlite.prepare('INSERT INTO crm_account_contacts VALUES(?,?,?)').run(target,from.account_id,from.primary_billing);
   else if(to&&from.primary_billing)sqlite.prepare('UPDATE crm_account_contacts SET primary_billing=1 WHERE contact_id=?').run(target);
 }
}
export function registerCustomerAccounts(app:Express){
 initializeCustomerAccounts();
 app.get('/api/suite/customers/:id/account',requireElevated,(req,res)=>{
   const id=Number(req.params.id);if(!sqlite.prepare('SELECT 1 FROM crm_clients WHERE id=? AND deleted_at IS NULL').get(id||0))return res.status(404).json({message:'Customer not found.'});
   res.json(accountSummary(id));
 });
 app.patch('/api/suite/customers/:id/account',requireElevated,(req,res)=>{try{
   const id=z.coerce.number().int().positive().parse(req.params.id),body=z.object({accountId:z.number().int().positive().nullable(),primary:z.boolean(),version:z.string()}).parse(req.body);
   const result=sqlite.transaction(()=>{
     if(body.version!==accountVersion())throw Object.assign(new Error('Company links changed. Reload the account and review your selection.'),{status:409});
     const active=(value:number)=>sqlite.prepare('SELECT 1 FROM crm_clients WHERE id=? AND deleted_at IS NULL').get(value);
     if(!active(id)||(body.accountId&&!active(body.accountId)))throw new Error('Choose active customer records.');
     const before=accountSummary(id);
     if(body.accountId){
       if(id===body.accountId)throw new Error('Choose a different company record.');
       if(sqlite.prepare('SELECT 1 FROM crm_account_contacts WHERE account_id=? OR contact_id=?').get(id,body.accountId))throw new Error('A company cannot also be a contact. Choose the main company record.');
       if(body.primary)sqlite.prepare('UPDATE crm_account_contacts SET primary_billing=0 WHERE account_id=?').run(body.accountId);
       sqlite.prepare('INSERT INTO crm_account_contacts VALUES(?,?,?) ON CONFLICT(contact_id) DO UPDATE SET account_id=excluded.account_id,primary_billing=excluded.primary_billing').run(id,body.accountId,+body.primary);
     }else sqlite.prepare('DELETE FROM crm_account_contacts WHERE contact_id=?').run(id);
     audit(req,'crm.account_link',{targetType:'client',targetId:id,details:{previousAccountId:before.membership,accountId:body.accountId,primary:body.primary}});
     return accountSummary(id);
   })();res.json(result);
 }catch(e:any){res.status(e.status||400).json({message:e.message});}});
}
