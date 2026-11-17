import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Email } from "../types";

// "Posteingang verwalten" — opens from the card's heading. Two jobs the small
// card can't do: act on EVERY current mail (not just the top few), and undo
// sender mutes (the only place they can be taken back).

type Props = {
  mails: Email[];
  mutedSenders: string[];
  /** Opens the per-mail action sheet for one entry. */
  onPick: (mail: Email) => void;
  onUnmuteSender: (sender: string) => void;
  /** Un-hides everything handled from the current report. */
  onRestoreDismissed?: () => void;
  hiddenCount: number;
  onClose: () => void;
};

export function InboxManager({
  mails, mutedSenders, onPick, onUnmuteSender, onRestoreDismissed, hiddenCount, onClose,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Same portal reasoning as MailActions: escape the card's backdrop-filter +
  // overflow-hidden, but stay inside [data-theme] so the palette applies.
  const host = document.querySelector("[data-theme]") ?? document.body;

  return createPortal(
    <div
      className="triage-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Posteingang verwalten"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="triage-modal" style={{ maxWidth: 560 }}>
        <span className="triage-kicker">Posteingang</span>
        <h2 className="triage-title" style={{ fontSize: 20 }}>
          {mails.length} {mails.length === 1 ? "offene Sache" : "offene Sachen"}
        </h2>
        <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
          Antippen, um sie zu erledigen, zu ignorieren oder den Absender stummzuschalten.
        </p>

        <ul className="flex flex-col gap-1" style={{ marginTop: 16 }}>
          {mails.map((m) => (
            <li
              key={m.id}
              role="button"
              tabIndex={0}
              className="digest-row flex items-center gap-2"
              style={{ padding: "8px 10px" }}
              onClick={() => onPick(m)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPick(m);
                }
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate" style={{ fontSize: 13, color: "var(--text-1)" }}>{m.subject}</div>
                <div className="truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-4)" }}>
                  {m.sender}
                </div>
              </div>
              {m.flag && (
                <span
                  style={{
                    flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: 9,
                    letterSpacing: "0.06em", textTransform: "uppercase",
                    color: m.flag === "überfällig" ? "var(--crit)" : "var(--warn)",
                  }}
                >
                  {m.flag}
                </span>
              )}
            </li>
          ))}
          {mails.length === 0 && (
            <li style={{ fontSize: 13, color: "var(--text-3)", padding: "8px 10px" }}>
              Nichts Offenes — alles abgearbeitet.
            </li>
          )}
        </ul>

        {mutedSenders.length > 0 && (
          <div style={{ marginTop: 18, borderTop: "1px solid var(--line-1)", paddingTop: 14 }}>
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em",
                textTransform: "uppercase", color: "var(--text-3)",
              }}
            >
              Stummgeschaltet
            </span>
            <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
              {mutedSenders.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onUnmuteSender(s)}
                  title="Wieder anzeigen"
                  className="rounded-full px-3 py-1"
                  style={{
                    fontSize: 11, color: "var(--text-2)",
                    border: "1px solid var(--line-1)", background: "var(--fill-0)",
                  }}
                >
                  {s} <span style={{ color: "var(--text-4)" }}>✕</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between" style={{ marginTop: 18 }}>
          {hiddenCount > 0 && onRestoreDismissed ? (
            <button
              type="button"
              onClick={onRestoreDismissed}
              className="rounded-full px-3 py-1"
              style={{
                fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em",
                textTransform: "uppercase", color: "var(--text-3)", border: "1px solid var(--line-1)",
              }}
            >
              {hiddenCount} Erledigte zurückholen
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1"
            style={{
              fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "var(--text-3)", border: "1px solid var(--line-1)",
            }}
          >
            Schließen
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}
