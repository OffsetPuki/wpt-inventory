// HTML runs in an opaque-origin sandbox; never grant allow-same-origin.
export function isolatedPreviewHtml(html){
 const policy="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
 return '<meta http-equiv="Content-Security-Policy" content="'+policy+'"><meta name="referrer" content="no-referrer">'+html;
}
