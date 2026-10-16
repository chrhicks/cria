using System.Security.Cryptography;
using System.Text;
using Cria.Api;
using Cria.Contracts;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

// Expected refusals exit with code 3 and a message rather than an unhandled-exception abort,
// so they are not reported as process crashes. Any other fault still crashes visibly.
static void Refuse(StartupRefused refused)
{
    Console.Error.WriteLine("Cria refused to start: " + refused.Message);
    Environment.ExitCode = StartupRefused.ExitCode;
}
Configuration config;
string token;
DataLease dataLease;
try
{
    if (args.Length != 1)
        throw new StartupRefused("Usage: Cria.Api CONFIG.json (optional CRIA_TOKEN environment variable)");
    config = Configuration.Load(args[0]);
    // No CRIA_TOKEN means no bearer check: for a private network where the listen address is the access control.
    token = Environment.GetEnvironmentVariable("CRIA_TOKEN") ?? "";
    if (token.Length > 0 && (token.Length < 32 || token.Any(char.IsControl)))
        throw new StartupRefused("CRIA_TOKEN must contain at least 32 characters and no control characters");
    dataLease = new DataLease(config.DataDirectory);
}
catch (StartupRefused refused)
{
    Refuse(refused);
    return;
}
var tokenHash = SHA256.HashData(Encoding.UTF8.GetBytes("Bearer " + token));
using var lease = dataLease;
var builder = WebApplication.CreateSlimBuilder();
var listenUri = new Uri(config.Listen);
// A specific rig-network address stays specific. Add loopback for the local
// supervisor without exposing the API on any other network interface.
if (System.Net.IPAddress.TryParse(listenUri.Host.Trim('[', ']'), out var listenAddress) &&
    !System.Net.IPAddress.IsLoopback(listenAddress) && !listenAddress.Equals(System.Net.IPAddress.Any) && !listenAddress.Equals(System.Net.IPAddress.IPv6Any))
    builder.WebHost.UseUrls(config.Listen, "http://127.0.0.1:" + listenUri.Port);
else
    builder.WebHost.UseUrls(config.Listen);
