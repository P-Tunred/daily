export const dateLong = new Intl.DateTimeFormat("de-DE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export const timeShort = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
});

export const timeWithSeconds = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatStamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;
}

export function formatCurrency(n: number, currency = "EUR"): string {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(n);
}

export function formatPct(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

/**
 * Returns true if the calendar event title likely contains a person's name.
 * Heuristics:
 *  1. Capitalised word after a social connector (mit, und, bei, für, with, and, &)
 *  2. A capitalised word at the end of the title (e.g. "Burschenfest Michi")
 * Intentionally lightweight — no NLP, no dictionary lookups.
 */
export function hasSocialName(title: string): boolean {
  // "mit Jan", "und Vicky", "bei Michi", "& Emi"
  if (/\b(?:mit|und|bei|für|for|with|and|&)\s+[A-ZÄÖÜ][a-zäöüß]/u.test(title)) return true;
  // Last word is a capitalised short word (2–12 chars) that looks like a name
  if (/(?:^|\s)[A-ZÄÖÜ][a-zäöüß]{1,11}$/.test(title)) return true;
  return false;
}
