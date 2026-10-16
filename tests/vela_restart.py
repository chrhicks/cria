"""Paired Cria/Vela check: one Vela client across a real Cria restart.

Vela's apps/server/scripts/check-cria-restart.ts captures once, waits while this script stops the
Cria fixture service and starts it again (new instanceId), then expects the same client to capture
again. A client that stays blocked after the restart fails here. Fixture processes only."""
from smoke import Service, TOKEN
import json, os, pathlib, subprocess, tempfile, time

vela = pathlib.Path(os.environ.get('VELA_ROOT', pathlib.Path(__file__).resolve().parents[2] / 'vela')).resolve()
script = vela / 'apps/server/scripts/check-cria-restart.ts'
tsx = vela / 'apps/server/node_modules/.bin/tsx'
if not script.is_file() or not tsx.is_file() or not (vela / 'packages/cria/dist/client.js').is_file():
    raise SystemExit('Set VELA_ROOT to a built Vela checkout that has check-cria-restart.ts (pnpm install && pnpm build)')

kinds = ['camera', 'mount', 'focuser', 'weather', 'switch']
with Service(devices=[dict(id=k, kind=k, progId='Cria.Fixture.' + k, expectedName='FIXTURE ' + k, connect=True) for k in kinds]) as s, \
        tempfile.TemporaryDirectory(prefix='cria-vela-restart-') as tmp:
    for kind in kinds: s.ready(kind)
    tmp = pathlib.Path(tmp)
    (tmp / 'connection.json').write_text(json.dumps(dict(
        baseUrl=s.url, token=TOKEN,
        devices=[dict(id=d['id'], kind=d['kind'], expectedName=d['expectedName']) for d in s.get('/v2/state')['devices']])))
    proc = subprocess.Popen([str(tsx), str(script), str(tmp / 'connection.json'), str(tmp)], cwd=vela / 'apps/server',
                            env={**os.environ, 'FIXTURE_TOKEN': TOKEN}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(300):
            if (tmp / 'first-capture-done').exists() or proc.poll() is not None: break
            time.sleep(.1)
        if not (tmp / 'first-capture-done').exists():
            raise SystemExit('Vela never finished its first capture:\n' + proc.communicate(timeout=5)[0])
        old = s.get('/v2/state')['instanceId']
        identity = s.get('/v2/service')
        assert s.request('/v2/service/stop', 'POST', {'instanceId': identity['instanceId']})[0] == 202
        s.process.wait(timeout=30)
        s.start()
        for kind in kinds: s.ready(kind)
        assert s.get('/v2/state')['instanceId'] != old, 'restart must give a new instanceId'
        (tmp / 'cria-restarted').write_text('')
        out, _ = proc.communicate(timeout=120)
    finally:
        if proc.poll() is None: proc.kill()
    print(out.strip()[-1500:])
    assert proc.returncode == 0, f'Vela restart check failed ({proc.returncode})'
    print('Vela client across a Cria restart: PASS', flush=True)
