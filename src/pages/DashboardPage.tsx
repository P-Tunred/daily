import { useEffect, useMemo, useState } from "react";
import { HeuteJarvis } from "../components/HeuteJarvis";
import { MorningTriage } from "../components/MorningTriage";
import { CalendarPlanner } from "../components/CalendarPlanner";
import { EmailCard } from "../components/EmailCard";
import { StockCard } from "../components/StockCard";
import { WeatherCard } from "../components/WeatherCard";
import { WeekPlanCard } from "../components/WeekPlanCard";
import { UsageCard } from "../components/UsageCard";
import { RejectStrip } from "../components/RejectStrip";
import { KanalHinweis } from "../components/KanalHinweis";
import { VorlaufCard } from "../components/VorlaufCard";
import { TagesTermineDialog } from "../components/TagesTermineDialog";
import { GapsCard } from "../components/GapsCard";
import { SubscriptionsCard } from "../components/SubscriptionsCard";
import { Reveal } from "../components/Reveal";
import { useMorningData } from "../hooks/useMorningData";
import { useHiddenEventIds, isEventHidden } from "../lib/hiddenEvents";
import { fetchTriage, triageToEmail, type TriageSummary } from "../lib/triage";
import { loadSeenTriageIds, markTriageSeen, unmarkTriageSeen, TRIAGE_SEEN_CHANGE_EVENT } from "../lib/triageSeen";
import { loadMutedSenders, muteSender, unmuteSender, isSenderMuted, TRIAGE_MUTES_CHANGE_EVENT } from "../lib/triageMutes";
import type { Email } from "../types";
import { BrainQuestionCard } from "../components/BrainQuestionCard";
import { BewusstCard } from "../components/BewusstCard";
import { GProjekte } from "../components/g/GProjekte";
import { useStil } from "../lib/stil";

const SHOW_STOCKS_KEY = "morning.showStocks";

function loadShowStocks(): boolean {
  try { return localStorage.getItem(SHOW_STOCKS_KEY) === "on"; }
  catch { return false; }
}

