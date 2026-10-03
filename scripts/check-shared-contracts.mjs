import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url);
const contracts=JSON.parse(fs.readFileSync(new URL('shared-contracts.json',root),'utf8'));
for(const contract of Object.values(contracts))for(const [file,hash] of Object.entries(contract.files)) {
 const actual=createHash('sha256').update(fs.readFileSync(new URL(file,root),'utf8').replaceAll('\r\n','\n')).digest('hex');
 assert.equal(actual,hash,file+' diverged from the versioned shared contract. Update and verify every consumer together.');
}
console.log('Versioned shared contracts verified.');
