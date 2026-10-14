import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';

// Review inventory, never a deletion tool. Runtime strings, deployment copies,
// public URLs and generated assets can be valid without a static import.
const root=process.cwd(),normalize=p=>p.replaceAll('\\','/');
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).split(/\r?\n/).filter(p=>p&&fs.existsSync(p)))];
const fileSet=new Set(files),sources=files.filter(p=>/\.(?:[cm]?[jt]sx?|css|html)$/.test(p));
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile).config,options=ts.convertCompilerOptionsFromJson(config.compilerOptions,root).options;
const edges=new Map(sources.map(p=>[p,new Set()])),dynamic=[];
function resolve(from,spec){
 const resolved=ts.resolveModuleName(spec,path.resolve(from),options,ts.sys).resolvedModule?.resolvedFileName;
 if(resolved){const local=normalize(path.relative(root,resolved));if(fileSet.has(local))return local;}
 const base=spec.startsWith('@/')?'client/src/'+spec.slice(2):spec.startsWith('@shared/')?'shared/'+spec.slice(8):spec.startsWith('.')?normalize(path.join(path.dirname(from),spec)):spec;
 return [base,base+'.ts',base+'.tsx',base+'.js',base+'.jsx',base+'/index.ts',base+'/index.tsx'].find(p=>fileSet.has(p));
}
for(const source of sources){
 const text=fs.readFileSync(source,'utf8'),tree=ts.createSourceFile(source,text,ts.ScriptTarget.Latest,true);
 function visit(node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)){
   if(node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){const local=resolve(source,node.moduleSpecifier.text);if(local)edges.get(source).add(local);}
  }else if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(tree)==='require')){
   if(node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])){const local=resolve(source,node.arguments[0].text);if(local)edges.get(source).add(local);}
   else dynamic.push({file:source,line:tree.getLineAndCharacterOfPosition(node.getStart()).line+1,kind:'computed import'});
  }
  if(ts.isStringLiteralLike(node)){
   const value=node.text;
   for(const candidate of [value,normalize(path.join(path.dirname(source),value)),value.startsWith('/')?'client/public'+value:''])if(fileSet.has(candidate))edges.get(source).add(candidate);
  }
  ts.forEachChild(node,visit);
 }
 if(/\.[cm]?[jt]sx?$/.test(source))visit(tree);
 else for(const match of text.matchAll(/(?:src=|href=|url\()\s*["']?([^\s"')>]+)/g)){const local=resolve(source,match[1]);if(local)edges.get(source).add(local);}
}
function reachable(roots){const seen=new Set(),queue=[...roots];while(queue.length){const p=queue.pop();if(seen.has(p))continue;seen.add(p);for(const next of edges.get(p)||[])queue.push(next);}return seen;}
const production=reachable(['client/src/main.tsx','server/index.ts','client/index.html','vite.config.ts']);
const support=reachable(['drizzle.config.ts',...sources.filter(p=>/^(scripts|tests)\//.test(p)||p.endsWith('.d.ts'))]);
const candidates=sources.filter(p=>/^(client\/src|server|shared)\//.test(p)&&!production.has(p)&&!support.has(p)).map(p=>({path:p,bytes:fs.statSync(p).size,status:'Review needed; absence of static reachability is not proof of disuse'}));
const testOnly=sources.filter(p=>/^(client\/src|server|shared)\//.test(p)&&!production.has(p)&&support.has(p));
const report={generatedAt:new Date().toISOString(),scope:'Tracked and new non-ignored source files; import, route-module, literal file and public URL references',limitations:'Computed paths, deployment tools, external public links and generated assets require manual review. Nothing is deleted by this report.',sourceFiles:sources.length,productionReachable:production.size,supportReachable:support.size,dynamicImports:dynamic,reviewCandidates:candidates,testOrScriptOnly:testOnly,confirmedRemovals:[{symbols:['purgeOldDeletedItems','purgeOldDeletedProjects'],reason:'Only callers were the automatic 30-day reaper. Those calls were removed to preserve linked financial and file history. Authentication reaping remains.',verification:'Type check, deleted-job retention and restore regression checks'}]};
fs.writeFileSync('docs/code-usage-audit.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({sourceFiles:report.sourceFiles,productionReachable:production.size,reviewCandidates:candidates.length,candidateBytes:candidates.reduce((n,r)=>n+r.bytes,0),computedImports:dynamic.length,deletedFiles:0}));
