# Daily — Homescreen „ganz oben“, Glas-Fassung · Brief für Claude Design

Stand: 2026-11-01, Daily `3bb0320`. Screenshots daneben: `homescreen-glas-1440.png`,
`homescreen-glas-390.png`. Sie sind im Browser aufgenommen. Dort liegt hinter der Seite kein
Schreibtisch, deshalb steht dort ein dunkler Ersatzgrund (`#181825` plus ein leichter
Farbschimmer). Im echten Fenster liegt hinter allem der macOS-Schreibtisch.

## 1. Der Auftrag

Gestalte den **ersten Bildschirm** von Daily (das „Intro“ bis zum Hinweis „Mehr“, dazu die
Elemente am Bildschirmrand) für die **durchsichtige Fassung „Glas“**. Der Arbeitsbereich darunter
(Aufgaben, Horizont, Mails …) gehört nicht zum Auftrag.

**Du darfst alles Visuelle ändern** und ausdrücklich auch **eine Akzentfarbe nutzen**, gern
eine eigene: Anordnung, Typografie, Farben, Abstände, Material,
Bewegung, Icons und auch die Designsprache aus Abschnitt 5. Sie beschreibt den heutigen Stand
und ist ein Vorschlag, kein Gesetz. Du darfst auch vorschlagen, Elemente zusammenzulegen,
umzustellen oder wegzulassen. Kennzeichne das dann als Vorschlag.

**Fest bleiben** nur die Funktionen in Abschnitt 4 (was ein Element tut, welche Zustände es hat,
woher die Daten kommen) und die Leitplanken in Abschnitt 6. Wenn du eine Funktion anders lösen
willst, beschreibe die neue Funktion. Paul gibt sie dann an Claude Code weiter.

## 2. Was Daily ist und was uns ausmacht

- **Ein Cockpit für genau einen Menschen.** Paul ist Student, Daily ist sein Morgenbildschirm am
  Mac. Es gibt keine Nutzerverwaltung und kein Marketing, alle Texte sind auf Deutsch und
  sprechen ihn mit „du“ an.
- **Hermes schreibt, Daily zeigt und ordnet.** Hermes ist Pauls KI-Agent auf einem Server. Er
  liefert Gruß, Tageszeile und Hörbriefing. Daily rechnet den Rest lokal (Score, Aufgaben,
  Lernzeit). Gespräche mit Hermes finden in Telegram statt, nicht im Dashboard
  (Pauls Entscheidung vom 31.10.).
- **Ehrlich über die Herkunft.** Ein lokal errechneter Satz darf nie so aussehen, als käme er von
  Hermes. Deshalb gibt es immer die kleine Herkunftszeile, siehe 4.3.
- **Ruhe statt Lärm.** Oben steht seit dem 31.10. kein Fließtext mehr unter dem Gruß, es gibt
  keine Briefing-Karte und kein „Im Fokus“. Das Hörbriefing ist ein einziger Knopf. Was leer
  ist, verschwindet ganz, statt als leere Kachel herumzustehen.
- **Seltenheit ist das Feature.** Pop-ups gibt es höchstens einmal am Tag, und nur für Dinge, die
  morgen nicht mehr möglich sind. Alles andere ist leise.
- **Wachsen, nicht hetzen.** Daily kommt vom Thema „Setzling“ (ein junger Baum im Moos). Der Score
  wächst über einem Stiel mit Leuchtpunkt. Die Sprache ist trocken und freundlich, nie ein
  Motivationsposter.

## 3. Die Glas-Fassung: technische Bedingungen

- Das Electron-Fenster ist immer transparent (`transparent: true`, `titleBarStyle:
  'hiddenInset'`). Auf macOS zeichnet `vibrancy: 'fullscreen-ui'` den Schreibtisch dahinter
  selbst weich. Wie stark er unscharf wird, hängt am Material und nicht an einem CSS-Wert.
- Die Seite malt im Thema Glas **keinen eigenen Hintergrund**. Bühne, Aurora-Verlauf und Foto
  fallen weg. Sichtbar ist nur ein Hauch Randschleier links, rechts, oben und unten, damit Text
  am Rand nicht auf einem hellen Schreibtisch steht.
- `backdrop-filter` (Blur 80 px, Sättigung 1,7) wirkt nur auf Seiteninhalt hinter Karten, **nicht
  auf den Schreibtisch**.
- Die Lesbarkeit tragen Unschärfe und Textschatten (`--shadow-text`), nicht Deckkraft. Dahinter
  kann ein heller oder ein dunkler Schreibtisch liegen, und beides muss funktionieren.
- Im normalen Browser (Telefon, ohne Fenstertransparenz) bekommt Glas den dunklen Ersatzgrund
  `#181825`. Dort muss es wie ein normales dunkles Thema aussehen, nicht kaputt.
