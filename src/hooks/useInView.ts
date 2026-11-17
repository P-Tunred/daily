import { useEffect, useRef, useState } from "react";

// Fires once when the element scrolls into view (default 10% visible). Used to
// trigger entrance animations on a scroll page. Falls back to "in view"
// immediately where IntersectionObserver is unavailable.
export function useInView<T extends HTMLElement = HTMLDivElement>(threshold = 0) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    // Fire as soon as the section enters the viewport (by ~10% of viewport
    // height). Threshold-of-element-area is unreliable for very tall panels.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          // Reveal when in view OR already scrolled past the top — a fast jump
          // (End key, trackpad fling) must never leave a section stuck hidden,
          // since IntersectionObserver doesn't replay skipped intermediate states.
          if (e.isIntersecting || e.boundingClientRect.top < 0) {
            setInView(true);
            io.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);

  return { ref, inView };
}
