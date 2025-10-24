namespace BelfProctor.Models;

public class SecurityPolicy
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public bool IsActive { get; set; }
    public List<PolicyRule> Rules { get; set; } = new();
}

public class PolicyRule
{
    public string Id { get; set; } = string.Empty;
    public PolicyRuleType Type { get; set; }
    public PolicyAction Action { get; set; }
    public string Target { get; set; } = string.Empty;
    public Dictionary<string, object> Parameters { get; set; } = new();
    public bool IsEnabled { get; set; } = true;
}

public enum PolicyRuleType
{
    ProcessControl,
    USBControl,
    NetworkControl,
    FileAccess,
    RegistryAccess,
    ScreenshotControl
}

public enum PolicyAction
{
    Allow,
    Block,
    Monitor,
    Alert
}