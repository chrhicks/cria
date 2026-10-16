using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Cria.Contracts;

namespace Cria.Driver.Windows;

internal sealed class StaOwner : OwnerBase
{
    private readonly WorkerConfiguration config;
    private readonly TaskCompletionSource<Control> ready = new TaskCompletionSource<Control>(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<bool> exited = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly FileStream lease;
    private readonly string marker;
    private IDevice? device;
    public StaOwner(WorkerConfiguration config)
    {
        this.config = config;
        var globals = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cria", "driver-ownership");
        Directory.CreateDirectory(globals);
        using (var hash = SHA256.Create())
            marker = Path.Combine(globals, BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(config.Binding.ProgId.ToUpperInvariant()))).Replace("-", "") + ".ownership.json");
        lease = new FileStream(marker, FileMode.CreateNew, FileAccess.Write, FileShare.Read);
        var process = Process.GetCurrentProcess();
        var bytes = Encoding.UTF8.GetBytes(Wire.Encode(new
        {
            pid = process.Id,
            startTimeUtc = process.StartTime.ToUniversalTime(),
            progId = config.Binding.ProgId,
            bindingId = config.BindingId,
            dataDirectory = config.DataDirectory,
            startedAt = Wire.Now
        }));
        lease.Write(bytes, 0, bytes.Length);
        lease.Flush(true);
        var thread = new Thread(() =>
        {
            try
            {
                using (var control = new Control())
                {
                    _ = control.Handle;
                    ready.TrySetResult(control);
                    Application.Run();
                }
            }
            catch (Exception e) { Quarantine(e.Message); ready.TrySetException(e); }
            finally { exited.TrySetResult(true); }
        })
        {
            IsBackground = false,
            Name = "Cria ASCOM STA " + config.Binding.Id
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
    }
    protected override IDevice Device => device ?? (device = new ToolkitDevice(config.Binding, config.MaxPixels));
    protected override void Enqueue(Action action)
    {
        var control = ready.Task.GetAwaiter().GetResult();
        control.BeginInvoke(action);
    }
    public override async Task<bool> Close(int timeoutMs)
    {
        if (Blocked)
        {
            Console.Error.WriteLine("Driver release refused: " + Reason);
            return false;
        }
        try
        {
            bool idle = await Call(d =>
            {
                Console.Error.WriteLine("Driver release: checking idle state");
                if (!d.IsIdle)
                {
                    Console.Error.WriteLine("Driver release: equipment is not idle");
                    return false;
                }
                if (Convert.ToBoolean(d.Read("connected")))
                {
                    Console.Error.WriteLine("Driver release: disconnecting client");
                    d.Write("connected", false);
                }
                // Connected is shared hardware state, not this client's lease. ASCOM
                // explicitly allows it to remain true after a successful synchronous
                // disconnect when another client uses the server. Release our wrapper
                // and owner thread; never disconnect or terminate that other client.
                Console.Error.WriteLine("Driver release: disposing driver");
                d.Dispose();
                device = null;
                Console.Error.WriteLine("Driver release: ending owner thread");
                Application.ExitThread();
                return true;
            }, timeoutMs, true);
            if (!idle || await Task.WhenAny(exited.Task, Task.Delay(timeoutMs)) != exited.Task)
            {
                Quarantine("Could not confirm driver release");
                Console.Error.WriteLine("Driver release unconfirmed: " + Reason);
                return false;
            }
            lease.Dispose();
            File.Delete(marker);
            Console.Error.WriteLine("Driver release confirmed");
            return true;
        }
        catch (Exception e) { Quarantine("Shutdown failed: " + e.Message); Console.Error.WriteLine(Reason); return false; }
    }
}
