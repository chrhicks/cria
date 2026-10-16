namespace Cria.Driver;

public interface IDevice : IDisposable
{
    object? Read(string member, int channel = 0);
    void Write(string member, object value, int channel = 0);
    void Command(string member, params object[] arguments);
    byte[] Image();
    bool IsIdle
    {
        get;
    }
    void Setup();
}

public interface IOwner
{
    bool Blocked
    {
        get;
    }
    string? Reason
    {
        get;
    }
    void Quarantine(string reason);
    Task<T> Call<T>(Func<IDevice, T> action, int timeoutMs, bool write = false);
    Task<bool> Close(int timeoutMs);
}

public sealed class OwnerUnavailable : IOException
{
    public OwnerUnavailable(string message) : base(message) { }
}
public sealed class Unsupported : Exception
{
    public Unsupported(string message) : base(message) { }
}

// A FIFO owner has at most one admitted call. Deadline expiry never frees admission.
public abstract class OwnerBase : IOwner
{
    private readonly object gate = new object();
    private bool busy, blocked;
    public bool Blocked
    {
        get
        {
            lock (gate)
                return blocked;
        }
    }
    public string? Reason
    {
        get; private set;
    }
    public void Quarantine(string reason)
    {
        lock (gate)
        {
            blocked = true;
            Reason = reason;
        }
    }
    protected abstract void Enqueue(Action action);
    protected abstract IDevice Device
    {
        get;
    }
    public async Task<T> Call<T>(Func<IDevice, T> action, int timeoutMs, bool write = false)
    {
        lock (gate)
        {
            if (blocked)
                throw new OwnerUnavailable(Reason!);
            if (busy)
                throw new InvalidOperationException("Driver owner busy");
            busy = true;
        }
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            Enqueue(() => { try { done.TrySetResult(action(Device)); } catch (Exception e) { if (write) Quarantine("Driver write failed; outcome not established: " + e.Message); done.TrySetException(e); } });
        }
        catch { lock (gate) busy = false; throw; }
        if (await Task.WhenAny(done.Task, Task.Delay(timeoutMs)) != done.Task)
        {
            Quarantine("Driver deadline exceeded; underlying work may still be running");
            _ = done.Task.ContinueWith(t => { var _ = t.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            throw new OwnerUnavailable(Reason!);
        }
        try
        {
            return await done.Task;
        }
        finally { lock (gate) busy = false; }
    }
    public abstract Task<bool> Close(int timeoutMs);
}
