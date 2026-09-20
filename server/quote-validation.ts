import {buildLineState} from '../client/src/quote/lib/estimate.js';
import {computeTotals} from '../client/src/quote/lib/quote.js';
import {DEFAULT_PRICE_BOOK} from '../client/src/quote/data/priceBook.js';
import {deepMerge} from '../client/src/quote/lib/store.js';

// Historical/custom offers may not contain an itemized snapshot. Never reprice them.
export function validateQuoteAmount(quote:{type:string;payload:string;totalCents:number}) {
  const session=JSON.parse(quote.payload);
  if(!session.state || !session.priceBookSnapshot || quote.type==='custom')return;
  const book=deepMerge(DEFAULT_PRICE_BOOK,session.priceBookSnapshot);
  const lines=buildLineState(quote.type,session.state,book,session.overrides);
  const totals=computeTotals(lines,{...session,minJobCharge:book.minJobCharge});
  if(!Number.isFinite(totals.total)||Math.round(totals.total*100)!==quote.totalCents)
    throw new Error('The saved amount does not match this design. Reopen the quote, review its price, and save it before sending.');
}
