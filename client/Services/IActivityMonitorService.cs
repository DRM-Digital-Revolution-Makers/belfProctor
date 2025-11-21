namespace BelfProctor.Services;

public interface IActivityMonitorService
{
    bool IsUserActive { get; }
    TimeSpan ActiveElapsed { get; }
    TimeSpan InactiveElapsed { get; }
    event EventHandler<bool>? ActivityChanged;
    Task StartAsync(CancellationToken cancellationToken);
    Task StopAsync(CancellationToken cancellationToken);
}