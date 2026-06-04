# yg-sdsg

San Diego Senior Games 2026 athlete trackers. Static site, no build step. Vercel auto-deploys on push to `main`.

Live: https://sdsg.yeagersgym.com

## Athletes (all live)
- `/tonnie` — Tonnie · Women 70–74
- `/peggy` — Peggy · Women 70–74
- `/kerry` — Kerry · Men 50–54
- `/robert` — Robert · Men 70–74
- `/annie-david` — Annie (Women 60–64) + David (Men 55–59), one page with an in-header switcher

## Other routes
- `/` — landing page
- `/program/` — weekly training program (current week + archive)
- `/loads/` — per-athlete load cards for the 60-minute group session (auto-derived from `/program/`)
- `/scouting/` — Field Watch: who's aging into / out of each division for 2026

## Stack
- Static HTML/CSS/JS — **no npm, no bundler, no build pipeline**
- Shared app logic in `/assets/sdsg-app.js` + design system in `/assets/sdsg-app.css`
- Each `/<athlete>/index.html` is a thin shell that sets `window.SDSG_CONFIG` and includes the shared assets
- Supabase backend (project `qfprpepqzckymbijeexw`, table `public.sdsg_logs`), anonymous publishable key, **no login**
- Vercel hosting + headers (`vercel.json`: CSP, frame-deny, asset cache)

## Security posture
- RLS is public read/insert/delete by design (single anonymous key, no auth UI for non-tech-savvy users).
- DB-level guardrails on `public.sdsg_logs`: CHECK constraints (event whitelist, value/slug/note sanity, no `<`/`>`) + a statement trigger that blocks cross-athlete bulk DELETE while preserving the single-athlete reset.
- Client escapes all DB-sourced values before rendering (`esc()` in `sdsg-app.js`).

## Tests
- `tests/` — Playwright integration tests (run via `tests/run.sh`, or CI on PRs). Cover smoke loads, XSS escaping, dual-athlete program-switch, and value validation.
- `.github/workflows/ci.yml` runs the tests on PRs; `kerry-import.yml` runs the Strong import when Kerry's CSV changes.

## Data tooling
- `tools/strong-import.py <slug>` — unified Strong-app CSV → idempotent SQL importer (tonnie, peggy, robert).
- `tools/kerry-import.js` — Kerry's importer (runs in CI).
- `data/*-strong-import.sql` — generated, idempotent (`INSERT … WHERE NOT EXISTS`).
