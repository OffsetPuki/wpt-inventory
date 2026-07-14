import { visibleControls, typeLabel } from '../data/configurators.js';
import Control from './Controls.jsx';
import Preview from './Preview.jsx';
import LineItems from './LineItems.jsx';

/**
 * The hybrid configurator: option pickers (mirroring the website) on the left,
 * live preview + auto-priced, hand-editable line items on the right.
 */
export default function Configurator({
  type, state, lineState, totals, warnings, materialsSummary, priceLockAt,
  materialMarkupPct, laborMarkupPct, taxPct, discountPct, deliveryMiles, deliveryRate,
  onChangeOption, onEditItem, onEditLabor, onEditInstall,
  onAddCustomLine, onRemoveCustomLine, onUnlockPrices, onResetOverrides,
  onChangeMaterialMarkup, onChangeLaborMarkup, onChangeTax, onChangeDiscount,
  onChangeDeliveryMiles, onChangeDeliveryRate, onBack, onContinue,
}) {
  const controls = visibleControls(type, state);

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <button className="back-link" onClick={onBack}>← Build type</button>
          <p className="eyebrow" style={{ marginTop: 28 }}>Design your own</p>
          <h1 className="display">{typeLabel(type)}</h1>
        </div>

        <div className="cfg">
          <form className="cfg-controls" onSubmit={(e) => e.preventDefault()}>
            {controls.map((c) => (
              <Control key={c.name} control={c} value={state[c.name]} onChange={onChangeOption} />
            ))}
          </form>

          <div className="cfg-right">
            <Preview type={type} state={state} />
            <LineItems
              lineState={lineState}
              totals={totals}
              warnings={warnings}
              materialsSummary={materialsSummary}
              priceLockAt={priceLockAt}
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
              onUnlockPrices={onUnlockPrices}
              onReset={onResetOverrides}
              onChangeMaterialMarkup={onChangeMaterialMarkup}
              onChangeLaborMarkup={onChangeLaborMarkup}
              onChangeTax={onChangeTax}
              onChangeDiscount={onChangeDiscount}
              onChangeDeliveryMiles={onChangeDeliveryMiles}
              onChangeDeliveryRate={onChangeDeliveryRate}
            />
            <button className="btn block" onClick={onContinue}>
              Continue to customer details <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
