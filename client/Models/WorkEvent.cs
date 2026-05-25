namespace BelfProctor.Models;

public class WorkEventEnvelope
{
    public string EventId { get; set; } = Guid.NewGuid().ToString("N");
    public int SchemaVersion { get; set; } = 1;
    public string ClientId { get; set; } = string.Empty;
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;
    public string EventType { get; set; } = "snapshot";
    public string SourceVersion { get; set; } = string.Empty;
    public WorkSessionPayload Payload { get; set; } = new();
}

public class WorkSessionPayload
{
    public string SessionId { get; set; } = string.Empty;
    public string Adapter { get; set; } = "generic";
    public string ProcessName { get; set; } = string.Empty;
    public string WindowTitle { get; set; } = string.Empty;
    public string? FilePath { get; set; }
    public string? FolderPath { get; set; }
    public string? ProjectName { get; set; }
    public long OpenedMs { get; set; }
    public long FocusedMs { get; set; }
    public long ActiveFocusedMs { get; set; }
    public string Confidence { get; set; } = "unknown";
    public string EndReason { get; set; } = "active";
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? EndedAt { get; set; }
    public Dictionary<string, object?> Metadata { get; set; } = new();
}

public class WorkScreenshotMetadata
{
    public string CaptureReason { get; set; } = "scheduled";
    public string? LinkedSessionId { get; set; }
    public string? ProcessName { get; set; }
    public string? FilePath { get; set; }
    public string? ProjectName { get; set; }
}

public class FeatureSettings
{
    public bool UpdateV2 { get; set; } = true;
    public bool WorkTracking { get; set; } = true;
    public bool ProjectMapping { get; set; } = true;
    public bool LiveView { get; set; } = true;
    public bool RulesClassifier { get; set; } = true;
}
