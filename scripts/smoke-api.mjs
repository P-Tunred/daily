#!/usr/bin/env node
// Rauchtest gegen einen LAUFENDEN Daily-Server.
//
// WARUM DAS HIER STEHT UND NICHT IN EINEM TEST-FRAMEWORK
// Die Fehler, die in dieser App wirklich weh tun, sieht man erst am fertig
// verdrahteten Server: ein Schlüssel, der nur im Browser existierte; eine
// Löschroute, die nur eine der beiden Ablagen anfasst; ein Vault-Spiegel, den
// der Dienst wegen ProtectHome nicht lesen darf. Ein Unit-Test mit Attrappen
// hätte all das bestanden. Deshalb echte HTTP-Aufrufe gegen echtes Blech.
//
// Reines Node, keine Abhängigkeiten, Exit 1 sobald etwas fehlschlägt — damit
// ein Cron oder Hermes das Ergebnis ohne Umweg auswerten kann.
//
// Aufruf:  node scripts/smoke-api.mjs [--url http://…]
//          Ohne --url: DAILY_HOST/PORT aus /etc/daily/env, sonst 127.0.0.1:4861.

import { readFileSync } from 'node:fs'

// ── Konfiguration ───────────────────────────────────────────────────────────

const ENV_FILE = '/etc/daily/env'
const TIMEOUT_MS = 15_000
const AI_TIMEOUT_MS = 60_000   // eine echte Modellantwort braucht länger
const MIN_BRAIN_CHARS = 200

// Umgebung schlägt Datei: auf der VM liegt alles in /etc/daily/env, lokal wird
// beim Testen lieber vorne dran gesetzt (ANTHROPIC_API_KEY=… node …).
let envFile = ''
try { envFile = readFileSync(ENV_FILE, 'utf-8') } catch { /* nicht auf der VM */ }

function conf(name) {
  const fromEnv = process.env[name]
  if (fromEnv && fromEnv.trim()) return fromEnv.trim()
  const m = envFile.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim() : undefined
}

/** Vorgabe-Adresse, wenn kein --url mitgegeben wurde.
 *
 *  127.0.0.1 stimmt für einen Testlauf auf dem eigenen Rechner. Auf der VM
 *  bindet der Dienst aber an DAILY_HOST — die Tailscale-Adresse — und ist unter
 *  127.0.0.1 überhaupt nicht erreichbar. Ein blindes 127.0.0.1 lässt dort alle
 *  neun Prüfungen mit "fetch failed" scheitern, obwohl nichts kaputt ist: der
 *  peinlichste Fehlalarm, den ein Rauchtest produzieren kann. Deshalb dieselbe
 *  Quelle befragen, aus der auch der Dienst seine Adresse nimmt. Gelesen, nie
 *  geschrieben — DAILY_HOST bleibt, wo es hingehört. */
function defaultUrl() {
  const port = conf('PORT') || '4861'
  const host = conf('DAILY_HOST')
  if (host && host !== '127.0.0.1' && host !== 'localhost') return `http://${host}:${port}`
  return `http://127.0.0.1:${port}`
}

function argUrl() {
  const idx = process.argv.indexOf('--url')
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1]
  const inline = process.argv.find((a) => a.startsWith('--url='))
  if (inline) return inline.slice('--url='.length)
  return defaultUrl()
}

const BASE = argUrl().replace(/\/+$/, '')

const USER = conf('AUTH_USER') || 'paul'
const PASS = conf('AUTH_PASS')
const TOKEN = conf('HERMES_TOKEN')

const BASIC = PASS ? 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64') : null
const BEARER = TOKEN ? 'Bearer ' + TOKEN : null

// ── Aufrufhilfen ────────────────────────────────────────────────────────────

async function req(path, opts = {}) {
  const { method = 'GET', body, auth, timeout = TIMEOUT_MS } = opts
  const headers = {}
  if (auth === 'basic' && BASIC) headers.Authorization = BASIC
  if (auth === 'bearer' && BEARER) headers.Authorization = BEARER
  if (auth && typeof auth === 'object') headers.Authorization = auth.raw
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
}

function expect(cond, message) {
  if (!cond) throw new Error(message)
}

/** Liest einen SSE-Strom und gibt die Textstücke zurück, die wirklich ankamen. */
async function readStream(res) {
  const parts = []
  let rest = ''
  const decoder = new TextDecoder()
  for await (const chunk of res.body) {
    rest += decoder.decode(chunk, { stream: true })
    const lines = rest.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw || raw === '[DONE]') continue
      let ev
      try { ev = JSON.parse(raw) } catch { continue }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
        parts.push(ev.delta.text)
      }
    }
  }
  return parts
}

// ── Aufräumen ───────────────────────────────────────────────────────────────
// Was angelegt wurde, wandert sofort auf diese Liste und erst nach bestätigter
// Löschung wieder runter. Bricht eine Prüfung vorher ab, räumt der Schluss auf
// — sonst sammelt jeder rote Lauf eine Leiche im echten Bestand an.

const trash = []

async function cleanup() {
  if (!trash.length) return null
  let removed = 0
  for (const { kind, id } of trash) {
    try {
      const res = await req(`/api/hermes/${kind}/${id}`, { method: 'DELETE', auth: 'bearer' })
      if (res.ok) removed++
    } catch { /* Server weg — mehr können wir nicht tun */ }
  }
  return `${removed}/${trash.length} Testeintrag/-einträge nachträglich entfernt`
}

function untrash(kind, id) {
  const i = trash.findIndex((t) => t.kind === kind && t.id === id)
  if (i >= 0) trash.splice(i, 1)
}

// ── Zustand lesen und zurückschreiben ───────────────────────────────────────
// Nur für die Briefing-Prüfung: die Quittierungsliste hat keine eigene Route,
// sie lebt als localStorage-Schlüssel im Zustand. Gelesen und geschrieben wird
// deshalb über /api/state — mit `baseUpdatedAt`, damit der Optimistic-Lock aus
// stateStore.cjs greift und wir keinem parallel laufenden Browser ins Wort
// fallen. Genau ein Wiederholungsversuch bei 409: schreibt gerade jemand
// anderes, ist der zweite Anlauf richtig, ein dritter wäre Rechthaberei.

const BRIEFING_KEY = 'morning.briefing'
const ACK_KEY = 'morning.assistant.acknowledgedEvents'

async function leseZustand() {
  const res = await req('/api/state', { auth: 'basic' })
  expect(res.ok, `GET /api/state gab ${res.status}`)
  return res.json()
}

