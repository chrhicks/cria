"""Generate the checked-in OpenAPI 3.1 contract. No hardware or network access."""
import json,pathlib
S={'type':'string'};B={'type':'boolean'};I={'type':'integer'};N={'type':'number'};GUID={'type':'string','format':'uuid'};TIME={'type':'integer','minimum':0};DIGEST={'type':'string','pattern':'^[a-f0-9]{64}$'}
def nullable(schema):return {'anyOf':[schema,{'type':'null'}]}
def ref(name):return {'$ref':'#/components/schemas/'+name}
def obj(properties,required=None,extra=False):return {'type':'object','properties':properties,'required':list(properties) if required is None else required,'additionalProperties':extra}
def array(item):return {'type':'array','items':item}
def num(low,high,integer=False):return {'type':'integer' if integer else 'number','minimum':low,'maximum':high}
def enum(*values):return {'type':'string','enum':list(values)}
params={
 'capture':obj({'exposureSeconds':num(.000001,3600),'light':B,'monochromeOnly':B},['exposureSeconds','light']),
 'camera-configure':{**obj({k:num(0 if k in ['startX','startY','gain','offset'] else 1,1000000,True) for k in ['binX','binY','startX','startY','width','height','gain','offset']},[]),'minProperties':1},
 'cooling':{**obj({'coolerOn':B,'setpointC':num(-100,100)},[]),'minProperties':1},
 'focuser-move':{**obj({'position':num(1,2147483646,True),'minPosition':num(1,2147483646,True),'maxPosition':num(1,2147483646,True)}),'description':'Target must lie inside the client travel window and below driver MaxStep. Zero is deliberately excluded.'},
 'mount-slew':obj({'rightAscensionDegrees':{'type':'number','minimum':0,'exclusiveMaximum':360},'declinationDegrees':num(-90,90),'coordinateSystem':enum('topocentric','j2000','j2050','b1950')}),
 'mount-tracking':obj({'tracking':B}),
 'mount-axis':obj({'rateDegreesPerSecond':{**num(-10,10),'not':{'const':0}},'durationSeconds':num(.001,120)}),
 'mount-rotate':obj({'rateDegreesPerSecond':{**num(-10,10),'not':{'const':0}},'distanceDegrees':{**num(-120,120),'not':{'const':0}}}),
 'switch-set':obj({'channelId':num(0,63,True),'value':num(-1e12,1e12)}),
 'device-connect':obj({'connected':B}),
}
for k in ['focuser-halt','mount-home','mount-stop','mount-park','mount-unpark']:params[k]=obj({})
identity={'instanceId':GUID,'requestId':{'type':'string','minLength':1,'maxLength':128,'pattern':r'^[^\u0000-\u001f\u007f-\u009f]+$'},'deviceId':{'type':'string','minLength':1,'maxLength':64},'bindingId':GUID,'expectedName':{'type':'string','minLength':1,'maxLength':256}}
schemas={
 'OperationRequest':{'oneOf':[obj({**identity,'kind':{'const':k},'parameters':v}) for k,v in params.items()]},
 'Reading':obj({'value':{},'observedAt':nullable(TIME),'checkedAt':nullable(TIME),'readStartedAt':nullable(TIME),'generation':nullable(I),'status':enum('pending','current','unsupported','error','stale'),'message':nullable(S)}),
 'Original':obj({'mediaType':{'const':'application/imagebytes'},'bytes':{'type':'integer','minimum':44},'url':S}),
 'Image':obj({'id':GUID,'operationId':GUID,'instanceId':GUID,'deviceId':S,'cameraName':S,'bindingId':GUID,'width':num(1,100000000,True),'height':num(1,100000000,True),'binX':I,'binY':I,'startX':I,'startY':I,'exposureSeconds':N,'color':enum('mono','rggb','grbg','gbrg','bggr'),'capturedAt':TIME,'capturedAtSource':enum('camera','server-estimate'),'retainedAt':TIME,'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'original':ref('Original'),'preview':{'type':'null'}}),
 'Operation':obj({'id':GUID,**identity,'failureDomain':S,'kind':enum(*params),'parameters':{'type':'object'},'acceptedAt':TIME,'startedAt':nullable(TIME),'completedAt':nullable(TIME),'status':enum('accepted','running','succeeded','failed','cancelled','uncertain'),'phase':S,'elapsedSeconds':{**nullable({'type':'number','minimum':0}),'description':'Latest worker elapsed-time sample since capture start, including completion/cleanup wait; null when no sample exists. Not measured shutter-open duration.'},'acknowledged':B,'cancelRequested':B,'blocksDevice':B,'settled':B,'observation':enum('current','retrying'),'message':nullable(S),'result':{'type':'object'},'reservedImageId':nullable(GUID),'image':nullable(ref('Image')),'reconciliation':nullable(obj({'at':TIME,'note':S,'externalRecoveryConfirmed':{'const':True}}))}),
 'Device':obj({'id':S,'kind':enum('camera','mount','focuser','weather','switch'),'bindingId':GUID,'expectedName':S,'failureDomain':S,'health':enum('starting','ready','refreshing','degraded','disconnected','unavailable'),'blocked':B,'reason':nullable(S),'observationGeneration':I,'refreshPending':B,'fields':{'type':'object','additionalProperties':ref('Reading')},'channels':array({'type':'object','additionalProperties':ref('Reading')}),'commandReady':B}),
 'State':obj({'protocolVersion':{'const':4},'instanceId':GUID,'sequence':I,'generatedAt':TIME,'commandsEnabled':B,'devices':array(ref('Device')),'operations':array(ref('Operation'))}),
 'Error':obj({'error':obj({'code':S,'message':S}),'instanceId':nullable(GUID)},['error']),
 'RecoveryRequest':obj({'instanceId':GUID,'bindingId':GUID,'externalRecoveryConfirmed':{'const':True},'note':{'type':'string','minLength':1,'maxLength':1024}}),
 'TelemetryEvent':obj({'version':{'const':2},'eventId':S,'instanceId':GUID,'sequence':I,'timestamp':TIME,'type':S,'deviceId':S,'severity':S,'traceId':GUID,'details':{},'cursor':S}),
 'TelemetryPage':obj({'events':array(ref('TelemetryEvent')),'hasMore':B,'nextCursor':S,'highWaterCursor':S,'prunedThrough':S,'gap':nullable({'type':'object'})}),
}
paths={}
def route(path,method,summary,result=None,body=None,status=200,query=(),description=None):
    response={'description':'Accepted' if status==202 else 'Success'}
    if result is not None:response['content']={'application/json':{'schema':result}}
    entry={'summary':summary,'operationId':method+'_'+path.replace('/','_').replace('{','').replace('}',''),'responses':{str(status):response,**{str(n):{'description':text,'content':{'application/json':{'schema':ref('Error')}}} for n,text in [(400,'Invalid request'),(401,'Token required'),(403,'Writes disabled or origin rejected'),(404,'Unknown or forgotten resource'),(409,'Identity, admission or cursor conflict'),(410,'Known result expired or image no longer held'),(429,'Concurrency limit'),(503,'Driver unavailable or bounded service capacity')]}},'security':[{'Bearer':[]}]}
    if body:entry['requestBody']={'required':True,'content':{'application/json':{'schema':body}}}
    if description:entry['description']=description
    import re
    parameters=[{'name':n,'in':'path','required':True,'schema':S} for n in re.findall(r'\{(.*?)\}',path)]
    parameters.extend({'name':k,'in':'query','schema':v} for k,v in query)
    if parameters:entry['parameters']=parameters
    paths.setdefault(path,{})[method]=entry
route('/health','get','Process liveness, independent of driver availability',obj({'status':enum('starting','online'),'protocolVersion':{'const':3}}));paths['/health']['get']['security']=[]
route('/v2/schema','get','This OpenAPI document',{'type':'object'})
route('/v2/state','get','Current state with independent per-field freshness',ref('State'))
route('/v2/service','get','Service identity for the local desktop supervisor',obj({'instanceId':GUID,'pid':I,'dataDirectory':S,'stopping':B,'activeOperations':I}))
route('/v2/service/stop','post','Stop an idle service and release its driver owners',obj({'instanceId':GUID,'stopping':{'const':True}}),obj({'instanceId':GUID}),202,description='Authenticated loopback callers only. Atomically stops new admission; rejects while operations are active. Ends state/telemetry streams and attempts driver release. Acceptance is not proof of release: the local supervisor must inspect process exit and the matching service-exit.json receipt. Never kills unresolved owners or replays operations.')
route('/v2/events','get','Latest-state SSE stream; slow consumers receive the newest snapshot',description='event: state contains a full State. This is a snapshot stream, not a lossless event journal. Reconnect with GET state. Maximum 16 streams.')
paths['/v2/events']['get']['responses']['200']['content']={'text/event-stream':{'schema':S}}
route('/v2/devices/{id}/refresh','post','Request observations begun in a new generation',obj({'deviceId':S,'generation':I,'pending':{'const':True}}),status=202)
route('/v2/devices/{id}/recover','post','Confirm external recovery after stopping previous driver owners',ref('State'),ref('RecoveryRequest'),description='Never replays work or declares an old operation successful. Live previous driver processes block recovery. Restarts compatible isolated owners with new binding IDs only after explicit operator attestation.')
route('/v2/operations','post','Accept one bounded equipment action',ref('Operation'),ref('OperationRequest'),202,description='The complete request identity is remembered for this service instance before anything is sent. An identical instanceId/requestId returns its existing operation; changed content returns 409 and a request whose details were dropped returns 410. No accepted request is dispatched twice within an instance; a new instanceId means earlier requests are unknown. HTTP cancellation does not cancel equipment.')
route('/v2/operations','get','Page operation history and expired-result markers',obj({'operations':array({'oneOf':[ref('Operation'),obj({'id':GUID,'status':S,'expired':{'const':True}})]}),'next':I}),query=[('after',{'type':'integer','minimum':0}),('limit',num(1,500,True))])
route('/v2/operations/{id}','get','Query progress or the final outcome',ref('Operation'))
route('/v2/requests/{instance}/{request}','get','Recover an admission result after a lost HTTP response',ref('Operation'))
route('/v2/operations/{id}/cancel','post','Request local cleanup; follow the operation to its observed outcome',ref('Operation'),status=202)
route('/v2/images/{id}/original','get','Stream complete checksum-verified ASCOM ImageBytes',description='Rank-2 Int32 logical pixels, first dimension outermost. No preview or processing. Served for a succeeded capture whatever the device interlock. Cria keeps only the newest images up to a size limit: an image that was dropped, or that this service instance never held, returns 410 image-gone, and the frame is lost. Never expose again to repair it. Fetch right after the capture succeeds; the file can be fetched more than once while it is held.')
paths['/v2/images/{id}/original']['get']['responses']['200']['content']={'application/imagebytes':{'schema':{'type':'string','format':'binary'}}}
route('/v2/telemetry/status','get','Recorder health, queue drops and actual retained history',{'type':'object'})
route('/v2/telemetry/events','get','Page diagnostic events with explicit retention gaps',ref('TelemetryPage'),query=[('after',S),('through',S),('limit',num(1,500,True)),('type',S),('device',S),('since',TIME),('until',TIME)])
route('/v2/telemetry/export','get','Bounded NDJSON export with a fixed high-water cursor and retention gaps',description='At most 100,000 events or 30 seconds. export-end records the next cursor and whether more remain. Supports after, through, type, device, since and until filters.')
paths['/v2/telemetry/export']['get']['responses']['200']['content']={'application/x-ndjson':{'schema':S}}
route('/v2/telemetry/follow','get','Cursor-based diagnostic SSE with explicit retention gaps',description='Events contain durable cursors; reconnect with after. Supports event filters. Maximum four telemetry streams including exports.')
paths['/v2/telemetry/follow']['get']['responses']['200']['content']={'text/event-stream':{'schema':S}}
document={'openapi':'3.1.0','info':{'title':'Cria equipment API','version':'4.0.0','description':'Drivers → isolated compatible Cria workers → .NET API → clients. Windows rig target. Vela owns repetitions, focus decisions, solving, previews and scientific archives. Unix millisecond timestamps; RA/sidereal observations are hours; RA commands are degrees. No automatic driver restart or equipment command replay. Protocol 4 keeps the /v2 route family; protocolVersion is the compatibility signal. The service remembers only recent operations and images; a new instanceId means everything in flight before it is unknown. Images are a rolling set: the oldest are dropped when the size limit is reached, and a dropped image returns 410 image-gone.'},'servers':[{'url':'http://127.0.0.1:4319'}],'paths':paths,'components':{'securitySchemes':{'Bearer':{'type':'http','scheme':'bearer'}},'schemas':schemas}}
pathlib.Path(__file__).with_name('openapi.json').write_text(json.dumps(document,indent=2)+'\n')
