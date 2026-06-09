'use strict';
// Integration tests for the SDSG athlete app. Uses Playwright (the library) +
// Node's built-in test runner. Run locally:
//   NODE_PATH=/opt/node22/lib/node_modules node --test tests/
// or via tests/run.sh. CI installs playwright into node_modules.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let server, browser;

async function waitForServer(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok || r.status === 404) return; } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('static server did not start');
}

before(async () => {
  server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  await waitForServer(BASE + '/');
  browser = await chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
});

// Route Supabase REST to a controllable mock so tests never touch production.
async function mockSupabase(page, rows, counters) {
  counters = counters || {};
  await page.route('**/rest/v1/sdsg_logs**', async (route) => {
    const req = route.request();
    const m = req.method();
    if (m === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    }
    if (m === 'POST') {
      counters.posts = (counters.posts || 0) + 1;
      let body = []; try { body = JSON.parse(req.postData() || '[]'); } catch (_) {}
      const echoed = body.map((r, i) => Object.assign({ id: 'mock-' + Date.now() + '-' + i }, r));
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(echoed) });
    }
    if (m === 'DELETE') {
      counters.deletes = (counters.deletes || 0) + 1;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    return route.fulfill({ status: 200, body: '[]' });
  });
  return counters;
}

function newPage() { return browser.newContext({ viewport: { width: 412, height: 900 } }).then(c => c.newPage()); }

