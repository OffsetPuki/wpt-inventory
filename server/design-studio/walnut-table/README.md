# Walnut table parts workspace

This private model snapshot is available to owners/managers in Customer previews and CJM Design Studio. Open either route with `?workspace=walnut` to expand it.

`model.json` preserves the actual triangles, normals and edges from the verified local `Open-3D-Table.html`. No customer preview record or published option is edited by this workspace. Both top thicknesses share stable part IDs. Chairs are illustrative and excluded; the 53 selectable components comprise 52 frame pieces and one top. Integrated caps and sole closures are counted separately as included details.

To refresh after an approved geometry change:

```sh
python scripts/import-walnut-parts.py /path/to/verified/Open-3D-Table.html
node --import tsx scripts/check-walnut-studio.mjs
```

The exporter records the source SHA-256 and model revision. Review the named measurements and compare both variants against the source geometry after refreshing. The exporter explicitly describes this table configuration; a different design requires updating the dimensional metadata too.

Units in the export are inches. Model rendering coordinates are `[X - 66, Z, -Y]`; assembly coordinates use X from one short tabletop end, Y across width from center, and Z above floor. Outside envelopes are derived from the geometry. Centerline and axial envelopes for angled pieces are not released saw-cut lengths. Nominal sharp-corner tube sections exclude supplier radii, welds and fabrication allowances; this is a design inspection schedule, not a load certification or released cutting drawing.

The API uses existing elevated authorization and private/no-store caching. Model assets are outside the public directory.
