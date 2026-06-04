#!/usr/bin/env python3
"""Generic Strong-app CSV → SDSG log importer.

Usage: python3 import_strong.py <athlete_slug>
"""
import csv, sys
from collections import defaultdict

def secToMSS(s):
    s = int(round(s))
    m, sec = s // 60, s % 60
    return f"{m}:{sec:02d}"

# Per-athlete mapping: (event, value_fn(row), is_lower_better)
# value_fn returns the SDSG value string given the CSV row dict OR None if skip
def make_mapper(slug):
    if slug == 'tonnie':
        # Tonnie: 65-69 historical + 70-74 current. Goblet=35 lb (16kg) and
        # 26 lb (12kg) both count. Bench 50 lb (65-69) and 45 lb (70-74).
        def mapper(name, w, reps, dist, sec):
            if name == 'Goblet Squat (Kettlebell)':
                if w in (26.0, 35.0) and 0 < reps <= 200:
                    return ('kbsquat', str(int(reps)), reps, False)
            elif name == 'Bench Press (Barbell)':
                if w in (45.0, 50.0) and 0 < reps <= 200:
                    return ('bench', str(int(reps)), reps, False)
            elif name == 'Ball Slams':
                if w == 10.0 and 0 < reps <= 100:
                    return ('slams', str(int(reps)), reps, False)
            elif name == 'Dead Hang':
                if 5 <= reps <= 600:
                    return ('hang', secToMSS(reps), reps, False)
            elif name in ('Overhead Toss', 'Ball Toss'):
                if w in (0.0, 4.0, 10.0) and 50 <= reps <= 500:
                    return ('dynamax', str(int(reps)), reps, False)
            elif name == 'Rowing (Machine)':
                if 60 <= sec <= 360 and (abs(dist - 500) < 50 or dist == 50):
                    return ('row', secToMSS(sec), sec, True)
            elif name == 'Broad Jump':
                if 12 <= reps <= 120:
                    return ('broadjump', str(int(reps)), reps, False)
            elif name == 'Jump Rope':
                if 10 <= reps <= 300:
                    return ('jumprope', str(int(reps)), reps, False)
            elif name == 'Running':
                # 300m run = shuttle proxy
                if dist == 300 and 30 <= sec <= 180:
                    return ('shuttle', secToMSS(sec), sec, True)
            return None
        return mapper
    elif slug == 'robert':
        # Robert: Men 65-69. KB comp 16kg (35 lb) but logs "Squat (Barbell)"
        # at 44 lb (20kg) for comp prep. Bench comp 75 lb but trains 65/95.
        def mapper(name, w, reps, dist, sec):
            if name in ('Goblet Squat (Kettlebell)', 'Squat (Barbell)'):
                # comp KB band: 35-53 lb (covers 16-24 kg)
                if 30 <= w <= 55 and 0 < reps <= 200:
                    return ('kbsquat', str(int(reps)), reps, False)
            elif name == 'Bench Press (Barbell)':
                # comp training band: 65, 75, 95 lb at high reps
                if 60 <= w <= 100 and 0 < reps <= 100:
                    return ('bench', str(int(reps)), reps, False)
            elif name == 'Ball Slams':
                # comp 15 lb but Strong logs 20 lb
                if 10 <= w <= 25 and 0 < reps <= 100:
                    return ('slams', str(int(reps)), reps, False)
            elif name == 'Ball Toss':
                # 8 lb comp ball; sometimes logged as 10
                if w in (8.0, 10.0) and 50 <= reps <= 500:
                    return ('dynamax', str(int(reps)), reps, False)
            elif name == 'Rowing (Machine)':
                # only true 500m attempts
                if 60 <= sec <= 360 and abs(dist - 500) < 50:
                    return ('row', secToMSS(sec), sec, True)
            elif name == 'Broad Jump':
                if 12 <= reps <= 120:
                    return ('broadjump', str(int(reps)), reps, False)
            elif name == 'Jump Rope':
                if 10 <= reps <= 300:
                    return ('jumprope', str(int(reps)), reps, False)
            elif name == 'Prowler Push':
                if 5 <= sec <= 120:
                    return ('prowler', secToMSS(sec), sec, True)
            return None
        return mapper
    raise SystemExit("unknown athlete: " + slug)

def main():
    slug = sys.argv[1]
    name_cap = slug.capitalize()
    csv_path = f'/home/user/yg-sdsg/tools/{name_cap}_strong_workouts.csv'
    mapper = make_mapper(slug)
    rows = []
    with open(csv_path) as f:
        for r in csv.DictReader(f):
            date = r['Date'].split(' ')[0]
            if len(date) != 10 or date[4] != '-':
                continue
            # Strong's CSV is inconsistent with whitespace/case in exercise names
            # ("Broad Jump " with trailing space, "Broad jump" lowercase, etc.).
            # Normalize once here so the matcher in mapper() is simple.
            exercise_raw = (r.get('Exercise Name') or '').strip()
            exercise_norm = exercise_raw.title()  # Title Case for consistency
            try:
                m = mapper(
                    exercise_norm,
                    float(r.get('Weight')   or 0),
                    float(r.get('Reps')     or 0),
                    float(r.get('Distance') or 0),
                    float(r.get('Seconds')  or 0),
                )
            except Exception:
                m = None
            if not m:
                continue
            ev, val, num, lower = m
            rows.append((date, ev, val, num, lower))

    # Dedup: per (date, event), best entry
    byKey = {}
    for date, ev, val, num, lower in rows:
        k = (date, ev)
        if k not in byKey:
            byKey[k] = (val, num, lower)
        else:
            pv, pn, _ = byKey[k]
            if (lower and num < pn) or (not lower and num > pn):
                byKey[k] = (val, num, lower)

    from collections import Counter
    ec = Counter(k[1] for k in byKey)
    print(f"-- {len(byKey)} rows mapped from {csv_path}", file=sys.stderr)
    print(f"-- by event: {dict(ec)}", file=sys.stderr)

    # Idempotent: clear previous Strong-app rows for this athlete, then
    # insert only entries that don't collide with any existing row
    # (event + log_date + value). The NOT EXISTS guard prevents a Strong
    # entry from duplicating a baseline or manual log of the same value.
    print(f"DELETE FROM public.sdsg_logs WHERE athlete_slug='{slug}' AND note='Strong app · imported';")
    for (date, ev), (val, num, lower) in sorted(byKey.items()):
        val_q = val.replace("'", "''")
        print(
            "INSERT INTO public.sdsg_logs (athlete_slug,event,value,log_date,note) "
            f"SELECT '{slug}','{ev}','{val_q}','{date}','Strong app · imported' "
            "WHERE NOT EXISTS (SELECT 1 FROM public.sdsg_logs "
            f"WHERE athlete_slug='{slug}' AND event='{ev}' "
            f"AND value='{val_q}' AND log_date='{date}');"
        )

if __name__ == '__main__':
    main()

# Note: peggy was imported via the earlier tools/peggy-import.py with
# slightly different filters (weight==26 strict, accepts row distance=50
# typo). The Strong CSV remains at tools/Peggy_strong_workouts.csv and
# the resulting SQL at data/peggy-strong-import.sql.
