#!/usr/bin/env python3
"""Measures which images and which other output real indiserver delivers to a client, for every ordered
sequence of up to three client commands over two devices.

The commands are getProperties for a device or for everything, and enableBLOB (Never, Also, Only) for device A, device B, A's
property IMG and B's property IMG. Each sequence is one client. A server holds a batch of clients; the
scripted driver (scripted-driver.py) then sends an image for A.IMG, an image for B.IMG, an update for A.EMIT
and one for B.EMIT, and each client records which of the four it received.

  python3 -I measure-blob-scope.py --length 3 --workers 8 > ../src/blob-scope.json     # about half a minute

Output: {"commands": [...], "rows": ["<command numbers>=<imageA><imageB><otherA><otherB>", ...]}, one row per
sequence, each result 1 (delivered) or 0. "otherA" is an update for A.EMIT, "otherB" one for B.EMIT.
"""
import argparse, itertools, json, multiprocessing, subprocess, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from scripted import *  # noqa: E402

COMMANDS = [['ask', A], ['ask', B], ['ask', None]] + [['enable', mode, device, name] for mode in ('Never', 'Also', 'Only') for device, name in ((A, None), (B, None), (A, 'IMG'), (B, 'IMG'))]
NAMES = [f"ask {c[1][-1] if c[1] else '*'}" if c[0] == 'ask' else f"{c[1]} {c[2][-1]}{'.IMG' if c[3] else ''}" for c in COMMANDS]
BATCH = 60
IMAGE = '<setBLOBVector device="{device}" name="IMG" state="Ok"><oneBLOB name="IMG" size="3" format=".txt">AAAA</oneBLOB></setBLOBVector>'
OTHER = '<setTextVector device="{device}" name="EMIT" state="Ok"><oneText name="XML">x</oneText></setTextVector>'


def text(command):
    return ask(command[1]) if command[0] == 'ask' else enable(command[2], command[1], command[3])


def batch(sequences):
    server, port = start_indiserver()
    try:
        control = connect(port)
        control.sendall(ask().encode())
        read([control], floor=1)
        clients = [connect(port) for _ in sequences]
        for client, sequence in zip(clients, sequences):
            if sequence:
                client.sendall(''.join(text(command) for command in sequence).encode())
        read([control, *clients], floor=1)
        got = [{} for _ in sequences]
        for key, device, xml in (('imageA', A, IMAGE), ('imageB', B, IMAGE), ('otherA', A, OTHER), ('otherB', B, OTHER)):
            control.sendall(emit(device, xml.format(device=device)).encode())
            heard = read([control, *clients], floor=0.6)
            for client, result in zip(clients, got):
                result[key] = any(f'device="{device}"' in element and ('BLOB' if key.startswith('image') else 'Text') in element for element in elements(heard[client]))

        return [','.join(str(COMMANDS.index(command)) for command in sequence) + '=' + ''.join('1' if result[key] else '0' for key in ('imageA', 'imageB', 'otherA', 'otherB')) for sequence, result in zip(sequences, got)]
    finally:
        server.terminate(); server.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--length', type=int, default=3)
    parser.add_argument('--workers', type=int, default=8)
    options = parser.parse_args()
    sequences = [list(s) for n in range(options.length + 1) for s in itertools.product(COMMANDS, repeat=n)]
    shards = [sequences[i:i + BATCH] for i in range(0, len(sequences), BATCH)]
    with multiprocessing.get_context('fork').Pool(options.workers) as pool:
        rows = [row for shard in pool.imap(batch, shards) for row in shard]
    print(json.dumps({'indiserver': subprocess.run(['pacman', '-Q', 'libindi'], capture_output=True, text=True).stdout.strip(), 'commands': NAMES, 'rows': rows}, indent=0))
