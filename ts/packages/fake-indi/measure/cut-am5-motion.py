#!/usr/bin/env python3
"""Cuts AM5 motion fixtures for `playMotion` (src/play.ts) from errai's INDI recordings.

A fixture is what the AM5 driver said after one command, cut to the motion and its settle: the mount's property
updates, in the recorded order, each with its time after the command. Everything else is dropped (other devices, guide
pulses, the driver's answers to Cria's own `getProperties`, the definitions).

Positions are offsets from the mount's position when the command arrived (hours of RA, degrees of Dec), so a
fixture holds no coordinate. After a stop, the offsets are from where the mount would have been at the stop had it kept the
speed of its last two readings; `src/play.ts` makes the same estimate when the stop arrives. A goto fixture also records the
travel from the start to its target, so it plays only for a goto of that size. The cut refuses to write a fixture that
holds a number of the recording's own site (read from the recording's GEOGRAPHIC_COORD, never printed).

  python3 -I measure/cut-am5-motion.py --recordings /mnt/storage/rig/imports/errai-recordings --out fixtures/am5

Run from the fake-indi package. The same recordings give the same files byte for byte. Each CUT names a recording by
the start of its folder name and the moment of its commands, in seconds after the recording's first line. Read-only on
the recordings.
"""
import argparse, json, re, sys
from pathlib import Path

CUTS = [
    {
        'name': 'rate-move-9x-east-idle-coast',
        'recording': '2026-10-23T22-32-15',
        'start': 756.141,
        'stop': 759.289,
        'about': 'Axis move east at 9x with tracking off, stopped after 3.1 s. The coordinates read Idle throughout and the mount coasts about 1 s after the stop.',
    },
    {
        'name': 'rate-move-9x-west-tracking',
        'recording': '2026-10-26T23-28-43',
        'start': 608.909,
        'stop': 615.488,
        'about': 'Axis move west at 9x with tracking on, stopped after 6.6 s. The coordinates read Ok throughout: they never report Idle.',
    },
    {
        'name': 'goto-ok',
        'recording': '2026-10-26T23-28-43',
        'start': 1421.777,
        'about': 'A goto of 72 degrees of RA and 19.5 of Dec. Busy until it lands, then Ok within 2 arcseconds of the target; tracking stops for the slew and resumes at the end.',
    },
    {
        'name': 'home-idle-coast',
        'recording': '2026-10-23T22-32-15',
        'start': 26939.306,
        'about': 'Home from 46 degrees below the pole. The coordinates read Idle from the first reading, the mount keeps moving 12 s, and TELESCOPE_HOME reports Ok before the last move.',
    },
    {
        'name': 'home-abort',
        'recording': '2026-10-27T01-22-45',
        'start': 348.209,
        'stop': 352.468,
        'about': 'Home aborted after 4.3 s. The abort is answered Ok, TELESCOPE_HOME stays Busy, and the mount coasts 2 s. Recorded once, so a profile of one.',
    },
]

KEEP = {
    'EQUATORIAL_EOD_COORD',
    'TARGET_EOD_COORD',
    'TELESCOPE_MOTION_WE',
    'TELESCOPE_MOTION_NS',
    'TELESCOPE_HOME',
    'TELESCOPE_ABORT_MOTION',
    'TELESCOPE_TRACK_STATE',
    'TELESCOPE_PIER_SIDE',
}
POSITION = 'EQUATORIAL_EOD_COORD'
POSITIONS = {POSITION, 'TARGET_EOD_COORD'}
GUIDE = ('TELESCOPE_TIMED_GUIDE_NS', 'TELESCOPE_TIMED_GUIDE_WE')

# The AM5 shows RA and Dec to whole seconds (format %010.6m): a reading that moved by more than 1.5 of them moved.
DISPLAY_STEP = 1 / 3600
SETTLE_MS = 2000
DECIMALS = 9
TOLERANCE_MS = 1.5


def attributes(tag):
    return dict(re.findall(r'([\w-]+)="([^"]*)"', tag))


def read_recording(directory):
    manifest = json.loads((directory / 'manifest.json').read_text())
    mount = next(device['indiDevice'] for device in manifest['devices'] if device['kind'] == 'mount')
    messages, site, first, gaps = [], [], None, []

    for line in (directory / 'traffic.jsonl').read_text().splitlines():
        entry = json.loads(line)
        first = entry['at'] if first is None else first
        if entry['k'] == 'gap':
            gaps.append(entry['at'] - first)
        if entry['k'] != 'msg' or f'device="{mount}"' not in entry['xml']:
            continue
        xml = entry['xml']
        head = re.match(r'\s*<(def|set|new)(Number|Switch)Vector\b([^>]*)>', xml)
        if not head:
            continue
        tag = attributes(head.group(3))
        if tag.get('device') != mount:
            continue
        elements = [(name, value) for name, value in re.findall(r'<one(?:Number|Switch)\s+name="([^"]+)"[^>]*>\s*([^<]*?)\s*</one', xml)]
        if tag['name'] == 'GEOGRAPHIC_COORD':
            site.extend(value for _, value in re.findall(r'<(?:one|def)Number\s+name="([^"]+)"[^>]*>\s*([^<]*?)\s*</', xml))
        messages.append(
            {
                'i': len(messages),
                'ms': entry['at'] - first,
                'dir': entry['dir'],
                'verb': head.group(1),
                'kind': head.group(2).lower(),
                'name': tag['name'],
                'state': tag.get('state'),
                'elements': elements,
            }
        )

    return messages, site, gaps


