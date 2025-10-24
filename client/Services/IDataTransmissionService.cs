using BelfProctor.Models;

namespace BelfProctor.Services;

public interface IDataTransmissionService
{
    Task SendScreenshotAsync(string filePath);
    Task SendSystemEventAsync(SystemEvent systemEvent);
    Task SendHeartbeatAsync();
    Task<byte[]> DownloadPolicyAsync(string policyId);
    Task SendReportAsync(string reportPath);
}