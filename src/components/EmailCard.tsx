import { useState } from "react";
import type { Email } from "../types";
import type { TriageSummary, SummaryCard } from "../lib/triage";
import { Card } from "./Card";
import { MailActions, type MailActionTarget } from "./MailActions";
import { InboxManager } from "./InboxManager";

type Props = {
  emails: Email[] | null;
  /** Grouped daily action digest. When present (and non-empty) it REPLACES the
   *  raw mail list — the whole point is a synthesis, not another list. The raw
   *  list stays as the fallback for before the first synthesis / on AI failure,
   *  so a populated report never renders blank. */
  summary?: TriageSummary | null;
  loading: boolean;
  error: string | null;
  /** Marks a raw-list item handled so it stops occupying a slot. Only used in
   *  the fallback list view — the digest is a full-report summary, not a queue. */
  onDismiss?: (id: string) => void;
  /** When the upstream mail report was generated — surfaces how fresh the
   *  data is, so "why don't my mails update" is answerable at a glance. */
  updatedAt?: string | null;
  /** Newest mail actually IN the report — can lag far behind updatedAt when
   *  the upstream generator re-runs on frozen mailbox data. */
  newestMailAt?: string | null;
  /** How many of the report's items are hidden because they were handled. */
  hiddenCount?: number;
  /** Un-hides them — the escape hatch when "Fertig" was clicked too eagerly. */
  onRestoreDismissed?: () => void;
  /** Mutes a sender so future mails from them never surface. Enables the
   *  third option in the click-through action sheet. */
  onMuteSender?: (sender: string, ids: string[]) => void;
  /** Currently muted senders + the way back — surfaced in the manage view,
   *  which is the only place a mute can be undone. */
  mutedSenders?: string[];
  onUnmuteSender?: (sender: string) => void;
};

const MAX_VISIBLE = 5;

// "Jetzt dran" first, then this week, then the overdue drawer last — the whole
// value is separating what needs action now from stale carry-over. Color is
// semantic: red = act now, amber = this week, muted = probably-already-done.
const BUCKET_META: Record<SummaryCard["bucket"], { label: string; color: string }> = {
  jetzt: { label: "Jetzt dran", color: "var(--crit)" },
  woche: { label: "Diese Woche", color: "var(--warn)" },
  altlast: { label: "Altlasten", color: "var(--text-4)" },
};
const BUCKET_ORDER: SummaryCard["bucket"][] = ["jetzt", "woche", "altlast"];

