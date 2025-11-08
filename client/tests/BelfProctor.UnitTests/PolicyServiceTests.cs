using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
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

            var dtMock = new Mock<IDataTransmissionService>(MockBehavior.Strict);
            dtMock.Setup(m => m.SendSystemEventAsync(It.IsAny<SystemEvent>())).Returns(Task.CompletedTask).Verifiable();

            var svc = new PolicyService(new NullLogger<PolicyService>(), settings, dtMock.Object);

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
                        IsEnabled = true,
                        Parameters = new Dictionary<string, object> { ["blocked"] = new List<string> { "cmd.exe" } }
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
            dtMock.Verify(m => m.SendSystemEventAsync(It.IsAny<SystemEvent>()), Times.Once);
        }
        finally
        {
            try { Directory.Delete(tempLog, true); } catch { }
        }
    }
}