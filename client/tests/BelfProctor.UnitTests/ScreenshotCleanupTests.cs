using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace BelfProctor.UnitTests;

public class ScreenshotCleanupTests
{
    [Fact]
    public async Task CleanupOldScreenshots_RemovesOlderThanMaxAge()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "BelfProctor_Test_Screenshots_" + Guid.NewGuid());
        Directory.CreateDirectory(tempDir);

        try
        {
            // Create recent and old files
            var recent = Path.Combine(tempDir, "screenshot_recent.jpg");
            var old = Path.Combine(tempDir, "screenshot_old.jpg");
            await File.WriteAllBytesAsync(recent, new byte[] { 1, 2, 3 });
            await File.WriteAllBytesAsync(old, new byte[] { 4, 5, 6 });

            File.SetCreationTime(old, DateTime.Now.AddDays(-10));

            var settings = Options.Create(new ProctorSettings
            {
                ScreenshotPath = tempDir,
                MaxScreenshotAge = 7,
                ScreenshotQuality = 80
            });
            var svc = new ScreenshotService(new NullLogger<ScreenshotService>(), settings, new StubTransmission());

            await svc.CleanupOldScreenshotsAsync();

            Assert.True(File.Exists(recent));
            Assert.False(File.Exists(old));
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }

    private class StubTransmission : IDataTransmissionService
    {
        public Task SendScreenshotAsync(string filePath) => Task.CompletedTask;
        public Task SendSystemEventAsync(BelfProctor.Models.SystemEvent systemEvent) => Task.CompletedTask;
        public Task SendHeartbeatAsync() => Task.CompletedTask;
        public Task<byte[]> DownloadPolicyAsync(string policyId) => Task.FromResult(Array.Empty<byte>());
        public Task SendReportAsync(string reportPath) => Task.CompletedTask;
        public Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes) => Task.CompletedTask;
        public Task SendCommandResultFileAsync(string commandId, string filePath) => Task.CompletedTask;
        public Task SendActivityAsync(bool isActive, long timestamp, long sessionId) => Task.CompletedTask;
        public void Dispose() {}
    }
}