export function DashboardPage() {
  const { events, upcoming } = useMorningData();
  const [showStocks, setShowStocks] = useState<boolean>(() => loadShowStocks());
  const stil = useStil();

  // Real inbox: the most important mails from the daily Drive report, served
  // live via /api/triage. Polled — the app stays open for hours, a single
  // fetch on mount would show yesterday's mails until a restart.
  // No other source: the old MOCK_EMAILS fallback showed convincing-looking
  // FAKE mail whenever the real list ran empty — worse than an empty card.
  const [triageMails, setTriageMails] = useState<Email[] | null>(null);
  // Grouped daily digest — replaces the raw list in the Posteingang card when
  // present. Independent of the client seen-store: it's a full-report summary
  // regenerated each morning, so it doesn't go blank as mails get dismissed.
  const [triageSummary, setTriageSummary] = useState<TriageSummary | null>(null);
  const [triageUpdatedAt, setTriageUpdatedAt] = useState<string | null>(null);
  const [newestMailAt, setNewestMailAt] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchTriage().then(({ items, summary, reportUpdatedAt, newestMailAt: newest }) => {
        if (!alive) return;
        setTriageMails(items.map(triageToEmail));
        setTriageSummary(summary);
        setTriageUpdatedAt(reportUpdatedAt);
        setNewestMailAt(newest);
      });
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Items already handled (committed or discarded in the morning triage
  // dialog, or dismissed right here) drop out — otherwise an old item with
  // the nearest deadline sits at the top forever and newer mail never shows.
  const [seenVersion, setSeenVersion] = useState(0);
  useEffect(() => {
    const bump = () => setSeenVersion((v) => v + 1);
    window.addEventListener(TRIAGE_SEEN_CHANGE_EVENT, bump);
    return () => window.removeEventListener(TRIAGE_SEEN_CHANGE_EVENT, bump);
  }, []);
  // Muted senders — forward-looking, unlike the per-mail seen-store.
  const [muteVersion, setMuteVersion] = useState(0);
  useEffect(() => {
    const bump = () => setMuteVersion((v) => v + 1);
    window.addEventListener(TRIAGE_MUTES_CHANGE_EVENT, bump);
    return () => window.removeEventListener(TRIAGE_MUTES_CHANGE_EVENT, bump);
  }, []);

  const visibleTriageMails = useMemo(() => {
    if (!triageMails) return null;
    const seen = new Set(loadSeenTriageIds());
    const muted = new Set(loadMutedSenders());
    return triageMails.filter((m) => !seen.has(m.id) && !isSenderMuted(m.sender, muted));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenVersion/muteVersion trigger the re-filter, not read directly
  }, [triageMails, seenVersion, muteVersion]);

  // Digest cards follow the same two rules: a card whose mails are all handled
  // — or that only carries muted senders — has nothing left to show.
  const visibleSummary = useMemo(() => {
    if (!triageSummary) return null;
    const seen = new Set(loadSeenTriageIds());
    const muted = new Set(loadMutedSenders());
    const cards = triageSummary.cards.filter((c) => {
      const openIds = c.sourceIds.filter((id) => !seen.has(id));
      if (c.sourceIds.length > 0 && openIds.length === 0) return false;
      const senders = c.sources.map((s) => s.sender).filter(Boolean);
      if (senders.length > 0 && senders.every((s) => isSenderMuted(s, muted))) return false;
      return true;
    });
    return { ...triageSummary, cards };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seenVersion/muteVersion trigger the re-filter
  }, [triageSummary, seenVersion, muteVersion]);

  // Re-read on every mute change so the manage view lists them live.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mutedSenders = useMemo(() => loadMutedSenders(), [muteVersion]);
  const hiddenCount = (triageMails?.length ?? 0) - (visibleTriageMails?.length ?? 0);
  const dismissTriageMail = (id: string) => markTriageSeen([id]);
  // Muting also clears what's on screen right now — otherwise the mail you
  // just silenced would sit there until tomorrow's refresh.
  const muteSenderAndHide = (sender: string, ids: string[]) => {
    muteSender(sender);
    markTriageSeen(ids);
  };
  // "Erledigte wieder anzeigen" — un-hides only the CURRENT report's items.
  const restoreDismissed = () => unmarkTriageSeen((triageMails ?? []).map((m) => m.id));

  // Locally hidden (user-"deleted") calendar events — filtered out of every
  // calendar surface. Re-renders when the hide-list changes.
  const hiddenEventIds = useHiddenEventIds();
  const visibleEvents = (events.data ?? []).filter((e) => !isEventHidden(e.id, hiddenEventIds));
  const visibleUpcoming = (upcoming.data ?? []).filter((e) => !isEventHidden(e.id, hiddenEventIds));

  // Listen for cross-component toggle changes (TrackerSettings writes to the
  // same key) so the dashboard reflects new preferences without a full reload.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SHOW_STOCKS_KEY) setShowStocks(loadShowStocks());
    }
    function onCustom() {
      setShowStocks(loadShowStocks());
    }
    window.addEventListener("storage", onStorage);
    window.addEventListener("morning:settings-change", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("morning:settings-change", onCustom);
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <MorningTriage calendarEvents={visibleEvents} />

      {/* Ganz oben, aber nur wenn es etwas gibt: was Daily von Hermes
          zurueckgewiesen hat. Ein Auftrag von ihm kann "ok" melden, waehrend
          seine Daten abgelehnt wurden — dann ist der Beitrag weg und sonst
          sagt es niemand. Siehe RejectStrip.tsx. */}
      <RejectStrip />
      {/* Ebenso: ein Kanal zum Brain, in dem längst etwas hätte passieren
          sollen. Siehe KanalHinweis.tsx. */}
      <KanalHinweis />

      {/* Morgens einmal: gehst du zu den heutigen Terminen hin? Erscheint nur,
          solange offene Termine da sind, und laesst sich vertagen. */}
      <TagesTermineDialog events={visibleEvents} />

      {/* Die eine Frage, wann ein datierter Vorgang zur Aufgabe wird. Steht
          weit oben, weil sie nur selten da ist — und verschwindet ganz, wenn
          nichts offen ist. */}
      <VorlaufCard />

      {/* Die Briefing-Karte stand hier bis 2026-10-31. Pauls Entscheidung: den
          Tag erzählt das Hörbriefing im Intro, eine zweite Fassung als Text
          oben braucht er nicht. Hermes' Gruss und die Heute-Zeile bleiben. */}

      {/* Direkt unter dem Briefing, aber vor allem anderen: die Frage soll
          gesehen werden, ohne sich vorzudrängen. Weiter unten ginge sie unter,
          als Pop-up wäre sie aufdringlich — und die Karte verschwindet ganz,
          wenn es gerade nichts zu fragen gibt. */}
      <BrainQuestionCard />

      <Reveal index={0}>
        <HeuteJarvis
          calendarEvents={visibleEvents}
          upcomingEvents={visibleUpcoming}
          emails={visibleTriageMails ?? []}
        />
      </Reveal>

      <BewusstCard />

      {/* „Im Fokus" (Vorgänge) ist seit 2026-10-31 weg — Pauls Wunsch. Der
          Server führt die Vorgänge weiter (focusStore, /api/hermes/focus),
          das Dashboard zeigt sie nicht mehr. */}

      {/* Stundenplan-Check: asks (weekly + on new entries) which calendar events
          to pull into the Lernstundenplan; learns the decision per series. */}
      <CalendarPlanner events={visibleUpcoming} />

      {/* Posteingang. Der Kalender stand hier bis Aug 2026 daneben — er ist in
          „Dein Horizont" aufgegangen (im Raster oben, direkt hinter „Was heute
          zählt"). Zwei getrennte Flächen für dieselbe Frage „was kommt?"
          zwangen dazu, beides zu lesen und im Kopf zu sortieren; ein Termin,
          der in beiden Quellen steckt, stand zweimal da. */}
      {stil === "g" ? (
        /* Stil G: Posteingang und Wetter nebeneinander wie auf Seite G —
           übereinander standen zwei dünne Streifen über die ganze Breite.
           Darüber die Projekte: was über Wochen läuft und wo Paul steht. */
        <Reveal index={1}>
          <GProjekte />
          <div id="kalender-voll" className="g-raster g-paar">
            <div className="g-span-7">
              <EmailCard
                emails={visibleTriageMails}
                summary={visibleSummary}
                loading={triageMails === null}
                error={null}
                onDismiss={dismissTriageMail}
                updatedAt={triageUpdatedAt}
                newestMailAt={newestMailAt}
                hiddenCount={hiddenCount}
                onRestoreDismissed={restoreDismissed}
                onMuteSender={muteSenderAndHide}
                mutedSenders={mutedSenders}
                onUnmuteSender={unmuteSender}
              />
            </div>
            <div className="g-span-5"><WeatherCard /></div>
          </div>
        </Reveal>
      ) : (
        <>
        <Reveal index={1}>
          <div id="kalender-voll" className="grid grid-cols-1 gap-6">
            <EmailCard
              emails={visibleTriageMails}
              summary={visibleSummary}
              loading={triageMails === null}
              error={null}
              onDismiss={dismissTriageMail}
              updatedAt={triageUpdatedAt}
              newestMailAt={newestMailAt}
              hiddenCount={hiddenCount}
              onRestoreDismissed={restoreDismissed}
              onMuteSender={muteSenderAndHide}
              mutedSenders={mutedSenders}
              onUnmuteSender={unmuteSender}
            />
          </div>
        </Reveal>

        {/* Row 2: Weather + Map (full width) */}
        <Reveal index={2}><WeatherCard /></Reveal>
        </>
      )}

      {/* Row 3: Wochenplan (replaces Portfolio by default) */}
      <Reveal index={3}><WeekPlanCard calendarEvents={visibleEvents} /></Reveal>

      {/* Row 4: Portfolio — only when explicitly enabled in settings */}
      {showStocks && <Reveal index={4}><StockCard /></Reveal>}

      {/* Row 5: API Usage */}
      <Reveal index={5}><UsageCard /></Reveal>

      {/* Freie Bloecke aus dem Kalender — direkt ueber den Abos, weil beides
          Hintergrundwissen ist: man sieht hin, wenn man hinsehen will. */}
      <Reveal index={6}><GapsCard /></Reveal>

      {/* Row 7: Abos — ganz unten, weil es Hintergrundwissen ist und keine
          Tagesaufgabe. Man sieht hin, wenn man hinsehen will. */}
      <Reveal index={7}><SubscriptionsCard /></Reveal>
    </div>
  );
}
