import type { Quote } from "../types";

// ── In-memory cache (survives re-renders, cleared on full page reload) ────────

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const cache = new Map<string, { quote: Quote; ts: number }>();

function getCached(ticker: string): Quote | null {
  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.quote;
  return null;
}

function setCached(ticker: string, quote: Quote) {
  cache.set(ticker, { quote, ts: Date.now() });
}

/** Call this when the user explicitly clicks Refresh to bust the cache. */
export function clearQuoteCache() {
  cache.clear();
}

// ── localStorage stale-cache (survives page reloads, shows last known prices) ─

const LS_KEY = "morning.stock.cache";

type LSEntry = { quote: Omit<Quote, "fetchedAt"> & { fetchedAt: string }; ts: number };

function loadStaleCache(): Map<string, { quote: Quote; ts: number }> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return new Map();
    const entries = JSON.parse(raw) as Array<[string, LSEntry]>;
    return new Map(
      entries.map(([k, v]) => [
        k,
        { quote: { ...v.quote, fetchedAt: new Date(v.quote.fetchedAt), stale: true }, ts: v.ts },
      ]),
    );
  } catch {
    return new Map();
  }
}

function persistToLS(liveCache: Map<string, { quote: Quote; ts: number }>) {
  try {
    const entries = Array.from(liveCache.entries());
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch { /* quota or SSR — ignore */ }
}

/** Last known quotes from the stale-cache — for consumers that want a cheap
 *  snapshot without triggering any fetch (e.g. the Jarvis context block). */
export function readCachedQuotes(): Map<string, Quote> {
  return new Map(Array.from(loadStaleCache(), ([k, v]) => [k, v.quote]));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Twelve Data — batch quote API (free, 800 calls/day) ───────────────────────
// Set VITE_TWELVEDATA_KEY in .env for this fallback to activate.
// Free key at: https://twelvedata.com (no credit card needed)

async function fetchBatchFromTwelveData(tickers: string[]): Promise<Map<string, Quote>> {
  const key = import.meta.env.VITE_TWELVEDATA_KEY as string | undefined;
  if (!key) throw new Error("VITE_TWELVEDATA_KEY not set");

  // Map tickers to Twelve Data format (.DE suffix works directly for Xetra)
  const symbols = tickers.join(",");
  const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Twelve Data: HTTP ${res.status}`);
  const json = await res.json();

  const map = new Map<string, Quote>();
  for (const ticker of tickers) {
    // Response is either { "AAPL": {...} } for multiple, or { "symbol": "AAPL", ... } for single
    const data = tickers.length === 1 ? json : json[ticker];
    if (!data || data.code === 400 || data.status === "error") continue;
    const price = parseFloat(data.close ?? data.price);
    const changePct = parseFloat(data.percent_change ?? "0");
    if (!Number.isFinite(price) || price === 0) continue;
    map.set(ticker, {
      ticker,
      price,
      currency: data.currency ?? inferCurrency(ticker),
      changePct: Number.isFinite(changePct) ? changePct : 0,
      fetchedAt: new Date(),
    });
  }
  if (map.size === 0) throw new Error("Twelve Data: no usable quotes");
  return map;
}

// ── Yahoo Finance v7 — batch endpoint (all tickers in one request) ─────────────

async function fetchBatchFromYahoo(base: string, tickers: string[]): Promise<Map<string, Quote>> {
  const symbols = tickers.join(",");
  const url = `${base}/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&fields=regularMarketPrice,regularMarketPreviousClose,currency`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo batch: HTTP ${res.status}`);
  const json = await res.json();
  const results = json?.quoteResponse?.result;
  if (!Array.isArray(results) || results.length === 0)
    throw new Error("Yahoo batch: empty result");

  const map = new Map<string, Quote>();
  for (const item of results) {
    const price: number = item.regularMarketPrice;
    const prev: number = item.regularMarketPreviousClose ?? item.chartPreviousClose;
    const changePct = prev ? ((price - prev) / prev) * 100 : 0;
    map.set(item.symbol, {
      ticker: item.symbol,
      price,
      currency: item.currency ?? "USD",
      changePct,
      fetchedAt: new Date(),
    });
  }
  return map;
}

// ── Yahoo Finance v8 — per-ticker chart endpoint ──────────────────────────────

async function fetchFromYahoo(base: string, ticker: string): Promise<Quote> {
  const url = `${base}/v8/finance/chart/${encodeURIComponent(ticker)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${ticker}: empty result`);
  const meta = result.meta;
  const price: number = meta.regularMarketPrice;
  const prev: number = meta.chartPreviousClose ?? meta.previousClose;
  const changePct = prev ? ((price - prev) / prev) * 100 : 0;
  return {
    ticker,
    price,
    currency: meta.currency ?? "USD",
    changePct,
    fetchedAt: new Date(),
  };
}

// ── Stooq fallback ────────────────────────────────────────────────────────────

function stooqSymbol(ticker: string): string {
  if (ticker.includes(".")) return ticker.toLowerCase();
  return `${ticker.toLowerCase()}.us`;
}

