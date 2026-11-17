# ADR-0003 — Ein Briefing gilt nur für heute, alles andere wird abgelehnt

**Status:** angenommen · **Datum:** 2026-08-15 · **Betrifft:** `electron/hermesApi.cjs`, `src/lib/briefingContext.ts`

## Zusammenhang

Am 15.08. schrieb Hermes ein Briefing, dessen Text korrekt „Samstag" sagte, das
er aber auf den **16.** datierte. Der Server nahm es klaglos an und meldete
`200 ok`. Danach war es **unsichtbar**: Die Oberfläche zeigt die kurzen Zeilen
nur, wenn sie von heute sind.

Kein Fehler, keine Meldung, nur ein Dashboard, das aussah wie vorher. Gesucht
hätte man den Grund im Frontend, im Abgleich, im Cache — überall außer beim
Datumsfeld.

## Entscheidung

`POST /api/hermes/briefing` lehnt jedes `date` ab, das nicht exakt dem heutigen
Berliner Datum entspricht — **400**, mit einer Meldung, die den Grund nennt.

Die Anzeige prüft das Datum zusätzlich, aber an **einer** Stelle
(`useTagesZeilen()`), nicht in jeder Komponente einzeln.

## Begründung

Ein stiller Fehlschlag ist der teuerste. Die Regel muss dort greifen, wo der
Fehler entsteht, nicht dort, wo er auffällt.

Der Server ist die Autorität für das Datum, weil er der einzige Beteiligte ist,
der es nicht ausrechnen muss. (Hermes hatte es ausgerechnet — daher der Fehler.
Seine Anweisung lautet seither: `TZ=Europe/Berlin date +%F`, niemals selbst
zählen.)

## Folgen

Vorplanung („Briefing für morgen schreiben") ist damit **nicht** möglich.
Sollte sie kommen, braucht sie ein eigenes `mode: "scheduled"`, eine eigene
Ablage und `202 / eligibleNow: false` — keine stillschweigende Ausnahme für
„morgen".

Nebenwirkung beim Bauen: Die Platzhalter-Daten im Rauchtest lagen selbst in der
Zukunft (2099) und scheiterten prompt an der neuen Sperre. Sie liegen jetzt in
der Vergangenheit (2020).

## Nicht erneut vorschlagen

- „Ein Tag Vorlauf wäre doch praktisch" — war einmal erlaubt und hat genau
  diesen Fehler durchgelassen.
