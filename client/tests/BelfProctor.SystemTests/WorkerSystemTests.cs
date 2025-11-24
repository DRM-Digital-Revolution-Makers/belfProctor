using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BelfProctor.SystemTests;

public class WorkerSystemTests
{
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
            ScreenshotInterval = 100,
            HeartbeatInterval = 100,
            PolicyUpdateInterval = 200,
            ScreenshotPath = screenshots,
            LogPath = logs,
            ReportsPath = reports,
            ClientId = "test",
            ServerUrl = "http://localhost"
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
        public event EventHandler<SystemEvent>? SystemEventOccurred;
        public Task<List<SystemEvent>> GetRecentEventsAsync(TimeSpan timeSpan) => Task.FromResult(new List<SystemEvent>());
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }

    private class TransmissionStub : IDataTransmissionService
    {
        public int Heartbeats { get; private set; }
        public Task<byte[]> DownloadPolicyAsync(string policyId) => Task.FromResult(Array.Empty<byte>());
        public Task SendHeartbeatAsync() { Heartbeats++; return Task.CompletedTask; }
        public Task SendReportAsync(string reportPath) => Task.CompletedTask;
        public Task SendScreenshotAsync(string filePath) => Task.CompletedTask;
        public Task SendSystemEventAsync(SystemEvent systemEvent) => Task.CompletedTask;
        public Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes) => Task.CompletedTask;
        public Task SendCommandResultFileAsync(string commandId, string filePath) => Task.CompletedTask;
        public Task SendActivityAsync(bool isActive, long activeMilliseconds, long inactiveMilliseconds) => Task.CompletedTask;
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
        public event EventHandler<bool>? ActivityChanged;
        public Task StartAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    }
}