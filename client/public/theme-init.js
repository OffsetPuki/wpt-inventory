// Apply the saved theme before first paint so dark-mode users don't get a
// white flash. Lives in an external file, not inline in index.html, because
// the production CSP is script-src 'self' — an inline block gets blocked and
// the flash comes back with a console error nobody reads.
(function () {
  try {
    var m = document.cookie.match(/(?:^|;\s*)wpt-theme=(dark|light)/);
    if (m && m[1] === "dark") document.documentElement.classList.add("dark");
  } catch (e) {
    /* stay light */
  }
})();
