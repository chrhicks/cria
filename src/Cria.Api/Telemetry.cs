using System.Collections.Concurrent;
using System.Text;
using Cria.Contracts;
using Newtonsoft.Json.Linq;
using Microsoft.Data.Sqlite;

namespace Cria.Api;

// SQLite is owned by one dedicated thread. The equipment path only attempts a
// bounded enqueue; it never waits for disk. Accounting is part of the transaction.
internal sealed class Telemetry : IDisposable
{
    private sealed record Message(string? Payload, Func<SqliteConnection, object>? Query, TaskCompletionSource<object>? Reply);
    private readonly BlockingCollection<Message> queue;
    private readonly Thread worker;
    private readonly Configuration config;
    private readonly string instanceId, secret;
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private string storeId = "";
    private long sequence, dropped, written;
    private string? writerError, maintenanceError;
    private bool retentionPending;
    // An empty secret (no CRIA_TOKEN) has nothing to hide.
    private string Redact(string text) => secret.Length == 0 ? text : text.Replace(secret, "[redacted]");

    public Telemetry(Configuration config, string instanceId, string secret)
    {
        this.config = config;
        this.instanceId = instanceId;
        this.secret = secret;
        queue = new(config.TelemetryQueue);
        worker = new Thread(Run) { IsBackground = true, Name = "Cria SQLite recorder" };
        worker.Start();
    }
    public Task Ready => ready.Task;
    public void Emit(string type, string deviceId, object details, string severity = "info")
    {
        var next = Interlocked.Increment(ref sequence);
        var payload = Wire.Encode(new
        {
            version = 2,
            eventId = $"{instanceId}:{next}",
            instanceId,
            sequence = next,
            timestamp = Wire.Now,
            type,
            deviceId,
            severity,
            traceId = Guid.NewGuid().ToString(),
            details
        });
        payload = Redact(payload);
        if (Encoding.UTF8.GetByteCount(payload) > 32768)
        {
            Interlocked.Increment(ref dropped);
            return;
        }
        try
        {
            if (!queue.TryAdd(new(payload, null, null)))
                Interlocked.Increment(ref dropped);
        }
        catch (InvalidOperationException) { Interlocked.Increment(ref dropped); }
    }
    public async Task<object> Query(Func<SqliteConnection, object> query)
    {
        if (!ready.Task.IsCompletedSuccessfully)
            throw new ApiError(503, "Telemetry is unavailable");
        var reply = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
        try
        {
            if (!queue.TryAdd(new(null, query, reply)))
                throw new ApiError(503, "Telemetry queue full");
        }
        catch (InvalidOperationException) { throw new ApiError(503, "Telemetry stopped"); }
        // Expired requests are skipped on dequeue; caller timeout cannot stop an
        // already executing SQLite statement. Only bounded built-in queries exist.
        try
        {
            return await reply.Task.WaitAsync(TimeSpan.FromSeconds(5));
        }
        catch (TimeoutException) { reply.TrySetCanceled(); throw new ApiError(503, "Telemetry query deadline exceeded"); }
    }
    private static object? Scalar(SqliteConnection db, string sql)
    {
        using var c = db.CreateCommand();
        c.CommandText = sql;
        return c.ExecuteScalar();
    }
    private static void Exec(SqliteConnection db, string sql)
    {
        using var c = db.CreateCommand();
        c.CommandText = sql;
        c.ExecuteNonQuery();
    }
    private void Run()
    {
        using var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(config.DataDirectory, "telemetry.sqlite"), Pooling = false, DefaultTimeout = 1 }.ToString());
        try
        {
            db.Open();
            Exec(db, $"PRAGMA page_size=4096; PRAGMA auto_vacuum=INCREMENTAL; PRAGMA journal_mode=TRUNCATE; PRAGMA synchronous=FULL; PRAGMA max_page_count={Math.Max(512, config.TelemetryPayloadBytes * 4 / 4096)};");
            Exec(db, """
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,timestamp INTEGER NOT NULL,payload TEXT NOT NULL,bytes INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS events_time ON events(timestamp);
                CREATE INDEX IF NOT EXISTS events_type ON events(json_extract(payload,'$.type'),id);
                CREATE INDEX IF NOT EXISTS events_device ON events(json_extract(payload,'$.deviceId'),id);
                CREATE TABLE IF NOT EXISTS retained_stats(singleton INTEGER PRIMARY KEY CHECK(singleton=1),count INTEGER NOT NULL,bytes INTEGER NOT NULL);
                CREATE TRIGGER IF NOT EXISTS stats_insert AFTER INSERT ON events BEGIN
                  UPDATE retained_stats SET count=count+1,bytes=bytes+NEW.bytes WHERE singleton=1; END;
                CREATE TRIGGER IF NOT EXISTS stats_delete AFTER DELETE ON events BEGIN
                  UPDATE retained_stats SET count=count-1,bytes=bytes-OLD.bytes WHERE singleton=1; END;
                INSERT OR IGNORE INTO metadata VALUES('pruned','0');
                """);
            // Rebuild only for a new/migrated accounting table, never each append.
            if (Scalar(db, "SELECT 1 FROM retained_stats WHERE singleton=1") is null)
                Exec(db, "INSERT INTO retained_stats SELECT 1,COUNT(*),COALESCE(SUM(bytes),0) FROM events");
            if (Scalar(db, "SELECT value FROM metadata WHERE key='storeId'") is null)
                Exec(db, $"INSERT INTO metadata VALUES('storeId','{Guid.NewGuid()}')");
            storeId = (string)Scalar(db, "SELECT value FROM metadata WHERE key='storeId'")!;
            ready.SetResult();
            Message? pending = null;
            long nextMaintenance = 0;
            while (pending is not null || !queue.IsCompleted)
            {
                if (Wire.Now >= nextMaintenance)
                {
                    try
                    {
                        Exec(db, "BEGIN IMMEDIATE");
                        retentionPending = Prune(db);
                        Exec(db, "COMMIT");
                        Exec(db, "PRAGMA incremental_vacuum(32)");
                        maintenanceError = null;
                    }
                    catch (Exception error)
                    {
                        try
                        {
                            Exec(db, "ROLLBACK");
                        }
                        catch (SqliteException) { }
                        maintenanceError = Redact(error.Message);
                    }
                    nextMaintenance = Wire.Now + 250;
                }
                var m = pending;
                pending = null;
                if (m is null && !queue.TryTake(out m, 250))
                    continue;
                if (m.Payload is null)
                {
                    if (m.Reply!.Task.IsCanceled)
                        continue;
                    try
                    {
                        m.Reply.TrySetResult(m.Query!(db));
                    }
                    catch (Exception e) { m.Reply.TrySetException(e); }
                    continue;
                }
                var batch = new List<string>(128) { m.Payload };
                while (batch.Count < 128 && queue.TryTake(out var next))
                {
                    if (next.Payload is null)
                    {
                        pending = next;
                        break;
                    }
                    batch.Add(next.Payload);
                }
                try
                {
                    Append(db, batch);
                    Interlocked.Add(ref written, batch.Count);
                    writerError = null;
                }
                catch (Exception error) { writerError = Redact(error.Message); Interlocked.Add(ref dropped, batch.Count); }
            }
        }
        catch (Exception error)
        {
            writerError = Redact(error.Message);
            ready.TrySetException(error);
            queue.CompleteAdding();
            while (queue.TryTake(out var m))
            {
                if (m.Payload is not null)
                    Interlocked.Increment(ref dropped);
                m.Reply?.TrySetException(new ApiError(503, "Telemetry worker failed"));
            }
        }
    }
    private void Append(SqliteConnection db, List<string> batch)
    {
        Exec(db, "BEGIN IMMEDIATE");
        try
        {
            using (var insert = db.CreateCommand())
            {
                insert.CommandText = "INSERT INTO events(timestamp,payload,bytes) VALUES($t,$p,$b)";
                var t = insert.Parameters.Add("$t", SqliteType.Integer);
                var p = insert.Parameters.Add("$p", SqliteType.Text);
                var b = insert.Parameters.Add("$b", SqliteType.Integer);
                foreach (var payload in batch)
                {
                    var doc = JObject.Parse(payload);
                    t.Value = (long)doc["timestamp"]!;
                    p.Value = payload;
                    b.Value = Encoding.UTF8.GetByteCount(payload);
                    insert.ExecuteNonQuery();
                }
            }
            retentionPending = Prune(db);
            // If a lower configured cap needs several passes, maintenance commits
            // progress separately. A failed batch cannot undo that progress.
            if (Convert.ToInt64(Scalar(db, "SELECT count FROM retained_stats")) > config.TelemetryRows ||
                Convert.ToInt64(Scalar(db, "SELECT bytes FROM retained_stats")) > config.TelemetryPayloadBytes)
                throw new IOException("Retention catch-up in progress; batch dropped with accounting");
            Exec(db, "COMMIT");

        }
        catch { try { Exec(db, "ROLLBACK"); } catch (SqliteException) { } throw; }
    }
    // At most 1024 oldest records per pass. Progress commits even when more
    // expired records remain; periodic idle passes eventually finish the backlog.
    private bool Prune(SqliteConnection db)
    {
        var cutoff = Wire.Now - (long)config.TelemetryRetentionSeconds * 1000;
        long count = Convert.ToInt64(Scalar(db, "SELECT count FROM retained_stats"));
        long bytes = Convert.ToInt64(Scalar(db, "SELECT bytes FROM retained_stats"));
        int removed = 0;
        while (removed < 1024)
        {
            var oldest = new List<(long Id, long At, long Bytes)>(128);
            using (var cmd = db.CreateCommand())
            {
                cmd.CommandText = "SELECT id,timestamp,bytes FROM events ORDER BY id LIMIT 128";
                using var rows = cmd.ExecuteReader();
                while (rows.Read())
                    oldest.Add((rows.GetInt64(0), rows.GetInt64(1), rows.GetInt64(2)));
            }
            if (oldest.Count == 0)
                return false;
            long through = 0;
            foreach (var row in oldest)
            {
                if (count <= config.TelemetryRows && bytes <= config.TelemetryPayloadBytes && row.At >= cutoff)
                    break;
                through = row.Id;
                count--;
                bytes -= row.Bytes;
                removed++;
            }
            if (through == 0)
                return false;
            Exec(db, $"DELETE FROM events WHERE id<={through}; UPDATE metadata SET value='{through}' WHERE key='pruned'");
        }
        return true;
    }
    public Task<object> Status() => Query(db => new
    {
        instanceId,
        buffered = queue.Count,
        bufferCapacity = config.TelemetryQueue,
        dropped = Interlocked.Read(ref dropped),
        written = Interlocked.Read(ref written),
        writerError,
        maintenanceError,
        retentionPending,
        store = new
        {
            storeId,
            count = Scalar(db, "SELECT count FROM retained_stats WHERE singleton=1"),
            retainedEventBytes = Scalar(db, "SELECT bytes FROM retained_stats WHERE singleton=1"),
            oldestTimestamp = Scalar(db, "SELECT timestamp FROM events ORDER BY timestamp LIMIT 1"),
            newestTimestamp = Scalar(db, "SELECT timestamp FROM events ORDER BY timestamp DESC LIMIT 1"),
            highWaterCursor = $"{storeId}:{Scalar(db, "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='events'),0)")}",
            prunedThrough = $"{storeId}:{Scalar(db, "SELECT value FROM metadata WHERE key='pruned'")}",
            rowLimit = config.TelemetryRows,
            payloadByteLimit = config.TelemetryPayloadBytes
        }
    });
    public Task<object> Events(string? after, string? through, int limit, string? type = null, string? device = null, long? since = null, long? until = null) => Query(db =>
    {
        long high = Convert.ToInt64(Scalar(db, "SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name='events'),0)"));
        long Position(string? cursor, long fallback)
        {
            if (cursor is null)
                return fallback;
            var parts = cursor.Split(':');
            if (parts.Length != 2 || parts[0] != storeId || !long.TryParse(parts[1], out var value) || value < 0 || value > high)
                throw new ApiError(409, "Invalid telemetry cursor");
            return value;
        }
        var a = Position(after, 0);
        var z = Position(through, high);
        if (z < a || limit is < 1 or > 500)
            throw new ApiError(400, "Invalid cursor range or page size");
        using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT id,payload FROM events WHERE id>$a AND id<=$z";
        if (type != null)
        {
            if (type.Length > 128)
                throw new ApiError(400, "Invalid event type");
            cmd.CommandText += " AND json_extract(payload,'$.type')=$type";
            cmd.Parameters.AddWithValue("$type", type);
        }
        if (device != null)
        {
            if (device.Length > 64)
                throw new ApiError(400, "Invalid event device");
            cmd.CommandText += " AND json_extract(payload,'$.deviceId')=$device";
            cmd.Parameters.AddWithValue("$device", device);
        }
        if (since != null)
        {
            if (since < 0)
                throw new ApiError(400, "Invalid since");
            cmd.CommandText += " AND timestamp>=$since";
            cmd.Parameters.AddWithValue("$since", since);
        }
        if (until != null)
        {
            if (until < 0 || since != null && until < since)
                throw new ApiError(400, "Invalid until");
            cmd.CommandText += " AND timestamp<=$until";
            cmd.Parameters.AddWithValue("$until", until);
        }
        cmd.CommandText += " ORDER BY id LIMIT $l";
        cmd.Parameters.AddWithValue("$a", a);
        cmd.Parameters.AddWithValue("$z", z);
        cmd.Parameters.AddWithValue("$l", limit + 1);
        var events = new List<Dictionary<string, object?>>();
        long last = a;
        bool more = false;
        using (var rows = cmd.ExecuteReader())
        {
            while (rows.Read())
            {
                if (events.Count == limit)
                {
                    more = true;
                    break;
                }
                last = rows.GetInt64(0);
                var item = Wire.Decode<Dictionary<string, object?>>(rows.GetString(1));
                item["cursor"] = $"{storeId}:{last}";
                events.Add(item);
            }
        }
        long pruned = Convert.ToInt64(Scalar(db, "SELECT value FROM metadata WHERE key='pruned'"));
        return new
        {
            events,
            hasMore = more,
            nextCursor = $"{storeId}:{(more ? last : z)}",
            highWaterCursor = $"{storeId}:{z}",
            prunedThrough = $"{storeId}:{pruned}",
            gap = after is not null && a < pruned ? new
            {
                requested = after,
                prunedThrough = $"{storeId}:{pruned}",
                reason = "retention"
            } : null
        };
    });
    private readonly SemaphoreSlim streams = new(4, 4);
    public async Task Stream(HttpContext context, bool follow, CancellationToken stopping)
    {
        if (!await streams.WaitAsync(0))
            throw new ApiError(429, "Telemetry stream limit reached");
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, stopping);
        if (!follow)
            deadline.CancelAfter(TimeSpan.FromSeconds(30));
        var query = context.Request.Query;
        string? after = query["after"].FirstOrDefault(), through = query["through"].FirstOrDefault();
        long? Since(string key) => query[key].Count == 0 ? null : long.TryParse(query[key], out var value) ? value : throw new ApiError(400, "Invalid " + key);
        try
        {
            context.Response.ContentType = follow ? "text/event-stream" : "application/x-ndjson";
            int delivered = 0;
            do
            {
                deadline.Token.ThrowIfCancellationRequested();
                var page = JObject.Parse(Wire.Encode(await Events(after, through, 500, query["type"].FirstOrDefault(), query["device"].FirstOrDefault(), Since("since"), Since("until"))));
                if (!follow)
                    through ??= (string?)page["highWaterCursor"];
                if (page["gap"]?.Type != JTokenType.Null)
                    await context.Response.WriteAsync(follow ? "event: gap\ndata: " + page["gap"]!.ToString(Newtonsoft.Json.Formatting.None) + "\n\n" : Wire.Encode(new
                    {
                        type = "retention-gap",
                        details = page["gap"]
                    }) + "\n", deadline.Token);
                foreach (var item in (JArray)page["events"]!)
                {
                    string line = item.ToString(Newtonsoft.Json.Formatting.None);
                    await context.Response.WriteAsync(follow ? "id: " + (string?)item["cursor"] + "\nevent: telemetry\ndata: " + line + "\n\n" : line + "\n", deadline.Token);
                    delivered++;
                }
                after = (string?)page["nextCursor"];
                await context.Response.Body.FlushAsync(deadline.Token);
                if (!follow && (!(bool)page["hasMore"]! || delivered >= 100000))
                {
                    await context.Response.WriteAsync(Wire.Encode(new
                    {
                        type = "export-end",
                        nextCursor = after,
                        through,
                        hasMore = (bool)page["hasMore"]!
                    }) + "\n", deadline.Token);
                    break;
                }
                if (!(bool)page["hasMore"]!)
                {
                    await context.Response.WriteAsync(": heartbeat\n\n", deadline.Token);
                    await Task.Delay(1000, deadline.Token);
                }
            } while (true);
        }
        finally { streams.Release(); }
    }
    public void Dispose()
    {
        queue.CompleteAdding();
        if (!worker.Join(2000))
            writerError = "Shutdown drain deadline exceeded";
    }
}
