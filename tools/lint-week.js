#!/usr/bin/env node
'use strict';
// Pre-publish linter for tools/week-*.json. Asserts the structural rules that
// the season build / weekly authoring must hold, so a malformed week can never
// reach auto-publish. Run: node tools/lint-week.js [file ...]   (default: all)
// Exits non-zero if any week has a violation.

const fs = require('fs');
const path = require('path');

const CANON = ['KB Box Squat','Dynamax OH Throw','Bench Press','Overhead Arm Hang','Med Ball Slams',
  'Jump Rope · 60s','Standing Broad Jump','Concept Row · 500m','300 Yd Shuttle Run','Prowler Push'];
// comp-practice anchor per event — must sit in Slot 1 on non-test weeks
const ANCHOR = {
  'KB Box Squat': /Box Squat @ % of Max Reps/i,
  'Dynamax OH Throw': /Throw Technique Practice/i,
  'Bench Press': /Bench Volume/i,
  'Overhead Arm Hang': /Max Hang Practice/i,
  'Med Ball Slams': /Standing Slam Volume/i,
  'Jump Rope · 60s': /60-Sec Pace Practice/i,
  'Standing Broad Jump': /Broad Jump\s*[—-]\s*Distance Practice/i,
  'Concept Row · 500m': /500m Practice/i,
  '300 Yd Shuttle Run': /Shuttle Pace Practice/i,
  'Prowler Push': /Comp-Distance Sled Push/i,
};
const TESTABLE = new Set(['KB Box Squat','Dynamax OH Throw','Bench Press','Overhead Arm Hang',
  'Med Ball Slams','Jump Rope · 60s','Standing Broad Jump','Concept Row · 500m','300 Yd Shuttle Run','Prowler Push']); // Prowler comp test authorized by Brad 2026-06-28
const VALID_BLOCKS = new Set(['Foundation','Hypertrophy','Strength & Power','Peak + Taper']);

function leadSets(rx){ const m = String(rx).match(/^\s*(\d+)\s*(?:×|x|sets?|rounds?|intervals?)/i); return m ? parseInt(m[1],10) : null; }

function lintWeek(week, file){
  const v = [];
  const names = (week.events||[]).map(e => e.event);
  if (names.length !== 10) v.push(`has ${names.length} events, need 10`);
  CANON.forEach((nm,i) => { if (names[i] !== nm) v.push(`event slot ${i} is "${names[i]}", expected "${nm}"`); });
  if (!VALID_BLOCKS.has(week.blockMarker)) v.push(`bad blockMarker "${week.blockMarker}"`);
  for (const key of ['weekTitle','weekSub','weekDates','weekNoteHtml','testsLineHtml']) if (!week[key]) v.push(`missing ${key}`);
  if (/&lt;|&amp;lt;/.test(week.weekNoteHtml||'')) v.push('weekNoteHtml is HTML-escaped (would render literal tags)');

  const withinWeekNames = {};
  for (const ev of (week.events||[])) {
    const ps = ev.patterns || [];
    if (ps.length !== 3) { v.push(`${ev.event}: ${ps.length} patterns, need 3`); continue; }
    const tests = ps.map((p,i)=>p.isTest?i:-1).filter(i=>i>=0);
    const isTestEvent = tests.length > 0;
    // slot-0 contract
    if (isTestEvent) {
      if (tests.length > 1) v.push(`${ev.event}: ${tests.length} test patterns, expected exactly 1`);
      if (tests[0] !== 0) v.push(`${ev.event}: test is in slot ${tests[0]+1}, must be Slot 1 on a test week`);
      // accessories on a test week must be light (no other test)
    } else {
      if (!ANCHOR[ev.event].test(ps[0].name||'')) v.push(`${ev.event}: Slot 1 is "${ps[0].name}", expected the comp anchor (${ANCHOR[ev.event]})`);
    }
    for (const p of ps) {
      for (const k of ['name','rx','load','cues']) if (!p[k]) v.push(`${ev.event}/${p.name||'?'}: missing ${k}`);
      if (Array.isArray(p.cues) && p.cues.length < 2) v.push(`${ev.event}/${p.name}: <2 cues`);
      const ls = leadSets(p.rx); if (ls && ls > 3) v.push(`${ev.event}/${p.name}: ${ls} sets exceeds 3-set cap — "${p.rx}"`);
      const blob = `${p.name} ${p.rx} ${p.load} ${(p.cues||[]).join(' ')}`.toLowerCase();
      if (/last week|previous week|beat last|over last week|than last week|same (load|kb|weight) as last/.test(blob)) v.push(`${ev.event}/${p.name}: cross-week/progression language`);
      if (/floor press/.test(blob)) v.push(`${ev.event}/${p.name}: floor press (banned)`);
      if (ev.event === 'Med Ball Slams' && /(dynamax|wall slam|rotational slam)/.test(blob)) v.push(`${ev.event}/${p.name}: banned slam variation`);
      if (ev.event === 'Overhead Arm Hang' && /towel hang/.test(blob)) v.push(`${ev.event}/${p.name}: towel hang (banned)`);
      // within-week cross-event duplicate
      const key = (p.name||'').trim().toLowerCase();
      if (withinWeekNames[key] && withinWeekNames[key] !== ev.event) v.push(`movement "${p.name}" appears in BOTH ${withinWeekNames[key]} and ${ev.event} this week (hidden volume)`);
      else withinWeekNames[key] = ev.event;
    }
  }
  return v;
}

