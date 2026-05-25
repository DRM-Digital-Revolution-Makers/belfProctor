using BelfProctor.Models;

namespace BelfProctor.Services;

public interface IDataTransmissionService
{
    Task SendScreenshotAsync(string filePath, WorkScreenshotMetadata? metadata = null);
    Task SendSystemEventAsync(SystemEvent systemEvent);
    Task SendWorkEventsAsync(IEnumerable<WorkEventEnvelope> events);
    Task<bool> SendHeartbeatAsync();
    Task<byte[]> DownloadPolicyAsync(string policyId);
    Task SendReportAsync(string reportPath);
    Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes);
    Task SendCommandResultFileAsync(string commandId, string filePath);
    Task SendActivityAsync(bool isActive, long activeMilliseconds, long inactiveMilliseconds);
    Task SendClientLogChunkAsync(string fileName, string text);
}
