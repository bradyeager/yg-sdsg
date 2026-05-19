# SDSG Programming Notes

Coaching rules and constraints for writing weekly programs at `/program/index.html`. Anything Claude (or another LLM) writes for the weekly program **must** follow these. Brad's voice — update freely as preferences evolve.

---

## Voice & Format

- **Audience:** senior-age athletes training without a coach physically present. Many sessions are unsupervised. Many will be fatigued or read on a single shared iPad.
- **Make it idiot-proof.** A tired 70-year-old should be able to read one card and know exactly what to do, with no follow-up questions.
- **Bullet cues stay.** Brad likes the dashed bullet list. 2-4 cues per pattern. Each cue is a complete sentence — what to do AND what to avoid when useful.
- **No generic load language.** Never write "moderate-heavy" or "light-moderate" as the entire load description. Always anchor to the competition load, body weight, or a specific number, then describe the modifier.

---

## Equipment Constraints

- **Sled / Prowler:** OUT until further notice. Sled is being repaired. Do not include the Prowler Push event in the program. When the sled is back, Brad will re-enable it explicitly.
- **D-balls only for slams.** Stick to D-balls (slam balls). Do NOT prescribe Dynamax balls for slamming patterns. We *do* have Dynamax balls (8 lb, 14 lb) but they have different size, feel, and bounce — not suitable for slam work.
- **No wall slams.** No sturdy throwing surface available.
- **No rotational slams.** No space.
- **No floor press.** Brad doesn't like the movement. Never include it. Replace with a DB or push-up variation if upper-body pressing is needed.

---

## Per-Event Rules

### KB Box Squat (AMRAP, time-capped)
- Load = **the athlete's competition KB**, with permission to go ±1-2 KB sizes (1 or 2 sizes heavier for strength stimulus, 1 or 2 sizes lighter for higher-rep capacity).
- Athletes train this event across a **5-rep to 100+-rep range**. Do not box yourself into the 8-10 rep zone — that range trains nothing specific.
- Prefer prescriptions that match the comp stimulus (high-rep AMRAP at comp load) or overload (low-rep heavy with 1-2 sizes up).

### Dynamax OH Throw (max reps · 60 sec)
- Comp ball weight is **10 lb or 20 lb D-ball** (20 lb substitutes for the unavailable 15 lb).
- Use D-balls only — see equipment constraints.

### Bench Press (max reps @ load)
- This is a **max-rep AMRAP event**. Training stimulus must match: high reps to or near failure at the comp load.
- 5-rep work doesn't train this stimulus. Skip it.
- No prescribed percentage system — reference the athlete's comp bench weight directly.
- **No floor press, ever.**

### Overhead Arm Hang (max hang time)
- Train grip + scap stability + active hang time. Targets ~80% of the athlete's current best on max-time work.

### Med Ball Slams (max slams · 60 sec)
- **No wall slams. No rotational slams.** Replace with standing slams, half-kneeling slams, AMRAP comp practice, or other vertical slam variations.

### Jump Rope · 60s (max singles · 60 sec)
- Calf raise work: prescribe **doubled rep ranges with added weight**. Include both single-leg and double-leg variations.
- Pogo hops + 60-sec pace practice are also fair game.

### Standing Broad Jump (longest jump)
- Train hip-drive, landing mechanics, and reactive ability.

### Concept Row · 500m (500m for time)
- Train intervals at faster-than-race pace, steady-state engine, and on/off power work.

### 300 Yd Shuttle Run (6 × 50 yd for time)
- Train change-of-direction, build-up sprints, and pace-specific shuttles.

---

## Page Structure Rules

- **YG logo** must stay at the top of the page (not just text "YG").
- **Week banner** has room for a training-block timeline. Show all training blocks from now through comp day (Sept 27, 2026) as small text blocks, with the current block highlighted.
- Layout = single scrolling page, event-grouped, 9 events × 3 patterns = 27 patterns. (8 events × 3 = 24 if sled is restored and prowler is one of them... currently 9 events without prowler.)
- Sled event count: while prowler is out, 9 events; when it returns, 10.
- Current Week / Archive tabs remain. Archive empty state OK until first archived week.

---

## How To Update For A New Week

1. Open `program/index.html`.
2. To publish a new week:
   - Move the current `#currentTab` contents (week-banner + events-grid) into an archived `<section>` inside `#archiveTab`.
   - Replace `#currentTab` with the new week's banner and events.
3. Update the block timeline if a new block begins.
4. Push to `main` (or to a branch + PR). Vercel deploys automatically.

---

## Block Timeline (current plan, 2026)

| Block | Dates | Weeks | Focus |
|---|---|---|---|
| Block 1 | May 11 – Jun 14 | 5 | Foundation · technique, base capacity |
| Block 2 | Jun 15 – Jul 26 | 6 | Hypertrophy · build muscle + work capacity |
| Block 3 | Jul 27 – Aug 30 | 5 | Strength & Power · intensity up, reps down |
| Block 4 | Aug 31 – Sep 27 | 4 | Peak + Taper · comp-specific, deload final week |

Competition: **September 27, 2026** · San Diego Senior Games.
