using System.Buffers.Binary;
using System.Security.Cryptography;
using Cria.Contracts;

namespace Cria.Api;

// The newest completed captures, kept in a rolling set. When the byte budget (a soft cap) is exceeded
// the oldest image goes. Nothing is promised across a restart: the directory is emptied at start,
// and an image that was evicted (or never existed here) is gone for good. Vela fetches each image
// right after its capture succeeds and treats a missing one as a lost frame, never as a reason to
// expose again.
internal sealed class RecentImages
{
    private readonly object gate = new();
    private readonly Configuration config;
    private readonly string directory, workers;
    // Oldest first.
    private readonly List<Entry> order = [];
    private int downloads;
    private long ReservationBytes => 44L + 4L * config.MaxPixels;

    private sealed class Entry(ImageInfo info)
    {
        public ImageInfo Info { get; } = info;
        public long Bytes => Info.Original.Bytes;
        public int Downloading;
    }

    public RecentImages(Configuration config)
    {
        this.config = config;
        // A directory of our own, so upgrading never deletes originals the previous design kept.
        directory = Path.Combine(config.DataDirectory, "recent-images");
        workers = Path.Combine(config.DataDirectory, "workers");

        if (Directory.Exists(directory))
            Directory.Delete(directory, true);
        Directory.CreateDirectory(directory);
    }

    private string FilePath(string id) => Path.Combine(directory, id + ".imagebytes");

    /// <summary>
    /// Verifies the worker's finished file against what it reported, moves it into the store and
    /// evicts the oldest images beyond the budget. The worker leaves the file in its own pending folder.
    /// </summary>
    public async Task<ImageInfo> Adopt(Operation op, string imageId, CapturedImage reported)
    {
        string source = Path.Combine(workers, op.BindingId, "pending", imageId + ".imagebytes");

        if (!File.Exists(source))
            throw new InvalidDataException("Worker reported an original that is not present");

        if (await Verify(source, reported) is { } problem)
            throw new InvalidDataException(problem);

        File.Move(source, FilePath(imageId));
        TryDelete(Path.Combine(workers, op.BindingId, "pending", imageId + ".json"));

        var info = new ImageInfo
        {
            Id = imageId,
            OperationId = op.Id,
            InstanceId = op.InstanceId,
            DeviceId = op.DeviceId,
            BindingId = op.BindingId,
            CameraName = op.ExpectedName,
            Width = reported.Width,
            Height = reported.Height,
            BinX = reported.BinX,
            BinY = reported.BinY,
            StartX = reported.StartX,
            StartY = reported.StartY,
            ExposureSeconds = (double?)op.Parameters["exposureSeconds"] ?? 0,
            CapturedAt = reported.CapturedAt,
            CapturedAtSource = reported.CapturedAtSource,
            Color = reported.Color,
            Sha256 = reported.Sha256,
            RetainedAt = Wire.Now,
            Original = new OriginalInfo { Bytes = reported.Bytes, Url = "/v2/images/" + imageId + "/original" }
        };

        lock (gate)
        {
            order.Add(new Entry(info));
            Evict();
        }

        return info;
    }

    // Caller holds the gate. The budget is a soft cap: images go strictly oldest first, the newest is
    // never dropped even if it alone exceeds the budget, and an image mid-download is never dropped
    // (Windows cannot delete an open file). When the oldest is in use the store simply stays over the
    // budget until that download ends, and the next pass drops it. Room for the capture in hand is
    // never the reason to refuse or to drop something newer.
    private void Evict()
    {
        long total = order.Sum(e => e.Bytes);

        while (order.Count > 1 && total > config.ImageBudgetBytes && order[0].Downloading == 0)
        {
            var oldest = order[0];

            TryDelete(FilePath(oldest.Info.Id));
            order.RemoveAt(0);
            total -= oldest.Bytes;
        }
    }

    public async Task Download(string id, HttpContext context)
    {
        Entry entry;
        FileStream file;

        lock (gate)
        {
            entry = order.Find(e => e.Info.Id == id) ??
                throw new ApiError(410, "This image is no longer held; the newest images are kept up to a size limit", "image-gone");

            if (downloads >= config.MaxDownloads)
                throw new ApiError(429, "Download concurrency limit reached", "download-busy");

            file = new FileStream(FilePath(id), FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
            entry.Downloading++;
            downloads++;
        }

        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        deadline.CancelAfter(TimeSpan.FromSeconds(config.DownloadTimeoutSeconds));

        try
        {
            await using (file)
            {
                context.Response.ContentType = entry.Info.Original.MediaType;
                context.Response.ContentLength = file.Length;
                context.Response.Headers.ETag = "\"" + entry.Info.Sha256 + "\"";
                await file.CopyToAsync(context.Response.Body, 65536, deadline.Token);
            }
        }
        finally
        {
            lock (gate)
            {
                entry.Downloading--;
                downloads--;
                Evict();
            }
        }
    }

    private async Task<string?> Verify(string path, CapturedImage image)
    {
        if (image.Bytes < 44 || image.Bytes > ReservationBytes || image.Width < 1 || image.Height < 1 || (long)image.Width * image.Height > config.MaxPixels)
            return "Invalid original geometry";

        await using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);

        if (file.Length != image.Bytes)
            return "Original length differs from what the worker reported";
        var header = new byte[44];
        await file.ReadExactlyAsync(header);
        int F(int i) => BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(i * 4, 4));
        int size = F(6) is 1 or 8 ? 2 : F(6) == 2 ? 4 : F(6) == 6 ? 1 : 0;

        if (F(0) != 1 || F(1) != 0 || F(4) != 44 || F(5) != 2 || F(7) != 2 || F(8) != image.Width || F(9) != image.Height || F(10) != 0 || size == 0 || image.Bytes != 44L + (long)image.Width * image.Height * size)
            return "Invalid ImageBytes header";
        file.Position = 0;

        return Convert.ToHexStringLower(await SHA256.HashDataAsync(file)) == image.Sha256 ? null : "Original SHA-256 differs from what the worker reported";
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (IOException) { }
    }
}
