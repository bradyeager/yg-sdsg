# All-Time Record Book Integration

Source: **FitnessQuest10 Masters 50+ "Commissioners' Record Book" (2019–2025)**,
released by the San Diego Senior Games Association.

## What was extracted

The complete all-time record table for **all 10 events × both genders × every
5-year age band (50–54 … 95–99)** is encoded as the `RECORDS` object in
`assets/sdsg-app.js`. Each entry is `[value, holder(s), year]`, plus the test
weight as a 4th element for the two loaded lifts (KB Box Squat, Bench Press).

Unit notes baked into the helpers:

| Event | Recorded unit | App unit | Conversion |
|---|---|---|---|
| Prowler / Hang / Row / Shuttle | time `M:SS(.dd)` | seconds | `_recClock()` keeps decimals |
| Dynamax OH Throw | **feet** | **inches** | ×12 in `_recordValueN()` |
| Broad Jump | inches | inches | — |
| KB Squat / Bench | reps @ weight | reps | weight shown for context |
| Slams / Jump Rope | reps | reps | — |

## Badges shipped

- **🏆 Record Holder** — driven by an explicit `recordsHeld` array in the
  athlete's config (not fragile name-matching). Today only **Tonnie** holds
  records: Bench Press (W65–69, 50 @ 50 lb, 2025) and Med Ball Slams (W65–69,
  48, 2024 tie).
- **🚀 Record Pace / Record Tie** — computed live: the athlete's logged best
  meets or beats the all-time record **in their current division**
  (`gender` + `ageBand` from config). Time events respect `lowerBetter`;
  Dynamax converts ft↔in.

Surfaced in three places: collapsed Log-card headers (compact 🏆/🚀), the
expanded card's "All-Time … Record" strip (value + holder), and a summary
banner + per-row icons on the Progress tab.

Per-athlete divisions: Tonnie W70–74 · Peggy W70–74 · Kerry M50–54 ·
Robert M70–74 · Annie W60–64 · David M55–59.

## Ideas not yet built (data is now available for all of these)

1. **"X away from the record" callout** — show the exact gap (`record − best`)
   on every card, turning each event into a concrete target.
2. **Record-progress bar** — a second fill bar (like the block-week bar) scaled
   best→record, so progress toward the all-time mark is visual.
3. **Age-up projection** — when an athlete is within ~1 yr of the next band,
   preview how their numbers would rank against that band's records (Tonnie and
   Robert both just aged up; their old-band numbers dominate the new band).
4. **Record-attempt flag on comp day** — if a logged comp-day value sets/ties a
   record, fire a special toast + a permanent "Record Set 🏆 {year}" badge.
5. **Gym leaderboard vs the book** — a single cross-athlete view ranking each of
   our athletes against the all-time record in their division.
6. **Scouting cross-ref** — incoming/aging-in competitors who are themselves
   record holders get a "⚠ Record Holder" flag on the Scouting board.
7. **Legacy/medal-leader context** — the book's medal-leader index (Tonnie is
   #14 with 20 medals) could seed an athlete "legacy" line on their profile.
8. **Realistic goal seeding** — auto-suggest season targets between 2025 Gold
   and the all-time record instead of hand-set numbers.
