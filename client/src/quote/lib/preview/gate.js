/**
 * Pure SVG preview generator for a custom gate.
 *
 * Ported near-verbatim from the Astro page's inline draw() (SVG-building logic only).
 * No DOM, no FormData, no side effects — takes a plain `state` object and returns
 * the inner SVG markup string (exactly what was assigned to svg.innerHTML).
 *
 * The SVG uses the viewBox coordinate system "0 0 800 450".
 *
 * State shape (as read from the original gate readState()):
 *   state.type      {('single'|'double'|'slide')}        How it opens.           default 'single'
 *   state.infill    {('horizontal-slat'|'metal-wood')}   Infill style.           default 'horizontal-slat'
 *   state.arch      {('flat'|'arched')}                   Top shape.              default 'flat'
 *   state.mesh      {('yes'|'no')}                        Optional mesh (M+W).    default 'no'
 *   state.woodDir   {('horizontal'|'vertical')}          Wood grain direction.   default 'horizontal'
 *   state.height    {number}  integer feet                                       default 6
 *   state.width     {number}  integer feet                                       default 10
 *   state.meshRatio {number}  integer percent of leaf height that is mesh (top); default 25
 *   state.color     {string}  hex color (finish)                                 default '#0A0A0A'
 *   state.topEdge   {('flat'|'capped')}                   Post-top treatment.     default 'flat'
 */

import { shade } from './svg.js';

