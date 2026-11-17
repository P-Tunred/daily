// Projekte: Regeln (src/lib/projekte.ts), Versionsprüfung (/api/projekte) und
// was Hermes darf (/api/hermes/projekte).
//
// WARUM DIESE TESTS EXISTIEREN
// Browser und Hermes schreiben in denselben Wert. Drei Zusagen an Paul hängen
// daran: Hermes löscht nichts, Hermes überschreibt Pauls eigenen Satz nicht,
// und ein Vorschlag ändert nichts, bis Paul ihn übernimmt. Dazu darf ein
// veraltetes Fenster mit seinem Gesamt-Upload die Projekte nicht plattmachen.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const P = require('../src/lib/projekte.ts')

let zaehler = 0
const k = (von = 'paul', am = '2026-11-10T09:00:00.000Z') => ({ am, von, neueId: () => `id${++zaehler}` })

function mitProjekt(eingabe = {}) {
  return P.legeAn(P.leer(), { name: 'Portfolio-Website', status: 'laeuft', schritte: ['Domain wählen', 'Ausliefern', 'Verlinken'], ...eingabe }, k())
}

describe('Projekte: Regeln', () => {
  test('nächster Schritt ist der erste offene, Fortschritt zählt Haken', () => {
    const { stand, projekt } = mitProjekt()
    const s2 = P.hakeAb(stand, projekt.id, projekt.schritte[0].id, k())
    const p = P.findeProjekt(s2, projekt.id)
    assert.equal(P.naechsterSchritt(p).text, 'Ausliefern')
    assert.equal(P.erledigtZahl(p), 1)
    assert.equal(p.zuletzt.text, 'Erledigt: Domain wählen')
    assert.equal(P.istGueltig(s2), true)
    assert.equal(P.erledigtZahl(P.findeProjekt(stand, projekt.id)), 0, 'alter Stand bleibt unverändert')
  })

  test('Stand aus Claude: nur ein neuerer ersetzt, Pauls Satz bleibt, Übernehmen blendet aus', () => {
    const { stand, projekt } = mitProjekt()
    const eins = P.setzeClaudeStand(stand, projekt.id, { text: 'Karte gebaut.', am: '2026-11-10T18:00:00Z', titel: 'Portfolio' })
    assert.equal(eins.geaendert, true)
    const p1 = P.findeProjekt(eins.stand, projekt.id)
    assert.equal(p1.claude.text, 'Karte gebaut.')
    assert.equal(p1.zuletzt, null, 'zuletzt bleibt unberührt')
    assert.equal(P.istGueltig(eins.stand), true)
    assert.equal(P.zuletztAktiv(p1), '2026-11-10T18:00:00.000Z')
    assert.equal(P.neuerClaudeStand(p1).text, 'Karte gebaut.')

    const alt = P.setzeClaudeStand(eins.stand, projekt.id, { text: 'Älter.', am: '2026-11-10T12:00:00Z', titel: 'Portfolio' })
    assert.equal(alt.geaendert, false)
    assert.equal(alt.stand, eins.stand)

    const uebernommen = P.setzeZuletzt(eins.stand, projekt.id, p1.claude.text, k('paul', '2026-11-11T08:00:00.000Z'))
    assert.equal(P.neuerClaudeStand(P.findeProjekt(uebernommen, projekt.id)), null)
    const macUhrVor = P.setzeZuletzt(eins.stand, projekt.id, p1.claude.text, k('paul', '2026-11-10T17:59:00.000Z'))
    assert.equal(P.neuerClaudeStand(P.findeProjekt(macUhrVor, projekt.id)), null, 'gleicher Text gilt als übernommen')

    assert.throws(() => P.setzeClaudeStand(stand, projekt.id, { text: 'x', am: 'gestern', titel: 't' }), (e) => e.status === 400)
    assert.throws(() => P.setzeClaudeStand(stand, projekt.id, { text: '', am: '2026-11-09T18:00:00Z', titel: 't' }), (e) => e.status === 400)
    assert.equal(P.istGueltig(stand), true, 'Projekte ohne Feld claude bleiben gültig')
  })

  test('Abhaken bei „will ich machen" setzt das Projekt auf „läuft"', () => {
    const { stand, projekt } = mitProjekt({ status: 'idee' })
    const s2 = P.hakeAb(stand, projekt.id, projekt.schritte[0].id, k())
    assert.equal(P.findeProjekt(s2, projekt.id).status, 'laeuft')
  })

  test('Hermes überschreibt Pauls Satz nicht, setzt ihn aber, wenn keiner da ist', () => {
    const { stand, projekt } = mitProjekt()
    const vonHermes = P.setzeZuletzt(stand, projekt.id, 'Commit: Karte fertig', k('hermes'))
    assert.equal(P.findeProjekt(vonHermes, projekt.id).zuletzt.von, 'hermes')
    const vonPaul = P.setzeZuletzt(vonHermes, projekt.id, 'Bin bei der Domain', k('paul'))
    assert.throws(() => P.setzeZuletzt(vonPaul, projekt.id, 'Neuer Commit', k('hermes')), (e) => e.status === 409)
  })

  test('ein Vorschlag ändert nichts, bis Paul ihn übernimmt — und wird festgehalten', () => {
    const { stand, projekt } = mitProjekt()
    const gehakt = P.hakeAb(stand, projekt.id, projekt.schritte[0].id, k())
    const gewuenscht = P.wuenscheVorschlag(gehakt, projekt.id, k())
    assert.ok(P.findeProjekt(gewuenscht, projekt.id).vorschlagGewuenscht)
    const { stand: mitV, vorschlag } = P.schlageVor(gewuenscht, projekt.id, { text: 'Erst live, dann feilen.', schritte: ['Server prüfen', 'DNS setzen'] }, k('hermes'))
    const pv = P.findeProjekt(mitV, projekt.id)
    assert.equal(pv.schritte.length, 3, 'Vorschlag allein fügt keine Schritte ein')
    assert.equal(pv.vorschlagGewuenscht, null, 'Wunsch ist erfüllt')

    const angenommen = P.entscheide(mitV, projekt.id, vorschlag.id, 'uebernommen', k())
    const pa = P.findeProjekt(angenommen, projekt.id)
    assert.deepEqual(pa.schritte.map((s) => s.text), ['Domain wählen', 'Server prüfen', 'DNS setzen', 'Ausliefern', 'Verlinken'])
    assert.equal(P.naechsterSchritt(pa).text, 'Server prüfen')
    assert.equal(pa.vorschlaege.length, 0)
    assert.equal(angenommen.entscheidungen[0].ergebnis, 'uebernommen')

    const verworfen = P.entscheide(mitV, projekt.id, vorschlag.id, 'verworfen', k())
    assert.equal(P.findeProjekt(verworfen, projekt.id).schritte.length, 3)
    assert.equal(verworfen.entscheidungen[0].ergebnis, 'verworfen')
  })

  test('höchstens drei Vorschläge warten; der älteste fällt raus', () => {
    let { stand, projekt } = mitProjekt()
    for (const t of ['eins', 'zwei', 'drei', 'vier']) stand = P.schlageVor(stand, projekt.id, { text: t }, k('hermes')).stand
    assert.deepEqual(P.findeProjekt(stand, projekt.id).vorschlaege.map((v) => v.text), ['zwei', 'drei', 'vier'])
  })

  test('Namen doppelt, leer oder zu lang werden abgewiesen', () => {
    const { stand } = mitProjekt()
    assert.throws(() => P.legeAn(stand, { name: 'portfolio-website' }, k()), (e) => e.status === 409)
    assert.throws(() => P.legeAn(stand, { name: '   ' }, k()), (e) => e.status === 400)
    assert.throws(() => P.legeAn(stand, { name: 'x'.repeat(81) }, k()), (e) => e.status === 400)
    assert.throws(() => P.legeAn(stand, { name: 'Neu', status: 'fertig' }, k()), (e) => e.status === 400)
  })

  test('Projekte lassen sich per Name finden, Notizen stehen neueste zuerst', () => {
    const { stand } = mitProjekt()
    let s = P.fuegeEintragHinzu(stand, 'portfolio-website', 'notizen', 'erste', k())
    s = P.fuegeEintragHinzu(s, 'Portfolio-Website', 'notizen', 'zweite', k())
    assert.deepEqual(P.findeProjekt(s, 'Portfolio-Website').notizen.map((n) => n.text), ['zweite', 'erste'])
  })

  test('lese: fehlend ist leer, kaputt ist null', () => {
    assert.deepEqual(P.lese(null), P.leer())
    assert.equal(P.lese('{kaputt'), null)
    assert.equal(P.lese(JSON.stringify({ version: 2, projekte: [], entscheidungen: [] })), null)
  })

  test('wannText rechnet in Berlin', () => {
    const jetzt = Date.parse('2026-11-10T08:00:00Z')
    assert.equal(P.wannText('2026-11-09T23:30:00Z', jetzt), 'heute') // 00:30 in Berlin
    assert.equal(P.wannText('2026-11-09T10:00:00Z', jetzt), 'gestern')
    assert.equal(P.wannText('2026-11-06T10:00:00Z', jetzt), 'vor 4 Tagen')
    assert.match(P.wannText('2026-10-01T10:00:00Z', jetzt), /1\. Okt/)
  })

  test('sortiert: läuft vor will ich machen vor pausiert, Aktives zuerst', () => {
    let s = P.leer()
    s = P.legeAn(s, { name: 'Alt', status: 'laeuft' }, k('paul', '2026-10-01T10:00:00Z')).stand
    s = P.legeAn(s, { name: 'Idee', status: 'idee' }, k('paul', '2026-11-09T10:00:00Z')).stand
    s = P.legeAn(s, { name: 'Neu', status: 'laeuft' }, k('paul', '2026-11-08T10:00:00Z')).stand
    s = P.legeAn(s, { name: 'Ruht', status: 'pause' }, k('paul', '2026-11-10T10:00:00Z')).stand
    assert.deepEqual(P.sortiert(s.projekte).map((p) => p.name), ['Neu', 'Alt', 'Idee', 'Ruht'])
  })
})

