# Contributing to yg-sdsg

Senior Games 2026 athlete trackers. Read this before editing any tracker file.

---

## The One Rule

> **Always pull the canonical file from `main` before editing. Never edit a tracker file from chat-history attachments, "Claude Outputs," or local copies older than the latest commit.**

Why: each tracker on `main` has Supabase sync wired into it. Local/stale copies typically use `localStorage` only. A regenerate-and-overwrite from a stale template silently breaks persistence — the page still works, but logs vanish on cache clear and never sync across devices.

### How to pull canonical (raw GitHub)

```
https://raw.githubusercontent.com/bradyeager/yg-sdsg/main/tonnie/index.html
https://raw.githubusercontent.com/bradyeager/yg-sdsg/main/annie-david/index.html
https://raw.githubusercontent.com/bradyeager/yg-sdsg/main/robert/index.html
https://raw.githubusercontent.com/bradyeager/yg-sdsg/main/index.html
```

If you're an LLM agent (Claude, etc.): fetch from these URLs and edit that text. Do not edit any file you didn't just fetch from `main`.

---

## Architecture

### Stack

| Layer | Choice |
|---|---|
| Hosting | Vercel (auto-deploys on push to `main`) |
| Domain | `sdsg.yeagersgym.com` |
| Backend | Supabase (`qfprpepqzckymbijeexw.supabase.co`) |
| Table | `public.sdsg_logs` |
| Build | None — static HTML/CSS/JS only |

### Routes

| Path | Athlete(s) | Athlete slug(s) in DB |
|---|---|---|
| `/` | Landing page | — |
| `/tonnie/` | Tonnie (solo) | `tonnie` |
| `/annie-david/` | Annie + David (in-page toggle) | `annie`, `david` |
| `/robert/` | Robert (solo) | `robert` |

### Data model

`public.sdsg_logs` columns (relevant subset):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `athlete_slug` | text | `tonnie` / `annie` / `david` / `robert` / `<new>` |
| `event` | text | one of: `prowler`, `kbsquat`, `dynamax`, `bench`, `hang`, `slams`, `jumprope`, `broadjump`, `row`, `shuttle` |
| `value` | text | stored as string; format depends on event unit (reps as integer string, time as `m:ss`, inches as float string) |
| `log_date` | date | the date of the lift |
| `note` | text | optional |
| `created_at` | timestamptz | default `now()` |

RLS: public read/write/delete (intentional — single-publishable-key SaaS app; no auth UI).

---

## Brand Palette (Hard Constraint)

| Surface | Teal | Pink |
|---|---|---|
| **Athlete tracker apps** (`/tonnie`, `/annie-david`, `/robert`, future athletes) | `#48C4CC` | `#EF3295` |
| **Brand site** (`yeagersgym.com`, brand documents, marketing PDFs) | `#1EC8B0` | `#F0448A` |

**Do not swap palettes.** The athlete apps use the legacy YG palette by deliberate decision.

---

## Adding a New Athlete

1. Decide solo or shared:
   - **Solo** (one athlete, one phone) → copy `tonnie/index.html` as the template.
   - **Shared** (training partners, one phone) → copy `annie-david/index.html` as the template.

2. Edit the new file:
   - Solo: change `ATHLETE_SLUG = '<name>'`, replace the `TONNIE` data object with the new athlete's data, update division/training-days/baselines/podium/loads/background/strong/weak/arc.
   - Shared: add the new key in `ATHLETES = {...}`, update toggle button labels, update `currentAthlete` default if needed.

3. Place at `/<name>/index.html` (or `/<a>-<b>/index.html` for shared).

4. Update root `/index.html` — add a new `<a class="athlete" href="/<name>">...</a>` card.

5. Commit → push → Vercel auto-deploys.

6. Verify:
   - Landing page card visible and clickable
   - Tracker route loads, sync indicator briefly green
   - Status tab shows seeded baselines (count should match the `baselines` array length)
   - Logging a test entry persists across hard-reload
   - Test entry can be cleaned via `Reset` link or SQL: `DELETE FROM public.sdsg_logs WHERE athlete_slug='<name>' AND ...`

---

## What NOT to Do

- **Don't replace the Supabase block with `localStorage`.** All canonical files have a `// === CANONICAL SUPABASE BLOCK · DO NOT REMOVE OR REPLACE WITH localStorage ===` comment fence. The block ends at `// === END CANONICAL SUPABASE BLOCK ===`. Treat everything between as protected.
- **Don't modify the brand palette in athlete apps.** See above.
- **Don't add a build pipeline.** This is intentionally a zero-build static site. No npm, no webpack, no bundler.
- **Don't change `athlete_slug` values once an athlete is in production.** Their logs become orphaned.
- **Don't remove the loading screen or sync indicator DOM nodes.** Both are referenced by the Supabase init code and removing them throws on page load.

---

## Test/Cleanup Recipes

### Delete a single test entry (Supabase SQL)

```sql
DELETE FROM public.sdsg_logs
WHERE athlete_slug = '<slug>'
  AND event = '<event>'
  AND value = '<value>'
  AND log_date = '<YYYY-MM-DD>'
ORDER BY created_at DESC
LIMIT 1;
```

### Wipe one athlete's data (preserves baselines via auto-seed on next load)

Use the `Reset <athlete>'s data` link in the page footer, or:

```sql
DELETE FROM public.sdsg_logs WHERE athlete_slug = '<slug>';
```

Next page load will re-seed baselines from the HTML's `baselines` array.

---

## Deployment

- Push to `main` → Vercel auto-deploys in ~10s.
- Custom domain `sdsg.yeagersgym.com` is aliased to the latest production deployment.
- SSO/deployment protection is **off** project-wide (this is a public-facing athlete app). Don't re-enable it without coordinating with Brad.

---

## Ownership

- **Brad Yeager** — product owner, training data source of truth
- **Perplexity Computer** — initial deploy + Supabase wiring + guardrails
- **Claude / Claude Code** — ongoing content updates (athlete data, copy)
