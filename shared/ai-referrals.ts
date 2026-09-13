// A recognized referring source is evidence of a visit, not an AI citation or
// recommendation. Keep unknown/direct traffic and ordinary Google/Bing separate.
const providers: [string, string[]][] = [
  ['ChatGPT', ['chatgpt.com', 'chat.openai.com']],
  ['Perplexity', ['perplexity.ai']],
  ['Claude', ['claude.ai']],
  ['Gemini', ['gemini.google.com']],
  ['Copilot', ['copilot.microsoft.com', 'copilot.com']],
  ['Grok', ['grok.com']],
  ['DeepSeek', ['chat.deepseek.com']],
  ['Mistral', ['chat.mistral.ai']],
];
export function aiReferralProvider(source?: string, medium?: string): string | null {
  if (/^(?:cpc|ppc|paid.*|display|cpm|cpv|retargeting)$/i.test(medium || '')) return null;
  const host = (source || '').trim().toLowerCase().replace(/^www\./, '');
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  return providers.find(([, domains]) => domains.some(domain => host === domain || host.endsWith('.' + domain)))?.[0] || null;
}
