/**
 * Pure SVG preview generator for a custom pergola.
 *
 * Same contract as the other lib/preview renderers: takes the plain config
 * state, returns inner-SVG markup for an <svg viewBox="0 0 800 450">.
 * Rectangular uses the carport's cavalier oblique projection; hexagonal
 * projects a regular hexagon (width = across flats, flat side facing front)
 * through the same oblique factors.
 *
 * state: { style, width, depth, height, shade, color } — see data/configurators.js.
 */

export function renderPergola(state) {
  const VB_W = 800;
  const GROUND_Y = 392;
  const OBQ_X = 0.46;
  const OBQ_Y = 0.34;

  function shade(hex, amount) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    const mix = (c) => (amount >= 0 ? Math.round(c + (255 - c) * amount) : Math.round(c * (1 + amount)));
    const to = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
    return '#' + to(mix(r)) + to(mix(g)) + to(mix(b));
  }
  function pts(arr) {
    return arr.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  }

  const style = state.style === 'hexagonal' ? 'hexagonal' : 'rectangular';
  const width = parseInt(state.width, 10) || 12;
  const depth = parseInt(state.depth, 10) || 12;
  const height = parseInt(state.height, 10) || 8;
  const shaded = state.shade === 'panels';
  const frame = state.color || '#0A0A0A';
  const frameDark = shade(frame, -0.25);

  const parts = [];
  const dim = 'rgba(10,10,10,0.4)';
  const dimText = 'rgba(10,10,10,0.55)';

  parts.push(`<line x1="0" y1="${GROUND_Y}" x2="${VB_W}" y2="${GROUND_Y}" stroke="rgba(10,10,10,0.2)" stroke-width="1" />`);

  if (style === 'rectangular') {
    // ---- fit ----
    const horizFtEq = width + depth * OBQ_X;
    const vertFtEq = height + depth * OBQ_Y + 1.5;
    const pxPerFt = Math.min((VB_W - 120) / horizFtEq, (GROUND_Y - 34) / vertFtEq);
    const widthPx = width * pxPerFt;
    const heightPx = height * pxPerFt;
    const dvx = depth * pxPerFt * OBQ_X;
    const dvy = depth * pxPerFt * OBQ_Y;
    const x0 = (VB_W - (widthPx + dvx)) / 2;
    const xR = x0 + widthPx;
    const eaveY = GROUND_Y - heightPx;
    const postW = Math.max(5, pxPerFt * 0.4);
    const beamH = Math.max(5, pxPerFt * 0.45);
    const raftT = Math.max(3, pxPerFt * 0.3);
    const lift = beamH; // rafters sit on top of the header beams

    // Back posts + back header (faint — they read as behind)
    for (const px of [x0, xR]) {
      parts.push(`<rect x="${(px + dvx - postW / 2).toFixed(1)}" y="${(eaveY - dvy).toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - dvy - (eaveY - dvy)).toFixed(1)}" fill="${frame}" opacity="0.42" />`);
    }
    parts.push(`<rect x="${(x0 + dvx).toFixed(1)}" y="${(eaveY - dvy).toFixed(1)}" width="${widthPx.toFixed(1)}" height="${beamH.toFixed(1)}" fill="${frame}" opacity="0.42" />`);

    // Side rails (front-left→back-left, front-right→back-right)
    for (const px of [x0, xR]) {
      parts.push(`<polygon points="${pts([
        [px, eaveY], [px + dvx, eaveY - dvy],
        [px + dvx, eaveY - dvy + beamH], [px, eaveY + beamH],
      ])}" fill="${frameDark}" />`);
    }

    // Mid-span posts once a side passes 16 ft (matches the estimator's count)
    if (Math.max(width, depth) > 16) {
      const midOff = depth > width
        ? { x: dvx / 2, y: dvy / 2, xs: [x0, xR] } // long depth → mid posts on the side rails
        : { x: 0, y: 0, xs: [x0 + widthPx / 2] };  // long width → mid post pair front + back
      for (const bx of midOff.xs) {
        parts.push(`<rect x="${(bx + midOff.x - postW / 2).toFixed(1)}" y="${(eaveY - midOff.y).toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - midOff.y - (eaveY - midOff.y)).toFixed(1)}" fill="${frame}" opacity="0.7" />`);
        if (midOff.xs.length === 1) {
          parts.push(`<rect x="${(bx + dvx - postW / 2).toFixed(1)}" y="${(eaveY - dvy).toFixed(1)}" width="${postW.toFixed(1)}" height="${heightPx.toFixed(1)}" fill="${frame}" opacity="0.42" />`);
        }
      }
    }

    // Shade panels — translucent plane over the rafter deck
    if (shaded) {
      parts.push(`<polygon points="${pts([
        [x0, eaveY - lift], [xR, eaveY - lift],
        [xR + dvx, eaveY - lift - dvy], [x0 + dvx, eaveY - lift - dvy],
      ])}" fill="${frame}" opacity="0.14" stroke="${frame}" stroke-width="0.8" stroke-opacity="0.4" />`);
    }

    // Rafter deck — evenly spaced, spanning front→back (one every ~16")
    const raftCount = Math.max(5, Math.round(width / 1.33));
    for (let i = 0; i <= raftCount; i++) {
      const px = x0 + (widthPx * i) / raftCount;
      parts.push(`<polygon points="${pts([
        [px - raftT / 2, eaveY - lift], [px + raftT / 2, eaveY - lift],
        [px + raftT / 2 + dvx, eaveY - lift - dvy], [px - raftT / 2 + dvx, eaveY - lift - dvy],
      ])}" fill="${frameDark}" opacity="0.85" />`);
    }
    // Two purlins running across the rafters
    for (const f of [1 / 3, 2 / 3]) {
      parts.push(`<line x1="${(x0 + dvx * f).toFixed(1)}" y1="${(eaveY - lift - dvy * f - raftT * 0.6).toFixed(1)}" x2="${(xR + dvx * f).toFixed(1)}" y2="${(eaveY - lift - dvy * f - raftT * 0.6).toFixed(1)}" stroke="${frame}" stroke-width="${Math.max(2, raftT * 0.7).toFixed(1)}" />`);
    }

    // Front posts + front header beam (solid, closest to viewer)
    for (const px of [x0, xR]) {
      parts.push(`<rect x="${(px - postW / 2).toFixed(1)}" y="${eaveY.toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - eaveY).toFixed(1)}" fill="${frame}" />`);
    }
    parts.push(`<rect x="${x0.toFixed(1)}" y="${eaveY.toFixed(1)}" width="${widthPx.toFixed(1)}" height="${beamH.toFixed(1)}" fill="${frame}" />`);
    // Corner knee braces on the front frame
    const braceLen = Math.min(widthPx * 0.18, heightPx * 0.3, 40);
    const braceW = Math.max(2, postW * 0.45);
    parts.push(`<line x1="${x0.toFixed(1)}" y1="${(eaveY + beamH + braceLen).toFixed(1)}" x2="${(x0 + braceLen).toFixed(1)}" y2="${(eaveY + beamH).toFixed(1)}" stroke="${frame}" stroke-width="${braceW.toFixed(1)}" stroke-linecap="round" />`);
    parts.push(`<line x1="${xR.toFixed(1)}" y1="${(eaveY + beamH + braceLen).toFixed(1)}" x2="${(xR - braceLen).toFixed(1)}" y2="${(eaveY + beamH).toFixed(1)}" stroke="${frame}" stroke-width="${braceW.toFixed(1)}" stroke-linecap="round" />`);

    // ---- dimensions ----
    const wY = GROUND_Y + 14;
    parts.push(`<line x1="${x0.toFixed(1)}" y1="${wY}" x2="${xR.toFixed(1)}" y2="${wY}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<line x1="${x0.toFixed(1)}" y1="${wY - 3}" x2="${x0.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<line x1="${xR.toFixed(1)}" y1="${wY - 3}" x2="${xR.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<text x="${((x0 + xR) / 2).toFixed(1)}" y="${wY + 13}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}">${width} FT</text>`);
    parts.push(`<line x1="${(xR + 10).toFixed(1)}" y1="${(GROUND_Y + 6).toFixed(1)}" x2="${(xR + dvx + 10).toFixed(1)}" y2="${(GROUND_Y - dvy + 6).toFixed(1)}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<text x="${(xR + dvx / 2 + 26).toFixed(1)}" y="${(GROUND_Y - dvy / 2 + 4).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="1" fill="${dimText}">${depth} FT</text>`);
    const hX = x0 - 22;
    const hMidY = (eaveY + GROUND_Y) / 2;
    parts.push(`<line x1="${hX.toFixed(1)}" y1="${eaveY.toFixed(1)}" x2="${hX.toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<text x="${(hX - 6).toFixed(1)}" y="${hMidY.toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}" transform="rotate(-90 ${(hX - 6).toFixed(1)} ${hMidY.toFixed(1)})">${height} FT</text>`);
  } else {
    // ---- hexagonal ----
    // Regular hexagon, width = across flats, flat side facing the viewer.
    // Plan vertices at 0°,60°,…,300° (circumradius R = W/√3) put an edge at the
    // front; z' measures recession from that front edge (0 → W across flats).
    const R = width / Math.sqrt(3);
    const horizFtEq = 2 * R + width * OBQ_X;
    const vertFtEq = height + width * OBQ_Y + 1.5;
    const pxPerFt = Math.min((VB_W - 140) / horizFtEq, (GROUND_Y - 34) / vertFtEq);
    const heightPx = height * pxPerFt;
    const xLeft = (VB_W - horizFtEq * pxPerFt) / 2;
    const postW = Math.max(5, pxPerFt * 0.4);
    const beamH = Math.max(5, pxPerFt * 0.45);

    const verts = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const vx = R * Math.cos(a);
      const vz = R * Math.sin(a) + width / 2; // z' ∈ [0, W]; 0 = front edge
      const sx = xLeft + (vx + R + vz * OBQ_X) * pxPerFt;
      const syBase = GROUND_Y - vz * OBQ_Y * pxPerFt;
      verts.push({ sx, syBase, syTop: syBase - heightPx, z: vz });
    }
    const byDepth = [...verts].sort((a, b) => b.z - a.z); // back first
    const topRing = verts.map((v) => [v.sx, v.syTop]);
    const cz = width / 2;
    const centerTop = [xLeft + (R + cz * OBQ_X) * pxPerFt, GROUND_Y - cz * OBQ_Y * pxPerFt - heightPx];

    // Posts, back to front, fading with recession
    for (const v of byDepth) {
      const op = v.z > width * 0.66 ? 0.42 : v.z > width * 0.33 ? 0.7 : 1;
      parts.push(`<rect x="${(v.sx - postW / 2).toFixed(1)}" y="${v.syTop.toFixed(1)}" width="${postW.toFixed(1)}" height="${heightPx.toFixed(1)}" fill="${frame}" opacity="${op}" />`);
    }

    // Shade panels — translucent hex top under the rafters
    if (shaded) {
      parts.push(`<polygon points="${pts(topRing)}" fill="${frame}" opacity="0.14" />`);
    }

    // Radial rafters: center → each vertex, plus center → each edge midpoint
    for (let i = 0; i < 6; i++) {
      const v = topRing[i];
      const nxt = topRing[(i + 1) % 6];
      const mid = [(v[0] + nxt[0]) / 2, (v[1] + nxt[1]) / 2];
      parts.push(`<line x1="${centerTop[0].toFixed(1)}" y1="${centerTop[1].toFixed(1)}" x2="${v[0].toFixed(1)}" y2="${v[1].toFixed(1)}" stroke="${frameDark}" stroke-width="2.2" opacity="0.85" />`);
      parts.push(`<line x1="${centerTop[0].toFixed(1)}" y1="${centerTop[1].toFixed(1)}" x2="${mid[0].toFixed(1)}" y2="${mid[1].toFixed(1)}" stroke="${frameDark}" stroke-width="1.4" opacity="0.7" />`);
    }
    // Center boss where the radials meet
    parts.push(`<circle cx="${centerTop[0].toFixed(1)}" cy="${centerTop[1].toFixed(1)}" r="${Math.max(3, postW * 0.5).toFixed(1)}" fill="${frame}" />`);
    // Header-beam ring tying the six posts
    parts.push(`<polygon points="${pts(topRing)}" fill="none" stroke="${frame}" stroke-width="${beamH.toFixed(1)}" stroke-linejoin="round" />`);

    // ---- caption: across flats. No witness ticks — the across-flats span has
    // no true horizontal projection here, so a ticked line would misdimension
    // whatever edge it happened to bound. Plain centered caption instead.
    const xs = verts.map((v) => v.sx);
    const capX = (Math.min(...xs) + Math.max(...xs)) / 2;
    parts.push(`<text x="${capX.toFixed(1)}" y="${GROUND_Y + 27}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}">${width} FT ACROSS FLATS</text>`);
    const hX = Math.min(...verts.map((v) => v.sx)) - 22;
    const hMidY = GROUND_Y - heightPx / 2;
    parts.push(`<line x1="${hX.toFixed(1)}" y1="${(GROUND_Y - heightPx).toFixed(1)}" x2="${hX.toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
    parts.push(`<text x="${(hX - 6).toFixed(1)}" y="${hMidY.toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}" transform="rotate(-90 ${(hX - 6).toFixed(1)} ${hMidY.toFixed(1)})">${height} FT</text>`);
  }

  return parts.join('');
}
