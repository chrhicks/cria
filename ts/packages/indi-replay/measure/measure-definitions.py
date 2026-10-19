#!/usr/bin/env python3
"""Measures what real indiserver delivers to observing clients, for the cases a replay must reproduce.

Runs `indiserver -r 0 -p <free port> indi_simulator_ccd indi_simulator_focus` (isolated HOME, loopback).
The "world" is one recorded run: a recorder client asks for everything, a control client connects both
simulators, the recorder asks again for each device (a driver answers a getProperties with the properties it
has now), then the control client takes an exposure, changes FOCUS_MAX_VALUE (so the focuser changes the limits
of its other properties at runtime) and takes a second exposure. The recorder's stream is the tape.

Each scenario starts a fresh indiserver, repeats the setup up to the connected state, connects observers
a, b and c, then runs steps: a client sends XML, or "advance" (the control client's two exposures and the
focus change). After every step the script reads what each observer received, as raw XML.

  python3 -I measure-definitions.py > ../src/indiserver-definitions.json

Messages are stored once, by key; a scenario lists the keys each observer received after each step.
"""
import json, os, re, select, socket, subprocess, sys, tempfile, time, hashlib

CCD, FOCUS = 'CCD Simulator', 'Focuser Simulator'
ELEMENT = re.compile(r'<(\w+)\b[^>]*?/>|<(\w+)\b[^>]*>.*?</\2>', re.S)


def ask(device=None, name=None):
    return '<getProperties version="1.7"' + (f' device="{device}"' if device else '') + (f' name="{name}"' if name else '') + '/>'


def enable(device, mode, name=None):
    return f'<enableBLOB device="{device}"' + (f' name="{name}"' if name else '') + f'>{mode}</enableBLOB>'


SCENARIOS = {
    'unsubscribed client hears nothing': [('a', ask(CCD)), ('advance',)],
    'a device-wide ask reaches every client that watches the device': [('a', ask(CCD)), ('b', ask(CCD)), ('a', ask(CCD))],
    'a named ask is answered once, to every client that watches the device': [('a', ask(CCD)), ('b', ask(CCD)), ('a', ask(CCD, 'CCD1'))],
    'a client watching one property hears only that property': [('a', ask(CCD)), ('b', ask(CCD, 'CONNECTION')), ('a', ask(CCD)), ('a', ask(CCD, 'CCD1'))],
    'a client that named only a property does not hear a device-wide answer': [('a', ask(CCD, 'CCD1')), ('b', ask(CCD))],
    'asking for everything covers every device': [('a', ask()), ('b', ask(FOCUS)), ('a', ask(CCD))],
    'enableBLOB subscribes like a getProperties': [('a', enable(CCD, 'Also')), ('b', ask(CCD))],
    'a property-scoped enableBLOB subscribes to that property': [('a', enable(CCD, 'Also', 'CCD1')), ('b', ask(CCD))],
    'an unknown device is answered by nobody': [('a', ask('No Such Device')), ('b', ask(CCD, 'No Such Property'))],
    'a client watching the focuser hears the limits it changes at runtime': [('a', ask(FOCUS)), ('b', ask(FOCUS, 'ABS_FOCUS_POSITION')), ('advance',), ('c', ask(FOCUS))],
}


def pacman_version():
    return subprocess.run(['pacman', '-Q', 'libindi'], capture_output=True, text=True).stdout.strip()


def free_port():
    probe = socket.socket(); probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]; probe.close()
    return port


def connect(port):
    for _ in range(100):
        try:
            return socket.create_connection(('127.0.0.1', port), 0.2)
        except OSError:
            time.sleep(0.05)
    raise SystemExit('indiserver did not start')


def read(socks, quiet=0.4, floor=0.6, ceiling=10):
    start = last = time.monotonic()
    data = {s: b'' for s in socks}
    while True:
        now = time.monotonic()
        if (now - last > quiet and now - start > floor) or now - start > ceiling:
            break
        for s in select.select(socks, [], [], 0.05)[0]:
            chunk = s.recv(1 << 22)
            if chunk:
                data[s] += chunk
                last = time.monotonic()
    return {s: elements(d.decode(errors='replace')) for s, d in data.items()}


