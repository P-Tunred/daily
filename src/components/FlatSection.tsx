import type { ReactNode } from "react";

// Editorial section for the Lernzeit "Strom": content sits flat on the page
// background, separated by a hairline and a mono kicker instead of a glass
// tile. Prop names mirror Card so call sites can swap wrappers 1:1 — `icon`
// and `size` are accepted for compatibility but intentionally not rendered.
type Props = {
  title?: string;
  icon?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  size?: "small" | "medium" | "large";
  className?: string;
};

export function FlatSection({ title, meta, action, children, className = "" }: Props) {
  return (
    <section className={"flat-section " + className}>
      {(title || meta || action) && (
        <header className="flex items-center justify-between gap-4 mb-5">
          <span className="flat-kicker">{title}</span>
          <span className="flex items-center gap-3">
            {meta && <span className="flat-meta">{meta}</span>}
            {action}
          </span>
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
