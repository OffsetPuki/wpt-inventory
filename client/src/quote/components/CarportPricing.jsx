import { CARPORT_COST_FIELDS } from '../data/carportPricing.js';
const money = n => Number(n||0).toLocaleString('en-US',{style:'currency',currency:'USD'});
export function CarportOptions({controls,renderControl,state,onChange}) {
  const group=(title,names)=><section className="quote-section"><h2>{title}</h2><div className="quote-control-grid">{controls.filter(c=>names.includes(c.name)).map(renderControl)}</div></section>;
  return <>
    {group('1. Size',['width','depth','height'])}
    {group('2. Your cover',['roof','mounting','gableFrame','frameMaterial'])}
    <p className="hint">Standard package: open steel frame, corrugated roof, standard finish and installation on suitable existing concrete. Standard height: 9 ft.</p>
    {group('3. Upgrades',['panel','sides','sidePos','gutters'])}
    <label><input type="checkbox" checked={state.includeSlab==='yes'} onChange={e=>onChange('includeSlab',e.target.checked?'yes':'no')} /> Add concrete slab</label>
    {group('4. Site & anchoring',['anchor'])}
    <details className="quote-section"><summary>Roof & finish details</summary><div className="quote-control-grid">{controls.filter(c=>['pitch','elevation','coating','color','roofColor'].includes(c.name)).map(renderControl)}</div></details>
  </>;
}
export default function CarportPricing({state,lines,totals,onChange,taxPct,discountPct,onChangeTax,onChangeDiscount}) {
  const c=lines.carportPricing, check=totals.costCheck||c;
  const field=(key,label,fallback=0)=><label key={key} className="ctrl"><span className="lbl">{label}</span><input className="num" type="number" min="0" step="0.01" value={state[key]??fallback} onChange={e=>onChange(key,e.target.value)} /></label>;
  return <section className="quote-section" aria-label="Carport package pricing">
    <h2>{money(totals.total)} <small>estimated total</small></h2>
    <p>{c.area} covered sq ft · Installation included</p>
    <div className="quote-control-grid">{field('packageRate','Installed price / sq ft',c.baseRate)}{field('packageMinimum','Minimum job charge',c.minimum)}</div>
    <p className="hint">Editable CJM starting estimate. Comparable local lean-to covers start at $25/sq ft; your frame, site and scope can differ.</p>
    <details className="quote-section"><summary>Upgrades & site allowances</summary><div className="quote-control-grid">
      {field('heightRate','Extra height / post-foot',c.rates.heightPerPostFt)}{field('sideRate','Side panels / sq ft',c.rates.sidePerSqFt)}{field('gutterRate','Gutters / ft',c.rates.guttersPerFt)}
      {field('premiumRoofRate','Standing-seam upgrade / roof sq ft',c.rates.standingSeamPerSqFt)}{field('slabRate','Concrete / sq ft',c.rates.slabPerSqFt)}
      {state.anchor==='embedded'&&<>{field('footingQty','Number of footings',c.posts)}{field('footingRate','Price / footing',c.rates.footingEach)}</>}
      {field('customAllowance','Custom frame / attachment / finish allowance')}
      {field('demoAllowance','Demolition & disposal')}{field('accessAllowance','Difficult access / equipment')}{field('deliveryAllowance','Delivery / travel')}{field('permitAllowance','Permits')}{field('engineeringAllowance','Engineering')}{field('siteAllowance','Site preparation')}
    </div><p className="hint">Allowance rates are planning estimates. Confirm slab, footing design and supplier prices for this job. Zero site allowances are excluded.</p></details>
    {c.special.length>0&&<p role="alert">Price custom upgrades: {c.special.join(', ')}.</p>}
    <details className="quote-section"><summary>Job costs & profit · {money(c.estimatedCost)} cost</summary>
      <p className="hint">Internal only. Material and labor estimates come from your price book. Enter all actual costs, including concrete, footings, waste and overhead. These costs are not added twice to the customer price.</p>
      <div className="quote-control-grid">{CARPORT_COST_FIELDS.map(([key,label])=>field(key,label,c.costs[key]))}{field('targetMargin','Target profit margin (%)',c.margin)}</div>
      <p>Minimum price for target margin: {money(c.required)} · Estimated profit: {money(check.profit)} ({check.actualMargin}%)</p>
      {c.costMissing.length>0&&<p role="alert">Confirm material cost: {c.costMissing.join(', ')}.</p>}
    </details>
    <label><input type="checkbox" checked={c.reviewed} onChange={e=>onChange('costReviewKey',e.target.checked?c.reviewKey:'')} /> I reviewed all job costs and allowances</label>
    <details className="quote-section"><summary>Price breakdown & tax</summary><ul className="quote-price-summary">{lines.items.map(i=><li key={i.key}><span>{i.name}</span><strong>{money(i.kind==='flat'?i.rate:i.qty*i.rate)}</strong></li>)}</ul>
      <div className="quote-control-grid"><label className="ctrl"><span className="lbl">Tax (%)</span><input className="num" type="number" min="0" step="0.01" value={taxPct} onChange={e=>onChangeTax(e.target.value)} /></label><label className="ctrl"><span className="lbl">Discount (%)</span><input className="num" type="number" min="0" max="100" value={discountPct} onChange={e=>onChangeDiscount(e.target.value)} /></label></div>
      {totals.minAdjustment>0&&<p>Job minimum / cost protection: {money(totals.minAdjustment)}</p>}<p>Tax: {money(totals.tax)}</p>
    </details>
  </section>;
}
