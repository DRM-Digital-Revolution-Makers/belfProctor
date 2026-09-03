using System.Text.RegularExpressions;

namespace BelfProctor.Services.WorkTracking;

public class OfficeGenericAdapter : IAppAdapter
{
    private static readonly HashSet<string> Processes = new(StringComparer.OrdinalIgnoreCase)
    {
        "winword", "excel", "powerpnt"
    };

    public string Name => "office.generic";

    public bool CanHandle(ForegroundWindowSnapshot snapshot)
    {
        return Processes.Contains((snapshot.ProcessName ?? string.Empty).Replace(".exe", string.Empty));
    }

    public WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot)
    {
        var fileName = ExtractOfficeName(snapshot.WindowTitle);
        return new WorkArtifactCandidate
        {
            Adapter = Name,
            ProcessName = snapshot.ProcessName,
            WindowTitle = snapshot.WindowTitle,
            FilePath = fileName,
            FolderPath = null,
            Confidence = string.IsNullOrWhiteSpace(fileName) ? "low" : "medium",
        };
    }

    private static string? ExtractOfficeName(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var normalized = title.Replace(" - Word", "", StringComparison.OrdinalIgnoreCase)
            .Replace(" - Excel", "", StringComparison.OrdinalIgnoreCase)
            .Replace(" - PowerPoint", "", StringComparison.OrdinalIgnoreCase)
            .Trim();
        var match = Regex.Match(normalized, @"[^\\/:*?""<>|]+\.(docx?|xlsx?|pptx?)", RegexOptions.IgnoreCase);
        return match.Success ? match.Value : normalized;
    }
}
