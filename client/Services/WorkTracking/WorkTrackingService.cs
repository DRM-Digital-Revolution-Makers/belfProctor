using System.Reflection;
using System.IO;
using BelfProctor.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace BelfProctor.Services.WorkTracking;

public class WorkTrackingService : BackgroundService
{
    private static readonly string SourceVersion =
        Assembly.GetEntryAssembly()?.GetName().Version?.ToString(3)
        ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
        ?? "1.0.0";

    private readonly ILogger<WorkTrackingService> _logger;
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _transmission;
    private readonly IScreenshotService _screenshots;
    private readonly IActivityMonitorService _activity;
    private readonly List<IAppAdapter> _adapters;
    private ActiveWorkSession? _current;
    private DateTime _lastSnapshotUtc = DateTime.MinValue;
    private readonly DateTime _startedAtUtc = DateTime.UtcNow;
    private const int StartupScreenshotGraceSeconds = 15;

    public WorkTrackingService(
        ILogger<WorkTrackingService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService transmission,
        IScreenshotService screenshots,
        IActivityMonitorService activity)
    {
        _logger = logger;
        _settings = settings.Value;
        _transmission = transmission;
        _screenshots = screenshots;
        _activity = activity;
        _adapters = new List<IAppAdapter>
        {
            new AutoCadComAdapter(),
            new BrowserAdapter(),
            new OfficeGenericAdapter(),
            new PdfGenericAdapter(),
            new GenericForegroundAdapter(),
        };
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.Features.WorkTracking)
        {
            _logger.LogInformation("Work tracking disabled by feature flag");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Work tracking tick failed");
            }

            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (_current != null)
        {
            await EndCurrentAsync("shutdown", captureScreenshot: true);
        }
        await base.StopAsync(cancellationToken);
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var snapshot = ForegroundWindowSnapshot.Capture();
        if (snapshot == null || string.IsNullOrWhiteSpace(snapshot.ProcessName))
        {
            if (_current != null && DateTime.UtcNow - _current.LastSeenUtc > TimeSpan.FromSeconds(30))
            {
                await EndCurrentAsync("timeout", captureScreenshot: false);
            }
            return;
        }

        var candidate = Resolve(snapshot);
        var now = DateTime.UtcNow;
        if (_current == null || !string.Equals(_current.Candidate.SessionKey, candidate.SessionKey, StringComparison.OrdinalIgnoreCase))
        {
            if (_current != null)
            {
                await EndCurrentAsync("switch", captureScreenshot: true);
            }
            _current = new ActiveWorkSession(candidate, now);
            _lastSnapshotUtc = now;
            await SendEventAsync(_current, "start");
            await CaptureLinkedScreenshotAsync(_current, "work_start");
            return;
        }

        var delta = now - _current.LastSeenUtc;
        var deltaMs = Math.Max(0, (long)delta.TotalMilliseconds);
        _current.OpenedMs += deltaMs;
        _current.FocusedMs += deltaMs;
        if (_activity.IsUserActive) _current.ActiveFocusedMs += deltaMs;
        _current.LastSeenUtc = now;

