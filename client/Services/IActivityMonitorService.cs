namespace BelfProctor.Services;

public interface IActivityMonitorService
{
    bool IsUserActive { get; }
    TimeSpan ActiveElapsed { get; }
    event EventHandler<bool>? ActivityChanged;
    Task StartAsync(CancellationToken cancellationToken);
    Task StopAsync(CancellationToken cancellationToken);
}