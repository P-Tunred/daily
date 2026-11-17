import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const BASE = 'http://127.0.0.1:4898';
let server, dir;
test.beforeAll(async () => {
 dir = mkdtempSync(join(tmpdir(), 'bewusst-e2e-'));
 server = spawn(process.execPath, ['-e', "require('./electron/server.cjs').startServer(4898)"], { env: { ...process.env, DAILY_DATA_DIR: dir, AUTH_PASS: '', HERMES_TOKEN: 'test-only', CALENDAR_JSON_PATH: '/nonexistent', SECOND_BRAIN_PATH: '/nonexistent' }, stdio: 'ignore' });
 await expect.poll(async () => { try { return (await fetch(BASE+'/api/health')).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(() => { server?.kill(); if (dir) rmSync(dir,{recursive:true,force:true}); });
async function open(page) {
 await page.goto(BASE);
 const later = page.getByRole('button',{name:'Später',exact:true}); if(await later.count()) await later.first().click();
 await expect(page.locator('#bewusst-leben').getByRole('button',{name:/Ideen ansehen|Abend-Rückblick/})).toBeVisible();
 await expect(page.locator('#bewusst-leben').getByRole('tablist')).toHaveCount(0);
}
const remote = async () => JSON.parse((await (await fetch(BASE+'/api/bewusst')).json()).value);
// Seit 2026-10-31 stehen die Routinen nur noch in der Karte, nicht als Todo.
const routine = page => page.locator('#bewusst-leben').getByRole('button',{name:'Heute abhaken: Dehne dich fünf Minuten.',exact:true});
const alsTodo = page => page.locator('#heute-todos .focus-row').filter({hasText:'Dehne dich fünf Minuten.'});
test('selected routine appears once in the card (not as Todo), persisted single source, undo/reload/second client',async({page,browser}) => {
 await open(page); const card=page.locator('#bewusst-leben');
 await card.getByRole('button',{name:'Routinen auswählen'}).click();
 await card.getByLabel('Dehne dich fünf Minuten.',{exact:true}).check();
 await card.getByRole('button',{name:'Auswahl übernehmen'}).click();
 await expect(card.getByRole('button',{name:'Routinen anpassen'})).toBeFocused();
 await expect(routine(page)).toHaveCount(1);
 await expect(alsTodo(page)).toHaveCount(0);
 await expect(routine(page)).toHaveAttribute('aria-pressed','false');
 await expect(card.getByRole('checkbox',{name:'Dehne dich fünf Minuten.',exact:true})).toHaveCount(0);
 await expect.poll(async()=> Object.values((await remote()).periods).filter(p=>p.cadence==='day').length).toBe(1);
 expect(Object.values((await remote()).periods)[0].goals[0].value).toBe(0);
 await routine(page).click(); await expect(routine(page)).toHaveAttribute('aria-pressed','true');
 const ctx=await browser.newContext(); const second=await ctx.newPage(); await open(second);
 await expect(routine(second)).toHaveAttribute('aria-pressed','true');
 await page.reload(); await expect(routine(page)).toHaveAttribute('aria-pressed','true');
 await routine(page).click(); await expect(routine(page)).toHaveAttribute('aria-pressed','false');
 const store=await (await fetch(BASE+'/api/state')).json();
 expect(JSON.parse(store.localStorage['morning.todos']??'[]').filter(t=>t.id.startsWith('routine:'))).toHaveLength(0);
 await ctx.close();
});
test('suggestions work without choosing obligations; month fraction and counter cap',async({page})=>{
 await open(page); const card=page.locator('#bewusst-leben');
 // Die Woche steht seit 2026-10-31 als eigener Abschnitt oben, nicht mehr als Reiter.
 await card.getByRole('button',{name:'Geh ins Gym. erhöhen'}).click();
 await expect(card.getByText('1 / 3 Besuche',{exact:true})).toBeVisible();
 await card.getByRole('button',{name:/Ideen ansehen|Abend-Rückblick/}).click();
 await card.getByRole('tab',{name:'Monat',exact:true}).click();
 await card.getByRole('checkbox',{name:'Male oder skizziere.',exact:true}).click();
 await expect(card.getByRole('checkbox',{name:'Male oder skizziere.',exact:true})).toBeChecked();
 await card.getByRole('tab',{name:'Rückblick',exact:true}).click();
 await expect(card.getByText('0 / 1 bestätigt',{exact:true})).toBeVisible();
 await expect(card.getByText(/Dazu 2 aufgegriffene Vorschläge/)).toBeVisible();
 expect((await remote()).plans.map(p=>p.cadence)).toEqual(['day']);
});
test('same counter concurrent increments preserve both intents and offline never confirms',async({browser})=>{
 const one=await browser.newContext(),two=await browser.newContext();
 const a=await one.newPage(),b=await two.newPage(); await open(a);await open(b);
 for(const p of [a,b]) await p.locator('#bewusst-leben').getByRole('button',{name:/Ideen ansehen|Abend-Rückblick/}).click();
 const held=[];let intercepted=0;
 const gate=async route=>{if(route.request().method()==='PUT'&&intercepted<2){intercepted++;held.push(route);if(held.length===2)await Promise.all(held.map(r=>r.continue()));}else await route.continue();};
 await a.route('**/api/bewusst',gate);await b.route('**/api/bewusst',gate);
 await Promise.all([a,b].map(p=>p.getByRole('button',{name:'Geh ins Gym. erhöhen'}).click()));
 await expect.poll(async()=>Object.values((await remote()).periods).find(p=>p.cadence==='week').goals.find(g=>g.id==='gym').value).toBe(3);
 await a.unroute('**/api/bewusst');await b.unroute('**/api/bewusst');
 await a.route('**/api/bewusst',route=>route.abort());
 await routine(a).click(); await expect(a.getByRole('alert').filter({hasText:'Nicht bestätigt'})).toBeVisible();
 await expect(routine(a)).toHaveAttribute('aria-pressed','false');
 await a.unroute('**/api/bewusst');await routine(a).click();await expect(routine(a)).toHaveAttribute('aria-pressed','true');
 await one.close();await two.close();
});
test('notes and pause retained, calendar never completes, evening prompt',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-09-20T18:00:00+02:00'));
 await open(page);const card=page.locator('#bewusst-leben');
 await expect(card.getByRole('button',{name:'Abend-Rückblick'})).toBeVisible();
 await card.getByRole('button',{name:'Abend-Rückblick'}).click();
 await card.getByRole('tab',{name:'Monat',exact:true}).click();
 const row=card.locator('article').filter({hasText:'Vertiefe dich in ein Fachgebiet.'});
 await row.getByText('Notiz & Pause',{exact:true}).click();
 await row.getByRole('textbox').fill('Geschichte – Testnotiz');await row.getByRole('button',{name:'Notiz speichern'}).click();
 await expect(row.getByText('Notiz & Pause · Notiz vorhanden',{exact:true})).toBeVisible();
 await row.getByRole('combobox').selectOption('Krankheit');
 await expect(row.getByRole('button',{name:'Vertiefe dich in ein Fachgebiet. erhöhen'})).toBeDisabled();
 await page.reload();await card.getByRole('button',{name:'Abend-Rückblick'}).click();await card.getByRole('tab',{name:'Monat',exact:true}).click();
 await row.getByText('Notiz & Pause · Notiz vorhanden',{exact:true}).click();
 await expect(row.getByRole('textbox')).toHaveValue('Geschichte – Testnotiz');
 await row.getByRole('link',{name:'Termin planen →'}).click();await expect(page).toHaveURL(/#\/lernzeit\/kalender$/);
 expect(Object.values((await remote()).periods).find(p=>p.cadence==='month').goals.find(g=>g.id==='domain').value).toBe(0);
});
test('local day rollover replaces the routine instead of carrying it; no missed-day backfill', async ({page}) => {
 const before = await remote();
 const days = Object.values(before.periods).filter(p => p.cadence === 'day');
 const day = days.map(p => p.start).sort().at(-1);
 const future = new Date(day + 'T12:00:00+02:00'); future.setUTCDate(future.getUTCDate() + 2);
 await page.clock.setFixedTime(future);
 await open(page);
 await expect(routine(page)).toHaveCount(1);
 await expect(routine(page)).toHaveAttribute('aria-pressed','false');
 await expect.poll(async () => Object.values((await remote()).periods).filter(p => p.cadence === 'day').length).toBe(days.length + 1);
 const after = await remote();
 expect(Object.values(after.periods).filter(p => p.cadence === 'day').map(p => p.start)).not.toContain(new Date(new Date(day + 'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10));
 await page.reload(); await expect(routine(page)).toHaveCount(1);
 expect(Object.values((await remote()).periods).filter(p => p.cadence === 'day')).toHaveLength(days.length+1);
});
test('native disclosure, keyboard return, failed selection stays editable', async ({page}) => {
 await page.emulateMedia({reducedMotion:'reduce'});
 await open(page); const card=page.locator('#bewusst-leben');
 const edit=card.getByRole('button',{name:'Routinen anpassen'});
 await edit.click();
 const before=await remote();
 await card.getByRole('checkbox',{name:'Dehne dich fünf Minuten.',exact:true}).uncheck();
 await page.route('**/api/bewusst',r=>r.request().method()==='PUT'?r.abort():r.continue());
 await card.getByRole('button',{name:'Auswahl übernehmen'}).click();
 await expect(card.getByRole('alert')).toContainText('Nicht bestätigt');
 await expect(card.getByRole('checkbox',{name:'Dehne dich fünf Minuten.',exact:true})).not.toBeChecked();
 expect(await remote()).toEqual(before);
 await card.getByRole('button',{name:'Abbrechen',exact:true}).click(); await expect(edit).toBeFocused();
 await page.unroute('**/api/bewusst');
 await card.getByRole('button',{name:'Erneut versuchen'}).click();
 await expect(card.getByRole('alert')).toHaveCount(0);
 const entry=card.getByRole('button',{name:/Ideen ansehen|Abend-Rückblick/});
 await entry.click(); await expect(card.getByRole('tab')).toHaveCount(2);
 await card.getByRole('tab',{name:'Rückblick',exact:true}).click();
 await expect(card.getByText('Im Tagesscore bringt jede Routine',{exact:false})).not.toBeVisible();
 await card.getByText('Was zählt hier mit?',{exact:true}).click();
 await expect(card.getByText(/Im Tagesscore bringt jede Routine und ein Tag mit Gym \+2 Punkte/)).toBeVisible();
 await card.getByText('Vergangene Einträge',{exact:true}).click();
 await expect(card.locator('.bewusst-history')).toBeVisible();
 await card.getByRole('button',{name:'Ideen und Rückblick schließen'}).click();
 await expect(entry).toBeFocused(); await expect(entry).toHaveAttribute('aria-expanded','false');
 await expect(card.getByRole('tablist')).toHaveCount(0);
 for (const width of [1280,390,320]) {
  await page.setViewportSize({width,height:900}); await card.scrollIntoViewIfNeeded();
  expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await card.screenshot({path:`/tmp/bewusst-native-collapsed-${width}.png`});
 }
});
test('six themes desktop/mobile, keyboard and screenshots',async({page})=>{
 await open(page);const card=page.locator('#bewusst-leben');
 await card.getByRole('button',{name:/Ideen ansehen|Abend-Rückblick/}).click();
 for(const theme of ['setzling','abendrot','nachtblau','glas','kupferstich','arkadien'])for(const width of [1280,390]){
 await page.setViewportSize({width,height:900});await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.querySelector('.app-shell')?.setAttribute('data-theme',theme);},theme);
 await card.scrollIntoViewIfNeeded();expect((await card.boundingBox()).width).toBeLessThanOrEqual(width);expect(await card.evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
 await card.getByRole('tab',{name:'Monat',exact:true}).focus();await page.keyboard.press('ArrowRight');await expect(card.getByRole('tab',{name:'Rückblick',exact:true})).toBeFocused();
 await page.screenshot({path:`/tmp/bewusst-native-${theme}-${width}.png`});
 }
});
