import { useCallback, useEffect, useMemo, useState } from "react";
import { HOLDINGS } from "../data/holdings";
import { fetchQuotes, clearQuoteCache } from "../lib/yahoo";
import type { Quote } from "../types";
import { Card } from "./Card";
import { formatCurrency, formatStamp } from "../lib/formatters";

type Row = {
  ticker: string;
  quote?: Quote;
  error?: string;
};

function formatPct(pct: number): string {
  const abs = Math.abs(pct).toFixed(2);
  return `${pct >= 0 ? "+" : "−"}${abs}%`;
}

// ── Portfolio history (daily snapshots) ────────────────────────────────────────

const HISTORY_KEY = "morning.portfolio.history";
const MAX_HISTORY_DAYS = 30;

type PortfolioSnapshot = { date: string; value: number };

function loadHistory(): PortfolioSnapshot[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as PortfolioSnapshot[]; }
  catch { return []; }
}

function saveSnapshot(value: number) {
  if (value <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const history = loadHistory().filter(h => h.date !== today);
  history.push({ date: today, value });
  // Keep last N days, sorted by date
  history.sort((a, b) => a.date.localeCompare(b.date));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY_DAYS)));
}

// ── Portfolio History Chart ────────────────────────────────────────────────────

function PortfolioChart({ history, current }: { history: PortfolioSnapshot[]; current: number }) {
  const { points, color, periodChange, periodChangePct, oldest, days } = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const all = [...history.filter(h => h.date !== today), { date: today, value: current }];
    if (all.length < 2) return { points: null, color: "var(--color-positive)", periodChange: 0, periodChangePct: 0, oldest: null, days: 0 };

    const values = all.map(h => h.value);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;
    // Add padding so line doesn't touch edges
    const padded = range * 0.1;
    const W = 300; const H = 60; const n = all.length;

    const pts = all.map((h, i) => ({
      x: (i / (n - 1)) * W,
      y: H - ((h.value - (minV - padded)) / (range + padded * 2)) * H,
    }));

    const trend = all[all.length - 1].value >= all[0].value;
    const col = trend ? "var(--color-positive)" : "var(--color-red)";
    const change = all[all.length - 1].value - all[0].value;
    const pct = all[0].value > 0 ? (change / all[0].value) * 100 : 0;

    return {
      points: pts,
      color: col,
      periodChange: change,
      periodChangePct: pct,
      oldest: all[0].date,
      days: n,
    };
  }, [history, current]);

  if (!points || points.length < 2) {
    return (
      <div className="mt-3 pt-3 border-t border-white/[0.05]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-1">Verlauf</p>
        <p className="text-[11px] text-fg-tertiary">Wird nach dem ersten Tag aufgebaut.</p>
      </div>
    );
  }

  const W = 300; const H = 60;
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const fillD = `${pathD} L ${W} ${H} L 0 ${H} Z`;
  const sign = periodChange >= 0 ? "+" : "";
  const fmtDate = (iso: string) => new Date(iso + "T12:00:00").toLocaleDateString("de-DE", { day: "2-digit", month: "short" });

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.05]">
      <div className="flex items-center justify-between mb-2.5">
        <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
          Verlauf · {days}T
          {oldest && <span className="text-fg-tertiary"> (ab {fmtDate(oldest)})</span>}
        </p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold tabular-nums"
            style={{ color }}>
            {sign}{periodChange.toFixed(0)} €
          </span>
          <span className="font-mono text-[10px] tabular-nums px-1.5 py-0.5 rounded-full"
            style={{ color, backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)` }}>
            {sign}{periodChangePct.toFixed(2)}%
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 70, display: "block" }}>
        <defs>
          <linearGradient id="port-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#port-fill)" />
        <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* First point */}
        <circle cx={points[0].x} cy={points[0].y} r="2.5" fill={color} opacity="0.5" />
        {/* Last point — bright dot */}
        <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3.5" fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
        {/* Min/max labels */}
        {(() => {
          const maxPt = points.reduce((a, b) => a.y < b.y ? a : b);
          const minPt = points.reduce((a, b) => a.y > b.y ? a : b);
          const allVals = history.map(h => h.value).concat(current);
          const maxV = Math.max(...allVals);
          const minV = Math.min(...allVals);
          return (
            <>
              <text x={maxPt.x} y={Math.max(4, maxPt.y - 4)} textAnchor="middle" fontSize="7"
                fill="rgba(235,235,245,0.4)">{maxV.toFixed(0)}€</text>
              <text x={minPt.x} y={Math.min(H - 2, minPt.y + 8)} textAnchor="middle" fontSize="7"
                fill="rgba(235,235,245,0.3)">{minV.toFixed(0)}€</text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

export function StockCard() {
  const [rows, setRows] = useState<Row[]>(
    HOLDINGS.map((h) => ({ ticker: h.ticker })),
  );
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [history, setHistory] = useState<PortfolioSnapshot[]>(() => loadHistory());

  const refresh = useCallback(async (bustCache = false) => {
    if (bustCache) clearQuoteCache();
    setLoading(true);
    setProgress(0);
    const tickers = HOLDINGS.map((h) => h.ticker);
    const result = await fetchQuotes(tickers, (done) => setProgress(done));
    setRows(result);
    setLoading(false);
  }, []);

  // Initial load
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-refresh every 5 minutes (respects the 15-min in-memory cache;
  // only fetches live data if the cache has expired)
  useEffect(() => {
    const id = setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const total = useMemo(() => {
    let sum = 0;
    HOLDINGS.forEach((h) => {
      const r = rows.find((x) => x.ticker === h.ticker);
      const pct = r?.quote?.changePct ?? 0;
      sum += h.invested * (1 + pct / 100);
    });
    return sum;
  }, [rows]);

  const totalInvested = HOLDINGS.reduce((a, h) => a + h.invested, 0);
  const totalDelta = total - totalInvested;
  const totalPct = totalInvested > 0 ? (totalDelta / totalInvested) * 100 : 0;

  // Persist daily snapshot whenever quotes are loaded
  useEffect(() => {
    if (total > 0 && rows.some(r => r.quote)) {
      saveSnapshot(total);
      setHistory(loadHistory());
    }
  }, [total, rows]);

  return (
    <Card
      title="Portfolio"
      icon="📈"
      meta={`${HOLDINGS.length} Pos.`}
      action={
        <div className="flex items-center gap-2">
          {loading && progress > 0 && (
            <span className="font-mono text-[10px] text-fg-tertiary tabular-nums">
              {progress}/{HOLDINGS.length}
            </span>
          )}
          <button
            onClick={() => void refresh(true)}
            disabled={loading}
            aria-label="Aktualisieren"
            className="
              w-8 h-8 rounded-full bg-white/8 hover:bg-white/15
              text-fg-secondary hover:text-fg
              transition-colors duration-150
              disabled:opacity-40 disabled:cursor-not-allowed
              inline-flex items-center justify-center
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg
            "
          >
            <span aria-hidden className={loading ? "animate-spin" : ""}>
              ↻
            </span>
          </button>
        </div>
      }
    >
      <div className="rounded-card-sm bg-white/[0.04] p-5 mb-4 flex items-end justify-between gap-4">
        <div>
          <span className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary">
            Gesamtwert
          </span>
          <div className="metric text-3xl text-fg tabular-nums mt-1">
            {formatCurrency(total)}
          </div>
        </div>
        <div className="text-right">
          <div
            className={
              "font-display font-semibold text-base tabular-nums " +
              (totalPct >= 0
                ? "text-[var(--color-positive)]"
                : "text-[var(--color-negative)]")
            }
          >
            {totalPct >= 0 ? "▲" : "▼"} {formatPct(totalPct)}
          </div>
          <div className="text-[11px] text-fg-tertiary tabular-nums">
            {formatCurrency(totalDelta)}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-fg-tertiary">
              <th className="font-mono text-[10px] uppercase tracking-widest text-left pb-2 pr-3 font-medium">
                Position
              </th>
              <th className="font-mono text-[10px] uppercase tracking-widest text-right pb-2 px-3 font-medium">
                Kurs
              </th>
              <th className="font-mono text-[10px] uppercase tracking-widest text-right pb-2 px-3 font-medium">
                Heute
              </th>
              <th className="font-mono text-[10px] uppercase tracking-widest text-right pb-2 px-3 font-medium">
                Wert
              </th>
            </tr>
          </thead>
          <tbody>
            {HOLDINGS.map((h) => {
              const row = rows.find((x) => x.ticker === h.ticker);
              const q = row?.quote;
              const pct = q?.changePct ?? 0;
              const positive = pct >= 0;
              const estimated = h.invested * (1 + pct / 100);
              return (
                <tr
                  key={h.ticker}
                  className="border-t border-[var(--color-hairline)]"
                >
                  <td className="py-3 pr-3">
                    <div className="font-display font-semibold text-[13px] text-fg">
                      {h.name}
                    </div>
                    <div className="font-mono text-[10px] text-fg-tertiary uppercase tracking-wider">
                      {h.ticker}
                    </div>
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-mono text-[12px]">
                    {q ? (
                      <>
                        <span className="text-fg">
                          {q.price.toFixed(2)}
                        </span>{" "}
                        <span className="text-fg-tertiary text-[10px]">
                          {q.currency}
                        </span>
                      </>
                    ) : row?.error ? (
                      <span
                        className="text-fg-tertiary italic"
                        title={row.error}
                      >
                        n/v
                      </span>
                    ) : (
                      <span className="text-fg-tertiary">…</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-mono text-[12px]">
                    {q ? (
                      <span
                        className={
                          positive
                            ? "text-[var(--color-positive)]"
                            : "text-[var(--color-negative)]"
                        }
                      >
                        {positive ? "▲" : "▼"} {formatPct(pct)}
                      </span>
                    ) : (
                      <span className="text-fg-tertiary">—</span>
                    )}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums font-display font-semibold text-[13px] text-fg">
                    {q ? formatCurrency(estimated) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <PortfolioChart history={history} current={total} />

      <p className="text-[11px] text-fg-tertiary mt-4 pt-3 border-t border-[var(--color-hairline)]">
        +70 €/Monat Sparplan in AI &amp; Big Data ETF (XAIX.DE) ·{" "}
        {(() => {
          const firstQuote = rows.find((r) => r.quote);
          if (!firstQuote?.quote) return "—";
          const isStale = rows.filter((r) => r.quote).every((r) => r.quote?.stale);
          return (
            <>
              {isStale && (
                <span className="text-[var(--color-negative)] mr-1" title="Live-Daten nicht verfügbar — letzte bekannte Kurse">
                  ⚠ veraltet ·
                </span>
              )}
              {formatStamp(firstQuote.quote.fetchedAt)}
            </>
          );
        })()}
      </p>
    </Card>
  );
}
