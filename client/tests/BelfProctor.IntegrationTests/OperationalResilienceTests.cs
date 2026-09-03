using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace BelfProctor.IntegrationTests;

public class OperationalResilienceTests
{
    [Fact]
    public async Task OfflineActivity_IsPersistedForRetry()
    {
        var root = Path.Combine(Path.GetTempPath(), "BelfProctor_Offline_" + Guid.NewGuid());
        try
        {
            var settings = Options.Create(new ProctorSettings
            {
                ClientId = "OFFLINE01",
                EncryptionKey = "offline-device-key-at-least-32-characters",
                ServerUrl = "https://127.0.0.1:1/api/",
                LogPath = root,
            });
            using var service = new DataTransmissionService(
                NullLogger<DataTransmissionService>.Instance, settings);

            await service.SendActivityAsync(true, 1234, 0);

            var queued = Directory.GetFiles(Path.Combine(root, "Pending", "Activity"), "*.json");
            Assert.Single(queued);
            Assert.Contains("1234", await File.ReadAllTextAsync(queued[0]));
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }

    [Fact]
    public async Task ScreenshotRetention_DeletesOnlyExpiredFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), "BelfProctor_Retention_" + Guid.NewGuid());
        Directory.CreateDirectory(root);
        try
        {
            var oldFile = Path.Combine(root, "screenshot_old.jpg");
            var freshFile = Path.Combine(root, "screenshot_fresh.jpg");
            await File.WriteAllTextAsync(oldFile, "old");
            await File.WriteAllTextAsync(freshFile, "fresh");
            File.SetCreationTime(oldFile, DateTime.Now.AddDays(-10));

            var settings = Options.Create(new ProctorSettings { ScreenshotPath = root, MaxScreenshotAge = 7 });
            var transmission = new Mock<IDataTransmissionService>();
            var service = new ScreenshotService(NullLogger<ScreenshotService>.Instance, settings, transmission.Object);
            await service.CleanupOldScreenshotsAsync();

            Assert.False(File.Exists(oldFile));
            Assert.True(File.Exists(freshFile));
        }
        finally
        {
            try { Directory.Delete(root, true); } catch { }
        }
    }
}
