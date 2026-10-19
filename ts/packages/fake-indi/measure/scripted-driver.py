#!/usr/bin/env python3
"""A scripted INDI driver for measuring indiserver's routing: it says whatever it is told to.

indiserver runs it as a driver (symlinked as scripted_a and scripted_b, so each names its own device:
"Scripted A", "Scripted B"). It defines one text property, EMIT, and writes to indiserver, verbatim, the
XML a client puts (base64) in EMIT/XML. That lets a measurement make a driver send a standalone <message>,
a vector with a message, an update for a property that was never defined, a deletion and the rest,
which the simulators can only be coaxed into saying.
"""
import base64, os, re, sys

device = os.path.basename(sys.argv[0]).replace('_', ' ').title()


def out(text):
    sys.stdout.write(text)
    sys.stdout.flush()


def define():
    out(f'<defTextVector device="{device}" name="EMIT" label="Emit" group="Main" state="Ok" perm="rw" timeout="60"><defText name="XML" label="XML"></defText></defTextVector>\n')


buffer = ''
while True:
    chunk = os.read(0, 1 << 16).decode(errors='replace')
    if not chunk:
        break
    buffer += chunk
    while True:
        found = re.search(r'<(\w+)\b[^>]*?/>|<(\w+)\b[^>]*>.*?</\2>', buffer, re.S)
        if not found:
            break
        element, buffer = found.group(0), buffer[found.end():]
        if element.startswith('<getProperties'):
            asked = re.search(r'device="([^"]*)"', element)
            if not asked or asked.group(1) == device:
                define()
        elif element.startswith('<newTextVector') and f'device="{device}"' in element:
            payload = re.search(r'<oneText name="XML">(.*?)</oneText>', element, re.S)
            if payload:
                out(base64.b64decode(payload.group(1).strip()).decode() + '\n')
