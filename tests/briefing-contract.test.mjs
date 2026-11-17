#!/usr/bin/env node --test
// Der Briefing-Vertrag — geprüft gegen echte Dateien, nicht gegen Attrappen.
//
// WARUM node:test UND KEIN FRAMEWORK
// Das Projekt hat bisher keine Testabhängigkeit. Die Fälle hier brauchen keine
// Zaubertricks: sie schreiben in ein temporäres DAILY_DATA_DIR und lesen
// nach. Ein Framework brächte 40 MB node_modules und keinen Erkenntnisgewinn.
//
// WARUM JEDER TEST SEIN EIGENES VERZEICHNIS BEKOMMT
// Diese Tests dürfen NIEMALS an /var/lib/daily geraten. Jeder Fall setzt
// DAILY_DATA_DIR auf ein frisches Verzeichnis unter os.tmpdir() und lädt die
// Module danach neu — sonst hielte der Zwischenspeicher aus dataDir.cjs am
// ersten Pfad fest und ein Fehlgriff bliebe unbemerkt.

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Lädt die Server-Module MIT eigenem Datenverzeichnis. Der Cache-Bruch ist
 *  wesentlich: dataDir.cjs merkt sich den aufgelösten Pfad beim ersten Aufruf. */
function ladeMitDatenDir(dir) {
  process.env.DAILY_DATA_DIR = dir
  const require = createRequire(import.meta.url)
  for (const m of ['dataDir.cjs', 'stateStore.cjs', 'receipts.cjs', 'briefingStore.cjs']) {
    const p = join(ROOT, 'electron', m)
    delete require.cache[require.resolve(p)]
  }
  return {
    stateStore: require(join(ROOT, 'electron', 'stateStore.cjs')),
    receipts: require(join(ROOT, 'electron', 'receipts.cjs')),
    briefingStore: require(join(ROOT, 'electron', 'briefingStore.cjs')),
  }
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'daily-test-'))
}

const LINES = { headerGreeting: 'Guten Morgen', tagline: 'Ein ruhiger Tag', todayLead: 'Eine Sache zählt heute.' }

