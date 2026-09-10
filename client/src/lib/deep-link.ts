import { useEffect, useState } from "react";

export function useDeepLink(name: string) {
  const read = () =>
    new URLSearchParams(window.location.hash.split("?")[1] ?? "").get(name);
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, [name]);
  return value;
}
