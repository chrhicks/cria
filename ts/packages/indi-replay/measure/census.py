#!/usr/bin/env python3
"""Lists every element and attribute real indiserver sent in the measured traffic, and where Cria's parser reads each.

  python3 -I census.py > census.md

The traffic is the committed measurements: `../src/indiserver-definitions.json` (the simulators) and
`../../fake-indi/src/message-routing.json` (the scripted driver). READS names, per kind of element, the line of
`indi/src/xml.ts` that decodes each attribute. The script checks that each of those lines still names its
attribute, so a change to the parser that moves a read fails here instead of leaving the table wrong. An
attribute with no line is sent and ignored; the equivalence test compares it all the same.
"""
import json, re
from collections import defaultdict
from pathlib import Path

here = Path(__file__).resolve().parent
parser = (here.parents[1] / 'indi' / 'src' / 'xml.ts').read_text().splitlines()

# kind of element -> attribute -> line of indi/src/xml.ts that reads it
READS = {
    'def vector': {'device': 387, 'name': 388, 'label': 390, 'state': 391, 'perm': 392, 'message': 393},
    'def element': {'name': 400, 'label': 401, 'min': 411, 'max': 412, 'step': 413},
    'set vector': {'device': 457, 'name': 458, 'state': 460, 'message': 461},
    'set element': {'name': 430, 'min': 440, 'max': 441, 'step': 442},
    'set BLOB vector': {'device': 501, 'name': 502, 'state': 504, 'message': 505},
    'oneBLOB': {'name': 482, 'format': 482, 'size': 492},
    'delProperty': {'device': 374, 'name': 374},
    'pingRequest': {'uid': 376},
}

for kind, attributes in READS.items():
    for attribute, line in attributes.items():
        assert attribute in parser[line - 1], f'xml.ts:{line} no longer reads {attribute} of a {kind}'


def kind_of(tag):
    if tag == 'setBLOBVector':
        return 'set BLOB vector'
    if tag in ('delProperty', 'pingRequest', 'oneBLOB'):
        return tag
    if re.fullmatch(r'def\w+Vector', tag):
        return 'def vector'
    if re.fullmatch(r'set\w+Vector', tag):
        return 'set vector'
    return 'def element' if tag.startswith('def') else 'set element' if tag.startswith('one') else tag


definitions = json.loads((here.parent / 'src' / 'indiserver-definitions.json').read_text())
routing = json.loads((here.parents[1] / 'fake-indi' / 'src' / 'message-routing.json').read_text())
elements = list(definitions['messages'].values()) + [xml for row in routing['emissions'] for heard in row['heard'].values() for xml in heard]

seen = defaultdict(int)
for xml in elements:
    for tag, attributes in re.findall(r'<(\w+)\b([^>]*)>', xml):
        for name in re.findall(r'([\w-]+)="', attributes):
            seen[(tag, name)] += 1

print('| element | attribute | times sent | read by Cria (`indi/src/xml.ts` line) |')
print('| --- | --- | ---: | --- |')
for (tag, name), count in sorted(seen.items()):
    line = READS.get(kind_of(tag), {}).get(name)
    print(f'| `{tag}` | `{name}` | {count} | {line or "not read"} |')