builder.WebHost.ConfigureKestrel(o => { o.Limits.MaxRequestBodySize = 16384; o.Limits.MaxConcurrentConnections = 128; o.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10); });
builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(600));
var app = builder.Build();
OperationLog? journal = null;
RecentImages? images = null;
Rig? rig = null;
Telemetry? telemetry = null;
static IResult Json(object value, int status = 200) => Results.Content(Wire.Encode(value), "application/json", Encoding.UTF8, status);
static async Task<T> Body<T>(HttpContext context)
{
    if (!context.Request.HasJsonContentType())
        throw new ApiError(415, "application/json required");
    using var reader = new StreamReader(context.Request.Body, Encoding.UTF8, false, 4096, true);
    return Wire.Decode<T>(await reader.ReadToEndAsync(context.RequestAborted)) ?? throw new ApiError(400, "JSON object required");
}
static int Int(HttpContext c, string key, int fallback) => c.Request.Query[key].Count == 0 ? fallback : int.TryParse(c.Request.Query[key], out var value) ? value : throw new ApiError(400, "Invalid " + key);
static long Long(HttpContext c, string key, long fallback) => c.Request.Query[key].Count == 0 ? fallback : long.TryParse(c.Request.Query[key], out var value) ? value : throw new ApiError(400, "Invalid " + key);
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    try
    {
        if (context.Request.Path != "/health")
        {
            if (token.Length > 0)
            {
                string supplied = context.Request.Headers.Authorization.ToString();
                if (supplied.Length > 2048 || !CryptographicOperations.FixedTimeEquals(tokenHash, SHA256.HashData(Encoding.UTF8.GetBytes(supplied))))
                    throw new ApiError(401, "Bearer token required", "unauthorized");
            }
            string origin = context.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && origin != config.PublicOrigin && origin != config.Listen)
                throw new ApiError(403, "Origin is not allowed", "origin-rejected");
            if (rig == null)
                throw new ApiError(503, "Service initializing", "starting");
        }
        await next(context);
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested || app.Lifetime.ApplicationStopping.IsCancellationRequested) { }
    catch (Exception e)
    {
        if (context.Response.HasStarted)
        {
            context.Abort();
            return;
        }
                int status = e is ApiError a ? a.Status : e is JsonException or ArgumentException ? 400 : e is BadHttpRequestException bad ? bad.StatusCode : 500;
        if (status == 500)
            Console.Error.WriteLine(e);
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/json";
        string message = status == 500 ? "Internal service error" : token.Length > 0 ? e.Message.Replace(token, "[redacted]") : e.Message;
        await context.Response.WriteAsync(Wire.Encode(new
        {
            error = new
            {
                code = e is ApiError err ? err.Code : "request-error",
                message
            },
            instanceId = rig?.InstanceId
        }));
    }
});
app.MapGet("/health", () => Json(new { status = rig == null ? "starting" : "online", protocolVersion = Wire.Version }));
app.MapGet("/v2/state", () => Json(rig!.State()));
app.MapGet("/v2/service", () => Json(rig!.ServiceStatus()));
app.MapPost("/v2/service/stop", async (HttpContext c) =>
{
    if (c.Connection.RemoteIpAddress is not { } address || !System.Net.IPAddress.IsLoopback(address))
        throw new ApiError(403, "Service stop is available only on this computer", "local-only");
    var request = await Body<JObject>(c);
    if (request.Count != 1 || request["instanceId"]?.Type != JTokenType.String)
        throw new ApiError(400, "Only instanceId is required");
    rig!.RequestStop((string)request["instanceId"]!);
    // Schedule independently of the response: a disconnected caller cannot undo an accepted stop.
    _ = Task.Run(async () => { await Task.Delay(200); app.Lifetime.StopApplication(); });
    return Json(new { instanceId = rig.InstanceId, stopping = true }, 202);
});
app.MapGet("/v2/events", (HttpContext c) => rig!.Stream(c, app.Lifetime.ApplicationStopping));
app.MapGet("/v2/schema", () => Json(ApiSchema.Document));
app.MapPost("/v2/devices/{id}/refresh", (string id) => Json(rig!.Refresh(id), 202));
app.MapPost("/v2/devices/{id}/recover", async (string id, HttpContext c) => Json(await rig!.Recover(id, await Body<JObject>(c))));
app.MapPost("/v2/operations", (Delegate)(async (HttpContext c) => Json(rig!.Submit(await Body<OperationRequest>(c)), 202)));
app.MapGet("/v2/operations", (HttpContext c) => Json(journal!.Page(Long(c, "after", 0), Int(c, "limit", 100))));
app.MapGet("/v2/operations/{id}", (string id) => Json(rig!.GetOperation(id)));
app.MapGet("/v2/requests/{instance}/{request}", (string instance, string request) => Json(journal!.Request(instance, request)));
app.MapPost("/v2/operations/{id}/cancel", async (string id) => Json(await rig!.Cancel(id), 202));
app.MapGet("/v2/images/{id}/original", (string id, HttpContext c) => images!.Download(id, c));
app.MapGet("/v2/telemetry/status", async () => Json(await telemetry!.Status()));
static void TelemetryQuery(HttpContext c)
{
    foreach (var p in c.Request.Query)
        if (p.Value.Count != 1 || !new[] { "after", "through", "limit", "type", "device", "since", "until" }.Contains(p.Key))
            throw new ApiError(400, "Unknown or repeated telemetry filter: " + p.Key);
}
app.MapGet("/v2/telemetry/events", (Delegate)(async (HttpContext c) => { TelemetryQuery(c); return Json(await telemetry!.Events(c.Request.Query["after"].FirstOrDefault(), c.Request.Query["through"].FirstOrDefault(), Int(c, "limit", 100), c.Request.Query["type"].FirstOrDefault(), c.Request.Query["device"].FirstOrDefault(), c.Request.Query.ContainsKey("since") ? Long(c, "since", 0) : null, c.Request.Query.ContainsKey("until") ? Long(c, "until", 0) : null)); }));
app.MapGet("/v2/telemetry/export", async (HttpContext c) => { TelemetryQuery(c); await telemetry!.Stream(c, false, app.Lifetime.ApplicationStopping); });
app.MapGet("/v2/telemetry/follow", async (HttpContext c) => { TelemetryQuery(c); await telemetry!.Stream(c, true, app.Lifetime.ApplicationStopping); });
if (config.Fixture) app.MapPost("/v2/fixtures/{id}", async (string id, HttpContext c) => Json(await rig!.Fixture(id, (string?)(await Body<JObject>(c))["fault"] ?? "stats")));
app.MapFallback(() => Json(new { error = new { code = "not-found", message = "Unknown API route" } }, 404));
// Bind HTTP before inspecting durable state or launching any equipment owner.
await app.StartAsync();
try
{
    journal = new OperationLog(config);
    images = new RecentImages(config);
    rig = new Rig(config, journal, images);
    telemetry = new Telemetry(config, rig.InstanceId, token);
    await telemetry.Ready;
    rig.Recorded += (type, device, details) => telemetry.Emit(type, device, details);
    app.Lifetime.ApplicationStopping.Register(rig.BeginShutdown);
    rig.Start();
    await app.WaitForShutdownAsync();
}
catch (StartupRefused refused)
{
    // Raised before durable state was changed and before any driver owner started.
    Refuse(refused);
}
finally
{
    if (rig != null)
        Environment.ExitCode = await rig.Shutdown() ? 0 : 2;
    telemetry?.Dispose();
    await app.DisposeAsync();
}
