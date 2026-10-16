using Cria.Contracts;
using Newtonsoft.Json.Linq;

namespace Cria.Api;

internal sealed class Operation
{
    public string Id { get; set; } = "";
    public string InstanceId { get; set; } = "";
    public string RequestId { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string BindingId { get; set; } = "";
    public string FailureDomain { get; set; } = "";
    public string ExpectedName { get; set; } = "";
    public string Kind { get; set; } = "";
    public JObject Parameters { get; set; } = new();
    public long AcceptedAt
    {
        get; set;
    }
    public long? StartedAt
    {
        get; set;
    }
    public long? CompletedAt
    {
        get; set;
    }
    public string Status { get; set; } = "accepted";
    public string Phase { get; set; } = "preparing";
    public double? ElapsedSeconds { get; set; }
    public bool Acknowledged
    {
        get; set;
    }
    public bool CancelRequested
    {
        get; set;
    }
    public bool BlocksDevice { get; set; } = true;
    public bool Settled
    {
        get; set;
    }
    public string Observation { get; set; } = "current";
    public string? Message
    {
        get; set;
    }
    public JObject Result { get; set; } = new();
    public string? ReservedImageId
    {
        get; set;
    }
    public ImageInfo? Image
    {
        get; set;
    }
    public JObject? Reconciliation
    {
        get; set;
    }
    [Newtonsoft.Json.JsonIgnore] public bool Terminal => Status is "succeeded" or "failed" or "cancelled" or "uncertain";
}

internal sealed class ImageInfo
{
    public string Id { get; set; } = "";
    public string OperationId { get; set; } = "";
    public string InstanceId { get; set; } = "";
    public string DeviceId { get; set; } = "";
    public string CameraName { get; set; } = "";
    public string BindingId { get; set; } = "";
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
    public double ExposureSeconds
    {
        get; set;
    }
    public string Color { get; set; } = "mono";
    public long CapturedAt
    {
        get; set;
    }
    public string CapturedAtSource { get; set; } = "server-estimate";
    public long RetainedAt
    {
        get; set;
    }
    // Protocol 2 operation history recorded an expiry. Custody no longer expires originals,
    // so the historical value is accepted when decoding and never served again.
    [Newtonsoft.Json.JsonProperty("expiresAt")]
    private long? LegacyExpiresAt
    {
        get => null; set
        {
        }
    }
    public bool ShouldSerializeLegacyExpiresAt() => false;
    public string Sha256 { get; set; } = "";
    public OriginalInfo Original { get; set; } = new();
    public object? Preview => null;
}
internal sealed class OriginalInfo
{
    public string MediaType { get; set; } = "application/imagebytes"; public long Bytes
    {
        get; set;
    }
    public string Url { get; set; } = "";
}

internal sealed class DeviceState(Binding binding)
{
    public Binding Binding { get; } = binding;
    public string BindingId { get; set; } = Guid.NewGuid().ToString();
    public long Generation = 1;
    public bool Dirty = true, Blocked = true;
    public string? Reason = "Driver starting";
    public string Health = "starting";
    public long MetadataAt;
    public Dictionary<string, Reading> Fields { get; } = new();
    public List<Dictionary<string, Reading>> Channels { get; set; } = [];
    public WorkerConnection? Worker;
    public Task? Polling;
}
