// Railing SVG preview renderer — pure, DOM-free port of the Astro preview generator.
//
// Ported verbatim (geometry/constants/colors unchanged) from the draw() IIFE in
// src/pages/customize/railing.astro. Returns the inner SVG markup string that the
// original assigned to svg.innerHTML, for an SVG using viewBox "0 0 800 450".
//
// state shape (as read by the source's readState()):
//   app      : 'balcony' | 'stairs' | 'handrail'     (default 'balcony')
//   infill   : 'pickets' | 'horizontal' | 'cable' | 'glass' | 'ornamental'
//              (ignored when app === 'handrail')      (default 'pickets')
//   toprail  : 'flat' | 'round' | 'wood'              (default 'flat')
//   height   : number (int, inches)                   (default 36)
//   lengthFt : number (feet). The website always previews a representative 12 ft
//              ("measured on site"); here the owner's run length drives the
//              drawing, so 12 ft reproduces exactly what the customer saw.
//   spacing  : 'standard' | 'wide'  (pickets only)    (default 'standard')
//   mounting : 'surface' | 'fascia'                   (default 'surface')
//   color    : string (hex, e.g. '#0A0A0A')           (default '#0A0A0A')

export function renderRailing(state) {
  const st = state || {};

  // ---- Normalize state (replaces readState + DOM defaults/fallbacks) ----
  const s = {
    app: st.app != null ? st.app : 'balcony',
    infill: st.infill != null ? st.infill : 'pickets',
    toprail: st.toprail != null ? st.toprail : 'flat',
    height: parseInt(st.height, 10) || 36,
    length: Math.max(3, Number(st.lengthFt) || 12),
    spacing: st.spacing != null ? st.spacing : 'standard',
    mounting: st.mounting != null ? st.mounting : 'surface',
    color: st.color != null ? st.color : '#0A0A0A',
  };

  // ---- Constants (unchanged from source) ----
  const VB_W = 800, GROUND = 380, PAD_X = 80;
  const woodColor = '#B89472';

  const isHand = s.app === 'handrail';
  const isStairs = s.app === 'stairs';

  const usableW = VB_W - PAD_X * 2;
  const pxPerFt = Math.min(usableW / s.length, 46);
  const railW = s.length * pxPerFt;
  const startX = (VB_W - railW) / 2;
  const endX = startX + railW;
  const pxPerIn = Math.min(230 / s.height, 4.6);
  const railH = s.height * pxPerIn;
  const topY = GROUND - railH;
  const pxPerInLen = pxPerFt / 12;

  const postW = Math.max(5, pxPerIn * 0.9);
  const topThick = s.toprail === 'wood' ? Math.max(9, pxPerIn * 2.4) : s.toprail === 'round' ? Math.max(8, pxPerIn * 2.2) : Math.max(6, pxPerIn * 1.8);
  const botThick = Math.max(4, pxPerIn * 1.2);
  const dim = 'rgba(10,10,10,0.35)';
  const parts = [];
  let hTopY = topY, hBotY = GROUND; // where the height dimension is measured (overridden for stairs)

  parts.push(`<line x1="0" y1="${GROUND}" x2="${VB_W}" y2="${GROUND}" stroke="rgba(10,10,10,0.2)" stroke-width="1"/>`);

  function topRail(x1, x2, yTop) {
    if (s.toprail === 'wood') {
      const steel = topThick * 0.45;
      parts.push(`<rect x="${x1}" y="${yTop + (topThick - steel)}" width="${x2 - x1}" height="${steel}" fill="${s.color}"/>`);
      parts.push(`<rect x="${x1}" y="${yTop}" width="${x2 - x1}" height="${topThick - steel}" rx="2" fill="${woodColor}"/>`);
    } else if (s.toprail === 'round') {
      parts.push(`<rect x="${x1}" y="${yTop}" width="${x2 - x1}" height="${topThick}" rx="${topThick / 2}" fill="${s.color}"/>`);
    } else {
      parts.push(`<rect x="${x1}" y="${yTop}" width="${x2 - x1}" height="${topThick}" fill="${s.color}"/>`);
    }
  }

  if (isHand) {
    topRail(startX, endX, topY);
    const nB = Math.max(2, Math.round(s.length / 4));
    for (let i = 0; i <= nB; i++) {
      const bx = startX + railW * (i / nB);
      parts.push(`<rect x="${bx - 2}" y="${topY + topThick}" width="4" height="${GROUND - (topY + topThick)}" fill="${s.color}" opacity="0.9"/>`);
      parts.push(`<rect x="${bx - 7}" y="${GROUND - 4}" width="14" height="4" fill="${s.color}"/>`);
    }
    parts.push(`<path d="M ${startX} ${topY + topThick / 2} q -12 0 -12 14" fill="none" stroke="${s.color}" stroke-width="${topThick}" stroke-linecap="round"/>`);
    parts.push(`<path d="M ${endX} ${topY + topThick / 2} q 12 0 12 14" fill="none" stroke="${s.color}" stroke-width="${topThick}" stroke-linecap="round"/>`);
  } else if (isStairs) {
    // Stylized staircase ascending to the right; the railing is a raked panel
    // (top rail + bottom rail parallel to the slope) that sits ON TOP of the steps.
    const N = Math.max(3, Math.min(5, Math.round(s.length / 3)));
    const run = railW / N;
    const stairRailH = Math.min(railH, run * 1.1, 100); // keep the panel visually proportionate
    const topMargin = 28;
    const maxRise = (GROUND - topMargin - stairRailH) / (N + 1); // so nothing runs off the top
    const rise = Math.max(12, Math.min(run * 0.55, maxRise));

    // Pitch line through the step nosings (front edge of each tread).
    const pitch = (x) => (GROUND - rise) - ((x - startX) / run) * rise;
    const railTopAt = (x) => pitch(x) - stairRailH;

    // Staircase outline (treads + risers), drawn faint behind the railing.
    let d = `M ${startX} ${GROUND}`;
    for (let k = 1; k <= N; k++) {
      const xf = startX + (k - 1) * run, yt = GROUND - k * rise;
      d += ` L ${xf} ${yt} L ${xf + run} ${yt}`;
    }
    parts.push(`<path d="${d}" fill="none" stroke="rgba(10,10,10,0.28)" stroke-width="1.5" stroke-linejoin="round"/>`);

    const ry1 = railTopAt(startX), ry2 = railTopAt(endX);
    const by1 = pitch(startX), by2 = pitch(endX);

    // Infill — spaced symmetrically between the top-rail underside and the bottom-rail top
    // (the bottom rail's thickness is accounted for so the top and bottom gaps match).
    if (s.infill === 'horizontal' || s.infill === 'cable') {
      const lines = s.infill === 'cable'
        ? Math.max(5, Math.min(16, Math.round(s.height / 3)))
        : Math.max(3, Math.min(10, Math.round(s.height / 4.5)));
      const it1 = ry1 + topThick, ib1 = by1 - botThick;
      const it2 = ry2 + topThick, ib2 = by2 - botThick;
      for (let i = 1; i <= lines; i++) {
        const f = i / (lines + 1);
        parts.push(`<line x1="${startX}" y1="${it1 + f * (ib1 - it1)}" x2="${endX}" y2="${it2 + f * (ib2 - it2)}" stroke="${s.color}" stroke-width="${s.infill === 'cable' ? 1.5 : Math.max(2.5, pxPerInLen)}"/>`);
      }
    } else if (s.infill === 'glass') {
      parts.push(`<polygon points="${startX + 5},${ry1 + topThick} ${endX - 5},${ry2 + topThick} ${endX - 5},${by2 - botThick} ${startX + 5},${by1 - botThick}" fill="rgba(120,140,150,0.18)" stroke="rgba(120,140,150,0.5)" stroke-width="1"/>`);
    } else {
      // Vertical pickets, equal length, between the parallel rails (resting on the stairs).
      const pitchPx = Math.max(9, ((s.spacing === 'wide' ? 5 : 4) + 0.75) * pxPerInLen);
      const pw = Math.max(2, 0.75 * pxPerInLen);
      for (let x = startX + pitchPx * 0.7; x < endX - 2; x += pitchPx) {
        const yt = railTopAt(x) + topThick, yb = pitch(x);
        if (yb > yt) parts.push(`<rect x="${x - pw / 2}" y="${yt}" width="${pw}" height="${yb - yt}" fill="${s.color}"/>`);
      }
      if (s.infill === 'ornamental') {
        const f = 0.5;
        parts.push(`<line x1="${startX}" y1="${ry1 + topThick + f * (stairRailH - topThick)}" x2="${endX}" y2="${ry2 + topThick + f * (stairRailH - topThick)}" stroke="${s.color}" stroke-width="${botThick}"/>`);
      }
    }

    // Bottom rail (on the nosing line), then top rail over the picket ends.
    parts.push(`<polygon points="${startX},${by1 - botThick} ${endX},${by2 - botThick} ${endX},${by2} ${startX},${by1}" fill="${s.color}"/>`);
    parts.push(`<polygon points="${startX},${ry1} ${endX},${ry2} ${endX},${ry2 + topThick} ${startX},${ry1 + topThick}" fill="${s.color}"/>`);
    if (s.toprail === 'wood') parts.push(`<polygon points="${startX},${ry1} ${endX},${ry2} ${endX},${ry2 + topThick * 0.55} ${startX},${ry1 + topThick * 0.55}" fill="${woodColor}"/>`);

    // Mounting: surface = newels stand on the steps; fascia = railing bolts to the side of each step.
    if (s.mounting === 'fascia') {
      const depth = Math.max(14, rise * 0.5);
      // Subtle stair stringer (the side board the railing bolts to).
      parts.push(`<polygon points="${startX},${by1} ${endX},${by2} ${endX},${by2 + depth} ${startX},${GROUND}" fill="rgba(10,10,10,0.05)" stroke="rgba(10,10,10,0.2)" stroke-width="1"/>`);
      // A mounting bracket on each step riser — sitting on the step at the nosing, not floating.
      const brH = Math.min(Math.max(8, rise * 0.6), 16);
      const brW = Math.max(6, postW * 0.85);
      for (let k = 1; k <= N; k++) {
        const nx = startX + (k - 1) * run, ny = GROUND - k * rise;
        parts.push(`<rect x="${nx - brW / 2}" y="${ny}" width="${brW}" height="${brH}" fill="${s.color}"/>`);
      }
      // End newels land on the structure (bottom landing and top tread).
      parts.push(`<rect x="${startX - postW / 2}" y="${ry1}" width="${postW}" height="${GROUND - ry1}" fill="${s.color}"/>`);
      parts.push(`<rect x="${endX - postW / 2}" y="${ry2}" width="${postW}" height="${(GROUND - N * rise) - ry2}" fill="${s.color}"/>`);
    } else {
      // Surface mount: newels stand on the bottom landing and the top tread, with base plates.
      parts.push(`<rect x="${startX - postW / 2}" y="${ry1}" width="${postW}" height="${GROUND - ry1}" fill="${s.color}"/>`);
      parts.push(`<rect x="${endX - postW / 2}" y="${ry2}" width="${postW}" height="${(GROUND - N * rise) - ry2}" fill="${s.color}"/>`);
      parts.push(`<rect x="${startX - postW / 2 - 4}" y="${GROUND - 4}" width="${postW + 8}" height="4" fill="${s.color}"/>`);
      parts.push(`<rect x="${endX - postW / 2 - 4}" y="${GROUND - N * rise - 4}" width="${postW + 8}" height="4" fill="${s.color}"/>`);
    }

    hTopY = ry1; hBotY = by1;
  } else {
    const bottomRailY = GROUND - Math.max(8, railH * 0.14);
    const postXs = [startX];
    for (let xf = 6; xf < s.length; xf += 6) postXs.push(startX + xf * pxPerFt);
    postXs.push(endX);
    postXs.forEach((px) => {
      parts.push(`<rect x="${px - postW / 2}" y="${topY}" width="${postW}" height="${GROUND - topY}" fill="${s.color}"/>`);
      if (s.mounting === 'surface') parts.push(`<rect x="${px - postW / 2 - 4}" y="${GROUND - 4}" width="${postW + 8}" height="4" fill="${s.color}"/>`);
      else parts.push(`<rect x="${px - postW / 2 - 5}" y="${GROUND - 20}" width="5" height="16" fill="${s.color}"/>`);
    });
    const infillTop = topY + topThick + 1;
    const infillBot = bottomRailY - 1;
    if (s.infill === 'glass') {
      for (let i = 0; i < postXs.length - 1; i++) {
        const a = postXs[i] + postW / 2 + 3, b = postXs[i + 1] - postW / 2 - 3;
        if (b > a) parts.push(`<rect x="${a}" y="${infillTop}" width="${b - a}" height="${infillBot - infillTop}" fill="rgba(120,140,150,0.18)" stroke="rgba(120,140,150,0.5)" stroke-width="1"/>`);
      }
    } else if (s.infill === 'horizontal' || s.infill === 'cable') {
      const lines = s.infill === 'cable'
        ? Math.max(5, Math.round((infillBot - infillTop) / (3 * pxPerIn)))
        : Math.max(3, Math.min(10, Math.round(s.height / 4.5)));
      for (let k = 0; k < lines; k++) {
        const y = infillTop + (k + 1) * ((infillBot - infillTop) / (lines + 1));
        parts.push(`<line x1="${startX}" y1="${y}" x2="${endX}" y2="${y}" stroke="${s.color}" stroke-width="${s.infill === 'cable' ? 1.5 : Math.max(2.5, pxPerIn * 0.8)}"/>`);
      }
    } else {
      const pitch = Math.max(8, ((s.spacing === 'wide' ? 5 : 4) + 0.75) * pxPerInLen);
      const pw = Math.max(2, 0.75 * pxPerInLen);
      for (let x = startX + pitch; x < endX - 2; x += pitch) {
        parts.push(`<rect x="${x - pw / 2}" y="${infillTop}" width="${pw}" height="${infillBot - infillTop}" fill="${s.color}"/>`);
      }
      if (s.infill === 'ornamental') {
        const midY = (infillTop + infillBot) / 2;
        parts.push(`<rect x="${startX}" y="${midY - botThick / 2}" width="${railW}" height="${botThick}" fill="${s.color}"/>`);
        for (let x = startX + pitch * 1.5; x < endX - 2; x += pitch * 3) {
          parts.push(`<circle cx="${x}" cy="${midY}" r="${Math.max(3, pxPerIn)}" fill="none" stroke="${s.color}" stroke-width="2"/>`);
        }
      }
    }
    if (s.infill !== 'cable') parts.push(`<rect x="${startX}" y="${bottomRailY}" width="${railW}" height="${botThick}" fill="${s.color}"/>`);
    topRail(startX - 2, endX + 2, topY);

    const wY = GROUND + 18;
    parts.push(`<line x1="${startX}" y1="${wY}" x2="${endX}" y2="${wY}" stroke="${dim}" stroke-width="0.5"/>`);
    parts.push(`<line x1="${startX}" y1="${wY - 3}" x2="${startX}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5"/>`);
    parts.push(`<line x1="${endX}" y1="${wY - 3}" x2="${endX}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5"/>`);
    parts.push(`<text x="${(startX + endX) / 2}" y="${wY + 16}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.5)">${s.length} FT</text>`);
  }

  const hX = startX - 26;
  parts.push(`<line x1="${hX}" y1="${hTopY}" x2="${hX}" y2="${hBotY}" stroke="${dim}" stroke-width="0.5"/>`);
  parts.push(`<line x1="${hX - 3}" y1="${hTopY}" x2="${hX + 3}" y2="${hTopY}" stroke="${dim}" stroke-width="0.5"/>`);
  parts.push(`<line x1="${hX - 3}" y1="${hBotY}" x2="${hX + 3}" y2="${hBotY}" stroke="${dim}" stroke-width="0.5"/>`);
  parts.push(`<text x="${hX - 6}" y="${(hTopY + hBotY) / 2}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.5)" transform="rotate(-90 ${hX - 6} ${(hTopY + hBotY) / 2})">${s.height} IN</text>`);

  return parts.join('');
}
