import { useEffect } from "react";
import { createPortal } from "react-dom";

// The action sheet that opens when a mail / digest card is clicked. Three
// decisions, deliberately phrased the way Paul thinks about them:
//   · "Erledigt"        — done, take it off the list
//   · "Ignorieren"      — wasn't important, take it off the list
//   · "… künftig nicht" — mute the sender so future mails never show up
// The first two hide the same way (the seen-store); the third also writes a
// forward-looking mute. Nothing is ever deleted in the mailbox itself.

export type MailActionTarget = {
  /** Mail ids behind this entry — a digest card can carry several. */
  ids: string[];
  title: string;
  /** The one next step, if the digest suggested one. */
  action?: string;
  /** Distinct sender names, for the mute option. */
  senders: string[];
  deadline?: string | null;
};

type Props = {
  target: MailActionTarget;
  onDone: (ids: string[]) => void;
  onIgnore: (ids: string[]) => void;
  onMuteSender: (sender: string, ids: string[]) => void;
  onClose: () => void;
};

const rowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  padding: "11px 14px",
  borderRadius: "var(--r-md)",
  border: "1px solid var(--line-1)",
  background: "var(--ink-3)",
  color: "var(--text-1)",
  fontSize: 13,
  transition: "background var(--dur-micro), border-color var(--dur-micro)",
};

export function MailActions({ target, onDone, onIgnore, onMuteSender, onClose }: Props) {
  // Escape closes — same reflex as the settings panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { ids, title, action, senders } = target;

  // Portal out of the Posteingang card: it carries backdrop-filter (which makes
  // it a containing block for position:fixed) AND overflow-hidden, so rendering
  // in place trapped the overlay inside the card and clipped it away.
  // Target the app-shell (the [data-theme] element), NOT <body> — the theme's
  // CSS variables live there, and a body-level portal rendered dark-on-light.
  const host = document.querySelector("[data-theme]") ?? document.body;
  return createPortal(
    <div
      className="triage-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Was tun mit dieser Mail?"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="triage-modal" style={{ maxWidth: 420, padding: 24 }}>
        <span className="triage-kicker">Was tun damit?</span>
        <h2
          className="font-display"
          style={{ fontSize: 17, fontWeight: 600, color: "var(--text-1)", lineHeight: 1.3, margin: "8px 0 0" }}
        >
          {title}
        </h2>
        {action && (
          <p style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6, lineHeight: 1.45 }}>→ {action}</p>
        )}

        <div className="flex flex-col gap-2" style={{ marginTop: 18 }}>
          <button type="button" style={rowBtn} data-sound="confirm" onClick={() => onDone(ids)}>
            <span aria-hidden="true" style={{ color: "var(--ok)", fontSize: 14 }}>✓</span>
            <span className="flex-1">Erledigt</span>
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>aus der Liste</span>
          </button>

          <button type="button" style={rowBtn} data-sound="dismiss" onClick={() => onIgnore(ids)}>
            <span aria-hidden="true" style={{ color: "var(--text-3)", fontSize: 14 }}>✕</span>
            <span className="flex-1">Ignorieren</span>
            <span style={{ fontSize: 11, color: "var(--text-4)" }}>war nicht wichtig</span>
          </button>

          {senders.map((s) => (
            <button
              key={s}
              type="button"
              style={rowBtn}
              data-sound="dismiss"
              onClick={() => onMuteSender(s, ids)}
              title={`Künftige Mails von ${s} werden nicht mehr angezeigt`}
            >
              <span aria-hidden="true" style={{ color: "var(--warn)", fontSize: 13 }}>🔕</span>
              <span className="flex-1 truncate">
                {s} <span style={{ color: "var(--text-3)" }}>künftig nicht mehr</span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between" style={{ marginTop: 16 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-4)" }}>
            {ids.length > 1 ? `${ids.length} Mails` : "1 Mail"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1"
            style={{
              fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em",
              textTransform: "uppercase", color: "var(--text-3)", border: "1px solid var(--line-1)",
            }}
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}
