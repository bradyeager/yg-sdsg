#!/usr/bin/env node
/**
 * Kerry CSV -> Supabase importer (idempotent).
 *
 * Run via GitHub Actions because the local sandbox blocks
 * outbound traffic to the Supabase host.
 *
 * Idempotent: first DELETEs any existing rows tagged
 * `note = 'Strong app import'` for kerry, then re-INSERTs the
 * deduped payload. Safe to re-run.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const SUPABASE_URL = 'https://qfprpepqzckymbijeexw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_SSGUga1zczVXmn3OZfZvwQ_VVU1IjPv';
const ATHLETE_SLUG = 'kerry';
const IMPORT_NOTE  = 'Strong app import';
const CSV_PATH     = path.join(__dirname, 'Kerry_strong_workouts.csv');

// ----- CSV parsing -----
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] !== undefined ? cells[i] : ''; });
    return row;
  });
}
function parseLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i+1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// ----- Exercise -> event mapping (verbatim from the bundle) -----
function mapRow(row) {
  const name     = row['Exercise Name'];
  const weight   = parseFloat(row['Weight'])   || 0;
  const reps     = parseFloat(row['Reps'])     || 0;
  const seconds  = parseFloat(row['Seconds'])  || 0;
  const distance = parseFloat(row['Distance']) || 0;

  switch (name) {
    case 'Overhand Straight Arm Hang':
      if (seconds <= 0) return null;
      return { event: 'hang', value: secondsToMSS(seconds), numeric: seconds, lowerBetter: false };
    case 'Concept 2 Rower 500m for time at level 10':
      if (seconds <= 0) return null;
      return { event: 'row', value: secondsToMSS(seconds), numeric: seconds, lowerBetter: true };
    case 'Rowing (Machine)':
      if (distance !== 500 || seconds <= 0) return null;
      return { event: 'row', value: secondsToMSS(seconds), numeric: seconds, lowerBetter: true };
    case 'Bench Press (Barbell)':
      if (weight !== 115 || reps <= 0) return null;
      return { event: 'bench', value: String(reps), numeric: reps, lowerBetter: false };
    case 'Goblet Squat (Kettlebell)':
      if (weight !== 53 || reps <= 0) return null;
      return { event: 'kbsquat', value: String(reps), numeric: reps, lowerBetter: false };
    case 'D-Ball Slam':
      if (reps <= 0) return null;
      return { event: 'slams', value: String(reps), numeric: reps, lowerBetter: false };
    case 'Jump Rope':
      if (reps <= 0) return null;
      return { event: 'jumprope', value: String(reps), numeric: reps, lowerBetter: false };
    case 'Standing Broad Jump':
      if (reps <= 0) return null;
      return { event: 'broadjump', value: String(reps), numeric: reps, lowerBetter: false };
    default:
      return null;
  }
}
function secondsToMSS(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

// ----- Dedup: best entry per (date, event) -----
function dedup(rows) {
  const byKey = {};
  for (const r of rows) {
    const key = r.date + '|' + r.event;
    const prev = byKey[key];
    if (!prev) { byKey[key] = r; continue; }
    if (r.lowerBetter) { if (r.numeric < prev.numeric) byKey[key] = r; }
    else                { if (r.numeric > prev.numeric) byKey[key] = r; }
  }
  return Object.values(byKey);
}

// ----- Supabase HTTP -----
function supabase(method, pathWithQuery, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(SUPABASE_URL + pathWithQuery);
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'apikey':        SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Prefer':        'return=representation'
    };
    if (payload) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request({
      method,
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      headers
    }, res => {
      let chunks = '';
      res.on('data', d => chunks += d);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(chunks ? JSON.parse(chunks) : null);
        } else {
          reject(new Error(`${method} ${pathWithQuery} -> ${res.statusCode}: ${chunks}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const csv = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csv);
  console.log(`Parsed ${rows.length} CSV rows.`);

  const mapped = [];
  let skipped = 0;
  for (const row of rows) {
    const date = (row['Date'] || '').split(' ')[0];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { skipped++; continue; }
    const m = mapRow(row);
    if (!m) { skipped++; continue; }
    mapped.push({ ...m, date, note: IMPORT_NOTE });
  }
  console.log(`Mapped ${mapped.length}; skipped ${skipped}.`);

  const deduped = dedup(mapped)
    .sort((a, b) => a.date.localeCompare(b.date) || a.event.localeCompare(b.event));
  console.log(`Deduped to ${deduped.length} rows (best-of-day per event).`);

  const eventCounts = deduped.reduce((a, r) => (a[r.event] = (a[r.event] || 0) + 1, a), {});
  console.log('Event breakdown:', eventCounts);

  // Step 1: clean up any prior Strong-app import for kerry (idempotency)
  console.log('Cleaning up prior Strong app import rows...');
  const noteEnc = encodeURIComponent(IMPORT_NOTE);
  const delPath = `/rest/v1/sdsg_logs?athlete_slug=eq.${ATHLETE_SLUG}&note=eq.${noteEnc}`;
  const deleted = await supabase('DELETE', delPath);
  console.log(`Deleted ${Array.isArray(deleted) ? deleted.length : 0} prior rows.`);

  // Step 2: insert fresh
  const payload = deduped.map(r => ({
    athlete_slug: ATHLETE_SLUG,
    event: r.event,
    value: r.value,
    log_date: r.date,
    note: IMPORT_NOTE
  }));

  let inserted = 0;
  for (let i = 0; i < payload.length; i += 50) {
    const chunk = payload.slice(i, i + 50);
    const res = await supabase('POST', '/rest/v1/sdsg_logs', chunk);
    inserted += Array.isArray(res) ? res.length : 0;
    process.stdout.write(`  inserted ${inserted}/${payload.length}\r`);
  }
  console.log(`\nDone. Inserted ${inserted} rows. Best peaks:`);

  const groups = {};
  deduped.forEach(r => { (groups[r.event] = groups[r.event] || []).push(r); });
  for (const ev of Object.keys(groups).sort()) {
    const list = groups[ev];
    const lower = list[0].lowerBetter;
    const best = list.reduce((a, b) => (lower ? (a.numeric <= b.numeric ? a : b) : (a.numeric >= b.numeric ? a : b)));
    console.log(`  ${ev.padEnd(10)} best=${best.value} (${best.date})`);
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
