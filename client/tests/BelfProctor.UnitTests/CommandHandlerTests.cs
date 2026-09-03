using System.Text;
using Newtonsoft.Json.Linq;
using Microsoft.Extensions.Logging.Abstractions;
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
        var settings = Options.Create(new ProctorSettings
        {
            ClientId = "test-client",
            ServerUrl = "http://localhost:4000/api",
            ScreenshotPath = "%LOCALAPPDATA%\\BelfProctor\\Screenshots",
            LogPath = "%LOCALAPPDATA%\\BelfProctor\\Logs",
            ReportsPath = "%LOCALAPPDATA%\\BelfProctor\\Reports",
            DirectoryRoots = new List<string> { tmp }
        });
        var handler = new CommandHandler(settings, tx, new StreamingService(NullLogger<StreamingService>.Instance, settings));
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
    public async Task ListCommand_AllowsNestedPathWhenAllowedRootIsDriveRoot()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "bp_drive_root_list_test_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        var f = Path.Combine(tmp, "inside.txt");
        await File.WriteAllTextAsync(f, "x");

        var root = Path.GetPathRoot(tmp) ?? tmp;
        var tx = new TestTransmission();
        var settings = Options.Create(new ProctorSettings
        {
            ClientId = "test-client",
            ServerUrl = "http://localhost:4000/api",
            ScreenshotPath = "%LOCALAPPDATA%\\BelfProctor\\Screenshots",
            LogPath = "%LOCALAPPDATA%\\BelfProctor\\Logs",
            ReportsPath = "%LOCALAPPDATA%\\BelfProctor\\Reports",
            DirectoryRoots = new List<string> { root }
        });
        var handler = new CommandHandler(settings, tx, new StreamingService(NullLogger<StreamingService>.Instance, settings));
        var cmd = new Command
        {
            Id = "cmd-root-list",
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
        var json = JObject.Parse(Encoding.UTF8.GetString(tx.LastJsonBytes!));
        var files = (JArray)json["files"]!;
        Assert.Contains(files, x => string.Equals((string?)x["fullPath"], f, StringComparison.OrdinalIgnoreCase));

        File.Delete(f);
        Directory.Delete(tmp);
    }

    [Fact]
    public async Task ListCommand_RejectsTraversalInSearchPattern()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "bp_pattern_test_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tmp);
        try
        {
            var tx = new TestTransmission();
            var settings = Options.Create(new ProctorSettings { DirectoryRoots = new List<string> { tmp } });
            var handler = new CommandHandler(settings, tx,
                new StreamingService(NullLogger<StreamingService>.Instance, settings));

            await handler.HandleAsync(new Command
            {
                Id = "cmd-pattern",
                Type = "list",
                Payload = new Dictionary<string, object>
                {
                    ["basePath"] = tmp,
                    ["pattern"] = "..\\*.json"
                }
            });

            var response = JObject.Parse(Encoding.UTF8.GetString(tx.LastJsonBytes!));
            Assert.Equal("invalid_pattern", (string?)response["error"]);
        }
        finally
        {
            Directory.Delete(tmp);
        }
    }


    [Fact]
    public async Task FileCommand_SendsFileResult()
    {
        var tmp = Path.Combine(Path.GetTempPath(), "bp_file_test");
        Directory.CreateDirectory(tmp);
        var f = Path.Combine(tmp, "c.bin");
        await File.WriteAllBytesAsync(f, Encoding.UTF8.GetBytes("data"));

        var tx = new TestTransmission();
        var settings = Options.Create(new ProctorSettings
        {
            ClientId = "test-client",
            ServerUrl = "http://localhost:4000/api",
            ScreenshotPath = "%LOCALAPPDATA%\\BelfProctor\\Screenshots",
            LogPath = "%LOCALAPPDATA%\\BelfProctor\\Logs",
            ReportsPath = "%LOCALAPPDATA%\\BelfProctor\\Reports",
            DirectoryRoots = new List<string> { tmp }
        });
        var handler = new CommandHandler(settings, tx, new StreamingService(NullLogger<StreamingService>.Instance, settings));
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

    [Fact]
    public async Task FileCommand_DeniesExistingFileOutsideConfiguredRoots()
    {
        var outside = Path.Combine(Path.GetTempPath(), "bp_denied_" + Guid.NewGuid().ToString("N") + ".txt");
        await File.WriteAllTextAsync(outside, "must-not-leave-agent");
        try
        {
            var tx = new TestTransmission();
            var settings = Settings();
            var handler = new CommandHandler(settings, tx,
                new StreamingService(NullLogger<StreamingService>.Instance, settings));

            await handler.HandleAsync(new Command
            {
                Id = "cmd-denied",
                Type = "file",
                Payload = new Dictionary<string, object> { ["path"] = outside }
            });

            Assert.Empty(tx.FileCalls);
        }
        finally
        {
            File.Delete(outside);
        }
    }

    private class TestTransmission : IDataTransmissionService
    {
        public int JsonCalls { get; private set; }
        public byte[]? LastJsonBytes { get; private set; }
        public List<(string, string)> FileCalls { get; } = new();
        public Task SendScreenshotAsync(string filePath, WorkScreenshotMetadata? metadata = null) => Task.CompletedTask;
        public Task SendSystemEventAsync(SystemEvent systemEvent) => Task.CompletedTask;
        public Task SendWorkEventsAsync(IEnumerable<WorkEventEnvelope> events) => Task.CompletedTask;
        public Task<bool> SendHeartbeatAsync() => Task.FromResult(true);
        public Task<byte[]> DownloadPolicyAsync(string policyId) => Task.FromResult(Array.Empty<byte>());
        public Task SendReportAsync(string reportPath) => Task.CompletedTask;
        public Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes) { JsonCalls++; LastJsonBytes = jsonBytes; return Task.CompletedTask; }
        public Task SendCommandResultFileAsync(string commandId, string filePath) { FileCalls.Add((commandId, filePath)); return Task.CompletedTask; }
        public Task SendActivityAsync(bool isActive, long cpuUsage, long memoryUsage) => Task.CompletedTask;
        public Task SendClientLogChunkAsync(string fileName, string text) => Task.CompletedTask;
        public Task SendPcSessionEventAsync(string kind, DateTime utcTimestamp, string bootId) => Task.CompletedTask;
        public Task SendBrowserActivityAsync(IReadOnlyList<BelfProctor.Models.BrowserVisit> visits) => Task.CompletedTask;
        public event Action? HeartbeatSucceeded { add { } remove { } }
    }
}
