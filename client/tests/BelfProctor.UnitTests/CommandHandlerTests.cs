using System.Text;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using BelfProctor.Services;
using Xunit;

namespace BelfProctor.UnitTests;

public class CommandHandlerTests
{
    private IOptions<ProctorSettings> Settings()
    {
        return Options.Create(new ProctorSettings
        {
            ClientId = "test-client",
            ServerUrl = "http://localhost:4000/api",
            ScreenshotPath = "%LOCALAPPDATA%\\BelfProctor\\Screenshots",
            LogPath = "%LOCALAPPDATA%\\BelfProctor\\Logs",
            ReportsPath = "%LOCALAPPDATA%\\BelfProctor\\Reports"
        });
    }

    [Fact]
    public async Task ListCommand_SendsJsonResult()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "bp_list_test");
        Directory.CreateDirectory(tmp);
        var f1 = Path.Combine(tmp, "a.txt");
        var f2 = Path.Combine(tmp, "b.log");
        await File.WriteAllTextAsync(f1, "x");
        await File.WriteAllTextAsync(f2, "y");

        var tx = new TestTransmission();
        var handler = new CommandHandler(Settings(), tx);
        var cmd = new Command
        {
            Id = "cmd-1",
            Type = "list",
            Payload = new Dictionary<string, object>
            {
                {"basePath", tmp},
                {"pattern", "*"},
                {"recursive", false},
                {"maxEntries", 10}
            }
        };

        await handler.HandleAsync(cmd);

        Assert.Equal(1, tx.JsonCalls);

        File.Delete(f1);
        File.Delete(f2);
        Directory.Delete(tmp);
    }

    [Fact]
    public async Task FileCommand_SendsFileResult()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "bp_file_test");
        Directory.CreateDirectory(tmp);
        var f = Path.Combine(tmp, "c.bin");
        await File.WriteAllBytesAsync(f, Encoding.UTF8.GetBytes("data"));

        var tx = new TestTransmission();
        var handler = new CommandHandler(Settings(), tx);
        var cmd = new Command
        {
            Id = "cmd-2",
            Type = "file",
            Payload = new Dictionary<string, object>
            {
                {"path", f}
            }
        };

        await handler.HandleAsync(cmd);

        Assert.Single(tx.FileCalls);
        Assert.Equal(("cmd-2", f), tx.FileCalls[0]);

        File.Delete(f);
        Directory.Delete(tmp);
    }
    private class TestTransmission : IDataTransmissionService
    {
        public int JsonCalls { get; private set; }
        public List<(string, string)> FileCalls { get; } = new();
        public Task SendScreenshotAsync(string filePath) => Task.CompletedTask;
        public Task SendSystemEventAsync(SystemEvent systemEvent) => Task.CompletedTask;
        public Task SendHeartbeatAsync() => Task.CompletedTask;
        public Task<byte[]> DownloadPolicyAsync(string policyId) => Task.FromResult(Array.Empty<byte>());
        public Task SendReportAsync(string reportPath) => Task.CompletedTask;
        public Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes) { JsonCalls++; return Task.CompletedTask; }
        public Task SendCommandResultFileAsync(string commandId, string filePath) { FileCalls.Add((commandId, filePath)); return Task.CompletedTask; }
    }
}