# Walnut table parts workspace

This private model snapshot is available to owners/managers in CJM Design Studio. `/design-studio` keeps the project picker for Dallas table and Film stretching table; only the selected model is mounted. Dallas opens at `/design-studio/dallas-table`. The Projects link returns to the picker. Legacy `?workspace=walnut` links redirect to Dallas. Customer previews remains a separate customer-sharing area.

One model stays beside one cutting checklist. Pick a model piece or illustrated row to isolate it and see projected dimensions. Confirm the shop cut size and end cuts, then mark individual pieces cut or undo counts. Full frame restores the assembly. Options contains the two top variants, measurement groups, display units, tabletop visibility and CSV export. Detailed drawings and assembly notes are collapsed. Print produces the cutting checklist.

The checklist groups 57 steel pieces: 39 independent modeled metal components plus 14 integrated end caps and 4 sole closures. The 13 bearing strips and walnut top are excluded from metal cutting. Straight tube model lengths prefill an unconfirmed suggestion; angled members, plates and closures require entered shop details. Outside envelopes and centerlines are references, not released saw lengths. No item can be marked cut without a confirmed size and end-cut description. Editing a size requires first undoing that item's cut counts. Print and CSV distinguish user-confirmed sizes from unresolved details.

Cutting entries are saved in browser localStorage, partitioned by account, model revision and top thickness. This is device-only storage, not server synchronization or an engineering approval. The last top choice is remembered by account. Storage failures are visible and retryable. Refreshing the model revision starts a separate checklist. Customer preview data and model geometry are unchanged by checklist actions.

`model.json` preserves the actual triangles, normals and edges from the verified local `Open-3D-Table.html`. No customer preview record or published option is edited by this workspace. Both top thicknesses share stable part IDs. Chairs are illustrative and excluded; the 53 selectable components comprise 52 frame pieces and one top. Integrated caps and sole closures are counted separately as included details.

To refresh after an approved geometry change:

```sh
python scripts/import-walnut-parts.py /path/to/verified/Open-3D-Table.html
node --import tsx scripts/check-walnut-studio.mjs
```

The exporter records the source SHA-256 and model revision. Review the named measurements and compare both variants against the source geometry after refreshing. The exporter explicitly describes this table configuration; a different design requires updating the dimensional metadata too.

Units in the export are inches. Model rendering coordinates are `[X - 66, Z, -Y]`; assembly coordinates use X from one short tabletop end, Y across width from center, and Z above floor. Outside envelopes are derived from the geometry. Centerline and axial envelopes for angled pieces are not released saw-cut lengths. Nominal sharp-corner tube sections exclude supplier radii, welds and fabrication allowances; this is a design inspection schedule, not a load certification or released cutting drawing.

The API uses existing elevated authorization and private/no-store caching. Model assets are outside the public directory.
