import { useEffect, useState } from "react";
import { useAuth } from "./auth";
export function useFormDraft<T>(name: string, initial: T) {
  const { user } = useAuth();
  const key = `suite-form:${user?.id}:${name}`;
  const [value, setValue] = useState<T>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || "null") || initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);
  return [
    value,
    setValue,
    () => {
      sessionStorage.removeItem(key);
    },
  ] as const;
}
