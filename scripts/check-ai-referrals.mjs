import assert from 'node:assert/strict';
import {aiReferralProvider} from '../shared/ai-referrals.ts';
assert.equal(aiReferralProvider('chatgpt.com','referral'),'ChatGPT');
assert.equal(aiReferralProvider('WWW.PERPLEXITY.AI','referral'),'Perplexity');
assert.equal(aiReferralProvider('gemini.google.com','referral'),'Gemini');
for(const source of ['google.com','bing.com','direct','chatgpt.com.example.org','notchatgpt.com','https://chatgpt.com/private?email=a@example.com'])assert.equal(aiReferralProvider(source,'referral'),null);
assert.equal(aiReferralProvider('chatgpt.com','cpc'),null);
assert.equal(aiReferralProvider(undefined),null);
console.log('AI referral classification: recognized sources, domain boundaries, paid exclusions and missing data passed.');
