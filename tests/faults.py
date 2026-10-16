"""Failure, idempotency, cancellation, restart and retention acceptance tests."""
from smoke import Service, TOKEN
import hashlib,json,os,pathlib,signal,time,uuid

def fault(s,id,name):
    status,result=s.request('/v2/fixtures/'+id,'POST',{'fault':name});assert status==200,(status,result);return result

def device(s,id):return next(d for d in s.get('/v2/state')['devices'] if d['id']==id)
def kill_workers(s):
    for p in (s.directory/'data/workers').glob('*/process.json'):
        pid=json.loads(p.read_text())['pid']
        try:
            if b'Cria.Driver.Fixture' in pathlib.Path(f'/proc/{pid}/cmdline').read_bytes():os.kill(pid,signal.SIGKILL)
        except (FileNotFoundError,ProcessLookupError):pass

def cancellation_with_read_errors():
    for restore_reads in [False, True]:
        with Service() as s:
            s.ready('camera');before=fault(s,'camera','stats')
            op,_=s.operation('camera','capture',dict(exposureSeconds=1,light=True),wait=False)
            path='/v2/operations/'+op['id']
            s.wait(lambda:s.get(path)['phase']=='exposing')
            fault(s,'camera','read-error')
            s.wait(lambda:s.get(path)['observation']=='retrying')
            assert s.request(path+'/cancel','POST')[0]==202
            # Prove delivery while reads still fail, before the exposure deadline.
            stats=s.wait(lambda:(lambda x:x if x['aborts']==before['aborts']+1 else None)(fault(s,'camera','stats')),1)
            assert stats['abortAttempts']==before['abortAttempts']+1,stats
            # Let several failed-read iterations pass; cleanup is sent once.
            time.sleep(.3)
            stats=fault(s,'camera','stats')
            assert stats['abortAttempts']==before['abortAttempts']+1 and stats['aborts']==before['aborts']+1,stats
            pending=s.get(path);assert pending['status']=='running' and not pending['settled'],pending
            if restore_reads:fault(s,'camera','none')
            terminal=s.terminal(op['id'])
            assert terminal['cancelRequested'],terminal
            if restore_reads:
                assert terminal['status']=='cancelled' and terminal['settled'] and not terminal['blocksDevice'],terminal
                s.ready('camera')
                stats=fault(s,'camera','stats')
                assert stats['abortAttempts']==before['abortAttempts']+1 and stats['aborts']==before['aborts']+1,stats
            else:
                assert terminal['status']=='uncertain' and not terminal['settled'] and terminal['blocksDevice'],terminal
                assert device(s,'camera')['blocked']
            print('cancel delivers one abort despite read errors; '+('restored reads confirm cancellation' if restore_reads else 'failed readback preserves uncertainty')+': PASS',flush=True)

