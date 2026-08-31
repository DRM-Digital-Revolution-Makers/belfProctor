using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net.WebSockets;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;

namespace BelfProctor.Services;

public class StreamingService : IDisposable
{
    private readonly ILogger<StreamingService> _logger;
    private readonly ProctorSettings _settings;
    private readonly object _lock = new();
    private CancellationTokenSource? _cts;
    private Task? _streamTask;

    public StreamingService(ILogger<StreamingService> logger, IOptions<ProctorSettings> settings)
    {
        _logger = logger;
        _settings = settings.Value;
    }

    public bool IsRunning
    {
        get
        {
            lock (_lock) return _streamTask != null && !_streamTask.IsCompleted;
        }
    }

    public Task StartAsync(int width = 1920, int fps = 12, int quality = 80)
    {
        if (!_settings.Features.LiveView) return Task.CompletedTask;

        lock (_lock)
        {
            if (_streamTask != null && !_streamTask.IsCompleted) return Task.CompletedTask;
            _cts = new CancellationTokenSource();
            _streamTask = Task.Run(() => RunAsync(width, fps, quality, _cts.Token));
        }
        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        Task? task;
        lock (_lock)
        {
            _cts?.Cancel();
            task = _streamTask;
        }

        if (task != null)
        {
            try { await task.WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        }

        lock (_lock)
        {
            _cts?.Dispose();
            _cts = null;
            _streamTask = null;
        }
    }

    private async Task RunAsync(int width, int fps, int quality, CancellationToken ct)
    {
        width = Math.Clamp(width, 320, 1920);
        fps = Math.Clamp(fps, 1, 15);
        quality = Math.Clamp(quality, 20, 95);

        using var ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(10);
        var uri = BuildStreamUri(_settings.ServerUrl, _settings.ClientId, _settings.EncryptionKey);
        await ws.ConnectAsync(uri, ct);
        _logger.LogInformation("Live View stream connected: {Uri}", uri);

        var delay = TimeSpan.FromMilliseconds(1000.0 / fps);
        while (!ct.IsCancellationRequested && ws.State == WebSocketState.Open)
        {
            var frame = CaptureFrame(width, quality);
            await ws.SendAsync(frame, WebSocketMessageType.Binary, true, ct);
            await Task.Delay(delay, ct);
        }
    }

    internal static Uri BuildStreamUri(string serverUrl, string clientId, string encryptionKey)
    {
        var query = WebSocketAuth.CreateQuery(clientId, encryptionKey);
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri))
        {
            return new Uri($"ws://localhost:8080/ws/stream?{query}");
        }

        var scheme = uri.Scheme == "https" ? "wss" : "ws";
        var port = uri.IsDefaultPort ? (uri.Scheme == "https" ? 443 : 80) : uri.Port;
        return new Uri($"{scheme}://{uri.Host}:{port}/ws/stream?{query}");
    }

    private static ArraySegment<byte> CaptureFrame(int targetWidth, int quality)
    {
        var bounds = System.Windows.Forms.SystemInformation.VirtualScreen;
        var scale = Math.Min(1.0, targetWidth / (double)Math.Max(1, bounds.Width));
        var width = Math.Max(1, (int)Math.Round(bounds.Width * scale));
        var height = Math.Max(1, (int)Math.Round(bounds.Height * scale));

        using var source = new Bitmap(bounds.Width, bounds.Height);
        using (var graphics = Graphics.FromImage(source))
        {
            foreach (var screen in System.Windows.Forms.Screen.AllScreens)
            {
                var destX = screen.Bounds.X - bounds.X;
                var destY = screen.Bounds.Y - bounds.Y;
                graphics.CopyFromScreen(screen.Bounds.X, screen.Bounds.Y, destX, destY, screen.Bounds.Size);
            }
        }

        using var scaled = new Bitmap(width, height);
        using (var graphics = Graphics.FromImage(scaled))
        {
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;
            graphics.DrawImage(source, 0, 0, width, height);
        }

        using var ms = new MemoryStream();
        var codec = ImageCodecInfo.GetImageDecoders().FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);
        if (codec != null)
        {
            using var parameters = new EncoderParameters(1);
            parameters.Param[0] = new EncoderParameter(Encoder.Quality, quality);
            scaled.Save(ms, codec, parameters);
        }
        else
        {
            scaled.Save(ms, ImageFormat.Jpeg);
        }

        return new ArraySegment<byte>(ms.ToArray());
    }

    public void Dispose()
    {
        // Dispose must not throw. Run StopAsync on the thread pool (no captured
        // SynchronizationContext) so this synchronous wait can't deadlock when
        // Dispose is called from a context-bound thread [C-M5].
        try { Task.Run(() => StopAsync()).GetAwaiter().GetResult(); }
        catch { /* swallow by Dispose contract */ }
    }
}
