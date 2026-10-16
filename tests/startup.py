"""Expected startup refusals exit with code 3 and a message, never a crash signal.

Each refusal runs under tests/containment so that a regression back to an abort fails the check
without reaching the desktop crash reporter. Fixture processes only; no equipment."""
from smoke import Service, ROOT, DOTNET, TOKEN
import containment
import json, os, pathlib, tempfile, urllib.error, urllib.request

API = ROOT / 'src/Cria.Api/bin/Debug/net10.0/Cria.Api.dll'

def start(*args, token=TOKEN):
    result, why = containment.run_contained([DOTNET, str(API), *map(str, args)], 60, env={**os.environ, 'CRIA_TOKEN': token})
    assert result is not None, 'No process-local crash containment here (' + why + '); not running refusal checks'
    return result

def refused(result, text):
    assert result.returncode == 3, (result.returncode, result.stderr[-2000:])  # A signal would be negative.
    assert 'Cria refused to start:' in result.stderr and text in result.stderr, result.stderr[-2000:]

def main():
    refused(start(), 'Usage:')
    with tempfile.TemporaryDirectory(prefix='cria-startup-') as tmp:
        config = pathlib.Path(tmp) / 'config.json'
        config.write_text(json.dumps({'version': 1}))
        refused(start(config), 'Configuration refused')
        refused(start(pathlib.Path(tmp) / 'missing.json'), 'Configuration refused')
    print('Usage and configuration refusals exit 3 without a signal: PASS', flush=True)

    with Service() as s:
        s.ready('camera'); capture, _ = s.operation('camera', 'capture', dict(exposureSeconds=.02, light=True))
        refused(start(s.path), 'Data directory is in use')
        refused(start(s.path, token='short'), 'CRIA_TOKEN')
        assert s.get('/health')['status'] == 'online'
        print('Second instance and bad token refused cleanly; running service unaffected: PASS', flush=True)

    # With a token, a bare request is refused. Without CRIA_TOKEN there is no bearer check at all.
    with Service() as s:
        s.ready('camera')
        try: urllib.request.urlopen(s.url + '/v2/state', timeout=5); raise AssertionError('request without a token was accepted')
        except urllib.error.HTTPError as e: assert e.code == 401, e.code
    with Service(token=None) as s:
        s.ready('camera')
        with urllib.request.urlopen(s.url + '/v2/state', timeout=5) as response: assert response.status == 200
    print('Token set: bare request is 401; no token set: no bearer check: PASS', flush=True)

if __name__ == '__main__': main()
