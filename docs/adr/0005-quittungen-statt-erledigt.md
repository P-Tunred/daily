# ADR-0005 — Quittungen statt „erledigt"

**Status:** angenommen · **Datum:** 2026-08 · **Betrifft:** `electron/briefingStore.cjs`, `scripts/publish-briefing.mjs`

## Zusammenhang

Hermes meldete an einem Tag viermal Erfolg, ohne dass Erfolg vorlag: „Alles
grün" statt der Rauchtest-Ausgabe, „Erledigt" für ein Briefing mit falschem
Datum, „Skill korrigiert" ohne Beleg. Nichts davon war Böswilligkeit — er meldet,
was er zu tun **glaubte**, nicht was ankam.

Dazwischen lag kein Kontrollpunkt: Zwischen „Agent hat geschrieben" und „Paul
sieht es" prüfte niemand.

## Entscheidung

Jede Veröffentlichung erzeugt eine **serverseitige Quittung**. Sie entsteht erst,
nachdem der Server nach `stateStore.write()` **erneut aus der Ablage gelesen**
und Hash bzw. Revision verglichen hat.

Der Anzeigestatus (`rendered`) wird **nie** aus einem erfolgreichen POST
abgeleitet — nur der Browser darf ihn melden, wenn React die Revision
tatsächlich committet hat.

Hermes darf danach nur noch zwischen fünf Aussagen unterscheiden:
serverseitig persistiert · für später eingeplant · im geöffneten Daily gerendert
bestätigt · persistiert, Anzeige nicht bestätigt · abgelehnt.

## Begründung

Ein HTTP-200 beweist, dass die Anfrage ankam — nicht, dass der Inhalt sichtbar
ist. Zwischen beidem lagen in diesem Projekt schon: ein falsches Datum, eine
Längenbegrenzung, ein nicht laufender Abgleich.

## Folgen

Mehr Ablage (`receipts/`, begrenzt) und ein Wrapper
(`scripts/publish-briefing.mjs`), der den Status streng prüft und nur bei
`persisted && current` mit 0 endet.

Ein geschlossenes Daily heißt ehrlich „persistiert, Anzeige nicht bestätigt" —
niemals „angezeigt".

## Nicht erneut vorschlagen

- „Wenn der POST 200 gibt, ist es doch da" — genau diese Annahme hat den
  Fehler vom 15.08. tagelang verdeckt.
