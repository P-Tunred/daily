export type EventKind = "exam" | "birthday" | "deadline" | "note";

export type ImportantEvent = {
  id: string;
  kind: EventKind;
  title: string;
  date: string;
  recurringYearly?: boolean;
  subjectId?: string;
  note?: string;
  /** Estimated total hours needed to be ready for this event (mainly exams).
   *  Lets the Klausur-Countdown card compute whether you're on track. */
  requiredHours?: number;
  /** Stichtag, an dem aus diesem Termin eine Aufgabe wird (electron/dayStart.cjs).
   *
   *  Bewusst ein EIGENES Datum und nicht `date`: „Nachfassen, falls bis zum
   *  17. nichts kommt" gehört AN den Tag, „Frist läuft am 4. ab" gehört DAVOR.
   *  Ein Feld für beides wäre in einem der Fälle immer falsch. Fehlt es,
   *  passiert nichts — der Termin bleibt ein Termin. */
  alsTodoAm?: string;
  /** Tag, an dem die Aufgabe daraus erzeugt wurde. Verhindert, dass ein
   *  Neustart denselben Termin ein zweites Mal in eine Aufgabe verwandelt. */
  todoErzeugt?: string;
  /** Optionales Zeitfenster "HH:MM". Nur gemeinsam gesetzt — ein Termin mit
   *  Anfang und ohne Ende wäre schlimmer als ein Ganztagseintrag. Wird für
   *  Lernblöcke aus freien Kalenderlücken benutzt (electron/gaps.cjs). */
  startZeit?: string;
  endZeit?: string;
  /** User or system manually dismissed this event — hides it from active view */
  dismissed?: boolean;

  // ── Postausgang zum echten Kalender ──────────────────────────────────────
  // Daily spricht kein CalDAV und bekommt die Zugangsdaten auch nicht — die
  // gehören Hermes. Stattdessen legt Daily den Termin lokal an und Hermes holt
  // ihn ab. Diese drei Felder sind der Zustand dieses Wegs.

  /** Wie es um den echten Kalender steht.
   *  `undefined` heisst: gar nicht dafür vorgesehen (Altbestand, Geburtstage).
   *  Nur was ausdrücklich in den Kalender soll, trägt einen Zustand. */
  syncState?: "offen" | "im-kalender" | "fehlgeschlagen" | "loeschen-offen";
  /** Die echte CalDAV-UID, sobald Hermes sie zurückgemeldet hat. Der Anker
   *  zum Entdoppeln: kommt derselbe Termin über den Export zurück, gewinnt
   *  der exportierte und dieser hier wird nicht mehr gezeigt. */
  calUid?: string;
  /** Warum es beim letzten Mal nicht geklappt hat — sichtbar in der Karte.
   *  Ein stiller Fehlschlag wäre hier das Schlimmste: wer glaubt, ein Termin
   *  stehe im Kalender, obwohl er es nicht tut, ist schlechter dran als vorher. */
  syncFehler?: string;
  /** Fehlversuche. Ab 3 wird `syncState` auf "fehlgeschlagen" gesetzt, damit
   *  ein kaputter Eintrag nicht ewig im Postausgang kreist. */
  syncVersuche?: number;
};

export const KIND_LABEL: Record<EventKind, string> = {
  exam: "Klausur",
  birthday: "Geburtstag",
  deadline: "Deadline",
  note: "Notiz",
};

export const KIND_ICON: Record<EventKind, string> = {
  exam: "📚",
  birthday: "🎂",
  deadline: "⏳",
  note: "📌",
};
