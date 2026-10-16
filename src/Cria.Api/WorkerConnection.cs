using System.Diagnostics;
using System.IO.Pipes;
using Cria.Contracts;
using Newtonsoft.Json.Linq;
using StreamJsonRpc;

namespace Cria.Api;

// One binding per worker keeps native driver DLLs out of the HTTP process.
// FailureDomain joins bindings which share an underlying vendor EXE or transport.
internal sealed class WorkerConnection : IDisposable
{
    private readonly Configuration config;
    private readonly DeviceState state;
    private readonly Action<string> failed;
    private readonly Action<string> log;
    private Process? process;
    private JsonRpc? rpc;
    private IDriverRpc? proxy;
    private volatile bool closed, blocked;
    private int failures;
    public int? Pid => process?.Id;
    public bool IsAlive => process is not null && !process.HasExited;
    public string DirectoryPath
    {
        get;
    }
    public WorkerConnection(Configuration config, DeviceState state, Action<string> failed, Action<string> log)
    {
        this.config = config;
        this.state = state;
        this.failed = failed;
        this.log = log;
        DirectoryPath = Path.Combine(config.DataDirectory, "workers", state.BindingId);
    }
    public async Task<WorkerSnapshot> Start()
    {
        Directory.CreateDirectory(DirectoryPath);
        Directory.CreateDirectory(Path.Combine(DirectoryPath, "pending"));
        string pipeName = "cria-" + Guid.NewGuid().ToString("N");
        var worker = new WorkerConfiguration
        {
            Binding = state.Binding,
            BindingId = state.BindingId,
            DataDirectory = DirectoryPath,
            Fixture = config.Fixture,
            OwnershipConfirmed = config.OwnershipConfirmed,
            CallTimeoutMs = config.CallTimeoutMs,
            InitializeTimeoutMs = config.InitializeTimeoutMs,
            ImageTimeoutMs = config.ImageTimeoutMs,
            OperationTimeoutMs = config.OperationTimeoutMs,
            MaxPixels = config.MaxPixels
        };
        var path = Path.Combine(DirectoryPath, "worker.json");
        Durable.Json(path, worker);
        var start = new ProcessStartInfo(config.WorkerExecutable)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Path.GetDirectoryName(config.WorkerExecutable)!,
            // Driver SetupDialog still has its own GUI. Do not inherit a console's Ctrl+C broadcast.
            CreateNoWindow = true
        };
        start.Environment.Remove("CRIA_TOKEN");
        foreach (var arg in config.WorkerArguments)
            start.ArgumentList.Add(arg);
        start.ArgumentList.Add(path);
        start.ArgumentList.Add(pipeName);
        process = new Process { StartInfo = start, EnableRaisingEvents = true };
        process.Exited += (_, _) => { if (!closed) Failure("Driver worker exited; equipment outcome must be reconciled"); };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) log(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) log(e.Data); };
        if (!process.Start())
            throw new IOException("Could not start driver worker");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        Durable.Json(Path.Combine(DirectoryPath, "process.json"), new
        {
            pid = process.Id,
            startTimeUtc = process.StartTime.ToUniversalTime(),
            pipeName,
            bindingId = state.BindingId,
            deviceId = state.Binding.Id,
            progId = state.Binding.ProgId
        });
        var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        try
        {
            await pipe.ConnectAsync(15000);
            rpc = new JsonRpc(pipe);
            proxy = rpc.Attach<IDriverRpc>();
            rpc.Disconnected += (_, _) => { if (!closed) Failure("Driver RPC connection lost; no automatic reconnect or command replay"); };
            rpc.StartListening();
            var result = await Guard(proxy.InitializeAsync(), state.Binding.SetupBeforeConnect ? 310000 : config.InitializeTimeoutMs + 5000);
            if (result.Blocked)
                Failure(result.Reason ?? "Driver initialization failed");
            return result;
        }
        catch (Exception e) { pipe.Dispose(); Failure("Worker startup failed: " + e.Message); throw; }
    }
    private void Failure(string reason)
    {
        blocked = true;
        if (Interlocked.Increment(ref failures) == 1)
            failed(reason);
    }
    private async Task<T> Guard<T>(Task<T> task, int timeout)
    {
        try
        {
            return await task.WaitAsync(TimeSpan.FromMilliseconds(timeout));
        }
        catch (Exception e)
        {
            Failure("Driver RPC failed: " + e.Message);
            _ = task.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
            throw new ApiError(503, "Driver owner unavailable; pending work is not replayed", "driver-unavailable");
        }
    }
    private IDriverRpc Proxy => !blocked && proxy is not null ? proxy : throw new ApiError(503, "Driver owner unavailable", "driver-unavailable");
    public async Task<WorkerSnapshot> Observe(long generation, bool metadata)
    {
        // Bounded field sweep may legitimately take several driver-call deadlines.
        var result = await Guard(Proxy.ObserveAsync(generation, metadata), Math.Min(300000, config.CallTimeoutMs * 80 + 1000));
        if (result.Blocked)
            Failure(result.Reason ?? "Driver owner quarantined");
        return result;
    }
    public async Task<WorkerResult> Execute(ExecuteRequest request)
    {
        double exposure = request.Request.Kind == "capture" ? (double)request.Request.Parameters["exposureSeconds"]! : 0;
        var result = await Guard(Proxy.ExecuteAsync(request), (int)(exposure * 1000) + config.OperationTimeoutMs + config.ImageTimeoutMs + 30000);
        if (result.Status == "uncertain")
            Failure(result.Message ?? "Operation uncertain");
        return result;
    }
    public Task<OperationProgress?> Progress() => Guard(Proxy.ProgressAsync(), Math.Max(1000, config.CallTimeoutMs));
    public Task<bool> Cancel(string id) => Guard(Proxy.CancelAsync(id), Math.Max(1000, config.CallTimeoutMs));
    public Task<JObject> Fixture(string fault) => Guard(Proxy.FixtureAsync(fault), Math.Max(1000, config.CallTimeoutMs));
    public async Task<bool> Close()
    {
        if (proxy is null)
            return process is null;
        try
        {
            // A normal close is attempted even when the API has marked the connection blocked.
            // The worker itself decides whether same-owner release is established.
            bool safe = await proxy.CloseAsync().WaitAsync(TimeSpan.FromMilliseconds(config.OperationTimeoutMs + config.CallTimeoutMs + 1000));
            if (!safe)
                return false;
            closed = true;
            if (process is not null)
                await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            return true;
        }
        catch (Exception e) { log("Worker retained after unconfirmed shutdown: " + e.Message); return false; }
    }
    public void Dispose()
    {
        closed = true;
        rpc?.Dispose();
        process?.Dispose();
    }
}
