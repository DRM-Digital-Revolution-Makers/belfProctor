using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace BelfProctor.IntegrationTests;

public class ReportingIntegrationTests
{
    [Fact]
    public async Task GenerateStatusReport_WritesFile_AndSendsIt()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "BelfProctor_Reports_" + Guid.NewGuid());
        Directory.CreateDirectory(tempDir);

        try
        {
            var settings = Options.Create(new ProctorSettings
            {
                LogPath = tempDir,
                ReportsPath = tempDir,
            });

            string? sentPath = null;
            var dtMock = new Mock<IDataTransmissionService>(MockBehavior.Strict);
            dtMock.Setup(m => m.SendReportAsync(It.IsAny<string>()))
                  .Callback<string>(p => sentPath = p)
                  .Returns(Task.CompletedTask);

            var svc = new ReportingService(new NullLogger<ReportingService>(), settings, dtMock.Object);

            // Генерируем отчёт статуса
            await svc.GenerateStatusReportAsync();

            Assert.False(string.IsNullOrEmpty(sentPath));
            Assert.True(File.Exists(sentPath!));
            Assert.StartsWith(tempDir, Path.GetDirectoryName(sentPath!)!);
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }
}