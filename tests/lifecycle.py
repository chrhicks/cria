"""Service stop must release owners even with long-lived HTTP readers, without aborting work."""
import json, urllib.request, uuid, time
from smoke import Service, TOKEN

def stream(s,path):
    return urllib.request.urlopen(urllib.request.Request(s.url+path,headers={'Authorization':'Bearer '+TOKEN}),timeout=15)

def stop(s):
    identity=s.get('/v2/service')
    assert identity['pid']==s.process.pid
    assert s.request('/v2/service/stop','POST',{'instanceId':identity['instanceId']})[0]==202
    s.process.wait(timeout=12)
    receipt=json.loads((s.directory/'data/service-exit.json').read_text())
    assert receipt['instanceId']==identity['instanceId'] and receipt['pid']==identity['pid']
    return receipt

with Service() as s:
    for d in s.config['devices']:s.ready(d['id'])
    assert s.request('/v2/service/stop','POST',{'instanceId':str(uuid.uuid4())})[0]==409
    op,_=s.operation('camera','capture',{'exposureSeconds':1,'light':True},wait=False)
    assert s.request('/v2/service/stop','POST',{'instanceId':s.get('/v2/state')['instanceId']})[0]==409
    assert s.get('/v2/state')['commandsEnabled']
    done=s.terminal(op['id']);assert done['status']=='succeeded'
    readers=[stream(s,'/v2/events'),stream(s,'/v2/telemetry/follow')]
    began=time.monotonic();receipt=stop(s)
    assert receipt['cleanReleased'] and not receipt['unresolvedDevices'] and s.process.returncode==0
    for r in readers:r.close()
    s.start()
    for d in s.config['devices']:s.ready(d['id'])
    assert s.request('/v2/operations/'+op['id'])[0]==404  # a restarted instance knows nothing of earlier operations
    assert s.request(done['image']['original']['url'])[0]==410  # and holds none of their images
    assert stop(s)['cleanReleased']
    print(f'Busy stop rejected; streams drained; owners released; same data restarts with a clean slate: PASS ({time.monotonic()-began:.1f}s)')
with Service() as s:
    s.ready('camera')
    s.request('/v2/fixtures/camera','POST',{'fault':'crash'})
    s.wait(lambda:any(d['id']=='camera' and d['health']=='unavailable' for d in s.get('/v2/state')['devices']))
    receipt=stop(s)
    assert not receipt['cleanReleased'] and 'camera' in receipt['unresolvedDevices'] and s.process.returncode==2
    s.start()
    assert any(d['id']=='camera' and d['blocked'] for d in s.get('/v2/state')['devices'])
    assert not stop(s)['cleanReleased']
    print('Faulted owner retained as unresolved across restart: PASS')

# Optional network-boundary check uses a synthetic unresolved owner so no driver
# executable can start. Set to an address of this test computer, never a rig URL.
import os, socket, tempfile, pathlib
address=os.environ.get('CRIA_TEST_IP')
if address:
    with tempfile.TemporaryDirectory(prefix='cria-local-control-') as tmp:
        with socket.socket() as probe:probe.bind((address,0));port=probe.getsockname()[1]
        owner=pathlib.Path(tmp)/'data/workers/previous';owner.mkdir(parents=True)
        binding=dict(id='synthetic',kind='mount',progId='ASCOM.CriaNeverLaunch.Synthetic',expectedName='SYNTHETIC BLOCKED',failureDomain='synthetic',connect=False)
        (owner/'worker.json').write_text(json.dumps({'binding':binding,'bindingId':str(uuid.uuid4())}))
        with Service(directory=tmp,fixture=False,listen=f'http://{address}:{port}',devices=[binding],workerExecutable='/DO-NOT-LAUNCH',workerArguments=[]) as s:
            identity=s.wait(lambda:s.get('/v2/service'))
            assert s.get('/v2/state')['devices'][0]['blocked']
            status,body=s.request('/v2/service/stop','POST',{'instanceId':identity['instanceId']})
            assert status==403 and body['error']['code']=='local-only'
            s.url=f'http://127.0.0.1:{port}'
            assert s.get('/v2/service')['instanceId']==identity['instanceId']
            assert not stop(s)['cleanReleased']
            assert not list((pathlib.Path(tmp)/'data/workers').glob('*/process.json'))
            print('Specific network bind preserved; loopback control added; network stop rejected; no driver launched: PASS')
