// Synthetic analytics only. Shared by isolated API/browser tests, never production.
export function seedWebsiteAnalytics(sqlite,current,previous) {
  const domains={metals:'www.cjmmetals.com',concrete:'www.cjm-concrete.com',insulation:'www.cjminsulation.com',trades:'www.cjmtrades.com'};
  const save=sqlite.prepare('INSERT OR REPLACE INTO mk_google_reports VALUES(?,?,?,?,?,?)');
  let index=0;
  for(const [site,domain] of Object.entries(domains)) {
    index++;
    for(const [offset,range] of [current,previous].entries()) {
      const weight=(5-index)*(offset?1:2),sessions=weight*40,clicks=weight*8;
      const write=(kind,payload)=>save.run(site,range.start,range.end,kind,JSON.stringify({productionHost:domain,version:1,...payload}),Date.now());
      const rows=(kind,rows)=>write('analytics:'+kind,{rows});
      rows('summary',[{sessions,totalUsers:sessions-8,newUsers:sessions-20,engagedSessions:sessions*.7,screenPageViews:sessions*3,userEngagementDuration:sessions*45,keyEvents:weight*2}]);
      const days=[];for(let time=Date.parse(range.start);time<=Date.parse(range.end);time+=86400000)days.push(new Date(time).toISOString().slice(0,10));
      rows('daily',days.map((date,i)=>({date:date.replaceAll('-',''),sessions:Math.round(sessions/days.length)+(i%4),engagedSessions:4,screenPageViews:15})));
      rows('searchDaily',days.slice(0,-2).map((date,i)=>({date,clicks:weight+(i%3),impressions:weight*20+i,ctr:.03,position:8})));
      rows('channels',[{sessionDefaultChannelGroup:'Organic Search',sessionSource:'google',sessionMedium:'organic',sessionCampaignName:'(organic)',sessions:sessions*.65,engagedSessions:sessions*.5,keyEvents:weight},{sessionDefaultChannelGroup:'Referral',sessionSource:'chatgpt.com',sessionMedium:'referral',sessionCampaignName:'(referral)',sessions:weight*3,engagedSessions:weight*2,keyEvents:1}]);
      rows('landing',[{landingPagePlusQueryString:'/services/custom-gates',sessions:sessions*.65,engagedSessions:weight*5,keyEvents:weight}]);
      rows('pages',[{pagePath:'/services/custom-gates',screenPageViews:sessions*2,userEngagementDuration:weight*300}]);
      rows('devices',[{deviceCategory:'mobile',browser:'Chrome',sessions,engagedSessions:sessions*.7}]);
      rows('locations',[{country:'United States',region:'Texas',city:'El Paso',sessions,engagedSessions:sessions*.7}]);
      rows('events',[{eventName:'page_view',eventCount:sessions*3,keyEvents:0},{eventName:'generate_lead',eventCount:weight,keyEvents:weight}]);
      rows('siteSearch',[{searchTerm:'custom gates',eventCount:weight}]);
      rows('searchDevices',[{device:'MOBILE',clicks,impressions:weight*300,ctr:clicks/(weight*300),position:7}]);
      rows('searchCountries',[{country:'usa',clicks,impressions:weight*300,ctr:clicks/(weight*300),position:7}]);
      rows('queryPages',[{query:'custom gates el paso',page:'/services/custom-gates',clicks,impressions:weight*300,ctr:.03,position:8}]);
      write('searchTotals',{totals:{clicks,impressions:weight*300,position:8+index}});
      write('search',{rows:[{page:'/services/custom-gates',clicks:2,impressions:weight*300,ctr:.01,position:8}]});
      write('queries',{rows:Array.from({length:22},(_,i)=>({query:i===0?'custom gates el paso':'metal gate style '+i,clicks:Math.max(0,clicks-i),impressions:weight*300-i,ctr:.03,position:i+3}))});
    }
  }
}
