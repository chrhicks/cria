#!/usr/bin/env python3
"""Measures what real indiserver delivers to observing clients, for the cases a replay must reproduce.

Runs `indiserver -r 0 -p <free port> indi_simulator_ccd indi_simulator_focus indi_simulator_telescope
indi_simulator_weather` (isolated HOME, loopback). The "world" is one recorded run: a recorder client asks for
everything, a control client connects the simulators, the recorder asks again for each device (a driver
answers a getProperties with the properties it has now), then the control client takes an exposure, writes
values the drivers reject (so they answer with an Alert and their reason, as a vector message and as a
standalone <message>), changes FOCUS_MAX_VALUE (so the focuser changes the limits of its other properties at
runtime), has the weather simulator disconnect (it deletes its properties) and connect again (it defines
them anew), has the telescope's driver process killed (indiserver deletes its device) and takes a second
exposure. The recorder's stream is the tape.

Each scenario starts a fresh indiserver, repeats the setup up to the connected state, connects observers
a, b and c, then runs steps: a client sends XML, or "advance" (everything the control client does after the
first ask in the world above). After every step the script reads what each observer received, as raw XML.

  python3 -I measure-definitions.py > ../src/indiserver-definitions.json

Everything the drivers say is kept, standalone <message> elements too: only the BLOB bytes are dropped, and
each run's own HOME is renamed. Messages are stored once, by key; a scenario lists the keys each observer
received after each step. `volatile` lists the properties that change by themselves or with the time of day the
run began: the ones the simulators update while nobody asks (the telescope's position every fraction of a second,
the weather station's minute), and the ones another run defines with another value (the clock, the axes). How
many updates an observer gets depends on how long the real run took, and a value on another day is not today's;
a replay driven by the recording's frames shares neither. So the scenarios do not list their updates (the
comparison leaves them out), and the tape keeps one update in `THIN` of each. Takes about ten minutes; the
scenarios run four at a time.
"""
import hashlib, json, multiprocessing, os, re, select, signal, socket, subprocess, sys, tempfile, time
from pathlib import Path

CCD, FOCUS, SCOPE, WEATHER = 'CCD Simulator', 'Focuser Simulator', 'Telescope Simulator', 'Weather Simulator'
DRIVERS = ['indi_simulator_ccd', 'indi_simulator_focus', 'indi_simulator_telescope', 'indi_simulator_weather']
ELEMENT = re.compile(r'<(\w+)\b[^>]*?/>|<(\w+)\b[^>]*>.*?</\2>', re.S)


def ask(device=None, name=None):
    return '<getProperties version="1.7"' + (f' device="{device}"' if device else '') + (f' name="{name}"' if name else '') + '/>'


def enable(device, mode, name=None):
    return f'<enableBLOB device="{device}"' + (f' name="{name}"' if name else '') + f'>{mode}</enableBLOB>'


def numbers(device, name, **elements):
    return f'<newNumberVector device="{device}" name="{name}">' + ''.join(f'<oneNumber name="{k}">{v}</oneNumber>' for k, v in elements.items()) + '</newNumberVector>'


