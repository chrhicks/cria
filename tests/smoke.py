"""Public HTTP contract smoke against separate-process deterministic fixtures, never real equipment."""
import json, os, pathlib, signal, socket, subprocess, tempfile, time, urllib.request, urllib.error, uuid
ROOT = pathlib.Path(__file__).resolve().parents[1]
DOTNET = os.environ.get('DOTNET', 'dotnet')
TOKEN = 'cria-contract-test-' + uuid.uuid4().hex

class Service:
    API = ROOT/'src/Cria.Api/bin/Debug/net10.0/Cria.Api.dll'
    FIXTURE = ROOT/'tests/Cria.Driver.Fixture/bin/Debug/net10.0/Cria.Driver.Fixture.dll'
    # Current binaries refuse expected conditions cleanly; an unexpected crash stays visible.
    def preexec(self): return None
    def __init__(self, directory=None, token=TOKEN, **overrides):
        self.token = token
        self.temp = tempfile.TemporaryDirectory(prefix='cria-v2-') if directory is None else None
        self.directory = pathlib.Path(directory or self.temp.name)
        with socket.socket() as s: s.bind(('127.0.0.1', 0)); port=s.getsockname()[1]
        self.url=f'http://127.0.0.1:{port}'
        self.config=dict(version=2, listen=self.url, dataDirectory=str(self.directory/'data'), workerExecutable=DOTNET,
            workerArguments=[str(self.FIXTURE)], fixture=True, ownershipConfirmed=True,
            commandsEnabled=True, pollMs=50, metadataMs=200, callTimeoutMs=200, initializeTimeoutMs=1000, operationTimeoutMs=2000, imageTimeoutMs=2000, maxPixels=10000,
            imageBudgetBytes=1000000,
            devices=[dict(id=k,kind=k,progId='Cria.Fixture.'+k,expectedName='FIXTURE '+k,connect=True) for k in ['camera','mount','focuser','weather','switch']])
        self.config.update(overrides)
        self.url=self.config['listen']
        self.path=self.directory/'config.json'; self.path.write_text(json.dumps(self.config))
        self.log=open(self.directory/'server.log','a+')
        self.start()
    def start(self):
        self.process=subprocess.Popen([DOTNET,str(self.API),str(self.path)],env={**{k: v for k, v in os.environ.items() if k != 'CRIA_TOKEN'}, **({'CRIA_TOKEN': self.token} if self.token else {})},stdout=self.log,stderr=self.log,preexec_fn=self.preexec())
        self.wait(lambda: self.get('/health'),15)
    def request(self,path,method='GET',body=None):
        data=json.dumps(body).encode() if body is not None else None
        req=urllib.request.Request(self.url+path,data=data,method=method,headers={'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'})
        try:
            with urllib.request.urlopen(req,timeout=5) as response:
                raw=response.read();return response.status, json.loads(raw) if response.headers.get('Content-Type','').startswith('application/json') else raw
        except urllib.error.HTTPError as e: return e.code,json.loads(e.read())
    def get(self,path):
        status,body=self.request(path)
        if status!=200: raise AssertionError((status,body))
        return body
    def wait(self,condition,timeout=10):
        end=time.monotonic()+timeout; error=None
        while time.monotonic()<end:
            if self.process.poll() is not None:
                self.log.flush(); raise AssertionError('API exited: '+(self.directory/'server.log').read_text()[-5000:])
            try:
                result=condition()
                if result: return result
            except (AssertionError, ConnectionError, urllib.error.URLError) as e: error=e
            time.sleep(.03)
        raise AssertionError(f'Wait expired: {error}; state={self.get("/v2/state")}')
    def ready(self,id):
        return self.wait(lambda:next((d for d in self.get('/v2/state')['devices'] if d['id']==id and d['commandReady']),None))
    def operation(self,id,kind,parameters,wait=True,**identity):
        d=self.ready(id);state=self.get('/v2/state')
        req=dict(instanceId=state['instanceId'],requestId=str(uuid.uuid4()),deviceId=id,bindingId=d['bindingId'],expectedName=d['expectedName'],kind=kind,parameters=parameters);req.update(identity)
        status,op=self.request('/v2/operations','POST',req)
        assert status==202,(status,op)
        if wait:op=self.terminal(op['id'])
        return op,req
    def terminal(self,id):
        return self.wait(lambda:(lambda o:o if o['status'] in ['succeeded','failed','cancelled','uncertain'] else None)(self.get('/v2/operations/'+id)))
    def stop(self):
        if self.process.poll() is None:
            self.process.terminate()
            try:self.process.wait(timeout=12)
            except subprocess.TimeoutExpired:self.process.kill();self.process.wait()
    def close(self):
        self.stop()
        for manifest in (self.directory/'data/workers').glob('*/process.json'):
            p=json.loads(manifest.read_text())
            try:
                cmd=pathlib.Path(f'/proc/{p["pid"]}/cmdline').read_bytes()
                if b'Cria.Driver.Fixture' in cmd:os.kill(p['pid'],signal.SIGKILL)
            except (ProcessLookupError,FileNotFoundError):pass
        self.log.close()
        if self.temp:self.temp.cleanup()
    def __enter__(self):return self
    def __exit__(self,*_):self.close()

def main():
    with Service() as s:
        for kind in ['camera','mount','focuser','weather','switch']:s.ready(kind)
        for id,kind,p in [
            ('camera','capture',dict(exposureSeconds=.05,light=True)),
            ('camera','cooling',dict(coolerOn=True,setpointC=-15)),
            ('camera','camera-configure',dict(width=32,height=24,gain=10)),
            ('focuser','focuser-move',dict(position=1500,minPosition=100,maxPosition=2000)),
            ('focuser','focuser-halt',{}),
            ('mount','mount-tracking',dict(tracking=True)),
            ('mount','mount-slew',dict(rightAscensionDegrees=100,declinationDegrees=20,coordinateSystem='j2000')),
            ('mount','mount-home',{}),('mount','mount-axis',dict(rateDegreesPerSecond=1,durationSeconds=.1)),
            ('mount','mount-rotate',dict(rateDegreesPerSecond=2,distanceDegrees=.3)),
            ('mount','mount-stop',{}),('mount','mount-park',{}),('mount','mount-unpark',{}),
            ('switch','switch-set',dict(channelId=0,value=42)),
        ]:
            op,req=s.operation(id,kind,p); assert op['status']=='succeeded',(kind,op);print(kind,'PASS',flush=True)
            assert s.request('/v2/operations','POST',req)[1]['id']==op['id']
            if kind=='capture':
                info=op['image'];raw=s.get(info['original']['url']);assert len(raw)==info['original']['bytes']
        print('ALL WORKFLOWS PASS',flush=True)
if __name__=='__main__':main()
