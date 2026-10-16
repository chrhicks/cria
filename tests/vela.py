"""Paired Cria/Vela check: Vela's own fixture script against a real Cria fixture service.

VELA_ROOT must be a built Vela checkout (pnpm install && pnpm build) that speaks protocol 4.
Vela's apps/server/scripts/check-cria-fixture.ts drives Vela's production client, adapter and
routes: inspection, capture and original transfer, cooling, focuser, framing, cancellation, and the
capture controller through preview, FITS and the saved image. Fixture processes only; no ASCOM
driver or equipment."""
from smoke import Service, TOKEN
import json, os, pathlib, subprocess, tempfile

vela = pathlib.Path(os.environ.get('VELA_ROOT', pathlib.Path(__file__).resolve().parents[2] / 'vela')).resolve()
script = vela / 'apps/server/scripts/check-cria-fixture.ts'
tsx = vela / 'apps/server/node_modules/.bin/tsx'
if not script.is_file() or not tsx.is_file() or not (vela / 'packages/cria/dist/client.js').is_file():
    raise SystemExit('Set VELA_ROOT to a built Vela checkout that speaks protocol 4 (pnpm install && pnpm build)')
revision = subprocess.run(['git', '-C', str(vela), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
print('Vela counterpart:', vela, revision, flush=True)

kinds = ['camera', 'mount', 'focuser', 'weather', 'switch']
with Service(devices=[dict(id=k, kind=k, progId='Cria.Fixture.' + k, expectedName='FIXTURE ' + k, connect=True) for k in kinds],
             imageBudgetBytes=256 * 1024 * 1024) as s, tempfile.TemporaryDirectory(prefix='cria-vela-') as tmp:
    for kind in kinds: s.ready(kind)
    state = s.get('/v2/state')
    connection = pathlib.Path(tmp) / 'connection.json'
    connection.write_text(json.dumps(dict(
        baseUrl=s.url, token=TOKEN, fixtureOnly=True, imageMode='ramp',
        devices=[dict(id=d['id'], kind=d['kind'], expectedName=d['expectedName'], bindingId=d['bindingId']) for d in state['devices']])))
    subprocess.run([str(tsx), str(script), str(connection)], check=True, cwd=vela / 'apps/server',
                   env={**os.environ, 'FIXTURE_TOKEN': TOKEN})
    print('Vela production client, adapter and routes against the Cria fixture: PASS', flush=True)
