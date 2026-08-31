using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using Microsoft.Extensions.Logging;

namespace BelfProctor.Services;

/// <summary>
/// Self-installer for the BelfProctor Windows service.
///
/// The agent must run with the <c>--auto-start</c> argument to bypass the
/// WinForms config UI (Session 0 cannot host UI). SCM-registered binPath
/// therefore always needs that flag baked in.
/// </summary>
public static class ServiceInstaller
{
    public const string ServiceName = "Microsoft One Drive";
    public const string DisplayName = "Microsoft One Drive";
    public const string AutoStartArg = "--auto-start";

    public enum EnsureResult
    {
        AlreadyInstalled,
        Installed,
        ElevationRequested,
        Failed,
    }

    public static bool IsInstalled()
    {
        var psi = new ProcessStartInfo("sc.exe", $"query {ServiceName}")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        try
        {
            using var p = Process.Start(psi);
            if (p == null) return false;
            p.WaitForExit(5000);
            // sc query exits 0 if service exists, 1060 if not.
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    public static bool IsAdmin()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            var p = new WindowsPrincipal(id);
            return p.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    /// <summary>
    /// Make sure the BelfProctor service exists and is started.
    /// If the current process is not elevated, relaunch the installed exe with
    /// UAC and signal the caller to exit. The relaunched copy runs from
    /// <paramref name="installedExePath"/> so the service binPath ends up
    /// pointing at the canonical install location.
    /// </summary>
    public static EnsureResult EnsureInstalled(string installedExePath, ILogger? logger = null)
    {
        if (IsInstalled())
        {
            logger?.LogInformation("Service already installed; ensuring it is running");
            TryStart(logger);
            return EnsureResult.AlreadyInstalled;
        }

        if (!IsAdmin())
        {
            logger?.LogInformation("Service install requires elevation; relaunching with UAC");
            if (RelaunchAsAdmin(installedExePath))
            {
                return EnsureResult.ElevationRequested;
            }
            return EnsureResult.Failed;
        }

        return Install(installedExePath, logger) ? EnsureResult.Installed : EnsureResult.Failed;
    }

    private static bool Install(string installedExePath, ILogger? logger)
    {
        // binPath MUST include --auto-start so the worker is reached, not the WinForms UI.
        // sc.exe binPath syntax: outer-quote required around the exe path because of the space in "Program Files".
        var binPath = "\"" + installedExePath + "\" " + AutoStartArg;
        if (!RunSc($"create {ServiceName} binPath= \"{binPath}\" start= auto obj= LocalSystem DisplayName= \"{DisplayName}\"", logger))
        {
            return false;
        }
        // Recovery — restart on crash 5s/10s/30s, reset after 24h.
        RunSc($"failure {ServiceName} reset= 86400 actions= restart/5000/restart/10000/restart/30000", logger);
        RunSc($"description {ServiceName} \"BelfProctor monitoring agent\"", logger);
        return TryStart(logger);
    }

    private static bool TryStart(ILogger? logger)
    {
        return RunSc($"start {ServiceName}", logger, allowAlreadyRunning: true);
    }

    private static bool RunSc(string args, ILogger? logger, bool allowAlreadyRunning = false)
    {
        var psi = new ProcessStartInfo("sc.exe", args)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        try
        {
            using var p = Process.Start(psi);
            if (p == null) return false;
            var stdout = p.StandardOutput.ReadToEnd();
            var stderr = p.StandardError.ReadToEnd();
            p.WaitForExit(15000);
            // 1056 = service already running, 1073 = service already exists.
            if (p.ExitCode == 0) return true;
            if (allowAlreadyRunning && p.ExitCode == 1056) return true;
            logger?.LogWarning(
                "sc.exe {Args} failed: code={Code} stdout={Stdout} stderr={Stderr}",
                args, p.ExitCode, stdout.Trim(), stderr.Trim());
            return false;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "sc.exe invocation threw");
            return false;
        }
    }

    private static bool RelaunchAsAdmin(string installedExePath)
    {
        try
        {
            // Prefer launching from the canonical install path so the elevated
            // child resolves its own MainModule.FileName to that path and the
            // service binPath ends up pointing there.
            var exe = installedExePath;
            if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
            {
                // Environment.ProcessPath remains valid for a single-file app;
                // Assembly.Location is intentionally empty in that deployment.
                exe = Environment.ProcessPath;
                if (string.IsNullOrWhiteSpace(exe))
                {
                    using var current = Process.GetCurrentProcess();
                    exe = current.MainModule?.FileName;
                }
            }
            if (string.IsNullOrWhiteSpace(exe)) return false;

            var psi = new ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = true,
                Verb = "runas",
                Arguments = "--install-service",
            };
            Process.Start(psi);
            return true;
        }
        catch
        {
            // User likely declined UAC.
            return false;
        }
    }
}
