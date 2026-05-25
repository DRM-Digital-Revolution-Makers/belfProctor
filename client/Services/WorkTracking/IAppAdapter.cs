namespace BelfProctor.Services.WorkTracking;

public interface IAppAdapter
{
    string Name { get; }
    bool CanHandle(ForegroundWindowSnapshot snapshot);
    WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot);
}
