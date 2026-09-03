namespace BelfProctor.Services;

/// <summary>
/// Canonical names shared by the installed service and desktop worker.
/// Installation is intentionally performed only by the signed administrative
/// installer. A self-installer could register a SYSTEM/Highest executable from
/// a user-writable directory and create a local privilege-escalation path.
/// </summary>
public static class ServiceInstaller
{
    public const string ServiceName = "BelfProctor";
    public const string DisplayName = "BelfProctor Agent";
    public const string AutoStartArg = "--auto-start";
    public const string ServiceHostArg = "--service-host";

}
