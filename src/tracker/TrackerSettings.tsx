import { useMemo, useRef, useState } from "react";
import { useStil } from "../lib/stil";
import { Card } from "../components/Card";
import { useTracker, WEEKDAY_LABELS, WEEKDAY_LABELS_FULL } from "./store";
import { SUBJECT_COLORS } from "./colors";
import { SubjectMark } from "./SubjectDot";
import { exportAllData, importAllData } from "../lib/backup";
import { EPOCH_START } from "../lib/goalHistory";

function formatDateDE(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function TrackerSettings() {
  const g = useStil() === "g";
  const {
    subjects,
    sessions,
    addSubject,
    renameSubject,
    setSubjectColor,
    setSubjectWeeklyHours,
    deleteSubject,
    archiveSubject,
    deleteSession,
    goalsByWeekday,
    setGoalForWeekday,
    setGoalsByWeekday,
    weeklyGoalHours,
    setWeeklyGoalHours,
    wakeTime,
    setWakeTime,
    sleepTime,
    setSleepTime,
    studyStartTime,
    setStudyStartTime,
    goalOverrides,
    clearGoalOverride,
    goalEpochs,
  } = useTracker();

  // ── Backup / Restore (carry data across browser → standalone app) ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupErr, setBackupErr] = useState(false);
  async function handleExport() {
    try {
      await exportAllData();
      setBackupErr(false);
      setBackupMsg("✓ Backup-Datei heruntergeladen.");
      setTimeout(() => setBackupMsg(null), 6000);
    } catch (e) {
      setBackupErr(true);
      setBackupMsg("Fehler beim Export: " + (e as Error).message);
    }
  }
  async function handleImportFile(file: File) {
    try {
      const r = await importAllData(file);
      setBackupErr(false);
      setBackupMsg(`✓ ${r.localStorage + r.indexedDB} Einträge importiert — App lädt neu…`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setBackupErr(true);
      setBackupMsg("Import fehlgeschlagen: " + (e as Error).message);
    }
  }

  // Today's weekday (0=So..6=Sa) for highlighting
  const todayWd = new Date().getDay();
  const weeklyTotal = goalsByWeekday.reduce((a, b) => a + b, 0);
  const wkdSum = goalsByWeekday[1] + goalsByWeekday[2] + goalsByWeekday[3] + goalsByWeekday[4] + goalsByWeekday[5];
  const wkeSum = goalsByWeekday[0] + goalsByWeekday[6];
  // Since when the current targets apply — the seed epoch reaches back before
  // the history existed, so it has no date worth naming.
  const goalCurrentSince = (() => {
    const latest = goalEpochs[goalEpochs.length - 1];
    if (!latest || latest.from === EPOCH_START) return null;
    const [y, m, d] = latest.from.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  // Display order: Mon..Sun (instead of Sun..Sat) — more natural in DE
  const displayOrder: { wd: number; isWeekend: boolean }[] = [
    { wd: 1, isWeekend: false },
    { wd: 2, isWeekend: false },
    { wd: 3, isWeekend: false },
    { wd: 4, isWeekend: false },
    { wd: 5, isWeekend: false },
    { wd: 6, isWeekend: true },
    { wd: 0, isWeekend: true },
  ];

  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Sessions sorted newest-first
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.date.localeCompare(a.date)),
    [sessions],
  );

  const submitNew = () => {
    if (!draft.trim()) return;
    addSubject(draft);
    setDraft("");
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditName(currentName);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) renameSubject(editingId, editName.trim());
    setEditingId(null);
  };

  // Backup und Sessions: im Original unter dem Raster, im Stil G in der linken
  // Spalte unter „Fächer" — sonst steht neben der langen rechten Spalte ein Loch.
  const untereKarten = <>
      {/* ── Daten · Backup & Übertragung ─────────────────────────────────── */}
      <Card title="Daten · Backup & Übertragung" icon="💾">
        <p className="text-[12px] text-fg-secondary leading-snug mb-3">
          Sichert <strong>alle</strong> deine Daten (Sessions, Tagesziele, Wochenplan, Fächer,
          Todos, Klausuren/Termine, Notizen) in eine Datei — oder spielt sie wieder ein.
          So überträgst du deine Daten z.&nbsp;B. vom Browser in die eigenständige Daily-App.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-full px-4 py-2 text-[12px] font-display font-semibold transition-colors"
            style={{ background: "var(--accent)", color: "var(--bg)", border: "none", cursor: "pointer" }}
          >
            ⬇ Exportieren (Backup)
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full px-4 py-2 text-[12px] font-display font-semibold transition-colors"
            style={{ background: "var(--ink-3)", color: "var(--text-2)", border: "1px solid var(--line-1)", cursor: "pointer" }}
          >
            ⬆ Importieren
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImportFile(f);
              e.currentTarget.value = "";
            }}
          />
        </div>
        {backupMsg && (
          <p className="text-[12px] mt-3" style={{ color: backupErr ? "var(--crit)" : "var(--ok)" }}>
            {backupMsg}
          </p>
        )}
        <p className="text-[11px] text-fg-tertiary mt-3 leading-snug">
          So überträgst du: in deiner bisherigen Version <em>Exportieren</em> → in der neuen App
          <em> Importieren</em>. Import ergänzt/überschreibt Einträge mit gleicher ID — nichts geht verloren.
        </p>
      </Card>

      {/* ── Letzte Sessions ─────────────────────────────────────────────── */}
      <Card title="Letzte Sessions" icon="🗂️" meta={`${sessions.length} gesamt`}>
        {sortedSessions.length === 0 ? (
          <p className="text-sm text-fg-tertiary text-center py-6">
            Noch keine Sessions gespeichert.
          </p>
        ) : (
          <ul className="flex flex-col">
            {sortedSessions.map((s) => {
              const subject = subjects.find((x) => x.id === s.subjectId);
              const h = Math.floor(s.durationMin / 60);
              const m = s.durationMin % 60;
              const durationLabel =
                h > 0 ? `${h} h ${m > 0 ? `${m} min` : ""}`.trim() : `${m} min`;
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 py-3 group"
                  style={{ borderBottom: "1px solid var(--line-1)" }}
                >
                  {/* Subject color dot — 3px left accent */}
                  <span
                    className="w-[3px] self-stretch rounded-full shrink-0"
                    style={{ backgroundColor: subject?.color ?? "var(--text-4)" }}
                  />

                  {/* subject + note */}
                  <div className="flex-1 min-w-0">
                    <span className="font-display font-semibold" style={{ fontSize: "13px", color: "var(--text-1)" }}>
                      {subject?.name ?? "Unbekanntes Fach"}
                    </span>
                    {s.note && (
                      <span className="ml-2 truncate" style={{ fontSize: "12px", color: "var(--text-4)" }}>
                        · {s.note}
                      </span>
                    )}
                  </div>

                  {/* duration */}
                  <span className="tabular-nums shrink-0" style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--text-2)" }}>
                    {durationLabel}
                  </span>

                  {/* date */}
                  <span className="tabular-nums shrink-0 text-right w-24" style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-4)" }}>
                    {formatDateDE(s.date)}
                  </span>

                  {/* delete */}
                  <button
                    onClick={() => deleteSession(s.id)}
                    aria-label="Session löschen"
                    className="w-7 h-7 rounded-full shrink-0 text-xs inline-flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none transition-all"
                    style={{ color: "var(--text-4)" }}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
  </>;

  return (
    <div className="flex flex-col gap-6">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <Card title="Fächer" icon="🎓">
          <form
            className="flex items-center gap-2 mb-5"
            onSubmit={(e) => {
              e.preventDefault();
              submitNew();
            }}
          >
            <input
              className="field flex-1"
              placeholder="Neues Fach (z. B. Statistik)"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <button
              type="submit"
              className="rounded-full px-4 py-2 transition-colors focus:outline-none"
              style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: "13px", color: "#0A0C12", background: "var(--accent)" }}
            >
              Hinzufügen
            </button>
          </form>

          {subjects.length === 0 && (
            <p className="py-6 text-center" style={{ fontSize: "13px", color: "var(--text-4)" }}>
              Noch keine Fächer — leg dein erstes oben an.
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {subjects.filter((s) => !s.archiviert).map((s) => (
              <li
                key={s.id}
                className="rounded-[var(--r-md)] p-4"
                style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)" }}
              >
                <div className="flex items-center gap-3">
                  <SubjectMark name={s.name} color={s.color} size="md" />

                  {editingId === s.id ? (
                    <input
                      autoFocus
                      className="field flex-1"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => startRename(s.id, s.name)}
                      className="flex-1 text-left font-display font-semibold transition-colors"
                      style={{ fontSize: "15px", color: "var(--text-1)" }}
                    >
                      {s.name}
                    </button>
                  )}

                  {/* Feste Wochenstunden — nur für Fächer ohne Klausurplan in
                      LearnHarness. Fliesst in das Tagesziel ein: Budget aus der
                      Wochenzeile als Obergrenze, das hier als Teil des Bedarfs. */}
                  <label
                    className="h-8 px-2 rounded-full text-xs inline-flex items-center gap-1"
                    style={{ color: "var(--text-3)", border: "1px solid var(--line-1)" }}
                    title="Lernzeit pro Woche für ein Fach ohne Klausurplan — zählt ins Tagesziel"
                  >
                    <input
                      type="number"
                      min={0}
                      max={60}
                      step={0.5}
                      inputMode="decimal"
                      aria-label={`Stunden pro Woche für ${s.name} (ohne Klausurplan)`}
                      value={s.stundenProWoche ?? ""}
                      placeholder="–"
                      onChange={(e) => setSubjectWeeklyHours(s.id, e.target.value === "" ? undefined : Number(e.target.value))}
                      className="w-10 bg-transparent text-right outline-none tabular-nums"
                      style={{ color: "var(--text-1)" }}
                    />
                    h/Woche
                  </label>

                  {/* Archivieren steht VOR dem Löschen und ist der leisere,
                      fast immer richtige Weg: am Semesterende ist das Fach
                      vorbei, die Stunden sind es nicht. Löschen nimmt die
                      Sitzungen mit — deshalb hier die zweite Wahl. */}
                  <button
                    onClick={() => archiveSubject(s.id, true)}
                    aria-label="Fach archivieren"
                    title="Aus der Auswahl nehmen — Statistik und Verlauf bleiben"
                    className="h-8 px-3 rounded-full text-xs transition-colors inline-flex items-center justify-center focus:outline-none"
                    style={{ color: "var(--text-4)", border: "1px solid var(--line-1)" }}
                  >
                    Archivieren
                  </button>

                  {/* Das ✕ fragt zuerst nach dem Archivieren. Am 2026-10-24
                      wurde Statistik hier gelöscht — mit 136 Sitzungen, rund
                      102 h Lernzeit, die danach in Verlauf, Score und
                      Lernbericht fehlten. Die alte Warnung nannte keine Zahl;
                      „Sessions werden mitgelöscht" klingt nach wenig. */}
                  <button
                    onClick={() => {
                      const eigene = sessions.filter((x) => x.subjectId === s.id);
                      if (eigene.length === 0) {
                        if (confirm(`„${s.name}" löschen?`)) deleteSubject(s.id);
                        return;
                      }
                      const min = eigene.reduce((a, x) => a + x.durationMin, 0);
                      const umfang = `${eigene.length} Sitzung${eigene.length === 1 ? "" : "en"}, ${Math.floor(min / 60)} h ${min % 60} min`;
                      if (confirm(`„${s.name}" hat ${umfang} Lernzeit.\n\nStattdessen archivieren? Das Fach verschwindet aus der Auswahl, die Stunden bleiben in Verlauf und Score.\n\nOK = archivieren · Abbrechen = weiter zum Löschen`)) {
                        archiveSubject(s.id, true);
                        return;
                      }
                      if (confirm(`Wirklich löschen? ${umfang} Lernzeit gehen unwiderruflich verloren.`)) {
                        deleteSubject(s.id);
                      }
                    }}
                    aria-label="Fach löschen"
                    className="w-8 h-8 rounded-full text-xs transition-colors inline-flex items-center justify-center focus:outline-none"
                    style={{ color: "var(--text-4)" }}
                  >
                    ✕
                  </button>
                </div>

                {/* Color picker */}
                <div className="mt-3 flex flex-wrap gap-2 pt-3" style={{ borderTop: "1px solid var(--line-1)" }}>
                  {SUBJECT_COLORS.map((c) => {
                    const active = c === s.color;
                    return (
                      <button
                        key={c}
                        onClick={() => setSubjectColor(s.id, c)}
                        aria-label={`Farbe wählen`}
                        aria-pressed={active}
                        className="transition-all duration-150 focus:outline-none"
                        style={{
                          width: "20px",
                          height: "20px",
                          borderRadius: "9999px",
                          backgroundColor: c,
                          transform: active ? "scale(1.2)" : undefined,
                          boxShadow: active ? `0 0 0 2px var(--ink-3), 0 0 0 3.5px ${c}` : undefined,
                          opacity: active ? 1 : 0.7,
                        }}
                      />
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>

          {/* Archivierte Faecher. Sie stehen weiterhin in Statistik, Kalender
              und Verlauf — nur neue Sitzungen kann man auf ihnen nicht mehr
              starten. Sichtbar, damit "archiviert" nicht heimlich "weg" heisst. */}
          {subjects.some((s) => s.archiviert) && (
            <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--line-1)" }}>
              <p
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-label)",
                  letterSpacing: "var(--tr-label)",
                  textTransform: "uppercase",
                  color: "var(--text-4)",
                  margin: "0 0 10px",
                }}
              >
                Archiviert — zählt weiter in der Statistik
              </p>
              <ul className="flex flex-col gap-2">
                {subjects.filter((s) => s.archiviert).map((s) => {
                  const min = sessions
                    .filter((x) => x.subjectId === s.id)
                    .reduce((a, x) => a + (x.durationMin || 0), 0);
                  return (
                    <li key={s.id} className="flex items-center gap-3">
                      <SubjectMark name={s.name} color={s.color} size="md" />
                      <span className="flex-1" style={{ fontSize: "14px", color: "var(--text-3)" }}>
                        {s.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: "11px",
                          fontVariantNumeric: "tabular-nums",
                          color: "var(--text-4)",
                        }}
                      >
                        {Math.round((min / 60) * 10) / 10} h
                      </span>
                      <button
                        onClick={() => archiveSubject(s.id, false)}
                        className="h-8 px-3 rounded-full text-xs transition-colors inline-flex items-center justify-center focus:outline-none"
                        style={{ color: "var(--text-4)", border: "1px solid var(--line-1)" }}
                      >
                        Zurückholen
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
        {g && <div className="flex flex-col gap-6 mt-6">{untereKarten}</div>}
      </div>

      <div className="flex flex-col gap-5">
        <Card title="Tagesziele pro Wochentag" icon="🎯">
          <div className="flex items-end justify-between mb-4">
            <p className="text-sm text-fg-secondary leading-snug">
              Wie viele Minuten willst du an jedem Tag lernen?<br />
              <span className="text-fg-tertiary text-xs">Die KI passt Empfehlungen entsprechend an.</span>
            </p>
            <div className="text-right shrink-0">
              <div className="metric tabular-nums" style={{ fontSize: "26px", color: "var(--text-1)", letterSpacing: "-0.02em" }}>
                {Math.round(weeklyTotal / 60 * 10) / 10}h
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-4)" }}>
                Wochenziel
              </div>
            </div>
          </div>

          {/* 7-day grid */}
          <div className="flex flex-col gap-2.5">
            {displayOrder.map(({ wd }) => {
              const min = goalsByWeekday[wd] ?? 0;
              const isToday = wd === todayWd;
              // One accent across the week: weekend rows read as the same
              // system as Mo-Fr instead of switching to purple.
              const accent = "var(--accent)";
              return (
                <div
                  key={wd}
                  className="flex items-center gap-3 rounded-[var(--r-md)] p-3"
                  style={{
                    background: isToday ? "color-mix(in srgb, var(--accent) 8%, var(--ink-3))" : "var(--ink-3)",
                    border: `1px solid ${isToday ? "color-mix(in srgb, var(--accent) 35%, transparent)" : "var(--line-1)"}`,
                  }}
                >
                  {/* Day label */}
                  <div className="w-14 shrink-0 flex flex-col">
                    <span
                      className="font-display font-semibold leading-none"
                      style={{ fontSize: "14px", color: isToday ? "var(--text-1)" : "var(--text-2)" }}
                    >
                      {WEEKDAY_LABELS[wd]}
                    </span>
                    {isToday && (
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--accent)", marginTop: 2 }}>
                        Heute
                      </span>
                    )}
                  </div>

                  {/* Slider */}
                  <input
                    type="range"
                    min={0}
                    max={480}
                    step={15}
                    value={min}
                    onChange={(e) => setGoalForWeekday(wd, Number(e.target.value))}
                    className="ios-range flex-1"
                    style={{ "--val": `${(min / 480) * 100}%`, "--accent": accent } as React.CSSProperties}
                  />

                  {/* Numeric value */}
                  <div className="w-16 text-right tabular-nums shrink-0">
                    <span className="font-mono" style={{ fontSize: "13px", color: min > 0 ? "var(--text-1)" : "var(--text-4)" }}>
                      {min === 0 ? "—" : `${min}m`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick presets */}
          <div className="mt-4 pt-4 flex flex-wrap gap-2" style={{ borderTop: "1px solid var(--line-1)" }}>
            <span className="text-xs text-fg-tertiary mr-1 self-center">Schnell:</span>
            <button
              onClick={() => setGoalsByWeekday([180, 120, 120, 120, 120, 120, 180])}
              className="rounded-full px-3 py-1.5 transition-colors text-xs font-display font-semibold"
              style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)", color: "var(--text-2)" }}
            >
              Standard (2h / 3h)
            </button>
            <button
              onClick={() => setGoalsByWeekday([240, 90, 90, 90, 90, 90, 240])}
              className="rounded-full px-3 py-1.5 transition-colors text-xs font-display font-semibold"
              style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)", color: "var(--text-2)" }}
            >
              Wochenend-Fokus (1.5h / 4h)
            </button>
            <button
              onClick={() => setGoalsByWeekday([120, 120, 120, 120, 120, 120, 120])}
              className="rounded-full px-3 py-1.5 transition-colors text-xs font-display font-semibold"
              style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)", color: "var(--text-2)" }}
            >
              Gleichmäßig (2h)
            </button>
            <button
              onClick={() => setGoalsByWeekday([0, 0, 0, 0, 0, 0, 0])}
              className="rounded-full px-3 py-1.5 transition-colors text-xs font-display font-semibold"
              style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)", color: "var(--text-4)" }}
            >
              Zurücksetzen
            </button>
          </div>

          {/* Summary */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-[var(--r-md)] p-3 text-center" style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)" }}>
              <div className="font-mono tabular-nums" style={{ fontSize: "18px", color: "var(--text-1)" }}>{Math.round(wkdSum / 60 * 10) / 10}h</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-4)", marginTop: 2 }}>Mo–Fr gesamt</div>
            </div>
            <div className="rounded-[var(--r-md)] p-3 text-center" style={{ background: "var(--ink-3)", border: "1px solid var(--line-1)" }}>
              <div className="font-mono tabular-nums" style={{ fontSize: "18px", color: "var(--text-1)" }}>{Math.round(wkeSum / 60 * 10) / 10}h</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-4)", marginTop: 2 }}>Sa+So gesamt</div>
            </div>
          </div>

          {(wkeSum > wkdSum / 5) && (
            <p className="mt-3 text-xs leading-snug" style={{ color: "var(--text-3)" }}>
              ✓ KI weiß: am Wochenende hast du mehr Zeit — Empfehlungen werden entsprechend angepasst.
            </p>
          )}

          {/* The whole point of the goal history, said out loud — otherwise
              raising the target still feels like it might cost the streak. */}
          <p
            className="mt-3 pt-3 text-xs leading-snug"
            style={{ color: "var(--text-3)", borderTop: "1px solid var(--line-1)" }}
          >
            Änderungen gelten <strong style={{ color: "var(--text-2)" }}>ab heute</strong>. Vergangene Tage
            behalten ihr damaliges Ziel — Streak und Quote bleiben, egal wie oft du das Wochenziel neu setzt.
            {goalCurrentSince && ` Aktuelle Ziele gelten seit ${goalCurrentSince}.`}
          </p>
        </Card>

        <Card title="Heutiges Ziel" icon="📅">
          <div className="rounded-[var(--r-md)] p-5 text-center" style={{ background: "var(--ink-3)" }}>
            <div className="metric tabular-nums" style={{ fontSize: "48px", color: "var(--accent)" }}>
              {goalsByWeekday[todayWd] || "—"}
            </div>
            <div className="mt-1" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-4)" }}>
              Min · {WEEKDAY_LABELS_FULL[todayWd]}
            </div>
          </div>

          {/* Aktien-Widget Toggle */}
          <ShowStocksToggle />
        </Card>

        <Card title="Tagesrhythmus" icon="☀️">
          <p className="text-[12px] text-fg-tertiary leading-snug mb-4">
            Jarvis nutzt diese Werte für realistische Tagespläne und Empfehlungen.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-1.5">Aufstehen</p>
              <input
                type="time"
                value={wakeTime}
                onChange={(e) => setWakeTime(e.target.value)}
                className="field w-full text-center"
                style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}
              />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-1.5">Lernbeginn</p>
              <input
                type="time"
                value={studyStartTime}
                onChange={(e) => setStudyStartTime(e.target.value)}
                className="field w-full text-center"
                style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}
              />
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-1.5">Schlafen</p>
              <input
                type="time"
                value={sleepTime}
                onChange={(e) => setSleepTime(e.target.value)}
                className="field w-full text-center"
                style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}
              />
            </div>
          </div>
          <p className="text-[11px] text-fg-tertiary leading-snug mb-5">
            „Lernbeginn" = frühester Zeitpunkt, ab dem Jarvis automatisch Lernblöcke einplant.
            So landet nichts mehr direkt nach dem Aufwachen — die genaue Lage lernt er aus deinen echten Sessions.
          </p>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-fg-tertiary mb-1.5">Wochenziel</p>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={168}
                step={1}
                value={weeklyGoalHours}
                onChange={(e) => setWeeklyGoalHours(parseInt(e.target.value, 10) || 0)}
                className="field w-20 text-center"
                style={{ fontFamily: "var(--font-mono)", fontSize: "16px" }}
              />
              <span className="text-fg-secondary text-sm">h pro Woche</span>
              <span className="text-fg-tertiary text-xs ml-auto">
                ≈ {Math.round((weeklyGoalHours * 60) / 7 / 60 * 10) / 10}h/Tag Heatmap-Ref
              </span>
            </div>
          </div>
        </Card>

        {Object.keys(goalOverrides).length > 0 && (
          <Card title="Aktive Override-Tage" icon="📌">
            <p className="text-[11px] text-fg-tertiary mb-3 leading-snug">
              Tage mit angepasstem Ziel (von dir oder Jarvis gesetzt). „×" klicken um zurück zum Wochentag-Standard.
            </p>
            <ul className="flex flex-col gap-1.5">
              {Object.entries(goalOverrides)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([iso, min]) => {
                  const d = new Date(iso);
                  const label = d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short" });
                  const past = d < new Date(new Date().setHours(0,0,0,0));
                  return (
                    <li
                      key={iso}
                      className="flex items-center gap-2 px-3 py-2 rounded-[var(--r-sm)]"
                      style={{ background: "var(--ink-3)", opacity: past ? 0.5 : 1 }}
                    >
                      <span className="font-mono text-[11px] uppercase tracking-wider text-fg-tertiary w-16 shrink-0">{label}</span>
                      <span className="metric text-[14px] tabular-nums" style={{ color: "var(--accent)" }}>
                        {min} <span className="text-fg-tertiary text-xs">min</span>
                      </span>
                      <button
                        onClick={() => clearGoalOverride(iso)}
                        className="ml-auto w-6 h-6 rounded-full text-xs text-fg-tertiary hover:text-fg hover:bg-white/10 transition-colors"
                        title="Override entfernen"
                      >
                        ✕
                      </button>
                    </li>
                  );
                })}
            </ul>
          </Card>
        )}
      </div>
    </div>

      {!g && untereKarten}
    </div>
  );
}

