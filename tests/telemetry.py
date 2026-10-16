from smoke import Service,TOKEN
import json,time,urllib.request

def main():
    with Service(telemetryRows=16,telemetryPayloadBytes=16384,telemetryQueue=32,pollMs=20,metadataMs=100) as s:
        s.ready('camera')
        for _ in range(3):s.operation('camera','cooling',{'coolerOn':True})
        s.wait(lambda:int(s.get('/v2/telemetry/status')['store']['prunedThrough'].split(':')[1])>0)
        status=s.get('/v2/telemetry/status');cursor=status['store']['storeId']+':0'
        page=s.get('/v2/telemetry/events?after='+cursor+'&type=operation-finished&device=camera')
        assert page['gap'] is not None
        assert all(e['type']=='operation-finished' and e['deviceId']=='camera' for e in page['events'])
        assert status['store']['count']<=16 and status['store']['retainedEventBytes']<=16384,status
        assert s.request('/v2/telemetry/events?type=x&type=y')[0]==400
        assert s.request('/v2/telemetry/events?unknown=x')[0]==400
        assert s.request('/v2/telemetry/events?after=wrong:0')[0]==409
        export=s.get('/v2/telemetry/export?after='+cursor+'&device=camera')
        rows=[json.loads(line) for line in export.splitlines()]
        assert rows[-1]['type']=='export-end';assert not rows[-1]['hasMore']
        assert any(row['type']=='retention-gap' for row in rows)
        request=urllib.request.Request(s.url+'/v2/telemetry/follow?after='+cursor,headers={'Authorization':'Bearer '+TOKEN})
        with urllib.request.urlopen(request,timeout=3) as response:
            assert response.readline()==b'event: gap\n'
            gap=json.loads(response.readline()[6:]);assert gap['reason']=='retention'
        print('Telemetry filtered pagination, finite retention, gaps, export and follow: PASS',flush=True)
if __name__=='__main__':main()
