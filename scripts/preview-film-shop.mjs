import {testApp} from './test-app.mjs';
const app=await testApp({serve:true});
// The isolated fixture uses only its generated test accounts and temporary DB.
app.sqlite.prepare("UPDATE users SET credential_type='password' WHERE role='owner'").run();
console.log('FILM_SHOP_PREVIEW '+app.base+'/#/design-studio');
process.on('SIGINT',async()=>{await app.close();process.exit(0);});
process.on('SIGTERM',async()=>{await app.close();process.exit(0);});
