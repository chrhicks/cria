#!/usr/bin/env python3
"""Measures which clients real indiserver delivers each kind of driver output to, and exactly what it delivers.

Runs `indiserver -r 0 -p <free port> scripted_a scripted_b` (isolated HOME, loopback) with the scripted driver
(scripted-driver.py) as two drivers, "Scripted A" and "Scripted B". For each EMISSION it starts a fresh
indiserver, connects one client per CLIENTS entry (each sends its commands: getProperties and enableBLOB),
has the driver (or a client) send the XML, and records what each client received, as raw XML.

  python3 -I measure-routing.py > ../src/message-routing.json

An element is stored with whitespace collapsed and `timestamp` removed (indiserver stamps its own time).
"""
import json, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scripted import *  # noqa: E402

CLIENTS = {
    'silent': [],
    'everything': [ask()],
    'A': [ask(A)],
    'A.EMIT': [ask(A, 'EMIT')],
    'A.NEW': [ask(A, 'NEW')],
    'B': [ask(B)],
    'A and B': [ask(A), ask(B)],
    'A, B.EMIT': [ask(A), ask(B, 'EMIT')],
    'A, enableBLOB A Never': [ask(A), enable(A, 'Never')],
    'A, enableBLOB A Also': [ask(A), enable(A, 'Also')],
    'A, enableBLOB A Only': [ask(A), enable(A, 'Only')],
    'A, enableBLOB A.EMIT Only': [ask(A), enable(A, 'Only', 'EMIT')],
    'A.EMIT, enableBLOB A.EMIT Only': [ask(A, 'EMIT'), enable(A, 'Only', 'EMIT')],
    'A.EMIT, enableBLOB A Only': [ask(A, 'EMIT'), enable(A, 'Only')],
    'enableBLOB A Also': [enable(A, 'Also')],
    'enableBLOB A Only': [enable(A, 'Only')],
    'everything, enableBLOB A Also': [ask(), enable(A, 'Also')],
    'everything, enableBLOB A Never': [ask(), enable(A, 'Never')],
    'everything, enableBLOB A Only': [ask(), enable(A, 'Only')],
    'everything, enableBLOB B Only': [ask(), enable(B, 'Only')],
    'B, enableBLOB A Only': [ask(B), enable(A, 'Only')],
    'A and B, enableBLOB A Only': [ask(A), ask(B), enable(A, 'Only')],
    'A and B, enableBLOB A Only, B Also': [ask(A), ask(B), enable(A, 'Only'), enable(B, 'Also')],
    'A and B, enableBLOB A Only, then A Also': [ask(A), ask(B), enable(A, 'Only'), enable(A, 'Also')],
    'A and B, enableBLOB A Only, B Only': [ask(A), ask(B), enable(A, 'Only'), enable(B, 'Only')],
    'A and B, enableBLOB A Only, B Only, then A Never': [ask(A), ask(B), enable(A, 'Only'), enable(B, 'Only'), enable(A, 'Never')],
}

DEFINE_NEW = '<defTextVector device="Scripted A" name="NEW" label="New" group="Main" state="Ok" perm="rw" timeout="60"><defText name="V" label="V">v</defText></defTextVector>'

