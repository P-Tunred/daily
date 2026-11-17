import type { CSSProperties, ReactNode } from "react";
import { useInView } from "../hooks/useInView";

// Blur-slide-up entrance on scroll-into-view. `index` staggers grouped siblings
// (each adds 0.09s). Pure CSS — the animation lives in the .reveal rules in
// index.css and auto-respects prefers-reduced-motion.
export function Reveal({
  children,
  index = 0,
  className,
}: {
  children: ReactNode;
  index?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={"reveal" + (inView ? " in" : "") + (className ? " " + className : "")}
      style={{ "--reveal-i": index } as CSSProperties}
    >
      {children}
    </div>
  );
}
