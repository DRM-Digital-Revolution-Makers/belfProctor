using BelfProctor.Models;

namespace BelfProctor.Services;

public interface IReportingService
{
    Task GenerateStatusReportAsync();
    Task GenerateSecurityReportAsync();
    Task LogEventAsync(SystemEvent systemEvent);
    Task<string> GetSystemStatusAsync();
    Task ArchiveOldLogsAsync();
}