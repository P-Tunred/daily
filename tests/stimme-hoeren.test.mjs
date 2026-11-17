// Mit Hermes sprechen: die Spracherkennung (stimmeHoeren.cjs).
//
// WARUM DIESE TESTS EXISTIEREN
// Die Erkennung läuft als dauerhafter Python-Prozess (faster-whisper aus
// Hermes' Installation), damit das Modell nur einmal lädt. Geprüft wird mit
// einem nachgebauten Prozess: dass Aufträge der Reihe nach beantwortet werden,
// dass ein abgestürzter Prozess beim nächsten Mal neu startet, dass ein
// Fehler als Fehler ankommt — und dass die Aufnahme danach gelöscht ist.

import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const DIR = mkdtempSync(join(tmpdir(), 'stimme-hoeren-'))
process.env.DAILY_DATA_DIR = DIR

// Der nachgebaute Erkenner: liest Aufträge, „erkennt" den Dateiinhalt.
// Inhalt "ABSTURZ" beendet den Prozess, "KAPUTT" meldet einen Fehler,
// "ORTE" verrät, wohin Modell und Hugging-Face-Zwischenspeicher sollen.
const FAKE = join(DIR, 'fake-whisper.mjs')
writeFileSync(FAKE, `
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
console.log(JSON.stringify({ bereit: true }))
for await (const zeile of createInterface({ input: process.stdin })) {
  const a = JSON.parse(zeile)
  const inhalt = readFileSync(a.pfad, 'utf8')
  if (inhalt === 'ABSTURZ') process.exit(3)
  if (inhalt === 'ORTE') console.log(JSON.stringify({ id: a.id, text: process.env.WHISPER_DIR + '|' + process.env.HF_HOME, sek: 0 }))
  else if (inhalt === 'KAPUTT') console.log(JSON.stringify({ id: a.id, fehler: 'Audio unlesbar' }))
  else console.log(JSON.stringify({ id: a.id, text: 'erkannt: ' + inhalt, sek: 1.5 }))
}
`)
process.env.DAILY_WHISPER_PYTHON = process.execPath
process.env.DAILY_WHISPER_SKRIPT = FAKE
const hoeren = require('../electron/stimmeHoeren.cjs')

after(() => { hoeren._beenden(); rmSync(DIR, { recursive: true, force: true }) })

describe('Spracherkennung', () => {
  test('bereit, wenn der Erkenner da ist', () => {
    assert.equal(hoeren.bereit(), true)
  })

  test('erkennt eine Aufnahme', async () => {
    const r = await hoeren.erkenne(Buffer.from('Hallo Hermes'), 'audio/webm')
    assert.deepEqual(r, { text: 'erkannt: Hallo Hermes', sek: 1.5 })
  })

  test('mehrere Aufträge auf einmal kommen richtig zugeordnet zurück', async () => {
    const r = await Promise.all(['eins', 'zwei', 'drei'].map((t) => hoeren.erkenne(Buffer.from(t), 'audio/webm')))
    assert.deepEqual(r.map((x) => x.text), ['erkannt: eins', 'erkannt: zwei', 'erkannt: drei'])
  })

  test('Modell und Zwischenspeicher landen im Datenordner (auf der VM sonst schreibgeschützt)', async () => {
    const [modell, hf] = (await hoeren.erkenne(Buffer.from('ORTE'), 'audio/wav')).text.split('|')
    assert.equal(modell, join(DIR, 'whisper'))
    assert.equal(hf, join(DIR, 'whisper', 'hf'))
  })

  test('Fehler des Erkenners kommt als Fehler an', async () => {
    await assert.rejects(hoeren.erkenne(Buffer.from('KAPUTT'), 'audio/webm'), /Audio unlesbar/)
  })

  test('nach einem Absturz startet er beim nächsten Auftrag neu', async () => {
    await assert.rejects(hoeren.erkenne(Buffer.from('ABSTURZ'), 'audio/webm'), /beendet/)
    const r = await hoeren.erkenne(Buffer.from('wieder da'), 'audio/webm')
    assert.equal(r.text, 'erkannt: wieder da')
  })

  test('die Aufnahme bleibt nicht liegen', async () => {
    const vorher = hoeren._letzterPfad()
    await hoeren.erkenne(Buffer.from('weg damit'), 'audio/mp4')
    const pfad = hoeren._letzterPfad()
    assert.notEqual(pfad, vorher)
    assert.match(pfad, /\.mp4$/)
    assert.equal(existsSync(pfad), false)
  })

  test('leere oder zu grosse Aufnahme wird abgelehnt, ohne den Erkenner zu fragen', async () => {
    await assert.rejects(hoeren.erkenne(Buffer.alloc(0), 'audio/webm'), /leer/)
    await assert.rejects(hoeren.erkenne(Buffer.alloc(hoeren.MAX_BYTES + 1), 'audio/webm'), /gross/)
  })
})
