import assert from 'node:assert/strict';
import { groupMetric, pageAdvice, pagePerformance, publicPage } from '../shared/page-performance.ts';
const report = rows => ({ rows, fetchedAt: Date.now() });
const site = (name, domain) => ({ site: name, domain, current: { reports: { landing: report([
  { landingPagePlusQueryString: '/service?campaign=a', sessions: 20, engagedSessions: 5, keyEvents: 0 },
  { landingPagePlusQueryString: '/service?campaign=b', sessions: 80, engagedSessions: 25, keyEvents: 2 },
  { landingPagePlusQueryString: '/private', sessions: 8000, engagedSessions: 8000 },
  { landingPagePlusQueryString: '/new', sessions: 0, engagedSessions: 0 },
]), pages: report([{ pagePath: '/service', screenPageViews: 150 }, { pagePath: '/views-only', screenPageViews: 80 }]) }, search: report([
  { page: `https://${domain}/service`, clicks: 1, impressions: 100, position: 4 },
  { page: '/service?source=second', clicks: 1, impressions: 300, position: 12 },
  { page: 'https://unrelated.example/service', clicks: 999, impressions: 999, position: 1 },
]) }, previous: { reports: { landing: report([{ landingPagePlusQueryString: '/service', sessions: 50 }]) }, search: report([{ page: '/service', clicks: 0 }]) } });
const rows = pagePerformance([site('metals', 'www.cjmmetals.com'), site('concrete', 'www.cjm-concrete.com')]);
assert.equal(rows.length, 6);
const page = rows.find(p => p.id === 'metals:/service');
assert.equal(page.sessions, 100); assert.equal(page.engagement, .3); assert.equal(page.views, 150);
assert.equal(page.keyEvents, 2); assert.equal(page.position, 10); assert.equal(page.ctr, .005);
assert.equal(page.previousSessions, 50); assert.equal(page.previousClicks, 0);
assert.equal(page.website, 'CJM Metals'); assert.equal(page.url, 'https://www.cjmmetals.com/service');
assert.equal(rows.find(p => p.id === 'concrete:/service').sessions, 100, 'Do not merge businesses');
const zero = rows.find(p => p.id === 'metals:/new');
assert.equal(zero.sessions, 0); assert.equal(zero.engagement, null); assert.equal(zero.previousSessions, null);
assert.equal(rows.find(p => p.path === '/views-only').sessions, null, 'Views are not landing visits');
assert.equal(pageAdvice(page).length, 3);
assert.ok(pageAdvice({ ...page, sessions: 1, impressions: 1 }).every(a => a.title === 'Build a reliable comparison'), 'No small-sample quality claims');
assert.ok(pageAdvice({ ...page, engagement: .8 }).some(a => a.title === 'A useful page to learn from'));
for (const value of ['/private', '/private/invoice-id', '/invoice/secret', '/quote/secret', '/other', '//elsewhere.test/p', 'https://elsewhere.test/p', 'javascript:alert(1)', '(not set)', 'invalid']) assert.equal(publicPage(value, 'www.cjmmetals.com'), null, value);
assert.equal(publicPage('/safe?private=value#hash', 'www.cjmmetals.com'), '/safe');
assert.deepEqual(groupMetric([{ channel: 'Direct', sessions: 0 }, { channel: 'Search', sessions: 20 }, { channel: 'Search', sessions: 10 }, { channel: 'Missing', sessions: null }], 'channel', 'sessions'), [{ label: 'Search', value: 30 }, { label: 'Direct', value: 0 }]);
const unknownPosition = site('metals', 'www.cjmmetals.com'); unknownPosition.current.search.rows[0].position = null;
assert.equal(pagePerformance([unknownPosition]).find(p => p.path === '/service').position, null, 'Do not invent a position when one contributor is missing');
console.log('Page comparison, weighted metrics, missing data, privacy, low-sample guidance and group charts passed.');