def switches(device, name, **elements):
    return f'<newSwitchVector device="{device}" name="{name}">' + ''.join(f'<oneSwitch name="{k}">{v}</oneSwitch>' for k, v in elements.items()) + '</newSwitchVector>'


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
    'a client watching everything hears every driver\'s words': [('a', ask()), ('advance',), ('b', ask())],
    'a client hears the words of the devices it watches and no others': [('a', ask(CCD)), ('b', ask(FOCUS)), ('c', ask(SCOPE)), ('advance',)],
    'a client watching one property hears no device\'s words': [('a', ask(CCD, 'CCD_GAIN')), ('b', ask(FOCUS, 'FOCUS_MAX')), ('advance',)],
    'a client watching the telescope and the weather hears their definitions and updates': [('a', ask(SCOPE)), ('b', ask(WEATHER)), ('c', ask(SCOPE, 'EQUATORIAL_EOD_COORD')), ('advance',), ('a', ask(SCOPE)), ('b', ask(WEATHER))],
    'a client that asked for the whole rig and then one device hears the rig': [('a', ask()), ('a', ask(CCD)), ('advance',)],
    'a client that asked for images hears the image': [('a', ask(CCD)), ('a', enable(CCD, 'Also')), ('b', ask(CCD)), ('advance',)],
    'a client that enabled images before asking for everything hears only that device': [('a', enable(CCD, 'Also')), ('a', ask()), ('b', ask()), ('advance',)],
    'a client that enabled only images hears nothing else': [('a', ask(CCD)), ('a', enable(CCD, 'Only')), ('b', ask(CCD)), ('advance',)],
    'Cria\'s own order: ask for everything, images on, images off': [('a', ask()), ('a', enable(CCD, 'Also')), ('advance',), ('a', enable(CCD, 'Never')), ('a', ask(CCD))],
    'a named ask for a property the driver also sets in its answer is answered with its definition alone': [('a', ask(SCOPE, 'TELESCOPE_MOUNT_TYPE')), ('b', ask(SCOPE)), ('a', ask(SCOPE, 'TELESCOPE_MOUNT_TYPE'))],
    'a number written outside its limits is refused with the reason, to every client that watches the property': [
        ('a', ask(FOCUS)), ('b', ask()), ('c', ask(CCD)),
        ('a', numbers(FOCUS, 'DELAY', DELAY_VALUE=-1)),
        ('c', numbers(CCD, 'CCD_GAIN', GAIN=-5)),
        ('a', numbers(FOCUS, 'DELAY', DELAY_VALUE=12345678)),
        ('b', numbers(CCD, 'CCD_GAIN', GAIN=300.5)),
        ('c', numbers(CCD, 'CCD_OFFSET', OFFSET=6001)),
        ('c', ask(CCD, 'CCD_GAIN')), ('a', ask(FOCUS, 'DELAY')),
    ],
    'only the first number out of its limits is reported and nothing in the write is applied': [
        ('a', ask(FOCUS)), ('b', ask(FOCUS, 'Presets')),
        ('a', numbers(FOCUS, 'Presets', PRESET_1=111, PRESET_2=-1, PRESET_3=-2)),
        ('b', ask(FOCUS, 'Presets')),
    ],
    'a number written within its limits is accepted': [
        ('a', ask(CCD)), ('b', ask(CCD, 'CCD_GAIN')),
        ('a', numbers(CCD, 'CCD_GAIN', GAIN=90)), ('a', numbers(CCD, 'CCD_GAIN', GAIN=300)), ('b', ask(CCD, 'CCD_GAIN')),
    ],
    'a switch vector that breaks its rule is refused with the reason, to every client that watches the property': [
        ('a', ask(FOCUS)), ('b', ask()), ('c', ask(CCD)),
        ('a', switches(FOCUS, 'DEBUG', ENABLE='On', DISABLE='On')),
        ('c', switches(CCD, 'DEBUG', ENABLE='Off', DISABLE='Off')),
        ('b', switches(FOCUS, 'DEBUG', DISABLE='Off')),
        ('a', switches(FOCUS, 'CONNECTION_MODE', CONNECTION_SERIAL='On', CONNECTION_TCP='On')),
        ('a', ask(FOCUS, 'DEBUG')),
    ],
    'a client hears a device go and come back': [('a', ask(WEATHER)), ('b', ask(WEATHER, 'WEATHER_PARAMETERS')), ('c', ask()), ('advance',), ('a', ask(WEATHER))],
}


