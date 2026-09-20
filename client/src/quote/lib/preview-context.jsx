import { createContext } from 'react';
import { summaryLine } from '../data/configurators.js';
export const QuotePreviewContext = createContext(null);
export function previewDetails(session) {
  if (!session) return {};
  const s=session.state||{};
  const dim=value=>value==null?'':`${value} ft`;
  return {
    clientId:session.customer?.clientId||null,
    quoteId:session.quoteId||null,
    sourceQuoteVersion:session.version||undefined,
    customer:session.customer?.name||'',
    description:summaryLine(session.type,s).slice(0,600),
    width:dim(s.width??s.widthFt), depth:dim(s.depth??s.lengthFt),
    height:dim(s.eaveHeight??s.height??s.heightFt),
    finish:String(s.finish??s.color??s.coating??(s.roofColor?`Roof ${s.roofColor}, walls ${s.wallColor}`:'')).slice(0,60),
    note:[session.features,session.notes].filter(Boolean).join('\n').slice(0,1200),
  };
}
