export type BingDaily = {date:string;clicks:number;impressions:number};
export type BingTop = {date:string;label:string;clicks:number;impressions:number};
export type BingReport = {
  configured:boolean;
  totals:{clicks:number;impressions:number;firstDate:string;lastDate:string;reportedDays:number}|null;
  topPages:BingTop[];
  topQueries:BingTop[];
  weeklyDate:string|null;
  pagesDate:string|null;
  crawl:{date:string;indexed:number|null;crawlErrors:number|null;blocked:number|null;links:number|null}|null;
  sitemaps:{url:string;status:string;lastCrawled:string|null}[]|null;
  fetchedAt:number|null;
  errors:{kind:string;message:string;attemptedAt:number}[];
};
export type SearchConnections = {
  googleConfigured:boolean;
  bingConfigured:boolean;
  googleStatus:{kind:string;attemptedAt:number;succeededAt:number|null;error:string|null}[];
  googleSitemaps:{fetchedAt:number;rows:{path:string;pending:boolean;errors:number;warnings:number;lastDownloaded:string|null;submitted:number}[]}|null;
  googleIndexing:{fetchedAt:number;verdict:string;coverage:string;lastCrawl:string|null}|null;
  links:{analytics:string;googleSearch:string;googleIndexing:string;googleSitemaps:string;bingSearch:string;bingSitemaps:string;bingIndexing:string;bingAi:string;indexNow:string;businessProfiles:string};
};
