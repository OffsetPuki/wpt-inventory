import { metric, ratio, websiteNames, type AnalyticsRow, type Website, type WebsiteResult } from './website-analytics';

export type PagePerformance = {
  id: string; site: Website; website: string; path: string; url: string;
  sessions: number | null; engaged: number | null; engagement: number | null;
  views: number | null; keyEvents: number | null; clicks: number | null;
  impressions: number | null; ctr: number | null; position: number | null;
  previousSessions: number | null; previousClicks: number | null;
};

// Join only the same site's public pathname. Never match pages across businesses,
// turn missing rows into zero, or include redacted customer links in recommendations.
export function publicPage(value: unknown, domain: string): string | null {
  if (typeof value !== 'string' || !/^(\/|https?:\/\/)/i.test(value) || value.startsWith('//')) return null;
  try {
    const url = new URL(value, `https://${domain}`);
    if (url.hostname !== domain || !['http:', 'https:'].includes(url.protocol)) return null;
    const pathname = url.pathname;
    if (/^\/(?:private|other|api|invoice|quote|portal|preview)(?:\/|$)/i.test(pathname) || value.startsWith('(')) return null;
    return pathname;
  } catch { return null; }
}

export function pagePerformance(sites: WebsiteResult[]): PagePerformance[] {
  return sites.flatMap(site => {
    const pages = new Map<string, PagePerformance>();
    const get = (row: AnalyticsRow, key: string) => {
      const path = publicPage(row[key], site.domain);
      if (!path) return null;
      if (!pages.has(path)) pages.set(path, {
        id: `${site.site}:${path}`, site: site.site, website: websiteNames[site.site],
        path, url: `https://${site.domain}${path}`, sessions: null, engaged: null, engagement: null,
        views: null, keyEvents: null, clicks: null, impressions: null, ctr: null, position: null,
        previousSessions: null, previousClicks: null,
      });
      return pages.get(path)!;
    };
    const add = (a: number | null, b: number | null) => b === null ? a : (a ?? 0) + b;
    for (const row of site.current.reports.landing?.rows || []) {
      const page = get(row, 'landingPagePlusQueryString'); if (!page) continue;
      page.sessions = add(page.sessions, metric(row, 'sessions'));
      page.engaged = add(page.engaged, metric(row, 'engagedSessions'));
      page.keyEvents = add(page.keyEvents, metric(row, 'keyEvents'));
    }
    for (const row of site.current.reports.pages?.rows || []) {
      const page = get(row, 'pagePath'); if (page) page.views = add(page.views, metric(row, 'screenPageViews'));
    }
    for (const row of site.current.search?.rows || []) {
      const page = get(row, 'page'); if (!page) continue;
      const impressions = metric(row, 'impressions'), position = metric(row, 'position');
      const oldImpressions = page.impressions;
      page.clicks = add(page.clicks, metric(row, 'clicks'));
      page.impressions = add(oldImpressions, impressions);
      page.position = impressions !== null && position !== null && (oldImpressions === null || page.position !== null)
        ? ratio((page.position ?? 0) * (oldImpressions ?? 0) + position * impressions, page.impressions) : null;
    }
    for (const row of site.previous.reports.landing?.rows || []) {
      const path = publicPage(row.landingPagePlusQueryString, site.domain), page = path ? pages.get(path) : null;
      if (page) page.previousSessions = add(page.previousSessions, metric(row, 'sessions'));
    }
    for (const row of site.previous.search?.rows || []) {
      const path = publicPage(row.page, site.domain), page = path ? pages.get(path) : null;
      if (page) page.previousClicks = add(page.previousClicks, metric(row, 'clicks'));
    }
    return [...pages.values()].map(page => ({ ...page, engagement: ratio(page.engaged, page.sessions), ctr: ratio(page.clicks, page.impressions) }));
  });
}

export function pageAdvice(page: PagePerformance): { title: string; body: string; tone: 'amber' | 'teal' | 'blue' }[] {
  const advice: ReturnType<typeof pageAdvice> = [];
  if ((page.impressions ?? 0) >= 50 && page.ctr !== null && page.ctr < .02 && page.position !== null && page.position <= 20) {
    advice.push({ title: 'Visible in search, few clicks', body: 'Compare the search terms below with the page title and description. Make the service, location and reason to choose you clear.', tone: 'amber' });
  }
  if ((page.sessions ?? 0) >= 20 && page.engagement !== null && page.engagement < .4) {
    advice.push({ title: 'Help arriving visitors take the next step', body: 'Review the first screen on mobile. Match the message to the search, show relevant work and make contacting you easy. Test one change at a time.', tone: 'amber' });
  }
  if ((page.sessions ?? 0) >= 20 && page.engagement !== null && page.engagement >= .6) {
    advice.push({ title: 'A useful page to learn from', body: 'Visitors tend to engage after landing here. Compare its content and navigation with similar pages; engagement alone does not prove sales.', tone: 'teal' });
  }
  if (page.position !== null && page.position >= 8 && page.position <= 20 && (page.impressions ?? 0) >= 50) {
    advice.push({ title: 'Room to improve search visibility', body: 'Average position is between 8 and 20. Answer the reported searches more directly and add relevant internal links from related pages.', tone: 'blue' });
  }
  if (!advice.length) advice.push({ title: 'Build a reliable comparison', body: 'No threshold-based priority is flagged. Review the available searches and visits, or choose a longer date range before deciding what to change.', tone: 'blue' });
  return advice;
}

export type GroupValue = { label: string; value: number };
export function groupMetric(rows: AnalyticsRow[], dimension: string, key: string): GroupValue[] {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const value = metric(row, key); if (value === null || value < 0) continue;
    const label = String(row[dimension] || 'Unknown');
    groups.set(label, (groups.get(label) ?? 0) + value);
  }
  return [...groups].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}
