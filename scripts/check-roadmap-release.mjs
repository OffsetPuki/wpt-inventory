import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const roadmap=JSON.parse(fs.readFileSync(new URL('../docs/approved-roadmap-2026-10-13.json',import.meta.url),'utf8'));
const progress=JSON.parse(fs.readFileSync(new URL('../docs/roadmap-progress.json',import.meta.url),'utf8'));
// Verification is recorded after the final commit, outside tracked sources.
// Embedding that same commit hash in a tracked file would change the commit
// again and make a clean, exactly-tested release impossible.
const evidencePath=process.env.ROADMAP_RELEASE_EVIDENCE||new URL('../roadmap-release-evidence.json',import.meta.url);
const release=fs.existsSync(evidencePath)?JSON.parse(fs.readFileSync(evidencePath,'utf8')):{};
const expected=roadmap.backlog.map(item=>item.id);
const tracked=progress.items||[];
const failures=[];
if(expected.length!==64||new Set(expected).size!==64)failures.push('The approved 64-item scope changed. Review the roadmap before release.');
for(const id of expected){
 const matches=tracked.filter(item=>item.id===id),item=matches[0];
 if(matches.length!==1||item.status!=='complete'||!item.evidence?.length)failures.push(id+': implementation and acceptance evidence are not complete.');
}
for(const id of ['R30','R36']){
 if(id==='R36'&&progress.items.find(item=>item.id===id)?.physicalVerification?.required===false&&progress.scopeDecisions?.some(d=>d.item===id&&d.authority==='user'&&d.instruction==='dont worry about that'))continue;
 const evidence=tracked.find(item=>item.id===id)?.physicalEvidence;
 if(!evidence?.verifiedBy||!evidence?.date||!evidence?.scope||evidence.result!=='passed')failures.push(id+': physical verification is required; simulation is not a substitute.');
}
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(release.testedCommit!==head)failures.push('The final committed revision has not passed the recorded release checks.');
if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())failures.push('Working files differ from the tested release commit.');
for(const check of ['typecheck','build','api','browser','security','restore','performance']){
 if(release.releaseChecks?.[check]?.status!=='passed'||release.releaseChecks[check].commit!==head)failures.push(check+': a passing check for the release commit is missing.');
}
if(release.productionBackup?.status!=='verified'||!release.productionBackup?.createdAt||!release.productionBackup?.sha256||!release.productionBackup?.restoredAt||!release.productionBackup?.privateLocation)failures.push('Production backup: a checksum-verified snapshot and successful isolated restore are required.');
if(!release.rollback?.deploymentId||!release.rollback?.commit||!release.rollback?.instructions)failures.push('Rollback: record the previous successful deployment and its recovery instructions.');
if(failures.length){
 console.error(`LIVE RELEASE ON HOLD — ${tracked.filter(i=>i.status==='complete'&&i.evidence?.length).length}/64 items marked complete.`);
 for(const failure of failures)console.error(' • '+failure);
 process.exitCode=1;
}else console.log('All 64 roadmap items and required release checks are ready for this commit.');
