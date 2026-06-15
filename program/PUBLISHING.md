# Publishing a New Week

This is the weekly programming workflow. The goal: one command from a JSON
file to a live new week with the prior week archived, banner refreshed,
block-timeline marker moved if needed, and validation passed.

> Read `program/PROGRAMMING_NOTES.md` first. It holds the coaching rules
> (equipment, per-event constraints, bench 1RM table) that the week's
> content must obey. This document covers the **mechanics** of publishing.

---

## The one command

```
python3 tools/build_week.py path/to/next-week.json \
    --archive-note "Foundation Week 4 — final week, tested KB Box Squat + 300 yd Shuttle."
```

What that does, in order:

1. Loads + validates `next-week.json` (10 events × 3 patterns, canonical event
   order, every pattern has `name` / `rx` / `load` / `cues`).
2. Reads `program/index.html`.
3. Extracts the current week's title, sub, dates, and events JSON.
4. Builds an archive entry from those + your `--archive-note` and prepends
   it to `PAST_WEEKS`.
5. Swaps the new week's events JSON into the `program-events` island.
6. Rewrites the banner trio (title, sub, dates) and the week-note +
   tests-line text.
7. Moves the `current` marker (with the "You are here" chip) onto whichever
   block-pill matches `blockMarker`.
8. Re-parses both data islands to make sure nothing was corrupted, asserts
   the canonical 10 × 3 shape, and that `PAST_WEEKS[0]` is the outgoing
   week.
9. Writes the file in place. (Or skips the write if `--dry-run`.)

Always run dry-run first:

```
python3 tools/build_week.py path/to/next-week.json \
    --archive-note "..." --dry-run
```

Then run the existing test suite before pushing:

```
bash tests/run.sh
```

---

## Input file schema

Start from `tools/sample-week.json` and edit. Required keys:

| Key             | Type    | Notes                                                                                  |
|-----------------|---------|----------------------------------------------------------------------------------------|
| `weekTitle`     | string  | Banner h2. Convention: `"Week of June 15"`.                                            |
| `weekSub`       | string  | Banner sub. Convention: `"Hypertrophy · Week 2"`. Use real `·`, not `&middot;`.        |
| `weekDates`     | string  | Banner dates. Convention: `"June 15 – 21, 2026 · Block 2 · Week 2 of 7"`. Real `–`.    |
| `blockMarker`   | string  | One of: `Foundation`, `Hypertrophy`, `Strength & Power`, `Peak + Taper`.               |
| `weekNoteHtml`  | string  | Inner HTML of the `.week-note` div. May contain `<strong>`, `<br>`, `&mdash;`, etc.    |
| `testsLineHtml` | string  | Inner HTML of the `.tests-line` div. The athlete-buttons block below it is untouched.  |
| `events`        | array   | Exactly 10 events, in the canonical order (see below). Each has 3 `patterns`.          |

Each event needs `event`, `type` (`sprint` or `marathon`), `tag`, `patterns`.
Each pattern needs `name`, `rx`, `load`, `cues` (non-empty list of strings).
Optional: `isTest: true` on the pattern object marks the test pill.

The canonical event order — order matters, the app expects this:

1. KB Box Squat
2. Dynamax OH Throw
3. Bench Press
4. Overhead Arm Hang
5. Med Ball Slams
6. Jump Rope · 60s
7. Standing Broad Jump
8. Concept Row · 500m
9. 300 Yd Shuttle Run
10. Prowler Push

---

## What gets edited, and what doesn't

The script only edits a small, well-defined set of zones inside
`program/index.html`:

- `<h2>` inside `.week-banner`
- `.week-sub` div
- `.week-dates` div
- `.week-note` div (inner HTML only)
- `.tests-line` div (text above `.athlete-buttons` only — buttons stay put)
- Each `.block-pill` (only the `current` flag and `b-now` chip move)
- The `<script type="application/json" id="program-events">` island
- The `const PAST_WEEKS = [...];` literal

Everything else — CSS, head content, header, the dial logic, the timer
markup, the modal, all the JS below the data islands — is untouched.

---

## Coaching-rules checklist (before you commit)

These mirror `PROGRAMMING_NOTES.md`. Skim the file if you're not sure.

- 10 events, 3 patterns each.
- Prowler Push **stays in the program** (sled work only — never badge as a
  competition test until Brad authorizes).
- **No towel hangs.** Grip-overload is **fat grips**.
- **D-balls only for slams.** Not Dynamax. No wall slams. No rotational
  slams.
- **No floor press.** Substitute DB or push-up pressing.
- **Bench Volume** uses % of max-reps, not % of 1RM. The pattern name must
  be exactly `Bench Volume @ % of Max Reps` so the athlete app computes
  each athlete's rep target.
- **Dynamax** distances are feet + inches (stored as inches in the DB; the
  app handles display).
- Cues: 2–4 per pattern, complete sentences, what to do AND what to avoid.
- No "moderate-heavy" or "light-moderate" as the whole load string.

---

## Per-athlete personalization (read-only for the publisher)

The athlete app rewrites a handful of pattern names per athlete (e.g.
substituting "13 lb" for "Dynamax 8 lb / 14 lb" once it knows the
athlete is Tonnie, or swapping in the right slam weight). That happens
**at render time in the app**, not in the program file. You write the
patterns generically; the app personalizes.

The triggers live in `assets/sdsg-app.js` under `_personalizePattern()`.
The current substitutions are documented in `PROGRAMMING_NOTES.md`. Don't
hand-personalize in the JSON — it doubles the work and creates drift.

---

## Block timeline

The five `.block-pill` divs in the banner are static — descriptions and
dates are baked into the HTML. The script only moves the `current` flag
between them based on `blockMarker`. The valid markers (must match the
`<div class="b-name">` text exactly) are:

- `Foundation`
- `Hypertrophy`
- `Strength & Power`  *(written `Strength &amp; Power` in HTML — the script handles the entity)*
- `Peak + Taper`

If a block's **dates or description** need to change (e.g. Foundation
ended a week earlier than originally planned), edit the corresponding
`.block-pill` markup in `program/index.html` by hand. The script
intentionally doesn't rewrite that content — it's the kind of edit you
want to see in a diff, not have the script silently muddle.

---

## Failure modes

If the script aborts, it prints `ERR  ...` and exits non-zero. Common
causes:

| Error                                                  | Fix                                                                 |
|--------------------------------------------------------|---------------------------------------------------------------------|
| `events order/names mismatch`                          | Reorder events to match the canonical list above.                   |
| `blockMarker '...' not in {...}`                       | Use one of the four valid markers (spelled exactly).                |
| `patterns must be a list of 3`                         | Every event needs exactly 3 patterns.                               |
| `cues must be a non-empty list`                        | Every pattern needs at least one cue string.                        |
| `failed to update <region>`                            | The page structure drifted from what the script expects.            |
| `post-edit JSON did not parse`                         | The new events JSON had a syntax issue (rare — input is JSON).      |
| `could not flag block-pill for ...`                    | `blockMarker` value doesn't match any `<div class="b-name">` text.  |

The script is single-shot and idempotent against a clean source — if
something goes wrong, fix the input and re-run. It either writes a valid
output or it doesn't write at all.

---

## After publishing

```
git diff program/index.html       # eyeball the banner + JSON islands
bash tests/run.sh                 # all 12 Playwright tests pass
git add program/index.html
git commit -m "Publish Week of June 15 — Hypertrophy Week 2"
git push origin main
```

Vercel deploys automatically on push.
