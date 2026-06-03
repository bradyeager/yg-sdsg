# SDSG Unified Athlete App (`/assets/`)

The 5 athlete trackers (`/tonnie/`, `/kerry/`, `/robert/`, `/peggy/`, `/annie-david/`)
now share one app instead of each being a standalone ~80KB file.

## Files
- **`sdsg-app.css`** — the shared design system (Oswald + IBM Plex, dark teal/pink),
  matching `/program/` and `/scouting/`.
- **`sdsg-app.js`** — the entire application: Supabase persistence, event model,
  timer, medal/PR math, and the four tabs.

## How a tracker page works now
Each `/<athlete>/index.html` is a thin shell:
1. links `sdsg-app.css`,
2. defines `window.SDSG_CONFIG` (the athlete's data object — profile, loads, podium,
   incoming competitors, baselines — lifted verbatim from the old per-file objects),
3. loads `sdsg-app.js`, which reads the config and renders everything.

`SDSG_CONFIG` shape:
```js
window.SDSG_CONFIG = {
  defaultAthlete: 'tonnie',
  eventOrder: [...],          // per-athlete display order
  dual: false,                // true only for annie-david (two athletes + switcher)
  athletes: {
    tonnie: { slug, name, division, trains, podiumLabel,
              background, loads, strong, weak, arc, podium, incoming, baselines }
  }
};
```

## Tabs
- **Log** — profile card + the 10 event cards (best vs gold, podium, timer, log input). Unchanged logging behavior.
- **Program** — fetches `/program/` and shows this week's plan, with the athlete's own comp load badged per event.
- **Progress** — Status dashboard (best vs gold + delta) and full training history (with per-entry delete).
- **Scouting** — this athlete's Incoming Competitors (aging in), links to the full `/scouting/` board.

## Important notes
- **No login.** Anonymous Supabase writes with the publishable key, identical
  contract to the legacy trackers (`public.sdsg_logs`, `athlete_slug`). Seniors
  never see an auth screen.
- **The canonical Supabase block now lives in `sdsg-app.js`** (still fenced with the
  `=== CANONICAL SUPABASE BLOCK ===` markers). It is byte-equivalent logic to the old
  per-tracker block, just parameterized by the active athlete's slug.
- **Annie/David** stays a dual-athlete page: `dual:true`, a teal/pink switcher above
  the tabs toggles between the two, each with its own slug + data.
- To edit an athlete's profile/podium/baselines/incoming, edit the `SDSG_CONFIG`
  object in that athlete's `index.html`. To change app behavior or styling for
  everyone, edit the shared `/assets/` files.