async function schreibeZustand(aendern) {
  for (let versuch = 0; versuch < 2; versuch++) {
    const state = await leseZustand()
    aendern(state.localStorage)
    const res = await req('/api/state', {
      method: 'PUT',
      auth: 'basic',
      body: { baseUpdatedAt: state.updatedAt, localStorage: state.localStorage, indexedDB: state.indexedDB },
    })
    if (res.status === 409) continue
    expect(res.ok, `PUT /api/state gab ${res.status}`)
    return
  }
  throw new Error('PUT /api/state zweimal mit 409 abgelehnt — schreibt gerade jemand anderes?')
}

/** Setzt einen Schlüssel zurück auf den Wert von vorher — oder entfernt ihn,
 *  wenn es ihn vorher gar nicht gab. Das `delete` ist der Punkt: ein leerer
 *  String statt "nicht vorhanden" liesse die Karte künftig einen kaputten
 *  Eintrag lesen, statt sauber "noch kein Briefing" zu zeigen. */
/** Das heutige Datum, wie es DER SERVER sieht.
 *
 *  Seit dem Briefing-Vertrag ist genau dieses Datum das einzig zulässige — ein
 *  Platzhalter-Tag wird mit 400 abgelehnt. Genau daran sind zwei Prüfungen
 *  hier stillschweigend hängengeblieben: sie schrieben noch auf ein
 *  Vergangenheitsdatum, das sie früher vor Kollisionen mit echten Daten
 *  schützen sollte. Selbst rechnen wäre der nächste Fehler in derselben Kette
 *  (die VM läuft auf UTC, die App auf Berlin) — deshalb fragen statt rechnen.
 *
 *  Dass diese Datei damit auf dem ECHTEN heutigen Datum arbeitet, ist
 *  unbedenklich: sie läuft ausschliesslich gegen einen isolierten Testserver
 *  mit eigenem DAILY_DATA_DIR. Gegen Produktion läuft smoke-readonly.mjs. */
async function serverHeute() {
  const res = await req('/api/hermes/briefing', { auth: 'bearer' })
  expect(res.ok, `GET /api/hermes/briefing gab ${res.status}`)
  const d = (await res.json()).serverDate
  expect(/^\d{4}-\d{2}-\d{2}$/.test(d || ''), `Server lieferte kein brauchbares serverDate: ${d}`)
  return d
}

function zuruecksetzen(ls, key, vorher) {
  if (vorher === undefined) delete ls[key]
  else ls[key] = vorher
}

// ── Die Prüfungen ───────────────────────────────────────────────────────────

/** Legt an → findet wieder → löscht → prüft dass es weg ist.
 *  Der ganze Lebenszyklus in einem Durchgang, weil genau die Lücke dazwischen
 *  der Fehler war: anlegen ging, löschen gab es nicht. */
async function lifecycle(kind, payload, labelOf) {
  const created = await req(`/api/hermes/${kind}`, { method: 'POST', auth: 'bearer', body: payload })
  expect(created.status === 201, `Anlegen gab ${created.status}, erwartet 201`)
  const { created: item } = await created.json()
  expect(item && item.id, 'Antwort enthält keine id')
  trash.push({ kind, id: item.id })

  const listed = await req(`/api/hermes/${kind}`, { auth: 'bearer' })
  expect(listed.ok, `Liste gab ${listed.status}`)
  const before = await listed.json()
  const rows = before[kind === 'todos' ? 'todos' : 'events']
  expect(Array.isArray(rows), `Feld "${kind === 'todos' ? 'todos' : 'events'}" ist kein Array`)
  expect(rows.some((r) => r.id === item.id), 'angelegter Eintrag taucht in der Liste nicht auf')

  const del = await req(`/api/hermes/${kind}/${item.id}`, { method: 'DELETE', auth: 'bearer' })
  expect(del.status === 200, `Löschen gab ${del.status}, erwartet 200`)
  untrash(kind, item.id)

  const after = await req(`/api/hermes/${kind}`, { auth: 'bearer' })
  const rowsAfter = (await after.json())[kind === 'todos' ? 'todos' : 'events']
  expect(!rowsAfter.some((r) => r.id === item.id), 'Eintrag steht nach dem Löschen noch in der Liste')

  // Und ein zweiter Versuch muss 404 geben statt still 200 zu melden.
  const again = await req(`/api/hermes/${kind}/${item.id}`, { method: 'DELETE', auth: 'bearer' })
  expect(again.status === 404, `zweites Löschen gab ${again.status}, erwartet 404`)

  return `${labelOf} angelegt, gefunden, gelöscht, 404 beim zweiten Mal`
}

