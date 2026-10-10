import type { ReportName } from '../shared/website-analytics';

type Definition={ dimensions:string[]; metrics:string[]; search?:boolean; event?:string };
export const analyticsDefinitions:Record<ReportName,Definition> = {
  summary:{dimensions:[],metrics:['sessions','totalUsers','newUsers','engagedSessions','screenPageViews','userEngagementDuration','keyEvents']},
  daily:{dimensions:['date'],metrics:['sessions','engagedSessions','screenPageViews']},
  channels:{dimensions:['sessionDefaultChannelGroup','sessionSource','sessionMedium','sessionCampaignName'],metrics:['sessions','engagedSessions','keyEvents']},
  landing:{dimensions:['landingPagePlusQueryString'],metrics:['sessions','engagedSessions','keyEvents']},
  pages:{dimensions:['pagePath'],metrics:['screenPageViews','userEngagementDuration']},
  devices:{dimensions:['deviceCategory','browser'],metrics:['sessions','engagedSessions']},
  locations:{dimensions:['country','region','city'],metrics:['sessions','engagedSessions']},
  events:{dimensions:['eventName'],metrics:['eventCount','keyEvents']},
  siteSearch:{dimensions:['searchTerm'],metrics:['eventCount'],event:'view_search_results'},
  searchDaily:{dimensions:['date'],metrics:['clicks','impressions','ctr','position'],search:true},
  searchDevices:{dimensions:['device'],metrics:['clicks','impressions','ctr','position'],search:true},
  searchCountries:{dimensions:['country'],metrics:['clicks','impressions','ctr','position'],search:true},
  queryPages:{dimensions:['query','page'],metrics:['clicks','impressions','ctr','position'],search:true},
};
export function productionFilter(domain:string) {
  return {andGroup:{expressions:[
    {filter:{fieldName:'hostName',stringFilter:{matchType:'EXACT',value:domain,caseSensitive:false}}},
    {notExpression:{filter:{fieldName:'sessionSource',inListFilter:{values:['release_check','qa'],caseSensitive:false}}}},
  ]}};
}
export async function collectWebsiteReport(
  name:ReportName, config:{domain:string;property:string}, start:string, end:string,
  post:(url:string,body:unknown)=>Promise<any>, safePage:(value:string)=>string,
) {
  const def=analyticsDefinitions[name],limit=5000;
  const filter: any=productionFilter(config.domain);
  if(def.event)filter.andGroup.expressions.push({filter:{fieldName:'eventName',stringFilter:{matchType:'EXACT',value:def.event}}});
  const result=await post(def.search
    ? `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent('https://'+config.domain+'/')}/searchAnalytics/query`
    : `https://analyticsdata.googleapis.com/v1beta/properties/${config.property}:runReport`,
    def.search ? {startDate:start,endDate:end,dimensions:def.dimensions,type:'web',dataState:'final',rowLimit:limit,aggregationType:name==='queryPages'?'byPage':'byProperty'}
    : {dateRanges:[{startDate:start,endDate:end}],dimensions:def.dimensions.map(name=>({name})),metrics:def.metrics.map(name=>({name})),dimensionFilter:filter,limit,orderBys:[{metric:{metricName:def.metrics[0]},desc:true}]});
  const rows=(result.rows||[]).map((row:any)=>{
    const values:Record<string,string|number>={};
    def.dimensions.forEach((key,index)=>{
      let value=String(def.search?row.keys?.[index]:row.dimensionValues?.[index]?.value ?? '(not set)');
      if(['landingPagePlusQueryString','pagePath','page'].includes(key))value=safePage(value);
      if(key==='searchTerm' && /@|\d{7,}/.test(value))value='[redacted]';
      values[key]=value.slice(0,240);
    });
    def.metrics.forEach((key,index)=>values[key]=Number(def.search?row[key]:row.metricValues?.[index]?.value)||0);
    return values;
  });
  // An empty successful summary is measured zero, unlike an absent cache.
  if(name==='summary'&&!rows.length)rows.push(Object.fromEntries(def.metrics.map(key=>[key,0])));
  // Query parameters were removed from landing pages: combine their additive counts.
  if(name==='landing') {
    const grouped=new Map<string,Record<string,string|number>>();
    for(const row of rows){const key=String(row.landingPagePlusQueryString),prior=grouped.get(key);if(prior)for(const metric of def.metrics)prior[metric]=Number(prior[metric])+Number(row[metric]);else grouped.set(key,{...row});}
    rows.splice(0,rows.length,...grouped.values());
  }
  const metadata=result.metadata||{};
  return {version:1,productionHost:config.domain,rows,
    partial:def.search?(result.rows?.length||0)>=limit:Number(result.rowCount)>limit || !!metadata.dataLossFromOtherRow,
    thresholded:!!metadata.subjectToThresholding,sampled:!!metadata.samplingMetadatas?.length,timeZone:metadata.timeZone||null};
}

// Bound all Google reports together, including simultaneous site refreshes.
let running=0;
const waiting:(()=>void)[]=[];
export async function withReportingSlot<T>(work:()=>Promise<T>):Promise<T> {
  if(running>=3)await new Promise<void>(resolve=>waiting.push(resolve));
  else running++;
  try{return await work();}finally{const next=waiting.shift();if(next)next();else running--;}
}
