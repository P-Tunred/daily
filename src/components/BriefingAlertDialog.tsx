// Der eine Morgendialog: die kritische Frist UND Hermes' Vorschläge.
//
// WARUM BEIDES IN EINEM FENSTER
// Zwei Unterbrechungen hintereinander sind eine zu viel. Wer zweimal
// wegklicken muss, klickt beim zweiten Mal ohne zu lesen — und irgendwann auch
// beim ersten. Deshalb bekommt der Alert KEINEN eigenen Dialog mehr: er steht
// oben in diesem, die Vorschläge darunter.
//
// WARUM ES DAS ÜBERHAUPT GIBT — UND WARUM SO SELTEN
// Ein Hinweis, der jeden Morgen kommt, wird nach einer Woche weggeklickt, ohne
// gelesen zu werden. Dann geht auch das eine unter, das gezählt hätte. Die
// Begrenzung ist deshalb nicht Höflichkeit, sondern der Kern: höchstens eins
// pro Tag, quittierte kommen nie wieder — beides erzwingt der Server
// (electron/hermesApi.cjs), nicht diese Datei.
//
// WARUM KEIN window.confirm
// Die App läuft in Electron. `alert`, `confirm` und `prompt` halten dort den
// ganzen Renderer an: Timer stehen, der Abgleich pausiert, die Uhr friert ein.
// Ein eigener Dialog kostet ein paar Zeilen mehr und lässt die App weiterlaufen.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBriefing, loadAcknowledged, acknowledgeAlert, fristText, tageBis } from "../lib/briefing";
import { flushSync } from "../lib/sync";
import {
  ladeVorschlaege, entscheide as entscheideVorschlag, quittiereDialog,
  type Vorschlag,
} from "../lib/suggestions";

