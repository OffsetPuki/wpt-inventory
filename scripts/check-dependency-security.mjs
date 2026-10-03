import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=fileURLToPath(new URL('../',import.meta.url));
const policy=JSON.parse(fs.readFileSync(path.join(root,'security/braces-patch.json')));
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json')));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
assert.equal(pkg.overrides.braces,policy.resolved,'The reviewed dependency source must stay pinned.');
const copies=Object.entries(lock.packages).filter(([name])=>name.endsWith('/braces'));
assert.ok(copies.length,'The patched dependency must exist in the lockfile.');

// The upstream patch is not released yet and retains version 3.0.3. npm audit
// therefore still reports its original advisory. Accept ONLY that advisory,
// ONLY after verifying every installed copy against the reviewed source and
// exercising its depth guards. New advisories and unpatched copies still fail.
for(const [relative,entry] of copies){
  assert.equal(entry.resolved,policy.resolved,`${relative}: unreviewed source`);
  assert.equal(entry.integrity,policy.integrity,`${relative}: changed integrity`);
  const dir=path.resolve(root,relative);
  assert.ok(dir.startsWith(root), 'Dependency path escapes the project.');
  for(const [file,expected] of Object.entries(policy.hashes)){
    const actual=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,file))).digest('hex');
    assert.equal(actual,expected,`${relative}/${file}: source differs from the reviewed patch`);
  }
  const require=createRequire(path.join(dir,'package.json'));
  const braces=require('./index.js');
  assert.deepEqual(braces.expand('src/{client,server}/*.{js,ts}'),['src/client/*.js','src/client/*.ts','src/server/*.js','src/server/*.ts']);
  for(const method of ['parse','compile','expand','stringify']){
    for(const [open,close] of [['{','}'],['(',')']]){
      assert.doesNotThrow(()=>braces[method](open.repeat(100)+'a'+close.repeat(100)));
      for(const depth of [101,4000])assert.throws(()=>braces[method](open.repeat(depth)+'a'+close.repeat(depth)),/exceeds max depth/);
    }
  }
  assert.throws(()=>braces.parse('{{a,b},c}',{maxDepth:1.5}),/exceeds max depth/);
  assert.throws(()=>braces.compile('{'.repeat(101)+'a'+'}'.repeat(101),{maxDepth:Infinity}),/exceeds max depth/);
  for(const method of ['compile','expand','stringify']){
    let ast={type:'text',value:'a'};
    for(let i=0;i<101;i++)ast={type:'brace',nodes:[ast]};
    assert.throws(()=>require(`./lib/${method}.js`)({type:'root',nodes:[ast]}),/exceeds max depth/);
  }
  const cycle={type:'paren',nodes:[{type:'text',value:'a'}]};cycle.parent=cycle;
  assert.throws(()=>require('./lib/expand.js')(cycle),/parent chain contains a cycle/);
  assert.equal(braces.stringify('{{a}}',{escapeInvalid:true}),'{{a}}');
}
console.log(`Verified the pinned braces depth-guard patch in ${copies.length} installed copy/copies.`);
if(process.argv.includes('--verify-only'))process.exit(0);

function onlyPatchedAdvisory(name,vulnerabilities,seen=new Set()){
  if(seen.has(name))return false;
  const v=vulnerabilities[name];
  if(!v||!Array.isArray(v.via)||!v.via.length)return false;
  const next=new Set(seen).add(name);
  return v.via.every(item=>typeof item==='string'
    ? onlyPatchedAdvisory(item,vulnerabilities,next)
    : item.name==='braces'&&item.url===policy.advisory);
}
// Fail-closed checks: the exception must never swallow an unrelated advisory.
assert.equal(onlyPatchedAdvisory('parent',{parent:{via:['braces']},braces:{via:[{name:'braces',url:policy.advisory}]}}),true);
assert.equal(onlyPatchedAdvisory('braces',{braces:{via:[{name:'braces',url:policy.advisory},{name:'braces',url:'https://example.test/new-advisory'}]}}),false);
assert.equal(onlyPatchedAdvisory('parent',{parent:{via:['missing']}}),false);

const result=spawnSync('npm',['audit','--json'],{cwd:root,encoding:'utf8',shell:process.platform==='win32',maxBuffer:8*1024*1024});
if(result.error||![0,1].includes(result.status))throw result.error||Error('Dependency audit failed to run.');
let report;
try{report=JSON.parse(result.stdout);}catch{throw Error('Dependency audit returned an invalid report.');}
if(report.error||report.auditReportVersion!==2||!report.vulnerabilities)throw Error('Dependency audit is unavailable; refusing to pass.');
const blocked=Object.entries(report.vulnerabilities).filter(([name,v])=>['high','critical'].includes(v.severity)&&!onlyPatchedAdvisory(name,report.vulnerabilities));
for(const [name,v] of Object.entries(report.vulnerabilities))console.log(`${name}: ${v.severity}${onlyPatchedAdvisory(name,report.vulnerabilities)?' — original advisory mitigated by verified pinned source':''}`);
if(blocked.length)throw Error('Unmitigated high/critical advisories: '+blocked.map(([name])=>name).join(', '));
console.log('Dependency security passed: no unmitigated high/critical advisories.');
