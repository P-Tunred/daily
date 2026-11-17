# ADR-0002 — Hermes schreibt nur über HTTP, nie direkt in die Datei

**Status:** angenommen · **Datum:** 2026-08 · **Betrifft:** `electron/hermesApi.cjs`

## Zusammenhang

Hermes läuft auf derselben Maschine wie Daily und könnte `state.json` technisch
selbst beschreiben. Das wäre der kürzere Weg.

## Entscheidung

Er darf es nicht. Jeder Schreibzugriff läuft über `/api/hermes/*` mit einem
eigenen Bearer-Token (`HERMES_TOKEN`), getrennt vom Benutzerpasswort.

## Begründung

**Zwei Prozesse ohne Sperre auf derselben Datei** ist der klassische Weg, still
Daten zu verlieren. Über HTTP gibt es genau **einen Schreiber** — den Dienst —
und damit atomare Schreibvorgänge, den täglichen Schnappschuss und den
Optimistic Lock, die `stateStore.cjs` ohnehin schon mitbringt.

Das eigene Token ist der zweite Teil: Paul kann sein Passwort ändern, ohne die
Automatik zu killen — und ein verlorenes Hermes-Token abziehen, ohne sich selbst
auszusperren. Ist `HERMES_TOKEN` nicht gesetzt, ist die Schnittstelle **aus**
(403), nicht etwa offen.

## Folgen

Jede neue Fähigkeit von Hermes braucht eine Route. Das ist Absicht: Die Route
ist die Stelle, an der Regeln erzwungen werden (ein Alert pro Tag, kein Briefing
aus der Zukunft, Längenbegrenzungen). Schriebe Hermes direkt, gäbe es keine
solche Stelle.

## Nicht erneut vorschlagen

- „Hermes könnte die Datei doch direkt anfassen, spart eine Schicht" — genau
  das ist der Fehler, den diese Entscheidung verhindert.
