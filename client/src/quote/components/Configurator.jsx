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
  type, state, lineState, totals, warnings, materialsSummary, priceLockAt, priceBook,
  materialMarkupPct, laborMarkupPct, taxPct, discountPct, deliveryMiles, deliveryRate,
  onChangeOption, onEditItem, onEditLabor, onEditInstall,
  onAddCustomLine, onRemoveCustomLine, onSetLineRemoved, onMoveLine, onUnlockPrices, onResetOverrides,
  onChangeMaterialMarkup, onChangeLaborMarkup, onChangeTax, onChangeDiscount,
  onChangeDeliveryMiles, onChangeDeliveryRate, onBack, onContinue,
  customer, onChangeCustomer,
}) {
  const controls = visibleControls(type, state).filter(c => c.kind !== 'segment' || c.options.length > 1);
  const [pricingOpen, setPricingOpen] = useState(type === 'custom');
  const [customerOpen, setCustomerOpen] = useState(false);
  const finish = controls.filter(c => ['coating', 'color'].includes(c.name));
  const basics = controls.filter(c => !finish.includes(c));
  const frameControls = basics.filter(c => ['frameLengthFt','frameWidthIn','frameHeightIn'].includes(c.name));
  const topControls = basics.filter(c => ['topMaterial','topCost','lengthFt','widthIn','topThicknessIn'].includes(c.name));
  const missing = lineState.items.filter(it => it.unpriced || !(Number(it.rate) > 0));
  const renderControl = (c) => {
    const error = c.name === 'topMaterial' && !String(state.topMaterial || '').trim() ? 'Enter the included tabletop material.'
      : c.name === 'topCost' && !(Number(state.topCost) > 0) ? 'Enter the cost per top.' : null;
    return <div key={c.name} id={`quote-option-${c.name}`} className={`control-wrap ${['segment','swatch','text'].includes(c.kind) || c.name === 'topCost' ? 'wide' : ''}`}>
      <Control control={c} value={typeof c.value === 'function' ? c.value(state) : state[c.name]} onChange={onChangeOption} />
      {error && <p className="field-error">{error}</p>}
    </div>;
  };

  return (
    <div className="page quote-workbench">
      <div className="container">
        <div className="page-head">
          <button className="back-link" onClick={onBack}>← Build type</button>
          <h1 className="display">{typeLabel(type)}</h1>
        </div>

        <div className="cfg">
          <form className="cfg-controls" onSubmit={(e) => e.preventDefault()}>
            <details className="quote-section" open={customerOpen} onToggle={e => setCustomerOpen(e.currentTarget.open)}>
              <summary>Customer{customer?.name ? ` · ${customer.name}` : ''}</summary>
              <CustomerFields customer={customer} onChange={onChangeCustomer} />
            </details>
            {type === 'table' ? <>
              <div className="quote-control-grid">{basics.filter(c => ['qty','includeTop'].includes(c.name)).map(renderControl)}</div>
              <section aria-label="Frame dimensions"><h2 className="dimension-title">Frame dimensions</h2><div className="quote-control-grid">{frameControls.map(renderControl)}</div></section>
              {state.includeTop === 'yes' && <section aria-label="Tabletop"><h2 className="dimension-title">Tabletop</h2><div className="quote-control-grid">{topControls.map(renderControl)}</div></section>}
              <div className="quote-control-grid">{basics.filter(c => !['qty','includeTop'].includes(c.name) && !frameControls.includes(c) && !topControls.includes(c)).map(renderControl)}</div>
            </> : <div className="quote-control-grid">{basics.map(renderControl)}</div>}
            {finish.length > 0 && <details className="quote-section"><summary>Finish &amp; coating</summary><div className="quote-control-grid">{finish.map(renderControl)}</div></details>}
          </form>

          <div className="cfg-right">
            <Preview type={type} state={state} />
            {missing.length > 0 && <div className="pricing-attention"><strong>{missing.length} {missing.length === 1 ? 'cost needs' : 'costs need'} attention</strong><p>{missing.map(it => it.name).join(', ')}</p><button className="back-link" onClick={() => setPricingOpen(true)}>Edit missing costs</button></div>}
            <details className="quote-section pricing-section" open={pricingOpen} onToggle={e => setPricingOpen(e.currentTarget.open)}>
              <summary>Edit pricing <span>Materials, labor, delivery &amp; buy list</span></summary>
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
            </details>
          </div>
        </div>
      </div>
    </div>
  );
}
