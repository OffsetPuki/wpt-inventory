# Film table field-workspace audit

Audit date: 2026-09-28. Model revision: **6a5dd71282**.

## Delivered

The Business Suite now has an assembly player, an interactive part inspector, and a searchable custom cut list. Selecting a physical piece isolates it and opens its drawing. Purchased wheels, clevis/cotter/lynch pins, the turnbuckle, existing angles, and custom pieces remain selectable. Individual pieces can be hidden and restored. Fullscreen includes the controls.

Each drawing includes overall dimensions and the captured manufacturing features: bore diameters and coordinates, circular relief centers and radii, rectangular cutouts, straight profile segments, and outline points. Display units are nearest 1/16 inch, decimal inches, or millimeters. Exact model values remain available. The datum and revision appear on the drawings.

The custom cut list contains **111 drawing types / 407 modeled pieces**. The full model has **403 drawing types / 1,867 physical pieces**. Quantity is the count in the model, not an additional purchasing quantity. Variants keep different hole layouts separate. The field book is one approximately **2.1 MB HTML file** containing all part records and drawing code, with no external scripts, fonts, stylesheets, or API dependencies. Printing includes all feature pages and dimension tables. The website supplies the animated 3D assembly; the downloaded book supplies offline fabrication reference.

## Findings corrected

1. Circular relief centers outside the stock envelope had been clamped to the edge. The exporter now clips only the drilling direction. Pipe-clamp centers retain the required modeled 0.3 mm offset beyond their respective stock edges.
2. Zero-scale hidden animation nodes loaded with invalid rotations. Their original translation, rotation, and scale now restore explicitly after loading.
3. Closing profile curves sometimes produced zero-length edges. These are removed from the dimension list.
4. Very small nonzero spacers rounded to 0 inches. They now display “<1/16 inch,” with exact dimensions available.
5. Stale geometry, part details, or offline books could be confused across exports. Cache keys, part requests, and field-book downloads now validate the model revision.
6. Large collections of hole/curve callouts crowded the drawing. Detail drawings are paged, with explicit centers, axis offsets, and radius leaders. Only the selected page is mounted during normal viewing; print includes all pages.
7. Fabrication metadata was too sparse. Stock descriptions, separately recorded cut lengths, construction notes, straight-edge coordinates, profile-plane angles, and per-part fit checks are now exposed. Missing values are not inferred from a rotated bounding box.

## Verification

- Checked all 403 part records for finite positive dimensions, valid bore/edge data, arc geometry, and nonzero straight segments.
- Matched every isolated part envelope to its catalog dimensions within 0.015 mm; verified all 1,867 instance counts.
- Rendered all 403 overview drawings and **295 hole/curve detail pages** to SVG, checking for invalid numerical output.
- Checked **170 animation poses** for finite scene matrices, including the nodes that begin hidden.
- Verified ray selection, a small candidate shortlist, instance hiding, restoration, and the purchased hardware counts.
- Verified authentication, invalid IDs, stale-revision rejection, matching offline metadata, and no change to customer preview counts.
- Decoded the standalone book's embedded compressed data and checked all 403 records and the revision. Browser export reported a successful download. Direct local-file browser testing was unavailable in the browser automation environment; a separate field-device offline-open test remains necessary.
- Browser checked play/pause and timeline progression, speed and step selection, cut-list filtering, selection/isolation, dimension units, hole details, hide/restore, and fullscreen. The available browser did not honor a requested 390 px viewport, so actual phone-device verification remains outstanding.
- Type checking and the production build passed. The browser regression specification was updated; the browser workflows above were exercised through the in-app browser, not a separate Playwright CLI run.

The shared compressed 3D download is **19,772,243 bytes**, down from the earlier 37.36 MB parts payload (about 47%). Drawing detail is loaded on demand, geometry is shared between modes, selection narrows candidates before ray tests, paused viewers render on demand, hidden pages pause playback, and closed viewers dispose their GPU resources. The field book avoids the large 3D asset entirely.

## Fabrication information still requiring real-world confirmation

This audit establishes consistency between the software and modeled geometry. It is not a structural calculation or a release of toleranced shop drawings. The website marks these limitations at the affected parts and in Before cutting:

- Material grades, the replacement pipe material, and machining/assembly tolerances have not all been supplied.
- Some modeled components have no separately specified stock blank or cut allowance. Their finished envelope and captured profile are available, but the software does not invent stock allowances, kerf, bend deductions, or saw settings.
- Purchased wheel crown/groove geometry, actual mating track, turnbuckle eye dimensions and adjustment range, and pin/retainer hole fits need measurements of the supplied hardware. Product labels alone do not specify all these fits.
- Multi-piece assemblies, modeled threads, noncircular profiles without machining definitions, and connection details may need additional shop definitions beyond their visible envelope.
- The six-meter frame, long members, pipe supports, fasteners, and connections require sizing/fit verification for actual film tension and loads. No load-test or engineering capacity claim is made.

The field book should be carried as the current model reference. Complete the marked fit/material/blank decisions before treating a part as ready for manufacture.
