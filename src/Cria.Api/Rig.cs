using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Channels;
using Cria.Contracts;
using Newtonsoft.Json.Linq;

namespace Cria.Api;

internal sealed class Rig
{
    private readonly object gate = new();
    private readonly Configuration config;
    private readonly OperationLog journal;
    private readonly RecentImages images;
    private readonly Dictionary<string, DeviceState> devices;
    private readonly Dictionary<string, SemaphoreSlim> domainLanes;
    private readonly Dictionary<string, Operation> active = new();
    private readonly Dictionary<string, Task> executions = new();
    private readonly Dictionary<string, List<string>> oldOwners = new();
    private readonly HashSet<string> recovering = [];
    private readonly List<Channel<bool>> subscribers = [];
    private readonly CancellationTokenSource stop = new();
    private bool closing;
    private bool AdmissionOpen => config.CommandsEnabled && !closing;
    private long sequence;
    private long urgentSequence;
    public string InstanceId { get; } = Guid.NewGuid().ToString();
    public event Action<string, string, object>? Recorded;
    public Rig(Configuration config, OperationLog journal, RecentImages images)
    {
        this.config = config;
        this.journal = journal;
        this.images = images;
        devices = config.Devices.ToDictionary(b => b.Id, b => new DeviceState(b));
        domainLanes = config.Devices.Select(b => b.FailureDomain).Distinct().ToDictionary(d => d, _ => new SemaphoreSlim(1, 1));
    }
    private DeviceState Device(string id) => devices.TryGetValue(id, out var d) ? d : throw new ApiError(404, "Unknown device", "not-found");
    public void Start()
    {
        var root = Path.Combine(config.DataDirectory, "workers");
        Directory.CreateDirectory(root);
        foreach (var path in Directory.EnumerateDirectories(root))
        {
            if (File.Exists(Path.Combine(path, "closed.json")) || !File.Exists(Path.Combine(path, "worker.json")))
                continue;
            var previous = Wire.Decode<WorkerConfiguration>(File.ReadAllText(Path.Combine(path, "worker.json")));
            // A process may have started just before its manifest was written. Missing manifests are also unresolved.
            string domain = devices.Values.FirstOrDefault(d => d.Binding.ProgId.Equals(previous.Binding.ProgId, StringComparison.OrdinalIgnoreCase))?.Binding.FailureDomain ?? previous.Binding.FailureDomain;
            if (!oldOwners.TryGetValue(domain, out var owners))
                oldOwners[domain] = owners = [];
            owners.Add(path);
        }
        foreach (var op in journal.Blocking())
            if (!oldOwners.ContainsKey(op.FailureDomain))
                oldOwners[op.FailureDomain] = [];
        foreach (var d in devices.Values)
        {
            if (oldOwners.ContainsKey(d.Binding.FailureDomain))
            {
                d.Reason = "Previous driver ownership requires explicit recovery";
                d.Health = "unavailable";
            }
            else
                _ = StartDevice(d);
        }
        _ = Maintain();
    }
    private async Task StartDevice(DeviceState d)
    {
        var worker = new WorkerConnection(config, d, reason => FailDomain(d.Binding.FailureDomain, reason), line => Recorded?.Invoke("driver-log", d.Binding.Id, new { text = line.Length > 2048 ? line[..2048] : line }));
        lock (gate)
        {
            if (closing)
                return;
            d.Worker = worker;
            d.Health = "starting";
            d.Blocked = true;
            d.Reason = "Driver starting";
        }
        await domainLanes[d.Binding.FailureDomain].WaitAsync();
        try
        {
            var initial = await worker.Start();
            lock (gate)
            {
                if (initial.Blocked || d.Health == "unavailable")
                    return;
                d.Blocked = false;
                d.Health = "refreshing";
                d.Reason = null;
                Invalidate(d);
            }
            d.Polling = Poll(d, worker);
        }
        catch (Exception e) { FailDomain(d.Binding.FailureDomain, e.Message); }
        finally { domainLanes[d.Binding.FailureDomain].Release(); }
    }
    private void Invalidate(DeviceState d)
    {
        d.Generation++;
        d.Dirty = true;
        foreach (var f in d.Fields.Values)
            if (f.Status == "current")
                f.Status = "stale";
        foreach (var c in d.Channels)
            foreach (var f in c.Values)
                if (f.Status == "current")
                    f.Status = "stale";
    }
    private bool DomainBusy(string domain) => active.Values.Any(o => o.FailureDomain == domain && o.BlocksDevice);
    private void FailDomain(string domain, string reason)
    {
        lock (gate)
        {
            foreach (var d in devices.Values.Where(d => d.Binding.FailureDomain == domain))
            {
                Invalidate(d);
                d.Blocked = true;
                d.Health = "unavailable";
                d.Reason = reason;
            }
            foreach (var op in active.Values.Where(o => o.FailureDomain == domain && !o.Terminal))
            {
                op.Status = "uncertain";
                op.Phase = "finished";
                op.Settled = false;
                op.BlocksDevice = true;
                op.CompletedAt = Wire.Now;
                op.Message = reason;
                journal.Save(op);
            }
            Publish();
            Recorded?.Invoke("driver-unavailable", domain, new
            {
                reason
            });
        }
    }
    private static void Merge(Dictionary<string, Reading> target, Dictionary<string, Reading> fresh)
    {
        foreach (var (key, r) in fresh)
        {
            if (r.Status != "current" && target.TryGetValue(key, out var old))
            {
                r.Value = old.Value;
                r.ObservedAt = old.ObservedAt;
                r.Generation = old.Generation;
                if (r.Status != "unsupported" && old.ObservedAt != null)
                    r.Status = "stale";
            }
            target[key] = r;
        }
    }
    private async Task Poll(DeviceState d, WorkerConnection worker)
    {
        while (!stop.IsCancellationRequested)
        {
            long generation;
            bool metadata;
            lock (gate)
            {
                if (d.Blocked || d.Worker != worker)
                    break;
                generation = d.Generation;
                metadata = d.Dirty || Wire.Now - d.MetadataAt >= config.MetadataMs;
            }
            try
            {
                bool busy;
                lock (gate)
                    busy = DomainBusy(d.Binding.FailureDomain);
                // Polls of one failure domain wait their turn for its lane, so contention costs latency, not a lost
                // poll. A skipped poll slept a whole PollMs and could lose again and again, which left a camera
                // unobserved long enough to read as stale. A domain busy with an operation is not waited for.
                bool queued = false;
                if (!busy)
                {
                    await domainLanes[d.Binding.FailureDomain].WaitAsync(stop.Token);
                    queued = true;
                }
                if (queued)
                {
                    try
                    {
                        // A group sharing a vendor server also shares admission to its polling and writes.
                        lock (gate)
                            busy = DomainBusy(d.Binding.FailureDomain) || d.Blocked || d.Worker != worker;
                        if (busy)
                            continue;
                        var snapshot = await worker.Observe(generation, metadata);
                        lock (gate)
                        {
                            if (!d.Blocked && !snapshot.Blocked && !snapshot.Busy && snapshot.BindingId == d.BindingId && generation == d.Generation && !DomainBusy(d.Binding.FailureDomain))
                            {
                                Merge(d.Fields, snapshot.Fields);
                                if (snapshot.Fields.TryGetValue("connected", out var connection) && connection.Status == "current" && connection.Value?.Type == JTokenType.Boolean && !(bool)connection.Value)
                                {
                                    foreach (var (field, reading) in d.Fields)
                                        if (field != "connected" && reading.Status == "current")
                                            reading.Status = "stale";
                                    foreach (var channel in d.Channels)
                                        foreach (var reading in channel.Values)
                                            if (reading.Status == "current")
                                                reading.Status = "stale";
                                }
                                for (int i = 0; i < snapshot.Channels.Count; i++)
                                {
                                    if (i >= d.Channels.Count)
                                        d.Channels.Add(new());
                                    Merge(d.Channels[i], snapshot.Channels[i]);
                                }
                                if (metadata)
                                {
                                    d.MetadataAt = Wire.Now;
                                    d.Dirty = false;
                                }
                                d.Health = Current(d, "connected")?.Type == JTokenType.Boolean && (bool)Current(d, "connected")! ? (Current(d, "name")?.Value<string>() == d.Binding.ExpectedName ? "ready" : "degraded") : "disconnected";
                                Publish(urgent: false);
                                Recorded?.Invoke("observation", d.Binding.Id, DeviceView(d));
                            }
                        }
                    }
                    finally { domainLanes[d.Binding.FailureDomain].Release(); }
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception e) { lock (gate) { if (d.Worker == worker) FailDomain(d.Binding.FailureDomain, e.Message); } break; }
            try
            {
                await Task.Delay(config.PollMs, stop.Token);
            }
            catch (OperationCanceledException) { break; }
        }
    }
    private JToken? Current(DeviceState d, string field) => d.Fields.TryGetValue(field, out var r) && r.Status == "current" && r.Generation == d.Generation && r.ObservedAt >= Wire.Now - Math.Max(config.PollMs * 3, 3000) ? r.Value : null;
    private object DeviceView(DeviceState d) => new
    {
        id = d.Binding.Id,
        kind = d.Binding.Kind,
        bindingId = d.BindingId,
        expectedName = d.Binding.ExpectedName,
        failureDomain = d.Binding.FailureDomain,
        health = d.Health,
        blocked = d.Blocked,
        reason = d.Reason,
        observationGeneration = d.Generation,
        refreshPending = d.Dirty,
        fields = FieldsView(d),
        channels = d.Channels.Select(channel => channel.ToDictionary(pair => pair.Key, pair =>
        {
            var copy = Wire.Decode<Reading>(Wire.Encode(pair.Value));
            long ttl = pair.Key is "on" or "value" or "id" ? Math.Max(config.PollMs * 3, 3000) : Math.Max(config.MetadataMs * 2, 3000);
            if (copy.Status == "current" && (copy.Generation != d.Generation || copy.ObservedAt < Wire.Now - ttl))
                copy.Status = "stale";
            return copy;
        })).ToArray(),
        commandReady = AdmissionOpen && !d.Blocked && !d.Dirty && !DomainBusy(d.Binding.FailureDomain) && Current(d, "connected")?.Value<bool>() == true && Current(d, "name")?.Value<string>() == d.Binding.ExpectedName
    };
    private Dictionary<string, Reading> FieldsView(DeviceState d)
    {
        var fields = new Dictionary<string, Reading>();
        foreach (var (key, r) in d.Fields)
        {
            var copy = Wire.Decode<Reading>(Wire.Encode(r));
            long ttl = Fields.Metadata(d.Binding.Kind).ContainsKey(key) ? Math.Max(config.MetadataMs * 2, 3000) : Math.Max(config.PollMs * 3, 3000);
            if (copy.Status == "current" && (copy.Generation != d.Generation || copy.ObservedAt < Wire.Now - ttl))
                copy.Status = "stale";
            fields[key] = copy;
        }
        return fields;
    }
    public object State()
    {
        lock (gate)
            return new
            {
                protocolVersion = Wire.Version,
                instanceId = InstanceId,
                sequence,
                generatedAt = Wire.Now,
                commandsEnabled = AdmissionOpen,
                devices = devices.Values.Select(DeviceView).ToArray(),
                operations = journal.Blocking().Select(o => active.TryGetValue(o.Id, out var current) ? Copy(current) : o).Concat(journal.Recent()).ToArray()
            };
    }
    public object Refresh(string id)
    {
        lock (gate)
        {
            var d = Device(id);
            if (d.Blocked)
                throw new ApiError(503, d.Reason ?? "Driver unavailable");
            if (!d.Dirty)
                Invalidate(d);
            Publish();
            return new
            {
                deviceId = id,
                generation = d.Generation,
                pending = true
            };
        }
    }
    public Operation Submit(OperationRequest request)
    {
        OperationRules.Validate(request);
        lock (gate)
        {
            // Existing requests remain readable across service incarnations; no new request may target an old incarnation.
            var existing = journal.Existing(request);
            if (existing != null)
                return existing;
            if (request.InstanceId != InstanceId)
                throw new ApiError(409, "Service instance changed; refresh state before submitting new work", "instance-changed");
            var d = Device(request.DeviceId);
            if (d.BindingId != request.BindingId || d.Binding.ExpectedName != request.ExpectedName)
                throw new ApiError(409, "Device binding changed", "binding-changed");
            if (OperationRules.Kinds[request.Kind] != "*" && OperationRules.Kinds[request.Kind] != d.Binding.Kind)
                throw new ApiError(400, "Operation does not apply to this device");
            if (closing || !config.CommandsEnabled)
                throw new ApiError(403, "Equipment writes disabled", "commands-disabled");
            if (d.Blocked || d.Worker == null)
                throw new ApiError(503, d.Reason ?? "Driver unavailable", "driver-unavailable");
            if (DomainBusy(d.Binding.FailureDomain) || journal.Blocking().Any(o => o.FailureDomain == d.Binding.FailureDomain))
                throw new ApiError(409, "Failure domain has unfinished or unresolved work", "device-busy");
            if (d.Dirty || Current(d, "connected") == null || request.Kind != "device-connect" && (Current(d, "connected")?.Value<bool>() != true || Current(d, "name")?.Value<string>() != d.Binding.ExpectedName))
                throw new ApiError(409, "Fresh identity and connection observation required", "refresh-required");
            string? imageId = request.Kind == "capture" ? Guid.NewGuid().ToString() : null;
            var op = new Operation
            {
                Id = Guid.NewGuid().ToString(),
                InstanceId = InstanceId,
                RequestId = request.RequestId,
                DeviceId = d.Binding.Id,
                BindingId = d.BindingId,
                FailureDomain = d.Binding.FailureDomain,
                ExpectedName = d.Binding.ExpectedName,
                Kind = request.Kind,
                ReservedImageId = imageId,
                Parameters = (JObject)request.Parameters.DeepClone(),
                AcceptedAt = Wire.Now
            };
            journal.Accept(request, op);
            active.Add(op.Id, op);
            foreach (var sibling in devices.Values.Where(x => x.Binding.FailureDomain == op.FailureDomain))
                Invalidate(sibling);
            executions[op.Id] = Task.Run(() => Execute(d, op, request, imageId));
            Publish();
            Recorded?.Invoke("operation-accepted", d.Binding.Id, op);
            return Copy(op);
        }
    }
    private static Operation Copy(Operation op) => Wire.Decode<Operation>(Wire.Encode(op));
    private async Task Execute(DeviceState d, Operation op, OperationRequest request, string? imageId)
    {
        bool uncertain = false, cancelledBeforeDispatch = false;
        WorkerResult? result = null;
        // Where an operation's wall time goes, recorded once when it ends: waiting for the lane, the
        // worker call, storing the image, when each phase was first seen, and how many progress samples
        // (every 250 ms) found the worker retrying its camera reads.
        var timing = Stopwatch.StartNew();
        long? laneWaitMs = null, workerMs = null, adoptMs = null;
        string? seenPhase = null;
        int retryingSamples = 0;
        var phases = new List<object>();
        await domainLanes[d.Binding.FailureDomain].WaitAsync();
        laneWaitMs = timing.ElapsedMilliseconds;
        try
        {
            lock (gate)
            {
                if (d.Blocked || op.Status == "uncertain")
                    throw new IOException("Driver domain became unavailable before dispatch");
                if (op.CancelRequested || closing)
                {
                    if (!op.CancelRequested)
                        op.Message = "Not sent to the worker: the service is stopping";
                    cancelledBeforeDispatch = true;
                    return;
                }
                op.Status = "running";
                op.StartedAt = Wire.Now;
                journal.Save(op);
                if (closing)
                    throw new IOException("Admission stopped before dispatch");
            }
            // From here the worker may have the request.
            var work = d.Worker!.Execute(new ExecuteRequest { OperationId = op.Id, Request = request, ImageId = imageId });
            _ = work.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
            while (await Task.WhenAny(work, Task.Delay(250)) != work)
            {
                if (op.CancelRequested)
                    await d.Worker.Cancel(op.Id);
                var progress = await d.Worker.Progress();
                lock (gate)
                {
                    if (progress?.Id == op.Id && !op.Terminal)
                    {
                        if (progress.Phase != seenPhase)
                        {
                            seenPhase = progress.Phase;
                            phases.Add(new { phase = progress.Phase, atMs = timing.ElapsedMilliseconds });
                        }
                        if (progress.Observation == "retrying")
                            retryingSamples++;
                        op.Phase = progress.Phase;
                        op.ElapsedSeconds = progress.ElapsedSeconds;
                        op.Acknowledged = progress.Acknowledged;
                        op.Observation = progress.Observation;
                        op.Message = progress.Message;
                        Publish();
                    }
                }
            }
            result = await work;
            workerMs = timing.ElapsedMilliseconds;
            if (result.OperationId != op.Id)
                throw new InvalidDataException("Worker returned another operation");
            ImageInfo? retained = null;
            if (result.Image != null)
            {
                if (result.Image.Id != imageId)
                    throw new InvalidDataException("Worker returned another image than the one requested");
                retained = await images.Adopt(op, imageId, result.Image);
                adoptMs = timing.ElapsedMilliseconds - workerMs;
            }

            lock (gate)
            {
                op.Acknowledged |= result.Acknowledged;
                if (op.Status != "uncertain")
                {
                    op.Status = result.Status;
                    op.Acknowledged = result.Acknowledged;
                    op.Settled = result.Settled;
                    op.BlocksDevice = !result.Settled;
                    op.Message = result.Message;
                    op.Result = result.Values;
                    op.Image = retained;
                }
                uncertain = op.Status == "uncertain" || !op.Settled;
            }
        }
        catch (Exception e)
        {
            lock (gate)
            {
                if (result?.Settled == true && !d.Blocked)
                {
                    // The exposure finished but its image could not be stored, so the frame is lost.
                    op.Status = "failed";
                    op.Message = "Equipment completed, but the image could not be stored (image-unavailable): " + e.Message;
                    op.Settled = true;
                    op.BlocksDevice = false;
                }
                else
                {
                    uncertain = true;
                    FailDomain(op.FailureDomain, e.Message);
                    op.Status = "uncertain";
                    op.Message = e.Message;
                    op.Settled = false;
                    op.BlocksDevice = true;
                }
            }
        }
        finally
        {
            lock (gate)
            {
                if (cancelledBeforeDispatch)
                {
                    op.Status = "cancelled";
                    op.Settled = true;
                    op.BlocksDevice = false;
                }
                op.CompletedAt = Wire.Now;
                op.Phase = "finished";
                journal.Save(op);
                if (!uncertain)
                    active.Remove(op.Id);
                foreach (var sibling in devices.Values.Where(x => x.Binding.FailureDomain == op.FailureDomain))
                    Invalidate(sibling);
                executions.Remove(op.Id);
                Publish();
                Recorded?.Invoke("operation-finished", d.Binding.Id, op);
                Recorded?.Invoke("operation-timings", d.Binding.Id, new { operationId = op.Id, kind = op.Kind, laneWaitMs, workerMs, adoptMs, totalMs = timing.ElapsedMilliseconds, retryingSamples, phases });
            }
            domainLanes[d.Binding.FailureDomain].Release();
        }
    }
    public Operation GetOperation(string id)
    {
        lock (gate)
            return active.TryGetValue(id, out var op) ? Copy(op) : journal.Get(id);
    }
    public async Task<Operation> Cancel(string id)
    {
        DeviceState d;
        Operation op;
        lock (gate)
        {
            op = journal.Get(id);
            if (op.Terminal)
                return op;
            if (!active.TryGetValue(id, out op!))
                throw new ApiError(409, "Operation owner unavailable");
            d = Device(op.DeviceId);
            op.CancelRequested = true;
            journal.Save(op);
            Publish();
        }
        await d.Worker!.Cancel(id);
        lock (gate)
            return Copy(op);
    }
    public async Task<object> Recover(string id, JObject request)
    {
        List<DeviceState> domain;
        List<string> owners;
        string key;
        lock (gate)
        {
            var d = Device(id);
            key = d.Binding.FailureDomain;
            if (request.Properties().Any(p => !new[] { "instanceId", "bindingId", "externalRecoveryConfirmed", "note" }.Contains(p.Name)) || ((string?)request["note"])?.Length > 1024 || (string?)request["instanceId"] != InstanceId || (string?)request["bindingId"] != d.BindingId || (bool?)request["externalRecoveryConfirmed"] != true || string.IsNullOrWhiteSpace((string?)request["note"]))
                throw new ApiError(400, "Current binding and explicit external recovery confirmation with a note required");
            if (closing)
                throw new ApiError(409, "Service closing");
            domain = devices.Values.Where(x => x.Binding.FailureDomain == key).ToList();
            if (domain.Any(x => x.Worker?.IsAlive == true) || executions.Any(t => !t.Value.IsCompleted && active.TryGetValue(t.Key, out var running) && running.FailureDomain == key))
                throw new ApiError(409, "Live driver work remains; external recovery must settle and stop the previous owner first", "owner-alive");
            owners = oldOwners.TryGetValue(key, out var prior) ? prior.ToList() : [];
            owners.AddRange(domain.Where(x => x.Worker != null).Select(x => x.Worker!.DirectoryPath));
            foreach (var path in owners.Distinct())
                AssertOwnerGone(path);
            if (!recovering.Add(key))
                throw new ApiError(409, "Recovery of this failure domain is already in progress", "recovery-busy");
        }
        try
        {
            lock (gate)
            {
                if (closing)
                    throw new ApiError(409, "Service closing");
                if (domain.Any(x => x.Worker?.IsAlive == true))
                    throw new ApiError(409, "Live driver work remains; external recovery must settle and stop the previous owner first", "owner-alive");
                foreach (var x in domain)
                    if (!config.Fixture)
                        ReleaseMarker(x.Binding.ProgId);
                foreach (var op in journal.Blocking().Where(o => o.FailureDomain == key))
                {
                    op.BlocksDevice = false;
                    op.Reconciliation = new JObject { ["at"] = Wire.Now, ["note"] = (string?)request["note"], ["externalRecoveryConfirmed"] = true };
                    journal.Save(op);
                    active.Remove(op.Id);
                }
                foreach (var path in owners.Distinct())
                    Durable.Json(Path.Combine(path, "closed.json"), new
                    {
                        externalRecoveryConfirmed = true,
                        at = Wire.Now
                    });
                oldOwners.Remove(key);
                foreach (var x in domain)
                {
                    x.Worker?.Dispose();
                    x.Worker = null;
                    x.BindingId = Guid.NewGuid().ToString();
                    x.Blocked = true;
                    x.Health = "starting";
                    Invalidate(x);
                }
            }
        }
        finally
        {
            lock (gate)
                recovering.Remove(key);
        }
        foreach (var d in domain)
            await StartDevice(d);
        return State();
    }
    private static void AssertOwnerGone(string directory)
    {
        var manifest = Path.Combine(directory, "process.json");
        if (!File.Exists(manifest))
            throw new ApiError(409, "Owner manifest missing; inspect this worker directory manually before recovery");
        var owner = OwnerManifest(manifest);
        AssertProcessGone(owner.Pid, owner.Started);
    }
    // Wire decoding keeps the recorded UTC text. A generic JSON parse turns it into a local-kind
    // DateTime, which shifted the comparison by the time-zone offset and made live owners look gone.
    public static (int Pid, DateTime Started) OwnerManifest(string path)
    {
        var p = Wire.Decode<JObject>(File.ReadAllText(path));
        return ((int)p["pid"]!, DateTime.Parse((string)p["startTimeUtc"]!, null, System.Globalization.DateTimeStyles.RoundtripKind));
    }
    public static bool ProcessAlive(int pid, DateTime started)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return !p.HasExited && Math.Abs((p.StartTime.ToUniversalTime() - started.ToUniversalTime()).TotalSeconds) < 2;
        }
        catch (ArgumentException) { return false; } // PID no longer exists; identity includes creation time to handle reuse.
    }
    private static void AssertProcessGone(int pid, DateTime started)
    {
        if (ProcessAlive(pid, started))
            throw new ApiError(409, "Previous driver process is still alive", "owner-alive");
    }
    private static void ReleaseMarker(string progId)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(progId.ToUpperInvariant())));
        var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cria", "driver-ownership", hash + ".ownership.json");
        if (!File.Exists(path))
            return;
        var marker = OwnerManifest(path);
        AssertProcessGone(marker.Pid, marker.Started);
        File.Delete(path);
    }
    public Task<JObject> Fixture(string id, string fault)
    {
        if (!config.Fixture)
            throw new ApiError(404, "Not found");
        lock (gate)
            return Device(id).Worker!.Fixture(fault);
    }
    private void Publish(bool urgent = true)
    {
        sequence++;
        if (urgent)
            urgentSequence = sequence;
        foreach (var subscriber in subscribers)
            subscriber.Writer.TryWrite(true);
    }
    public async Task Stream(HttpContext context, CancellationToken stopping)
    {
        using var ended = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping);
        // Queue notifications, not serialized states. Every emission takes a fresh
        // snapshot; slow readers neither retain history nor multiply driver reads.
        var channel = Channel.CreateBounded<bool>(new BoundedChannelOptions(1) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });
        lock (gate)
        {
            if (subscribers.Count >= 16)
                throw new ApiError(429, "State stream limit reached");
            subscribers.Add(channel);
        }
        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-store";
        long sentSequence = -1, lastStateAt = 0, lastWriteAt = 0;
        async Task SendState()
        {
            string json;
            lock (gate)
            {
                json = Wire.Encode(State());
                sentSequence = sequence;
            }
            await context.Response.WriteAsync("event: state\ndata: " + json + "\n\n", ended.Token);
            await context.Response.Body.FlushAsync(ended.Token);
            lastStateAt = lastWriteAt = Stopwatch.GetTimestamp();
        }
        try
        {
            // Generated after this GET arrives, including on reconnect. This is
            // a latest-state stream, not an event replay or a monotonic UTC clock.
            await SendState();
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(250));
            bool pending = false;
            while (await timer.WaitForNextTickAsync(ended.Token))
            {
                while (channel.Reader.TryRead(out _))
                    pending = true;
                bool urgent;
                lock (gate)
                    urgent = urgentSequence > sentSequence;
                double elapsed = Stopwatch.GetElapsedTime(lastStateAt).TotalMilliseconds;
                if (pending && elapsed >= 250 && (urgent || elapsed >= 1000))
                {
                    await SendState();
                    pending = false;
                }
                else if (Stopwatch.GetElapsedTime(lastWriteAt).TotalSeconds >= 4)
                {
                    // Liveness only: never manufactures a new equipment reading.
                    await context.Response.WriteAsync(": heartbeat\n\n", ended.Token);
                    await context.Response.Body.FlushAsync(ended.Token);
                    lastWriteAt = Stopwatch.GetTimestamp();
                }
            }
        }
        finally { lock (gate) subscribers.Remove(channel); }
    }
    private async Task Maintain()
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(1000, stop.Token);
                journal.Prune();
            }
            catch (OperationCanceledException) { break; }
            catch (Exception e) { Console.Error.WriteLine("Retention maintenance: " + e.Message); }
        }
    }
    public object ServiceStatus()
    {
        lock (gate)
            return new
            {
                instanceId = InstanceId,
                pid = Environment.ProcessId,
                dataDirectory = config.DataDirectory,
                stopping = closing,
                activeOperations = active.Values.Count(o => !o.Terminal)
            };
    }
    public void RequestStop(string instanceId)
    {
        lock (gate)
        {
            if (instanceId != InstanceId)
                throw new ApiError(409, "Service instance changed", "instance-changed");
            if (active.Values.Any(o => !o.Terminal) || executions.Values.Any(t => !t.IsCompleted))
                throw new ApiError(409, "Finish or cancel active work in Vela before stopping Cria", "service-busy");
            closing = true;
            Publish();
        }
    }
    public void BeginShutdown()
    {
        lock (gate)
            closing = true;
        stop.Cancel();
    }
    public async Task<bool> Shutdown()
    {
        BeginShutdown();
        var unresolved = new HashSet<string>();
        foreach (var d in devices.Values)
        {
            // Initialization, polling and operations use this same lane. Never release
            // an owner while its initialization or final result handling is in flight.
            var lane = domainLanes[d.Binding.FailureDomain];
            await lane.WaitAsync();
            try
            {
                if (oldOwners.ContainsKey(d.Binding.FailureDomain))
                    unresolved.Add(d.Binding.Id);
                if (d.Worker == null)
                    continue;
                if (await d.Worker.Close())
                    Durable.Json(Path.Combine(d.Worker.DirectoryPath, "closed.json"), new
                    {
                        at = Wire.Now,
                        clean = true
                    });
                else
                {
                    unresolved.Add(d.Binding.Id);
                    Console.Error.WriteLine("Unresolved driver retained: " + d.Binding.Id);
                }
            }
            finally { lane.Release(); }
        }
        bool clean = unresolved.Count == 0;
        Durable.Json(Path.Combine(config.DataDirectory, "service-exit.json"), new
        {
            instanceId = InstanceId,
            pid = Environment.ProcessId,
            at = Wire.Now,
            cleanReleased = clean,
            unresolvedDevices = unresolved.Order().ToArray()
        });
        return clean;
    }
}
