#!/usr/bin/env python3
"""Regression tests for tools/strong-import.py.

Run: python3 tests/importer.test.py
Verifies the importer is tolerant of Strong's exercise-name whitespace/case
variants and reproduces the known per-athlete event counts.
"""
import subprocess, sys, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOOL = os.path.join(ROOT, 'tools', 'strong-import.py')

EXPECTED = {
    # athlete: minimum rows we must still map (guards against the trailing-space
    # 'Broad Jump ' regression that previously dropped 16 Tonnie rows)
    'tonnie': {'min_total': 300, 'must_have_events': {'broadjump', 'shuttle', 'jumprope'}},
    'peggy':  {'min_total': 180, 'must_have_events': {'broadjump', 'hang', 'dynamax'}},
    'robert': {'min_total': 100, 'must_have_events': {'prowler', 'jumprope', 'broadjump'}},
}

def run(slug):
    p = subprocess.run([sys.executable, TOOL, slug], capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f'importer failed for {slug}: {p.stderr}')
    m = re.search(r'-- (\d+) rows mapped', p.stderr)
    total = int(m.group(1)) if m else 0
    ev = re.search(r'-- by event: (\{.*\})', p.stderr)
    events = set(re.findall(r"'(\w+)'", ev.group(1))) if ev else set()
    return total, events

failures = []
for slug, exp in EXPECTED.items():
    total, events = run(slug)
    if total < exp['min_total']:
        failures.append(f'{slug}: only {total} rows (< {exp["min_total"]})')
    missing = exp['must_have_events'] - events
    if missing:
        failures.append(f'{slug}: missing events {missing}')
    else:
        print(f'PASS {slug}: {total} rows, events include {sorted(exp["must_have_events"])}')

# Idempotency: generated SQL must use the NOT EXISTS guard, never a bare VALUES insert
sql = subprocess.run([sys.executable, TOOL, 'tonnie'], capture_output=True, text=True).stdout
if 'WHERE NOT EXISTS' not in sql:
    failures.append('generated SQL is missing the NOT EXISTS idempotency guard')
else:
    print('PASS idempotency: NOT EXISTS guard present')

if failures:
    print('\nFAILURES:')
    for f in failures:
        print('  -', f)
    sys.exit(1)
print('\nAll importer tests passed.')
