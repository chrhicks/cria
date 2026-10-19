#!/usr/bin/env python3
"""Reduces measure-enable-blob.py output to what a client can tell apart, and checks it is coherent.

For every sequence: `withheld` is true when the observer received no definition, update or deletion in any
phase (and false when it received them in all phases; anything in between aborts), and `image` is whether
the exposure's image arrived. The control client, which never sent enableBLOB, must never receive an image.
Usage: summarize-enable-blob.py measured.jsonl > ../src/enable-blob-sequences.json
"""
import json, sys

rows = []
for line in open(sys.argv[1]):
    measured = json.loads(line)
    phases = measured['phases']
    empty = {phase: sum(n for key, n in counts.items() if key != 'controlGotImage' and not key.endswith(':blob')) == 0 for phase, counts in phases.items()}
    assert not any(counts.get('controlGotImage') for counts in phases.values()), measured['sequence']
    assert len(set(empty.values())) == 1, (measured['sequence'], empty)
    images = phases['exposure'].get('CCD1:blob', 0)
    assert images in (0, 1), measured['sequence']
    rows.append({'sequence': measured['sequence'], 'withheld': empty['exposure'], 'image': images == 1})

print('[')
print(',\n'.join('  ' + json.dumps(row, separators=(',', ':')) for row in rows))
print(']')