# Writes the simulators refuse, each in its own way: an Alert carrying the reason on the vector, or only a <message>.
REJECTED = [
    (FOCUS, 'FOCUS_MAX', 'FOCUS_MAX_VALUE', -1),
    (CCD, 'CCD_GAIN', 'GAIN', -5),
    (CCD, 'CCD_BINNING', 'HOR_BIN', 99),
    (FOCUS, 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION', 99999999),
    (CCD, 'CCD_TEMPERATURE', 'CCD_TEMPERATURE_VALUE', 500),
]


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


VOLATILE = []
THIN = 25


def meaningful(text):
    """A stream without the updates the simulators make by themselves, which never stop and so never leave it quiet."""
    for device, name in VOLATILE:
        text = re.sub(rf'<set\w+Vector\b[^>]*?device="{re.escape(device)}"[^>]*?name="{re.escape(name)}".*?</set\w+Vector>', '', text, flags=re.S)
    return text


def read(socks, quiet=0.4, floor=0.6, ceiling=10):
    start = last = time.monotonic()
    data = {s: b'' for s in socks}
    seen = {s: 0 for s in socks}
    while True:
        now = time.monotonic()
        if (now - last > quiet and now - start > floor) or now - start > ceiling:
            break
        for s in select.select(socks, [], [], 0.05)[0]:
            chunk = s.recv(1 << 22)
            if chunk:
                data[s] += chunk
                length = len(meaningful(data[s].decode(errors='replace')))
                if length > seen[s]:
                    seen[s] = length
                    last = time.monotonic()
    return {s: elements(d.decode(errors='replace')) for s, d in data.items()}


def elements(text):
    """The definitions, updates, deletions and messages in a stream, as raw XML; the BLOB bytes are dropped,
    and each run's own HOME is renamed so the same property reads the same in every run."""
    found = []
    for match in ELEMENT.finditer(text):
        xml = match.group(0)
        if not re.match(r'<(def\w+Vector|set\w+Vector|delProperty|message)\b', xml):
            continue
        found.append(re.sub(r'/tmp/indi-home-\w+', '/tmp/indi-home', re.sub(r'(<oneBLOB\b[^>]*?)>.*?</oneBLOB>', r'\1/>', xml, flags=re.S)))
    return found


def key(xml):
    return hashlib.sha1(re.sub(r'\s+', ' ', re.sub(r'\s+timestamp="[^"]*"', '', xml)).encode()).hexdigest()[:12]


class Rig:
    def __init__(self):
        self.home = tempfile.mkdtemp(prefix='indi-home-')
        self.port = free_port()
        self.server = subprocess.Popen(['indiserver', '-r', '0', '-p', str(self.port), '-u', f'/tmp/indi-defs-{self.port}', *DRIVERS],
                                       env={**os.environ, 'HOME': self.home}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.control = connect(self.port)

    def close(self):
        self.server.terminate(); self.server.wait(timeout=5)

    def write(self, device, name, element, value):
        self.control.sendall(f'<newNumberVector device="{device}" name="{name}"><oneNumber name="{element}">{value}</oneNumber></newNumberVector>'.encode())

    def connect_devices(self, watchers=()):
        for device in (CCD, FOCUS, SCOPE, WEATHER):
            self.control.sendall(f'<newSwitchVector device="{device}" name="CONNECTION"><oneSwitch name="CONNECT">On</oneSwitch><oneSwitch name="DISCONNECT">Off</oneSwitch></newSwitchVector>'.encode())
        return read([self.control, *watchers], floor=2.5)

    def expose(self, watchers=()):
        self.write(CCD, 'CCD_EXPOSURE', 'CCD_EXPOSURE_VALUE', 0.05)
        return read([self.control, *watchers], floor=1.5)

    def reconnect(self, device, watchers=()):
        """The driver for `device` disconnects, which deletes its properties, and connects again, which defines them anew."""
        out = {w: [] for w in watchers}
        for on, off in (('Off', 'On'), ('On', 'Off')):
            self.control.sendall(f'<newSwitchVector device="{device}" name="CONNECTION"><oneSwitch name="CONNECT">{on}</oneSwitch><oneSwitch name="DISCONNECT">{off}</oneSwitch></newSwitchVector>'.encode())
            got = read([self.control, *watchers], floor=2)
            for w in watchers:
                out[w] += got[w]
        return out

    def kill(self, driver, watchers=()):
        """The driver process dies, and indiserver tells everyone its device is gone."""
        children = subprocess.run(['pgrep', '-P', str(self.server.pid)], capture_output=True, text=True).stdout.split()
        for child in children:
            if driver in Path(f'/proc/{child}/cmdline').read_text():
                os.kill(int(child), signal.SIGKILL)
        return read([self.control, *watchers], floor=2)

    def write_and_read(self, device, name, element, value, watchers=()):
        self.write(device, name, element, value)
        return read([self.control, *watchers], floor=1.2)

    def advance(self, watchers=()):
        """Exposure, writes the drivers reject, a focuser limit change, the weather station disconnecting and connecting, the telescope's driver dying, exposure; returns what the watchers received in order."""
        out = {w: [] for w in watchers}
        actions = [lambda: self.expose(watchers)]
        actions += [lambda w=w: self.write_and_read(*w, watchers) for w in REJECTED]
        actions += [lambda: self.write_and_read(FOCUS, 'FOCUS_MAX', 'FOCUS_MAX_VALUE', 50000, watchers), lambda: self.reconnect(WEATHER, watchers), lambda: self.kill('indi_simulator_telescope', watchers), lambda: self.expose(watchers)]
        for action in actions:
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

        send(ask()); take(read([rec], floor=2))
        send(enable(CCD, 'Also'))
        take(rig.connect_devices([rec]))
        for device in (CCD, FOCUS, SCOPE, WEATHER):
            send(ask(device)); take(read([rec], floor=2))
        for got in rig.advance([rec]).values():
            tape.extend(['in', xml] for xml in got)
        return tape
    finally:
        rig.close()


def volatile():
    """The properties that change by themselves: those the simulators update while nobody asks them anything, for
    long enough to see the weather station's minute, and those defined with another value when asked that much later.
    Also returns how this run defined every property, to compare with another run's."""
    rig = Rig()
    try:
        rig.connect_devices()
        watcher = connect(rig.port)

        def defined():
            watcher.sendall(ask().encode())
            return {match.groups(): key(xml) for xml in read([watcher], floor=2)[watcher] if (match := re.match(r'<def\w+Vector\b[^>]*?\bdevice="([^"]*)"[^>]*?\bname="([^"]*)"', xml))}

        before = defined()
        updated = set()
        for xml in read([watcher], quiet=999, floor=70, ceiling=75)[watcher]:
            match = re.match(r'<set\w+Vector\b[^>]*?\bdevice="([^"]*)"[^>]*?\bname="([^"]*)"', xml)
            if match:
                updated.add(match.groups())
        after = defined()
        moving = updated | {names for names, text in after.items() if before.get(names) not in (None, text)}
        return sorted(f'{device}/{name}' for device, name in moving), before
    finally:
        rig.close()


def volatile_set(xml):
    match = re.match(r'<set\w+Vector\b[^>]*?\bdevice="([^"]*)"[^>]*?\bname="([^"]*)"', xml)
    return bool(match) and match.groups() in VOLATILE


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
    quiet, other_run = volatile()
    VOLATILE.extend(tuple(name.split('/', 1)) for name in quiet)
    recorded = world()
    # A definition that is not the same in two runs (the telescope's clock and the position of its axes follow the time of day) is not the replay's to match. Both runs are read the same way: the last copy of a definition a driver repeats.
    answers, asked = {}, False
    for direction, xml in recorded:
        if direction == 'out':
            asked = 'device="' in xml
        elif asked and (match := re.match(r'<def\w+Vector\b[^>]*?\bdevice="([^"]*)"[^>]*?\bname="([^"]*)"', xml)):
            answers[match.groups()] = key(xml)
    quiet = sorted({*quiet, *(f'{device}/{name}' for (device, name), text in answers.items() if other_run.get((device, name), text) != text)})
    VOLATILE[:] = [tuple(name.split('/', 1)) for name in quiet]

    def intern(xml):
        messages[key(xml)] = xml
        return key(xml)

    seen = {}

    def kept(xml):
        match = re.match(r'<set\w+Vector\b[^>]*?\bdevice="([^"]*)"[^>]*?\bname="([^"]*)"', xml)
        if not match or f'{match.group(1)}/{match.group(2)}' not in quiet:
            return True
        seen[match.groups()] = seen.get(match.groups(), 0) + 1
        return seen[match.groups()] % THIN == 1

    tape = [[direction, intern(xml) if direction == 'in' else xml] for direction, xml in recorded if direction == 'out' or kept(xml)]
    scenarios = []
    with multiprocessing.get_context('fork').Pool(4) as pool:
        measured = pool.map(scenario, SCENARIOS.values())
    for (title, steps), heard in zip(SCENARIOS.items(), measured):
        scenarios.append({'title': title, 'steps': [{'client': s[0], 'send': s[1]} if s[0] != 'advance' else {'advance': True} for s in steps],
                          'heard': {name: [[intern(xml) for xml in step if not volatile_set(xml)] for step in per_step] for name, per_step in heard.items()}})
    json.dump({'indiserver': pacman_version(),
               'camera': CCD, 'focuser': FOCUS, 'volatile': quiet, 'messages': messages, 'tape': tape, 'scenarios': scenarios}, sys.stdout, indent=None, separators=(',', ':'))
    print()
