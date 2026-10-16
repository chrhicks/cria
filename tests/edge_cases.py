"""Vela integration regressions for optional timestamps, cleanup and progress."""
from smoke import Service
from faults import fault, device


def capture_timestamps(mode):
    with Service(operationTimeoutMs=500) as s:
        s.ready('camera')
        fault(s, 'camera', mode)
        images = []
        for _ in range(2):
            op, _ = s.operation('camera', 'capture', dict(exposureSeconds=.2, light=True))
            assert op['status'] == 'succeeded' and op['settled'], op
            images.append(op['image'])
        expected = 'server-estimate' if mode == 'timestamp-unsupported' else 'camera'
        assert all(image['capturedAtSource'] == expected for image in images), images
        if mode == 'timestamp-coarse':
            assert images[0]['capturedAt'] == images[1]['capturedAt'], images
        assert images[0]['id'] != images[1]['id']
        assert s.get(images[0]['original']['url']) != s.get(images[1]['original']['url'])
        print(mode + ': two fresh captures PASS', flush=True)


def stale_frame():
    with Service(operationTimeoutMs=500) as s:
        first, _ = s.operation('camera', 'capture', dict(exposureSeconds=.2, light=True))
        assert first['status'] == 'succeeded', first
        s.ready('camera'); fault(s, 'camera', 'stale-frame')
        op, _ = s.operation('camera', 'capture', dict(exposureSeconds=.2, light=True))
        assert op['status'] == 'uncertain' and op['blocksDevice'] and op['image'] is None, op
        print('Unchanged timestamp without fresh readiness transition remains rejected: PASS', flush=True)


def motion_cleanup(kind, mode):
    with Service(operationTimeoutMs=500) as s:
        focus = kind == 'focuser'
        s.ready(kind); fault(s, kind, mode)
        op, _ = s.operation(kind, 'focuser-move' if focus else 'mount-home',
                            dict(position=1200, minPosition=100, maxPosition=2000) if focus else {})
        if mode == 'motion-timeout':
            assert op['status'] == 'failed' and op['settled'] and not op['blocksDevice'], op
            assert 'stationary readback obtained' in op['message'], op
            current = s.ready(kind)
            assert current['fields']['moving' if focus else 'slewing']['value'] is False, current
            fault(s, kind, 'none')
            next_op, _ = s.operation(kind, 'focuser-halt' if focus else 'mount-stop', {})
            assert next_op['status'] == 'succeeded', next_op
        else:
            assert op['status'] == 'uncertain' and not op['settled'] and op['blocksDevice'], op
            assert device(s, kind)['blocked']
        print(kind + ' ' + mode + ': cleanup settlement PASS', flush=True)


def exposure_progress():
    with Service() as s:
        op, _ = s.operation('camera', 'capture', dict(exposureSeconds=1.2, light=True), wait=False)
        path = '/v2/operations/' + op['id']
        first = s.wait(lambda: (lambda x: x if (x.get('elapsedSeconds') or 0) > 0 else None)(s.get(path)))
        later = s.wait(lambda: (lambda x: x if (x.get('elapsedSeconds') or 0) > first['elapsedSeconds'] else None)(s.get(path)))
        assert later['status'] == 'running' and 0 < later['elapsedSeconds'] < 1.2, later
        terminal = s.terminal(op['id'])
        assert terminal['status'] == 'succeeded' and terminal['elapsedSeconds'] >= later['elapsedSeconds'], terminal
        print('Worker elapsed exposure progress reaches API and retained result: PASS', flush=True)


def tracking_readback():
    with Service(operationTimeoutMs=1200) as s:
        s.ready('mount'); fault(s, 'mount', 'tracking-delayed')
        before = fault(s, 'mount', 'stats')['writes']
        for expected in [True, False]:
            op, _ = s.operation('mount', 'mount-tracking', dict(tracking=expected))
            assert op['status'] == 'succeeded' and op['settled'] and not op['blocksDevice'], op
            assert op['result']['tracking'] is expected, op
            assert s.ready('mount')['fields']['tracking']['value'] is expected
        assert fault(s, 'mount', 'stats')['writes'] == before + 2
        print('Delayed tracking on/off readback confirms with exactly one write each: PASS', flush=True)
    with Service(operationTimeoutMs=500) as s:
        s.ready('mount'); fault(s, 'mount', 'tracking-unconfirmed')
        op, request = s.operation('mount', 'mount-tracking', dict(tracking=True))
        assert op['status'] == 'uncertain' and op['blocksDevice'] and not op['settled'], op
        assert op['acknowledged'] and op['message'] == 'Tracking readback not confirmed', op
        assert device(s, 'mount')['blocked']
        assert s.request('/v2/operations', 'POST', request)[1]['id'] == op['id']
        assert s.get('/v2/operations/' + op['id'])['status'] == 'uncertain'
        print('Unconfirmed tracking remains uncertain and blocked without replay: PASS', flush=True)


def main():
    tracking_readback()
    for mode in ['timestamp-unsupported', 'timestamp-coarse']:
        capture_timestamps(mode)
    stale_frame()
    for kind in ['focuser', 'mount']:
        for mode in ['motion-timeout', 'motion-stop-error', 'motion-stop-read-error']:
            motion_cleanup(kind, mode)
    exposure_progress()


if __name__ == '__main__':
    main()