# title, what the driver sends (or {"client": name, "xml": ...}), what to send first, and how the fake is told to do the same
EMISSIONS = [
    ('a message for a device', '<message device="Scripted A" timestamp="2026-10-19T00:00:00" message="hello &amp; &lt;bye&gt;"/>', [], {'op': 'message', 'device': A, 'text': 'hello & <bye>'}),
    ('a message without a device', '<message timestamp="2026-10-19T00:00:00" message="no device"/>', [], {'op': 'message', 'text': 'no device'}),
    ('a message for another driver\'s device', '<message device="Scripted B" message="wrong driver"/>', [], {'op': 'message', 'device': B, 'text': 'wrong driver'}),
    ('a message for a device that does not exist', '<message device="Nope" message="x"/>', [], {'op': 'message', 'device': 'Nope', 'text': 'x'}),
    ('a message without text', '<message device="Scripted A"/>', [], {'op': 'message', 'device': A}),
    ('an update with a message', '<setTextVector device="Scripted A" name="EMIT" state="Alert" message="nope &amp; more"><oneText name="XML">x</oneText></setTextVector>', [], {'op': 'update', 'device': A, 'name': 'EMIT', 'state': 'Alert', 'values': {'XML': 'x'}, 'message': 'nope & more'}),
    ('an update without a message', '<setTextVector device="Scripted A" name="EMIT" state="Ok"><oneText name="XML">x</oneText></setTextVector>', [], {'op': 'update', 'device': A, 'name': 'EMIT', 'state': 'Ok', 'values': {'XML': 'x'}}),
    ('a definition with a message', DEFINE_NEW.replace('timeout="60"', 'timeout="60" message="defmsg"'), [], {'op': 'define', 'message': 'defmsg'}),
    ('a definition without a message', DEFINE_NEW, [], {'op': 'define'}),
    ('a deletion of a property with a message', '<delProperty device="Scripted A" name="NEW" message="delmsg"/>', [DEFINE_NEW], {'op': 'removeVector', 'device': A, 'name': 'NEW', 'message': 'delmsg', 'defined': True}),
    ('a deletion of a property without a message', '<delProperty device="Scripted A" name="NEW"/>', [DEFINE_NEW], {'op': 'removeVector', 'device': A, 'name': 'NEW', 'defined': True}),
    ('a deletion of a device with a message', '<delProperty device="Scripted A" message="gone"/>', [], {'op': 'removeDevice', 'device': A, 'message': 'gone'}),
    ('a deletion of a device', '<delProperty device="Scripted A"/>', [], {'op': 'removeDevice', 'device': A}),
    ('an image with a message', '<setBLOBVector device="Scripted A" name="IMG" state="Ok" timeout="60" message="blobmsg"><oneBLOB name="IMG" size="3" format=".txt" len="3">AAAA</oneBLOB></setBLOBVector>', [], {'op': 'image', 'device': A, 'name': 'IMG', 'element': 'IMG', 'data': 'AAAA', 'format': '.txt', 'timeout': 60, 'message': 'blobmsg'}),
    ('a client\'s ping', {'client': 'everything', 'xml': '<pingRequest uid="p1"/>'}, [], {'op': 'ping', 'client': 'everything', 'uid': 'p1'}),
    ('a driver\'s ping request', '<pingRequest uid="drv1"/>', [], {'op': 'none'}),
]

def measure(driver, before):
    server, port = start_indiserver()
    try:
        control = connect(port)
        control.sendall(ask().encode())
        read([control], floor=1)
        clients = {name: connect(port) for name in CLIENTS}
        for name, commands in CLIENTS.items():
            if commands:
                clients[name].sendall(''.join(commands).encode())
        everyone = [control, *clients.values()]
        read(everyone, floor=1)
        for xml in before:
            control.sendall(emit(A, xml).encode())
            read(everyone, floor=0.6)
        if isinstance(driver, dict):
            clients[driver['client']].sendall(driver['xml'].encode())
        else:
            control.sendall(emit(A, driver).encode())
        heard = read(everyone, floor=0.9)

        return {name: elements(heard[sock]) for name, sock in clients.items()}
    finally:
        server.terminate(); server.wait(timeout=5)


if __name__ == '__main__':
    version = subprocess.run(['pacman', '-Q', 'libindi'], capture_output=True, text=True).stdout.strip()
    rows = []
    for title, driver, before, fake in EMISSIONS:
        rows.append({'title': title, 'driver': driver, 'before': before, 'fake': fake, 'heard': measure(driver, before)})
    json.dump({'indiserver': version, 'clients': CLIENTS, 'emissions': rows}, sys.stdout, indent=1)
    print()
