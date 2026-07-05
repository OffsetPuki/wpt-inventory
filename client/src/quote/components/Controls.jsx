// Generic renderer for a configurator control (segment / swatch / range / number).
// Driven entirely by the declarative schema in data/configurators.js.

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
  const readout = control.display ? control.display(value) : value;
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend">
        <span className="lbl">{control.label}</span>
        <span className="ctrl-val">{readout}</span>
      </legend>
      <input
        type="range"
        className="range"
        name={control.name}
        min={control.min}
        max={control.max}
        step={control.step}
        value={value}
        onChange={(e) => onChange(control.name, Number(e.target.value))}
      />
    </fieldset>
  );
}

function NumberField({ control, value, onChange }) {
  return (
    <fieldset className="ctrl">
      <legend className="ctrl-legend">
        <span className="lbl">{control.label}</span>
        <span className="num-wrap">
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
        </span>
      </legend>
    </fieldset>
  );
}

export default function Control({ control, value, onChange }) {
  switch (control.kind) {
    case 'segment': return <Segment control={control} value={value} onChange={onChange} />;
    case 'swatch':  return <Swatch control={control} value={value} onChange={onChange} />;
    case 'range':   return <Range control={control} value={value} onChange={onChange} />;
    case 'number':  return <NumberField control={control} value={value} onChange={onChange} />;
    default:        return null;
  }
}
