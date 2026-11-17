// UsageCard.tsx — Shows API token usage per model, per day.
// Fetches from /api/token-usage (server.cjs tracks every Anthropic call);
// /api/usage serves the weekly Claude/GLM quota for the edge bars instead.
import { useEffect, useState } from "react";

type DayEntry = Record<string, { input: number; output: number; calls: number }>;
type UsageData = { days: Record<string, DayEntry> };

const fmtK = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k`
    : String(n);

export function UsageCard() {
  const [data, setData] = useState<UsageData | null>(null);

  useEffect(() => {
    fetch("/api/token-usage?t=" + Date.now())
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || !data.days || Object.keys(data.days).length === 0) {
    return (
      <div className="card span-6">
        <div className="card-head">
          <span className="ttl">API Usage</span>
        </div>
        <div className="empty-row">Noch nichts gezählt — sobald ich für dich arbeite, steht es hier.</div>
      </div>
    );
  }

  // Aggregate totals across all days, per model
  const totals: Record<string, { input: number; output: number; calls: number }> = {};
  for (const [, dayModels] of Object.entries(data.days)) {
    for (const [model, stats] of Object.entries(dayModels)) {
      if (!totals[model]) totals[model] = { input: 0, output: 0, calls: 0 };
      totals[model].input += stats.input;
      totals[model].output += stats.output;
      totals[model].calls += stats.calls;
    }
  }

  const models = Object.entries(totals).sort((a, b) => b[1].calls - a[1].calls);
  const grandTotal = models.reduce(
    (acc, [, s]) => ({ input: acc.input + s.input, output: acc.output + s.output, calls: acc.calls + s.calls }),
    { input: 0, output: 0, calls: 0 },
  );
  const days = Object.keys(data.days).sort().reverse();
  const today = days[0];

  return (
    <div className="card span-6">
      <div className="card-head">
        <span className="ttl">API Usage</span>
        <span className="right">
          {grandTotal.calls} Calls · {fmtK(grandTotal.input + grandTotal.output)} Tokens
        </span>
      </div>

      {/* Today's breakdown */}
      {today && data.days[today] && (
        <div className="usage-section">
          <div className="usage-label">Heute</div>
          <div className="usage-rows">
            {Object.entries(data.days[today])
              .sort((a, b) => b[1].calls - a[1].calls)
              .map(([model, s]) => (
                <div key={model} className="usage-row">
                  <span className="usage-model">{model}</span>
                  <span className="usage-stats">
                    <span className="usage-in">{fmtK(s.input)} in</span>
                    <span className="usage-out">{fmtK(s.output)} out</span>
                    <span className="usage-calls">{s.calls}×</span>
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Totals per model */}
      <div className="usage-section">
        <div className="usage-label">Gesamt ({days.length} Tage)</div>
        <div className="usage-rows">
          {models.map(([model, s]) => (
            <div key={model} className="usage-row">
              <span className="usage-model">{model}</span>
              <span className="usage-stats">
                <span className="usage-in">{fmtK(s.input)} in</span>
                <span className="usage-out">{fmtK(s.output)} out</span>
                <span className="usage-calls">{s.calls}×</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