def main():
    cancellation_with_read_errors()
    with Service() as s:
        s.ready('camera');stats=fault(s,'camera','stats')
        op,req=s.operation('camera','capture',dict(exposureSeconds=.5,light=True),wait=False)
        duplicate=s.request('/v2/operations','POST',req);assert duplicate[0]==202 and duplicate[1]['id']==op['id']
        changed={**req,'parameters':dict(exposureSeconds=.6,light=True)}
        assert s.request('/v2/operations','POST',changed)[0]==409
        s.wait(lambda:s.get('/v2/operations/'+op['id'])['phase']=='exposing')
        assert s.request('/v2/operations/'+op['id']+'/cancel','POST')[0]==202
        stopped=s.terminal(op['id']);assert stopped['status']=='cancelled' and stopped['settled'],stopped
        assert fault(s,'camera','stats')['exposures']==stats['exposures']+1
        s.ready('camera')
        op,_=s.operation('camera','capture',dict(exposureSeconds=.1,light=True));info=op['image'];raw=s.get(info['original']['url'])
        assert hashlib.sha256(raw).hexdigest()==info['sha256']
        assert hashlib.sha256(s.get(info['original']['url'])).hexdigest()==info['sha256']
        assert s.request('/v2/images/'+str(uuid.uuid4())+'/original')[0]==410
        # A fresh generation is required after writes; older field values remain explicitly stale.
        before=device(s,'camera')['observationGeneration'];status,r=s.request('/v2/devices/camera/refresh','POST');assert status==202
        d=s.ready('camera');assert d['observationGeneration']>=before and all(f['generation']==d['observationGeneration'] for f in d['fields'].values() if f['status']=='current')
        # Read errors keep old values and timestamps, without inventing new successful observations.
        old=d['fields']['temperatureC'];fault(s,'camera','read-error')
        s.wait(lambda:device(s,'camera')['fields']['temperatureC']['status']=='stale')
        stale=device(s,'camera')['fields']['temperatureC'];assert stale['value']==old['value'] and stale['observedAt']==old['observedAt']
        fault(s,'camera','none');s.ready('camera')
        # Lost acknowledgement happens after the write; retry must never dispatch it again.
        fault(s,'camera','lost-ack');op,req=s.operation('camera','cooling',dict(coolerOn=True));assert op['status']=='uncertain' and op['blocksDevice']
        assert s.request('/v2/operations','POST',req)[1]['id']==op['id']
        assert device(s,'camera')['blocked']
        mount,_=s.operation('mount','mount-tracking',dict(tracking=True));assert mount['status']=='succeeded'
        d=device(s,'camera')
        status,_=s.request('/v2/devices/camera/recover','POST',dict(instanceId=s.get('/v2/state')['instanceId'],bindingId=d['bindingId'],externalRecoveryConfirmed=True,note='fixture verification'))
        assert status==409
        print('cancellation, idempotency, bytes, stale reads, lost acknowledgement: PASS',flush=True)
    for mode in ['crash','hang']:
        with Service() as s:
            s.ready('camera');last=device(s,'camera')['fields']['name']['value'];fault(s,'camera',mode)
            s.wait(lambda:device(s,'camera')['blocked'])
            start=time.monotonic();assert s.get('/health')['status']=='online';assert time.monotonic()-start<1
            d=device(s,'camera');assert d['fields']['name']['value']==last and d['fields']['name']['status']=='stale'
            op,_=s.operation('focuser','focuser-move',dict(position=1200,minPosition=500,maxPosition=1500));assert op['status']=='succeeded'
            print('worker '+mode+' containment: PASS',flush=True)
    for mode in ['crash','hang']:
        bindings=[dict(id='camera',kind='camera',progId='Cria.Fixture.camera',expectedName='FIXTURE camera',connect=True,fixtureFault=mode),dict(id='focuser',kind='focuser',progId='Cria.Fixture.focuser',expectedName='FIXTURE focuser',connect=True)]
        with Service(devices=bindings) as s:
            s.wait(lambda:device(s,'camera')['health']=='unavailable');assert s.get('/health')['status']=='online';s.ready('focuser')
            print('startup '+mode+' containment: PASS',flush=True)
    # Initialization has its own deadline: a connect slower than one steady-state call (callTimeoutMs) still succeeds,
    # and one slower than initializeTimeoutMs is blocked for explicit recovery as before.
    slow=[dict(id='camera',kind='camera',progId='Cria.Fixture.camera',expectedName='FIXTURE camera',connect=True,fixtureFault='slow-connect')]
    with Service(devices=slow,callTimeoutMs=300,initializeTimeoutMs=6000) as s:
        s.ready('camera');assert not device(s,'camera')['blocked']
        print('slow initialization within its own deadline: PASS',flush=True)
    with Service(devices=slow,callTimeoutMs=300,initializeTimeoutMs=1000) as s:
        s.wait(lambda:device(s,'camera')['blocked'] and device(s,'camera')['health']=='unavailable')
        assert device(s,'camera')['reason'];assert s.get('/health')['status']=='online'
        print('initialization past its deadline is blocked for recovery: PASS',flush=True)
    bindings=[dict(id=k,kind=k,progId='Cria.Fixture.'+k,expectedName='FIXTURE '+k,connect=True,failureDomain='shared' if k in ['camera','focuser'] else k) for k in ['camera','focuser','mount']]
    with Service(devices=bindings) as s:
        s.ready('camera');s.ready('focuser');fault(s,'camera','hang-write')
        op,_=s.operation('camera','cooling',dict(coolerOn=True));assert op['status']=='uncertain'
        assert device(s,'camera')['blocked'] and device(s,'focuser')['blocked'];assert not device(s,'mount')['blocked']
        print('in-flight hang and shared failure-domain containment: PASS',flush=True)
    with Service() as s:
        s.ready('camera');fault(s,'camera','slow-read');time.sleep(.05)
        when=time.time()*1000;status,refresh=s.request('/v2/devices/camera/refresh','POST');assert status==202
        again=s.request('/v2/devices/camera/refresh','POST')[1];assert again['generation']==refresh['generation']
        fresh=s.ready('camera');assert all(f['generation']==refresh['generation'] and f['readStartedAt']>=when for f in fresh['fields'].values() if f['status']=='current')
        fault(s,'camera','none')
        op,_=s.operation('camera','device-connect',dict(connected=False));assert op['status']=='succeeded'
        s.wait(lambda:device(s,'camera')['health']=='disconnected')
        d=device(s,'camera');req=dict(instanceId=s.get('/v2/state')['instanceId'],requestId=str(uuid.uuid4()),deviceId='camera',bindingId=d['bindingId'],expectedName=d['expectedName'],kind='device-connect',parameters={'connected':True})
        status,op=s.request('/v2/operations','POST',req);assert status==202,(status,op);assert s.terminal(op['id'])['status']=='succeeded';s.ready('camera')
        print('slow-read refresh barrier/coalescing and connection lifecycle: PASS',flush=True)
    with Service(retainedOperations=2) as s:
        op,req=s.operation('camera','capture',dict(exposureSeconds=.02,light=True));url=op['image']['original']['url']
        cool,cool_req=s.operation('camera','cooling',dict(coolerOn=True))
        s.operation('camera','cooling',dict(coolerOn=False));s.operation('camera','cooling',dict(coolerOn=True))
        # Only the newest two finished operations keep their details; the rest shrink to a marker.
        s.wait(lambda:s.request('/v2/operations/'+cool['id'])[0]==410 and s.request('/v2/operations/'+op['id'])[0]==410,5)
        assert s.request('/v2/operations','POST',cool_req)[0]==410 and s.request('/v2/operations','POST',req)[0]==410
        # An image stays until the size budget drops it, whatever happened to its operation's details.
        assert s.request(url)[0]==200
        print('request markers outlive operation details and never replay; images are not expired by time: PASS',flush=True)
    with Service() as s:
        op,req=s.operation('camera','capture',dict(exposureSeconds=2,light=True),wait=False)
        s.wait(lambda:s.get('/v2/operations/'+op['id'])['phase']=='exposing')
        old_instance=req['instanceId'];s.process.kill();s.process.wait();time.sleep(2.2)
        s.start();s.wait(lambda:s.get('/v2/state')['instanceId']!=old_instance)
        # The new instance knows nothing of the old operation. It must not run it again, and the previous
        # driver owners are still alive, so every device stays blocked until recovery is confirmed.
        assert s.request('/v2/operations/'+op['id'])[0]==404
        assert all(d['blocked'] for d in s.get('/v2/state')['devices'])
        status,refused=s.request('/v2/operations','POST',req);assert status==409 and refused['error']['code']=='instance-changed',(status,refused)
        kill_workers(s);time.sleep(.1)
        d=device(s,'camera');status,r=s.request('/v2/devices/camera/recover','POST',dict(instanceId=s.get('/v2/state')['instanceId'],bindingId=d['bindingId'],externalRecoveryConfirmed=True,note='fixture owners stopped and physical recovery simulated'))
        assert status==200,(status,r)
        current=s.ready('camera');assert current['bindingId']!=d['bindingId']
        fresh,_=s.operation('camera','capture',dict(exposureSeconds=.02,light=True));assert fresh['status']=='succeeded'
        print('API crash: old operation unknown and never replayed, devices blocked until explicit dead-owner recovery: PASS',flush=True)
if __name__=='__main__':main()
