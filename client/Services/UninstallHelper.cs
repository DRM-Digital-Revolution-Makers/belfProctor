using System.Diagnostics;
using System.IO;
using BelfProctor.Models;
using Microsoft.Extensions.Logging;

namespace BelfProctor.Services;

public static class UninstallHelper
{
    public static bool StartUninstall(ProctorSettings settings, ILogger? logger, string serviceName)
    {
        try
        {
            var installRoot = ResolveInstallRoot(settings);
            var safeService = ResolveServiceName(serviceName, logger);
            var baseDir = AppContext.BaseDirectory ?? string.Empty;
            var sourceScriptPath = ResolveUninstallScriptPath(baseDir);
            if (sourceScriptPath == null)
            {
                logger?.LogError("Uninstall script not found near base directory {BaseDir}", baseDir);
                return false;
            }

            var tempDir = Path.Combine(Path.GetTempPath(), "BelfProctor");
            Directory.CreateDirectory(tempDir);
            var scriptPath = Path.Combine(tempDir, $"uninstall_{DateTime.Now:yyyyMMdd_HHmmss_fff}.ps1");
            File.Copy(sourceScriptPath, scriptPath, overwrite: true);

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-WindowStyle");
            psi.ArgumentList.Add("Hidden");
            psi.ArgumentList.Add("-File");
            psi.ArgumentList.Add(scriptPath);
            psi.ArgumentList.Add("-ServiceName");
            psi.ArgumentList.Add(safeService);
            psi.ArgumentList.Add("-InstallRoot");
            psi.ArgumentList.Add(installRoot);
            psi.ArgumentList.Add("-BaseDir");
            psi.ArgumentList.Add(baseDir);
            Process.Start(psi);

            _ = Task.Run(async () =>
            {
                await Task.Delay(1500);
                Environment.Exit(0);
            });

            logger?.LogWarning("Uninstall started (service={ServiceName}, path={InstallRoot})", safeService, installRoot);
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Failed to start uninstall");
            return false;
        }
    }

    private static string ResolveInstallRoot(ProctorSettings settings)
    {
        try
        {
            var shot = settings.ScreenshotPath ?? string.Empty;
            if (!string.IsNullOrWhiteSpace(shot))
            {
                var expanded = Environment.ExpandEnvironmentVariables(shot);
                var dir = Path.GetDirectoryName(expanded) ?? string.Empty;
                if (!string.IsNullOrWhiteSpace(dir)) return dir;
            }
        }
        catch { }

        return @"C:\Program Files\BelfProctor";
    }

    private static string ResolveServiceName(string serviceName, ILogger? logger)
    {
        var requested = serviceName?.Trim();
        if (string.IsNullOrWhiteSpace(requested)) return "BelfProctor";

        if (string.Equals(requested, "BelfProctor", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(requested, ServiceInstaller.ServiceName, StringComparison.OrdinalIgnoreCase))
        {
            return requested;
        }

        logger?.LogWarning("Ignoring unsupported uninstall service name: {ServiceName}", requested);
        return "BelfProctor";
    }

    private static string? ResolveUninstallScriptPath(string baseDir)
    {
        var candidates = new[]
        {
            Path.Combine(baseDir, "uninstall.ps1"),
            Path.Combine(baseDir, "scripts", "uninstall.ps1")
        };

        foreach (var candidate in candidates)
        {
            try
            {
                var fullPath = Path.GetFullPath(candidate);
                if (File.Exists(fullPath)) return fullPath;
            }
            catch { }
        }

        return null;
    }
}
