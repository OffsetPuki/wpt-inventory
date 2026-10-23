// Disposable local review instance; never opens the production database.
import { testApp } from './test-app.mjs';
import bcrypt from 'bcryptjs';
const app=await testApp({serve:true});
// Fully configured synthetic account for browser QA, only in this temporary DB.
app.sqlite.prepare("UPDATE users SET pin=?,credential_type='password' WHERE name='Owner'").run(bcrypt.hashSync('Contacts-preview-only-2026!',10));
console.log(`Contacts preview: ${app.base}/#/contacts`);
process.on('SIGINT',async()=>{await app.close();process.exit(0);});