- Dialoge dunkeln kaum ab (`--overlay-bg: rgba(11,20,31,0.30)`, Blur 14 px), damit sie den
  Schreibtisch nicht zumauern.

## 4. Inventar: was ganz oben steht und was es tut

Die Reihenfolge entspricht dem Bildschirm. „Bei Bedarf“ heißt: Das Element ist nur da, wenn es
etwas zu sagen hat, sonst nimmt es keinen Platz ein.

### 4.1 Am Bildschirmrand (immer)

| Element | Was es tut |
|---|---|
| **Verbrauchslinien** oben und unten | Je eine Haarlinie über die volle Breite, die sich von links füllt. Oben ist der Wochenverbrauch von Claude (Akzentfarbe), unten der von GLM (warmer Ton). Rechts steht winzig „CLAUDE · 67 % VERBRAUCHT · BIS MO 03:59“. Rein informativ, ohne Klick. |
| **Seitenleiste** rechts, senkrecht mittig | Drei runde Knöpfe: **Morgens** (dieser Bildschirm), **Lernzeit** (zweite Ansicht) und **Einstellungen** (Zahnrad). Das Zahnrad klappt ein Feld nach links auf mit Thema (Setzling, Abendrot, Nachtblau, Glas, Kupferstich, Arkadien), Klick-Sounds an/aus und Hinweise an/aus. Oben bleibt der Bildschirm bewusst frei, es gibt keine Kopfleiste. |

### 4.2 Bei Bedarf über dem Intro

| Element | Wann | Was es tut |
|---|---|---|
| **Morgen-Triage** (Pop-up) | morgens, wenn neue Mails eingeordnet wurden | Zeigt die eingeordneten Mails. Klausuren und Abgaben wandern automatisch in den Horizont. „Später“ schiebt es auf. |
| **Zurückgewiesen-Streifen** | wenn Daily etwas von Hermes abgelehnt hat | Schmaler Streifen: was abgelehnt wurde und warum. Sonst würde es niemand merken. |
| **Kanal-Hinweis** | wenn ein Kanal zum Second Brain klemmt | Schmaler Streifen, z. B. „Tagesbericht kam nicht“ oder „Hörbriefing fehlt“. |
| **„Gehst du heute hin?“** | morgens, wenn es offene Termine gibt | Fragt je Termin: hingehen ja oder nein. Lässt sich vertagen. |
| **Vorlauf-Frage** | selten | Fragt, ab wann ein datierter Vorgang zur Aufgabe werden soll (am Tag selbst oder einige Tage vorher). |
| **„Kurze Frage“** | wenn das Brain eine offene Frage hat | Eine Karte, kein Pop-up, mit Antwortfeld. Ist dieselbe Frage, mit der das Hörbriefing endet. |

### 4.3 Intro links: „die Stimme“

| Element | Was es tut | Zustände und Regeln |
|---|---|---|
| **Kicker**: `● SONNTAG, 1. NOVEMBER · 09:03` | Datum und Uhrzeit, live. | Akzentfarbe, Mono, versal. |
| **„← Gestern nachtragen“** | Öffnet einen Dialog für gestern: Routinen, Gym und Wochenvorhaben, eine erledigte Aufgabe, Lernzeit. Gilt nur für gestern. | Gehört bewusst nach oben: Beim ersten Blick morgens fällt einem ein, was fehlt. |
| **Gruß** (größte Schrift links) | „Guten Morgen, Paul.“ | Text von Hermes (`headerGreeting`, höchstens 40 Zeichen). Fehlt er, greift die lokale Formel: vor 11 Uhr „Guten Morgen“, dann „Hallo“, abends „Guten Abend“. **Darunter steht kein Fließtext** (Pauls Entscheidung vom 31.10.). |
| **Herkunftszeile** | Sagt, woher die Texte stammen. | „Hermes · aktuell · 06:05“, „Hermes · nur Text“, „Heute kein Hermes-Briefing · lokale Texte“, „Stand von 2026-10-31 · lokale Texte“, „Sync offline · lokale Texte“, „Serverzustand nicht lesbar · lokale Texte“. **Muss immer sichtbar bleiben**, auch wenn sie klein ist. |
| **Hörbriefing-Knopf** „▶ Dein Tag zum Anhören · 3:09“ | Spielt Pauls Tagesbriefing ab (Aufnahme bis 5 min, Text von Hermes, Stimme Gemini). Ein Klick spielt, ein zweiter pausiert. Beim Hören zählt die Restzeit herunter, und eine Haarlinie zeigt den Fortschritt. | Startet nie von selbst. Fehlt die Aufnahme (noch keine, in Arbeit, Fehler), ist **nichts** zu sehen. Sprach die Ersatzstimme, steht nur ein Tooltip da. Kein Text, kein Mitlesen, keine Spulleiste, kein Tempo (Pauls Wunsch vom 01.11.: „schlichter“). |
| **„▸ Neu im Brain · 6 seit gestern“** | Klappt auf und zeigt, was seit gestern ins Second Brain kam: Titel und bis zu drei Stichpunkte je Eintrag. | Ganz weg, wenn nichts Neues da ist. Bewusst leise. |

