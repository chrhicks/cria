"""Bounded storage, protocol, identity and concurrent-request checks."""
from smoke import Service,TOKEN
import concurrent.futures,json,time,uuid,urllib.request,urllib.error,threading
import jsonschema

def main():
    with Service() as s:
        schema=s.get('/v2/schema');assert schema['openapi']=='3.1.0';components=schema['components']
        def validate(name,value):jsonschema.Draft202012Validator({'$ref':'#/components/schemas/'+name,'components':components}).validate(value)
        s.ready('camera');validate('State',s.get('/v2/state'))
        for bad in [
            {'instanceId':str(uuid.uuid4())}, {'bindingId':str(uuid.uuid4())}, {'expectedName':'Wrong camera'},
            {'kind':'mount-home','parameters':{}}, {'parameters':{'exposureSeconds':-1,'light':True}},
            {'parameters':{'exposureSeconds':1,'light':'true'}}, {'parameters':{'exposureSeconds':1,'light':True,'surprise':1}},
        ]:
            d=s.ready('camera');req=dict(instanceId=s.get('/v2/state')['instanceId'],requestId=str(uuid.uuid4()),deviceId='camera',bindingId=d['bindingId'],expectedName=d['expectedName'],kind='capture',parameters={'exposureSeconds':.02,'light':True});req.update(bad)
            status,result=s.request('/v2/operations','POST',req);assert status in (400,409),(status,result);validate('Error',result)
        op,req=s.operation('camera','capture',dict(exposureSeconds=.3,light=True),wait=False);validate('OperationRequest',req)
        with concurrent.futures.ThreadPoolExecutor(8) as pool:
            duplicates=list(pool.map(lambda _:s.request('/v2/operations','POST',req),range(20)))
        assert all(status==202 and duplicate['id']==op['id'] for status,duplicate in duplicates)
        op=s.terminal(op['id']);validate('Operation',op);validate('Image',op['image'])
        time.sleep(.3);page=s.get('/v2/telemetry/events');validate('TelemetryPage',page);assert page['events']
        status=s.get('/v2/telemetry/status');assert status['dropped']==0,status
        # SSE carries full schemas without a client-controlled equipment lifecycle.
        req=urllib.request.Request(s.url+'/v2/events',headers={'Authorization':'Bearer '+TOKEN})
        with urllib.request.urlopen(req,timeout=3) as response:
            assert response.readline()==b'event: state\n';state=json.loads(response.readline()[6:]);validate('State',state)
        print('OpenAPI response/request schemas, identity, concurrent deduplication and SSE: PASS',flush=True)
    # A budget smaller than one frame: the newest image is still kept and served, the older one is dropped.
    with Service(imageBudgetBytes=1024) as s:
        s.ready('camera')
        first,_=s.operation('camera','capture',dict(exposureSeconds=.02,light=True));assert first['status']=='succeeded'
        second,_=s.operation('camera','capture',dict(exposureSeconds=.02,light=True));assert second['status']=='succeeded'
        assert s.request(first['image']['original']['url'])[0]==410
        assert s.request(second['image']['original']['url'])[0]==200
        print('Rolling image store drops the oldest, keeps the newest, never refuses a capture: PASS',flush=True)
    # More than the previous prototype's 1,024-operation ceiling, with bounded result payloads.
    with Service(pollMs=20,metadataMs=100,retainedOperations=16) as s:
        first=None
        for n in range(1050):
            op,req=s.operation('camera','cooling',{'coolerOn':n%2==0});assert op['status']=='succeeded',(n,op)
            if first is None:first=(op,req)
            if n in [249,499,749,999]:print('Durable lifecycle progress:',n+1,flush=True)
        s.wait(lambda:s.request('/v2/operations/'+first[0]['id'])[0]==410,5)
        assert s.request('/v2/operations','POST',first[1])[0]==410
        assert s.request('/v2/fixtures/camera','POST',{'fault':'stats'})[1]['writes']==1051
        print('1,050 operations, bounded results, expired request never replayed: PASS',flush=True)
if __name__=='__main__':main()
