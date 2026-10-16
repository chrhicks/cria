"""State stream cadence, reconnect and quiet failure tests; deterministic workers only."""
from smoke import Service, TOKEN
from faults import fault
import json, queue, socket, threading, time, urllib.request


class Stream:
    def __init__(self, service):
        self.started_at = time.time() * 1000
        self.response = urllib.request.urlopen(urllib.request.Request(service.url + '/v2/events',
            headers={'Authorization': 'Bearer ' + TOKEN}), timeout=8)
        self.events = queue.Queue()
        self.thread = threading.Thread(target=self.read, daemon=True)
        self.thread.start()

    def read(self):
        try:
            frame = []
            while line := self.response.readline():
                if line.strip():
                    frame.append(line.decode().rstrip())
                else:
                    data = next((x[6:] for x in frame if x.startswith('data: ')), None)
                    self.events.put((time.monotonic(), json.loads(data) if data else None))
                    frame = []
        except (OSError, ValueError):
            pass

    def next(self, timeout=7):
        return self.events.get(timeout=timeout)

    def close(self):
        self.response.fp.raw._sock.shutdown(socket.SHUT_RDWR)
        self.thread.join(timeout=2)
        self.response.close()

    def until(self, predicate, timeout=7):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            at, state = self.next(max(.01, end-time.monotonic()))
            if state and predicate(state):
                return at, state
        raise AssertionError('No matching SSE snapshot')


def main():
    binding = dict(id='camera', kind='camera', progId='Cria.Fixture.camera', expectedName='FIXTURE camera', connect=True)
    with Service(devices=[binding], operationTimeoutMs=5000) as service:
        service.ready('camera')
        stream = Stream(service)
        first_at, first = stream.next()
        assert first['generatedAt'] >= stream.started_at - 1, first
        idle = [stream.next() for _ in range(4)]
        intervals = [b[0]-a[0] for a,b in zip([(first_at, first)]+idle, idle)]
        assert all(.9 <= gap <= 1.8 for gap in intervals), intervals
        assert all(state['sequence'] > first['sequence'] for _, state in idle)
        print('Idle polling coalesces to at most 1 Hz, fresh initial snapshot: PASS', flush=True)

        op, _ = service.operation('camera', 'capture', dict(exposureSeconds=1.5, light=True), wait=False)
        accepted = time.monotonic()
        at, running = stream.until(lambda s: any(o['id']==op['id'] and o['status']=='running' for o in s['operations']))
        assert at-accepted < .9, at-accepted
        _, terminal = stream.until(lambda s: any(o['id']==op['id'] and o['status']=='succeeded' for o in s['operations']))
        assert next(o for o in terminal['operations'] if o['id']==op['id'])['image']
        print('Operation progress and terminal image arrive on SSE without operation polling: PASS', flush=True)

        service.ready('camera')
        fault(service, 'camera', 'crash')
        failed_at, failed = stream.until(lambda s: s['devices'][0]['blocked'])
        field = failed['devices'][0]['fields']['name']
        assert field['status']=='stale'
        heartbeat_at, heartbeat = stream.next()
        assert heartbeat is None and 3.8 <= heartbeat_at-failed_at <= 5.5, (heartbeat_at-failed_at, heartbeat)
        # No heartbeat manufactures a state or a new observation; reconnect does
        # create a fresh envelope while retaining the failed observation times.
        reconnected = Stream(service)
        _, latest = reconnected.next()
        assert latest['generatedAt'] >= reconnected.started_at-1
        assert latest['generatedAt'] > failed['generatedAt']
        assert latest['devices'][0]['fields']['name'] == field
        assert latest['devices'][0]['blocked'] and not latest['devices'][0]['commandReady']
        reconnected.close()
        stream.close()
        print('Quiet failed worker emits heartbeat; reconnect preserves stale readings: PASS', flush=True)


if __name__ == '__main__': main()
