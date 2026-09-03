using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BelfProctor.SystemTests;

public class WorkerSystemTests
{
    [Fact]
    public async Task CaptureScreenshot_UsesEntireVirtualDesktop_OrFailsClosedWhenUnavailable()
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "BelfProctor_Screen_" + Guid.NewGuid());
        Directory.CreateDirectory(baseDir);
        try
        {
            var settings = Options.Create(new ProctorSettings
            {
                ScreenshotPath = baseDir,
                ScreenshotQuality = 75,
                ClientId = "SYSTEM/TEST"
            });
            var service = new ScreenshotService(
                new NullLogger<ScreenshotService>(), settings, new TransmissionStub());

            string file;
            try
            {
                file = await service.CaptureScreenshotToFileAsync();
            }
            catch (InvalidOperationException ex) when (
                ex.Message.Contains("Interactive desktop capture is unavailable", StringComparison.Ordinal))
            {
                if (string.Equals(
                    Environment.GetEnvironmentVariable("BELF_REQUIRE_INTERACTIVE_DESKTOP"),
                    "1", StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        "Interactive desktop capture was required for this field gate.", ex);
                }
                // CI/agent shells can have Screen metadata but no input-desktop
                // handle. The important invariant here is fail-closed: never
                // generate and upload the uniform black JPEG the old BitBlt
                // implementation silently produced. Interactive VM validation
                // exercises the successful branch.
                return;
            }

            Assert.True(File.Exists(file));
            Assert.True(new FileInfo(file).Length > 1000, "Captured JPEG is unexpectedly empty");
            Assert.DoesNotContain("/", Path.GetFileName(file));
            using var image = System.Drawing.Image.FromFile(file);
            var virtualScreen = System.Windows.Forms.SystemInformation.VirtualScreen;
            Assert.Equal(virtualScreen.Width, image.Width);
            Assert.Equal(virtualScreen.Height, image.Height);
            Assert.Equal(System.Drawing.Imaging.ImageFormat.Jpeg.Guid, image.RawFormat.Guid);
            using var bitmap = new System.Drawing.Bitmap(image);
            var sampledColors = new HashSet<int>();
            var stepX = Math.Max(1, bitmap.Width / 20);
            var stepY = Math.Max(1, bitmap.Height / 20);
            for (var x = 0; x < bitmap.Width; x += stepX)
            for (var y = 0; y < bitmap.Height; y += stepY)
                sampledColors.Add(bitmap.GetPixel(x, y).ToArgb());
            Assert.True(sampledColors.Count > 1, "Captured desktop is a uniform/blank image");
            var evidencePath = Environment.GetEnvironmentVariable("BELF_INTERACTIVE_SCREENSHOT_OUTPUT");
            if (!string.IsNullOrWhiteSpace(evidencePath))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(evidencePath)!);
                File.Copy(file, evidencePath, overwrite: true);
            }
        }
        finally
        {
            try { Directory.Delete(baseDir, true); } catch { }
        }
    }

    [Fact]
    public async Task SystemMonitor_ObservesARealProcessLifecycle_OnWindows()
    {
        var settings = Options.Create(new ProctorSettings
        {
            MonitorProcesses = true,
            MonitorUSB = false,
            MonitorNetwork = false
        });
        var monitor = new SystemMonitorService(
            new NullLogger<SystemMonitorService>(), settings);
        var observed = new TaskCompletionSource<SystemEvent>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        monitor.SystemEventOccurred += (_, evt) =>
        {
            if (evt.EventType == SystemEventType.ProcessStarted &&
                string.Equals(Path.GetFileNameWithoutExtension(evt.ProcessName), "ping", StringComparison.OrdinalIgnoreCase))
            {
                observed.TrySetResult(evt);
            }
        };

        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        await monitor.StartAsync(cts.Token);
        using var process = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
        {
            FileName = "ping.exe",
            Arguments = "127.0.0.1 -n 8",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        });
        try
        {
            var evt = await observed.Task.WaitAsync(TimeSpan.FromSeconds(12));
            Assert.Equal(SystemEventType.ProcessStarted, evt.EventType);
            Assert.Equal("ping", Path.GetFileNameWithoutExtension(evt.ProcessName), ignoreCase: true);
            Assert.NotNull(evt.AdditionalData);
        }
        finally
        {
            await monitor.StopAsync(CancellationToken.None);
            if (process is { HasExited: false }) process.Kill(entireProcessTree: true);
        }
    }

    [Fact]
    public async Task StartWorker_CreatesDirectories_AndRunsTimers()
    {
        var baseDir = Path.Combine(Path.GetTempPath(), "BelfProctor_Worker_" + Guid.NewGuid());
        var screenshots = Path.Combine(baseDir, "Screenshots");
        var logs = Path.Combine(baseDir, "Logs");
        var reports = Path.Combine(baseDir, "Reports");
        Directory.CreateDirectory(baseDir);

        var settings = Options.Create(new ProctorSettings
        {
            ScreenshotIntervalMs = 100,
            HeartbeatIntervalMs = 100,
            PolicyUpdateIntervalMs = 200,
            ScreenshotPath = screenshots,
            LogPath = logs,
            ReportsPath = reports,
            ClientId = "test",
            ServerUrl = "http://localhost",
            MaxStartupJitterMs = 0 // fire timers immediately so the 500ms wait is deterministic
        });

        var screenshotStub = new ScreenshotStub();
        var monitorStub = new MonitorStub();
        var transmissionStub = new TransmissionStub();
        var policyStub = new PolicyStub();
        var reportingStub = new ReportingStub();
        var stabilityStub = new StabilityStub();
        var activityStub = new ActivityStub();

        var worker = new BelfProctor.ProctorWorker(
            new NullLogger<BelfProctor.ProctorWorker>(),
            settings,
            screenshotStub,
            monitorStub,
            transmissionStub,
            policyStub,
            reportingStub,
            stabilityStub,
            activityStub
        );

        using var cts = new CancellationTokenSource();
        await worker.StartAsync(cts.Token);

        // Подождать чуть-чуть, чтобы таймеры сработали
        await Task.Delay(500);

        Assert.True(Directory.Exists(screenshots));
        Assert.True(Directory.Exists(logs));
        Assert.True(Directory.Exists(reports));

        // Проверяем, что таймеры дергали сервисы
        Assert.True(screenshotStub.Calls > 0);
        Assert.True(transmissionStub.Heartbeats > 0);
        Assert.True(policyStub.Updates > 0);

        await worker.StopAsync(cts.Token);

        try { Directory.Delete(baseDir, true); } catch { }
    }

    private class ScreenshotStub : IScreenshotService
    {
        public int Calls { get; private set; }
        public Task CaptureScreenshotAsync() { Calls++; return Task.CompletedTask; }
        public Task CleanupOldScreenshotsAsync() => Task.CompletedTask;
        public Task<string> CaptureScreenshotToFileAsync() => Task.FromResult("");
    }

    private class MonitorStub : ISystemMonitorService
    {
        public event EventHandler<SystemEvent>? SystemEventOccurred { add { } remove { } }
        public Task<List<SystemEvent>> GetRecentEventsAsync(TimeSpan timeSpan) => Task.FromResult(new List<SystemEvent>());
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private class TransmissionStub : IDataTransmissionService
    {
        public int Heartbeats { get; private set; }
        public Task<byte[]> DownloadPolicyAsync(string policyId) => Task.FromResult(Array.Empty<byte>());
        public Task<bool> SendHeartbeatAsync() { Heartbeats++; return Task.FromResult(true); }
        public Task SendReportAsync(string reportPath) => Task.CompletedTask;
        public Task SendScreenshotAsync(string filePath, WorkScreenshotMetadata? metadata = null) => Task.CompletedTask;
        public Task SendSystemEventAsync(SystemEvent systemEvent) => Task.CompletedTask;
        public Task SendWorkEventsAsync(IEnumerable<WorkEventEnvelope> events) => Task.CompletedTask;
        public Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes) => Task.CompletedTask;
        public Task SendCommandResultFileAsync(string commandId, string filePath) => Task.CompletedTask;
        public Task SendActivityAsync(bool isActive, long activeMilliseconds, long inactiveMilliseconds) => Task.CompletedTask;
        public Task SendClientLogChunkAsync(string fileName, string text) => Task.CompletedTask;
        public Task SendPcSessionEventAsync(string kind, DateTime utcTimestamp, string bootId) => Task.CompletedTask;
        public Task SendBrowserActivityAsync(IReadOnlyList<BelfProctor.Models.BrowserVisit> visits) => Task.CompletedTask;
        public event Action? HeartbeatSucceeded { add { } remove { } }
        public void Dispose() { }
    }

    private class PolicyStub : IPolicyService
    {
        public int Updates { get; private set; }
        public Task ApplyPolicyAsync(SecurityPolicy policy) => Task.CompletedTask;
        public Task<List<SecurityPolicy>> GetActivePoliciesAsync() => Task.FromResult(new List<SecurityPolicy>());
        public Task LoadPoliciesAsync() => Task.CompletedTask;
        public Task<bool> CheckPolicyViolationAsync(SystemEvent systemEvent) => Task.FromResult(false);
        public Task UpdatePoliciesFromServerAsync() { Updates++; return Task.CompletedTask; }
    }

    private class ReportingStub : IReportingService
    {
        public Task GenerateSecurityReportAsync() => Task.CompletedTask;
        public Task GenerateStatusReportAsync() => Task.CompletedTask;
        public Task LogEventAsync(SystemEvent systemEvent) => Task.CompletedTask;
        public Task<string> GetSystemStatusAsync() => Task.FromResult("{}");
        public Task ArchiveOldLogsAsync() => Task.CompletedTask;
        public Task GenerateDirectoryListingReportAsync() => Task.CompletedTask;
    }

    private class StabilityStub : IStabilityService
    {
        public bool IsHealthy => true;
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task<bool> CheckHealthAsync() => Task.FromResult(true);
        public Task RestartServiceAsync() => Task.CompletedTask;
    }

    private class ActivityStub : IActivityMonitorService
    {
        public bool IsUserActive { get; set; } = true;
        public TimeSpan ActiveElapsed => TimeSpan.Zero;
        public TimeSpan InactiveElapsed => TimeSpan.Zero;
        public event EventHandler<bool>? ActivityChanged { add { } remove { } }
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}
