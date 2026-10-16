using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;

namespace Cria.Contracts;

public static class Wire
{
    // 4: no custody. Completed images are a rolling set the service may drop (410 image-gone); no storeId,
    // receipts or DELETE. A new instanceId means everything in flight before it is unknown.
    public const int Version = 4;
    public static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
    public static readonly JsonSerializerSettings Json = new JsonSerializerSettings
    {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        MissingMemberHandling = MissingMemberHandling.Error,
        DateParseHandling = DateParseHandling.None,
        FloatParseHandling = FloatParseHandling.Double,
        MaxDepth = 32
    };
    public static string Encode(object value) => JsonConvert.SerializeObject(value, Json);
    public static T Decode<T>(string value) => JsonConvert.DeserializeObject<T>(value, Json)!;
    public static bool Finite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}

public sealed class Binding
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string ProgId { get; set; } = "";
    public string ExpectedName { get; set; } = "";
    public string FailureDomain { get; set; } = "";
    public bool Connect
    {
        get; set;
    }
    public bool SetupBeforeConnect
    {
        get; set;
    }
    public int FixtureWidth { get; set; } = 64;
    public int FixtureHeight { get; set; } = 48;
    public string FixtureFault { get; set; } = "none";
}

public sealed class WorkerConfiguration
{
    public Binding Binding { get; set; } = new Binding();
    public string BindingId { get; set; } = "";
    public string DataDirectory { get; set; } = "";
    public bool Fixture
    {
        get; set;
    }
    public bool OwnershipConfirmed
    {
        get; set;
    }
    public int CallTimeoutMs { get; set; } = 5000;
    public int InitializeTimeoutMs { get; set; } = 120000;
    public int ImageTimeoutMs { get; set; } = 120000;
    public int OperationTimeoutMs { get; set; } = 180000;
    public int MaxPixels { get; set; } = 40000000;
}

public sealed class Reading
{
    public JToken? Value
    {
        get; set;
    }
    public long? ObservedAt
    {
        get; set;
    }
    public long? CheckedAt
    {
        get; set;
    }
    public long? ReadStartedAt
    {
        get; set;
    }
    public long? Generation
    {
        get; set;
    }
    public string Status { get; set; } = "pending";
    public string? Message
    {
        get; set;
    }
    public static Reading Success(object? value, long started, long generation) => new Reading
    {
        Value = value == null ? JValue.CreateNull() : JToken.FromObject(value),
        ObservedAt = Wire.Now,
        CheckedAt = Wire.Now,
        ReadStartedAt = started,
        Generation = generation,
        Status = "current"
    };
}

public sealed class WorkerSnapshot
{
    public string BindingId { get; set; } = "";
    public long Generation
    {
        get; set;
    }
    public Dictionary<string, Reading> Fields { get; set; } = new Dictionary<string, Reading>();
    public List<Dictionary<string, Reading>> Channels { get; set; } = new List<Dictionary<string, Reading>>();
    public bool Blocked
    {
        get; set;
    }
    public bool Busy
    {
        get; set;
    }
    public string? Reason
    {
        get; set;
    }
    public OperationProgress? Operation
    {
        get; set;
    }
    public int Pid
    {
        get; set;
    }
}

public sealed class OperationRequest
{
    public string InstanceId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string BindingId { get; set; } = "";
    public string ExpectedName { get; set; } = "";
    public string Kind { get; set; } = "";
    public JObject Parameters { get; set; } = new JObject();
}

public sealed class ExecuteRequest
{
    public string OperationId { get; set; } = "";
    public OperationRequest Request { get; set; } = new OperationRequest();
    public string? ImageId
    {
        get; set;
    }
}

public sealed class OperationProgress
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "running";
    public string Phase { get; set; } = "preparing";
    public bool Acknowledged
    {
        get; set;
    }
    public bool CancelRequested
    {
        get; set;
    }
    public string Observation { get; set; } = "current";
    public string? Message
    {
        get; set;
    }
    public double? ElapsedSeconds
    {
        get; set;
    }
}

public sealed class WorkerResult
{
    public string OperationId { get; set; } = "";
    public string Status { get; set; } = "failed";
    public bool Acknowledged
    {
        get; set;
    }
    public bool Settled
    {
        get; set;
    }
    public string? Message
    {
        get; set;
    }
    public JObject Values { get; set; } = new JObject();
    public CapturedImage? Image
    {
        get; set;
    }
}

public sealed class CapturedImage
{
    public string Id { get; set; } = "";
    public int Width
    {
        get; set;
    }
    public int Height
    {
        get; set;
    }
    public int BinX
    {
        get; set;
    }
    public int BinY
    {
        get; set;
    }
    public int StartX
    {
        get; set;
    }
    public int StartY
    {
        get; set;
    }
    public string Color { get; set; } = "mono";
    public long CapturedAt
    {
        get; set;
    }
    public string CapturedAtSource { get; set; } = "server-estimate";
    public long Bytes
    {
        get; set;
    }
    public string Sha256 { get; set; } = "";
}