function main(){
  const dir = path.join(__dirname);
  let files = process.argv.slice(2);
  if (!files.length) files = fs.readdirSync(dir).filter(f => /^week-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => path.join(dir, f)).sort();
  const weeks = files.map(f => ({ file: f, w: JSON.parse(fs.readFileSync(f, 'utf8')) }));

  let total = 0;
  // per-week checks
  for (const {file, w} of weeks) {
    const v = lintWeek(w, file);
    if (v.length) { total += v.length; console.log(`\n✖ ${path.basename(file)} — ${w.weekSub}`); v.forEach(x => console.log('   - ' + x)); }
    else console.log(`✓ ${path.basename(file)} — ${w.weekSub}`);
  }
  // cross-week: accessory movement repeated within the SAME event across weeks (anchors exempt)
  const crossWeek = [];
  for (const ev of CANON) {
    const seen = {};
    weeks.forEach(({w}) => {
      const e = (w.events||[]).find(x => x.event === ev);
      (e ? e.patterns : []).forEach(p => {
        if (ANCHOR[ev].test(p.name||'')) return;
        const k = (p.name||'').trim().toLowerCase();
        if (seen[k]) crossWeek.push(`${ev}: accessory "${p.name}" repeats (${seen[k]} & ${w.weekSub})`);
        else seen[k] = w.weekSub;
      });
    });
  }
  // Block-4 test coverage: each testable event tested exactly once across Peak weeks
  const peak = weeks.filter(({w}) => w.blockMarker === 'Peak + Taper');
  const testCount = {};
  peak.forEach(({w}) => (w.events||[]).forEach(e => { if ((e.patterns||[]).some(p=>p.isTest)) testCount[e.event] = (testCount[e.event]||0)+1; }));
  const testCoverage = [];
  if (peak.length === 4) {   // only assert full coverage when the whole peak block is present
    for (const ev of TESTABLE) { const c = testCount[ev]||0; if (c !== 1) testCoverage.push(`${ev}: tested ${c}× in Block 4 (expected exactly 1)`); }
  }

  if (crossWeek.length) { console.log('\n✖ cross-week accessory repeats (same event):'); crossWeek.forEach(x=>console.log('   - '+x)); total += crossWeek.length; }
  if (testCoverage.length) { console.log('\n✖ Block-4 test coverage:'); testCoverage.forEach(x=>console.log('   - '+x)); total += testCoverage.length; }

  console.log(`\n${total ? '✖' : '✓'} ${total} violation(s) across ${weeks.length} weeks.`);
  process.exit(total ? 1 : 0);
}
main();
