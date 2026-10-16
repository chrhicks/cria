"""Every operation records where its time went: lane wait, worker call, image storage and the phases seen."""
from smoke import Service


def main():
    with Service() as s:
        s.ready('camera')
        capture, _ = s.operation('camera', 'capture', dict(exposureSeconds=1.2, light=True))
        cooling, _ = s.operation('camera', 'cooling', dict(coolerOn=True))
        assert capture['status'] == 'succeeded' and cooling['status'] == 'succeeded', (capture, cooling)

        def timings(op):
            page = s.get('/v2/telemetry/events?type=operation-timings&device=camera&limit=500')
            return next((e['details'] for e in page['events'] if e['details']['operationId'] == op['id']), None)

        shot = s.wait(lambda: timings(capture))
        assert shot['kind'] == 'capture', shot
        assert shot['laneWaitMs'] >= 0 and shot['workerMs'] >= 1200 and shot['adoptMs'] >= 0, shot
        assert shot['totalMs'] >= shot['workerMs'] + shot['adoptMs'], shot
        assert shot['retryingSamples'] == 0, shot
        names = [p['phase'] for p in shot['phases']]
        assert 'exposing' in names, shot
        assert [p['atMs'] for p in shot['phases']] == sorted(p['atMs'] for p in shot['phases']), shot

        other = s.wait(lambda: timings(cooling))
        assert other['kind'] == 'cooling' and other['adoptMs'] is None and other['workerMs'] >= 0, other
        print('Operation timings (lane wait, worker, image storage, phases): PASS', shot, flush=True)


if __name__ == '__main__':
    main()