// Written durably beside a flushed partial before it is renamed, so a completed
// original always has worker provenance even if the RPC reply is lost.
public sealed class CompletionRecord
{
    public int Version { get; set; } = 1;
    public string OperationId { get; set; } = "";
    public string BindingId { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public CapturedImage Image { get; set; } = new CapturedImage();
    public long WrittenAt
    {
        get; set;
    }
}

// Shared typed contract: library framing, correlation and errors are StreamJsonRpc's responsibility.
// Pixels are published as local files, never returned through this contract.
public interface IDriverRpc
{
    Task<WorkerSnapshot> InitializeAsync();
    Task<WorkerSnapshot> ObserveAsync(long generation, bool metadata);
    Task<WorkerResult> ExecuteAsync(ExecuteRequest request);
    Task<OperationProgress?> ProgressAsync();
    Task<bool> CancelAsync(string operationId);
    Task<bool> CloseAsync();
    Task<JObject> FixtureAsync(string fault);
}

public static class Fields
{
    public static readonly Dictionary<string, string> Camera = Map("state:camerastate imageReady:imageready temperatureC:ccdtemperature coolerOn:cooleron setpointC:setccdtemperature coolerPowerPercent:coolerpower");
    public static readonly Dictionary<string, string> CameraMetadata = Map("sensorWidthPixels:cameraxsize sensorHeightPixels:cameraysize pixelWidthMicrons:pixelsizex pixelHeightMicrons:pixelsizey width:numx height:numy binX:binx binY:biny startX:startx startY:starty sensorType:sensortype bayerOffsetX:bayeroffsetx bayerOffsetY:bayeroffsety canAbortExposure:canabortexposure canStopExposure:canstopexposure canSetTemperature:cansetccdtemperature canGetCoolerPower:cangetcoolerpower exposureMinimum:exposuremin exposureMaximum:exposuremax exposureResolution:exposureresolution maxBinX:maxbinx maxBinY:maxbiny canAsymmetricBin:canasymmetricbin gain:gain gainMinimum:gainmin gainMaximum:gainmax gains:gains offset:offset offsetMinimum:offsetmin offsetMaximum:offsetmax offsets:offsets");
    public static readonly Dictionary<string, string> Mount = Map("rightAscensionHours:rightascension declinationDegrees:declination slewing:slewing tracking:tracking parked:atpark atHome:athome siderealTimeHours:siderealtime trackingRate:trackingrate rightAscensionRateSecondsPerSiderealSecond:rightascensionrate declinationRateArcsecondsPerSecond:declinationrate pierSide:sideofpier");
    public static readonly Dictionary<string, string> MountMetadata = Map("coordinateSystem:equatorialsystem latitudeDegrees:sitelatitude longitudeDegrees:sitelongitude elevationMeters:siteelevation canSlew:canSlewAsync canSetTracking:cansettracking canFindHome:canfindhome canPark:canpark canUnpark:canunpark canMovePrimaryAxis:canmoveaxis primaryAxisRates:axisrates");
    public static readonly Dictionary<string, string> Focuser = Map("position:position moving:ismoving temperatureC:temperature");
    public static readonly Dictionary<string, string> FocuserMetadata = Map("absolute:absolute maxStep:maxstep maxIncrement:maxincrement stepSizeMicrons:stepsize temperatureCompensation:tempcomp canTemperatureCompensate:tempcompavailable");
    public static readonly Dictionary<string, string> Weather = Map("temperatureC:temperature humidityPercent:humidity dewPointC:dewpoint pressureHpa:pressure cloudCoverPercent:cloudcover rainRateMmPerHour:rainrate skyBrightness:skybrightness skyQuality:skyquality skyTemperatureC:skytemperature starFwhm:starfwhm windDirectionDegrees:winddirection windGustMps:windgust windSpeedMps:windspeed");
    public static readonly Dictionary<string, string> Switch = Map("channelCount:maxswitch");
    public static readonly Dictionary<string, string> SwitchChannel = Map("name:getswitchname description:getswitchdescription writable:canwrite minimum:minswitchvalue maximum:maxswitchvalue step:switchstep on:getswitch value:getswitchvalue");
    public static Dictionary<string, string> Dynamic(string kind) => kind == "camera" ? Camera : kind == "mount" ? Mount : kind == "focuser" ? Focuser : kind == "weather" ? Weather : Switch;
    public static Dictionary<string, string> Metadata(string kind) => kind == "camera" ? CameraMetadata : kind == "mount" ? MountMetadata : kind == "focuser" ? FocuserMetadata : new Dictionary<string, string>();
    private static Dictionary<string, string> Map(string values) => values.Split(' ').ToDictionary(x => x.Split(':')[0], x => x.Split(':')[1].ToLowerInvariant());
}