// ── Show-Stocks toggle (Dashboard "Aktien"/Portfolio card) ───────────────────

const SHOW_STOCKS_KEY = "morning.showStocks";

function ShowStocksToggle() {
  const [enabled, setEnabledState] = useState(() => {
    try { return localStorage.getItem(SHOW_STOCKS_KEY) === "on"; }
    catch { return false; }
  });

  function setEnabled(v: boolean) {
    setEnabledState(v);
    try {
      localStorage.setItem(SHOW_STOCKS_KEY, v ? "on" : "off");
      // Notify same-tab listeners (DashboardPage) — storage event only fires
      // across tabs, so emit a custom event for the local tab.
      window.dispatchEvent(new Event("morning:settings-change"));
    } catch { /* quota */ }
  }

  return (
    <div className="mt-4 pt-3 border-t border-white/[0.05] flex items-center justify-between">
      <div className="flex-1">
        <p className="font-display font-medium text-[13px] text-fg">Portfolio anzeigen</p>
        <p className="text-[11px] text-fg-tertiary mt-0.5 leading-snug">
          Blendet das Aktien-Widget am unteren Ende des Dashboards ein. Standard: aus — der Wochenplan ersetzt es als primäres Planungs-Werkzeug.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={() => setEnabled(!enabled)}
        className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ml-3"
        style={{ background: enabled ? "var(--accent)" : "rgba(255,255,255,0.12)" }}
      >
        <span
          className="inline-block h-5 w-5 transform rounded-full bg-white transition-transform"
          style={{ transform: enabled ? "translateX(22px)" : "translateX(2px)" }}
        />
      </button>
    </div>
  );
}