### 4.4 Intro Mitte: „Wie der Tag steht“

| Element | Was es tut |
|---|---|
| **Label** „WIE DER TAG STEHT“ | Überschrift, Mono, sehr weit gesperrt. |
| **Score** „0 / 100“ (größte Zahl) | Tagesbewertung. Lernzeit bringt bis zu 65 Punkte (52 fürs Tagesziel, bis zu 13 extra bis 150 %), Aufgaben bis zu 35 (dringende zählen dreifach). Lange offene Aufgaben ziehen ab. Wird lokal gerechnet und ändert sich live. |
| **Satz** unter der Zahl | Einordnung in fünf Stufen, z. B. „Gut unterwegs — *der Rest des Tages gehört noch dir.*“ oder „Noch nichts eingetragen heute.“ |
| **Kennzahlen** „0/60 min · 0/0 Aufgaben · 0 d“ | Lernminuten von Ziel, erledigte von allen Aufgaben, Serie in Tagen. |
| **Tagesziel-Zeile** (bei Bedarf) | Nur wenn das Ziel unter dem Budget liegt. Der Tooltip erklärt, woraus es berechnet ist (Klausurpläne, feste Wochenzeiten). |
| **Stiel mit Leuchtpunkt** | Reine Dekoration in Akzentfarbe: Der Score „wächst“. |

### 4.5 Intro rechts: „Heute“

| Element | Was es tut |
|---|---|
| **Label** „HEUTE“ | |
| **Tageszeile** | Von Hermes (`todayLead`, höchstens 120 Zeichen), sonst lokal: „Okay — *nur das hier* musst du heute machen.“ |
| **Liste der Muss-Aufgaben** | Jede Zeile hat einen Farbpunkt für die Kategorie. **Klick hakt ab**, Enter und Leertaste ebenso. Dient nur dem Blick, bearbeitet wird weiter unten. Rechtsbündig, mit einer Akzentlinie rechts. |
| **Leerer Tag** | Steht in der Woche etwas an: „Heute ist frei.“ plus der Link „2 Punkte warten diese Woche ↓“, der zur Wochenliste springt. Sonst: „Nichts Festes heute — mach draus, was du willst.“ (kursiv) |

### 4.6 Unten

| Element | Was es tut |
|---|---|
| **„MEHR ⌄“** | Sanft wippender Hinweis, dass darunter der Arbeitsbereich liegt. Wippt nicht bei „weniger Bewegung“. |

### 4.7 Auf dem Telefon (unter 760 px)

Alles steht in einer Spalte untereinander: Stimme, Score, Heute, Mehr. Rechts bleiben 54 px frei
für die Seitenleiste.

## 5. Designsprache: heutiger Stand, darf geändert werden

**Haltung:** Text steht direkt auf dem Grund, nicht in Karten. Das Intro hat bewusst keine
Kacheln. Hierarchie entsteht über Größe und Leuchtkraft des Textes, nicht über Kästen. Heute ist der
Akzent sparsam (Kicker, Abspielpunkt, Stiel). **Pauls Wunsch vom 01.11.: Claude Design soll ruhig
eine Akzentfarbe nutzen**, auch kräftiger und an mehr Stellen, solange es ruhig bleibt. **Die
Akzentfarbe soll wechselbar sein:** Paul wählt sie in den Einstellungen (ein paar Vorschläge plus
eigene Farbe). Alles, was vom Akzent abhängt (Hover, Fortschritt, Fokus, weiche Flächen, Text auf
Akzent), leitet sich aus EINEM Token ab und muss mit jeder Akzentfarbe lesbar bleiben.

**Typografie, drei Stimmen:**
- *Serif* (`ui-serif` / New York) für den Gruß: persönlich, ruhig, 26–38 px, Laufweite −0,035 em.
- *Grotesk* (Schibsted Grotesk) für Sätze, Score und Listen. Der Score ist leicht (300), groß
  (48–64 px) und hat Tabellenziffern.
- *Mono, versal, weit gesperrt* (JetBrains Mono, 9,5–11 px, 0,14–0,34 em) für alles
  Maschinelle: Kicker, Labels, Herkunft, Dauer, Verbrauch. Es ist die Sprache von „System sagt“.

