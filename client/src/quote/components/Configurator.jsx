import StandardPackages from './StandardPackages.jsx';
import PriceSummary from './PriceSummary.jsx';
import CarportPricing, { CarportOptions } from './CarportPricing.jsx';
import { concreteGuide, isFlatwork } from '../data/concreteGuide.js';
import Barndominium from './Barndominium.jsx';
import BarndoQuoteDetails from './BarndoQuoteDetails.jsx';
import { visibleControls, typeLabel } from '../data/configurators.js';
import Control from './Controls.jsx';
import Preview from './Preview.jsx';
import { lazy, Suspense, useState } from 'react';
import CustomerFields from './CustomerFields.jsx';
const LineItems = lazy(() => import('./LineItems.jsx'));

/**
 * The hybrid configurator: option pickers (mirroring the website) on the left,
 * live preview + auto-priced, hand-editable line items on the right.
 */
export default function Configurator({
  estimate,onChangeEstimate,mode='design', type, state, lineState, totals, warnings, materialsSummary, priceLockAt, priceBook,
  materialMarkupPct, laborMarkupPct, taxPct, discountPct, deliveryMiles, deliveryRate,
  onChangeOption, onEditItem, onEditLabor, onEditInstall,
  onAddCustomLine, onRemoveCustomLine, onSetLineRemoved, onMoveLine, onUnlockPrices, onResetOverrides,
  onChangeMaterialMarkup, onChangeLaborMarkup, onChangeTax, onChangeDiscount,
  onChangeDeliveryMiles, onChangeDeliveryRate, onBack, onContinue,
  customer, onChangeCustomer, onChangeState, barndoQuote, onChangeBarndoQuote,
}) {
  const packageCarport = type==='carport' && state.pricingMode==='package';
  const guide = type === 'concrete' && state.pricingMode === 'guide' ? concreteGuide(state) : null;
  const controls = visibleControls(type, state).filter(c => c.kind !== 'segment' || c.options.length > 1);
  const [pricingOpen, setPricingOpen] = useState(type === 'custom');
  const [customerOpen, setCustomerOpen] = useState(false);
  const finish = controls.filter(c => ['coating', 'color'].includes(c.name));
  const advancedNames=['pricingMode','pricingBasis','priceLevel','baseRate','minimumCharge','siteAllowance','thicknessAddon'];
  const advancedControls=type==='concrete'?controls.filter(c=>advancedNames.includes(c.name)):[];
  const optionalNames=['panelWidth','undergroundFt','bagsPerPost','meshRatio','slatCount','railCount','legs','spacing','toprail'];
  const optionalControls=controls.filter(c=>optionalNames.includes(c.name));
  const basics = controls.filter(c => !finish.includes(c)&&!advancedControls.includes(c)&&!optionalControls.includes(c));
  const frameControls = basics.filter(c => ['frameLengthFt','frameWidthIn','frameHeightIn'].includes(c.name));
  const topControls = basics.filter(c => ['topMaterial','topCost','lengthFt','widthIn','topThicknessIn'].includes(c.name));
  const missing = lineState.items.filter(it => it.unpriced || !(Number(it.rate) > 0));
  const renderControl = (c) => {
    const error = c.name === 'topMaterial' && !String(state.topMaterial || '').trim() ? 'Enter the included tabletop material.'
      : c.name === 'topCost' && !(Number(state.topCost) > 0) ? 'Enter the cost per top.' : null;
    return <div key={c.name} id={`quote-option-${c.name}`} className={`control-wrap ${['segment','swatch','text'].includes(c.kind) || c.name === 'topCost' ? 'wide' : ''}`}>
      <Control control={guide && c.name === 'repairQty' ? {...c,label:`Quantity (${guide.unit})`} : c} value={typeof c.value === 'function' ? c.value(state) : state[c.name]} onChange={(name,value)=>{ onChangeOption(name,value); if(type==='concrete' && name==='project' && ['brick','retaining','repair'].includes(value)) onChangeOption('pricingMode','guide'); }} />
      {error && <p className="field-error">{error}</p>}
    </div>;
  };

  return (
    <div className="page quote-workbench">
      <div className="container">
        <div className="page-head">
          <button className="back-link" onClick={onBack}>← Build type</button>
          <h1 className="display">{mode==='price'?'Price your quote':typeLabel(type)}</h1>
        </div>

        {mode==='design' && <StandardPackages type={type} onChange={onChangeState}/>}
        {mode==='design' && type === 'barndominium' && <Barndominium state={state} onChange={onChangeState} customer={customer} />}
        {mode==='design' && type === 'barndominium' && <BarndoQuoteDetails state={state} value={barndoQuote} onChange={onChangeBarndoQuote} />}
        <div className={mode==='price'?'quote-price-layout':'cfg'}>
          {mode==='design' && <form className="cfg-controls" onSubmit={(e) => e.preventDefault()}>
            {type==='carport'&&state.roof==='gable'&&state.gableFrame==='rigid'&&<p className="hint">Open rigid frame concept: clear gable opening with reinforced corners. Final steel sizes, connections, foundations and price require a project-specific design.</p>}
            <details className="quote-section" open={customerOpen} onToggle={e => setCustomerOpen(e.currentTarget.open)}>
              <summary>Customer{customer?.name ? ` · ${customer.name}` : ''}</summary>
              <CustomerFields customer={customer} onChange={onChangeCustomer} />
            </details>
            {packageCarport ? <CarportOptions controls={controls} renderControl={renderControl} state={state} onChange={onChangeOption} /> : type === 'table' ? <>
              <div className="quote-control-grid">{basics.filter(c => ['qty','includeTop'].includes(c.name)).map(renderControl)}</div>
              <section aria-label="Frame dimensions"><h2 className="dimension-title">Frame dimensions</h2><div className="quote-control-grid">{frameControls.map(renderControl)}</div></section>
              {state.includeTop === 'yes' && <section aria-label="Tabletop"><h2 className="dimension-title">Tabletop</h2><div className="quote-control-grid">{topControls.map(renderControl)}</div></section>}
              <div className="quote-control-grid">{basics.filter(c => !['qty','includeTop'].includes(c.name) && !frameControls.includes(c) && !topControls.includes(c)).map(renderControl)}</div>
            </> : <div className="quote-control-grid">{basics.map(renderControl)}</div>}
            {!packageCarport&&optionalControls.length>0&&<details className="quote-section"><summary>Construction details</summary><div className="quote-control-grid">{optionalControls.map(renderControl)}</div></details>}
            {!packageCarport && finish.length > 0 && <details className="quote-section"><summary>Finish &amp; coating</summary><div className="quote-control-grid">{finish.map(renderControl)}</div></details>}
          </form>}

          <div className="cfg-right">
            {mode==='price'&&<PriceSummary totals={totals} estimate={estimate} onChange={onChangeEstimate} warnings={warnings}/>}
            {mode==='price' && !packageCarport && <section className="quote-section"><h2>Included work</h2><p>Review the included work below. Change rates, labor, delivery or tax in Advanced pricing.</p><ul className="quote-price-summary">{lineState.items.map(item=><li key={item.key}><span>{item.name}</span><strong>{Number(item.qty).toLocaleString()} {item.unit||({area:'sq ft',length:'ft',flat:'job'}[item.kind]||'each')}</strong></li>)}</ul><p>Tax: ${Number(totals?.tax||0).toFixed(2)} · Discount: ${Number(totals?.discountAmt||0).toFixed(2)}</p></section>}
            {!!advancedControls.length && <details className="quote-section"><summary>Concrete pricing options</summary><div className="quote-control-grid">{advancedControls.map(renderControl)}</div></details>}
            {guide && <section className="quote-section" aria-label="CJM pricing guide"><h2>{guide.label}</h2><p>{guide.qty} {guide.unit} · Guide: ${guide.low}–${guide.high}{['panel','wall','drainage','roots'].includes(state.repairType) ? '+' : ''} / {guide.unit}</p><p>Selected base: ${guide.rate.toFixed(2)} / {guide.unit}{guide.minimum > 0 ? ` · Minimum: $${guide.minimum}` : ''}</p><p className="hint">Installed guide rates include labor. Finishes and extras are separate. Any markup, tax or delivery in Advanced pricing is additional. Final pricing depends on site conditions.</p>{isFlatwork(state) && Number(state.thickness)>4 && <p className="hint">Confirm the base rate for {state.thickness}″ concrete or enter an extra thickness allowance; the guides do not specify a thickness surcharge.</p>}{state.project==='retaining' && <p className="hint">Quantity is length × wall height (wall face area).</p>}{state.project==='brick' && <p className="hint">Enter affected {guide.unit}; repair scope and structural work require site review.</p>}</section>}
            {mode==='design' && type !== 'barndominium' && !(type === 'concrete' && !isFlatwork(state)) && <Preview type={type} state={state} customer={customer} />}
            {!packageCarport && missing.length > 0 && <div className="pricing-attention"><strong>{missing.length} {missing.length === 1 ? 'cost needs' : 'costs need'} attention</strong><p>{missing.map(it => it.name).join(', ')}</p><button className="back-link" onClick={() => setPricingOpen(true)}>Edit missing costs</button></div>}
            {packageCarport && mode==='price' && <CarportPricing state={state} lines={lineState} totals={totals} onChange={onChangeOption} taxPct={taxPct} discountPct={discountPct} onChangeTax={onChangeTax} onChangeDiscount={onChangeDiscount} />}
            {!packageCarport && <details className="quote-section pricing-section" open={pricingOpen} onToggle={e => setPricingOpen(e.currentTarget.open)}>
              <summary>Advanced pricing <span>Materials, labor, markup, delivery &amp; tax</span></summary>
            {pricingOpen && <Suspense fallback={<p className="hint">Loading pricing…</p>}><LineItems
              lineState={lineState}
              totals={totals}
              warnings={warnings}
              materialsSummary={materialsSummary}
              priceLockAt={priceLockAt}
              priceBook={priceBook}
              materialMarkupPct={materialMarkupPct}
              laborMarkupPct={laborMarkupPct}
              taxPct={taxPct}
              discountPct={discountPct}
              deliveryMiles={deliveryMiles}
              deliveryRate={deliveryRate}
              onEditItem={onEditItem}
              onEditLabor={onEditLabor}
              onEditInstall={onEditInstall}
              onAddCustomLine={onAddCustomLine}
              onRemoveCustomLine={onRemoveCustomLine}
              onSetLineRemoved={onSetLineRemoved}
              onMoveLine={onMoveLine}
              onUnlockPrices={onUnlockPrices}
              onReset={onResetOverrides}
              onChangeMaterialMarkup={onChangeMaterialMarkup}
              onChangeLaborMarkup={onChangeLaborMarkup}
              onChangeTax={onChangeTax}
              onChangeDiscount={onChangeDiscount}
              onChangeDeliveryMiles={onChangeDeliveryMiles}
              onChangeDeliveryRate={onChangeDeliveryRate}
            /></Suspense>}
            </details>}
          </div>
        </div>
      </div>
    </div>
  );
}
