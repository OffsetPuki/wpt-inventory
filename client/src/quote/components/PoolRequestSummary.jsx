import React from 'react';
export default function PoolRequestSummary({pool}){
 if(!pool)return null;
 let url;try{const parsed=new URL(pool.designUrl);if(['https:','http:'].includes(parsed.protocol)&&(parsed.hostname==='www.cjmmetals.com'||['127.0.0.1','localhost'].includes(parsed.hostname)))url=parsed.href;}catch{}
 return <aside className="container" style={{marginTop:20,marginBottom:20,padding:22,border:'1px solid #c9d5cf',borderRadius:12,background:'#eef4ef'}}>
  <div style={{display:'flex',justifyContent:'space-between',gap:20,flexWrap:'wrap'}}><div><strong>Pool design request · {pool.reference}</strong><p style={{marginTop:6,fontSize:13}}>Website estimate before tax. Review site allowances and engineering before issuing a quote.</p></div>{url&&<a className="btn" href={url} target="_blank" rel="noopener noreferrer">Open saved 3D design ↗</a>}</div>
  <details style={{marginTop:12}}><summary style={{cursor:'pointer'}}>Original itemized estimate</summary><table style={{width:'100%',fontSize:13,marginTop:12}}><tbody>{[...pool.estimate.lines,...pool.estimate.siteLines].map((line,i)=><tr key={i}><td style={{padding:'5px 0'}}>{line.label}</td><td style={{textAlign:'right'}}>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(line.total)}</td></tr>)}<tr><th style={{textAlign:'left',paddingTop:12}}>Pool + site estimate</th><th style={{textAlign:'right',paddingTop:12}}>{new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(pool.estimate.projectTotal)}</th></tr></tbody></table></details>
 </aside>;
}
