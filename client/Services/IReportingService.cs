using BelfProctor.Models;

namespace BelfProctor.Services;

public interface IReportingService
{
    Task GenerateStatusReportAsync();
    Task GenerateDailyReportAsync();
    Task GenerateSecurityReportAsync();
    Task LogEventAsync(SystemEvent systemEvent);
    Task<string> GetSystemStatusAsync();
    Task ArchiveOldLogsAsync();
    Task GenerateDirectoryListingReportAsync();
}