namespace BelfProctor.Services.WorkTracking;

public class WorkArtifactCandidate
{
    public string Adapter { get; set; } = "generic";
    public string ProcessName { get; set; } = string.Empty;
    public string WindowTitle { get; set; } = string.Empty;
    public string? FilePath { get; set; }
    public string? FolderPath { get; set; }
    public string? ProjectName { get; set; }
    public string Confidence { get; set; } = "unknown";
    public Dictionary<string, object?> Metadata { get; set; } = new();

    public string SessionKey
    {
        get
        {
            var artifact = !string.IsNullOrWhiteSpace(FilePath)
                ? FilePath
                : $"{ProcessName}:{WindowTitle}";
            return $"{Adapter}:{artifact}".ToLowerInvariant();
        }
    }
}
