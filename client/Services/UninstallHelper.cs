using System.Diagnostics;
using System.IO;
using BelfProctor.Models;
using Microsoft.Extensions.Logging;

namespace BelfProctor.Services;

public static class UninstallHelper
{
    private const string UninstallerName = "uninstall-windows-service.ps1";

    public static bool StartUninstall(ProctorSettings settings, ILogger? logger, string serviceName)
    {
        try
        {
            if (!string.Equals(serviceName, ServiceInstaller.ServiceName,
                    StringComparison.OrdinalIgnoreCase))
            {
                logger?.LogError("Refusing non-product uninstall service name");
                return false;
            }

            var installRoot = ResolveInstallRoot(AppContext.BaseDirectory);
            var scriptPath = Path.Combine(installRoot, UninstallerName);
            if (!File.Exists(scriptPath) ||
                (File.GetAttributes(scriptPath) & FileAttributes.ReparsePoint) != 0)
            {
                logger?.LogError("Signed uninstaller is missing or is a reparse point: {Path}", scriptPath);
                return false;
            }

            var trustedSigner = UpdateHelper.ResolveTrustedSignerThumbprint(
                settings.TrustedUpdateSignerThumbprint);
            if (!UpdateHelper.VerifyAuthenticodeSignature(scriptPath, trustedSigner, logger))
            {
                logger?.LogError("Refusing untrusted uninstaller: {Path}", scriptPath);
                return false;
            }

            var psi = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            foreach (var argument in new[]
            {
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "AllSigned",
                "-File",
                scriptPath,
                "-ServiceName",
                serviceName,
                "-InstallPath",
                installRoot,
                "-TrustedUpdateSignerThumbprint",
                trustedSigner,
                "-RemoveFiles",
            })
            {
                psi.ArgumentList.Add(argument);
            }

            var process = Process.Start(psi);
            if (process == null) return false;

            _ = Task.Run(async () =>
            {
                await Task.Delay(1500);
                Environment.Exit(0);
            });

            logger?.LogWarning(
                "Signed uninstall started (pid={Pid}, service={ServiceName}, path={InstallRoot})",
                process.Id,
                serviceName,
                installRoot);
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Failed to start signed uninstall");
            return false;
        }
    }

    internal static string ResolveInstallRoot(string baseDirectory)
    {
        var currentDirectory = Path.GetFullPath(baseDirectory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var parent = Directory.GetParent(currentDirectory);
        if (parent?.Name.Equals("versions", StringComparison.OrdinalIgnoreCase) == true)
        {
            return parent.Parent?.FullName
                ?? throw new InvalidOperationException("Versioned executable has no install root");
        }
        return currentDirectory;
    }
}
