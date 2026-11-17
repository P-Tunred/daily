import type { ReactNode } from "react";

type Size = "small" | "medium" | "large";

// Aurora-aligned padding — base is 32px (--space-xl)
const SIZE_PAD: Record<Size, string> = {
  small:  "p-5",
  medium: "p-8",
  large:  "p-8",
};

type Props = {
  title?: string;
  icon?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  size?: Size;
  className?: string;
  /** When true, render with no inner padding (for bare widgets). */
  bare?: boolean;
  /** When true, use a very dark opaque surface (e.g. WeatherCard). */
  dark?: boolean;
  /** Makes the card's title a button — used where the heading opens a fuller
   *  view of what the card summarises (e.g. Posteingang → manage all mails). */
  onTitleClick?: () => void;
};

// Note: `icon` is still accepted in Props for call-site compatibility, but no
// longer rendered — Aurora card heads are plain mono labels without glyphs.
export function Card({
  title,
  meta,
  action,
  children,
  size = "medium",
  className = "",
  bare = false,
  dark = false,
  onTitleClick,
}: Props) {
  return (
    <section
      className={
        (dark ? "glass-dark" : "glass") +
        " rounded-card overflow-hidden " +
        (bare ? "" : SIZE_PAD[size]) + " " +
        className
      }
    >
      {(title || meta || action) && (
        <header className="card-kopf flex items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-2.5 min-w-0">
            {title && (
              <span
                className={"card-title truncate" + (onTitleClick ? " card-title-btn" : "")}
                {...(onTitleClick
                  ? {
                      role: "button" as const,
                      tabIndex: 0,
                      title: "Alle öffnen und verwalten",
                      onClick: onTitleClick,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onTitleClick();
                        }
                      },
                    }
                  : {})}
              >
                {title}
                {onTitleClick && <span aria-hidden="true" style={{ marginLeft: 5, opacity: 0.6 }}>›</span>}
              </span>
            )}
          </div>
          {meta && <span className="card-meta">{meta}</span>}
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
