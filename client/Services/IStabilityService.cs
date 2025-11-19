namespace BelfProctor.Services;

public interface IStabilityService
{
    Task StartAsync(CancellationToken cancellationToken);
    Task StopAsync(CancellationToken cancellationToken);
    Task<bool> CheckHealthAsync();
    Task RestartServiceAsync();
    bool IsHealthy { get; }
}