type Props = {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
};

export function ProgressRing({
  progress,
  size = 240,
  strokeWidth = 14,
  color = "var(--accent)",
  trackColor = "rgba(255,255,255,0.08)",
  children,
}: Props) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  const dash = c * clamped;

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        // color-mix, not a hex-alpha suffix (`${color}40`) — `color` may be a
        // var(--subject-N) / var(--lz-accent, ...) reference, not literal hex.
        filter: `drop-shadow(0 0 24px color-mix(in srgb, ${color} 25%, transparent))`,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 200ms ease-out" }}
        />
      </svg>
      <div className="relative flex flex-col items-center justify-center text-center px-4">
        {children}
      </div>
    </div>
  );
}
