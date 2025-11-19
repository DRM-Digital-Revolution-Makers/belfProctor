using BelfProctor.Models;
using BelfProctor.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Xunit;

namespace BelfProctor.IntegrationTests;

public class PolicyIntegrationTests
{
    [Fact]
    public async Task UpdatePoliciesFromServer_SavesFile_AndLoadsActivePolicies()
    {
        var tempLog = Path.Combine(Path.GetTempPath(), "BelfProctor_Policies_" + Guid.NewGuid());
        Directory.CreateDirectory(tempLog);

        try
        {
            var settings = Options.Create(new ProctorSettings { LogPath = tempLog });

            var policiesJson = "[" +
                "{\"Id\":\"p1\",\"Name\":\"Block cmd\",\"IsActive\":true,\"Rules\":[{" +
                "\"Id\":\"r1\",\"Type\":0,\"Action\":1,\"Target\":\"cmd.exe\",\"IsEnabled\":true}" +
                "]}" +
            "]";

            var dtMock = new Mock<IDataTransmissionService>(MockBehavior.Strict);
            dtMock.Setup(m => m.DownloadPolicyAsync("all"))
                  .ReturnsAsync(System.Text.Encoding.UTF8.GetBytes(policiesJson));

            var svc = new PolicyService(new NullLogger<PolicyService>(), settings, dtMock.Object);

            await svc.UpdatePoliciesFromServerAsync();

            var active = await svc.GetActivePoliciesAsync();
            Assert.Single(active);
            Assert.Equal("p1", active[0].Id);

            var policyFile = Path.Combine(tempLog, "policies.json");
            Assert.True(File.Exists(policyFile));
            var saved = await File.ReadAllTextAsync(policyFile);
            Assert.Contains("\"p1\"", saved);
        }
        finally
        {
            try { Directory.Delete(tempLog, true); } catch { }
        }
    }
}