import csv

# Map Strong exercise → SDSG event, comp-load filter
def mapRow(name, weight, reps, seconds, distance):
    if name == 'Goblet Squat (Kettlebell)':
        # 26 lb KB = 12 kg, Peggy's comp wt
        if weight == 26 and reps > 0:
            return ('kbsquat', str(int(reps)), reps, False)
    elif name == 'Bench Press (Barbell)':
        if weight == 45 and reps > 0:
            return ('bench', str(int(reps)), reps, False)
    elif name == 'Ball Slams':
        if weight == 10 and reps > 0:
            return ('slams', str(int(reps)), reps, False)
    elif name == 'Dead Hang':
        # reps column stores seconds
        if reps > 0:
            sec = int(reps)
            m, s = sec // 60, sec % 60
            return ('hang', f"{m}:{s:02d}", reps, False)
    elif name in ('Overhead Toss', 'Ball toss'):
        if weight == 4 and reps > 0:
            return ('dynamax', str(int(reps)), reps, False)
    elif name == 'Rowing (Machine)':
        # accept anything that's clearly a 500m attempt:
        # distance close to 500 OR (distance=50 typo with realistic time)
        if seconds >= 90 and (abs(distance - 500) < 50 or distance == 50):
            sec = int(round(seconds))
            m, s = sec // 60, sec % 60
            return ('row', f"{m}:{s:02d}", seconds, True)
    elif name == 'Broad jump':
        if distance > 0:
            return ('broadjump', str(int(distance)), distance, False)
    return None

with open('/home/user/yg-sdsg/tools/Peggy_strong_workouts.csv') as f:
    reader = csv.DictReader(f)
    rows = []
    for r in reader:
        date = r['Date'].split(' ')[0]
        if len(date) != 10 or date[4] != '-':
            continue
        try:
            mapped = mapRow(
                r['Exercise Name'],
                float(r['Weight']   or 0),
                float(r['Reps']     or 0),
                float(r['Seconds']  or 0),
                float(r['Distance'] or 0),
            )
        except Exception:
            mapped = None
        if not mapped:
            continue
        ev, val, num, lower = mapped
        rows.append((date, ev, val, num, lower))

# Dedup: best per (date,event)
byKey = {}
for date, ev, val, num, lower in rows:
    k = (date, ev)
    if k not in byKey:
        byKey[k] = (val, num, lower)
    else:
        pv, pn, _ = byKey[k]
        if (lower and num < pn) or (not lower and num > pn):
            byKey[k] = (val, num, lower)

print(f"-- {len(byKey)} rows mapped from CSV")
from collections import Counter
ec = Counter(k[1] for k in byKey)
print("-- by event:", dict(ec))

# Print INSERT
print("DELETE FROM public.sdsg_logs WHERE athlete_slug='peggy' AND note='Strong app · imported';")
print("INSERT INTO public.sdsg_logs (athlete_slug,event,value,log_date,note) VALUES")
parts = []
for (date, ev), (val, num, lower) in sorted(byKey.items()):
    parts.append(f"('peggy','{ev}','{val}','{date}','Strong app · imported')")
print(",\n".join(parts) + ";")
