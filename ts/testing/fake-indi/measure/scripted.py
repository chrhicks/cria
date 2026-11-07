"""Shared by the measure-*.py scripts that run indiserver with the scripted driver (scripted-driver.py)."""
import base64, os, re, select, socket, subprocess, tempfile, time
from pathlib import Path

A, B = 'Scripted A', 'Scripted B'


def ask(device=None, name=None):
    return '<getProperties version="1.7"' + (f' device="{device}"' if device else '') + (f' name="{name}"' if name else '') + '/>'


def enable(device, mode, name=None):
    return f'<enableBLOB device="{device}"' + (f' name="{name}"' if name else '') + f'>{mode}</enableBLOB>'


ELEMENT = re.compile(r'<(\w+)\b[^>]*?/>|<(\w+)\b[^>]*>.*?</\2>', re.S)


def connect(port):
    for _ in range(100):
        try:
            return socket.create_connection(('127.0.0.1', port), 0.2)
        except OSError:
            time.sleep(0.05)
    raise SystemExit('indiserver did not start')


def read(socks, quiet=0.3, floor=0.5, ceiling=8):
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
    return {s: d.decode(errors='replace') for s, d in data.items()}


def elements(text):
    """The elements of a stream, except the clients' own commands that indiserver also relays."""
    found = []
    for match in ELEMENT.finditer(text):
        xml = match.group(0)
        if re.match(r'<new\w+Vector\b', xml):
            continue
        found.append(re.sub(r'\s+', ' ', re.sub(r'\s+timestamp="[^"]*"', '', xml)).replace('> <', '><').strip())
    return found


def emit(device, xml):
    payload = base64.b64encode(xml.encode()).decode()
    return f'<newTextVector device="{device}" name="EMIT"><oneText name="XML">{payload}</oneText></newTextVector>'


def start_indiserver():
    """A fresh indiserver with the scripted driver as drivers A and B; returns (process, port)."""
    drivers = Path(tempfile.mkdtemp(prefix='indi-scripted-'))
    for name in ('scripted_a', 'scripted_b'):
        (drivers / name).symlink_to(Path(__file__).with_name('scripted-driver.py').resolve())
    probe = socket.socket(); probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]; probe.close()
    server = subprocess.Popen(['indiserver', '-r', '0', '-p', str(port), '-u', f'/tmp/indi-scripted-{port}', str(drivers / 'scripted_a'), str(drivers / 'scripted_b')],
                              env={**os.environ, 'HOME': tempfile.mkdtemp(prefix='indi-home-')}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return server, port
