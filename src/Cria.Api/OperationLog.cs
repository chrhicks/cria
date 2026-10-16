using System.Security.Cryptography;
using System.Text;
using Cria.Contracts;
using Newtonsoft.Json.Linq;

namespace Cria.Api;

// Operations as this service instance has seen them, in memory. Nothing survives a restart: a new
// instance starts empty, and Vela treats a changed instanceId as "everything in flight before it is
// unknown". Within one instance every request is remembered so it can never run twice: the full
// details of the newest settled operations are kept (RetainedOperations), older ones shrink to a
// small marker that still answers "this request was already accepted" (410).
internal sealed class OperationLog
{
    private readonly object gate = new();
    private readonly Configuration config;
    private readonly List<Entry> entries = [];
    private readonly Dictionary<string, Entry> byId = new();
    private readonly Dictionary<(string Instance, string Request), Entry> byRequest = new();

    private sealed class Entry(long sequence, string id, string fingerprint, string status, string payload)
    {
        public long Sequence { get; } = sequence;
        public string Id { get; } = id;
        public string Fingerprint { get; } = fingerprint;
        public string Status { get; set; } = status;
        public bool Blocking { get; set; } = true;
        public bool Completed { get; set; }
        // Null once the details have been dropped; the marker remains.
        public string? Payload { get; set; } = payload;
    }

    public OperationLog(Configuration config)
    {
        this.config = config;
    }

    public static string Fingerprint(OperationRequest request)
    {
        static JToken Sorted(JToken t) => t is JObject o ? new JObject(o.Properties().OrderBy(p => p.Name, StringComparer.Ordinal).Select(p => new JProperty(p.Name, Sorted(p.Value)))) : t is JArray a ? new JArray(a.Select(Sorted)) : t.DeepClone();
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Sorted(JObject.FromObject(request)).ToString(Newtonsoft.Json.Formatting.None))));
    }

    /// <summary>The operation already accepted for this request, if any.</summary>
    public Operation? Existing(OperationRequest request)
    {
        lock (gate)
        {
            if (!byRequest.TryGetValue((request.InstanceId, request.RequestId), out var entry))
                return null;

            if (entry.Fingerprint != Fingerprint(request))
                throw new ApiError(409, "Request ID was accepted with different content", "request-conflict");

            if (entry.Payload is null)
                throw new ApiError(410, "Operation details expired; this request will never dispatch again", "result-expired");

            return Wire.Decode<Operation>(entry.Payload);
        }
    }

    /// <summary>Remembers an operation before it is dispatched.</summary>
    public void Accept(OperationRequest request, Operation operation)
    {
        lock (gate)
        {
            if (entries.Count >= config.MaxRequests)
                throw new ApiError(503, "Request history reached its configured bound; request was not dispatched", "ledger-full");

            var entry = new Entry(entries.Count + 1, operation.Id, Fingerprint(request), operation.Status, Wire.Encode(operation));

            entries.Add(entry);
            byId[operation.Id] = entry;
            byRequest[(request.InstanceId, request.RequestId)] = entry;
        }
    }

    public void Save(Operation op)
    {
        lock (gate)
        {
            if (!byId.TryGetValue(op.Id, out var entry))
                throw new InvalidDataException("Operation was not accepted");

            entry.Status = op.Status;
            entry.Blocking = op.BlocksDevice;
            entry.Completed = op.CompletedAt is not null;
            entry.Payload = Wire.Encode(op);
        }
    }

    public Operation Get(string id)
    {
        lock (gate)
            return Decode(byId.GetValueOrDefault(id), "Operation details expired; request remains nonreplayable");
    }

    public Operation Request(string instance, string request)
    {
        lock (gate)
            return Decode(byRequest.GetValueOrDefault((instance, request)), "Operation details expired; request remains nonreplayable");
    }

    private static Operation Decode(Entry? entry, string expired)
    {
        if (entry is null)
            throw new ApiError(404, "Unknown operation/request", "not-found");

        if (entry.Payload is null)
            throw new ApiError(410, expired, "result-expired");

        return Wire.Decode<Operation>(entry.Payload);
    }

    /// <summary>Operations that still hold their device: unfinished, or finished uncertain until recovery.</summary>
    public List<Operation> Blocking()
    {
        lock (gate)
            return entries.Where(e => e.Blocking).Select(e => Wire.Decode<Operation>(e.Payload!)).ToList();
    }

    /// <summary>The newest operations that no longer hold their device, newest first.</summary>
    public List<Operation> Recent(int limit = 20)
    {
        lock (gate)
            return entries.AsEnumerable().Reverse().Where(e => !e.Blocking && e.Payload is not null).Take(limit).Select(e => Wire.Decode<Operation>(e.Payload!)).ToList();
    }

    public object Page(long after, int limit)
    {
        if (after < 0 || limit is < 1 or > 500)
            throw new ApiError(400, "Invalid operation cursor or limit");

        lock (gate)
        {
            var page = entries.Where(e => e.Sequence > after).Take(limit).ToList();

            return new
            {
                operations = page.Select(e => e.Payload is null
                    ? (object)new { id = e.Id, status = e.Status, expired = true }
                    : Wire.Decode<Operation>(e.Payload)).ToList(),
                next = page.Count == 0 ? after : page[^1].Sequence
            };
        }
    }

    /// <summary>Shrinks the oldest finished operations to markers beyond the retained count.</summary>
    public void Prune()
    {
        lock (gate)
        {
            var kept = entries.Where(e => !e.Blocking && e.Completed && e.Payload is not null).ToList();

            foreach (var entry in kept.Take(Math.Max(0, kept.Count - config.RetainedOperations)))
                entry.Payload = null;
        }
    }
}
