/**
 * Pure SVG preview generator for a custom carport.
 *
 * Ported verbatim (drawing/geometry-wise) from the Astro page's draw() IIFE.
 * No DOM, no FormData, no side effects: takes a plain `state` object and
 * returns the inner SVG markup string (what was assigned to svg.innerHTML).
 *
 * The SVG is meant to be placed inside an <svg viewBox="0 0 800 450"> element.
 *
 * state shape (as read by the original readState()):
 *   roof      {string}  'gable' | 'flat' | 'lean-to'                 default 'gable'
 *   mounting  {string}  'freestanding' | 'attached'                  default 'freestanding'
 *   width     {number}  span in feet (int)                           default 20
 *   depth     {number}  length in feet (int)                         default 20
 *   height    {number}  clearance in feet (int)                      default 9
 *   pitch     {number}  gable rise per 12 (x:12, int)                default 3
 *   elevation {number}  lean-to slope angle in degrees (int)         default 15
 *   panel     {string}  'corrugated' | 'standing-seam' | 'polycarbonate'  default 'corrugated'
 *   sides     {string}  'open' | 'one' | 'two'                       default 'open'
 *   sidePos   {string}  'left' | 'right' (enclosed side when sides==='one')  default 'right'
 *   gutters   {string}  'yes' | 'no'                                 default 'no'
 *   color     {string}  frame finish hex                             default '#0A0A0A'
 *   roofColor {string}  roof finish hex                              default '#A7A8A4'
 */

import { shade, pts } from './svg.js';

