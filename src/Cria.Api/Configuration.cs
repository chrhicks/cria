using System.Text.RegularExpressions;
using Cria.Contracts;

namespace Cria.Api;

internal sealed class Configuration
{
    public int Version { get; set; } = 2;
    public string Listen { get; set; } = "http://127.0.0.1:4319";
    public string? PublicOrigin
    {
        get; set;
    }
    public string DataDirectory { get; set; } = "./data";
    public string WorkerExecutable { get; set; } = "../worker/Cria.Driver.Windows.exe";
    public string[] WorkerArguments { get; set; } = [];
    public bool Fixture
    {
        get; set;
    }
    public bool OwnershipConfirmed
    {
        get; set;
    }
    public bool CommandsEnabled
    {
        get; set;
    }
    public Binding[] Devices { get; set; } = [];
    public int PollMs { get; set; } = 1000;
    public int MetadataMs { get; set; } = 30000;
    public int CallTimeoutMs { get; set; } = 5000;
    /// <summary>How long a device without a setup dialog may take to connect and report its identity at start; a cold driver can need far longer than one steady-state call.</summary>
    public int InitializeTimeoutMs { get; set; } = 120000;
    public int ImageTimeoutMs { get; set; } = 120000;
    public int OperationTimeoutMs { get; set; } = 180000;
    public int MaxPixels { get; set; } = 40000000;
    public int ConcurrentCaptures { get; set; } = 1;
    /// <summary>Completed images kept for Vela to fetch: the newest are kept and the oldest dropped beyond this size.</summary>
    public long ImageBudgetBytes { get; set; } = 10L * 1024 * 1024 * 1024;
    public int MaxDownloads { get; set; } = 4;
    public int DownloadTimeoutSeconds { get; set; } = 600;
    public int MaxRequests { get; set; } = 1000000;
    /// <summary>Finished operations whose full details are kept; older ones shrink to a marker.</summary>
    public int RetainedOperations { get; set; } = 1000;
    public int TelemetryQueue { get; set; } = 4096;
    public int TelemetryRows { get; set; } = 1000000;
    public long TelemetryPayloadBytes { get; set; } = 256L * 1024 * 1024;
    public int TelemetryRetentionSeconds { get; set; } = 21600;
    public static Configuration Load(string path)
    {
        try
        {
            return Validate(path);
        }
        catch (Exception e) when (e is InvalidDataException or IOException or UnauthorizedAccessException or Newtonsoft.Json.JsonException)
        {
            throw new StartupRefused("Configuration refused: " + e.Message);
        }
    }
    private static Configuration Validate(string path)
    {
        path = Path.GetFullPath(path);
        var c = Wire.Decode<Configuration>(File.ReadAllText(path)) ?? throw new InvalidDataException("Configuration file is empty");
        // JSON null replaces defaults; reject it here rather than failing later on a null reference.
        if (c.Devices == null || c.Devices.Any(b => b == null || b.Id == null || b.Kind == null || b.ProgId == null || b.ExpectedName == null))
            throw new InvalidDataException("Device bindings must be present with id, kind, progId and expectedName");
        if (c.Listen == null || c.DataDirectory == null || c.WorkerExecutable == null || c.WorkerArguments == null || c.WorkerArguments.Any(a => a == null))
            throw new InvalidDataException("listen, dataDirectory, workerExecutable and workerArguments must not be null");
        foreach (var b in c.Devices)
            b.FailureDomain ??= "";
        if (c.Version != 2 || c.Devices.Length is < 1 or > 16 || !c.OwnershipConfirmed)
            throw new InvalidDataException("Version 2, explicit ownership acknowledgement and 1–16 bindings required");
        if (!Uri.TryCreate(c.Listen, UriKind.Absolute, out var u) || u.Scheme != "http" || u.AbsolutePath != "/" || u.UserInfo.Length > 0 || u.Query.Length > 0 || u.Fragment.Length > 0)
            throw new InvalidDataException("Explicit HTTP listen origin required");
        if (c.PublicOrigin != null && (!Uri.TryCreate(c.PublicOrigin, UriKind.Absolute, out var o) || o.Scheme is not ("http" or "https") || o.GetLeftPart(UriPartial.Authority) != c.PublicOrigin))
            throw new InvalidDataException("Invalid public origin");
        if (c.Fixture && !u.IsLoopback)
            throw new InvalidDataException("Fixture API must bind loopback");
        if (c.PollMs is < 20 or > 60000 || c.MetadataMs < c.PollMs || c.MetadataMs > 3600000 || c.CallTimeoutMs is < 50 or > 30000 || c.InitializeTimeoutMs is < 1000 or > 300000 || c.ImageTimeoutMs is < 100 or > 300000 || c.OperationTimeoutMs is < 500 or > 300000 ||
            c.MaxPixels is < 1 or > 100000000 || c.ConcurrentCaptures is < 1 or > 4 || c.ImageBudgetBytes is < 1024 or > 100L * 1024 * 1024 * 1024 ||
            c.MaxDownloads is < 1 or > 16 || c.DownloadTimeoutSeconds is < 1 or > 3600 || c.MaxRequests is < 1 or > 1000000 || c.RetainedOperations is < 1 or > 10000 ||
            c.TelemetryQueue is < 16 or > 8192 || c.TelemetryRows is < 16 or > 2000000 || c.TelemetryPayloadBytes is < 4096 or > 2L * 1024 * 1024 * 1024 || c.TelemetryRetentionSeconds < 1)
            throw new InvalidDataException("Configuration limit outside supported bounds");
        var ids = new HashSet<string>();
        var programs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var b in c.Devices)
        {
            if (!Regex.IsMatch(b.Id, "^[a-zA-Z0-9_-]{1,64}$") || !ids.Add(b.Id) || !programs.Add(b.ProgId) || b.ExpectedName.Length is < 1 or > 256 || !new[] { "camera", "mount", "focuser", "weather", "switch" }.Contains(b.Kind))
                throw new InvalidDataException("Invalid or duplicate device binding");
            if (c.Fixture != b.ProgId.StartsWith("Cria.Fixture.", StringComparison.Ordinal) || !c.Fixture && !b.ProgId.StartsWith("ASCOM.", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Fixture and real ASCOM bindings cannot mix");
            if (b.FailureDomain.Length == 0)
                b.FailureDomain = b.Id;
            if (!Regex.IsMatch(b.FailureDomain, "^[a-zA-Z0-9_-]{1,64}$"))
                throw new InvalidDataException("Invalid failure domain");
            if (c.Fixture && (!b.ExpectedName.StartsWith("FIXTURE", StringComparison.Ordinal) || (long)b.FixtureWidth * b.FixtureHeight > c.MaxPixels || b.FixtureWidth < 1 || b.FixtureHeight < 1))
                throw new InvalidDataException("Invalid fixture geometry or identity");
        }
        var root = Path.GetDirectoryName(path)!;
        c.DataDirectory = Path.GetFullPath(c.DataDirectory, root);
        c.WorkerExecutable = Path.GetFullPath(c.WorkerExecutable, root);
        for (int i = 0; i < c.WorkerArguments.Length; i++)
            if (c.WorkerArguments[i].EndsWith(".dll", StringComparison.Ordinal))
                c.WorkerArguments[i] = Path.GetFullPath(c.WorkerArguments[i], root);
        return c;
    }
}

internal sealed class ApiError(int status, string message, string code = "request-rejected") : Exception(message)
{
    public int Status { get; } = status; public string Code { get; } = code;
}

/// <summary>
/// An expected reason not to start: unusable configuration, a data directory in use, or a store
/// this binary must not open. Startup reports it and exits with code 3 instead of aborting.
/// Only conditions checked before anything is changed are reported this way; other faults still crash.
/// </summary>
internal sealed class StartupRefused(string message) : Exception(message)
{
    public const int ExitCode = 3;
}

internal sealed class DataLease : IDisposable
{
    private readonly FileStream file;
    public DataLease(string directory)
    {
        Directory.CreateDirectory(directory);
        try
        {
            file = new FileStream(Path.Combine(directory, "service.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
        }
        catch (IOException e)
        {
            throw new StartupRefused("Data directory is in use by another Cria process: " + e.Message);
        }
    }
    public void Dispose() => file.Dispose();
}

internal static class Durable
{
    public static void Json(string path, object value)
    {
        var temporary = path + ".new";
        using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var bytes = System.Text.Encoding.UTF8.GetBytes(Wire.Encode(value));
            file.Write(bytes);
            file.Flush(true);
        }
        File.Move(temporary, path, true);
    }
}
