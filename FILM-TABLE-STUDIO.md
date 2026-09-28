# Film table workspace

Design Studio includes View model, View parts, and Cut list. All are authenticated and independent of public customer previews. Custom pieces, existing brackets, purchased wheels, pins, and the complete turnbuckle can be selected. Search and source/category filters distinguish them. No purchasing option is published.

The model has play/pause, restart, previous/next step, playback speed, a timeline, and a step selector above the viewer. Playback is capped at 30 frames per second and pauses in hidden tabs. Fullscreen retains all controls.

The cut list defaults to custom fabrication parts, with quantities, source stock, finished dimensions, explicitly recorded stock cut lengths, and fit notes. A row opens the isolated part. Drawings offer front/top/side views, individually dimensioned hole centers and curves, straight profile lengths and angles, cutouts, and outline coordinates. Angles are measured in the drawing plane, not machine saw settings. Inch fractions, decimal inches, and millimeters can be selected. Small nonzero dimensions never display as zero. Print part / save PDF includes all feature pages and dimension tables; SVG overview exports only the three-view overview. CSV exports the custom cut list.

Save offline field book downloads one self-contained HTML file with all 403 part records, searchable cut list, drawings, units, dimensions, and print controls. It needs no server, sign-in, or external resources after download; open it in a modern browser supporting DecompressionStream. The live 3D assembly and animation remain in the website. Keep the current revision on the field device. The metadata and API reject stale revision downloads.

View parts highlights individual pieces on hover and pauses picking while rotating. A click isolates the selected physical instance. Dimension cards sit outside the canvas. Desktop shows the isolated piece and drawing together; smaller screens offer 3D/Drawing tabs. Hole-center offsets and radius leaders appear in individual drawing detail views to avoid crowded labels. Back to all parts restores the camera and assembly. Hide this piece hides only that instance, across both modes, until Show all or closing the page. Fullscreen includes all workspace controls; Escape exits it.

Both modes share one authenticated, revision-keyed download of `studio-model.bin.gz` (19.77 MB versus the previous 37.36 MB parts load). Offline export tags and deduplicates geometry, preserving animation references. Selection first checks bounding boxes and then nearby surfaces. Isolation clones only one physical piece. Rendering happens on demand; hidden tabs pause rendering and closed viewers dispose GPU resources. The catalog stores model dimensions in millimeters; nearest-1/16-inch display rounding never changes geometry. Exact values remain visible for fits. These are model drawings, not released toleranced fabrication drawings.

To refresh after editing the model, run from the sibling CJM project:

```sh
node scripts/build-film-table-preview.mjs
node scripts/check-film-table-preview.mjs
node scripts/export-film-table-suite.mjs
```

The exporter verifies source hashes and generates `server/design-studio/current` assets plus the small viewer runtime. Keep the entire current folder with the Suite deployment. Drawing IDs identify the current export and may change after geometry changes. The revision includes model, capture, exporter, asset builder, and decoder hashes.

Then from Inventory:

```sh
npm run check
npm run build
node --import tsx scripts/check-film-shop.mjs
```

Build also generates the offline HTML and its matching revision metadata. The audit checks every part and feature page, 170 animation poses, picking, dimensions, offline data, and authenticated API behavior. Results are written to the sibling `output/film-table-bolted/field-audit.json`. See FILM-TABLE-FIELD-AUDIT.md for findings and fabrication limits.

`scripts/preview-film-shop.mjs` serves the built UI with an isolated temporary database for local review. It does not alter the live Suite.