def elements(text):
    """The definitions, updates and deletions in a stream, as raw XML; messages and the BLOB bytes are dropped,
    and each run's own HOME is renamed so the same property reads the same in every run."""
    found = []
    for match in ELEMENT.finditer(text):
        xml = match.group(0)
        if not re.match(r'<(def\w+Vector|set\w+Vector|delProperty)\b', xml):
            continue
        found.append(re.sub(r'/tmp/indi-home-\w+', '/tmp/indi-home', re.sub(r'(<oneBLOB\b[^>]*?)>.*?</oneBLOB>', r'\1/>', xml, flags=re.S)))
    return found


def key(xml):
    return hashlib.sha1(re.sub(r'\s+', ' ', re.sub(r'\s+timestamp="[^"]*"', '', xml)).encode()).hexdigest()[:12]


class Rig:
    def __init__(self):
        self.home = tempfile.mkdtemp(prefix='indi-home-')
        self.port = free_port()
        self.server = subprocess.Popen(['indiserver', '-r', '0', '-p', str(self.port), '-u', f'/tmp/indi-defs-{self.port}', 'indi_simulator_ccd', 'indi_simulator_focus'],
                                       env={**os.environ, 'HOME': self.home}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.control = connect(self.port)

    def close(self):
        self.server.terminate(); self.server.wait(timeout=5)

    def write(self, device, name, element, value):
        self.control.sendall(f'<newNumberVector device="{device}" name="{name}"><oneNumber name="{element}">{value}</oneNumber></newNumberVector>'.encode())

    def connect_devices(self, watchers=()):
        for device in (CCD, FOCUS):
            self.control.sendall(f'<newSwitchVector device="{device}" name="CONNECTION"><oneSwitch name="CONNECT">On</oneSwitch><oneSwitch name="DISCONNECT">Off</oneSwitch></newSwitchVector>'.encode())
        return read([self.control, *watchers], floor=2.5)

    def expose(self, watchers=()):
        self.write(CCD, 'CCD_EXPOSURE', 'CCD_EXPOSURE_VALUE', 0.05)
        return read([self.control, *watchers], floor=1.5)

    def advance(self, watchers=()):
        """Exposure, a focuser limit change, exposure; returns what the watchers received in order."""
        out = {w: [] for w in watchers}
        for action in (lambda: self.expose(watchers), lambda: (self.write(FOCUS, 'FOCUS_MAX', 'FOCUS_MAX_VALUE', 50000), read([self.control, *watchers], floor=1.5))[1], lambda: self.expose(watchers)):
            got = action()
            for w in watchers:
                out[w] += got[w]
        return out


def world():
    rig = Rig()
    try:
        rec = connect(rig.port)
        tape = []

        def send(xml):
            rec.sendall(xml.encode()); tape.append(['out', xml])

        def take(got):
            tape.extend(['in', xml] for xml in got[rec])

        send(enable(CCD, 'Also'))
        send(ask()); take(read([rec], floor=2))
        take(rig.connect_devices([rec]))
        send(ask(CCD)); take(read([rec], floor=2))
        send(ask(FOCUS)); take(read([rec], floor=2))
        take(rig.expose([rec]))
        rig.write(FOCUS, 'FOCUS_MAX', 'FOCUS_MAX_VALUE', 50000); take(read([rig.control, rec], floor=1.5))
        take(rig.expose([rec]))
        return tape
    finally:
        rig.close()


def scenario(steps):
    rig = Rig()
    try:
        rig.connect_devices()
        observers = {name: connect(rig.port) for name in 'abc'}
        heard = {name: [] for name in observers}
        for step in steps:
            if step[0] == 'advance':
                got = rig.advance(list(observers.values()))
            else:
                observers[step[0]].sendall(step[1].encode())
                got = read(list(observers.values()))
            for name, sock in observers.items():
                heard[name].append(got[sock])
        return heard
    finally:
        rig.close()


if __name__ == '__main__':
    messages = {}

    def intern(xml):
        messages[key(xml)] = xml
        return key(xml)

    tape = [[direction, intern(xml) if direction == 'in' else xml] for direction, xml in world()]
    scenarios = []
    for title, steps in SCENARIOS.items():
        heard = scenario(steps)
        scenarios.append({'title': title, 'steps': [{'client': s[0], 'send': s[1]} if s[0] != 'advance' else {'advance': True} for s in steps],
                          'heard': {name: [[intern(xml) for xml in step] for step in per_step] for name, per_step in heard.items()}})
    json.dump({'indiserver': pacman_version(),
               'camera': CCD, 'focuser': FOCUS, 'messages': messages, 'tape': tape, 'scenarios': scenarios}, sys.stdout, indent=None, separators=(',', ':'))
    print()