describe('Projekte: Server', () => {
  test('Versionsprüfung, Schutz vor Gesamt-Upload und was Hermes darf', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projekte-api-'))
    const server = spawn(process.execPath, ['-e', "require('./electron/server.cjs').startServer(4893)"], {
      env: { ...process.env, DAILY_DATA_DIR: dir, AUTH_PASS: '', HERMES_TOKEN: 'test-only', SECOND_BRAIN_PATH: dir },
      stdio: 'ignore',
    })
    const base = 'http://127.0.0.1:4893'
    const put = (url, value) => fetch(base + url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
    const hermes = (method, route, body) => fetch(base + '/api/hermes' + route, {
      method,
      headers: { Authorization: 'Bearer test-only', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    try {
      for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/api/health')).ok) break } catch {} await new Promise((r) => setTimeout(r, 100)) }

      // Leer am Anfang
      assert.equal((await (await fetch(base + '/api/projekte')).json()).value, null)

      // Browser schreibt mit Versionsprüfung
      const { stand } = mitProjekt()
      const value = JSON.stringify(stand)
      assert.equal((await put('/api/projekte', { base: null, value })).status, 200)
      assert.equal((await put('/api/projekte', { base: null, value })).status, 409, 'veraltete Basis')
      assert.equal((await put('/api/projekte', { base: value, value: JSON.stringify({ version: 1, projekte: [{ id: 'x' }], entscheidungen: [] }) })).status, 400, 'ungültige Form')

      // Ein Gesamt-Upload des Browsers lässt die Projekte stehen
      const state = await (await fetch(base + '/api/state')).json()
      assert.equal((await put('/api/state', { baseUpdatedAt: state.updatedAt, localStorage: { 'morning.projekte': '{"alt":1}' }, indexedDB: state.indexedDB })).status, 200)
      assert.equal((await (await fetch(base + '/api/projekte')).json()).value, value)

      // Hermes ohne Token: nichts
      assert.equal((await fetch(base + '/api/hermes/projekte')).status, 401)

      // Hermes legt an und ergänzt
      const angelegt = await hermes('POST', '/projekte', { name: 'GitHub verbessern', schritte: ['Bio schreiben'], notiz: 'AGPL beim Fork nennen' })
      assert.equal(angelegt.status, 201)
      const gh = (await angelegt.json()).projekt
      assert.equal(gh.angelegt.von, 'hermes')
      assert.equal(gh.status, 'idee')
      assert.equal((await hermes('POST', `/projekte/${gh.id}/ideen`, { text: 'Bild pro Projekt' })).status, 201)
      assert.equal((await hermes('POST', '/projekte/Portfolio-Website/schritte', { schritte: ['README verlinken'] })).status, 201, 'per Name')
      assert.equal((await hermes('POST', `/projekte/${gh.id}/vorschlaege`, { text: 'Erst Bio, dann README.', schritte: ['Bio', 'README'] })).status, 201)
      assert.equal((await hermes('POST', `/projekte/${gh.id}/zuletzt`, { text: 'Profil ist leer.' })).status, 201)

      // Stand aus Claude (vom Mac): neu → 201, gleich alt → 200 ohne Änderung
      const cs = { text: 'README entworfen.', am: '2026-11-10T07:00:00Z', titel: 'GitHub Profil' }
      const c1 = await hermes('POST', '/projekte/GitHub verbessern/claude', cs)
      assert.equal(c1.status, 201)
      assert.equal((await c1.json()).geaendert, true)
      const c2 = await hermes('POST', `/projekte/${gh.id}/claude`, cs)
      assert.equal(c2.status, 200)
      assert.equal((await c2.json()).geaendert, false)

      // …aber löscht, hakt ab und ändert nichts
      for (const m of ['DELETE', 'PATCH', 'PUT']) assert.equal((await hermes(m, `/projekte/${gh.id}`, m === 'DELETE' ? undefined : {})).status, 403)
      assert.equal((await hermes('POST', `/projekte/${gh.id}/loeschen`, {})).status, 404)
      assert.equal((await hermes('POST', '/projekte/gibts-nicht/notizen', { text: 'x' })).status, 404)
      assert.equal((await hermes('POST', '/projekte', { name: 'github verbessern' })).status, 409, 'doppelt')

      // Übersicht für Hermes
      const ue = await (await hermes('GET', '/projekte')).json()
      assert.equal(ue.projekte.length, 2)
      const pw = ue.projekte.find((p) => p.name === 'Portfolio-Website')
      assert.equal(pw.naechsterSchritt, 'Domain wählen')
      assert.deepEqual(pw.fortschritt, { erledigt: 0, gesamt: 4 })
      const ghUe = ue.projekte.find((p) => p.id === gh.id)
      assert.equal(ghUe.vorschlaege.length, 1)
      assert.equal(ghUe.ideen[0].von, 'hermes')
      assert.equal(ghUe.claude.text, 'README entworfen.')
      assert.equal(ghUe.zuletzt.text, 'Profil ist leer.', 'Claude-Stand ersetzt zuletzt nicht')

      // Hermes' Schreiben ist für den Browser mit Versionsprüfung sichtbar
      const neu = (await (await fetch(base + '/api/projekte')).json()).value
      assert.notEqual(neu, value)
      assert.equal((await put('/api/projekte', { base: value, value })).status, 409, 'alter Browserstand kommt nicht mehr durch')
    } finally {
      server.kill()
      await new Promise((r) => server.once('exit', r))
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