export function renderCarport(state) {
  const VB_W = 800;
  const GROUND_Y = 392; // leaves headroom below for the width/depth dimension lines

  // Cavalier-style oblique projection: depth recedes up-and-to-the-right.
  // These factors set the apparent viewing angle and foreshortening of the depth axis.
  const OBQ_X = 0.46;
  const OBQ_Y = 0.34;

  // --- colour helpers (shade/pts hoisted to ./svg.js) ---------------------
  function luminance(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  // Lines that read against a given roof colour (light lines on dark roofs, dark lines on light roofs)
  function panelLine(hex) {
    return luminance(hex) < 0.5 ? 'rgba(255,255,255,0.30)' : 'rgba(10,10,10,0.24)';
  }

  // Draw evenly spaced lines across a quad, connecting the eave edge (a1→a2)
  // to the opposite edge (b1→b2). Used for roof panel texture (runs down-slope).
  function ribLines(a1, a2, b1, b2, count, stroke, sw) {
    let g = '';
    for (let i = 1; i < count; i++) {
      const f = i / count;
      const x1 = a1[0] + (a2[0] - a1[0]) * f;
      const y1 = a1[1] + (a2[1] - a1[1]) * f;
      const x2 = b1[0] + (b2[0] - b1[0]) * f;
      const y2 = b1[1] + (b2[1] - b1[1]) * f;
      g += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="${sw}" />`;
    }
    return g;
  }

  // --- state (replaces readState()) with defensive defaults and the same
  //     normalization the original draw() applied when a control was hidden ---
  const roof = state.roof || 'gable';
  const mounting = state.mounting || 'freestanding';
  const width = parseInt(state.width, 10) || 20;
  const depth = parseInt(state.depth, 10) || 20;
  const height = parseInt(state.height, 10) || 9;
  const pitch = parseInt(state.pitch, 10) || 3;       // Gable rise per 12 (x:12) — 3:12 default
  const elevation = parseInt(state.elevation, 10) || 15; // Lean-to slope angle in degrees — 15° default
  const panel = state.panel || 'corrugated';
  const sides = state.sides || 'open';
  const sidePos = state.sidePos || 'right';
  const gutters = state.gutters || 'no';
  const color = state.color || '#0A0A0A';
  const roofColor = state.roofColor || '#A7A8A4';

  // Reassemble the `s` object the original draw() used.
  const s = {
    roof, mounting, width, depth, height, pitch, elevation,
    panel, sides, sidePos, gutters, color, roofColor,
  };

  const overhangFt = 0.9;

  // Peak/slope rise (ft) above the eave.
  // Gable rises over half the span to a centre ridge (rise:12 pitch).
  // Lean-to is a single slope front→back; the back is lifted by depth·tan(elevation°).
  const pitchRatio = s.pitch / 12;
  const peakFt = s.roof === 'gable' ? (s.width / 2) * pitchRatio : 0;
  const backLiftFt = s.roof === 'lean-to' ? s.depth * Math.tan((s.elevation * Math.PI) / 180) : 0;

  // --- fit the whole structure into the viewBox (adaptive px/ft) ---------
  const availW = VB_W - 120;          // 60px breathing room each side (height dim sits in the left margin)
  const availH = GROUND_Y - 34;
  const horizFtEq = s.width + s.depth * OBQ_X + overhangFt * 2;
  const vertFtEq = s.height + peakFt + (s.depth * OBQ_Y) + backLiftFt + overhangFt;
  const pxPerFt = Math.min(availW / horizFtEq, availH / vertFtEq);

  const widthPx = s.width * pxPerFt;
  const heightPx = s.height * pxPerFt;
  const peakPx = peakFt * pxPerFt;
  const backLiftPx = backLiftFt * pxPerFt;
  const dvx = s.depth * pxPerFt * OBQ_X;   // depth projection — horizontal component
  const dvy = s.depth * pxPerFt * OBQ_Y;   // depth projection — vertical component (recedes upward)
  const overhang = overhangFt * pxPerFt;

  // Centre the front+projected footprint horizontally.
  const x0 = (VB_W - (widthPx + dvx)) / 2;     // front-left base x
  const xR = x0 + widthPx;                      // front-right base x
  const eaveY = GROUND_Y - heightPx;            // front eave (top of front posts)

  // Project a front-plane point to its back-plane counterpart.
  const back = (p) => [p[0] + dvx, p[1] - dvy];

  const frame = s.color;
  const frameDark = shade(frame, -0.25);
  const roofTop = s.roofColor;
  const roofSide = shade(roofTop, luminance(roofTop) < 0.5 ? 0.18 : -0.1); // shaded face for 3D read
  const roofFascia = shade(roofTop, luminance(roofTop) < 0.5 ? 0.30 : -0.18);
  const pLine = panelLine(roofTop);
  const isPoly = s.panel === 'polycarbonate';

  const postW = Math.max(5, pxPerFt * 0.4);
  const beamH = Math.max(5, pxPerFt * 0.45);
  const roofT = Math.max(5, pxPerFt * 0.5);  // roof edge / fascia thickness

  // Front roofline (left→right) at the front plane: the underside line where roof meets the frame.
  // Gable peaks at centre; Flat & Lean-to are flat across the front (Lean-to slopes in depth instead).
  const xC = x0 + widthPx / 2;
  let frontLine;
  if (s.roof === 'gable') {
    frontLine = [[x0, eaveY], [xC, eaveY - peakPx], [xR, eaveY]];
  } else {
    frontLine = [[x0, eaveY], [xR, eaveY]];
  }
  // Back roofline: project to the back plane, then lift (Lean-to rises toward the back).
  const backLine = frontLine.map((p) => [p[0] + dvx, p[1] - dvy - backLiftPx]);

  const defs = [];
  const parts = [];

  // Ground line
  parts.push(`<line x1="0" y1="${GROUND_Y}" x2="${VB_W}" y2="${GROUND_Y}" stroke="rgba(10,10,10,0.2)" stroke-width="1" />`);

  // ---- Attached: house wall plane behind the carport ----
  if (s.mounting === 'attached') {
    // Wall spans the back of the structure, rising from the back base to above the back eave.
    const blBase = [x0 + dvx, GROUND_Y - dvy];
    const brBase = [xR + dvx, GROUND_Y - dvy];
    const wallTopL = [x0 + dvx, Math.min(backLine[0][1], backLine[backLine.length - 1][1]) - overhang * 0.6];
    const wallTopR = [xR + dvx, wallTopL[1]];
    parts.push(`<polygon points="${pts([blBase, brBase, wallTopR, wallTopL])}" fill="rgba(10,10,10,0.05)" stroke="rgba(10,10,10,0.18)" stroke-width="1" />`);
    // Faint siding seams
    for (let i = 1; i <= 3; i++) {
      const y = blBase[1] + (wallTopL[1] - blBase[1]) * (i / 4);
      parts.push(`<line x1="${blBase[0].toFixed(1)}" y1="${y.toFixed(1)}" x2="${brBase[0].toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(10,10,10,0.10)" stroke-width="1" />`);
    }
  }

  // ---- Back posts (only when free-standing) — drawn light so they read as behind ----
  const bayCount = Math.max(1, Math.round(s.width / 12));
  const postXs = [];
  for (let i = 0; i <= bayCount; i++) postXs.push(x0 + (widthPx * i) / bayCount);

  // Knee brace (corner gusset) tying a post to the eave beam at ~45°. Length scales with the
  // bay width and post height so it stays proportional across every size and roof pitch.
  function kneeBrace(px, postTopY, dir, opacity) {
    const beamBottom = postTopY + beamH;
    const len = Math.max(8, Math.min((widthPx / bayCount) * 0.3, (GROUND_Y - postTopY) * 0.28, 42));
    const bw = Math.max(2, postW * 0.45);
    const op = opacity != null ? ` opacity="${opacity}"` : '';
    parts.push(`<line x1="${px.toFixed(1)}" y1="${(beamBottom + len).toFixed(1)}" x2="${(px + dir * len).toFixed(1)}" y2="${beamBottom.toFixed(1)}" stroke="${frame}" stroke-width="${bw.toFixed(1)}" stroke-linecap="round"${op} />`);
  }

  if (s.mounting === 'freestanding') {
    for (const px of postXs) {
      const bx = px + dvx - postW / 2;
      const topY = (eaveY - dvy - backLiftPx);
      parts.push(`<rect x="${bx.toFixed(1)}" y="${topY.toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - dvy - topY).toFixed(1)}" fill="${frame}" opacity="0.42" />`);
    }
    // Back eave beam
    parts.push(`<polygon points="${pts([
      [x0 + dvx, eaveY - dvy - backLiftPx],
      [xR + dvx, eaveY - dvy - backLiftPx],
      [xR + dvx, eaveY - dvy - backLiftPx + beamH],
      [x0 + dvx, eaveY - dvy - backLiftPx + beamH],
    ])}" fill="${frame}" opacity="0.42" />`);
    // Back-frame knee braces (faint, matching the back posts)
    const backTopY = eaveY - dvy - backLiftPx;
    postXs.forEach((px, i) => {
      if (i > 0) kneeBrace(px + dvx, backTopY, -1, 0.42);
      if (i < bayCount) kneeBrace(px + dvx, backTopY, 1, 0.42);
    });
  }

  // ---- Side top rails (eave beams running front→back along left and right) ----
  // Drawn before the roof so the roof overhang sits above them.
  function sideRail(frontTopP, backTopP) {
    parts.push(`<polygon points="${pts([
      frontTopP,
      backTopP,
      [backTopP[0], backTopP[1] + beamH],
      [frontTopP[0], frontTopP[1] + beamH],
    ])}" fill="${frameDark}" />`);
  }
  sideRail([x0, eaveY], [x0 + dvx, eaveY - dvy - backLiftPx]);
  sideRail([xR, eaveY], [xR + dvx, eaveY - dvy - backLiftPx]);

  // ---- Side privacy panels ----
  function sidePanel(frontBaseX, frontTopP) {
    const fb = [frontBaseX, GROUND_Y];
    const ft = frontTopP;
    const bt = [frontTopP[0] + dvx, frontTopP[1] - dvy - backLiftPx];
    const bb = [frontBaseX + dvx, GROUND_Y - dvy];
    parts.push(`<polygon points="${pts([fb, ft, bt, bb])}" fill="${frame}" opacity="0.16" stroke="${frame}" stroke-width="1" stroke-opacity="0.5" />`);
    // vertical slat hint lines
    for (let i = 1; i <= 5; i++) {
      const f = i / 6;
      const t1 = [fb[0] + (bb[0] - fb[0]) * f, fb[1] + (bb[1] - fb[1]) * f];
      const t2 = [ft[0] + (bt[0] - ft[0]) * f, ft[1] + (bt[1] - ft[1]) * f];
      parts.push(`<line x1="${t1[0].toFixed(1)}" y1="${t1[1].toFixed(1)}" x2="${t2[0].toFixed(1)}" y2="${t2[1].toFixed(1)}" stroke="${frame}" stroke-width="0.8" stroke-opacity="0.35" />`);
    }
  }
  // Two sides: enclose both. One side: honour the customer's Left/Right choice.
  // (Right is the near, fully-visible face; Left recedes and is partly occluded — but the
  // physical side matters for the build, so we draw whichever was chosen.)
  if (s.sides === 'two') {
    sidePanel(x0, [x0, eaveY]);
    sidePanel(xR, [xR, eaveY]);
  } else if (s.sides === 'one') {
    if (s.sidePos === 'left') sidePanel(x0, [x0, eaveY]);
    else sidePanel(xR, [xR, eaveY]);
  }

  // ---- Front posts (solid frame colour) ----
  for (const px of postXs) {
    parts.push(`<rect x="${(px - postW / 2).toFixed(1)}" y="${eaveY.toFixed(1)}" width="${postW.toFixed(1)}" height="${(GROUND_Y - eaveY).toFixed(1)}" fill="${frame}" />`);
  }

  // ---- Front eave beam (header tying the front posts) ----
  parts.push(`<rect x="${x0.toFixed(1)}" y="${eaveY.toFixed(1)}" width="${widthPx.toFixed(1)}" height="${beamH.toFixed(1)}" fill="${frame}" />`);

  // ---- Roof ----
  // Roof is drawn as solid sloped surfaces (top), shaded right-side returns, and a front fascia
  // so it reads as a real thickness sitting on the frame. Overhang extends past the posts.
  // Front & back eave corners with overhang, lifted by roofT (top of the roof slab)
  const segs = []; // each roof surface: {front:[a,b], back:[A,B]}
  if (s.roof === 'gable') {
    const fL = [x0 - overhang, eaveY - roofT];
    const fC = [xC, eaveY - peakPx - roofT];
    const fR = [xR + overhang, eaveY - roofT];
    const bL = back([x0 - overhang, eaveY]); bL[1] -= roofT + backLiftPx;
    const bC = back([xC, eaveY - peakPx]); bC[1] -= roofT + backLiftPx;
    const bR = back([xR + overhang, eaveY]); bR[1] -= roofT + backLiftPx;
    // extend front eave a touch forward (overhang in depth) for the front fascia
    segs.push({ front: [fL, fC], back: [bL, bC] });
    segs.push({ front: [fC, fR], back: [bC, bR] });
  } else if (s.roof === 'lean-to') {
    const fL = [x0 - overhang, eaveY - roofT];
    const fR = [xR + overhang, eaveY - roofT];
    const bL = back([x0 - overhang, eaveY]); bL[1] -= roofT + backLiftPx;
    const bR = back([xR + overhang, eaveY]); bR[1] -= roofT + backLiftPx;
    segs.push({ front: [fL, fR], back: [bL, bR] });
  } else { // flat
    const fL = [x0 - overhang, eaveY - roofT];
    const fR = [xR + overhang, eaveY - roofT];
    const bL = back([x0 - overhang, eaveY]); bL[1] -= roofT;
    const bR = back([xR + overhang, eaveY]); bR[1] -= roofT;
    segs.push({ front: [fL, fR], back: [bL, bR] });
  }

  // Front fascia (vertical band hanging from each front eave segment)
  const fasciaQuads = [];
  for (const seg of segs) {
    const [a, b] = seg.front;
    fasciaQuads.push([a, b, [b[0], b[1] + roofT], [a[0], a[1] + roofT]]);
  }
  // Right-side return fascia (from the right-most front corner going back)
  const rightFront = segs[segs.length - 1].front[1];
  const rightBack = segs[segs.length - 1].back[1];
  const rightReturn = [rightFront, rightBack, [rightBack[0], rightBack[1] + roofT], [rightFront[0], rightFront[1] + roofT]];

  // Purlins (roof framing running across the slope), drawn UNDER the roof skin: hidden by
  // solid panels, but visible through a translucent polycarbonate roof so the framing reads.
  for (const seg of segs) {
    const [a, b] = seg.front;
    const [A, B] = seg.back;
    const n = 4;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const p1 = [a[0] + (A[0] - a[0]) * t, a[1] + (A[1] - a[1]) * t];
      const p2 = [b[0] + (B[0] - b[0]) * t, b[1] + (B[1] - b[1]) * t];
      parts.push(`<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="${frameDark}" stroke-width="1.5" opacity="0.5" />`);
    }
  }

  // Paint order: top surfaces, then right return, then front fascia (closest to viewer)
  const panelDefs = isPoly ? ` opacity="0.6"` : '';
  for (const seg of segs) {
    const [a, b] = seg.front;
    const [A, B] = seg.back;
    parts.push(`<polygon points="${pts([a, b, B, A])}" fill="${roofTop}" stroke="rgba(10,10,10,0.25)" stroke-width="1"${panelDefs} />`);
    // panel texture down the slope (front edge → back edge)
    const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let count, sw;
    if (s.panel === 'standing-seam') { count = Math.max(3, Math.round(span / 26)); sw = 1.6; }
    else if (s.panel === 'polycarbonate') { count = Math.max(2, Math.round(span / 46)); sw = 1; }
    else { count = Math.max(4, Math.round(span / 11)); sw = 0.8; } // corrugated
    parts.push(ribLines(a, b, A, B, count, pLine, sw));
  }
  // Right return + front fascia
  parts.push(`<polygon points="${pts(rightReturn)}" fill="${roofSide}" stroke="rgba(10,10,10,0.25)" stroke-width="1"${panelDefs} />`);
  for (const q of fasciaQuads) {
    parts.push(`<polygon points="${pts(q)}" fill="${roofFascia}" stroke="rgba(10,10,10,0.25)" stroke-width="1"${panelDefs} />`);
  }

  // ---- Gutters (along the low front eave) + downspout on the right front post ----
  if (s.gutters === 'yes') {
    const gutY = eaveY + roofT + beamH * 0.2;
    const gutterColor = shade(frame, 0.15);
    parts.push(`<rect x="${(x0 - overhang).toFixed(1)}" y="${gutY.toFixed(1)}" width="${(widthPx + overhang * 2).toFixed(1)}" height="${Math.max(3, roofT * 0.5).toFixed(1)}" rx="2" fill="${gutterColor}" stroke="rgba(10,10,10,0.25)" stroke-width="0.8" />`);
    // downspout down the right front post
    // Run the downspout down the right front post (its outer face), not the roof overhang edge,
    // so it reads as attached to the frame and stays clear of the depth dimension line.
    const dsW = Math.max(3, postW * 0.4);
    const dsX = xR + postW / 2 - dsW;
    parts.push(`<rect x="${dsX.toFixed(1)}" y="${(gutY + roofT * 0.5).toFixed(1)}" width="${dsW.toFixed(1)}" height="${(GROUND_Y - gutY - roofT * 0.5).toFixed(1)}" fill="${gutterColor}" stroke="rgba(10,10,10,0.2)" stroke-width="0.6" />`);
  }

  // ---- Support members (front frame), drawn over the roof so they read crisply ----
  // Knee braces brace each post to the eave beam (every style). A Gable additionally shows a
  // king-post truss in the open gable end; Flat & Lean-to are braced post-and-beam frames.
  postXs.forEach((px, i) => {
    if (i > 0) kneeBrace(px, eaveY, -1);
    if (i < bayCount) kneeBrace(px, eaveY, 1);
  });
  // Only draw the king-post truss when the peak is tall enough to read as a truss; below that
  // a shallow gable shows as a clean braced post-and-beam frame (like Flat/Lean-to).
  if (s.roof === 'gable' && peakPx > 12) {
    const tieY = eaveY;                 // tie beam = front header top
    const apexY = eaveY - peakPx;       // ridge underside on the front gable
    const kingW = Math.max(3, postW * 0.6);
    const webW = Math.max(2, postW * 0.4);
    // King post (centre)
    parts.push(`<rect x="${(xC - kingW / 2).toFixed(1)}" y="${apexY.toFixed(1)}" width="${kingW.toFixed(1)}" height="${(tieY - apexY).toFixed(1)}" fill="${frame}" />`);
    // Two web struts from the king-post base out to the mid-points of each rafter
    const mL = [(x0 + xC) / 2, eaveY - peakPx / 2];
    const mR = [(xC + xR) / 2, eaveY - peakPx / 2];
    parts.push(`<line x1="${xC.toFixed(1)}" y1="${tieY.toFixed(1)}" x2="${mL[0].toFixed(1)}" y2="${mL[1].toFixed(1)}" stroke="${frame}" stroke-width="${webW.toFixed(1)}" stroke-linecap="round" />`);
    parts.push(`<line x1="${xC.toFixed(1)}" y1="${tieY.toFixed(1)}" x2="${mR[0].toFixed(1)}" y2="${mR[1].toFixed(1)}" stroke="${frame}" stroke-width="${webW.toFixed(1)}" stroke-linecap="round" />`);
  }

  // ---- Dimensions ----
  const dim = 'rgba(10,10,10,0.4)';
  const dimText = 'rgba(10,10,10,0.55)';
  // Width — along the front base
  const wY = GROUND_Y + 14;
  parts.push(`<line x1="${x0.toFixed(1)}" y1="${wY}" x2="${xR.toFixed(1)}" y2="${wY}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${x0.toFixed(1)}" y1="${wY - 3}" x2="${x0.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${xR.toFixed(1)}" y1="${wY - 3}" x2="${xR.toFixed(1)}" y2="${wY + 3}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${((x0 + xR) / 2).toFixed(1)}" y="${wY + 13}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}">${s.width} FT</text>`);
  // Depth — along the right base, receding back
  const fb = [xR, GROUND_Y];
  const bb = [xR + dvx, GROUND_Y - dvy];
  const dOff = [10, 6];
  parts.push(`<line x1="${(fb[0] + dOff[0]).toFixed(1)}" y1="${(fb[1] + dOff[1]).toFixed(1)}" x2="${(bb[0] + dOff[0]).toFixed(1)}" y2="${(bb[1] + dOff[1]).toFixed(1)}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${((fb[0] + bb[0]) / 2 + 16).toFixed(1)}" y="${((fb[1] + bb[1]) / 2 + 4).toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="1" fill="${dimText}">${s.depth} FT</text>`);
  // Height — on the left, from front eave to ground
  const hX = x0 - overhang - 18;
  const hMidY = (eaveY + GROUND_Y) / 2;
  parts.push(`<line x1="${hX.toFixed(1)}" y1="${eaveY.toFixed(1)}" x2="${hX.toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${(hX - 3).toFixed(1)}" y1="${eaveY.toFixed(1)}" x2="${(hX + 3).toFixed(1)}" y2="${eaveY.toFixed(1)}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<line x1="${(hX - 3).toFixed(1)}" y1="${GROUND_Y}" x2="${(hX + 3).toFixed(1)}" y2="${GROUND_Y}" stroke="${dim}" stroke-width="0.5" />`);
  parts.push(`<text x="${(hX - 6).toFixed(1)}" y="${hMidY.toFixed(1)}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="${dimText}" transform="rotate(-90 ${(hX - 6).toFixed(1)} ${hMidY.toFixed(1)})">${s.height} FT</text>`);

  return (defs.length ? '<defs>' + defs.join('') + '</defs>' : '') + parts.join('');
}
