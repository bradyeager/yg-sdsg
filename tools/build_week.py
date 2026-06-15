#!/usr/bin/env python3
"""Publish a new week of training to program/index.html.

Reads a next-week JSON file, archives the current week into PAST_WEEKS,
swaps in the new events JSON, and updates the banner trio + block-timeline
marker. Validates the result before writing.

Usage:
    python3 tools/build_week.py NEXT.json \\
        --archive-note "Foundation Week 4 — final week, tests..."
    python3 tools/build_week.py NEXT.json --archive-note "..." --dry-run

NEXT.json schema:
    {
      "weekTitle":     "Week of June 15",
      "weekSub":       "Hypertrophy · Week 2",
      "weekDates":     "June 15 – 21, 2026 · Block 2 · Week 2 of 7",
      "blockMarker":   "Hypertrophy",
      "weekNoteHtml":  "<strong>How to use this page.</strong> ...",
      "testsLineHtml": "<strong>Working number week.</strong> ...",
      "events":        [ 10 events × 3 patterns ]
    }
"""

import argparse
import html
import json
import pathlib
import re
import sys

REPO    = pathlib.Path(__file__).resolve().parent.parent
PROGRAM = REPO / "program" / "index.html"

CANONICAL_EVENTS = [
    "KB Box Squat", "Dynamax OH Throw", "Bench Press", "Overhead Arm Hang",
    "Med Ball Slams", "Jump Rope · 60s", "Standing Broad Jump",
    "Concept Row · 500m", "300 Yd Shuttle Run", "Prowler Push",
]
VALID_BLOCK_MARKERS = {"Foundation", "Hypertrophy", "Strength & Power", "Peak + Taper"}
REQ_EVENT_KEYS   = {"event", "type", "tag", "patterns"}
REQ_PATTERN_KEYS = {"name", "rx", "load", "cues"}
REQ_WEEK_KEYS    = {"weekTitle", "weekSub", "weekDates", "blockMarker",
                    "weekNoteHtml", "testsLineHtml", "events"}


def fail(msg, code=1):
    print(f"ERR  {msg}", file=sys.stderr)
    sys.exit(code)


def validate_week(w):
    missing = REQ_WEEK_KEYS - set(w)
    if missing:
        fail(f"NEXT.json missing key(s): {sorted(missing)}")
    if w["blockMarker"] not in VALID_BLOCK_MARKERS:
        fail(f"blockMarker {w['blockMarker']!r} not in {sorted(VALID_BLOCK_MARKERS)}")
    if not isinstance(w["events"], list) or len(w["events"]) != 10:
        n = len(w["events"]) if isinstance(w["events"], list) else type(w["events"]).__name__
        fail(f"events must be a list of 10 (got {n})")
    names = [e.get("event") for e in w["events"]]
    if names != CANONICAL_EVENTS:
        fail("events order/names mismatch.\n"
             f"  expected: {CANONICAL_EVENTS}\n"
             f"  got:      {names}")
    for i, e in enumerate(w["events"]):
        miss = REQ_EVENT_KEYS - set(e)
        if miss:
            fail(f"events[{i}] missing keys {sorted(miss)}; got {sorted(e)}")
        if e["type"] not in ("sprint", "marathon"):
            fail(f"events[{i}].type must be 'sprint' or 'marathon', got {e['type']!r}")
        ps = e["patterns"]
        if not isinstance(ps, list) or len(ps) != 3:
            n = len(ps) if isinstance(ps, list) else type(ps).__name__
            fail(f"events[{i}].patterns must be a list of 3 (got {n})")
        for j, p in enumerate(ps):
            miss = REQ_PATTERN_KEYS - set(p)
            if miss:
                fail(f"events[{i}].patterns[{j}] missing keys {sorted(miss)}; got {sorted(p)}")
            if not isinstance(p["cues"], list) or not p["cues"]:
                fail(f"events[{i}].patterns[{j}].cues must be a non-empty list")
            for k, c in enumerate(p["cues"]):
                if not isinstance(c, str) or not c.strip():
                    fail(f"events[{i}].patterns[{j}].cues[{k}] must be a non-empty string")


