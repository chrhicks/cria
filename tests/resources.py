"""Synthetic full-size file-path check on the development machine, not rig resource qualification."""
from smoke import Service,TOKEN,ROOT
import hashlib,json,pathlib,threading,time,urllib.request,uuid

def main():
    width,height=6248,4176
    with Service(maxPixels=width*height,imageBudgetBytes=3*(44+4*width*height),imageTimeoutMs=10000,
        devices=[dict(id='camera',kind='camera',progId='Cria.Fixture.camera',expectedName='FIXTURE camera',connect=True,fixtureWidth=width,fixtureHeight=height)]) as s:
        s.ready('camera');latencies=[];rss=[];done=threading.Event()
        def sample():
            while not done.is_set():
                try:
                    before=time.monotonic();s.get('/v2/state');latencies.append((time.monotonic()-before)*1000)
                    for line in pathlib.Path(f'/proc/{s.process.pid}/status').read_text().splitlines():
                        if line.startswith('VmRSS:'):rss.append(int(line.split()[1])*1024)
                except Exception:pass
                done.wait(.02)
        thread=threading.Thread(target=sample);thread.start()
        start=time.monotonic();peaks=[];images=[]
        try:
            for n in range(4):
                op,_=s.operation('camera','capture',dict(exposureSeconds=.02,light=True));assert op['status']=='succeeded',op
                image=op['image'];assert image['original']['bytes']==44+4*width*height
                request=urllib.request.Request(s.url+image['original']['url'],headers={'Authorization':'Bearer '+TOKEN})
                if n==0:
                    # Hold the first transfer open (unread) while later captures push the store over its budget.
                    held=urllib.request.urlopen(request,timeout=120);held_head=held.read(44)
                else:
                    with urllib.request.urlopen(request,timeout=10) as stream:
                        digest=hashlib.sha256();total=0
                        while block:=stream.read(65536):digest.update(block);total+=len(block)
                        assert total==image['original']['bytes'];assert digest.hexdigest()==image['sha256']
                images.append(image)
                peaks.append(max(rss));print('Full-size transfer',n+1,'PASS',flush=True)
        finally:done.set();thread.join()
        # The budget (a soft cap) holds three frames. The fourth capture needs the oldest dropped, but it is
        # mid-download: nothing is dropped, so the store runs over budget and the transfer arrives intact.
        # Once that download ends the oldest goes, and the newest three are still served.
        assert [s.request(image['original']['url'])[0] for image in images]==[200,200,200,200]
        digest=hashlib.sha256(held_head)
        while block:=held.read(65536):digest.update(block)
        held.close();assert digest.hexdigest()==images[0]['sha256']
        s.wait(lambda:s.request(images[0]['original']['url'])[0]==410,5)
        assert [s.request(image['original']['url'])[0] for image in images[1:]]==[200,200,200]
        latencies.sort();report=dict(kind='Linux deterministic fixture; not physical Windows qualification',width=width,height=height,wireBytes=44+4*width*height,captures=4,durationSeconds=time.monotonic()-start,apiRssMaxBytes=max(rss),apiRssFirstBytes=rss[0],apiRssLastBytes=rss[-1],apiRssCumulativePeaks=peaks,stateRequests=len(latencies),stateLatencyP95Ms=latencies[int(len(latencies)*.95)],stateLatencyMaxMs=max(latencies))
        assert report['stateLatencyP95Ms']<1000,report
        assert report['apiRssMaxBytes']<512*1024*1024,report # Regression check for this synthetic path, not a product memory budget.
        out=ROOT/'tests/results';out.mkdir(exist_ok=True);(out/'resources.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