// ---- 1. Smoke: every route loads with no uncaught page error ----
test('smoke: all routes load without uncaught JS errors', async () => {
  const routes = ['/', '/scouting/', '/loads/', '/program/', '/tonnie/', '/peggy/', '/kerry/', '/robert/', '/annie-david/'];
  for (const r of routes) {
    const page = await newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await mockSupabase(page, []);
    const resp = await page.goto(BASE + r, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    assert.ok(resp && resp.status() === 200, `${r} should return 200`);
    assert.deepStrictEqual(errors, [], `${r} threw: ${errors.join(' | ')}`);
    await page.context().close();
  }
});

// ---- 2. XSS: a malicious DB value must be rendered as text, never executed (C1) ----
test('xss: malicious log value is escaped, not executed', async () => {
  const page = await newPage();
  await mockSupabase(page, [
    { id: 'x1', event: 'kbsquat', value: '<img src=x onerror="window.__xss=1">', log_date: '2026-06-01', note: '' },
  ]);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('.tab[data-view="progress"]');
  await page.waitForTimeout(500);
  const fired = await page.evaluate(() => window.__xss === 1);
  assert.strictEqual(fired, false, 'onerror handler must NOT fire');
  const html = await page.evaluate(() => document.getElementById('progressView').innerHTML);
  assert.ok(html.includes('&lt;img'), 'value should be HTML-escaped in the DOM');
  await page.context().close();
});

// ---- 3. Dual-athlete Program tab refreshes loads on switch (B1) ----
test('program tab shows the switched athlete\'s loads', async () => {
  const page = await newPage();
  await mockSupabase(page, []);
  await page.goto(BASE + '/annie-david/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('.tab[data-view="program"]');
  await page.waitForTimeout(800);
  // KB Box Squat load badge for the default athlete (Annie = 35 lb)
  const annieKb = await page.evaluate(() => {
    const ev = Array.from(document.querySelectorAll('.prog-event')).find(e => /KB Box Squat/i.test(e.textContent));
    return ev ? (ev.querySelector('.pe-load') || {}).textContent : null;
  });
  assert.strictEqual(annieKb, '35 lb', 'Annie KB load should be 35 lb');
  // Switch to David (53 lb) and re-open Program
  await page.click('.athlete-switch button[data-athlete="david"]');
  await page.waitForTimeout(700);
  await page.click('.tab[data-view="program"]');
  await page.waitForTimeout(800);
  const davidKb = await page.evaluate(() => {
    const ev = Array.from(document.querySelectorAll('.prog-event')).find(e => /KB Box Squat/i.test(e.textContent));
    return ev ? (ev.querySelector('.pe-load') || {}).textContent : null;
  });
  assert.strictEqual(davidKb, '53 lb', 'after switch, KB load should refresh to David 53 lb (B1)');
  await page.context().close();
});

// ---- 4. Input validation rejects out-of-range values before a DB write (D1/D2) ----
test('validation: out-of-range distance is rejected on the new ft+in input, no POST fired', async () => {
  const page = await newPage();
  const counters = await mockSupabase(page, []);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('.tab[data-view="log"]');
  await page.waitForTimeout(400);
  // Dynamax is now a feet+inches event with separate ft / in number inputs.
  await page.evaluate(() => SDSG.toggleEventCard('dynamax'));
  await page.waitForTimeout(350);
  // Case A: bogus inches portion (>11) — independent of total bounds.
  await page.fill('#in_dynamax_ft', '20');
  await page.fill('#in_dynamax_in', '99');
  const postsBefore = counters.posts || 0;
  await page.click('#btn_dynamax');
  await page.waitForTimeout(400);
  let toastA = await page.evaluate(() => document.getElementById('toast').textContent);
  assert.match(toastA, /inches.*0.*11/i, 'inches portion must be 0–11');
  assert.strictEqual(counters.posts || 0, postsBefore, 'no POST on bad inches portion');
  // Case B: absurd total (999 ft 0 in = 11988 in, well over the 600-in floor).
  await page.fill('#in_dynamax_ft', '999');
  await page.fill('#in_dynamax_in', '0');
  await page.click('#btn_dynamax');
  await page.waitForTimeout(400);
  let toastB = await page.evaluate(() => document.getElementById('toast').textContent);
  assert.match(toastB, /distance looks off/i, 'over-range total triggers distance toast');
  assert.strictEqual(counters.posts || 0, postsBefore, 'no POST on over-range total');
  await page.context().close();
});

// ---- B1: time-value lower bound — 0:00 must be rejected ----
test('validation: zero-time 0:00 is rejected for lowerBetter time events', async () => {
  const page = await newPage();
  const counters = await mockSupabase(page, []);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('.tab[data-view="log"]');
  await page.waitForTimeout(400);
  // hang is a time event; 0:00 used to pass validation and become the best.
  await page.evaluate(() => SDSG.toggleEventCard('hang'));
  await page.waitForTimeout(350);
  const postsBefore = counters.posts || 0;
  await page.fill('#in_hang', '0:00');
  await page.click('#btn_hang');
  await page.waitForTimeout(400);
  const toast = await page.evaluate(() => document.getElementById('toast').textContent);
  assert.match(toast, /too short/i, 'should show the too-short toast');
  assert.strictEqual(counters.posts || 0, postsBefore, '0:00 must NOT POST');
  // 0:01 on hang is allowed (min=1s); 0:02 on prowler is below min=5s and must reject.
  await page.evaluate(() => SDSG.toggleEventCard('prowler'));
  await page.waitForTimeout(300);
  await page.fill('#in_prowler', '0:02');
  await page.click('#btn_prowler');
  await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => document.getElementById('toast').textContent);
  assert.match(t2, /too short/i, 'prowler 0:02 should reject (< 5s floor)');
  assert.strictEqual(counters.posts || 0, postsBefore, 'still no POSTs');
  await page.context().close();
});

// ---- B2: goldDelta tolerates a config without `podium` ----
test('defensive: athlete without podium still renders the Dashboard', async () => {
  const page = await newPage();
  await mockSupabase(page, []);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  // Wipe the podium on the active athlete and force a re-render.
  await page.evaluate(() => { window.SDSG_CONFIG.athletes.tonnie.podium = undefined; });
  await page.evaluate(() => SDSG.setView('dashboard'));
  await page.waitForTimeout(500);
  assert.deepStrictEqual(errors, [], 'no pageerror from goldDelta with missing podium');
  const txt = await page.evaluate(() => document.getElementById('dashboardView').textContent);
  assert.match(txt, /Events Logged/, 'dashboard still renders');
  await page.context().close();
});

// ---- C1: config-string escaping on Scouting (incoming row name) ----
test('xss-defense: ampersand/HTML in incoming-row name renders as literal text', async () => {
  const page = await newPage();
  await mockSupabase(page, []);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  // Inject a hostile name into the active athlete's incoming list, then re-render.
  await page.evaluate(() => {
    window.SDSG_CONFIG.athletes.tonnie.incoming = {
      kbsquat: [['Smith, J. & <b>K</b>', '50', '2025 W65–69 Gold']]
    };
    SDSG.setView('scouting');
  });
  await page.waitForTimeout(500);
  const html = await page.evaluate(() => document.getElementById('scoutingView').innerHTML);
  assert.ok(html.includes('Smith, J. &amp; &lt;b&gt;K&lt;/b&gt;'), 'name is HTML-escaped');
  assert.ok(!html.includes('<b>K</b>'), 'no live <b> injected');
  await page.context().close();
});

// ---- 6. All-time record badges: holder (🏆) + record pace (🚀) ----
test('records: holder + record-pace badges render for Tonnie', async () => {
  const page = await newPage();
  // Tonnie holds the W65-69 bench record; a logged best of 58 also beats the
  // current W70-74 bench all-time record (46), and 60 in beats broad jump (54).
  await mockSupabase(page, [
    { id: 'r1', event: 'bench', value: '58', log_date: '2026-05-07', note: '' },
    { id: 'r2', event: 'broadjump', value: '60', log_date: '2025-08-21', note: '' },
  ]);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  // Default tab is Dashboard — switch to Log so event cards exist.
  await page.click('.tab[data-view="log"]');
  await page.waitForTimeout(400);
  // Log tab: the bench card header should carry both the holder + pace icons.
  const benchIcons = await page.evaluate(() => {
    const card = document.getElementById('ec_bench');
    return card ? card.querySelector('.eh-right').textContent : '';
  });
  assert.ok(benchIcons.includes('🏆'), 'bench shows the record-holder icon');
  assert.ok(benchIcons.includes('🚀'), 'bench shows the record-pace icon');
  // The expanded body should name the all-time record holder.
  await page.evaluate(() => SDSG.toggleEventCard('bench'));
  await page.waitForTimeout(300);
  const strip = await page.evaluate(() => {
    const el = document.querySelector('#ec_bench .rec-strip');
    return el ? el.textContent : '';
  });
  assert.match(strip, /All-Time Women 70.74 Record/i, 'record strip labels the division');
  assert.match(strip, /Clark, Melia/, 'record strip names the holder');
  // Progress tab: the records summary lists held + on-pace events.
  await page.click('.tab[data-view="progress"]');
  await page.waitForTimeout(400);
  const sum = await page.evaluate(() => {
    const el = document.querySelector('.rec-summary');
    return el ? el.textContent : '';
  });
  assert.match(sum, /You hold the all-time record/i, 'summary names records held');
  assert.match(sum, /on all-time record pace/i, 'summary names on-record-pace events');
  await page.context().close();
});

// ---- 7. Dashboard tab is default + renders block-strip, stats, profile, week banner ----
test('dashboard: default tab shows stats, week banner, periodization grid', async () => {
  const page = await newPage();
  await mockSupabase(page, [{ id: 'd1', event: 'bench', value: '58', log_date: '2026-05-07', note: '' }]);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  // Dashboard is the active tab on load.
  const active = await page.evaluate(() => document.querySelector('.tab.active').dataset.view);
  assert.strictEqual(active, 'dashboard', 'Dashboard tab is active on load');
  // Block-strip, stat-row and profile have moved here from the Log tab.
  const txt = await page.evaluate(() => document.getElementById('dashboardView').textContent);
  assert.match(txt, /Events Logged/, 'stat row present on dashboard');
  assert.match(txt, /Week of/, 'this-week banner present on dashboard');
  assert.match(txt, /Block 1[\s\S]*Foundation/i, 'periodization grid present on dashboard');
  assert.match(txt, /Athlete Profile/, 'profile section present on dashboard');
  // Log tab is now slim — no block-strip, no stats — just the event cards container.
  const logHas = await page.evaluate(() => {
    const lv = document.getElementById('logView');
    return { blockStrip: !!lv.querySelector('.block-strip'), statRow: !!lv.querySelector('.stat-row'), profile: !!lv.querySelector('.profile-card') };
  });
  assert.deepStrictEqual(logHas, { blockStrip: false, statRow: false, profile: false }, 'Log tab no longer carries dashboard content');
  await page.context().close();
});

// ---- 8. Program tab substitutes the athlete's own loads + computes bench rep target ----
test('program: per-athlete loads replace shared copy on personalized patterns', async () => {
  // Programming churns weekly — this test asserts the personalization
  // mechanism still fires on whichever events have a current week's
  // pattern named with one of the recognized triggers. It targets the
  // most stable cross-block triggers: Slams "Standing Slam Volume"
  // (matches whenever slams are programmed) and Prowler "Comp-Distance
  // Sled Push" (matches whenever sled work is programmed). Both have
  // run every block since Block 1.
  const page = await newPage();
  await mockSupabase(page, [{ id: 'p1', event: 'bench', value: '58', log_date: '2026-05-07', note: '' }]);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.click('.tab[data-view="program"]');
  await page.waitForTimeout(900);
  const txt = await page.evaluate(() => document.getElementById('programView').textContent);
  // Slams: Tonnie's D-ball is 10 lb.
  assert.match(txt, /D-ball.*10 lb/, 'Slams pattern shows Tonnie\'s 10 lb D-ball');
  // Prowler: Tonnie's plates are 2×25 lb (women's load), no gender split shown.
  assert.match(txt, /Competition load.*2×25 lb plates/, 'Prowler pattern shows Tonnie\'s plate config');
  assert.ok(!/2 × 25 lb plates \(women\) \/ 2 × 45 lb plates \(men\)/.test(txt), 'generic gender split is replaced');
  await page.context().close();
});

// ---- 9. Today's Plan (coach recs) lives on the Program tab, not the Log tab ----
test('coach recs on Program tab, absent from Log tab; tabs ordered Dashboard·Program·Log·Progress·Scouting', async () => {
  const page = await newPage();
  await mockSupabase(page, [
    { id: 'c1', event: 'bench', value: '58', log_date: '2026-05-07' },
    { id: 'c2', event: 'hang', value: '1:05', log_date: '2026-05-08' },  // below W70-74 gold of 2:27
  ]);
  await page.goto(BASE + '/tonnie/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1100);
  // Tab order on load.
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('.tab')).map(t => t.dataset.view));
  assert.deepStrictEqual(order, ['dashboard','program','log','progress','scouting'], 'tab order is Dashboard · Program · Log · Progress · Scouting');
  // Program tab carries Today's Plan.
  await page.click('.tab[data-view="program"]');
  await page.waitForTimeout(1300);
  const progTxt = await page.evaluate(() => document.getElementById('programView').textContent);
  assert.match(progTxt, /Today's Plan/, 'Today\'s Plan appears on Program tab');
  assert.ok(!/Week of June 1/.test(progTxt), 'old "Week of" banner is gone from Program tab');
  // Log tab no longer carries Today's Plan.
  await page.click('.tab[data-view="log"]');
  await page.waitForTimeout(400);
  const logTxt = await page.evaluate(() => document.getElementById('logView').textContent);
  assert.ok(!/Today's Plan/.test(logTxt), 'Today\'s Plan is no longer on Log tab');
  await page.context().close();
});

// ---- 5. Empty state renders cleanly (no logs) ----
test('empty state: progress shows the no-sessions message', async () => {
  const page = await newPage();
  await mockSupabase(page, []);
  await page.goto(BASE + '/kerry/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await page.click('.tab[data-view="progress"]');
  await page.waitForTimeout(400);
  const txt = await page.evaluate(() => document.getElementById('progressView').textContent);
  assert.match(txt, /No sessions logged yet/, 'empty history message present');
  await page.context().close();
});
