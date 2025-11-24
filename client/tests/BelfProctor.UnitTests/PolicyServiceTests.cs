using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Xunit;

namespace BelfProctor.UnitTests;

public class PolicyServiceTests
{
    [Fact]
    public async Task CheckPolicyViolation_SendsEvent_WhenRuleMatches()
    {
        var tempLog = Path.Combine(Path.GetTempPath(), "BelfProctor_Test_Logs_" + Guid.NewGuid());
        Directory.CreateDirectory(tempLog);

        try
        {
            var settings = Options.Create(new ProctorSettings { LogPath = tempLog });
            var dt = new StubTransmission();
            var svc = new PolicyService(new NullLogger<PolicyService>(), settings, dt);

            // Apply a policy with a simple process rule
            var policy = new SecurityPolicy
            {
                Id = "p1",
                Name = "Block cmd",
                IsActive = true,
                Rules = new List<PolicyRule>
                {
                    new PolicyRule
                    {
                        Id = "r1",
                        Type = PolicyRuleType.ProcessControl,
                        Action = PolicyAction.Block,
                        Target = "cmd.exe",
                        IsEnabled = true
                    }
                }
            };
            await svc.ApplyPolicyAsync(policy);

            var evt = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.ProcessStarted,
                ProcessName = "cmd.exe",
                Description = "Process started"
            };

            var violated = await svc.CheckPolicyViolationAsync(evt);
            Assert.True(violated);
            Assert.Equal(1, dt.SystemEventCount);
        }
        finally
        {
            try { Directory.Delete(tempLog, true); } catch { }
        }
    }

    private class StubTransmission : IDataTransmissionService
    {
        public int SystemEventCount { get; private set; }
        public Task SendScreenshotAsync(string filePath) => Task.CompletedTask;
        public Task SendSystemEventAsync(SystemEvent systemEvent) { SystemEventCount++; return Task.CompletedTask; }
        public Task SendHeartbeatAsync() => Task.CompletedTask;
        public Task<byte[]> DownloadPolicyAsync(string policyId) => Task.FromResult(Array.Empty<byte>());
        public Task SendReportAsync(string reportPath) => Task.CompletedTask;
        public Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes) => Task.CompletedTask;
        public Task SendCommandResultFileAsync(string commandId, string filePath) => Task.CompletedTask;
        public Task SendActivityAsync(bool isActive, long timestamp, long sessionId) => Task.CompletedTask;
    }
}