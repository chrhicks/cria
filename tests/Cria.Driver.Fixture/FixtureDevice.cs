using System.Buffers.Binary;
using System.Collections.Concurrent;
using Cria.Contracts;
using Newtonsoft.Json.Linq;

namespace Cria.Driver;

// Deterministic contract fixture; never loads a physical driver.
internal sealed class FixtureDevice : IDevice
{
    private readonly Dictionary<string, object> values = new();
    private readonly object gate = new();
    private string fault;
    private long exposureEnd, motionEnd, axisStarted, trackingUpdateAt;
    private bool trackingTarget;
    private double axisRate, axisRa;
    private int writes, exposures, abortAttempts, aborts, positionTarget;
    private string motion = "";
    private readonly string coarseStamp = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss");
    public FixtureDevice(WorkerConfiguration c)
    {
        fault = c.Binding.FixtureFault;
        foreach (var field in Fields.Dynamic(c.Binding.Kind).Values.Concat(Fields.Metadata(c.Binding.Kind).Values))
            values[field] = 0d;
        void Set(object value, params string[] keys)
        {
            foreach (var k in keys)
                values[k] = value;
        }
        Set(false, "connected", "imageready", "cooleron", "slewing", "tracking", "atpark", "athome", "ismoving", "tempcomp");
        Set(true, "canabortexposure", "canstopexposure", "cansetccdtemperature", "cangetcoolerpower", "canasymmetricbin", "canslewasync", "cansettracking", "canfindhome", "canpark", "canunpark", "canmoveaxis", "absolute", "tempcompavailable");
        Set(0, "camerastate", "sensorType", "sensortype", "bayeroffsetx", "bayeroffsety", "startx", "starty", "gain", "offset", "sideofpier", "trackingrate");
        Set(c.Binding.ExpectedName, "name");
        Set(c.Binding.FixtureWidth, "numx", "cameraxsize");
        Set(c.Binding.FixtureHeight, "numy", "cameraysize");
        Set(1, "binx", "biny");
        Set(4, "maxbinx", "maxbiny");
        Set(3.76, "pixelsizex", "pixelsizey");
        Set(-10d, "setccdtemperature");
        Set(10d, "ccdtemperature", "temperature");
        Set(20d, "coolerpower");
        Set(.001, "exposuremin", "exposureresolution");
        Set(3600d, "exposuremax");
        Set(0, "gainmin", "offsetmin");
        Set(100, "gainmax", "offsetmax");
        values["gains"] = new[] { "0", "1" };
        values["offsets"] = new[] { "0", "1" };
        Set("", "lastexposurestarttime");
        Set(1000, "position");
        Set(100000, "maxstep", "maxincrement");
        Set(1d, "stepsize");
        Set(2, "equatorialsystem", "maxswitch");
        Set(5d, "rightascension", "siderealtime");
        Set(30d, "declination");
        Set(33.45d, "sitelatitude");
        Set(-112.07d, "sitelongitude");
        Set(100d, "siteelevation");
        values["axisrates"] = new[] { new { minimum = .01, maximum = 10d } };
    }
    private void Fault(bool write)
    {
        string f;
        lock (gate)
            f = fault;
        if (f == "crash")
            Environment.Exit(71);
        if (f == "hang" || write && f == "hang-write")
            Thread.Sleep(Timeout.Infinite);
        if (f == "slow-read" && !write)
            Thread.Sleep(20);
        if (f == "read-error" && !write)
            throw new IOException("Fixture read failure");
    }
    private void Update()
    {
        if (trackingUpdateAt > 0 && Wire.Now >= trackingUpdateAt)
        {
            trackingUpdateAt = 0;
            values["tracking"] = trackingTarget;
        }
        if (exposureEnd > 0 && Wire.Now >= exposureEnd)
        {
            exposureEnd = 0;
            values["camerastate"] = 0;
            values["imageready"] = true;
        }
        if (axisRate != 0)
            values["rightascension"] = (axisRa + axisRate * (Wire.Now - axisStarted) / 1000 / 15 + 24) % 24;
        if (motionEnd > 0 && Wire.Now >= motionEnd)
        {
            motionEnd = 0;
            values["ismoving"] = false;
            values["slewing"] = false;
            if (motion == "move")
                values["position"] = positionTarget;
            if (motion == "findhome")
                values["athome"] = true;
            if (motion == "park")
                values["atpark"] = true;
        }
    }
    public object? Read(string member, int channel = 0)
    {
        Fault(false);
        lock (gate)
        {
            Update();
            return member switch
            {
                "lastexposurestarttime" when fault == "timestamp-unsupported" => throw new Unsupported(member),
                "getswitchname" => "Channel " + channel,
                "getswitchdescription" => "Fixture switch",
                "canwrite" => true,
                "minswitchvalue" => 0d,
                "maxswitchvalue" => 100d,
                "switchstep" => 1d,
                "getswitchvalue" => values.TryGetValue("switch" + channel, out var v) ? v : 0d,
                "getswitch" => values.TryGetValue("switch" + channel, out var on) && Convert.ToDouble(on) > 0,
                _ => values.TryGetValue(member, out var value) ? value : throw new Unsupported(member)
            };
        }
    }
    public void Write(string member, object value, int channel = 0)
    {
        Fault(true);
        if (member == "connected" && fault == "slow-connect")
            Thread.Sleep(1500);
        lock (gate)
        {
            writes++;
            if (member == "tracking" && fault == "tracking-delayed")
            {
                trackingTarget = Convert.ToBoolean(value);
                trackingUpdateAt = Wire.Now + 350;
            }
            else if (member != "tracking" || fault != "tracking-unconfirmed")
                values[member == "setswitchvalue" ? "switch" + channel : member] = value;
            if (fault == "lost-ack")
                throw new IOException("Fixture write applied but acknowledgement lost");
        }
    }
    public void Command(string member, params object[] a)
    {
        if (member == "abortexposure")
            lock (gate)
                abortAttempts++;
        Fault(true);
        lock (gate)
        {
            Update();
            writes++;
            switch (member)
            {
                case "startexposure":
                    exposures++;
                    if (fault == "stale-frame")
                        break;
                    values["camerastate"] = 2;
                    values["imageready"] = false;
                    values["lastexposurestarttime"] = fault == "timestamp-coarse" ? coarseStamp : DateTimeOffset.UtcNow.ToString("O");
                    exposureEnd = Wire.Now + Math.Max(20, (long)(Convert.ToDouble(a[0]) * 1000));
                    break;
                case "abortexposure":
                    aborts++;
                    exposureEnd = 0;
                    values["camerastate"] = 0;
                    values["imageready"] = false;
                    break;
                case "move":
                    positionTarget = Convert.ToInt32(a[0]);
                    values["ismoving"] = true;
                    motion = member;
                    motionEnd = Wire.Now + (fault.StartsWith("motion-") ? 10000 : 150);
                    break;
                case "halt":
                    if (fault == "motion-stop-error")
                        throw new IOException("Fixture stop failed");
                    motionEnd = 0;
                    values["ismoving"] = false;
                    if (fault == "motion-stop-read-error")
                        fault = "read-error";
                    break;
                case "slewtocoordinatesasync":
                    values["rightascension"] = Convert.ToDouble(a[0]);
                    values["declination"] = Convert.ToDouble(a[1]);
                    goto case "findhome";
                case "findhome":
                case "park":
                    motion = member;
                    motionEnd = Wire.Now + (fault.StartsWith("motion-") ? 10000 : 150);
                    values["slewing"] = true;
                    break;
                case "unpark":
                    values["atpark"] = false;
                    break;
                case "abortslew":
                    if (fault == "motion-stop-error")
                        throw new IOException("Fixture stop failed");
                    motionEnd = 0;
                    axisRate = 0;
                    values["slewing"] = false;
                    if (fault == "motion-stop-read-error")
                        fault = "read-error";
                    break;
                case "moveaxis":
                    axisRa = Convert.ToDouble(values["rightascension"]);
                    axisStarted = Wire.Now;
                    axisRate = Convert.ToDouble(a[1]);
                    values["slewing"] = axisRate != 0;
                    break;
                default:
                    throw new Unsupported(member);
            }
            if (fault == "lost-ack")
                throw new IOException("Fixture command applied but acknowledgement lost");
        }
    }
    public byte[] Image()
    {
        Fault(false);
        lock (gate)
        {
            int w = Convert.ToInt32(values["numx"]), h = Convert.ToInt32(values["numy"]);
            var bytes = new byte[44 + w * h * 4];
            int[] header = [1, 0, 0, 0, 44, 2, 2, 2, w, h, 0];
            Buffer.BlockCopy(header, 0, bytes, 0, 44);
            // ASCOM ImageBytes rank-two arrays serialize first dimension outermost.
            for (int x = 0; x < w; x++)
                for (int y = 0; y < h; y++)
                    BinaryPrimitives.WriteInt32LittleEndian(bytes.AsSpan(44 + (x * h + y) * 4, 4), y * w + x + exposures);
            if (fault == "bad-image")
                bytes[0] = 99;
            return bytes;
        }
    }
    public JObject Control(string command)
    {
        lock (gate)
        {
            if (command == "stats")
                return JObject.FromObject(new
                {
                    writes,
                    exposures,
                    abortAttempts,
                    aborts,
                    fault
                });
            if (!new[] { "none", "crash", "hang", "hang-write", "lost-ack", "read-error", "bad-image", "slow-read", "slow-connect", "timestamp-unsupported", "timestamp-coarse", "stale-frame", "motion-timeout", "motion-stop-error", "motion-stop-read-error", "tracking-delayed", "tracking-unconfirmed", "publish-disk-full", "publish-crash-partial-flushed", "publish-crash-completion-written", "publish-crash-renamed", "publish-rename-error" }.Contains(command))
                throw new ArgumentException("Unknown fixture fault");
            fault = command;
            return JObject.FromObject(new
            {
                fault
            });
        }
    }
    // Fault seam at the worker's original-publication boundaries; never present in Windows workers.
    public void Publication(string stage)
    {
        string f;
        lock (gate)
            f = fault;
        if (f == "publish-disk-full" && stage == "partial-half")
            throw new IOException("Fixture disk full while writing original");
        if (f == "publish-crash-" + stage)
            Environment.Exit(72);
        if (f == "publish-rename-error" && stage == "completion-written")
            throw new IOException("Fixture rename failure after completion record");
    }
    public bool IsIdle
    {
        get
        {
            lock (gate)
            {
                Update();
                return exposureEnd == 0 && motionEnd == 0 && axisRate == 0;
            }
        }
    }
    public void Setup()
    {
    }
    public void Dispose()
    {
    }
}
internal sealed class FixtureOwner(FixtureDevice device) : OwnerBase
{
    private readonly BlockingCollection<Action> queue = new();
    private Thread? thread;
    protected override IDevice Device => device;
    protected override void Enqueue(Action action)
    {
        if (thread == null)
        {
            thread = new Thread(() => { foreach (var work in queue.GetConsumingEnumerable()) work(); }) { IsBackground = true };
            thread.Start();
        }
        queue.Add(action);
    }
    public override async Task<bool> Close(int timeoutMs)
    {
        if (Blocked)
            return false;
        bool safe = await Call(d => { if (!d.IsIdle) return false; d.Write("connected", false); d.Dispose(); return true; }, timeoutMs, true);
        if (safe)
            queue.CompleteAdding();
        return safe;
    }
}
