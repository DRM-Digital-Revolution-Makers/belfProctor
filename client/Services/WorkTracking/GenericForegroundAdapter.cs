namespace BelfProctor.Services.WorkTracking;

public class GenericForegroundAdapter : IAppAdapter
{
    public string Name => "generic.foreground";

    public bool CanHandle(ForegroundWindowSnapshot snapshot) => true;

    public WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot)
    {
        return new WorkArtifactCandidate
        {
            Adapter = Name,
            ProcessName = snapshot.ProcessName,
            WindowTitle = snapshot.WindowTitle,
            Confidence = string.IsNullOrWhiteSpace(snapshot.WindowTitle) ? "low" : "medium",
        };
    }
}
