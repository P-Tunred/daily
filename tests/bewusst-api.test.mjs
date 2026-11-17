import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

test('Bewusst CAS persists only its key; stale full-browser sync cannot erase it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bewusst-api-'));
  const server = spawn(process.execPath, ['-e', "require('./electron/server.cjs').startServer(4899)"], { env: { ...process.env, DAILY_DATA_DIR: dir, AUTH_PASS: '', HERMES_TOKEN: 'test-only' }, stdio: 'ignore' });
  const base = 'http://127.0.0.1:4899';
  try {
    for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
    const put = (url, value) => fetch(base + url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const value = JSON.stringify({ version: 1, plans: [], periods: {} });
    assert.equal((await put('/api/bewusst', { base: null, value })).status, 200);
    assert.equal((await put('/api/bewusst', { base: null, value })).status, 409);
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.localStorage['morning.bewusst.v1'], value);
    assert.equal((await put('/api/state', { baseUpdatedAt: state.updatedAt, localStorage: { 'morning.unrelated': 'preserved' }, indexedDB: state.indexedDB })).status, 200);
    const readback = await (await fetch(base + '/api/state')).json();
    assert.equal(readback.localStorage['morning.bewusst.v1'], value);
    assert.equal(readback.localStorage['morning.unrelated'], 'preserved');
    assert.equal((await put('/api/bewusst', { base: value, value: 'bad json' })).status, 400);
    for (const invalid of [
      { version: 1, plans: [], periods: { x: null } },
      { version: 1, plans: [{ cadence: 'day', effective: '2026-02-31', revision: 'r1', goals: [] }], periods: {} },
    ]) assert.equal((await put('/api/bewusst', { base: value, value: JSON.stringify(invalid) })).status, 400);
    assert.equal((await (await fetch(base + '/api/bewusst')).json()).value, value);

    // Der Sprung der Server-Marke wird gemeldet — und mit der gemeldeten Marke
    // geht der nächste Gesamt-Upload durch, statt mit 409 Browserdaten zu
    // verlieren (gefunden 2026-10-13, siehe src/lib/syncBasis.ts).
    const vorher = (await (await fetch(base + '/api/state')).json()).updatedAt;
    const next = JSON.stringify({ version: 1, plans: [{ cadence: 'day', effective: '2026-10-01', revision: 'r1', goals: [] }], periods: {} });
    assert.notEqual(next, value, 'Testvoraussetzung: ein echter Schreibvorgang');
    const antwort = await put('/api/bewusst', { base: value, value: next });
    assert.equal(antwort.status, 200);
    const sprung = await antwort.json();
    assert.equal(sprung.vorher, vorher);
    assert.notEqual(sprung.updatedAt, vorher);
    const jetzt = await (await fetch(base + '/api/state')).json();
    assert.equal(sprung.updatedAt, jetzt.updatedAt);
    assert.equal((await put('/api/state', { baseUpdatedAt: vorher, localStorage: { 'morning.x': '1' }, indexedDB: jetzt.indexedDB })).status, 409, 'alte Marke: weiter abgewiesen');
    assert.equal((await put('/api/state', { baseUpdatedAt: sprung.updatedAt, localStorage: { 'morning.x': '1' }, indexedDB: jetzt.indexedDB })).status, 200, 'gemeldete Marke: angenommen');
  } finally { server.kill(); await new Promise(r => server.once('exit', r)); rmSync(dir, { recursive: true, force: true }); }
});