**Farben Glas** (gemessen am Bergbild „Nachtblau“, nahezu ein Farbton H 210):

| Token | Wert | Rolle |
|---|---|---|
| `--text-1` | `#EDEDF4` | Gruß, Score, Wichtiges |
| `--text-2` | `rgba(237,237,244,.68)` | Sätze |
| `--text-3` | `rgba(237,237,244,.44)` | Labels, Meta |
| `--text-4` | `rgba(237,237,244,.30)` | Leisestes (Herkunft, Neu im Brain) |
| `--accent` | `#4497E4` | Mondlicht auf Schnee: Handlung, Live, Fortschritt |
| `--accent-deep` | `#1F73C1` | |
| `--warn` | `#DCBA6A` | Mondgold: wichtig. **Warm**, weil der Akzent kühl ist. |
| `--crit` | `#D37E69` | warmer Fels: kritisch |
| `--glass-bg` | `rgba(20,32,46,.17)` | Kartengrund, nur ein Hauch |
| `--line-1/2/3` | Weiß mit 14 / 24 / 36 % | Haarlinien |

Regel: Kontrast entsteht über die **Temperatur** (kühl gegen warm), nicht über eine weitere
Blaustufe.

**Material:** Karten (erst unterhalb des Intros) haben Glas mit 80 px Blur, Radius 24 und eine
Haarlinie. Menüs sind etwas dichter (`rgba(30,30,46,.46)`).

**Bewegung:** Die Kurve ist `cubic-bezier(0.22, 1, 0.36, 1)`, die Dauern sind 180 ms (Mikro),
320 ms (Panel) und 600 ms (Seite). Animiert werden nur transform und opacity. Bei „weniger
Bewegung“ steht alles still.

**Bedienung:** Trefferflächen sind mindestens 40–44 px, auch wenn der sichtbare Text klein ist
(unsichtbares Polster). Fokusringe sind sichtbar (2 px Akzent). Hover hebt Text auf `--text-1`
an, statt Flächen einzufärben.

## 6. Leitplanken: bitte nicht brechen

1. Im Glas-Thema gibt es **keinen deckenden Hintergrund**. Der Schreibtisch soll sichtbar
   bleiben, und beides muss lesbar sein, heller wie dunkler Schreibtisch.
2. Die **Herkunftszeile** bleibt immer sichtbar und unterscheidbar (Hermes oder lokal).
3. **Unter dem Gruß kein Fließtext**, keine Briefing-Karte, kein Chat- oder Gesprächsfeld.
4. **Hörbriefing**: ein Knopf, nur auf Klick, ohne Text oder Mitlesen. Ohne Aufnahme ist nichts
   zu sehen.
5. **Leeres verschwindet.** Elemente, die „bei Bedarf“ sind, bekommen keinen Platzhalter.
6. Deutsch, mit „du“ und trockenem, freundlichem Ton.
7. Barrierefreiheit: Kontrast mindestens AA für Sätze, Tastaturbedienung, „weniger Bewegung“
   wird respektiert, Trefferflächen mindestens 40 px.
8. Desktop (1440 px, Fenster auch schmaler) und Telefon (390 px) müssen beide funktionieren.

## 7. Was wir zurück brauchen

Damit Claude Code es umsetzen kann:
- Entwürfe für 1440 px und 390 px, jeweils über einem **hellen** und einem **dunklen**
  Schreibtisch.
- Alle Zustände aus Abschnitt 4: Hörbriefing da oder nicht da bzw. beim Abspielen, Heute mit
  Liste, mit „Wochen-Link“ und leer, Score bei 0 und bei 80, die Herkunftszeile in mindestens
  zwei Varianten.
- Die Designsprache als **Tokens** (Farben, Schriften, Größen, Abstände, Radien, Schatten,
  Bewegung). Am besten als CSS-Variablen, die die Tabelle in Abschnitt 5 ersetzen.
- Für jede geänderte oder neue **Funktion** einen Satz: was sie tut, wann sie erscheint, was ein
  Klick bewirkt.

## Quellen

Code im Repo `P-Tunred/morning-dashboard` (Stand `3bb0320`): `src/pages/DashboardPage.tsx`,
`src/components/HeuteJarvis.tsx`, `TodayCorner.tsx`, `HoerbriefingPlayer.tsx`, `NeuImBrain.tsx`,
`SideRail.tsx`, `UsageEdges.tsx`, `src/lib/briefingContext.ts`, `src/lib/dayScore.ts`,
`src/index.css` (Thema `glas`), `src/setzling.css`, `electron/main.cjs`; `CONTEXT.md`;
Gespräch vom 2026-11-01.
