function abbrev(name: string): string {
  const clean = name.replace(/[^A-Za-zÀ-ÿ0-9]/g, "");
  return clean.slice(0, 2).toUpperCase() || "??";
}

type MarkProps = {
  name: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const SIZE: Record<NonNullable<MarkProps["size"]>, string> = {
  sm: "w-5 h-5 text-[9px]",
  md: "w-7 h-7 text-[11px]",
  lg: "w-10 h-10 text-sm",
};

/** SubjectMark — color-tinted rounded glyph with mono initials.
 *  Uses color-mix() rather than hex-alpha string suffixes (`${color}33`) so it
 *  works whether `color` is a literal hex or a var(--subject-N) reference —
 *  see tracker/colors.ts. */
export function SubjectMark({
  name,
  color = "var(--subject-1)",
  size = "md",
  className = "",
}: MarkProps) {
  return (
    <span
      aria-label={`Fach ${name}`}
      className={
        "inline-flex items-center justify-center rounded-full font-mono font-semibold tracking-tight text-white shrink-0 " +
        SIZE[size] +
        " " +
        className
      }
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
        color,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 33%, transparent)`,
      }}
    >
      {abbrev(name)}
    </span>
  );
}

/** Smaller pure-color dot, for legends / inline lists. */
export function SubjectDot({
  color,
  size = 10,
}: {
  color: string;
  size?: number;
}) {
  return (
    <span
      aria-hidden
      className="inline-block rounded-full shrink-0"
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        boxShadow: `0 0 8px color-mix(in srgb, ${color} 50%, transparent)`,
      }}
    />
  );
}

export const subjectAbbrev = abbrev;
