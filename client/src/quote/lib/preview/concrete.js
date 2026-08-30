/**
 * Pure SVG preview generator for concrete flatwork — a top-down slab plan,
 * ported from the concrete site's drawPlan() (CJM-Concrete/src/layouts/
 * Calculator.astro): the slab outline, the equal-panel control-joint grid and
 * the rebar/mesh grid, with dimension ticks.
 *
 * Same contract as the other lib/preview renderers: takes the plain config
 * state, returns inner-SVG markup for an <svg viewBox="0 0 800 450">.
 *
 * state: { project, lengthFt, widthFt, thickness, finish, demo, rebar } —
 * see data/configurators.js.
 */

import { jointSpacingFt, jointOffsets, rebarGridIn } from '../tradeMath.js';

export function renderConcrete(state) {
  const VB_W = 800;
  const VB_H = 450;
  const pad = 80;

  const lengthFt = Math.max(1, Number(state.lengthFt) || 30);
  const widthFt = Math.max(1, Number(state.widthFt) || 20);
  const thickness = Number(state.thickness) || 4;
  const rebar = state.rebar === 'yes' || state.rebar === true;

  const ink = '#0A0A0A';
  const dim = 'rgba(10,10,10,0.4)';
  const dimText = 'rgba(10,10,10,0.55)';

  // Fit the slab into the stage keeping its aspect (site's drawPlan math).
  const ratio = lengthFt / widthFt;
  let w = VB_W - pad * 2;
  let h = w / ratio;
  if (h > VB_H - pad * 2) { h = VB_H - pad * 2; w = h * ratio; }
  const x = (VB_W - w) / 2;
  const y = (VB_H - h) / 2;
  const ftToPx = w / lengthFt;

  const parts = [];

  // Slab body — a faint concrete wash under the linework.
  parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(10,10,10,0.05)" />`);

  // Rebar (18"/12" grid per the thickness rule) drawn stronger when selected;
  // otherwise a faint mesh, exactly like the site's plan view.
  const gridFt = rebar ? rebarGridIn(thickness) / 12 : 0.5;
  const op = rebar ? 0.28 : 0.1;
  if (ftToPx * gridFt >= 4) {
    const grid = [];
    for (let f = gridFt; f < lengthFt; f += gridFt) {
      grid.push(`<line x1="${(x + f * ftToPx).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + f * ftToPx).toFixed(1)}" y2="${(y + h).toFixed(1)}"/>`);
    }
    for (let f = gridFt; f < widthFt; f += gridFt) {
      grid.push(`<line x1="${x.toFixed(1)}" y1="${(y + f * ftToPx).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + f * ftToPx).toFixed(1)}"/>`);
    }
    parts.push(`<g stroke="${ink}" stroke-opacity="${op}" stroke-width="1">${grid.join('')}</g>`);
  }

  // Slab outline.
  parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none" stroke="${ink}" stroke-width="2" />`);

  // Control joints: equal panels both ways (site's jointOffsets rule).
  const joints = jointSpacingFt(thickness, Math.min(lengthFt, widthFt));
  const cut = [];
  for (const f of jointOffsets(lengthFt, joints.max)) {
    cut.push(`<line x1="${(x + f * ftToPx).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x + f * ftToPx).toFixed(1)}" y2="${(y + h).toFixed(1)}"/>`);
  }
  for (const f of jointOffsets(widthFt, joints.max)) {
    cut.push(`<line x1="${x.toFixed(1)}" y1="${(y + f * ftToPx).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y + f * ftToPx).toFixed(1)}"/>`);
  }
  parts.push(`<g stroke="${ink}" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 8" stroke-opacity="0.9">${cut.join('')}</g>`);

  // Dimension ticks + labels.
  parts.push(
    `<g stroke="${dim}" stroke-width="0.7">`
    + `<line x1="${x.toFixed(1)}" y1="${(y - 16).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y - 16).toFixed(1)}"/>`
    + `<line x1="${x.toFixed(1)}" y1="${(y - 22).toFixed(1)}" x2="${x.toFixed(1)}" y2="${(y - 10).toFixed(1)}"/>`
    + `<line x1="${(x + w).toFixed(1)}" y1="${(y - 22).toFixed(1)}" x2="${(x + w).toFixed(1)}" y2="${(y - 10).toFixed(1)}"/>`
    + `<line x1="${(x - 16).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 16).toFixed(1)}" y2="${(y + h).toFixed(1)}"/>`
    + `<line x1="${(x - 22).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 10).toFixed(1)}" y2="${y.toFixed(1)}"/>`
    + `<line x1="${(x - 22).toFixed(1)}" y1="${(y + h).toFixed(1)}" x2="${(x - 10).toFixed(1)}" y2="${(y + h).toFixed(1)}"/>`
    + '</g>',
  );
  const font = 'font-family="Inter, sans-serif" font-size="12" letter-spacing="2"';
  parts.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(y - 26).toFixed(1)}" text-anchor="middle" ${font} fill="${dimText}">${lengthFt}'</text>`);
  parts.push(`<text x="${(x - 28).toFixed(1)}" y="${(y + h / 2).toFixed(1)}" text-anchor="middle" ${font} fill="${dimText}" transform="rotate(-90 ${(x - 28).toFixed(1)} ${(y + h / 2).toFixed(1)})">${widthFt}'</text>`);

  // Caption: thickness + joint spacing, the two numbers the crew asks first.
  parts.push(`<text x="${(x + w / 2).toFixed(1)}" y="${(y + h + 28).toFixed(1)}" text-anchor="middle" ${font} fill="${dimText}">${thickness}" SLAB · JOINTS EVERY ${joints.min}–${joints.max} FT</text>`);

  return parts.join('');
}