const CHECKS = [
  {
    label: 'GET /api/hermes/ping',
    async run() {
      expect(BEARER, 'HERMES_TOKEN ist weder in der Umgebung noch in ' + ENV_FILE)
      const res = await req('/api/hermes/ping', { auth: 'bearer' })
      expect(res.status === 200, `Status ${res.status}` + (res.status === 403 ? ' — HERMES_TOKEN serverseitig nicht gesetzt' : ''))
      const data = await res.json()
      expect(data.ok === true, 'Antwort ohne ok:true')
      return `Dienst "${data.service}" antwortet`
    },
  },
  {
    label: 'GET /api/hermes/state ist gültiges JSON',
    async run() {
      const res = await req('/api/hermes/state', { auth: 'bearer' })
      expect(res.ok, `Status ${res.status}`)
      // Bewusst über den GANZEN Text, nicht über die ersten n Zeichen: ein
      // abgeschnittener Zustand fällt sonst erst im Browser auf.
      const raw = await res.text()
      let doc
      try { doc = JSON.parse(raw) } catch (e) { throw new Error('kein gültiges JSON: ' + e.message) }
      expect(doc && typeof doc === 'object', 'JSON ist kein Objekt')
      const keys = Object.keys(doc.localStorage ?? {}).length
      return `${(raw.length / 1024).toFixed(0)} KB vollständig geparst, ${keys} localStorage-Schlüssel`
    },
  },
  {
    label: 'Todo: anlegen → auftauchen → löschen → weg',
    run: () => lifecycle('todos', { text: 'Rauchtest — darf gelöscht werden', priority: 'normal' }, 'Todo'),
  },
  {
    label: 'Termin: anlegen → auftauchen → löschen → weg',
    run: () => lifecycle('events', { title: 'Rauchtest — darf gelöscht werden', date: '2099-01-01', kind: 'note' }, 'Termin'),
  },
  {
    label: 'Lernziele: Override setzen → lesen → löschen',
    async run() {
      // Ein Datum, das nie ein echtes Lernziel trägt — die Wochentagsziele
      // bleiben unberührt, und der Override wird am Ende wieder entfernt.
      const iso = '2099-12-31'
      const put = await req('/api/hermes/goals', { method: 'PUT', auth: 'bearer', body: { overrides: { [iso]: 123 } } })
      expect(put.status === 200, `PUT gab ${put.status}`)
      const got = await (await req('/api/hermes/goals', { auth: 'bearer' })).json()
      expect(got.overrides && got.overrides[iso] === 123, 'gesetzter Override fehlt beim Lesen')
      const del = await req('/api/hermes/goals', { method: 'PUT', auth: 'bearer', body: { overrides: { [iso]: null } } })
      expect(del.status === 200, `Löschen gab ${del.status}`)
      const after = await (await req('/api/hermes/goals', { auth: 'bearer' })).json()
      expect(!(after.overrides && iso in after.overrides), 'Override steht nach dem Löschen noch da')
      const bad = await req('/api/hermes/goals', { method: 'PUT', auth: 'bearer', body: { weekday: 9, minutes: 60 } })
      expect(bad.status === 400, `kaputter Wochentag gab ${bad.status}, erwartet 400`)
      return 'Override gesetzt, gelesen, entfernt; Unsinn wird abgewiesen'
    },
  },
  {
    label: 'Briefing: schreiben · zweites Alert 409 · quittiertes verworfen',
    async run() {
      // WARUM EIN ERFUNDENES DATUM STATT "HEUTE"
      // Die Regel "höchstens ein Alert pro Tag" gilt auch gegen den ECHTEN
      // Bestand. Auf dem Server stand morgens bereits ein Briefing mit Alert
      // für heute — der erste Schreibversuch des Tests lief damit prompt in
      // dieselbe 409, die er eigentlich erst im zweiten Schritt provozieren
      // will. Frueher stand hier ein Platzhalter-Datum; seit dem Vertrag ist
      // nur noch HEUTE zulaessig, also faellt der Schutz weg und wird durch
      // den isolierten Testserver ersetzt (eigenes DAILY_DATA_DIR).
      const heute = await serverHeute()
      // Ein vollstaendiger Publish braucht alle drei Zeilen. Wer nur Text oder
      // nur ein Alert schickt, muss das als `mode:"patch"` kenntlich machen —
      // sonst waere nicht unterscheidbar, ob Felder fehlen oder geloescht
      // werden sollen. Genau daran sind diese Pruefungen haengengeblieben.
      const ZEILEN = { headerGreeting: 'Rauchtest', tagline: 'Rauchtest-Tagline.', todayLead: 'Rauchtest-Zeile fuer heute.' }
      const A1 = 'rauchtest-alert-eins'
      const A2 = 'rauchtest-alert-zwei'
      const TEXT1 = 'Rauchtest-Briefing — darf überschrieben werden.'
      const TEXT2 = 'Rauchtest-Briefing, zweite Fassung.'

      // Original sichern, BEVOR irgendetwas geschrieben wird.
      const vorher = await leseZustand()
      const origBriefing = vorher.localStorage[BRIEFING_KEY]
      const origAck = vorher.localStorage[ACK_KEY]

      try {
        // 1 — schreiben und zurücklesen
        const eins = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: heute, text: TEXT1, lines: ZEILEN, alert: { id: A1, title: 'Rauchtest-Alert', why: 'Nur ein Test.', deadline: heute } },
        })
        expect(eins.status === 200, `Schreiben gab ${eins.status}, erwartet 200`)
        const gelesen = await (await req('/api/hermes/briefing', { auth: 'bearer' })).json()
        expect(gelesen.briefing?.text === TEXT1, 'zurückgelesener Text stimmt nicht')
        expect(gelesen.briefing?.alert?.id === A1, 'Alert fehlt beim Zurücklesen')

        // 2 — zweites Alert am selben Tag muss abgelehnt werden
        const zwei = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: heute, text: TEXT1, mode: 'patch', alert: { id: A2, title: 'Zweites Alert', deadline: heute } },
        })
        expect(zwei.status === 409, `zweites Alert gab ${zwei.status}, erwartet 409`)
        const konflikt = await zwei.json()
        expect(konflikt.steht?.id === A1, 'die 409-Antwort nennt nicht das bereits stehende Alert')

        // 3 — quittiertes Alert wird verworfen, der Text bleibt
        await schreibeZustand((ls) => {
          let liste = []
          try { const v = JSON.parse(ls[ACK_KEY] ?? '[]'); if (Array.isArray(v)) liste = v } catch { /* kaputt → neu */ }
          if (!liste.includes(A1)) liste.push(A1)
          ls[ACK_KEY] = JSON.stringify(liste)
        })
        const drei = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: heute, text: TEXT2, mode: 'patch', alert: { id: A1, title: 'Rauchtest-Alert', deadline: heute } },
        })
        expect(drei.status === 200, `dritter Aufruf gab ${drei.status}, erwartet 200`)
        const nachher = await drei.json()
        expect(nachher.verworfen === A1, `Alert wurde nicht als verworfen gemeldet (verworfen=${nachher.verworfen})`)
        expect(!nachher.briefing?.alert, 'quittiertes Alert steht trotzdem im gespeicherten Briefing')
        expect(nachher.briefing?.text === TEXT2, 'der Text ist beim Verwerfen mit untergegangen')

        return 'geschrieben, zweites Alert abgelehnt, quittiertes verworfen, Text blieb'
      } finally {
        // Immer aufräumen — auch wenn oben etwas fehlschlug. Sonst bleibt ein
        // Rauchtest-Briefing im echten Bestand stehen und Paul liest morgen
        // früh "darf überschrieben werden".
        await schreibeZustand((ls) => {
          zuruecksetzen(ls, BRIEFING_KEY, origBriefing)
          zuruecksetzen(ls, ACK_KEY, origAck)
        })
      }
    },
  },
  {
    label: 'Briefing-Zeilen: zu lange werden gekürzt, fehlende fallen zurück',
    async run() {
      // Wie beim Briefing-Test: ein Datum, an dem nie ein echtes steht.
      const PRUEFTAG = await serverHeute()
      const GRENZEN = { headerGreeting: 40, tagline: 70, todayLead: 120 }

      const vorher = await leseZustand()
      const origBriefing = vorher.localStorage[BRIEFING_KEY]

      try {
        // 1 — deutlich zu lange Zeilen müssen gekürzt ankommen, nicht abgelehnt
        const lang = {
          headerGreeting: 'Guten Morgen Paul, ' + 'sehr '.repeat(30) + 'ausführlich',
          tagline: 'Ein Halbsatz, ' + 'der viel zu lang geraten ist, '.repeat(8),
          todayLead: 'Heute steht an: ' + 'noch ein Punkt, '.repeat(30),
        }
        const eins = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: PRUEFTAG, text: 'Zeilen-Prüfung.', lines: lang },
        })
        expect(eins.status === 200, `Schreiben gab ${eins.status}, erwartet 200`)
        const gek = (await eins.json()).briefing?.lines
        expect(!!gek, 'lines fehlen in der Antwort')
        for (const [feld, max] of Object.entries(GRENZEN)) {
          expect(typeof gek[feld] === 'string', `${feld} fehlt nach dem Kürzen`)
          expect(gek[feld].length <= max, `${feld} ist ${gek[feld].length} Zeichen, erlaubt sind ${max}`)
          expect(gek[feld].endsWith('…'), `${feld} wurde nicht als gekürzt markiert`)
          // Am Wortende schneiden heisst: kein abgehacktes Wort vor dem Zeichen.
          expect(!/\s…$/.test(gek[feld]), `${feld} endet auf ein loses Leerzeichen vor dem Auslassungszeichen`)
        }

        // 2 — ohne `lines` darf nichts Leeres entstehen: entweder bleiben die
        //     vom selben Tag stehen, oder das Feld fehlt ganz. Ein leerer
        //     String wäre das Schlimmste — der gewänne im Browser gegen die
        //     lokale Berechnung und liesse den Header leer.
        const zwei = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: PRUEFTAG, text: 'Zeilen-Prüfung, zweite Fassung.', mode: 'patch' },
        })
        expect(zwei.status === 200, `zweites Schreiben gab ${zwei.status}`)
        const nachher = (await zwei.json()).briefing
        expect(nachher.text === 'Zeilen-Prüfung, zweite Fassung.', 'der Text wurde nicht übernommen')
        if (nachher.lines) {
          for (const feld of Object.keys(GRENZEN)) {
            expect(nachher.lines[feld] === undefined || nachher.lines[feld].length > 0,
              `${feld} ist leer statt zu fehlen — das würde den Rückfall aushebeln`)
          }
        }

        // 3 — Unsinn statt Zeichenkette wird ABGELEHNT, nicht still verworfen.
        //     Früher schluckte der Server so etwas und meldete Erfolg; dann
        //     stand im Dashboard die lokale Formel, während Hermes glaubte,
        //     seine Zeile sei angekommen. Ein Fehlschlag muss sichtbar sein.
        const drei = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: PRUEFTAG, text: 'Dritte.', mode: 'patch', lines: { headerGreeting: 42, tagline: null, todayLead: ['a'] } },
        })
        expect(drei.status === 400, `kaputte Zeilentypen gaben ${drei.status}, erwartet 400`)
        // Und der Bestand darf davon unberührt sein — eine abgelehnte
        // Änderung darf nichts halb angewendet zurücklassen.
        const unveraendert = await (await req('/api/hermes/briefing', { auth: 'bearer' })).json()
        expect(unveraendert.briefing?.text === 'Zeilen-Prüfung, zweite Fassung.',
          'der abgelehnte Aufruf hat den Text trotzdem verändert')

        // 4 — ein Briefing aus der Zukunft muss LAUT scheitern. Am 15.08. kam
        //     eines auf den 16. datiert an, wurde klaglos gespeichert und war
        //     danach unsichtbar, weil die Oberfläche nur Heutiges zeigt.
        const fern = await req('/api/hermes/briefing', {
          method: 'POST', auth: 'bearer',
          body: { date: '2099-12-31', text: 'Aus der Zukunft.', mode: 'patch' },
        })
        expect(fern.status === 400, `Briefing aus der Zukunft gab ${fern.status}, erwartet 400`)

        return `gekürzt auf ${GRENZEN.headerGreeting}/${GRENZEN.tagline}/${GRENZEN.todayLead}, fehlende Zeilen ohne Leerstring, Zukunft abgelehnt`
      } finally {
        await schreibeZustand((ls) => { zuruecksetzen(ls, BRIEFING_KEY, origBriefing) })
      }
    },
  },
  {
    label: 'Brain-Frage: eine offene · 409 · beantworten · leeren · Ruhezeit',
    async run() {
      const QKEY = 'morning.brainQuestion'
      const A = { id: 'rauchtest-frage-a', frage: 'Rauchtest A?', warum: 'Nur ein Test.', quelle: 'brain', seite: 'wiki/konzepte/test.md' }
      const B = { id: 'rauchtest-frage-b', frage: 'Rauchtest B?', warum: 'Nur ein Test.', quelle: 'hermes', seite: 'wiki/themen/test.md' }

      const vorher = await leseZustand()
      const orig = vorher.localStorage[QKEY]

      try {
        // Sauber anfangen — sonst blockiert eine echte offene Frage den Test.
        await schreibeZustand((ls) => { delete ls[QKEY] })

        // 1 — Herkunft ist Pflicht. Ohne sie kann Paul nicht einordnen, wie
        //     ernst die Frage zu nehmen ist; stillschweigend "hermes" zu
        //     unterstellen wäre eine Lüge über die Herkunft.
        const ohne = await req('/api/hermes/question', {
          method: 'POST', auth: 'bearer',
          body: { id: 'x', frage: 'Ohne Quelle?', warum: 'y', seite: 'wiki/a.md' },
        })
        expect(ohne.status === 400, `Frage ohne quelle gab ${ohne.status}, erwartet 400`)
        const falsch = await req('/api/hermes/question', {
          method: 'POST', auth: 'bearer',
          body: { ...A, id: 'x2', quelle: 'ausgedacht' },
        })
        expect(falsch.status === 400, `unbekannte quelle gab ${falsch.status}, erwartet 400`)

        // 2 — erste geht durch
        const eins = await req('/api/hermes/question', { method: 'POST', auth: 'bearer', body: A })
        expect(eins.status === 201, `erste Frage gab ${eins.status}, erwartet 201`)

        // 3 — zweite wird abgelehnt, solange die erste offen ist
        const zwei = await req('/api/hermes/question', { method: 'POST', auth: 'bearer', body: B })
        expect(zwei.status === 409, `zweite Frage gab ${zwei.status}, erwartet 409`)
        const konflikt = await zwei.json()
        expect(konflikt.steht?.id === A.id, 'die 409-Antwort nennt nicht die bereits offene Frage')

        // 4 — beantworten (über die Browser-Route, mit Basic-Auth)
        const antw = await req('/api/question/answer', {
          method: 'POST', auth: 'basic',
          body: { aktion: 'antworten', antwort: 'Die Antwort aus dem Rauchtest.' },
        })
        expect(antw.status === 200, `Antworten gab ${antw.status}, erwartet 200`)

        // 5 — GET liefert sie für Hermes zum Abholen
        const abholbar = await (await req('/api/hermes/question', { auth: 'bearer' })).json()
        expect(abholbar.offen === null, 'nach dem Antworten steht immer noch eine offene Frage')
        expect(abholbar.antwort?.antwort === 'Die Antwort aus dem Rauchtest.', 'die Antwort ist nicht abholbar')
        expect(abholbar.antwort?.id === A.id, 'die abholbare Antwort gehört zur falschen Frage')

        // 6 — nächste geht erst durch, NACHDEM die Antwort geleert wurde. Vorher
        //     wäre sie weg, falls der Hermes-Lauf dazwischen ausfällt.
        const geleert = await req('/api/hermes/question', {
          method: 'DELETE', auth: 'bearer', body: { id: A.id },
        })
        expect(geleert.status === 200, `Leeren gab ${geleert.status}`)
        const drei = await req('/api/hermes/question', { method: 'POST', auth: 'bearer', body: B })
        expect(drei.status === 201, `nächste Frage gab ${drei.status}, erwartet 201`)

        // 7 — zurückgestellt heisst Ruhe: dieselbe id darf nicht sofort wieder
        //     gestellt werden, sonst klickt man nach dreimal "Später" alles weg.
        const spaeter = await req('/api/question/answer', { method: 'POST', auth: 'basic', body: { aktion: 'spaeter' } })
        expect(spaeter.status === 200, `Später gab ${spaeter.status}`)
        const nochmal = await req('/api/hermes/question', { method: 'POST', auth: 'bearer', body: B })
        expect(nochmal.status === 409, `zurückgestellte Frage kam sofort wieder (${nochmal.status}), erwartet 409`)
        const grund = await nochmal.json()
        expect(grund.gesperrt?.grund === 'zurueckgestellt', `falscher Sperrgrund: ${JSON.stringify(grund.gesperrt)}`)

        // 8 — verworfen heisst nie wieder
        const c = { ...A, id: 'rauchtest-frage-c' }
        expect((await req('/api/hermes/question', { method: 'POST', auth: 'bearer', body: c })).status === 201, 'dritte Frage ging nicht durch')
        await req('/api/question/answer', { method: 'POST', auth: 'basic', body: { aktion: 'egal' } })
        const nie = await req('/api/hermes/question', { method: 'POST', auth: 'bearer', body: c })
        expect(nie.status === 409, `verworfene Frage kam wieder (${nie.status}), erwartet 409`)
        expect((await nie.json()).gesperrt?.grund === 'verworfen', 'falscher Sperrgrund für verworfen')

        return 'Herkunft Pflicht, eine offene Frage, Antwort abholbar, zurückgestellt und verworfen gesperrt'
      } finally {
        await schreibeZustand((ls) => { zuruecksetzen(ls, QKEY, orig) })
      }
    },
  },
  {
    label: 'Vorschläge: drei · vierter 400 · Ja legt an · nie wieder · Dialog quittiert',
    async run() {
      const SKEY = 'morning.suggestions'
      const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
      const mach = (n, art = 'todo') => ({
        id: `mail:rauchtest-${n}`, art,
        titel: `Rauchtest-Vorschlag ${n}`, warum: 'Nur ein Test.', datum: heute,
        nutzlast: art === 'todo'
          ? { text: `Rauchtest-Todo ${n}`, priority: 'normal' }
          : { title: `Rauchtest-Termin ${n}`, date: heute, kind: 'note' },
      })

      const vorher = await leseZustand()
      const orig = vorher.localStorage[SKEY]
      const angelegte = []

      try {
        // 1 — drei gehen durch, der vierte nicht
        for (const n of [1, 2, 3]) {
          const r = await req('/api/hermes/suggestions', { method: 'POST', auth: 'bearer', body: mach(n) })
          expect(r.status === 201, `Vorschlag ${n} gab ${r.status}, erwartet 201`)
        }
        const vierter = await req('/api/hermes/suggestions', { method: 'POST', auth: 'bearer', body: mach(4) })
        expect(vierter.status === 400, `vierter Vorschlag gab ${vierter.status}, erwartet 400`)
        const v4 = await vierter.json()
        expect(v4.angekommen === 3, `400 nennt nicht die Zahl der angekommenen (${v4.angekommen})`)

        // 2 — unbekanntes Präfix wird abgelehnt. DIE Regel, an der alles hängt:
        //     eine Kennung aus dem Titel änderte sich mit jeder Formulierung,
        //     und ein abgelehnter Vorschlag käme ewig wieder.
        const roh = await req('/api/hermes/suggestions', {
          method: 'POST', auth: 'bearer',
          body: { ...mach(9), id: 'rechnung-bezahlen' },
        })
        expect(roh.status === 400, `Kennung ohne Präfix gab ${roh.status}, erwartet 400`)

        // 3 — Ja legt den Eintrag wirklich an
        const ja = await req('/api/suggestions/decide', {
          method: 'POST', auth: 'basic', body: { id: 'mail:rauchtest-1', ja: true },
        })
        expect(ja.status === 200, `Ja gab ${ja.status}`)
        const jaBody = await ja.json()
        expect(!!jaBody.angelegt, 'Ja hat nichts angelegt')
        angelegte.push({ kind: 'todos', id: jaBody.angelegt })
        const todos = (await (await req('/api/hermes/todos', { auth: 'bearer' })).json()).todos ?? []
        expect(todos.some((t) => t.id === jaBody.angelegt), 'angelegtes Todo taucht nicht in /todos auf')

        // 4 — DIE WICHTIGSTE PRÜFUNG: derselbe Vorschlag morgen wird verworfen.
        //     Ohne sie käme ein abgelehnter Vorschlag jeden Morgen wieder, und
        //     nach einer Woche klickt man den ganzen Dialog weg — auch die Frist.
        const nein = await req('/api/suggestions/decide', {
          method: 'POST', auth: 'basic', body: { id: 'mail:rauchtest-2', ja: false },
        })
        expect(nein.status === 200, `Nein gab ${nein.status}`)

        // Tageswechsel simulieren: der gespeicherte Tag wird zurückdatiert.
        await schreibeZustand((ls) => {
          const doc = JSON.parse(ls[SKEY])
          doc.tag = '2020-01-01'
          doc.offen = []
          ls[SKEY] = JSON.stringify(doc)
        })
        for (const [n, erwartet] of [[1, 'angenommen'], [2, 'abgelehnt']]) {
          const wieder = await req('/api/hermes/suggestions', { method: 'POST', auth: 'bearer', body: mach(n) })
          expect(wieder.status === 200, `entschiedener Vorschlag ${n} gab ${wieder.status}, erwartet 200`)
          const w = await wieder.json()
          expect(w.verworfen === `mail:rauchtest-${n}`, `Vorschlag ${n} wurde nicht verworfen`)
          expect(w.grund === erwartet, `Vorschlag ${n}: Grund "${w.grund}", erwartet "${erwartet}"`)
        }
        // Und er belegt keinen Platz im Kontingent.
        const zustand = await (await req('/api/suggestions', { auth: 'basic' })).json()
        expect(zustand.vorschlaege.length === 0, 'verworfener Vorschlag belegt trotzdem einen Platz')

        // 5 — Dialog quittiert → an diesem Tag nicht erneut
        expect((await req('/api/suggestions/ack', { method: 'POST', auth: 'basic' })).status === 200, 'Quittieren schlug fehl')
        const nachAck = await (await req('/api/suggestions', { auth: 'basic' })).json()
        expect(nachAck.dialogErledigt === true, 'Dialog gilt nach dem Quittieren nicht als erledigt')

        // 6 — die Entscheidungen sind abrufbar
        const dec = await (await req('/api/hermes/decisions', { auth: 'bearer' })).json()
        expect(Array.isArray(dec.entscheidungen), '/decisions liefert keine Liste')
        expect(dec.entscheidungen.some((d) => d.id === 'mail:rauchtest-1' && d.ja === true), 'Ja fehlt im Protokoll')
        expect(dec.entscheidungen.some((d) => d.id === 'mail:rauchtest-2' && d.ja === false), 'Nein fehlt im Protokoll')

        return 'drei angenommen, vierter 400, rohe Kennung 400, Ja legte an, Entschiedenes kommt nie wieder, Dialog quittiert'
      } finally {
        // Erst die angelegten Einträge, dann der Zustand — sonst schriebe das
        // Zurücksetzen die gerade gelöschten wieder herein.
        for (const a of angelegte) {
          if (a.id) await req(`/api/hermes/${a.kind}/${a.id}`, { method: 'DELETE', auth: 'bearer' })
        }
        await schreibeZustand((ls) => { zuruecksetzen(ls, SKEY, orig) })
      }
    },
  },
  {
    label: 'Fokus: fünf gehen, der sechste nicht · Verschieben statt Kopieren',
    async run() {
      const angelegt = []
      let todoId = null
      try {
        // 1 — bis zur Grenze auffüllen, der nächste wird abgelehnt.
        //
        // WARUM NICHT EINFACH FÜNF ANLEGEN
        // Die Grenze gilt gegen den ECHTEN Bestand. Auf dem Server stand ein
        // echter Vorgang ("Versicherung checken") — der fünfte Testeintrag lief
        // damit in genau die 400, die erst der sechste provozieren sollte.
        // Lokal fiel das nie auf, weil dort nichts stand. Deshalb erst fragen,
        // wie viel Platz IST, und nur den auffüllen. Pauls Vorgänge werden
        // dabei nicht angefasst.
        const vorher = await (await req('/api/focus', { auth: 'basic' })).json()
        const frei = vorher.platzFrei
        for (let i = 1; i <= frei; i++) {
          const r = await req('/api/focus', { method: 'POST', auth: 'basic', body: { titel: `Rauchtest-Vorgang ${i}` } })
          expect(r.status === 201, `Vorgang ${i} von ${frei} gab ${r.status}, erwartet 201`)
          angelegt.push((await r.json()).vorgang.id)
        }
        const zuviel = await req('/api/focus', { method: 'POST', auth: 'basic', body: { titel: 'Rauchtest-Vorgang zuviel' } })
        expect(zuviel.status === 400, `der Vorgang über der Grenze gab ${zuviel.status}, erwartet 400`)

        // Ab hier brauchen wir zwei eigene Einträge. Ist der Fokus schon durch
        // echte Vorgänge voll, ist die Grenze bewiesen und der Rest entfällt —
        // fremde Einträge anzufassen wäre der falsche Preis für eine Prüfung.
        if (angelegt.length < 2) {
          return `Grenze bei ${vorher.max} bestätigt (Fokus war mit ${vorher.aktive} echten Vorgängen belegt, Rest übersprungen)`
        }

        // 2 — PATCH setzt Zustand UND bewegt das Datum.
        const p = await req(`/api/focus/${angelegt[0]}`, {
          method: 'PATCH', auth: 'basic',
          body: { zustand: 'wartet', wartetAuf: 'Studierendenwerk', begruendung: 'Rauchtest' },
        })
        expect(p.status === 200, `PATCH gab ${p.status}`)
        const nach = (await p.json()).vorgang
        expect(nach.zustand === 'wartet', `Zustand ist ${nach.zustand}`)
        expect(nach.wartetAuf === 'Studierendenwerk', 'wartetAuf nicht übernommen')
        expect(typeof nach.tageStill === 'number', 'tageStill fehlt')

        // 3 — Kind-Todo: der Vorgang BLEIBT, das Todo entsteht.
        const kind = await req(`/api/focus/${angelegt[0]}`, {
          method: 'PATCH', auth: 'basic', body: { kindTodoText: 'Rauchtest-Schritt' },
        })
        expect(kind.status === 200, `Kind-Todo gab ${kind.status}`)
        const kdaten = await kind.json()
        todoId = kdaten.todo.id
        expect(kdaten.vorgang.schrittTodoId === todoId, 'schrittTodoId zeigt nicht auf das Todo')

        // 4 — Kind-Todo abhaken → letzteBewegung springt, Verweis wird gelöst.
        const fertig = await req('/api/focus/todo-done', { method: 'POST', auth: 'basic', body: { todoId } })
        expect(fertig.status === 200, `todo-done gab ${fertig.status}`)
        expect((await fertig.json()).bewegt.includes(angelegt[0]), 'der Vorgang wurde nicht als bewegt gemeldet')
        const nachher = (await (await req('/api/focus', { auth: 'basic' })).json())
          .vorgaenge.find((v) => v.id === angelegt[0])
        expect(nachher.tageStill === 0, `letzteBewegung ist nicht heute (tageStill=${nachher.tageStill})`)
        expect(!nachher.schrittTodoId, 'der erledigte Schritt hängt noch am Vorgang')

        // 5 — Fokus → Todo ist VERSCHIEBEN: der Vorgang ist danach weg.
        const zurueck = await req(`/api/focus/${angelegt[1]}`, { method: 'PATCH', auth: 'basic', body: { nachTodo: true } })
        expect(zurueck.status === 200, `nachTodo gab ${zurueck.status}`)
        const zdaten = await zurueck.json()
        const nochDa = (await (await req('/api/focus', { auth: 'basic' })).json())
          .vorgaenge.some((v) => v.id === angelegt[1])
        expect(!nochDa, 'der Vorgang steht nach dem Verschieben immer noch im Fokus')
        await req(`/api/hermes/todos/${zdaten.todo.id}`, { method: 'DELETE', auth: 'bearer' })
        angelegt.splice(1, 1)

        // 6 — Hermes darf NICHT anlegen.
        const verboten = await req('/api/hermes/focus', { method: 'POST', auth: 'bearer', body: { titel: 'Von Hermes' } })
        expect(verboten.status === 403, `Hermes-POST gab ${verboten.status}, erwartet 403`)

        return 'fünf ja / sechster nein, PATCH bewegt, Kind-Todo hakt den Vorgang an, Verschieben lässt nichts zurück'
      } finally {
        for (const id of angelegt) {
          await req(`/api/focus/${id}`, { method: 'DELETE', auth: 'basic' }).catch(() => {})
        }
        if (todoId) await req(`/api/hermes/todos/${todoId}`, { method: 'DELETE', auth: 'bearer' }).catch(() => {})
      }
    },
  },
  {
    label: 'Kalender-Postausgang: offen → UID zurück → im Kalender · Löschauftrag',
    async run() {
      let terminId = null
      try {
        // 1 — Termin anlegen und in den Postausgang legen.
        const angelegt = await req('/api/hermes/events', {
          method: 'POST', auth: 'bearer',
          body: { title: 'Rauchtest-Kalendertermin', date: '2099-11-11', kind: 'note' },
        })
        expect(angelegt.status === 201, `Anlegen gab ${angelegt.status}`)
        terminId = (await angelegt.json()).created.id
        trash.push({ kind: 'events', id: terminId })

        const rein = await req(`/api/calendar/outbox/${terminId}`, { method: 'POST', auth: 'basic' })
        expect(rein.status === 200, `In-den-Kalender gab ${rein.status}`)

        // 2 — Er steht als "offen" im Postausgang.
        const box1 = await (await req('/api/hermes/calendar-outbox', { auth: 'bearer' })).json()
        const meiner = box1.auftraege.find((a) => a.id === terminId)
        expect(!!meiner, 'der Termin steht nicht im Postausgang')
        expect(meiner.art === 'anlegen', `art ist ${meiner.art}`)

        // 3 — Ohne Zielkalender wird NICHTS geschrieben, und das steht da.
        if (!box1.zielKalender) {
          expect(box1.schreibbereit === false, 'schreibbereit muss ohne Zielkalender false sein')
          expect(typeof box1.hinweis === 'string' && box1.hinweis.length > 20,
            'ohne Zielkalender fehlt der erklärende Hinweis')
        }

        // 4 — UID zurückmelden → "im-kalender", raus aus dem Postausgang.
        const UID = 'RAUCHTEST-UID-0001'
        const gemeldet = await req(`/api/hermes/calendar-outbox/${terminId}`, {
          method: 'PATCH', auth: 'bearer', body: { ok: true, calUid: UID },
        })
        expect(gemeldet.status === 200, `Rückmeldung gab ${gemeldet.status}`)
        expect((await gemeldet.json()).syncState === 'im-kalender', 'syncState wurde nicht gesetzt')

        const box2 = await (await req('/api/hermes/calendar-outbox', { auth: 'bearer' })).json()
        expect(!box2.auftraege.some((a) => a.id === terminId), 'der erledigte Termin steht noch im Postausgang')

        // 5 — Erfolg OHNE UID muss abgelehnt werden: ohne sie liesse sich der
        //     Termin weder wiedererkennen noch je wieder löschen.
        const ohneUid = await req(`/api/hermes/calendar-outbox/${terminId}`, {
          method: 'PATCH', auth: 'bearer', body: { ok: true },
        })
        expect(ohneUid.status === 409 || ohneUid.status === 400,
          `Erfolg ohne UID gab ${ohneUid.status}, erwartet 400/409`)

        // 6 — Löschen eines Termins MIT UID erzeugt einen Löschauftrag,
        //     löscht ihn aber noch nicht lokal — sonst wäre er im echten
        //     Kalender verwaist.
        const geloescht = await req(`/api/calendar/outbox/${terminId}`, { method: 'DELETE', auth: 'basic' })
        expect(geloescht.status === 200, `Löschen gab ${geloescht.status}`)
        const gdaten = await geloescht.json()
        expect(gdaten.sofortWeg === false, 'ein Termin mit UID darf nicht sofort verschwinden')

        const box3 = await (await req('/api/hermes/calendar-outbox', { auth: 'bearer' })).json()
        const auftrag = box3.auftraege.find((a) => a.id === terminId)
        expect(!!auftrag && auftrag.art === 'loeschen', 'kein Löschauftrag im Postausgang')
        expect(auftrag.calUid === UID, 'dem Löschauftrag fehlt die UID')

        // 7 — Löschung quittieren → jetzt ist er auch lokal weg.
        const fertig = await req(`/api/hermes/calendar-outbox/${terminId}`, {
          method: 'PATCH', auth: 'bearer', body: { ok: true },
        })
        expect(fertig.status === 200, `Löschquittung gab ${fertig.status}`)
        expect((await fertig.json()).entfernt === true, 'der Termin wurde lokal nicht entfernt')
        untrash('events', terminId)
        terminId = null

        return `offen → UID → im-kalender → Löschauftrag → weg${box1.zielKalender ? ` (Ziel: ${box1.zielKalender})` : ' (ohne Zielkalender, Hinweis vorhanden)'}`
      } finally {
        if (terminId) await req(`/api/hermes/events/${terminId}`, { method: 'DELETE', auth: 'bearer' }).catch(() => {})
      }
    },
  },
  {
    label: 'Hermes-Schnittstelle weist fremde Aufrufer ab',
    async run() {
      const ohne = await req('/api/hermes/ping')
      expect(ohne.status === 401, `ohne Token: ${ohne.status}, erwartet 401`)
      const falsch = await req('/api/hermes/ping', { auth: { raw: 'Bearer nicht-das-richtige-token' } })
      expect(falsch.status === 401, `mit falschem Token: ${falsch.status}, erwartet 401`)
      return 'ohne Token 401, mit falschem Token 401'
    },
  },
  {
    label: 'GET /api/brain findet den Vault-Spiegel',
    async run() {
      const res = await req('/api/brain', { auth: 'basic' })
      expect(res.ok, `Status ${res.status}` + (res.status === 401 ? ' — AUTH_PASS stimmt nicht' : ''))
      const data = await res.json()
      expect(data.ok === true, 'ok:false — kein Vault gefunden (SECOND_BRAIN_PATH prüfen)')
      expect(typeof data.text === 'string' && data.text.length > MIN_BRAIN_CHARS,
        `nur ${data.text?.length ?? 0} Zeichen, erwartet > ${MIN_BRAIN_CHARS}`)
      return `${data.text.length} Zeichen aus ${data.pages?.length ?? 0} Seiten`
    },
  },
  {
    label: 'POST /api/anthropic ohne Streaming',
    async run() {
      const res = await req('/api/anthropic', {
        method: 'POST',
        auth: 'basic',
        timeout: AI_TIMEOUT_MS,
        body: {
          model: 'claude-haiku-4-5',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Antworte mit genau einem Wort: Hallo' }],
        },
      })
      expect(res.status !== 503, 'Server hat keinen ANTHROPIC_API_KEY')
      // Den Body erst IM Fehlerfall lesen: stünde der Aufruf im Meldungstext von
      // expect(), liefe er bei jedem Durchgang mit und der Strom wäre verbraucht,
      // bevor die eigentliche Prüfung ihn zu sehen bekommt.
      if (!res.ok) throw new Error(`Status ${res.status}: ${(await res.text()).slice(0, 120)}`)
      const data = await res.json()
      const text = data.content?.find((b) => b.type === 'text')?.text
      expect(text && text.trim().length > 0, 'Antwort enthält keinen Text')
      return `Modell antwortet: "${text.trim().slice(0, 40)}"`
    },
  },
  {
    label: 'POST /api/anthropic mit stream:true',
    async run() {
      const res = await req('/api/anthropic', {
        method: 'POST',
        auth: 'basic',
        timeout: AI_TIMEOUT_MS,
        body: {
          model: 'claude-haiku-4-5',
          max_tokens: 32,
          stream: true,
          messages: [{ role: 'user', content: 'Zähle von eins bis fünf.' }],
        },
      })
      expect(res.status !== 503, 'Server hat keinen ANTHROPIC_API_KEY')
      // Den Body erst IM Fehlerfall lesen: stünde der Aufruf im Meldungstext von
      // expect(), liefe er bei jedem Durchgang mit und der Strom wäre verbraucht,
      // bevor die eigentliche Prüfung ihn zu sehen bekommt.
      if (!res.ok) throw new Error(`Status ${res.status}: ${(await res.text()).slice(0, 120)}`)
      const ct = res.headers.get('content-type') ?? ''
      expect(ct.includes('event-stream'), `Content-Type ist "${ct}", erwartet text/event-stream`)
      const parts = await readStream(res)
      expect(parts.length > 0, 'kein einziges Textstück im Strom angekommen')
      return `${parts.length} Textstücke, zusammen "${parts.join('').trim().slice(0, 40)}"`
    },
  },
  {
    label: 'POST /api/hermes-chat antwortet',
    async run() {
      // Ohne Secret gibt es auf diesem Rechner keinen Listener (Mac-Dev) —
      // übersprungen ist dann die Wahrheit, nicht rot und nicht grün.
      if (!conf('HERMES_WEBHOOK_SECRET')) return { skip: 'kein HERMES_WEBHOOK_SECRET — nur auf der VM prüfbar' }
      const res = await req('/api/hermes-chat', {
        method: 'POST',
        auth: 'basic',
        timeout: 120_000,
        body: { message: 'Kurzer Verbindungstest aus dem Rauchtest — antworte in einem Satz.' },
      })
      expect(res.status !== 503, 'Server meldet hermes_nicht_konfiguriert trotz Secret')
      if (!res.ok) throw new Error(`Status ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const data = await res.json()
      expect(data.ok === true && typeof data.text === 'string' && data.text.trim().length > 0, 'Antwort ohne Text')
      return `Hermes antwortet: "${data.text.trim().slice(0, 60)}"`
    },
  },
  {
    label: 'GET /api/calendar/upcoming liefert ein Array',
    async run() {
      const res = await req('/api/calendar/upcoming', { auth: 'basic' })
      expect(res.ok, `Status ${res.status}`)
      const data = await res.json()
      expect(Array.isArray(data),
        data === null ? 'null — keine Kalenderquelle konfiguriert' : `${typeof data} statt Array`)
      return `${data.length} Termine im Horizont`
    },
  },
]

// ── Ablauf ──────────────────────────────────────────────────────────────────

console.log('')
console.log('  Ziel   :', BASE)
console.log('  Zugang :', PASS ? `Basic als "${USER}"` : 'kein AUTH_PASS gefunden', '·', TOKEN ? 'Hermes-Token vorhanden' : 'kein HERMES_TOKEN')
console.log('')

const width = Math.max(...CHECKS.map((c) => c.label.length))
let failed = 0
let skipped = 0

for (const check of CHECKS) {
  let mark = '✓'
  let detail
  try {
    const out = await check.run()
    // Eine Prüfung darf sich für "hier nicht prüfbar" erklären — das ist weder
    // grün noch rot, und es zählt nicht in die Fehlersumme.
    if (out && typeof out === 'object' && out.skip) { mark = '–'; skipped++; detail = out.skip }
    else detail = out
  } catch (e) {
    mark = '✖'
    failed++
    detail = e.name === 'TimeoutError' ? `keine Antwort binnen ${TIMEOUT_MS / 1000}s` : e.message
  }
  console.log(`  ${mark} ${check.label.padEnd(width)}  ${detail ?? ''}`)
}

const swept = await cleanup()
console.log('')
if (swept) console.log('  ⌫', swept, '\n')

if (failed) {
  console.log(`  ✖ ${failed} von ${CHECKS.length} Prüfungen fehlgeschlagen.`)
  console.log('')
  process.exit(1)
}
console.log(skipped
  ? `  ✓ ${CHECKS.length - skipped} von ${CHECKS.length} Prüfungen bestanden, ${skipped} hier nicht prüfbar.`
  : `  ✓ Alle ${CHECKS.length} Prüfungen bestanden.`)
console.log('')
