# ADR-0004 — Das Electron-Fenster ist immer transparent

**Status:** angenommen · **Datum:** 2026-08 · **Betrifft:** `electron/main.cjs`, Thema `glas`

## Zusammenhang

Das Thema „Glas" soll den Schreibtisch durchscheinen lassen. Electron kann
`transparent` aber **nur beim Erzeugen** des Fensters setzen — ein Umschalten
zur Laufzeit gibt es nicht.

## Entscheidung

Das Fenster wird **immer** transparent erzeugt (`transparent: true`,
`backgroundColor: '#00000000'`, auf macOS zusätzlich `vibrancy`). Die anderen
Themen malen in `.stage` ein deckendes Foto darüber; nur „Glas" lässt die Bühne
leer.

## Begründung

So braucht der Themenwechsel keinen Fensterneustart. Die Alternative — Fenster
schließen und neu öffnen — würde beim Umschalten die Anwendung neu laden.

`vibrancy` lässt **macOS** den Schreibtisch weichzeichnen. Das ist der
Apple-Glas-Effekt und sauberer als ein `backdrop-filter`, der ohnehin nur
Seiteninhalt erfassen würde, nicht den Desktop dahinter.

## Folgen

Die Durchsicht gibt es **nur im Mac-Fenster**. Im Browser fällt „Glas" auf einen
dunklen Grund zurück — ein Tab kann den Desktop nicht zeigen, dahinter läge Weiß
und heller Text darauf wäre unlesbar.

Erkannt wird das Fenster am User-Agent: `DailyShell/` **oder** `Electron/`.
Beides gilt bewusst. Eine Verschärfung auf nur `DailyShell/` hat die
Durchsichtigkeit einmal ausgeschaltet, weil die installierte App älter war als
die Kennung. **Eine Erkennung, die eine frisch gepackte App voraussetzt, darf
nicht über den Server ausgerollt werden, ohne die App mitzuliefern.**

Der Vorschau-Browser meldet sich selbst als Electron und rendert „Glas" deshalb
durchsichtig auf Weiß. Bekannter Fehlalarm, folgenlos.

## Nicht erneut vorschlagen

- „Nur auf `DailyShell/` prüfen, das ist sauberer" — hat schon einmal die
  Funktion abgeschaltet.
