// Fence SVG preview renderer — pure, DOM-free port of the Astro preview generator.
//
// Ported verbatim (geometry/constants/colors unchanged) from the draw() IIFE in
// src/pages/customize/fence.astro. Returns the inner SVG markup string that the
// original assigned to svg.innerHTML, for an SVG using viewBox "0 0 800 450".
//
// state shape (as read by the source's readState()):
//   type        : 'horizontal-slat' | 'wood-mesh'   (default 'horizontal-slat')
//   height      : number (int, feet)                (default 6)
//   panelWidth  : number (int, feet)                (default 6)
//   style       : 'flat' | 'arched'                 (default 'flat')
//                 NOTE: forced to 'flat' when type === 'horizontal-slat'
//   meshRatio   : number (int, % of panel height that is mesh, top)  (default 25)
//   slatSpacing : number (float, inches between slats)               (default 1)
//   color       : string (hex, e.g. '#0A0A0A')      (default '#0A0A0A')
//   topEdge     : 'flat' | 'capped'                 (default 'flat')

export function renderFence(state) {
  const s = state || {};

  // ---- Normalize state (replaces readState + DOM defaults/fallbacks) ----
  const type = s.type != null ? s.type : 'horizontal-slat';
  const height = parseInt(s.height, 10) || 6;
  const panelWidth = parseInt(s.panelWidth, 10) || 6;
  // The source forces style='flat' when type==='horizontal-slat' (the style picker
  // is hidden for that type). Replicate that normalization purely.
  const style = type === 'horizontal-slat'
    ? 'flat'
    : (s.style != null ? s.style : 'flat');
  const meshRatio = parseInt(s.meshRatio, 10) || 25;
  const slatSpacing = parseFloat(s.slatSpacing) || 1;
  const color = s.color != null ? s.color : '#0A0A0A';
  const topEdge = s.topEdge != null ? s.topEdge : 'flat';

  // ---- Constants (unchanged from source) ----
  const PANEL_COUNT = 2; // Always render two panels for the visual

  const VB_W = 800;
  const PAD_X = 50;
  const GROUND_Y = 420;

  function archPath(x1, x2, topY, archHeightPx, bottomY) {
    // Path enclosing the panel area with an arched top that peaks ABOVE topY.
    // Endpoints meet posts at (x1, topY) and (x2, topY); the curve peaks at (midX, topY - archHeightPx).
    // This avoids the "tooth-like" silhouette where posts protrude above a dipped panel top.
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${topY} Q ${midX} ${topY - archHeightPx} ${x2} ${topY} L ${x2} ${bottomY} L ${x1} ${bottomY} Z`;
  }

  function archStrokePath(x1, x2, topY, archHeightPx) {
    // Just the arched top curve as a stroke-able path (no closure). Peaks above topY.
    const midX = (x1 + x2) / 2;
    return `M ${x1} ${topY} Q ${midX} ${topY - archHeightPx} ${x2} ${topY}`;
  }

  const totalWidthFt = panelWidth * PANEL_COUNT;
  const totalHeightFt = height;

  const maxFenceWidth = VB_W - PAD_X * 2;
  const maxFenceHeight = GROUND_Y - 50;
  const pxPerFt = Math.min(maxFenceWidth / totalWidthFt, maxFenceHeight / totalHeightFt);

  const fenceWidthPx = totalWidthFt * pxPerFt;
  const fenceHeightPx = totalHeightFt * pxPerFt;
  const startX = (VB_W - fenceWidthPx) / 2;
  const topY = GROUND_Y - fenceHeightPx;

  const postWidth = Math.max(4, pxPerFt * 0.3);
  const archHeightPx = style === 'arched' ? Math.max(8, panelWidth * pxPerFt * 0.12) : 0;

  // Wood reads as wood regardless of the metal finish — fixed warm tones
  const woodColor = '#B89472';
  const woodGrain = '#8E6F4F';

  const defsParts = [];
  const parts = [];

  // Cross-hatch pattern (used in mesh upper portion of wood-mesh fence)
  // Fixed dark stroke so the mesh stays visible against light finishes (Raw Steel)
  const meshId = 'fence-mesh';
  defsParts.push(
    `<pattern id="${meshId}" x="0" y="0" width="9" height="9" patternUnits="userSpaceOnUse">` +
    `<path d="M0 0 L9 9 M9 0 L0 9" stroke="rgba(10,10,10,0.7)" stroke-width="0.7"/>` +
    `</pattern>`
  );

  // Ground line
  parts.push(`<line x1="0" y1="${GROUND_Y}" x2="${VB_W}" y2="${GROUND_Y}" stroke="rgba(10,10,10,0.2)" stroke-width="1" />`);

  // ---- Panels ----
  for (let p = 0; p < PANEL_COUNT; p++) {
    const panelLeft = startX + p * panelWidth * pxPerFt;
    const panelRight = panelLeft + panelWidth * pxPerFt;
    const innerLeft = panelLeft + postWidth / 2 + 2;
    const innerRight = panelRight - postWidth / 2 - 2;
    const panelTop = topY;
    const panelBottom = GROUND_Y;
    const clipId = `fence-clip-${p}`;

    if (archHeightPx > 0) {
      defsParts.push(
        `<clipPath id="${clipId}"><path d="${archPath(innerLeft, innerRight, panelTop, archHeightPx, panelBottom)}" /></clipPath>`
      );
    }
    const clipAttr = archHeightPx > 0 ? ` clip-path="url(#${clipId})"` : '';

    if (type === 'horizontal-slat') {
      // Real catalog geometry: 3" thick slats, 2.5" pad top/bottom, gap is user-controlled in inches.
      // The slat count is computed in inches (not pixels) so floating-point drift doesn't change it.
      // Reference at 1" spacing: 6 ft → 17 slats, 4 ft → 11 slats.
      const pxPerInch = pxPerFt / 12;
      const slatThickInches = 3;
      const padInches = 2.5;

      const slatHeight = Math.max(2, slatThickInches * pxPerInch);
      const slatGap = Math.max(1.5, slatSpacing * pxPerInch);
      const innerPad = Math.max(2, padInches * pxPerInch);

      const heightInches = height * 12;
      const innerInches = heightInches - 2 * padInches;
      const unitInches = slatThickInches + slatSpacing;
      const slatCount = Math.max(1, Math.floor((innerInches + slatSpacing) / unitInches));
      const unit = slatHeight + slatGap;

      parts.push(`<g${clipAttr}>`);
      for (let i = 0; i < slatCount; i++) {
        const y = panelTop + innerPad + i * unit;
        parts.push(`<rect x="${innerLeft}" y="${y}" width="${innerRight - innerLeft}" height="${slatHeight}" fill="${color}" />`);
      }
      parts.push(`</g>`);

      // Trace the arched top edge so it reads as a clean curve
      if (archHeightPx > 0) {
        parts.push(`<path d="${archStrokePath(innerLeft, innerRight, panelTop, archHeightPx)}" stroke="${color}" stroke-width="2" fill="none" />`);
      }
    } else {
      // Wood + Metal Mesh
      // Frame split-line at the user-chosen mesh ratio (% of total panel height from top)
      const split = Math.round(fenceHeightPx * (meshRatio / 100));
      const midY = panelTop + split;
      const frameThick = Math.max(3, pxPerFt * 0.18);

      // Mesh area (top) — clipped to arched shape if applicable.
      // When arched, the rect extends UP into the arched bump (above topY) so the mesh
      // fills the area between the arch curve and the top frame bar, not just the rectangular slab below.
      const meshRectY = archHeightPx > 0 ? (panelTop - archHeightPx) : (panelTop + frameThick);
      const meshRectH = midY - meshRectY;
      if (meshRectH > 0) {
        parts.push(`<g${clipAttr}>`);
        parts.push(`<rect x="${innerLeft}" y="${meshRectY}" width="${innerRight - innerLeft}" height="${meshRectH}" fill="url(#${meshId})" />`);
        parts.push(`</g>`);
      }

      // Wood area (bottom)
      const woodY = midY + frameThick;
      const woodH = panelBottom - woodY - frameThick;
      if (woodH > 0) {
        parts.push(`<rect x="${innerLeft}" y="${woodY}" width="${innerRight - innerLeft}" height="${woodH}" fill="${woodColor}" />`);
        // Faint horizontal grain lines (darker than wood fill, independent of metal finish)
        for (let gy = woodY + 8; gy < woodY + woodH - 4; gy += 10) {
          parts.push(`<line x1="${innerLeft + 4}" y1="${gy}" x2="${innerRight - 4}" y2="${gy}" stroke="${woodGrain}" stroke-width="0.4" opacity="0.7" />`);
        }
      }

      // Frame: vertical side rails close the box (otherwise the panel reads as horizontal stripes)
      parts.push(`<rect x="${innerLeft}" y="${panelTop}" width="${frameThick}" height="${fenceHeightPx}" fill="${color}" />`);
      parts.push(`<rect x="${innerRight - frameThick}" y="${panelTop}" width="${frameThick}" height="${fenceHeightPx}" fill="${color}" />`);

      // Frame bars: top (arched if applicable), middle (always straight), bottom
      if (archHeightPx > 0) {
        // Top bar follows the arch — the curve peaks ABOVE topY now, so the bar sits naturally as a bump above the side rails
        parts.push(`<path d="${archStrokePath(innerLeft, innerRight, panelTop, archHeightPx)}" stroke="${color}" stroke-width="${frameThick}" fill="none" stroke-linecap="butt" />`);
      } else {
        parts.push(`<rect x="${innerLeft}" y="${panelTop}" width="${innerRight - innerLeft}" height="${frameThick}" fill="${color}" />`);
      }
      // Middle (split) bar
      parts.push(`<rect x="${innerLeft}" y="${midY}" width="${innerRight - innerLeft}" height="${frameThick}" fill="${color}" />`);
      // Bottom bar
      parts.push(`<rect x="${innerLeft}" y="${panelBottom - frameThick}" width="${innerRight - innerLeft}" height="${frameThick}" fill="${color}" />`);
    }
  }

  // ---- Posts ----
  // Posts run from the ground to the panel top. For Wood + Metal Mesh they rise a little
  // above the infill (as in the catalog drawing) so the steel posts read as standing proud.
  const postRise = type === 'wood-mesh' ? Math.max(10, fenceHeightPx * 0.06) : 0;
  for (let i = 0; i <= PANEL_COUNT; i++) {
    const x = startX + i * panelWidth * pxPerFt;
    const postX = x - postWidth / 2;
    const postTopY = topY - postRise;
    parts.push(`<rect x="${postX}" y="${postTopY}" width="${postWidth}" height="${GROUND_Y - postTopY}" fill="${color}" />`);

    if (topEdge === 'capped') {
      // Stepped flat post cap: narrow transition just above the post, then wide flat slab on top.
      // This reads as a real cap with overhang (not a pyramid/finial silhouette).
      const capW1 = postWidth + 2;
      const capH1 = 3;
      parts.push(`<rect x="${x - capW1 / 2}" y="${postTopY - capH1}" width="${capW1}" height="${capH1}" fill="${color}" />`);
      const capW2 = postWidth + 10;
      const capH2 = 4;
      parts.push(`<rect x="${x - capW2 / 2}" y="${postTopY - capH1 - capH2}" width="${capW2}" height="${capH2}" fill="${color}" />`);
    }
  }

  // ---- Dimensions ----
  const dimStroke = 'rgba(10,10,10,0.35)';
  // Width
  const wY = GROUND_Y + 12;
  parts.push(`<line x1="${startX}" y1="${wY}" x2="${startX + fenceWidthPx}" y2="${wY}" stroke="${dimStroke}" stroke-width="0.5" />`);
  parts.push(`<line x1="${startX}" y1="${wY - 3}" x2="${startX}" y2="${wY + 3}" stroke="${dimStroke}" stroke-width="0.5" />`);
  parts.push(`<line x1="${startX + fenceWidthPx}" y1="${wY - 3}" x2="${startX + fenceWidthPx}" y2="${wY + 3}" stroke="${dimStroke}" stroke-width="0.5" />`);
  parts.push(`<text x="${startX + fenceWidthPx / 2}" y="${wY + 12}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.5)">${totalWidthFt} FT</text>`);
  // Height — measured to the top of the posts (for Wood + Metal Mesh the posts rise above
  // the panel, so postRise > 0 and the dimension reaches the post top; it's 0 otherwise).
  const hX = startX - 22;
  const hTopY = topY - postRise;
  const hMidY = (hTopY + GROUND_Y) / 2;
  parts.push(`<line x1="${hX}" y1="${hTopY}" x2="${hX}" y2="${GROUND_Y}" stroke="${dimStroke}" stroke-width="0.5" />`);
  parts.push(`<line x1="${hX - 3}" y1="${hTopY}" x2="${hX + 3}" y2="${hTopY}" stroke="${dimStroke}" stroke-width="0.5" />`);
  parts.push(`<line x1="${hX - 3}" y1="${GROUND_Y}" x2="${hX + 3}" y2="${GROUND_Y}" stroke="${dimStroke}" stroke-width="0.5" />`);
  parts.push(`<text x="${hX - 6}" y="${hMidY}" text-anchor="middle" font-family="Inter, sans-serif" font-size="9" letter-spacing="2" fill="rgba(10,10,10,0.5)" transform="rotate(-90 ${hX - 6} ${hMidY})">${totalHeightFt} FT</text>`);

  return '<defs>' + defsParts.join('') + '</defs>' + parts.join('');
}
