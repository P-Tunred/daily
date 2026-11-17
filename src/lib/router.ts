import { useEffect, useState } from "react";

export function useHashRoute(): string {
  const get = () =>
    typeof window !== "undefined" ? window.location.hash || "#/" : "#/";
  const [hash, setHash] = useState<string>(get);

  useEffect(() => {
    const handler = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return hash;
}

export function navigate(hash: string) {
  if (typeof window === "undefined") return;
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}