function fmtStand(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${time}`;
}

/** A digest deadline, phrased for urgency at a glance. */
function fmtDeadline(d: string): { text: string; overdue: boolean } | null {
  const dt = new Date(d + "T00:00:00");
  if (Number.isNaN(dt.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((dt.getTime() - today.getTime()) / 86_400_000);
  const dm = `${String(dt.getDate()).padStart(2, "0")}.${String(dt.getMonth() + 1).padStart(2, "0")}.`;
  if (days < 0) return { text: `${dm} · überfällig`, overdue: true };
  if (days === 0) return { text: "heute", overdue: true };
  if (days === 1) return { text: "morgen", overdue: false };
  if (days <= 6) return { text: `in ${days} Tagen · ${dm}`, overdue: false };
  return { text: dm, overdue: false };
}

function DigestCard({ card, onOpen }: { card: SummaryCard; onOpen?: (c: SummaryCard) => void }) {
  const meta = BUCKET_META[card.bucket];
  const dl = card.deadline ? fmtDeadline(card.deadline) : null;
  const sourceLine = card.sources
    .map((s) => (s.when ? `${s.sender} · ${s.when}` : s.sender))
    .filter(Boolean)
    .join("   ·   ");
  return (
    <li
      className={"flex flex-col gap-1" + (onOpen ? " digest-row" : "")}
      style={{ paddingLeft: "10px", borderLeft: `2px solid ${meta.color}` }}
      {...(onOpen
        ? {
            role: "button" as const,
            tabIndex: 0,
            title: "Klicken: erledigt, ignorieren oder Absender stummschalten",
            onClick: () => onOpen(card),
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen(card);
              }
            },
          }
        : {})}
    >
      <div className="flex items-start gap-2">
        <span
          className="font-display font-semibold flex-1 min-w-0"
          style={{ fontSize: "13px", color: "var(--text-1)", lineHeight: 1.3 }}
        >
          {card.title}
        </span>
        {card.mailCount > 1 && (
          <span
            title={`${card.mailCount} Mails zu diesem Vorgang zusammengefasst`}
            style={{
              fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-4)",
              border: "1px solid var(--line-1)", borderRadius: "999px", padding: "1px 6px", whiteSpace: "nowrap",
            }}
          >
            {card.mailCount}×
          </span>
        )}
        {dl && (
          <span
            style={{
              fontFamily: "var(--font-mono)", fontSize: "10px", whiteSpace: "nowrap",
              color: dl.overdue ? "var(--crit)" : "var(--text-3)",
            }}
          >
            {dl.text}
          </span>
        )}
      </div>
      {card.action && (
        <p className="leading-snug" style={{ fontSize: "12px", color: "var(--text-2)" }}>
          → {card.action}
        </p>
      )}
      {sourceLine && (
        <p className="truncate" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-4)" }}>
          {sourceLine}
        </p>
      )}
    </li>
  );
}

function Digest({ summary, onOpen }: { summary: TriageSummary; onOpen?: (c: SummaryCard) => void }) {
  const groups = BUCKET_ORDER
    .map((bucket) => ({ bucket, cards: summary.cards.filter((c) => c.bucket === bucket) }))
    .filter((g) => g.cards.length > 0);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.bucket} className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span style={{ width: 6, height: 6, borderRadius: "999px", background: BUCKET_META[g.bucket].color }} />
            <span
              style={{
                fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.08em",
                textTransform: "uppercase", color: "var(--text-3)",
              }}
            >
              {BUCKET_META[g.bucket].label}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-4)" }}>
              {g.cards.length}
            </span>
          </div>
          <ul className="flex flex-col gap-3">
            {g.cards.map((c) => (
              <DigestCard key={c.id} card={c} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function EmailCard({
  emails,
  summary,
  loading,
  error,
  onDismiss,
  updatedAt,
  newestMailAt,
  hiddenCount = 0,
  onRestoreDismissed,
  onMuteSender,
  mutedSenders = [],
  onUnmuteSender,
}: Props) {
  const [target, setTarget] = useState<MailActionTarget | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  const list = emails ?? [];
  const visible = list.slice(0, MAX_VISIBLE);
  const hidden = list.length - visible.length;
  const stand = updatedAt ? fmtStand(updatedAt) : null;
  const newest = newestMailAt ? fmtStand(newestMailAt) : null;
  const showDigest = !!summary && summary.cards.length > 0;
  const count = showDigest ? summary!.cards.length : list.length;
  const meta = stand ? `${count} · Stand ${stand}` : `${count}`;

  // The action sheet only makes sense when there's something to act on —
  // without a dismiss handler the card is a read-only view.
  const canAct = !!onDismiss;
  const openCard = (c: SummaryCard) =>
    setTarget({
      ids: c.sourceIds,
      title: c.title,
      action: c.action,
      senders: [...new Set(c.sources.map((s) => s.sender).filter(Boolean))],
      deadline: c.deadline,
    });
  const openMail = (m: Email) =>
    setTarget({
      ids: [m.id],
      title: m.subject,
      action: m.snippet || undefined,
      senders: m.sender ? [m.sender] : [],
    });
  const close = () => setTarget(null);
  const hideIds = (ids: string[]) => {
    ids.forEach((id) => onDismiss?.(id));
    close();
  };

  return (
    <Card
      title="Posteingang"
      icon="✉️"
      meta={meta}
      onTitleClick={canAct ? () => setManageOpen(true) : undefined}
    >
      {loading && <p className="text-sm" style={{ color: "var(--text-4)" }}>Lade…</p>}
      {error && (
        <p className="text-sm" style={{ color: "var(--crit)" }}>Posteingang nicht erreichbar.</p>
      )}

      {!loading && !error && showDigest && (
        <Digest summary={summary!} onOpen={canAct ? openCard : undefined} />
      )}

      {!loading && !error && !showDigest && (
        <>
          {list.length === 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm" style={{ color: "var(--text-4)" }}>
                {hiddenCount > 0
                  ? `Alles sortiert — die ${hiddenCount} offenen hast du schon abgehakt.`
                  : "Nichts Offenes im Report — selten und schön."}
              </p>
              {newest && (
                <p style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-4)" }}>
                  Neueste Mail im Report: {newest}
                </p>
              )}
              {hiddenCount > 0 && onRestoreDismissed && (
                <button
                  type="button"
                  onClick={onRestoreDismissed}
                  className="self-start rounded-full px-3 py-1 transition-colors"
                  style={{
                    fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.06em",
                    textTransform: "uppercase", color: "var(--text-3)", border: "1px solid var(--line-1)",
                  }}
                >
                  Erledigte wieder anzeigen
                </button>
              )}
            </div>
          )}
          <ul className="flex flex-col gap-3">
            {visible.map((m) => (
              <li
                key={m.id}
                className={"flex flex-col gap-0.5 pb-3" + (canAct ? " digest-row" : "")}
                style={{ borderBottom: "1px solid var(--line-1)" }}
                {...(canAct
                  ? {
                      role: "button" as const,
                      tabIndex: 0,
                      title: "Klicken: erledigt, ignorieren oder Absender stummschalten",
                      onClick: () => openMail(m),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openMail(m);
                        }
                      },
                    }
                  : {})}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="font-display font-semibold truncate flex-1 min-w-0"
                    style={{ fontSize: "13px", color: "var(--text-1)" }}
                  >
                    {m.sender}
                  </span>
                  {m.flag && (
                    <span
                      style={{
                        flexShrink: 0,
                        fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: m.flag === "überfällig" ? "var(--crit)" : "var(--warn)",
                      }}
                    >
                      {m.flag}
                    </span>
                  )}
                  {m.starred && !m.flag && (
                    <span aria-label="markiert" style={{ color: "var(--warn)", fontSize: "12px" }}>
                      ★
                    </span>
                  )}
                  {onDismiss && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation(); // the row itself opens the action sheet
                        onDismiss(m.id);
                      }}
                      title="Schon erledigt — ausblenden"
                      aria-label={`"${m.subject}" als erledigt ausblenden`}
                      className="shrink-0 rounded-full transition-colors"
                      style={{ fontSize: "11px", color: "var(--text-4)", lineHeight: 1, padding: "2px 4px" }}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="truncate" style={{ fontSize: "13px", color: "var(--text-2)" }}>
                  {m.subject}
                </div>
                <p className="line-clamp-2 leading-snug" style={{ fontSize: "12px", color: "var(--text-3)" }}>
                  {m.snippet}
                </p>
              </li>
            ))}
          </ul>
          {hidden > 0 && (
            <p className="mt-3 text-center" style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-4)" }}>
              +{hidden} weitere
            </p>
          )}
        </>
      )}

      {manageOpen && (
        <InboxManager
          mails={list}
          mutedSenders={mutedSenders}
          onPick={openMail}
          onUnmuteSender={(s) => onUnmuteSender?.(s)}
          onRestoreDismissed={onRestoreDismissed}
          hiddenCount={hiddenCount}
          onClose={() => setManageOpen(false)}
        />
      )}

      {target && (
        <MailActions
          target={target}
          onDone={hideIds}
          onIgnore={hideIds}
          onMuteSender={(sender, ids) => {
            onMuteSender?.(sender, ids);
            close();
          }}
          onClose={close}
        />
      )}
    </Card>
  );
}
