using System.Text.RegularExpressions;

namespace BelfProctor.Services.WorkTracking;

public class BrowserAdapter : IAppAdapter
{
    private static readonly HashSet<string> Processes = new(StringComparer.OrdinalIgnoreCase)
    {
        "chrome", "msedge", "browser", "yandex", "opera", "firefox"
    };

    public string Name => "browser.generic";

    public bool CanHandle(ForegroundWindowSnapshot snapshot)
    {
        return Processes.Contains((snapshot.ProcessName ?? string.Empty).Replace(".exe", string.Empty));
    }

    public WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot)
    {
        var domain = ExtractDomain(snapshot.WindowTitle);
        return new WorkArtifactCandidate
        {
            Adapter = Name,
            ProcessName = snapshot.ProcessName,
            WindowTitle = snapshot.WindowTitle,
            Confidence = domain == null ? "low" : "medium",
            Metadata = new Dictionary<string, object?> { ["domain"] = domain },
        };
    }

    private static string? ExtractDomain(string title)
    {
        var match = Regex.Match(title ?? string.Empty, @"([a-z0-9-]+\.)+[a-z]{2,}", RegexOptions.IgnoreCase);
        return match.Success ? match.Value.ToLowerInvariant() : null;
    }
}
