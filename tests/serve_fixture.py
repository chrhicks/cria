"""Keep a five-device, loopback-only fixture alive for Vela browser acceptance."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import socket
import threading
import uuid

from smoke import Service, ROOT, TOKEN


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, help='New, empty run directory; never reuses old ownership/data')
    parser.add_argument('--port', type=int, default=0, help='Loopback port, or 0 to choose a free port')
    parser.add_argument('--width', type=int, default=1024)
    parser.add_argument('--height', type=int, default=768)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or not 1 <= args.width <= 6248 or not 1 <= args.height <= 6248:
        parser.error('Port must be 0–65535; each image dimension must be 1–6248')
    if args.width * args.height > 6248 * 4176:
        parser.error('Frame must not exceed 26,091,648 pixels')

    # The credential and durable data stay private even with a permissive shell umask.
    os.umask(0o077)
    run = args.directory or ROOT / 'data' / 'vela-fixture' / (
        datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-') + uuid.uuid4().hex[:8]
    )
    run = run.resolve()
    run.mkdir(parents=True, exist_ok=False)
    port = args.port
    if port == 0:
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
    kinds = ['camera', 'mount', 'focuser', 'weather', 'switch']
    bindings = [dict(id=kind, kind=kind, progId='Cria.Fixture.' + kind,
                     expectedName='FIXTURE ' + kind, connect=True,
                     **(dict(fixtureWidth=args.width, fixtureHeight=args.height) if kind == 'camera' else {}))
                for kind in kinds]
    stopped = threading.Event()
    for signum in [signal.SIGINT, signal.SIGTERM]:
        signal.signal(signum, lambda *_: stopped.set())

    connection = run / 'connection.json'
    vela_config = run / 'vela-rigs.json'
    vela_environment = run / 'vela.env'
    with Service(directory=run, listen=f'http://127.0.0.1:{port}', devices=bindings,
                 pollMs=250, metadataMs=3000, callTimeoutMs=2000,
                 operationTimeoutMs=180000, imageTimeoutMs=30000,
                 maxPixels=max(3072, args.width * args.height),
                 imageBudgetBytes=256 * 1024 * 1024,
                 telemetryPayloadBytes=64 * 1024 * 1024, telemetryRetentionSeconds=3600) as service:
        for kind in kinds:
            service.ready(kind)
        state = service.get('/v2/state')
        info = dict(baseUrl=service.url, token=TOKEN, fixtureOnly=True,
                    imageMode='ramp', instanceId=state['instanceId'],
                    launcherPid=os.getpid(), apiPid=service.process.pid,
                    width=args.width, height=args.height,
                    devices=[dict(id=d['id'], kind=d['kind'], expectedName=d['expectedName'],
                                  bindingId=d['bindingId']) for d in state['devices']])
        connection.write_text(json.dumps(info, indent=2) + '\n')
        vela_config.write_text(json.dumps(dict(rigs=[dict(
            id='cria-fixture', name='Cria fixture', url=service.url,
            tokenEnv='VELA_CRIA_FIXTURE_TOKEN',
            devices=[{key: d[key] for key in ['id', 'kind', 'expectedName']} for d in info['devices']],
            imagingCameraId='camera', focalLengthMm=400,
        )]), indent=2) + '\n')
        vela_environment.write_text('VELA_CRIA_FIXTURE_TOKEN=' + TOKEN + '\n')
        try:
            print(json.dumps(dict(status='ready', baseUrl=service.url,
                                  connectionFile=str(connection), velaConfigFile=str(vela_config),
                                  velaEnvironmentFile=str(vela_environment), imageMode='ramp',
                                  note='Fixture pixels are not a sky or focus model')), flush=True)
            while not stopped.wait(1):
                if service.process.poll() is not None:
                    raise RuntimeError(f'Fixture API exited; inspect {run / "server.log"}')
        finally:
            # A leftover credential file must not look like a running endpoint.
            connection.unlink(missing_ok=True)
            vela_environment.unlink(missing_ok=True)
    print(json.dumps(dict(status='stopped', directory=str(run))), flush=True)


if __name__ == '__main__':
    main()
