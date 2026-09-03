using System.Text.RegularExpressions;

namespace BelfProctor.Services.WorkTracking;

public class PdfGenericAdapter : IAppAdapter
{
    private static readonly HashSet<string> Processes = new(StringComparer.OrdinalIgnoreCase)
    {
        "acrord32", "acrobat", "sumatrapdf", "foxitpdfreader", "pdfxedit"
    };

    public string Name => "pdf.generic";

    public bool CanHandle(ForegroundWindowSnapshot snapshot)
    {
        var process = (snapshot.ProcessName ?? string.Empty).Replace(".exe", string.Empty);
        return Processes.Contains(process) || snapshot.WindowTitle.Contains(".pdf", StringComparison.OrdinalIgnoreCase);
    }

    public WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot)
    {
        var match = Regex.Match(snapshot.WindowTitle ?? string.Empty, @"[^\\/:*?""<>|]+\.pdf", RegexOptions.IgnoreCase);
        return new WorkArtifactCandidate
        {
            Adapter = Name,
            ProcessName = snapshot.ProcessName,
            WindowTitle = snapshot.WindowTitle,
            FilePath = match.Success ? match.Value : null,
            Confidence = match.Success ? "medium" : "low",
        };
    }
}
