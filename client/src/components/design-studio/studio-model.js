import {apiRequest,getAuthToken} from '@/lib/queryClient';

let cached=null;
// One authenticated download shared by both viewers. Each scene receives a copy
// because animation writes to film buffers; the cached source must stay immutable.
export async function loadStudioModel(revision='current'){
 const key=getAuthToken()+'|'+revision;
 if(cached?.key!==key){
  const entry={key,promise:null};cached=entry;
  entry.promise=apiRequest('GET','/api/design-studio/film-table/geometry').then(r=>new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()).catch(e=>{if(cached===entry)cached=null;throw e;});
 }
 const [buffer,lib]=await Promise.all([cached.promise,import('@/lib/generated/film-table-runtime.js')]);
 if(getAuthToken()+'|'+revision!==key)throw new Error('Session changed. Reopen the model.');
 const model=lib.decodeFilmTableAsset(buffer.slice(0));
 if(revision!=='current'&&model.root.userData.studioRevision!==revision){cached=null;throw new Error('The model revision changed. Refresh the workspace before continuing.');}
 return {model,lib};
}
export function clearStudioModelCache(){cached=null;}
