import {GOOGLE_SITES,type Site} from './lead-measurement';
import {googleReport,reportingIdentity} from './google-reporting';
import {bingConfigured} from './bing-reporting';
import {reportingStatus} from './reporting-status';
import type {SearchConnections} from '../shared/search-reporting';

export function searchConnections(site:Site,start:string,end:string):SearchConnections {
  const config=GOOGLE_SITES[site],origin='https://'+config.domain+'/',id=encodeURIComponent(origin);
  return {
    googleConfigured:!!reportingIdentity(),bingConfigured:bingConfigured(),googleStatus:reportingStatus('google',site,start,end),
    googleSitemaps:googleReport(site,start,end,'sitemaps'),googleIndexing:googleReport(site,start,end,'indexing'),
    links:{
      analytics:`https://analytics.google.com/analytics/web/#/p${config.property}/reports/intelligenthome`,
      googleSearch:`https://search.google.com/search-console/performance/search-analytics?resource_id=${id}`,
      googleIndexing:`https://search.google.com/search-console/index?resource_id=${id}`,
      googleSitemaps:`https://search.google.com/search-console/sitemaps?resource_id=${id}`,
      bingSearch:`https://www.bing.com/webmasters/searchperf?siteUrl=${id}`,
      bingSitemaps:`https://www.bing.com/webmasters/sitemaps?siteUrl=${id}`,
      bingIndexing:`https://www.bing.com/webmasters/siteexplorer?siteUrl=${id}`,
      bingAi:`https://www.bing.com/webmasters/aiperformance?siteUrl=${id}`,
      indexNow:`https://www.bing.com/webmasters/indexnow?siteUrl=${id}`,
      businessProfiles:'https://business.google.com/locations',
    },
  };
}