/** Elemente, die den Fokus aufnehmen können — für die Tab-Falle. */
const FOKUSSIERBAR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function BriefingAlertDialog() {
  const briefing = useBriefing();
  const alert = briefing?.alert;

  // Einmal quittiert, sofort weg — ohne auf den Abgleich zu warten.
  const [quittiert, setQuittiert] = useState<Set<string>>(() => loadAcknowledged());
  // Mit Esc geschlossen: nur für diese Sitzung. Beim nächsten Start steht es
  // wieder da, denn abgehakt hat Paul es ja nicht.
  const [weggeklickt, setWeggeklickt] = useState<Set<string>>(() => new Set());

  // Die Vorschläge kommen vom Server, samt der Auskunft, ob der Dialog heute
  // schon durch ist. Ein Merker im Browserspeicher wäre pro Gerät — Paul
  // bekäme denselben Dialog auf dem Mac und im Browser erneut.
  const [vorschlaege, setVorschlaege] = useState<Vorschlag[]>([]);
  const [dialogErledigt, setDialogErledigt] = useState(true);
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    void ladeVorschlaege().then((z) => {
      if (abgebrochen) return;
      setVorschlaege(z.vorschlaege);
      setDialogErledigt(z.dialogErledigt);
    });
    return () => { abgebrochen = true; };
  }, []);

  const alertOffen = !!alert && !quittiert.has(alert.id) && !weggeklickt.has(alert.id);
  // Gibt es weder Frist noch Vorschläge, erscheint NICHTS. Ein leeres Fenster,
  // das man wegklicken muss, ist die schnellste Art, ein Feature zu verbrennen.
  const offen = !dialogErledigt && (alertOffen || vorschlaege.length > 0);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const vorherFokussiert = useRef<HTMLElement | null>(null);

  /** "Später" und Esc: nur für diese Sitzung weg. Nichts wird entschieden,
   *  nichts quittiert — morgen steht alles wieder da. Wer nicht folgenlos
   *  vertagen kann, klickt irgendwann alles weg, auch die Frist. */
  const schliessen = useCallback(() => {
    if (alert) setWeggeklickt((prev) => new Set(prev).add(alert.id));
    setVorschlaege([]);
  }, [alert]);

  /** "Fertig": für heute durch — auch für die Vorschläge, die unentschieden
   *  blieben. Die kommen morgen wieder, denn entschieden ist nichts. */
  const fertig = useCallback(() => {
    if (alert) { acknowledgeAlert(alert.id); setQuittiert(loadAcknowledged()); flushSync(); }
    void quittiereDialog();
    setDialogErledigt(true);
  }, [alert]);

  const antworte = useCallback(async (id: string, ja: boolean) => {
    setBeschaeftigt(id);
    setFehler(null);
    const r = await entscheideVorschlag(id, ja);
    setBeschaeftigt(null);
    if (!r.ok) { setFehler(r.fehler ?? "Konnte nicht gespeichert werden."); return; }
    setVorschlaege((prev) => prev.filter((v) => v.id !== id));
  }, []);

  // Fokus fangen und zurückgeben. Ohne das landet der Fokus nach dem Schliessen
  // am Seitenanfang, und wer mit der Tastatur arbeitet, sucht seine Stelle neu.
  useEffect(() => {
    if (!offen) return;
    vorherFokussiert.current = document.activeElement as HTMLElement | null;
    const knopf = dialogRef.current?.querySelector<HTMLElement>("[data-verstanden]");
    knopf?.focus();

    function beiTaste(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        schliessen();
        return;
      }
      if (e.key !== "Tab") return;
      const felder = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOKUSSIERBAR) ?? []);
      if (felder.length === 0) return;
      const erstes = felder[0];
      const letztes = felder[felder.length - 1];
      if (e.shiftKey && document.activeElement === erstes) {
        e.preventDefault();
        letztes.focus();
      } else if (!e.shiftKey && document.activeElement === letztes) {
        e.preventDefault();
        erstes.focus();
      }
    }

    document.addEventListener("keydown", beiTaste);
    return () => {
      document.removeEventListener("keydown", beiTaste);
      vorherFokussiert.current?.focus?.();
    };
  }, [offen, schliessen]);

  if (!offen) return null;

  const frist = alert ? fristText(alert.deadline) : null;
  const tage = alert?.deadline ? tageBis(alert.deadline) : null;
  const brennt = tage !== null && tage <= 1;

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 24,
        // Aus dem Thema, nicht fest verdrahtet — siehe --overlay-bg in
        // index.css. Ein dunkler Festwert stand auf dem hellen Papier-Thema als
        // Fremdkörper da und deckte im Glas-Thema den Schreibtisch zu.
        background: "var(--overlay-bg)",
        backdropFilter: "blur(var(--overlay-blur))",
        WebkitBackdropFilter: "blur(var(--overlay-blur))",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) schliessen(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="morgendialog-titel"
        className="glass-strong rounded-card"
        style={{ width: "min(92vw, 480px)", padding: 26, outline: "none" }}
      >
        {/* Die Frist steht oben und NUR wenn es eine gibt. Sonst faengt der
            Dialog direkt mit den Vorschlaegen an — kein leerer Kopfbereich. */}
        {alertOffen && alert ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-3">
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-label)",
                  letterSpacing: "var(--tr-label)",
                  textTransform: "uppercase",
                  color: brennt ? "var(--crit)" : "var(--warn)",
                }}
              >
                Dringend
              </span>
              {frist && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-label)",
                    color: brennt ? "var(--crit)" : "var(--warn)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {frist}
                </span>
              )}
            </div>

            <h2
              id="morgendialog-titel"
              className="font-display font-semibold mb-2"
              style={{ fontSize: 19, lineHeight: 1.3, color: "var(--text-1)" }}
            >
              {alert.title}
            </h2>

            {alert.why && (
              <p className="text-[13.5px] mb-5" style={{ color: "var(--text-2)", lineHeight: 1.6 }}>
                {alert.why}
              </p>
            )}
          </>
        ) : (
          <h2
            id="morgendialog-titel"
            className="font-display font-semibold mb-4"
            style={{ fontSize: 17, lineHeight: 1.3, color: "var(--text-1)" }}
          >
            Kurz durchgehen?
          </h2>
        )}

        {/* Die Vorschlaege. Hoechstens drei — das erzwingt der Server, nicht
            diese Datei (siehe electron/suggestionStore.cjs). */}
        {vorschlaege.length > 0 && (
          <div
            className="flex flex-col gap-3"
            style={alertOffen ? { borderTop: "1px solid var(--line-1)", paddingTop: 16, marginTop: 4 } : undefined}
          >
            {vorschlaege.map((v) => (
              <div key={v.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className="text-[13.5px] font-medium"
                    style={{ color: "var(--text-1)", lineHeight: 1.4, textWrap: "pretty" }}
                  >
                    {v.titel}
                  </p>
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--text-3)", lineHeight: 1.45 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--fs-label)",
                        textTransform: "uppercase",
                        letterSpacing: "var(--tr-label)",
                        color: "var(--text-4)",
                        marginRight: 6,
                      }}
                    >
                      {v.art === "todo" ? "Todo" : "Termin"}
                    </span>
                    {v.warum}
                  </p>
                </div>
                {/* Ja und Nein gleich gross und gleich leicht erreichbar. Waere
                    Nein kleiner, klickte man aus Bequemlichkeit Ja — und der
                    Vorschlag waere damit fuer immer angenommen. */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void antworte(v.id, false)}
                    disabled={beschaeftigt === v.id}
                    aria-label={`Nein zu: ${v.titel}`}
                    className="rounded-full text-[12px] transition-colors disabled:opacity-40"
                    style={{
                      minWidth: 44, minHeight: 32, padding: "6px 12px",
                      color: "var(--text-3)", border: "1px solid var(--line-1)",
                    }}
                  >
                    Nein
                  </button>
                  <button
                    type="button"
                    onClick={() => void antworte(v.id, true)}
                    disabled={beschaeftigt === v.id}
                    aria-label={`Ja zu: ${v.titel}`}
                    className="rounded-full text-[12px] font-display font-medium transition-colors disabled:opacity-40"
                    style={{
                      minWidth: 44, minHeight: 32, padding: "6px 12px",
                      background: "color-mix(in srgb, var(--accent) 18%, transparent)",
                      color: "var(--accent)",
                      border: "1px solid color-mix(in srgb, var(--accent) 38%, transparent)",
                    }}
                  >
                    Ja
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {fehler && (
          <p className="text-[12px] mt-3" style={{ color: "var(--crit)" }} role="alert">
            {fehler}
          </p>
        )}

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={schliessen}
            className="text-[12px] transition-colors"
            style={{ color: "var(--text-3)", minHeight: 40, padding: "0 8px" }}
          >
            Später
          </button>
          <button
            type="button"
            data-verstanden
            onClick={fertig}
            className="rounded-full text-[13px] font-display font-medium transition-colors"
            style={{
              minHeight: 40, padding: "0 18px",
              background: "color-mix(in srgb, var(--accent) 20%, transparent)",
              color: "var(--accent)",
              border: "1px solid color-mix(in srgb, var(--accent) 40%, transparent)",
            }}
          >
            Fertig
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
