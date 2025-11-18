namespace BelfProctor.Models;

public class Command
{
    public string Id { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public Dictionary<string, object> Payload { get; set; } = new();
}