function berlinHeute() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}
function berlinPlus(tage) {
  return new Date(Date.now() + tage * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' })
}

// ── Sicherung: kein Test darf den echten Bestand berühren ───────────────────

describe('Schutz des Produktivbestands', () => {
  test('DAILY_DATA_DIR zeigt nie auf /var/lib/daily', () => {
    const dir = tempDir()
    const { stateStore } = ladeMitDatenDir(dir)
    assert.ok(!stateStore.STATE_PATH.startsWith('/var/lib/daily'),
      `STATE_PATH zeigt auf ${stateStore.STATE_PATH} — das ist der echte Bestand!`)
    assert.ok(stateStore.STATE_PATH.startsWith(dir), 'STATE_PATH liegt nicht im Testverzeichnis')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ── 1–3: Datum ──────────────────────────────────────────────────────────────

describe('Datumsvertrag', () => {
  let dir, bs
  before(() => { dir = tempDir(); bs = ladeMitDatenDir(dir).briefingStore })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('1 — Berlin-heute wird dynamisch akzeptiert', () => {
    const r = bs.publish({ date: berlinHeute(), text: 'Heute.', lines: LINES })
    assert.equal(r.status, 200)
    assert.equal(r.receipt.result, 'persisted')
    assert.equal(r.receipt.effectiveDate, berlinHeute())
    assert.equal(r.receipt.display.eligibleNow, true)
  })

  test('2 — Berlin-MORGEN wird abgelehnt und nicht gespeichert', () => {
    const morgen = berlinPlus(1)
    const vorher = bs.readBriefing(ladeMitDatenDir(dir).stateStore.read())
    assert.throws(
      () => bs.publish({ date: morgen, text: 'Morgen.', lines: LINES }),
      (e) => e.status === 400 && /datiert/.test(e.message),
    )
    // Entscheidend: der Bestand ist unverändert. Ein abgelehnter Aufruf darf
    // nichts hinterlassen — das war der Fehler vom 15.08. in Reinform.
    const nachher = bs.readBriefing(ladeMitDatenDir(dir).stateStore.read())
    assert.deepEqual(nachher, vorher, 'ein abgelehntes Briefing hat trotzdem geschrieben')
  })

  test('3 — unmögliche Kalenderdaten werden abgelehnt', () => {
    for (const kaputt of ['2026-02-31', '2026-13-01', '2026-00-10', 'morgen', '2026-2-3']) {
      assert.throws(() => bs.publish({ date: kaputt, text: 'X.', lines: LINES }),
        (e) => e.status === 400, `${kaputt} wurde nicht abgelehnt`)
    }
  })

  test('Vorplanung nur ausdrücklich, mit 202 und eligibleNow:false', () => {
    const r = bs.publish({ date: berlinPlus(2), mode: 'scheduled', text: 'Später.', lines: LINES })
    assert.equal(r.status, 202)
    assert.equal(r.receipt.result, 'scheduled')
    assert.equal(r.receipt.display.eligibleNow, false)
    // Das aktuelle Briefing bleibt unangetastet.
    const jetzt = bs.readBriefing(ladeMitDatenDir(dir).stateStore.read())
    assert.equal(jetzt.date, berlinHeute(), 'Vorplanung hat das heutige Briefing ersetzt')
  })
})

// ── 4–7: Quittung, Idempotenz, Patch ────────────────────────────────────────

describe('Quittung und Idempotenz', () => {
  let dir, bs, rc
  before(() => { dir = tempDir(); const m = ladeMitDatenDir(dir); bs = m.briefingStore; rc = m.receipts })
  after(() => rmSync(dir, { recursive: true, force: true }))

  test('4 — Publish → Receipt → Read-after-write → gleicher Hash', () => {
    const r = bs.publish({ date: berlinHeute(), text: 'Kette.', lines: LINES, requestId: 'r4' })
    assert.match(r.receipt.storedSha256, /^[a-f0-9]{64}$/)
    // Unabhängig nachrechnen, was auf der Platte steht.
    const gelesen = bs.readBriefing(ladeMitDatenDir(dir).stateStore.read())
    assert.equal(bs.revision(gelesen), r.receipt.storedSha256)
    const v = rc.verify(r.receipt.receiptId, bs.revision(gelesen))
    assert.equal(v.status, 'current')
  })

  test('5 — dieselbe requestId mit gleichem Inhalt schreibt kein zweites Mal', () => {
    const eins = bs.publish({ date: berlinHeute(), text: 'Idem.', lines: LINES, requestId: 'r5' })
    const stand1 = ladeMitDatenDir(dir).stateStore.read().updatedAt
    const zwei = bs.publish({ date: berlinHeute(), text: 'Idem.', lines: LINES, requestId: 'r5' })
    const stand2 = ladeMitDatenDir(dir).stateStore.read().updatedAt
    assert.equal(zwei.wiederholung, true)
    assert.equal(zwei.receipt.receiptId, eins.receipt.receiptId, 'zweite Quittung statt derselben')
    assert.equal(stand1, stand2, 'der Zustand wurde ein zweites Mal geschrieben')
  })

  test('6 — dieselbe requestId mit anderem Inhalt ergibt 409', () => {
    bs.publish({ date: berlinHeute(), text: 'Erst.', lines: LINES, requestId: 'r6' })
    assert.throws(
      () => bs.publish({ date: berlinHeute(), text: 'ANDERS.', lines: LINES, requestId: 'r6' }),
      (e) => e.status === 409,
    )
  })

  test('7 — Patch weist Bewahrtes und Gekürztes in der Quittung aus', () => {
    bs.publish({ date: berlinHeute(), text: 'Basis.', lines: LINES, requestId: 'r7a' })
    const r = bs.publish({
      date: berlinHeute(), mode: 'patch',
      lines: { tagline: 'x'.repeat(200) },
      requestId: 'r7b',
    })
    assert.ok(r.receipt.preservedFields.includes('text'), 'text nicht als bewahrt ausgewiesen')
    assert.ok(r.receipt.preservedFields.includes('lines.headerGreeting'))
    const t = r.receipt.transformations.find((x) => x.field === 'lines.tagline')
    assert.ok(t && t.kind === 'truncated', 'Kürzung nicht ausgewiesen')
    assert.ok(r.briefing.lines.tagline.length <= 70)
    assert.equal(r.briefing.text, 'Basis.', 'bewahrter Text ging verloren')
  })

  test('ungültige line-Typen und Leerstrings werden abgelehnt, nicht still verworfen', () => {
    for (const kaputt of [{ tagline: 42 }, { tagline: null }, { todayLead: ['a'] }, { headerGreeting: '   ' }]) {
      assert.throws(() => bs.publish({ date: berlinHeute(), mode: 'patch', lines: kaputt }),
        (e) => e.status === 400, `${JSON.stringify(kaputt)} kam durch`)
    }
  })

  test('Alert-Semantik: fehlt=behalten, null=entfernen, Objekt=setzen', () => {
    const heute = berlinHeute()
    bs.publish({ date: heute, text: 'Mit Alert.', lines: LINES, alert: { id: 'a1', title: 'Frist' }, requestId: 'a-1' })
    // fehlt → bleibt
    const behalten = bs.publish({ date: heute, text: 'Ohne Feld.', lines: LINES, requestId: 'a-2' })
    assert.equal(behalten.briefing.alert?.id, 'a1')
    assert.ok(behalten.receipt.preservedFields.includes('alert'))
    // null → weg
    const weg = bs.publish({ date: heute, text: 'Explizit weg.', lines: LINES, alert: null, requestId: 'a-3' })
    assert.equal(weg.briefing.alert, undefined)
  })
})

// ── 8: Fail-closed ──────────────────────────────────────────────────────────

describe('stateStore fail-closed', () => {
  test('8 — kaputtes JSON: kein EMPTY-Fallback, kein Überschreiben', () => {
    const dir = tempDir()
    const { stateStore } = ladeMitDatenDir(dir)
    // Erst einen echten Zustand anlegen …
    stateStore.write({ localStorage: { 'morning.wichtig': 'daten' }, indexedDB: { todos: [], importantEvents: [], aiMessages: [] } })
    const vorher = readFileSync(stateStore.STATE_PATH, 'utf-8')
    // … dann beschädigen.
    writeFileSync(stateStore.STATE_PATH, '{ das ist kein json')

    assert.throws(() => stateStore.read(), (e) => e.code === 'STATE_UNREADABLE')
    // Und der entscheidende Teil: ein Schreibversuch darf NICHT durchgehen.
    assert.throws(
      () => stateStore.write({ localStorage: {}, indexedDB: { todos: [], importantEvents: [], aiMessages: [] } }),
      (e) => e.code === 'STATE_UNREADABLE',
      'ein kaputter Zustand liess sich überschreiben',
    )
    assert.equal(readFileSync(stateStore.STATE_PATH, 'utf-8'), '{ das ist kein json',
      'die beschädigte Datei wurde trotzdem verändert')
    assert.equal(stateStore.readiness().ok, false)
    rmSync(dir, { recursive: true, force: true })
  })

  test('8b — unlesbare Datei (EACCES) verhält sich genauso', { skip: process.getuid && process.getuid() === 0 }, () => {
    const dir = tempDir()
    const { stateStore } = ladeMitDatenDir(dir)
    stateStore.write({ localStorage: { 'morning.x': '1' }, indexedDB: { todos: [], importantEvents: [], aiMessages: [] } })
    chmodSync(stateStore.STATE_PATH, 0o000)
    try {
      assert.throws(() => stateStore.read(), (e) => e.code === 'STATE_UNREADABLE')
    } finally {
      chmodSync(stateStore.STATE_PATH, 0o644)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('fehlende Datei ist LEGITIM leer — nur ENOENT darf das', () => {
    const dir = tempDir()
    const { stateStore } = ladeMitDatenDir(dir)
    const leer = stateStore.read()
    assert.equal(leer.updatedAt, null)
    assert.deepEqual(leer.localStorage, {})
    rmSync(dir, { recursive: true, force: true })
  })
})

// ── 9: Überdauern eines Neustarts ───────────────────────────────────────────

describe('Quittungen überdauern einen Neustart', () => {
  test('9 — current bleibt current; eine neue Revision macht sie superseded', () => {
    const dir = tempDir()
    let m = ladeMitDatenDir(dir)
    const r = m.briefingStore.publish({ date: berlinHeute(), text: 'Vor dem Neustart.', lines: LINES, requestId: 'n1' })
    const id = r.receipt.receiptId
    const sha = r.receipt.storedSha256

    // "Neustart": alle Module frisch laden, nichts im Speicher behalten.
    m = ladeMitDatenDir(dir)
    m.receipts._reset()
    let aktuell = m.briefingStore.revision(m.briefingStore.readBriefing(m.stateStore.read()))
    assert.equal(aktuell, sha, 'nach dem Neustart steht ein anderer Inhalt da')
    assert.equal(m.receipts.verify(id, aktuell).status, 'current')

    // Eine spätere Revision macht die alte superseded.
    m.briefingStore.publish({ date: berlinHeute(), text: 'Danach etwas anderes.', lines: LINES, requestId: 'n2' })
    aktuell = m.briefingStore.revision(m.briefingStore.readBriefing(m.stateStore.read()))
    assert.equal(m.receipts.verify(id, aktuell).status, 'superseded')
    rmSync(dir, { recursive: true, force: true })
  })

  test('rendered kommt NIE aus dem POST, nur aus der Browser-Meldung', () => {
    const dir = tempDir()
    const m = ladeMitDatenDir(dir)
    const r = m.briefingStore.publish({ date: berlinHeute(), text: 'Render.', lines: LINES, requestId: 'rd1' })
    assert.equal(r.receipt.display.renderStatus, 'pending', 'POST hat sich selbst als gerendert gemeldet')

    const sha = r.receipt.storedSha256
    const aktuell = m.briefingStore.revision(m.briefingStore.readBriefing(m.stateStore.read()))
    assert.equal(m.receipts.verify(r.receipt.receiptId, aktuell).status, 'current')

    m.receipts.markRendered(sha, ['card', 'greeting', 'tagline', 'todayLead'])
    assert.equal(m.receipts.verify(r.receipt.receiptId, aktuell).status, 'rendered')

    // Ein Hash, den es nie gab, lässt sich nicht bestätigen.
    const erfunden = 'f'.repeat(64)
    assert.equal(m.receipts.markRendered(erfunden, ['card']).matched, 0)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ── 11: Statusmeldung für die Oberfläche ────────────────────────────────────

describe('Statusmeldung', () => {
  test('11 — fehlend / alt / teilweise ergibt unterscheidbare Zustände', () => {
    const dir = tempDir()
    const m = ladeMitDatenDir(dir)

    assert.equal(m.briefingStore.status().state, 'missing')

    m.briefingStore.publish({ date: berlinHeute(), text: 'Voll.', lines: LINES, requestId: 's1' })
    const voll = m.briefingStore.status()
    assert.equal(voll.state, 'fresh')
    assert.equal(voll.eligibleNow, true)
    assert.deepEqual(voll.fallbackFields, [], 'bei vollem Briefing darf nichts lokal sein')

    // Teilweise: nur Text, keine Zeilen → alle drei Zeilen sind lokal.
    const dir2 = tempDir()
    const m2 = ladeMitDatenDir(dir2)
    m2.briefingStore.publish({ date: berlinHeute(), mode: 'patch', text: 'Nur Text.' })
    const teil = m2.briefingStore.status()
    assert.equal(teil.state, 'fresh')
    assert.deepEqual(teil.fallbackFields.sort(), ['headerGreeting', 'tagline', 'todayLead'])

    rmSync(dir, { recursive: true, force: true })
    rmSync(dir2, { recursive: true, force: true })
  })
})
