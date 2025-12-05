namespace BelfProctor.Models;

public class SystemEvent
{
    public DateTime Timestamp { get; set; }
    public SystemEventType EventType { get; set; }
    public string Description { get; set; } = string.Empty;
    public string Details { get; set; } = string.Empty;
    public string? ProcessName { get; set; }
    public string? DeviceId { get; set; }
    public string? NetworkAddress { get; set; }
    public Dictionary<string, object> AdditionalData { get; set; } = new();
}

public enum SystemEventType
{
    ProcessStarted,
    ProcessStopped,
    USBConnected,
    USBDisconnected,
    NetworkConnection,
    NetworkDisconnection,
    FileAccess,
    RegistryAccess,
    PolicyViolation,
    ClipboardFileCopy,
    SystemError
}