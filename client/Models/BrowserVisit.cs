namespace BelfProctor.Models;

public class BrowserVisit
{
    public string Url { get; set; } = string.Empty;
    public string? Title { get; set; }
    public string Browser { get; set; } = string.Empty;
    public string? Profile { get; set; }
    public DateTime VisitedAtUtc { get; set; }
}