        if (now - _lastSnapshotUtc > TimeSpan.FromSeconds(30))
        {
            _lastSnapshotUtc = now;
            await SendEventAsync(_current, "snapshot");
        }
    }

    private WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot)
    {
        foreach (var adapter in _adapters)
        {
            if (!adapter.CanHandle(snapshot)) continue;
            var candidate = adapter.Resolve(snapshot);
            candidate.ProcessName = string.IsNullOrWhiteSpace(candidate.ProcessName) ? snapshot.ProcessName : candidate.ProcessName;
            candidate.WindowTitle = string.IsNullOrWhiteSpace(candidate.WindowTitle) ? snapshot.WindowTitle : candidate.WindowTitle;
            if (!string.IsNullOrWhiteSpace(candidate.FilePath) && string.IsNullOrWhiteSpace(candidate.FolderPath))
            {
                candidate.FolderPath = SafeDirectoryName(candidate.FilePath);
            }
            return candidate;
        }
        return new GenericForegroundAdapter().Resolve(snapshot);
    }

    private async Task EndCurrentAsync(string reason, bool captureScreenshot)
    {
        var session = _current;
        if (session == null) return;
        session.EndedAtUtc = DateTime.UtcNow;
        session.EndReason = reason;
        if (captureScreenshot)
        {
            await CaptureLinkedScreenshotAsync(session, "work_end");
        }
        await SendEventAsync(session, "end");
        _current = null;
    }

    private async Task SendEventAsync(ActiveWorkSession session, string eventType)
    {
        var payload = new WorkSessionPayload
        {
            SessionId = session.SessionId,
            Adapter = session.Candidate.Adapter,
            ProcessName = session.Candidate.ProcessName,
            WindowTitle = session.Candidate.WindowTitle,
            FilePath = NormalizeNullable(session.Candidate.FilePath),
            FolderPath = NormalizeNullable(session.Candidate.FolderPath),
            ProjectName = NormalizeNullable(session.Candidate.ProjectName),
            OpenedMs = session.OpenedMs,
            FocusedMs = session.FocusedMs,
            ActiveFocusedMs = session.ActiveFocusedMs,
            Confidence = session.Candidate.Confidence,
            EndReason = session.EndReason,
            StartedAt = session.StartedAtUtc,
            EndedAt = session.EndedAtUtc,
            Metadata = session.Candidate.Metadata,
        };

        var envelope = new WorkEventEnvelope
        {
            EventId = Guid.NewGuid().ToString("N"),
            SchemaVersion = 1,
            ClientId = _settings.ClientId,
            TimestampUtc = DateTime.UtcNow,
            EventType = eventType,
            SourceVersion = SourceVersion,
            Payload = payload,
        };
        await _transmission.SendWorkEventsAsync(new[] { envelope });
    }

    private async Task CaptureLinkedScreenshotAsync(ActiveWorkSession session, string reason)
    {
        // Skip screenshots during startup — Windows rapidly shifts focus as the
        // shell initialises, generating 8-10 spurious captures in the first seconds.
        if ((DateTime.UtcNow - _startedAtUtc).TotalSeconds < StartupScreenshotGraceSeconds)
            return;
        try
        {
            var filePath = await _screenshots.CaptureScreenshotToFileAsync();
            await _transmission.SendScreenshotAsync(filePath, new WorkScreenshotMetadata
            {
                CaptureReason = reason,
                LinkedSessionId = session.SessionId,
                ProcessName = session.Candidate.ProcessName,
                FilePath = session.Candidate.FilePath,
                ProjectName = session.Candidate.ProjectName,
            });
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to capture work screenshot");
        }
    }

    private static string? SafeDirectoryName(string? filePath)
    {
        try { return string.IsNullOrWhiteSpace(filePath) ? null : Path.GetDirectoryName(filePath); }
        catch { return null; }
    }

    private static string? NormalizeNullable(string? value)
    {
        return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    }

    private sealed class ActiveWorkSession
    {
        public ActiveWorkSession(WorkArtifactCandidate candidate, DateTime nowUtc)
        {
            Candidate = candidate;
            StartedAtUtc = nowUtc;
            LastSeenUtc = nowUtc;
        }

        public string SessionId { get; } = Guid.NewGuid().ToString("N");
        public WorkArtifactCandidate Candidate { get; }
        public DateTime StartedAtUtc { get; }
        public DateTime LastSeenUtc { get; set; }
        public DateTime? EndedAtUtc { get; set; }
        public long OpenedMs { get; set; }
        public long FocusedMs { get; set; }
        public long ActiveFocusedMs { get; set; }
        public string EndReason { get; set; } = "active";
    }
}