def wrap(hours):
    return ((hours + 12) % 24) - 12


def rounded(value):
    return round(value, DECIMALS) + 0.0


def numbers(elements):
    values = dict(elements)

    return float(values['RA']), float(values['DEC'])


SIDEREAL_HOURS_PER_SECOND = 1.0027379093 / 3600


def moved(a, b, drifting):
    seconds = (b[0] - a[0]) / 1000
    drift = SIDEREAL_HOURS_PER_SECOND * seconds if drifting else 0

    return abs(wrap(b[1][0] - a[1][0] - drift)) > 1.5 * DISPLAY_STEP or abs(b[1][1] - a[1][1]) > 1.5 * DISPLAY_STEP


def step_of(message, command_ms, origin):
    step = {'afterMs': round(message['ms'] - command_ms), 'property': message['name'], 'state': message['state']}

    if message['name'] in POSITIONS:
        ra, dec = numbers(message['elements'])

        return {**step, 'offset': {'RA': rounded(wrap(ra - origin[0])), 'DEC': rounded(dec - origin[1])}}

    return {**step, 'values': {name: value == 'On' for name, value in message['elements']}}


def updates_between(messages, after, before):
    return [m for m in messages if m['dir'] == 'in' and m['verb'] == 'set' and m['name'] in KEEP and m['i'] > after['i'] and (before is None or m['i'] < before['i'])]


def tracking_off(messages, before):
    states = [m for m in messages if m['dir'] == 'in' and m['verb'] == 'set' and m['name'] == 'TELESCOPE_TRACK_STATE' and m['i'] < before['i']]

    return bool(states) and dict(states[-1]['elements']).get('TRACK_OFF') == 'On'


def motion_until_quiet(updates, previous, off):
    last_moved, previous_off = None, off
    for update in updates:
        if update['name'] == 'TELESCOPE_TRACK_STATE':
            off = dict(update['elements']).get('TRACK_OFF') == 'On'
        if update['name'] == POSITION:
            here = (update['ms'], numbers(update['elements']))
            if moved(previous, here, previous_off and off):
                if last_moved is not None and update['ms'] - last_moved > SETTLE_MS:
                    break
                last_moved = update['ms']
            previous, previous_off = here, off
    if last_moved is None:
        raise SystemExit('the mount never moved after the command')

    return [update for update in updates if update['ms'] <= last_moved + SETTLE_MS]


def command_of(messages, at_s):
    found = [m for m in messages if m['dir'] == 'out' and abs(m['ms'] - at_s * 1000) < TOLERANCE_MS and m['name'] not in GUIDE]
    if len(found) != 1:
        raise SystemExit(f'expected one command at {at_s} s, found {len(found)}')

    return found[0]


def command_match(message, rate):
    values = dict(message['elements'])
    if message['kind'] == 'number':
        return {'property': message['name'], 'target': True}
    on = [name for name, value in values.items() if value == 'On']
    if not on:
        return {'property': message['name'], 'allOff': True}

    return {'property': message['name'], 'on': on[0], **({'rate': rate} if message['name'].startswith('TELESCOPE_MOTION') else {})}


def extrapolate(readings, at_ms):
    if len(readings) < 2:
        return readings[-1][1] if readings else (0.0, 0.0)
    (t1, a), (t2, b) = readings[-2], readings[-1]
    seconds = (at_ms - t2) / (t2 - t1)

    return (b[0] + wrap(b[0] - a[0]) * seconds, b[1] + (b[1] - a[1]) * seconds)


