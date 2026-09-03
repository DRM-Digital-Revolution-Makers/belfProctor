using System.Diagnostics;
using System.IO;
using System.Management;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace BelfProctor.Services;

/// <summary>
/// Lightweight Session-0 service. Desktop capture cannot run from a Windows
/// service, so this supervisor keeps the interactive scheduled-task agent alive
/// while SCM supplies automatic start and crash recovery.
/// </summary>
public sealed class DesktopAgentSupervisor : BackgroundService
{
    public const string ScheduledTaskName = "BelfProctor-Desktop";
    private readonly ILogger<DesktopAgentSupervisor> _logger;

    public DesktopAgentSupervisor(ILogger<DesktopAgentSupervisor> logger) => _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("BelfProctor desktop-agent supervisor started");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!HasInteractiveAgent()) StartScheduledAgent();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Desktop-agent supervision iteration failed");
            }

            try { await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        }
    }

    internal static bool HasInteractiveAgent()
    {
        using var current = Process.GetCurrentProcess();
        var expectedExecutable = Environment.ProcessPath ?? current.MainModule?.FileName;
        if (string.IsNullOrWhiteSpace(expectedExecutable)) return false;
        try
        {
            using var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, SessionId, ExecutablePath, CommandLine " +
                "FROM Win32_Process WHERE Name='BelfProctor.exe'");
            using var processes = searcher.Get();
            foreach (ManagementObject process in processes)
            {
                var processId = Convert.ToUInt32(process["ProcessId"] ?? 0U);
                var sessionId = Convert.ToUInt32(process["SessionId"] ?? 0U);
                var executable = Convert.ToString(process["ExecutablePath"]) ?? string.Empty;
                var commandLine = Convert.ToString(process["CommandLine"]) ?? string.Empty;
                if (processId != current.Id && sessionId > 0 &&
                    string.Equals(Path.GetFullPath(executable), Path.GetFullPath(expectedExecutable),
                        StringComparison.OrdinalIgnoreCase) &&
                    commandLine.Contains(ServiceInstaller.AutoStartArg, StringComparison.OrdinalIgnoreCase))
                    return true;
            }
        }
        catch { }
        return false;
    }

    private void StartScheduledAgent()
    {
        var psi = new ProcessStartInfo("schtasks.exe", $"/Run /TN \"{ScheduledTaskName}\"")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var process = Process.Start(psi);
        if (process == null) return;
        process.WaitForExit(10_000);
        if (process.ExitCode != 0)
        {
            _logger.LogDebug("Scheduled desktop agent is not runnable (no logged-on user or task missing): {Error}",
                process.StandardError.ReadToEnd().Trim());
        }
    }
}
