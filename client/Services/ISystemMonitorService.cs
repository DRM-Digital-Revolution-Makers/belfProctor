using BelfProctor.Models;

namespace BelfProctor.Services;

public interface ISystemMonitorService
{
    Task StartAsync(CancellationToken cancellationToken);
    Task StopAsync(CancellationToken cancellationToken);
    event EventHandler<SystemEvent> SystemEventOccurred;
    Task<List<SystemEvent>> GetRecentEventsAsync(TimeSpan timeSpan);
}