export function renderGate(state) {
  // ---- Defensive defaults / normalization (mirrors readState() + draw()'s hidden-control forcing) ----
  const st = state || {};
  const s = {
    type: st.type || 'single',
    infill: st.infill || 'horizontal-slat',
    arch: st.arch || 'flat',
    mesh: st.mesh || 'no',
    woodDir: st.woodDir || 'horizontal',
    height: parseInt(st.height, 10) || 6,
    width: parseInt(st.width, 10) || 10,
    meshRatio: parseInt(st.meshRatio, 10) || 25,
    color: st.color || '#0A0A0A',
    topEdge: st.topEdge || 'flat',
  };

  // In the source, Wood grain + Add mesh only apply to Metal + Wood; the Mesh portion
  // only when mesh is on. The original hid those controls but never forced their values,
  // and the SVG branches already gate on (infill === 'metal-wood') / (mesh === 'yes'),
  // so no value normalization is required here — only defaults above.

  const VB_W = 800;
  const PAD_X = 30;
  const GROUND_Y = 400; // leaves headroom below the gate for the swing-path / wheels and dimensions

  // Wood reads as wood regardless of the metal finish — fixed warm tones (matches the fence designer)
  const woodColor = '#B89472';
  const woodGrain = '#8E6F4F';

  // Quadratic arch segment that peaks ABOVE the spring line (returns the "Q ..." part of a path).
  function archSeg(x1, x2, springY, h) {
    return `Q ${(x1 + x2) / 2} ${springY - h} ${x2} ${springY}`;
  }

  const maxW = VB_W - PAD_X * 2;
  const maxH = GROUND_Y - 40;
  const pxPerFt = Math.min(maxW / s.width, maxH / s.height);

  const gW = s.width * pxPerFt;
  const gH = s.height * pxPerFt;
  const startX = (VB_W - gW) / 2;
  const topY = GROUND_Y - gH;

  const frameThick = Math.max(4, pxPerFt * 0.3);
  const slatHeight = Math.max(2, pxPerFt * 0.2);
  const slatGap = Math.max(2, pxPerFt * 0.14);
  const innerPad = Math.max(3, pxPerFt * 0.2);

  const defsParts = [];
  const parts = [];

  // Cross-hatch pattern for the mesh portion of a Metal + Wood leaf.
  const meshId = 'gate-mesh';
  if (s.infill === 'metal-wood' && s.mesh === 'yes') {
    defsParts.push(
      `<pattern id="${meshId}" x="0" y="0" width="9" height="9" patternUnits="userSpaceOnUse">` +
      `<path d="M0 0 L9 9 M9 0 L0 9" stroke="rgba(10,10,10,0.7)" stroke-width="0.7"/>` +
      `</pattern>`
    );
  }

  // Fill a wood panel with board seams in the chosen direction.
  // Boards are a realistic 3 inches wide (converted from the drawing's pixels-per-inch).
  const plankPx = Math.max(10, 3 * (pxPerFt / 12));
  function drawWood(x1, y1, x2, y2, clip) {
    const w_ = x2 - x1;
    const h_ = y2 - y1;
    if (w_ <= 0 || h_ <= 0) return;
    let g = `<g${clip}>`;
    g += `<rect x="${x1}" y="${y1}" width="${w_}" height="${h_}" fill="${woodColor}" />`;
    if (s.woodDir === 'vertical') {
      for (let gx = x1 + plankPx; gx < x2 - 0.5; gx += plankPx) {
        g += `<line x1="${gx}" y1="${y1}" x2="${gx}" y2="${y2}" stroke="${woodGrain}" stroke-width="0.6" opacity="0.6" />`;
      }
    } else {
      for (let gy = y1 + plankPx; gy < y2 - 0.5; gy += plankPx) {
        g += `<line x1="${x1}" y1="${gy}" x2="${x2}" y2="${gy}" stroke="${woodGrain}" stroke-width="0.6" opacity="0.6" />`;
      }
    }
    g += `</g>`;
    parts.push(g);
  }

  // Ground line
  parts.push(`<line x1="0" y1="${GROUND_Y}" x2="${VB_W}" y2="${GROUND_Y}" stroke="rgba(10,10,10,0.2)" stroke-width="1" />`);

  // Posts (always two outer posts)
  const postWidth = frameThick;
  parts.push(`<rect x="${startX - postWidth - 2}" y="${topY - 4}" width="${postWidth}" height="${gH + 4}" fill="${s.color}" />`);
  parts.push(`<rect x="${startX + gW + 2}" y="${topY - 4}" width="${postWidth}" height="${gH + 4}" fill="${s.color}" />`);

  // Capped post tops — stepped flat slab (narrow transition + wide overhang on top)
  if (s.topEdge === 'capped') {
    [startX - postWidth - 2 + postWidth / 2, startX + gW + 2 + postWidth / 2].forEach((px) => {
      const capW1 = postWidth + 2;
      const capH1 = 3;
      parts.push(`<rect x="${px - capW1 / 2}" y="${topY - 4 - capH1}" width="${capW1}" height="${capH1}" fill="${s.color}" />`);
      const capW2 = postWidth + 10;
      const capH2 = 4;
      parts.push(`<rect x="${px - capW2 / 2}" y="${topY - 4 - capH1 - capH2}" width="${capW2}" height="${capH2}" fill="${s.color}" />`);
    });
  }

  function drawLeaf(x, w, hasHingeLeft, hasHingeRight, leafId) {
    const bottomY = topY + gH;
    const thick = frameThick;
    const ix = x + thick;             // inner opening left
    const iright = x + w - thick;     // inner opening right
    const iw = iright - ix;
    const iTop = topY + thick;        // inner opening spring line
    const iBottom = bottomY - thick;  // inner opening bottom

    // Arched top: curve height above the spring line. Capped so it never exceeds headroom.
    const archH = s.arch === 'arched'
      ? Math.max(8, Math.min(w * 0.12, gH * 0.35, topY * 0.7, 46))
      : 0;
    const innerPeakY = iTop - archH;  // highest point of the (arched) inner opening

    // The inner opening shape — used both to clip the infill and as the frame's inner cut-out.
    const openingD = `M ${ix} ${iTop} ${archSeg(ix, iright, iTop, archH)} L ${iright} ${iBottom} L ${ix} ${iBottom} Z`;
    const cid = `gate-clip-${leafId}`;
    defsParts.push(`<clipPath id="${cid}"><path d="${openingD}" /></clipPath>`);
    const clipAttr = ` clip-path="url(#${cid})"`;

    // ---- Infill (clipped to the opening so it follows the arch cleanly) ----
    if (s.infill === 'metal-wood') {
      if (s.mesh === 'yes') {
        const barThick = Math.max(2.5, pxPerFt * 0.16);
        const split = Math.round(gH * (s.meshRatio / 100));
        const midY = topY + split;
        const meshH = (midY - barThick / 2) - innerPeakY;
        if (meshH > 0 && iw > 0) {
          parts.push(`<g${clipAttr}><rect x="${ix}" y="${innerPeakY}" width="${iw}" height="${meshH}" fill="url(#${meshId})" /></g>`);
        }
        drawWood(ix, midY + barThick / 2, iright, iBottom, clipAttr);
        parts.push(`<g${clipAttr}><rect x="${ix}" y="${midY - barThick / 2}" width="${iw}" height="${barThick}" fill="${s.color}" /></g>`);
      } else {
        drawWood(ix, innerPeakY, iright, iBottom, clipAttr);
      }
    } else if (s.infill === 'corrugated') {
      // Corrugated metal sheet clipped to the opening, on horizontal support rails.
      const cLight = shade(s.color, 0.3);
      const cDark = shade(s.color, -0.3);
      const cPitch = Math.max(6, 3.5 * (pxPerFt / 12));
      let g = `<g${clipAttr}>`;
      g += `<rect x="${ix}" y="${innerPeakY}" width="${iw}" height="${iBottom - innerPeakY}" fill="${s.color}" />`;
      for (let cx = ix + cPitch / 2; cx < iright - 0.5; cx += cPitch) {
        g += `<line x1="${cx.toFixed(1)}" y1="${innerPeakY}" x2="${cx.toFixed(1)}" y2="${iBottom}" stroke="${cLight}" stroke-width="1.1" opacity="0.85" />`;
        const vx = cx + cPitch / 2;
        if (vx < iright - 0.5) g += `<line x1="${vx.toFixed(1)}" y1="${innerPeakY}" x2="${vx.toFixed(1)}" y2="${iBottom}" stroke="${cDark}" stroke-width="0.9" opacity="0.6" />`;
      }
      const railN = s.height >= 8 ? 3 : 2;
      const railThick = Math.max(2.5, pxPerFt * 0.13);
      for (let r = 0; r < railN; r++) {
        const ry = iTop + ((iBottom - iTop) - railThick) * (r / (railN - 1));
        g += `<rect x="${ix}" y="${ry.toFixed(1)}" width="${iw}" height="${railThick.toFixed(1)}" fill="${cDark}" opacity="0.7" />`;
      }
      g += `</g>`;
      parts.push(g);
    } else {
      // Horizontal slats sit in the rectangular body only — they start below the arch
      // spring line so the top slat never overlaps/collides with the arched frame.
      const innerTopY = iTop + innerPad;
      const innerBottomY = iBottom - innerPad;
      const innerHeight = innerBottomY - innerTopY;
      const unit = slatHeight + slatGap;
      const slatCount = Math.max(1, Math.floor((innerHeight + slatGap) / unit));
      let g = `<g${clipAttr}>`;
      for (let i = 0; i < slatCount; i++) {
        const y = innerTopY + i * unit;
        g += `<rect x="${ix}" y="${y}" width="${iw}" height="${slatHeight}" fill="${s.color}" />`;
      }
      g += `</g>`;
      parts.push(g);
    }

    // ---- Frame as a single solid band (outer silhouette minus inner opening) ----
    // Drawn over the infill so the inner edge is always crisp; one shape => the arch blends
    // seamlessly into the side rails (no visible seam between separate rectangles).
    const outerD = `M ${x} ${bottomY} L ${x} ${topY} ${archSeg(x, x + w, topY, archH)} L ${x + w} ${bottomY} Z`;
    const innerD = `M ${ix} ${iBottom} L ${ix} ${iTop} ${archSeg(ix, iright, iTop, archH)} L ${iright} ${iBottom} Z`;
    parts.push(`<path d="${outerD} ${innerD}" fill="${s.color}" fill-rule="evenodd" />`);

    // Hinges — strap + knuckle hardware on the hinged edge(s).
    // Single swing: hinged on one side. Double swing: each leaf is hinged on its outer
    // edge, so the hardware ends up on both sides of the opening.
    function drawHinge(edgeX, dir) {
      const strapH = Math.max(3, thick * 0.3);   // strap thickness
      const out = Math.max(6, thick * 0.6);      // how far it reaches past the edge to the post
      const inn = thick * 0.6;                   // how far it laps back onto the rail
      const barrelW = Math.max(3, thick * 0.3);  // pivot knuckle
      const barrelH = Math.max(9, thick * 0.85);
      [topY + gH * 0.2, topY + gH * 0.5, topY + gH * 0.8].forEach((cy) => {
        const x1 = dir < 0 ? (edgeX - out) : (edgeX - inn);
        parts.push(`<rect x="${x1}" y="${cy - strapH / 2}" width="${out + inn}" height="${strapH}" fill="${s.color}" />`);
        parts.push(`<rect x="${(edgeX + dir * out) - barrelW / 2}" y="${cy - barrelH / 2}" width="${barrelW}" height="${barrelH}" fill="${s.color}" />`);
      });
    }
    if (hasHingeLeft) drawHinge(x, -1);
    if (hasHingeRight) drawHinge(x + w, 1);
  }

  // Plan-style swing indicator: a faint swept footprint + dashed edge + arrow showing
  // which way (and how far) a leaf opens, projected onto the ground in front of the gate.
  function drawSwingArc(pivotX, freeX) {
    const rx = Math.abs(freeX - pivotX);
    if (rx < 4) return;
    const ry = Math.max(22, Math.min(40, rx * 0.22));
    const sweep = freeX > pivotX ? 1 : 0;
    const endX = pivotX;
    const endY = GROUND_Y + ry;
    const edge = 'rgba(10,10,10,0.45)';
    // Faint shaded sweep area (pivot → free edge → arc to fully-open → back to pivot)
    parts.push(`<path d="M ${pivotX} ${GROUND_Y} L ${freeX} ${GROUND_Y} A ${rx} ${ry} 0 0 ${sweep} ${endX} ${endY} Z" fill="rgba(10,10,10,0.08)" stroke="none" />`);
    // Dashed sweep edge
    parts.push(`<path d="M ${freeX} ${GROUND_Y} A ${rx} ${ry} 0 0 ${sweep} ${endX} ${endY}" fill="none" stroke="${edge}" stroke-width="1.3" stroke-dasharray="6 4" />`);
    // Arrowhead at the open end (pointing toward the viewer)
    parts.push(`<path d="M ${endX - 4} ${endY - 5} L ${endX} ${endY + 1} L ${endX + 4} ${endY - 5}" fill="none" stroke="${edge}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />`);
  }

  if (s.type === 'double') {
    const leafW = gW / 2;
    drawLeaf(startX, leafW, true, false, 'l');
    drawLeaf(startX + leafW, leafW, false, true, 'r');
    // Center latch
    parts.push(`<circle cx="${startX + gW / 2}" cy="${topY + gH / 2}" r="3" fill="${s.color}" />`);
    // Each leaf swings out from its outer hinge
    drawSwingArc(startX, startX + leafW);
    drawSwingArc(startX + gW, startX + leafW);
  } else if (s.type === 'slide') {
    drawLeaf(startX, gW, false, false, 's');
    // Bottom track the gate rides on
    parts.push(`<line x1="${startX - 18}" y1="${GROUND_Y}" x2="${startX + gW + 18}" y2="${GROUND_Y}" stroke="${s.color}" stroke-width="2" />`);
    // Minimalistic rolling wheels beneath the gate (ring + hub)
    const wheelR = Math.max(3, Math.min(5, pxPerFt * 0.16));
    const wheelPos = s.width >= 8 ? [0.2, 0.5, 0.8] : [0.3, 0.7];
    wheelPos.forEach((f) => {
      const cx = startX + gW * f;
      const cy = GROUND_Y + wheelR;
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${wheelR}" fill="none" stroke="${s.color}" stroke-width="1.5" />`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${Math.max(1, wheelR * 0.35)}" fill="${s.color}" />`);
    });
  } else {
    // single swing
    drawLeaf(startX, gW, true, false, 's0');
    // Latch
    parts.push(`<circle cx="${startX + gW - frameThick - 4}" cy="${topY + gH / 2}" r="3" fill="${s.color}" />`);
    // Swings out from the left hinge
    drawSwingArc(startX, startX + gW);
  }

  // Dimensions
  const dim = 'rgba(10,10,10,0.35)';
  const isSwing = s.type === 'single' || s.type === 'double';
  // Swing gates use the bottom band for the swing-path footprint; width still shows in the summary.
  if (!isSwing) {
    const wY = GROUND_Y + 16;
    parts.push(`<line x1="${startX}" y1="${wY}" x2="${startX + gW}" y2="${wY}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<line x1="${startX}" y1="${wY - 3}" x2="${startX}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<line x1="${startX + gW}" y1="${wY - 3}" x2="${startX + gW}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<text x="${startX + gW / 2}" y="${wY + 18}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.5)">${s.width} FT</text>`);
  }
  const hX = startX - 22;
  parts.push(`<line x1="${hX}" y1="${topY}" x2="${hX}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${hX - 3}" y1="${topY}" x2="${hX + 3}" y2="${topY}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${hX - 3}" y1="${GROUND_Y}" x2="${hX + 3}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${hX - 6}" y="${(topY + GROUND_Y) / 2}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.5)" transform="rotate(-90 ${hX - 6} ${(topY + GROUND_Y) / 2})">${s.height} FT</text>`);

  return '<defs>' + defsParts.join('') + '</defs>' + parts.join('');
}