function inferCurrency(ticker: string): string {
  if (ticker.endsWith(".DE") || ticker.endsWith(".PA") || ticker.endsWith(".AS"))
    return "EUR";
  if (ticker.endsWith(".L")) return "GBP";
  return "USD";
}

async function fetchFromStooq(ticker: string): Promise<Quote> {
  const sym = stooqSymbol(ticker);
  const url = `/stooq/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlc&h&e=csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Stooq ${ticker}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.includes("Exceeded")) throw new Error(`Stooq ${ticker}: daily limit exceeded`);
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`Stooq ${ticker}: no data`);
  const headers = lines[0].split(",");
  const values = lines[1].split(",");
  const row: Record<string, string> = {};
  headers.forEach((h, i) => (row[h.trim()] = values[i]?.trim() ?? ""));
  const close = parseFloat(row["Close"]);
  const open = parseFloat(row["Open"]);
  if (!Number.isFinite(close) || close === 0)
    throw new Error(`Stooq ${ticker}: invalid close`);
  const changePct =
    Number.isFinite(open) && open > 0 ? ((close - open) / open) * 100 : 0;
  return {
    ticker,
    price: close,
    currency: inferCurrency(ticker),
    changePct,
    fetchedAt: new Date(),
  };
}

// ── Single ticker fetch (cache-first, then Yahoo v8 → Yahoo2 v8 → Stooq) ─────

export async function fetchQuote(ticker: string): Promise<Quote> {
  const cached = getCached(ticker);
  if (cached) return cached;

  const errors: string[] = [];
  for (const attempt of [
    () => fetchFromYahoo("/yahoo", ticker),
    () => fetchFromYahoo("/yahoo2", ticker),
    () => fetchFromStooq(ticker),
  ]) {
    try {
      const quote = await attempt();
      setCached(ticker, quote);
      return quote;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(errors.join(" | "));
}

// ── Batch fetch — tries Yahoo v7 batch first, then sequential per-ticker ───────

export async function fetchQuotes(
  tickers: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Array<{ ticker: string; quote?: Quote; error?: string }>> {

  // 1. Serve any cache hits immediately
  const results: Array<{ ticker: string; quote?: Quote; error?: string }> = [];
  const uncached: string[] = [];
  for (const ticker of tickers) {
    const hit = getCached(ticker);
    if (hit) {
      results.push({ ticker, quote: hit });
    } else {
      uncached.push(ticker);
    }
  }
  if (uncached.length === 0) {
    onProgress?.(tickers.length, tickers.length);
    return tickers.map((t) => results.find((r) => r.ticker === t)!);
  }

  // 2. Try batch sources in order: Yahoo v7 → Yahoo2 v7 → Twelve Data
  let batchMap: Map<string, Quote> | null = null;
  const batchAttempts: Array<() => Promise<Map<string, Quote>>> = [
    () => fetchBatchFromYahoo("/yahoo", uncached),
    () => fetchBatchFromYahoo("/yahoo2", uncached),
    () => fetchBatchFromTwelveData(uncached),
  ];
  for (const attempt of batchAttempts) {
    try {
      batchMap = await attempt();
      if (batchMap.size > 0) break;
    } catch { /* try next */ }
  }

  // 3. Cache batch hits; collect misses for per-ticker fallback
  //    IMPORTANT: if batch returned partial results, tickers NOT in the response
  //    must still go through the per-ticker fallback (Yahoo v8 → Stooq), not be
  //    immediately marked as errors.
  const needsPerTicker: string[] = [];
  if (batchMap && batchMap.size > 0) {
    for (const ticker of uncached) {
      const q = batchMap.get(ticker);
      if (q) {
        setCached(ticker, q);
        results.push({ ticker, quote: q });
      } else {
        needsPerTicker.push(ticker); // missing from batch → try individually
      }
    }
  } else {
    // Batch failed entirely — try all uncached tickers per-ticker
    needsPerTicker.push(...uncached);
  }

  // Signal progress for anything already resolved via batch
  if (needsPerTicker.length < uncached.length) {
    onProgress?.(results.length, tickers.length);
  }

  // 4. Per-ticker fallback (Yahoo v8 → Yahoo2 v8 → Stooq) with 300 ms gaps
  let done = results.length;

  for (let i = 0; i < needsPerTicker.length; i++) {
    const ticker = needsPerTicker[i];

    if (i > 0) await delay(300); // be polite to rate-limiters

    try {
      const quote = await fetchQuote(ticker);
      results.push({ ticker, quote });
    } catch (e) {
      results.push({
        ticker,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    done++;
    onProgress?.(done, tickers.length);
  }

  // Persist any successful live fetches
  persistToLS(cache);

  // 5. For any ticker that still errored, try localStorage stale-cache
  const staleCache = loadStaleCache();
  const finalResults = tickers.map((ticker) => {
    const r = results.find((x) => x.ticker === ticker)!;
    if (r.quote) return r; // live data — great
    const stale = staleCache.get(ticker);
    if (stale) {
      return { ticker, quote: stale.quote }; // stale but better than nothing
    }
    return r; // error with no fallback
  });

  return finalResults;
}
