import assert from 'node:assert/strict';
import { testApp } from './test-app.mjs';
const app=await testApp();
const {api,owner}=app;
try {
  assert.equal((await api('/api/contacts')).status,401);
  assert.equal((await api('/api/contacts','POST',{name:'',type:'supplier'},owner)).status,400);
  assert.equal((await api('/api/contacts','POST',{name:'Unsafe URL',type:'supplier',website:'javascript:alert(1)'},owner)).status,400);
  let response=await api('/api/contacts','POST',{name:'Test Supplier',company:'Fixture Materials',type:'supplier',email:'buyer@example.test',services:'Steel',notes:'Call before delivery'},owner);
  assert.equal(response.status,201);const first=response.data;
  response=await api(`/api/contacts/${first.id}`,'PUT',{...first,phone:'555-0100'},owner);
  assert.equal(response.status,200);assert.equal(response.data.version,2);const updated=response.data;
  assert.equal((await api(`/api/contacts/${first.id}`,'PUT',{...first,notes:'Stale overwrite'},owner)).status,409);
  response=await api(`/api/contacts/${first.id}`,'PUT',{...updated,archived:true},owner);assert.equal(response.status,200);assert.equal(response.data.archived,true);
  response=await api(`/api/contacts/${first.id}`,'PUT',{...response.data,archived:false},owner);assert.equal(response.status,200);
  const list=await api('/api/contacts','GET',undefined,owner);assert.ok(list.data.some(c=>c.id===first.id&&c.phone==='555-0100'&&!c.archived));
  await api('/api/users','POST',{name:'Contacts Worker',pin:'1234',role:'worker'},owner);
  const login=await api('/api/auth/login','POST',{name:'Contacts Worker',pin:'1234'});
  assert.equal((await api('/api/contacts','GET',undefined,login.data.token)).status,403);
  assert.equal((await api('/api/contacts','POST',{name:'Denied',type:'other'},login.data.token)).status,403);
  console.log('PASS contacts: validation, authenticated owner access, persistent CRUD, archive/restore, stale-edit protection');
} finally {await app.close();}
