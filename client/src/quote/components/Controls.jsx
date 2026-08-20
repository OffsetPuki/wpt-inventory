// Generic renderer for a configurator control (segment / swatch / range / number).
// Driven entirely by the declarative schema in data/configurators.js.
//
// Any control whose unit is a length ('ft' / 'in' / '"') gets a feet-and-inches
// text box instead of a bare number spinner, so the owner can type what they
// measured — 6' 4-1/2", 76.5", 4 1/2 — and the state keeps a plain decimal.

import { useState } from 'react';
import { isMeasureUnit, measureUnit, parseMeasure, formatMeasure } from '../lib/measure.js';

/** Round a dragged slider value back onto the control's declared step. */
function snapToStep(n, control) {
  const step = Number(control.step) || 1;
  const min = Number(control.min) || 0;
  return Math.round((Math.round(((n - min) / step) * 1e4) / 1e4)) * step + min;
}

/**
 * Feet/inches text box. Shows shop language, accepts anything parseMeasure
 * understands, and leaves the value alone when what you typed isn't a
 * measurement. Edits stay local until blur/Enter so the whole design doesn't
 * re-price on every keystroke.
 */
function MeasureField({ control, value, onChange, className = 'num' }) {
  const unit = measureUnit(control.unit);
  const [draft, setDraft] = useState(null); // null = not being edited

  const commit = () => {
    if (draft == null) return;
    const parsed = parseMeasure(draft, unit);
    setDraft(null);
    if (parsed == null) return; // unreadable — snap back to the current value
    const min = control.min == null ? -Infinity : Number(control.min);
    const max = control.max == null ? Infinity : Number(control.max);
    onChange(control.name, Math.min(max, Math.max(min, parsed)));
  };

  return (
    <input
      type="text"
      className={className}
      name={control.name}
      value={draft == null ? formatMeasure(value, unit) : draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
      }}
      title={'Feet and inches — try 6\' 4-1/2", 76.5", or 4 1/2'}
      aria-label={control.label}
    />
  );
}

function Segment({ control, value, onChange }) {
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend"><span className="lbl">{control.label}</span></legend>
      <div className={`seg cols-${control.cols || control.options.length}`}>
        {control.options.map((opt) => (
          <label key={String(opt.value)} className="seg-opt">
            <input
              type="radio"
              name={control.name}
              checked={String(value) === String(opt.value)}
              onChange={() => onChange(control.name, opt.value)}
            />
            <span>{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Swatch({ control, value, onChange }) {
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend"><span className="lbl">{control.label}</span></legend>
      <div className="swatches">
        {control.options.map((opt) => (
          <label key={opt.value} className="swatch">
            <input
              type="radio"
              name={control.name}
              checked={value === opt.value}
              onChange={() => onChange(control.name, opt.value)}
            />
            <span className="swatch-chip" style={{ background: opt.value }} />
            <span className="swatch-label">{opt.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Range({ control, value, onChange }) {
  const measure = isMeasureUnit(control.unit);
  const note = control.note ? control.note(value) : null;
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend">
        <span className="lbl">{control.label}</span>
        {measure
          ? <MeasureField control={control} value={value} onChange={onChange} className="num num-measure" />
          : <span className="ctrl-val">{control.display ? control.display(value) : value}</span>}
      </legend>
      <input
        type="range"
        className="range"
        name={control.name}
        min={control.min}
        max={control.max}
        // step="any" so a typed 6' 4-1/2" puts the thumb exactly where the box
        // says it is; dragging still lands on the control's declared step.
        step="any"
        value={value}
        onChange={(e) => onChange(control.name, snapToStep(Number(e.target.value), control))}
      />
      {note && <span className="ctrl-note">{note}</span>}
    </fieldset>
  );
}

function NumberField({ control, value, onChange }) {
  const measure = isMeasureUnit(control.unit);
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend">
        <span className="lbl">{control.label}</span>
        <span className="num-wrap">
          {measure ? (
            <MeasureField control={control} value={value} onChange={onChange} className="num num-measure" />
          ) : (
            <>
              <input
                type="number"
                className="num"
                name={control.name}
                min={control.min}
                max={control.max}
                step={control.step}
                value={value}
                onChange={(e) => onChange(control.name, e.target.value)}
              />
              {control.unit && <span className="num-suffix">{control.unit}</span>}
            </>
          )}
        </span>
      </legend>
    </fieldset>
  );
}

/** Plain text control — what a Custom build is, in the owner's own words. */
function TextField({ control, value, onChange }) {
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend"><span className="lbl">{control.label}</span></legend>
      <input
        type="text"
        className="ctrl-text"
        name={control.name}
        value={value ?? ''}
        placeholder={control.placeholder || ''}
        onChange={(e) => onChange(control.name, e.target.value)}
      />
    </fieldset>
  );
}

export default function Control({ control, value, onChange }) {
  switch (control.kind) {
    case 'segment': return <Segment control={control} value={value} onChange={onChange} />;
    case 'swatch':  return <Swatch control={control} value={value} onChange={onChange} />;
    case 'range':   return <Range control={control} value={value} onChange={onChange} />;
    case 'number':  return <NumberField control={control} value={value} onChange={onChange} />;
    case 'text':    return <TextField control={control} value={value} onChange={onChange} />;
    default:        return null;
  }
}