def cut(spec, messages):
    start = command_of(messages, spec['start'])
    stop = command_of(messages, spec['stop']) if 'stop' in spec else None
    commands = [m for m in messages if m['dir'] == 'out' and m['name'] not in GUIDE and m['i'] > start['i'] and m is not stop]
    before = [m for m in messages if m['dir'] == 'in' and m['name'] == POSITION and m['verb'] == 'set' and m['i'] < start['i']]
    origin = numbers(before[-1]['elements'])
    rates = [m for m in messages if m['dir'] == 'in' and m['name'] == 'TELESCOPE_SLEW_RATE' and m['verb'] == 'set' and m['i'] < start['i']]
    rate = next(name for name, value in rates[-1]['elements'] if value == 'On') if rates else None
    command = command_match(start, rate)
    after_start = lambda m: step_of(m, start['ms'], origin)

    if stop is None:
        updates = motion_until_quiet(updates_between(messages, start, commands[0] if commands else None), (before[-1]['ms'], origin), tracking_off(messages, start))
        if command.get('target'):
            ra, dec = numbers(start['elements'])
            del command['target']
            command['travel'] = {'RA': rounded(wrap(ra - origin[0])), 'DEC': rounded(dec - origin[1])}
        phases = {'start': {'command': command, 'steps': [after_start(m) for m in updates]}}
        end = updates[-1]['ms']
    else:
        if any(m['i'] < stop['i'] for m in commands):
            raise SystemExit(f"{spec['name']}: another command arrived between the start and the stop")
        run = updates_between(messages, start, stop)
        readings = [(m['ms'] - start['ms'], numbers(m['elements'])) for m in run if m['name'] == POSITION]
        if len(readings) < 2:
            raise SystemExit(f"{spec['name']}: fewer than two readings before the stop, so no speed to continue at")
        (t1, a), (t2, b) = readings[-2], readings[-1]
        tail = motion_until_quiet(updates_between(messages, stop, commands[0] if commands else None), (start['ms'] + t2, b), tracking_off(messages, stop))
        pivot = extrapolate(readings, stop['ms'] - start['ms'])
        phases = {
            'start': {
                'command': command,
                'steps': [after_start(m) for m in run],
                'continue': {'everyMs': round(t2 - t1), 'offset': {'RA': rounded(wrap(b[0] - a[0])), 'DEC': rounded(b[1] - a[1])}},
            },
            'stop': {
                'command': command_match(stop, rate),
                'recordedAfterMs': round(stop['ms'] - start['ms']),
                'steps': [step_of(m, stop['ms'], pivot) for m in tail],
            },
        }
        end = tail[-1]['ms']

    source = {'recording': spec['recording'], 'startAtS': spec['start'], **({'stopAtS': spec['stop']} if stop else {})}

    return {'format': 1, 'name': spec['name'], 'about': spec['about'], 'source': source, **phases}, (start['ms'], end)


def site_forms(site):
    forms = set()
    for text in site:
        value = float(text)
        for candidate in {value, value - 360, value + 360}:
            for places in range(0, 7):
                forms.add(f'{candidate:.{places}f}')
        forms.add(text)

    return {form for form in forms if len(re.sub(r'\D', '', form)) >= 3 and float(form) != 0}


def holds(text, form):
    start = text.find(form)
    while start != -1:
        before, after = text[start - 1 : start], text[start + len(form) : start + len(form) + 1]
        if not (before.isdigit() and after.isdigit()):
            return True
        start = text.find(form, start + 1)

    return False


def render(fixture):
    def phase(name, body):
        lines = [f'  "{name}": {{', f'    "command": {json.dumps(body["command"])},']
        if 'recordedAfterMs' in body:
            lines.append(f'    "recordedAfterMs": {body["recordedAfterMs"]},')
        if 'continue' in body:
            lines.append(f'    "continue": {json.dumps(body["continue"])},')
        lines.append('    "steps": [')
        lines.append(',\n'.join('      ' + json.dumps(step) for step in body['steps']))
        lines.append('    ]')
        lines.append('  }')

        return '\n'.join(lines)

    parts = [
        '{',
        '  "format": 1,',
        f'  "name": {json.dumps(fixture["name"])},',
        f'  "about": {json.dumps(fixture["about"])},',
        f'  "source": {json.dumps(fixture["source"])},',
        phase('start', fixture['start']) + (',' if 'stop' in fixture else ''),
    ]
    if 'stop' in fixture:
        parts.append(phase('stop', fixture['stop']))
    parts.append('}')

    return '\n'.join(parts) + '\n'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recordings', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    cache = {}

    for spec in CUTS:
        if spec['recording'] not in cache:
            matches = sorted(args.recordings.glob(spec['recording'] + '*'))
            if len(matches) != 1:
                raise SystemExit(f'{spec["recording"]}: expected one recording, found {len(matches)}')
            cache[spec['recording']] = read_recording(matches[0])
        messages, site, gaps = cache[spec['recording']]
        fixture, (from_ms, to_ms) = cut(spec, messages)
        text = render(fixture)
        if any(from_ms <= gap <= to_ms for gap in gaps):
            raise SystemExit(f'{spec["name"]}: the recording has a gap inside the cut')
        if any(holds(text, form) for form in site_forms(site)):
            raise SystemExit(f'{spec["name"]}: the fixture holds a number of the recording\'s own site: not written')
        (args.out / f'{spec["name"]}.json').write_text(text)
        steps = len(fixture['start']['steps']) + len(fixture.get('stop', {}).get('steps', []))
        print(f'{spec["name"]}: {steps} steps')


if __name__ == '__main__':
    main()