def sub_once(text, pattern, repl, label, flags=re.DOTALL):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        fail(f"failed to update {label} (replaced {n} times, expected 1)")
    return new


def banner_text(html_inner):
    """Decode the limited HTML entities used in banner trio fields back to plain text."""
    return (html_inner
            .replace("&middot;", "·")
            .replace("&ndash;",  "–")
            .replace("&mdash;",  "—")
            .replace("&amp;",    "&"))


def encode_banner(s):
    """Encode plain-text banner fields back into the HTML form the page uses."""
    return (s
            .replace("&", "&amp;")
            .replace("·", "&middot;")
            .replace("–", "&ndash;")
            .replace("—", "&mdash;"))


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("week_json", help="path to next week's JSON")
    ap.add_argument("--archive-note", required=True,
                    help="short note attached to the OUTGOING week when it gets archived")
    ap.add_argument("--dry-run", action="store_true",
                    help="validate and render, but do not write")
    args = ap.parse_args()

    # ---------- load + validate input ----------
    src_path = pathlib.Path(args.week_json)
    try:
        week = json.loads(src_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"NEXT.json not found: {src_path}")
    except json.JSONDecodeError as e:
        fail(f"NEXT.json did not parse: {e}")
    validate_week(week)

    src = PROGRAM.read_text(encoding="utf-8")

    # ---------- extract current banner trio ----------
    m_title = re.search(r'<div class="week-banner">\s*\n\s*<h2>(.*?)</h2>', src, re.DOTALL)
    m_sub   = re.search(r'<div class="week-sub">(.*?)</div>',   src, re.DOTALL)
    m_dates = re.search(r'<div class="week-dates">(.*?)</div>', src, re.DOTALL)
    if not (m_title and m_sub and m_dates):
        fail("banner title/sub/dates not found — page structure changed?")
    cur_title = banner_text(m_title.group(1)).strip()
    cur_sub   = banner_text(m_sub.group(1)).strip()
    cur_dates = banner_text(m_dates.group(1)).strip()

    # ---------- extract current events JSON ----------
    m_ev = re.search(
        r'<script type="application/json" id="program-events">(\[.*?\])</script>',
        src, re.DOTALL)
    if not m_ev:
        fail("program-events JSON island not found")
    try:
        cur_events = json.loads(m_ev.group(1))
    except json.JSONDecodeError as e:
        fail(f"current program-events JSON did not parse: {e}")
    if len(cur_events) != 10:
        fail(f"current week has {len(cur_events)} events (expected 10)")
    if [e["event"] for e in cur_events] != CANONICAL_EVENTS:
        fail(f"current events order is wrong: {[e['event'] for e in cur_events]}")

    # ---------- extract PAST_WEEKS ----------
    m_past = re.search(r'const PAST_WEEKS = (\[.*?\]);', src, re.DOTALL)
    if not m_past:
        fail("PAST_WEEKS literal not found")
    try:
        past_weeks = json.loads(m_past.group(1))
    except json.JSONDecodeError as e:
        fail(f"current PAST_WEEKS did not parse as JSON: {e}")

    # ---------- archive the outgoing week ----------
    archive_entry = {
        "weekTitle": cur_title,
        "weekSub":   cur_sub,
        "weekDates": cur_dates,
        "note":      args.archive_note,
        "events":    cur_events,
    }
    new_past = [archive_entry] + past_weeks

    new_html = src

    # ---------- banner trio ----------
    new_title = html.escape(week["weekTitle"])
    new_html = sub_once(
        new_html,
        r'(<div class="week-banner">\s*\n\s*<h2>).*?(</h2>)',
        lambda m: m.group(1) + new_title + m.group(2),
        "week-banner <h2>",
    )
    new_html = sub_once(
        new_html,
        r'(<div class="week-sub">).*?(</div>)',
        lambda m: m.group(1) + encode_banner(week["weekSub"]) + m.group(2),
        "week-sub",
    )
    new_html = sub_once(
        new_html,
        r'(<div class="week-dates">).*?(</div>)',
        lambda m: m.group(1) + encode_banner(week["weekDates"]) + m.group(2),
        "week-dates",
    )

    # ---------- week-note (replace inner HTML, keep structure) ----------
    new_html = sub_once(
        new_html,
        r'(<div class="week-note">)(.*?)(</div>\s*\n\s*<div class="tests-line">)',
        lambda m: f'{m.group(1)}\n      {week["weekNoteHtml"]}\n    {m.group(3)}',
        "week-note",
    )

    # ---------- tests-line (text only; preserve athlete-buttons) ----------
    new_html = sub_once(
        new_html,
        r'(<div class="tests-line">)(.*?)(<div class="athlete-buttons">)',
        lambda m: f'{m.group(1)}\n      {week["testsLineHtml"]}\n      {m.group(3)}',
        "tests-line",
    )

    # ---------- block-timeline current marker ----------
    # Strip 'current' class + b-now span from any pill that has them.
    new_html = re.sub(
        r'<div class="block-pill current">',
        '<div class="block-pill">',
        new_html,
    )
    new_html = re.sub(
        r'[ \t]*<span class="b-now">You are here</span>\s*\n',
        '',
        new_html,
    )
    # Set them on the pill whose <b-name> matches the requested marker.
    marker_html = week["blockMarker"].replace("&", "&amp;")
    pat_pill = (
        r'<div class="block-pill">\s*\n'
        r'(?P<indent>\s*)<div class="b-label">(?P<lbl>Block \d+)</div>\s*\n'
        r'\s*<div class="b-name">' + re.escape(marker_html) + r'</div>'
    )
    def mark(m):
        return (
            '<div class="block-pill current">\n'
            f'{m.group("indent")}<span class="b-now">You are here</span>\n'
            f'{m.group("indent")}<div class="b-label">{m.group("lbl")}</div>\n'
            f'{m.group("indent")}<div class="b-name">{marker_html}</div>'
        )
    new_html, n = re.subn(pat_pill, mark, new_html, count=1)
    if n != 1:
        fail(f"could not flag block-pill for blockMarker={week['blockMarker']!r}")

    # ---------- swap the program-events JSON ----------
    new_events_json = json.dumps(week["events"], ensure_ascii=False)
    new_html = sub_once(
        new_html,
        r'(<script type="application/json" id="program-events">)\[.*?\](</script>)',
        lambda m: m.group(1) + new_events_json + m.group(2),
        "program-events JSON",
    )

    # ---------- swap PAST_WEEKS ----------
    new_past_json = json.dumps(new_past, ensure_ascii=False)
    new_html = sub_once(
        new_html,
        r'(const PAST_WEEKS = )\[.*?\](;)',
        lambda m: m.group(1) + new_past_json + m.group(2),
        "PAST_WEEKS literal",
    )

    # ---------- post-validate ----------
    m_ev2 = re.search(
        r'<script type="application/json" id="program-events">(\[.*?\])</script>',
        new_html, re.DOTALL)
    m_past2 = re.search(r'const PAST_WEEKS = (\[.*?\]);', new_html, re.DOTALL)
    if not (m_ev2 and m_past2):
        fail("post-edit: data islands missing")
    try:
        out_events = json.loads(m_ev2.group(1))
        out_past   = json.loads(m_past2.group(1))
    except json.JSONDecodeError as e:
        fail(f"post-edit JSON did not parse: {e}")
    if len(out_events) != 10 or any(len(e["patterns"]) != 3 for e in out_events):
        fail("post-edit: events shape wrong (need 10 events × 3 patterns)")
    if [e["event"] for e in out_events] != CANONICAL_EVENTS:
        fail("post-edit: events order changed (must match canonical list)")
    if not out_past or out_past[0]["weekTitle"] != cur_title:
        fail("post-edit: PAST_WEEKS[0] is not the outgoing week")

    # ---------- report ----------
    print(f"  archived:  {cur_title}  · {cur_sub}")
    print(f"  current:   {week['weekTitle']}  · {week['weekSub']}  · block={week['blockMarker']}")
    print(f"  past size: {len(new_past)} week{'s' if len(new_past) != 1 else ''}")

    if args.dry_run:
        print(f"OK   dry-run: would write {PROGRAM} ({len(new_html)} bytes)")
        return

    PROGRAM.write_text(new_html, encoding="utf-8")
    print(f"OK   wrote {PROGRAM}")


if __name__ == "__main__":
    main()
