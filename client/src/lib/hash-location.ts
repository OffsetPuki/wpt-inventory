import { useHashLocation } from "wouter/use-hash-location";

// Keep record parameters inside the hash, and match routes against the path only.
// Wouter's default hash navigator moves the search outside the hash instead.
function navigate(
  to: string,
  {
    replace = false,
    state = null,
  }: { replace?: boolean; state?: unknown } = {},
) {
  const oldURL = window.location.href;
  const url = new URL(oldURL);
  url.hash = "/" + to.replace(/^#?\/?/, "");
  window.history[replace ? "replaceState" : "pushState"](state, "", url);
  window.dispatchEvent(
    new HashChangeEvent("hashchange", { oldURL, newURL: url.href }),
  );
}

export function useAppLocation(): [string, typeof navigate] {
  const [location] = useHashLocation();
  return [location.split("?")[0], navigate];
}

useAppLocation.hrefs = (href: string) => "#" + href;
