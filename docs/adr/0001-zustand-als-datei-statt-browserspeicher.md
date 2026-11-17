# ADR-0001 — Der Zustand liegt als Datei auf dem Server, nicht im Browser

**Status:** angenommen · **Datum:** 2026-08 · **Betrifft:** `electron/stateStore.cjs`, `src/lib/sync.ts`

## Zusammenhang

Todos, Lernzeiten, Ziele und Score lebten in `localStorage` und IndexedDB des
Browsers. Dieser Speicher hängt an der **Adresse** des Fensters. Eine neue
Adresse — die VM statt `localhost` — bekommt einen frischen, leeren Speicher.

Beim Umzug auf die VM wären damit **671 Lernzeit-Einträge lautlos verschwunden**.
Nicht mit einer Fehlermeldung, sondern als leeres Dashboard, das aussieht, als
hätte es nie Daten gegeben.

## Entscheidung

Der Zustand liegt als `state.json` unter `DAILY_DATA_DIR` auf dem Server. Der
Browser hält eine Kopie und gleicht sie über `/api/state` ab.

- Geschrieben wird **atomar**: erst `.tmp`, dann `rename`. Ein Absturz mitten im
  Schreiben kann den Zustand nicht zerreißen.
- Vor dem ersten Schreiben eines Tages wandert eine Kopie nach `snapshots/`,
  30 Tage werden aufgehoben.
- Ein **Optimistic Lock** (`baseUpdatedAt`) verhindert, dass ein altes Fenster
  neuere Daten überschreibt.

## Folgen

Gut: Der Zustand übersteht Adresswechsel, Geräte und Neuinstallationen. Hermes
kann ihn lesen, was in einem Browserspeicher unmöglich wäre.

Preis: Es gibt jetzt zwei Kopien, die abgeglichen werden müssen — mit allem, was
dazugehört (Konflikte, Offline, Reihenfolge). Der Abgleich ist die Stelle, an der
Fehler weh tun.

## Nicht erneut vorschlagen

- „Einfach localStorage nehmen, das reicht doch" — nein, siehe oben.
- „Eine richtige Datenbank" — für einen Nutzer und ~200 KB Zustand wäre das
  mehr Betrieb als Nutzen. Die Snapshot-Datei ist mit `cat` zu reparieren.
