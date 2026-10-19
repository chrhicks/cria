#!/usr/bin/env python3
"""Cuts a recording made by Cria's own recorder (`@cria/recording`) into the stream a test replays.

The recording is one Cria run against real indiserver 2.2.5 (indi_simulator_ccd, _focus and _telescope, isolated
HOME, loopback) while a second client connected and asked for the telescope. indiserver relays the telescope's
answers to the recorder, which is not the client that asked, and after the recorder's own named reads of other
devices. The cut keeps every request Cria sent, everything the telescope said, the camera's CONNECTION and CCD1, and
the first image (its bytes dropped, so a test can give it a frame of any size), and stops there. Timestamps and
indentation are removed; nothing else is changed.

  python3 -I cut-recording.py <recording directory> > ../src/recorded-answer.json
"""
import json, re, sys
from pathlib import Path

SCOPE, CCD = 'Telescope Simulator', 'CCD Simulator'
KEEP_CCD = {'CONNECTION', 'CCD1'}


def attribute(xml, name):
    found = re.search(rf'\b{name}="([^"]*)"', xml.split('>', 1)[0])
    return found.group(1) if found else None


def tidy(xml):
    xml = re.sub(r'\s+timestamp="[^"]*"', '', xml)
    xml = re.sub(r'\s+ref="[^"]*"', '', xml)

    return re.sub(r'>\s+<', '><', xml).strip()


stream = []
for line in Path(sys.argv[1], 'traffic.jsonl').read_text().splitlines():
    entry = json.loads(line)
    if entry['k'] != 'msg':
        continue
    xml = entry['xml']
    if entry['dir'] == 'out':
        stream.append(['out', tidy(xml)])
        continue
    device, name = attribute(xml, 'device'), attribute(xml, 'name')
    if device == SCOPE:
        stream.append(['in', tidy(xml)])
    elif device == CCD and name in KEEP_CCD:
        if xml.startswith('<setBLOBVector'):
            stream.append(['in', tidy(xml)])
            break
        stream.append(['in', tidy(xml)])

json.dump({'indiserver': '2.2.5', 'stream': stream}, sys.stdout, indent=0)
