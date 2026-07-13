// pdfmake ships without bundled types for its browser build entrypoints.
// We import it dynamically (contracts PDF) and drive it as `any` — the doc
// definition is validated at runtime by pdfmake itself.
declare module "pdfmake/build/pdfmake";
declare module "pdfmake/build/vfs_fonts";
