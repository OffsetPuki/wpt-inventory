import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./auth";
export function useRouteScroll() {
  const [location] = useLocation();
  const { user } = useAuth();
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const key = `suite-scroll:${user?.id}:${location}`;
    let desired = 0;
    try {
      desired = Number(sessionStorage.getItem(key)) || 0;
    } catch {}
    let restoring = true;
    const restore = () => {
      if (!restoring) return;
      el.scrollTop = desired;
      if (el.scrollHeight - el.clientHeight >= desired) restoring = false;
    };
    const observer = new ResizeObserver(restore);
    for (const child of Array.from(el.children)) observer.observe(child);
    restore();
    const stop = () => {
      restoring = false;
    };
    const save = () => {
      if (!restoring)
        try {
          sessionStorage.setItem(key, String(el.scrollTop));
        } catch {}
    };
    el.addEventListener("wheel", stop, { passive: true });
    el.addEventListener("touchstart", stop, { passive: true });
    el.addEventListener("scroll", save, { passive: true });
    const timer = setTimeout(() => {
      restore();
      restoring = false;
      observer.disconnect();
    }, 1500);
    return () => {
      save();
      clearTimeout(timer);
      observer.disconnect();
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchstart", stop);
      el.removeEventListener("scroll", save);
    };
  }, [location, user?.id]);
  return ref;
}
