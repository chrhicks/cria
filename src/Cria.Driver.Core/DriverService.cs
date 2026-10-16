using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using Cria.Contracts;
using Newtonsoft.Json.Linq;

namespace Cria.Driver;

public sealed class DriverService : IDriverRpc
{
    private readonly WorkerConfiguration config;
    private readonly IOwner owner;
    private readonly SemaphoreSlim admission = new SemaphoreSlim(1, 1);
    private readonly object gate = new object();
    private OperationProgress? progress;
    private Task<WorkerResult>? execution;
    private string? fingerprint;
    private bool closing;
    private readonly Func<string, JObject>? fixture;
    private readonly Action<string>? publication;
    public readonly TaskCompletionSource<bool> Stop = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    /// <param name="publication">Fixture-only probe at original publication boundaries.</param>
    public DriverService(WorkerConfiguration config, IOwner owner, Func<string, JObject>? fixture = null, Action<string>? publication = null)
    {
        this.config = config;
        this.owner = owner;
        this.fixture = fixture;
        this.publication = publication;
    }
    private static void WriteDurable(string path, string json)
    {
        var temporary = path + ".new";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes(json);
            file.Write(bytes, 0, bytes.Length);
            file.Flush(true);
        }
        File.Move(temporary, path);
    }
    private WorkerSnapshot Snapshot(long generation = 0) => new WorkerSnapshot
    {
        BindingId = config.BindingId,
        Generation = generation,
        Blocked = owner.Blocked,
        Reason = owner.Reason,
        Busy = execution != null && !execution.IsCompleted,
        Operation = Progress(),
        Pid = Process.GetCurrentProcess().Id
    };
    private OperationProgress? Progress()
    {
        lock (gate)
            return progress == null ? null : Wire.Decode<OperationProgress>(Wire.Encode(progress));
    }
    private void Change(Action<OperationProgress> change)
    {
        lock (gate)
        {
            if (progress != null)
                change(progress);
        }
    }
    public async Task<WorkerSnapshot> InitializeAsync()
    {
        if (!await admission.WaitAsync(0))
            throw new InvalidOperationException("Worker busy");
        try
        {
            await owner.Call(d =>
            {
                if (config.Binding.SetupBeforeConnect)
                    d.Setup();
                if (config.Binding.Connect)
                    d.Write("connected", true);
                if (Convert.ToBoolean(d.Read("connected")) && (string?)d.Read("name") != config.Binding.ExpectedName)
                    throw new InvalidDataException("Connected driver identity differs from configured equipment");
                return true;
            }, config.Binding.SetupBeforeConnect ? 300000 : config.InitializeTimeoutMs, true);
        }
        catch (Exception e) { owner.Quarantine("Initialization failed: " + e.Message); }
        finally { admission.Release(); }
        return Snapshot();
    }
    public async Task<WorkerSnapshot> ObserveAsync(long generation, bool metadata)
    {
        var result = Snapshot(generation);
        if (closing || owner.Blocked || result.Busy || !await admission.WaitAsync(0))
        {
            result.Busy = !owner.Blocked;
            return result;
        }
        try
        {
            var fields = new Dictionary<string, string> { { "connected", "connected" }, { "name", "name" } };
            foreach (var x in Fields.Dynamic(config.Binding.Kind))
                fields[x.Key] = x.Value;
            if (metadata)
                foreach (var x in Fields.Metadata(config.Binding.Kind))
                    fields[x.Key] = x.Value;
            foreach (var x in fields)
            {
                result.Fields[x.Key] = await ObserveField(x.Value, generation);
                if (owner.Blocked)
                    break;
                if (x.Key == "connected" && result.Fields[x.Key].Status == "current" && !(bool)result.Fields[x.Key].Value!)
                    break;
            }
            if (result.Fields.TryGetValue("name", out var name) && name.Status == "current" && name.Value?.Type == JTokenType.String &&
                (string?)name.Value != config.Binding.ExpectedName)
                owner.Quarantine("Observed device identity changed");
            if (config.Binding.Kind == "switch" && !owner.Blocked && result.Fields.TryGetValue("channelCount", out var count) && count.Status == "current")
            {
                int n = (int)count.Value!;
                if (n < 0 || n > 64)
                    throw new InvalidDataException("Switch channel count exceeds bound");
                for (int i = 0; i < n; i++)
                {
                    var channel = new Dictionary<string, Reading> { { "id", Reading.Success(i, Wire.Now, generation) } };
                    foreach (var x in Fields.SwitchChannel)
                    {
                        if (!metadata && x.Key != "on" && x.Key != "value")
                            continue;
                        channel[x.Key] = await ObserveField(x.Value, generation, i);
                        if (owner.Blocked)
                            break;
                    }
                    result.Channels.Add(channel);
                    if (owner.Blocked)
                        break;
                }
            }
        }
        finally { admission.Release(); }
        result.Blocked = owner.Blocked;
        result.Reason = owner.Reason;
        return result;
    }
    private async Task<Reading> ObserveField(string member, long generation, int channel = 0)
    {
        long start = Wire.Now;
        try
        {
            return Reading.Success(await owner.Call(d => d.Read(member, channel), config.CallTimeoutMs), start, generation);
        }
        catch (Exception e) { return new Reading { CheckedAt = Wire.Now, ReadStartedAt = start, Status = e is Unsupported ? "unsupported" : "error", Message = e.Message }; }
    }
    public Task<OperationProgress?> ProgressAsync() => Task.FromResult(Progress());
    public Task<bool> CancelAsync(string operationId)
    {
        lock (gate)
        {
            if (progress == null || progress.Id != operationId)
                return Task.FromResult(false);
            progress.CancelRequested = true;
            return Task.FromResult(true);
        }
    }
    public Task<JObject> FixtureAsync(string fault)
    {
        if (!config.Fixture || fixture == null)
            throw new InvalidOperationException("Fixture controls unavailable");
        return Task.FromResult(fixture(fault));
    }
    public Task<WorkerResult> ExecuteAsync(ExecuteRequest request)
    {
        OperationRules.Validate(request.Request);
        if (!Guid.TryParse(request.OperationId, out _) || request.Request.DeviceId != config.Binding.Id || request.Request.BindingId != config.BindingId || request.Request.ExpectedName != config.Binding.ExpectedName)
            throw new InvalidDataException("Worker operation binding mismatch");
        var fp = Wire.Encode(request);
        lock (gate)
        {
            if (progress?.Id == request.OperationId)
            {
                if (fingerprint != fp)
                    throw new InvalidDataException("Operation ID content changed");
                return execution!;
            }
            if (closing || owner.Blocked || execution != null && !execution.IsCompleted)
                throw new OwnerUnavailable(owner.Reason ?? "Worker busy or closing");
            fingerprint = fp;
            progress = new OperationProgress { Id = request.OperationId };
            execution = Task.Run(async () =>
            {
                // A previously started observation finishes first. No driver call overlaps the command.
                await admission.WaitAsync();
                if (owner.Blocked)
                {
                    admission.Release();
                    return new WorkerResult { OperationId = request.OperationId, Status = "uncertain", Message = owner.Reason };
                }
                return await Run(request);
            });
            return execution;
        }
    }
    private bool Cancelled
    {
        get
        {
            lock (gate)
                return progress?.CancelRequested == true;
        }
    }
    private Task<object?> Read(string member, int channel = 0) => owner.Call(d => d.Read(member, channel), config.CallTimeoutMs);
    private async Task<double> Number(string member, int channel = 0)
    {
        double value = Convert.ToDouble(await Read(member, channel), CultureInfo.InvariantCulture);
        if (!Wire.Finite(value))
            throw new InvalidDataException("Non-finite driver value: " + member);
        return value;
    }
    private async Task<int> Integer(string member, int channel = 0)
    {
        double v = await Number(member, channel);
        if (v != Math.Truncate(v) || v < int.MinValue || v > int.MaxValue)
            throw new InvalidDataException("Non-integer driver value: " + member);
        return (int)v;
    }
    private async Task<bool> Bool(string member, int channel = 0)
    {
        var v = await Read(member, channel);
        if (!(v is bool))
            throw new InvalidDataException("Non-boolean driver value: " + member);
        return (bool)v;
    }
    private async Task Identity(bool requireConnected = true)
    {
        if (requireConnected && !await Bool("connected"))
            throw new InvalidOperationException("Device disconnected");
        if ((string?)await Read("name") != config.Binding.ExpectedName)
            throw new InvalidOperationException("Physical device identity mismatch");
    }
    private async Task Write(string member, object value, int channel = 0)
    {
        await owner.Call(d => { d.Write(member, value, channel); return true; }, config.CallTimeoutMs, true);
        Change(p => p.Acknowledged = true);
    }
    private async Task Command(string member, params object[] arguments)
    {
        await owner.Call(d => { d.Command(member, arguments); return true; }, config.CallTimeoutMs, true);
        Change(p => p.Acknowledged = true);
    }
    private async Task<WorkerResult> Run(ExecuteRequest command)
    {
        var result = new WorkerResult { OperationId = command.OperationId };
        var p = command.Request.Parameters;
        bool physical = false, settled = false;
        string? pending = null;
        try
        {
            if (command.Request.Kind != "device-connect")
                await Identity();
            if (Cancelled)
            {
                result.Status = "cancelled";
                result.Settled = true;
                return result;
            }
            switch (command.Request.Kind)
            {
                case "capture":
                    if (!Guid.TryParse(command.ImageId, out _))
                        throw new InvalidDataException("Image reservation required");
                    if (await Integer("camerastate") != 0)
                        throw new InvalidOperationException("Camera must be idle");
                    int width = await Integer("numx"), height = await Integer("numy"), bx = await Integer("binx"), by = await Integer("biny"), sx = await Integer("startx"), sy = await Integer("starty");
                    if (width < 1 || height < 1 || (long)width * height > config.MaxPixels || bx < 1 || by < 1 || sx < 0 || sy < 0)
                        throw new InvalidDataException("Invalid image geometry");
                    double exposure = (double)p["exposureSeconds"]!;
                    if (exposure < await Number("exposuremin") || exposure > await Number("exposuremax"))
                        throw new ArgumentException("Exposure outside driver limits");
                    int sensor = await Integer("sensortype");
                    string color = "mono";
                    if (sensor != 0)
                    {
                        if ((bool?)p["monochromeOnly"] == true || sensor != 2 || bx != 1 || by != 1)
                            throw new InvalidOperationException("Consumer requires mono or unbinned Bayer sensor");
                        int ox = await Integer("bayeroffsetx"), oy = await Integer("bayeroffsety");
                        if (ox < 0 || ox > 1 || oy < 0 || oy > 1)
                            throw new InvalidDataException("Invalid Bayer offset");
                        color = new[] { "rggb", "grbg", "gbrg", "bggr" }[((oy + sy) % 2) * 2 + (ox + sx) % 2];
                    }
                    string prior = "";
                    try
                    {
                        prior = (string?)await Read("lastexposurestarttime") ?? "";
                    }
                    catch (Exception) when (!owner.Blocked) { }
                    bool canAbort = await Bool("canabortexposure");
                    pending = Path.Combine(config.DataDirectory, "pending", command.ImageId + ".partial");
                    using (var file = new FileStream(pending, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                        file.Flush(true);
                    physical = true;
                    long dispatched = Wire.Now;
                    await Command("startexposure", exposure, (bool)p["light"]!);
                    Change(x => x.Phase = "exposing");
                    var watch = Stopwatch.StartNew();
                    bool notReady = false, aborted = false, finished = false;
                    string stamp = "";
                    while (watch.ElapsedMilliseconds < exposure * 1000 + config.OperationTimeoutMs)
                    {
                        Change(x => x.ElapsedSeconds = watch.Elapsed.TotalSeconds);
                        // Observation failures must not prevent a requested abort. A
                        // successful command still requires subsequent idle readback.
                        if (Cancelled && !aborted && canAbort)
                        {
                            await Command("abortexposure");
                            aborted = true;
                            Change(x => x.Phase = "stopping");
                        }
                        if (Cancelled && !canAbort)
                            Change(x => x.Message = "Driver cannot abort; following the existing exposure");
                        bool ready;
                        int state;
                        try
                        {
                            ready = await Bool("imageready");
                            state = await Integer("camerastate");
                            if (state == 5)
                                throw new OwnerUnavailable("Camera reports error");
                            Change(x => x.Observation = "current");
                        }
                        catch (Exception) when (!owner.Blocked) { Change(x => x.Observation = "retrying"); await Task.Delay(100); continue; }
                        if (!ready)
                            notReady = true;
                        if (aborted && state == 0)
                        {
                            settled = true;
                            result.Status = "cancelled";
                            return result;
                        }
                        if (ready && state == 0)
                        {
                            try
                            {
                                stamp = (string?)await Read("lastexposurestarttime") ?? "";
                            }
                            catch (Unsupported) when (!owner.Blocked) { stamp = ""; }
                            var before = ParseTime(prior);
                            var after = ParseTime(stamp);
                            // Either changed camera time or an observed false-to-true
                            // readiness transition establishes a fresh frame. Camera
                            // timestamps may be unsupported or have whole-second precision.
                            if (after != null && after != before || notReady)
                            {
                                finished = true;
                                settled = true;
                                break;
                            }
                        }
                        await Task.Delay(50);
                    }
                    if (!finished)
                        throw new OwnerUnavailable("Exposure did not establish a fresh completed frame before deadline");
                    await Identity();
                    foreach (var x in new[] { ("numx", width), ("numy", height), ("binx", bx), ("biny", by), ("startx", sx), ("starty", sy) })
                        if (await Integer(x.Item1) != x.Item2)
                            throw new InvalidDataException("Image geometry changed during exposure");
                    Change(x => x.Phase = "readout");
                    var image = await owner.Call(d =>
                    {
                        byte[] bytes = d.Image();
                        ValidateImage(bytes, width, height, config.MaxPixels);
                        Change(x => x.Phase = "retaining");
                        string hash;
                        using (var sha = SHA256.Create())
                            hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
                        using (var file = new FileStream(pending, FileMode.Open, FileAccess.Write, FileShare.None, 65536))
                        {
                            int half = bytes.Length / 2;
                            file.Write(bytes, 0, half);
                            publication?.Invoke("partial-half");
                            file.Write(bytes, half, bytes.Length - half);
                            file.Flush(true);
                        }
                        var captured = new CapturedImage
                        {
                            Id = command.ImageId!,
                            Width = width,
                            Height = height,
                            BinX = bx,
                            BinY = by,
                            StartX = sx,
                            StartY = sy,
                            Color = color,
                            Bytes = bytes.LongLength,
                            Sha256 = hash,
                            CapturedAt = ParseTime(stamp) ?? dispatched,
                            CapturedAtSource = ParseTime(stamp) != null ? "camera" : "server-estimate"
                        };
                        // Completion provenance is durable before the rename, so every renamed
                        // original can be verified and attributed without this RPC reply.
                        publication?.Invoke("partial-flushed");
                        string directory = Path.Combine(config.DataDirectory, "pending");
                        WriteDurable(Path.Combine(directory, command.ImageId + ".json"), Wire.Encode(new CompletionRecord
                        {
                            OperationId = command.OperationId,
                            BindingId = config.BindingId,
                            DeviceId = config.Binding.Id,
                            Image = captured,
                            WrittenAt = Wire.Now
                        }));
                        publication?.Invoke("completion-written");
                        File.Move(pending, Path.Combine(directory, command.ImageId + ".imagebytes"));
                        publication?.Invoke("renamed");
                        return captured;
                    }, config.ImageTimeoutMs);
                    pending = null;
                    result.Image = image;
                    break;
                case "device-connect":
                    bool connected = (bool)p["connected"]!;
                    if (!connected && !await owner.Call(d => d.IsIdle, config.CallTimeoutMs))
                        throw new InvalidOperationException("Disconnect requires idle equipment");
                    physical = true;
                    await Write("connected", connected);
                    if (await Bool("connected") != connected)
                        throw new OwnerUnavailable("Connection readback did not match");
                    if (connected)
                        await Identity();
                    settled = true;
                    result.Values["connected"] = connected;
                    break;
                case "cooling":
                    if (!await Bool("cansetccdtemperature"))
                        throw new Unsupported("Camera cooling control unsupported");
                    if (p["setpointC"] != null)
                    {
                        physical = true;
                        await Write("setccdtemperature", (double)p["setpointC"]!);
                    }
                    if (p["coolerOn"] != null)
                    {
                        physical = true;
                        await Write("cooleron", (bool)p["coolerOn"]!);
                    }
                    bool on = await Bool("cooleron");
                    double setpoint = await Number("setccdtemperature");
                    if (p["coolerOn"] != null && on != (bool)p["coolerOn"]! || p["setpointC"] != null && Math.Abs(setpoint - (double)p["setpointC"]!) > .15)
                        throw new OwnerUnavailable("Cooling readback not confirmed");
                    result.Values["coolerOn"] = on;
                    result.Values["setpointC"] = setpoint;
                    settled = true;
                    break;
                case "camera-configure":
                    if (await Integer("camerastate") != 0)
                        throw new InvalidOperationException("Camera configuration requires idle state");
                    await ValidateCameraSettings(p);
                    foreach (var x in new[] { ("binX", "binx"), ("binY", "biny"), ("startX", "startx"), ("startY", "starty"), ("width", "numx"), ("height", "numy"), ("gain", "gain"), ("offset", "offset") })
                        if (p[x.Item1] != null)
                        {
                            physical = true;
                            await Write(x.Item2, (int)p[x.Item1]!);
                            if (await Integer(x.Item2) != (int)p[x.Item1]!)
                                throw new OwnerUnavailable("Camera setting readback not confirmed: " + x.Item1);
                            result.Values[x.Item1] = p[x.Item1]!.DeepClone();
                        }
                    settled = true;
                    break;
                case "focuser-move":
                    if (!await Bool("absolute") || await Bool("ismoving"))
                        throw new InvalidOperationException("Absolute idle focuser required");
                    int target = (int)p["position"]!, max = await Integer("maxstep");
                    if (target >= max)
                        throw new ArgumentException("Focuser target approaches mechanical limit");
                    if (await Integer("position") == target)
                    {
                        settled = true;
                        result.Values["position"] = target;
                        break;
                    }
                    physical = true;
                    await Command("move", target);
                    Change(x => x.Phase = "moving");
                    var focusOutcome = await WaitMotion("ismoving", "halt", null);
                    settled = true;
                    if (focusOutcome == MotionOutcome.TimedOut)
                        throw new InvalidOperationException("Motion deadline exceeded; acknowledged stop and stationary readback obtained");
                    result.Values["position"] = await Integer("position");
                    if (focusOutcome == MotionOutcome.Cancelled)
                    {
                        result.Status = "cancelled";
                        return result;
                    }
                    if ((int)result.Values["position"]! != target)
                        throw new InvalidOperationException("Focuser stopped short of target");
                    break;
                case "focuser-halt":
                    physical = true;
                    await Command("halt");
                    await ConfirmFalse("ismoving");
                    settled = true;
                    result.Values["position"] = await Integer("position");
                    break;
                case "mount-tracking":
                    if (!await Bool("cansettracking"))
                        throw new Unsupported("Tracking control unsupported");
                    if (await Bool("atpark") && (bool)p["tracking"]!)
                        throw new InvalidOperationException("Parked mount cannot enable tracking");
                    physical = true;
                    await Write("tracking", (bool)p["tracking"]!);
                    await ConfirmTracking((bool)p["tracking"]!);
                    settled = true;
                    result.Values["tracking"] = p["tracking"]!.DeepClone();
                    break;
                case "mount-slew":
                case "mount-home":
                case "mount-park":
                    if (await Bool("slewing"))
                        throw new InvalidOperationException("Mount already moving");
                    var kind = command.Request.Kind;
                    if (kind != "mount-park" && await Bool("atpark"))
                        throw new InvalidOperationException("Mount parked");
                    string capability = kind == "mount-slew" ? "canslewasync" : kind == "mount-home" ? "canfindhome" : "canpark";
                    if (!await Bool(capability))
                        throw new Unsupported("Mount operation unsupported");
                    if (kind == "mount-slew")
                    {
                        if (CoordinateSystem(await Integer("equatorialsystem")) != (string?)p["coordinateSystem"])
                            throw new InvalidOperationException("Requested coordinates do not match driver frame");
                        physical = true;
                        await Command("slewtocoordinatesasync", (double)p["rightAscensionDegrees"]! / 15, (double)p["declinationDegrees"]!);
                    }
                    else
                    {
                        physical = true;
                        await Command(kind == "mount-home" ? "findhome" : "park");
                    }
                    Change(x => x.Phase = "moving");
                    var mountOutcome = await WaitMotion("slewing", "abortslew", kind == "mount-home" ? "athome" : kind == "mount-park" ? "atpark" : null);
                    settled = true;
                    if (mountOutcome == MotionOutcome.TimedOut)
                        throw new InvalidOperationException("Motion deadline exceeded; acknowledged stop and stationary readback obtained");
                    if (mountOutcome == MotionOutcome.Cancelled)
                    {
                        result.Status = "cancelled";
                        return result;
                    }
                    if (kind == "mount-slew")
                    {
                        var ra = await Number("rightascension") * 15;
                        var dec = await Number("declination");
                        if (Math.Abs(AngularDelta(ra, (double)p["rightAscensionDegrees"]!)) > .1 || Math.Abs(dec - (double)p["declinationDegrees"]!) > .1)
                            throw new InvalidOperationException("Slew stopped outside target tolerance");
                        result.Values["rightAscensionDegrees"] = ra;
                        result.Values["declinationDegrees"] = dec;
                    }
                    break;
                case "mount-unpark":
                    if (!await Bool("canunpark"))
                        throw new Unsupported("Unpark unsupported");
                    physical = true;
                    await Command("unpark");
                    await ConfirmFalse("atpark");
                    settled = true;
                    break;
                case "mount-stop":
                    physical = true;
                    await Command("abortslew");
                    await ConfirmFalse("slewing");
                    settled = true;
                    break;
                case "mount-axis":
                case "mount-rotate":
                    double rate = (double)p["rateDegreesPerSecond"]!;
                    if (await Bool("atpark") || await Bool("slewing") || !await Bool("canmoveaxis"))
                        throw new InvalidOperationException("Available, unparked primary axis required");
                    var ranges = JArray.FromObject((await Read("axisrates"))!);
                    if (!ranges.Any(r => Math.Abs(rate) >= (double)r["minimum"]! && Math.Abs(rate) <= (double)r["maximum"]!))
                        throw new ArgumentException("Axis rate outside driver ranges");
                    bool rotate = command.Request.Kind == "mount-rotate";
                    double startRa = await Number("rightascension") * 15;
                    double limit = rotate ? Math.Min(120, Math.Abs((double)p["distanceDegrees"]! / rate) * 2 + 2) : (double)p["durationSeconds"]!;
                    physical = true;
                    await Command("moveaxis", 0, rate);
                    Change(x => x.Phase = "moving");
                    bool reached = !rotate, axisCancelled = false;
                    var motion = Stopwatch.StartNew();
                    try
                    {
                        while (motion.Elapsed.TotalSeconds < limit)
                        {
                            if (Cancelled)
                            {
                                axisCancelled = true;
                                break;
                            }
                            if (rotate)
                            {
                                var distance = (double)p["distanceDegrees"]!;
                                var traveled = AngularDelta(await Number("rightascension") * 15, startRa) * Math.Sign(distance);
                                if (traveled < -1)
                                    throw new InvalidOperationException("Axis moved opposite requested RA travel");
                                if (traveled >= Math.Abs(distance))
                                {
                                    reached = true;
                                    break;
                                }
                            }
                            await Task.Delay(50);
                        }
                    }
                    finally
                    {
                        // This stop is local to the worker even if the API or network disappears.
                        // A timed-out COM call still quarantines ownership; no claim that hardware stopped.
                        Change(x => x.Phase = "stopping");
                        await Command("moveaxis", 0, 0d);
                        await ConfirmFalse("slewing");
                        settled = true;
                    }
                    if (axisCancelled)
                    {
                        result.Status = "cancelled";
                        return result;
                    }
                    if (!reached)
                        throw new InvalidOperationException("Requested RA travel was not reached before local deadline");
                    result.Values["rightAscensionDegrees"] = await Number("rightascension") * 15;
                    break;
                case "switch-set":
                    int channelId = (int)p["channelId"]!;
                    double value = (double)p["value"]!;
                    if (channelId >= await Integer("maxswitch") || !await Bool("canwrite", channelId))
                        throw new InvalidOperationException("Switch channel is not writable");
                    double low = await Number("minswitchvalue", channelId), high = await Number("maxswitchvalue", channelId), step = await Number("switchstep", channelId);
                    if (value < low || value > high || step <= 0 || Math.Abs((value - low) / step - Math.Round((value - low) / step)) > 1e-6)
                        throw new ArgumentException("Switch value outside supported range or step");
                    physical = true;
                    await Write("setswitchvalue", value, channelId);
                    if (Math.Abs(await Number("getswitchvalue", channelId) - value) > Math.Max(1e-9, step * 1e-6))
                        throw new OwnerUnavailable("Switch readback not confirmed");
                    settled = true;
                    result.Values["value"] = value;
                    break;
            }
            result.Status = "succeeded";
            return result;
        }
        catch (Exception e)
        {
            bool uncertain = owner.Blocked || e is OwnerUnavailable || physical && !settled;
            if (uncertain)
                owner.Quarantine("Operation outcome requires reconciliation: " + e.Message);
            result.Status = uncertain ? "uncertain" : "failed";
            result.Message = e.Message;
            return result;
        }
        finally
        {
            result.Acknowledged = Progress()?.Acknowledged == true;
            result.Settled = !owner.Blocked && (settled || !physical);
            Change(x => { x.Status = result.Status; x.Phase = "finished"; x.Message = result.Message ?? x.Message; });
            // Only an empty placeholder is removed. Written bytes stay for the API to
            // classify and count; they are never treated as a verified original.
            if (pending != null && !owner.Blocked)
            {
                try
                {
                    if (new FileInfo(pending).Length == 0)
                        File.Delete(pending);
                }
                catch (IOException) { }
            }
            admission.Release();
        }
    }
    private async Task ValidateCameraSettings(JObject p)
    {
        int bx = (int?)p["binX"] ?? await Integer("binx"), by = (int?)p["binY"] ?? await Integer("biny");
        if (bx > await Integer("maxbinx") || by > await Integer("maxbiny") || bx != by && !await Bool("canasymmetricbin"))
            throw new ArgumentException("Unsupported binning");
        int sx = (int?)p["startX"] ?? await Integer("startx"), sy = (int?)p["startY"] ?? await Integer("starty");
        int width = (int?)p["width"] ?? await Integer("numx"), height = (int?)p["height"] ?? await Integer("numy");
        if ((long)(sx + width) * bx > await Integer("cameraxsize") || (long)(sy + height) * by > await Integer("cameraysize") || (long)width * height > config.MaxPixels)
            throw new ArgumentException("ROI exceeds sensor bounds");
        foreach (var key in new[] { "gain", "offset" })
            if (p[key] != null)
            {
                int target = (int)p[key]!;
                try
                {
                    if (target < await Integer(key + "min") || target > await Integer(key + "max"))
                        throw new ArgumentException("Invalid " + key);
                }
                catch (Unsupported) { var choices = JArray.FromObject((await Read(key + "s"))!); if (target >= choices.Count) throw new ArgumentException("Invalid " + key + " index"); }
            }
    }
    private enum MotionOutcome { Completed, Cancelled, TimedOut }
    private async Task<MotionOutcome> WaitMotion(string moving, string stop, string? target)
    {
        var watch = Stopwatch.StartNew();
        bool stopped = false;
        while (watch.ElapsedMilliseconds < config.OperationTimeoutMs)
        {
            if (Cancelled && !stopped)
            {
                await Command(stop);
                stopped = true;
                Change(x => x.Phase = "stopping");
            }
            if (!await Bool(moving))
            {
                if (stopped)
                    return MotionOutcome.Cancelled;
                if (target == null || await Bool(target))
                    return MotionOutcome.Completed;
            }
            await Task.Delay(100);
        }
        await Command(stop);
        await ConfirmFalse(moving);
        return MotionOutcome.TimedOut;
    }
    private async Task ConfirmTracking(bool expected)
    {
        // Acknowledgement can precede the driver's reported tracking state.
        // Inspect for a bounded interval; never repeat the physical write.
        var watch = Stopwatch.StartNew();
        do
        {
            if (await Bool("tracking") == expected)
                return;
            await Task.Delay(100);
        } while (watch.ElapsedMilliseconds < Math.Min(config.OperationTimeoutMs, 15000));
        throw new OwnerUnavailable("Tracking readback not confirmed");
    }
    private async Task ConfirmFalse(string member)
    {
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < 15000)
        {
            if (!await Bool(member))
                return;
            await Task.Delay(100);
        }
        throw new OwnerUnavailable("Stop/state not confirmed: " + member);
    }
    public async Task<bool> CloseAsync()
    {
        closing = true;
        // An active operation owns its physical completion; never drop it because its caller vanished.
        if (!await admission.WaitAsync(config.OperationTimeoutMs))
            return false;
        try
        {
            bool closed = await owner.Close(config.CallTimeoutMs);
            if (closed)
                _ = Task.Run(async () => { await Task.Delay(300); Stop.TrySetResult(true); });
            return closed;
        }
        finally { admission.Release(); }
    }
    private static long? ParseTime(string s) => DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal, out var t) ? t.ToUnixTimeMilliseconds() : (long?)null;
    public static double AngularDelta(double current, double origin) => (current - origin + 540) % 360 - 180;
    public static string CoordinateSystem(int n) => n >= 0 && n < 5 ? new[] { "other", "topocentric", "j2000", "j2050", "b1950" }[n] : "unknown";
    public static void ValidateImage(byte[] bytes, int width, int height, int maxPixels)
    {
        if (bytes.Length < 44)
            throw new InvalidDataException("Truncated ImageBytes header");
        int F(int i) => BitConverter.ToInt32(bytes, i * 4);
        int size = F(6) == 1 || F(6) == 8 ? 2 : F(6) == 2 ? 4 : F(6) == 6 ? 1 : 0;
        if (F(0) != 1 || F(1) != 0 || F(4) != 44 || F(5) != 2 || F(7) != 2 || F(8) != width || F(9) != height || F(10) != 0 || size == 0 || width < 1 || height < 1 || (long)width * height > maxPixels || bytes.LongLength != 44 + (long)width * height * size)
            throw new InvalidDataException("Invalid ImageBytes geometry, type or length");
    }
}
