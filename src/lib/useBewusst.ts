import { useEffect, useRef, useState } from 'react';
import { SCHLUESSEL } from './store';
import { emptyState, type BewusstState } from './bewusst';
import { STAND_WEITER } from './syncBasis';
const KEY = SCHLUESSEL.bewusst;
export function useBewusst() {
  const [state, setState] = useState<BewusstState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (saving.current) return;
      const gen = ++generation.current;
      try {
        const r = await fetch('/api/bewusst', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('Routinen sind gerade nicht erreichbar.');
        const { value } = await r.json();
        const parsed = value === null ? emptyState() : KEY.lese(value);
        if (!parsed) throw new Error('Routinen sind nicht lesbar. Nichts wurde überschrieben.');
        if (alive && gen === generation.current) { setState(parsed); setError(''); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Laden fehlgeschlagen.'); }
    };
    void refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('morning:bewusst-changed', refresh);
    return () => { alive = false; clearInterval(timer); window.removeEventListener('morning:bewusst-changed', refresh); };
  }, []);
  async function save(change: (s: BewusstState) => BewusstState) {
    if (saving.current) return;
    saving.current = true; generation.current++; setBusy(true);
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await fetch('/api/bewusst', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error('Server nicht erreichbar. Bitte erneut versuchen.');
        const { value: base } = await r.json();
        const latest = base === null ? emptyState() : KEY.lese(base);
        if (!latest) throw new Error('Gespeicherte Daten sind nicht lesbar.');
        const value = KEY.schreibe(change(latest));
        if (value === base) { setState(latest); setError(''); return true; }
        const put = await fetch('/api/bewusst', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base, value }), signal: AbortSignal.timeout(8000) });
        if (put.status === 409) continue;
        if (!put.ok) throw new Error('Speichern nicht bestätigt. Bitte erneut versuchen.');
        // Der Server hat dabei seine Versionsmarke weitergesetzt. Ohne diese
        // Meldung verlöre der nächste Gesamt-Upload still, was seither im
        // Browser geändert wurde (siehe syncBasis.ts).
        const sprung = await put.json().catch(() => null) as { vorher?: unknown; updatedAt?: unknown } | null;
        window.dispatchEvent(new CustomEvent(STAND_WEITER, { detail: { vorher: sprung?.vorher, nachher: sprung?.updatedAt } }));
        const back = await fetch('/api/bewusst', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
        if (!back.ok) throw new Error('Rücklesen fehlgeschlagen. Bitte neu laden.');
        const confirmed = await back.json();
        const parsed = KEY.lese(confirmed.value);
        if (!parsed) throw new Error('Rückleseprüfung fehlgeschlagen.');
        setState(parsed); setError('');
        localStorage.setItem(KEY.name, confirmed.value);
        window.dispatchEvent(new Event('morning:bewusst-changed'));
        return true;
      }
      throw new Error('Gleichzeitige Änderungen. Bitte erneut versuchen.');
    } catch (e) { setError(`Nicht bestätigt. ${e instanceof Error ? e.message : 'Speichern fehlgeschlagen.'} Bitte erneut versuchen.`); }
    finally { saving.current = false; setBusy(false); }
  }
  return { state, save, busy, error };
}
