"""Devices sharing a failure domain keep being observed; waiting for the shared lane must not cost a poll."""
from smoke import Service
import time

POLL_MS = 1000

def main():
    # Two devices share one lane, as the two ZWO cameras do. Slow reads make each poll hold the lane long
    # enough to collide with the other device's poll, as real camera drivers do.
    shared = ['camera', 'weather']
    bindings = [dict(id=k, kind=k, progId='Cria.Fixture.' + k, expectedName='FIXTURE ' + k, connect=True,
                     failureDomain='shared') for k in shared]
    with Service(devices=bindings, pollMs=POLL_MS, metadataMs=POLL_MS * 60, callTimeoutMs=2000) as s:
        for k in shared:
            s.ready(k)
            assert s.request('/v2/fixtures/' + k, 'POST', {'fault': 'slow-read'})[0] == 200
        last, worst = {}, {}
        end = time.time() + 15
        while time.time() < end:
            for d in s.get('/v2/state')['devices']:
                seen = d['fields']['connected']['observedAt']
                if d['id'] in last and seen != last[d['id']]:
                    worst[d['id']] = max(worst.get(d['id'], 0), seen - last[d['id']])
                last[d['id']] = seen
            time.sleep(.02)
        # Polls queue for the lane, so contention is latency. A poll that skipped a taken lane slept a whole poll
        # period and could lose repeatedly: a device went over two polls (2.2 s here) unobserved, and Cria calls a
        # reading stale after 3 s, so real cameras flickered.
        assert set(worst) == set(shared) and all(v < 1800 for v in worst.values()), worst
        print('shared failure-domain devices keep polling: PASS', worst, flush=True)

if __name__ == '__main__':
    main()
