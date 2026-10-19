#!/usr/bin/env python3
"""Measure what real indiserver delivers to a client for every ordered sequence of enableBLOB commands.

Runs `indiserver -r 0 -p <free port> indi_simulator_ccd` (one per worker, isolated HOME) and, for every
ordered sequence of up to `--length` commands drawn from COMMANDS, connects a fresh observer, sends the
sequence, and records what that observer receives for CONNECTION (switch), CCD_EXPOSURE (number) and
CCD1 (BLOB). One observer at a time per server, because indiserver answers a getProperties to every
client, so concurrent observers would see each other's replies. A control client (default mode, so it is
also the per-client check: it must never receive an image) drives the simulator.

  python3 -I measure-enable-blob.py --length 3 --workers 12 > measured.jsonl   # about 2 minutes
  python3 -I summarize-enable-blob.py measured.jsonl > ../src/enable-blob-sequences.json

Phases, each recorded as def/set/del/blob counts per watched property:
  disconnected-getProperties  the observer asks for the device while the simulator is disconnected
  connected                   the control client connects the simulator (definitions and updates are broadcast)
  device-getProperties        the observer asks for the device again
  ccd1-getProperties          the observer asks for name=CCD1
  exposure                    the control client takes a 0.05 s exposure (updates and the image)
  disconnected                the control client disconnects the simulator (delProperty broadcast)
Output: one JSON line per sequence: {"sequence": [[mode, name|null], ...], "phases": {phase: counts}}.
"""
import argparse, itertools, json, multiprocessing, os, re, select, socket, subprocess, tempfile, time

DEV = 'CCD Simulator'
WATCHED = ('CONNECTION', 'CCD_EXPOSURE', 'CCD1')
COMMANDS = [(mode, None) for mode in ('Never', 'Also', 'Only')] + [(mode, 'CCD1') for mode in ('Never', 'Also', 'Only')] + [('Only', 'CONNECTION')]


def connect(port):
    for _ in range(100):
        try:
            return socket.create_connection(('127.0.0.1', port), 0.2)
        except OSError:
            time.sleep(0.05)
    raise SystemExit('indiserver did not start')


def read(socks, quiet=0.35, floor=0.5, ceiling=8):
    """Reads until nothing has arrived for `quiet` seconds (and at least `floor` have passed)."""
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


def counts(text):
    seen = {}
    for kind, name in re.findall(r'<(def\w+Vector|set\w+Vector|delProperty)\b[^>]*?\bname="([^"]+)"', text):
        if name in WATCHED:
            label = 'def' if kind.startswith('def') else 'blob' if kind == 'setBLOBVector' else 'set' if kind.startswith('set') else 'del'
            seen[f'{name}:{label}'] = seen.get(f'{name}:{label}', 0) + 1
    other = len(re.findall(r'<(?:def|set)\w+Vector\b', text)) - sum(v for k, v in seen.items() if not k.endswith(':del'))
    return {**dict(sorted(seen.items())), 'otherDefOrSet': other}


def enable(mode, name):
    scope = f' name="{name}"' if name else ''
    return f'<enableBLOB device="{DEV}"{scope}>{mode}</enableBLOB>'


def switch(control, connected):
    on, off = ('On', 'Off') if connected else ('Off', 'On')
    control.sendall(f'<newSwitchVector device="{DEV}" name="CONNECTION"><oneSwitch name="CONNECT">{on}</oneSwitch><oneSwitch name="DISCONNECT">{off}</oneSwitch></newSwitchVector>'.encode())


def worker(sequences):
    home = tempfile.mkdtemp(prefix='indi-home-')
    probe = socket.socket(); probe.bind(('127.0.0.1', 0)); port = probe.getsockname()[1]; probe.close()
    server = subprocess.Popen(['indiserver', '-r', '0', '-p', str(port), '-u', f'/tmp/indi-measure-{port}', 'indi_simulator_ccd'],
                              env={**os.environ, 'HOME': home}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = []
    try:
        control = connect(port)
        control.sendall(b'<getProperties version="1.7"/>'); read([control], floor=1)
        switch(control, False); read([control], floor=1.5)
        for sequence in sequences:
            observer = connect(port)
            result = {}

            def phase(name, action):
                action()
                texts = read([observer, control])
                result[name] = counts(texts[observer])
                if 'CCD1:blob' in counts(texts[control]):
                    result[name]['controlGotImage'] = True

            observer.sendall(''.join(enable(*c) for c in sequence).encode())
            phase('disconnected-getProperties', lambda: observer.sendall(f'<getProperties version="1.7" device="{DEV}"/>'.encode()))
            phase('connected', lambda: switch(control, True))
            phase('device-getProperties', lambda: observer.sendall(f'<getProperties version="1.7" device="{DEV}"/>'.encode()))
            phase('ccd1-getProperties', lambda: observer.sendall(f'<getProperties version="1.7" device="{DEV}" name="CCD1"/>'.encode()))
            phase('exposure', lambda: control.sendall(f'<newNumberVector device="{DEV}" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">0.05</oneNumber></newNumberVector>'.encode()))
            phase('disconnected', lambda: switch(control, False))
            observer.close()
            read([control], floor=0.2)
            out.append({'sequence': sequence, 'phases': result})
    finally:
        server.terminate(); server.wait(timeout=5)
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--length', type=int, default=3)
    parser.add_argument('--workers', type=int, default=8)
    options = parser.parse_args()
    sequences = [list(s) for n in range(options.length + 1) for s in itertools.product(COMMANDS, repeat=n)]
    shards = [sequences[i::options.workers] for i in range(options.workers)]
    with multiprocessing.get_context('fork').Pool(options.workers) as pool:
        results = pool.map(worker, shards)
    by_sequence = {json.dumps(r['sequence']): r for shard in results for r in shard}
    for sequence in sequences:
        print(json.dumps(by_sequence[json.dumps(sequence)]), flush=True)
