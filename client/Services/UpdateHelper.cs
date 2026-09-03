using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using BelfProctor.Models;
using Microsoft.Extensions.Logging;

namespace BelfProctor.Services;

public static class UpdateHelper
{
    private const string ServiceName = "BelfProctor";
    private const string InstalledExeName = "BelfProctor.exe";
    private const int IdleThresholdSeconds = 60;
    private const int IdleWaitTimeoutMinutes = 60;
    private const int ChunkSize = 64 * 1024;
    private const int InterChunkDelayMs = 50;

    private static readonly string TempRoot =
        Path.Combine(Path.GetTempPath(), "BelfProctor", "update");
    private static readonly string LockFile = Path.Combine(TempRoot, "update.lock");

    public static async Task<bool> DownloadAndInstall(
        ProctorSettings settings,
        ILogger? logger,
        string downloadUrl,
        string sha256Expected,
        string newVersion,
        Func<string, string, Task>? progressCallback = null)
    {
        if (!settings.Features.UpdateV2)
        {
            if (progressCallback != null) await progressCallback("failed", "update_v2_disabled");
            return false;
        }

        try { Directory.CreateDirectory(TempRoot); } catch { }
        await using var lockStream = await TryAcquireLockAsync(logger);
        if (lockStream == null) return false;

        try
        {
            TryLowerSelfPriority();

            var currentVersion = GetCurrentVersion();
            if (!string.IsNullOrWhiteSpace(newVersion) &&
                string.Equals(currentVersion, newVersion, StringComparison.OrdinalIgnoreCase))
            {
                if (progressCallback != null) await progressCallback("already_up_to_date", currentVersion);
                return true;
            }

            if (progressCallback != null) await progressCallback("downloading", "0%");
            var downloadedPath = Path.Combine(TempRoot, $"BelfProctor_{DateTime.UtcNow:yyyyMMdd_HHmmss}.exe");
            if (!await DownloadFile(settings, logger, downloadUrl, downloadedPath, progressCallback))
            {
                if (progressCallback != null) await progressCallback("failed", "download_failed");
                return false;
            }

            if (progressCallback != null) await progressCallback("verifying", "");
            var actualHash = ComputeSha256(downloadedPath);
            var expectedHash = (sha256Expected ?? "").Trim().ToLowerInvariant();
            if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                TryDelete(downloadedPath);
                logger?.LogError("SHA-256 mismatch. expected={Expected} actual={Actual}", expectedHash, actualHash);
                if (progressCallback != null) await progressCallback("failed", "hash_mismatch");
                return false;
            }

            if (progressCallback != null) await progressCallback("installing", newVersion);
            await WaitForUserIdle(logger);

            if (!LaunchHiddenVersionSwitchScript(logger, downloadedPath, newVersion))
            {
                TryDelete(downloadedPath);
                if (progressCallback != null) await progressCallback("failed", "script_launch_failed");
                return false;
            }

            if (progressCallback != null) await progressCallback("restarted", newVersion);
            _ = Task.Run(async () =>
            {
                await Task.Delay(2500);
                try { Environment.Exit(0); } catch { }
            });
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "UpdateHelper failed");
            if (progressCallback != null)
            {
                try { await progressCallback("failed", ex.Message); } catch { }
            }
            return false;
        }
    }

    private static async Task<FileStream?> TryAcquireLockAsync(ILogger? logger)
    {
        try
        {
            var stream = new FileStream(
                LockFile,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 4096,
                options: FileOptions.DeleteOnClose);
            var info = Encoding.UTF8.GetBytes($"pid={Environment.ProcessId} ts={DateTime.UtcNow:o}\n");
            await stream.WriteAsync(info, 0, info.Length);
            await stream.FlushAsync();
            return stream;
        }
        catch (IOException)
        {
            logger?.LogWarning("Could not acquire update lock");
            return null;
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "Could not acquire update lock");
            return null;
        }
    }

    private static string GetCurrentVersion()
    {
        try
        {
            return Assembly.GetEntryAssembly()?.GetName().Version?.ToString(3)
                ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
                ?? "1.0.0";
        }
        catch { return "1.0.0"; }
    }

    private static void TryLowerSelfPriority()
    {
        try { using var p = Process.GetCurrentProcess(); p.PriorityClass = ProcessPriorityClass.BelowNormal; }
        catch { }
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static async Task<bool> DownloadFile(
        ProctorSettings settings,
        ILogger? logger,
        string url,
        string destPath,
        Func<string, string, Task>? progress)
    {
        try
        {
            using var handler = new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = true };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(15) };
            http.DefaultRequestHeaders.Add("User-Agent", "BelfProctor-Updater/2.0");
            if (!string.IsNullOrWhiteSpace(settings.ClientId))
                http.DefaultRequestHeaders.Add("X-Client-Id", settings.ClientId);

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            if (!resp.IsSuccessStatusCode)
            {
                logger?.LogError("Update download failed: {Code}", resp.StatusCode);
                return false;
            }

            var total = resp.Content.Headers.ContentLength ?? -1;
            using var src = await resp.Content.ReadAsStreamAsync();
            using var dst = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None);
            var buffer = new byte[ChunkSize];
            long got = 0;
            var lastPercent = -1;
            int read;
            while ((read = await src.ReadAsync(buffer, 0, buffer.Length)) > 0)
            {
                await dst.WriteAsync(buffer, 0, read);
                got += read;
                if (InterChunkDelayMs > 0) await Task.Delay(InterChunkDelayMs);
                if (total > 0 && progress != null)
                {
                    var percent = (int)((got * 100) / total);
                    if (percent >= lastPercent + 10)
                    {
                        lastPercent = percent;
                        try { await progress("downloading", $"{percent}%"); } catch { }
                    }
                }
            }
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Update download failed");
            TryDelete(destPath);
            return false;
        }
    }

    private static string ComputeSha256(string path)
    {
        using var sha = SHA256.Create();
        using var fs = File.OpenRead(path);
        var hash = sha.ComputeHash(fs);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.AppendFormat("{0:x2}", b);
        return sb.ToString();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    private static uint GetIdleSeconds()
    {
        try
        {
            var lii = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
            if (!GetLastInputInfo(ref lii)) return uint.MaxValue;
            var tick = (uint)Environment.TickCount;
            return (tick - lii.dwTime) / 1000;
        }
        catch
        {
            return uint.MaxValue;
        }
    }

    private static async Task WaitForUserIdle(ILogger? logger)
    {
        var deadline = DateTime.UtcNow.AddMinutes(IdleWaitTimeoutMinutes);
        while (DateTime.UtcNow < deadline)
        {
            var idle = GetIdleSeconds();
            if (idle >= IdleThresholdSeconds)
            {
                logger?.LogInformation("User idle for {Seconds}s, proceeding with update", idle);
                return;
            }
            await Task.Delay(TimeSpan.FromSeconds(30));
        }
        logger?.LogInformation("Idle wait timeout, proceeding with update");
    }

    private static bool LaunchHiddenVersionSwitchScript(ILogger? logger, string stagedExePath, string newVersion)
    {
        try
        {
            Directory.CreateDirectory(TempRoot);

            var currentExe = Process.GetCurrentProcess().MainModule?.FileName
                ?? Path.Combine(AppContext.BaseDirectory, InstalledExeName);
            var installRoot = FindInstallRoot(currentExe);
            var safeVersion = SanitizeVersion(newVersion);
            var versionDir = Path.Combine(installRoot, "versions", safeVersion);
            var targetExe = Path.Combine(versionDir, InstalledExeName);
            var logPath = Path.Combine(TempRoot, $"update_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.log");
            var scriptPath = Path.Combine(TempRoot, $"update_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.ps1");
            var sourceScriptPath = ResolveUpdateScriptPath(AppContext.BaseDirectory);
            if (sourceScriptPath == null)
            {
                logger?.LogError("Update helper script not found near base directory {BaseDir}", AppContext.BaseDirectory);
                return false;
            }

            File.Copy(sourceScriptPath, scriptPath, overwrite: true);
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-NonInteractive");
            psi.ArgumentList.Add("-WindowStyle");
            psi.ArgumentList.Add("Hidden");
            psi.ArgumentList.Add("-File");
            psi.ArgumentList.Add(scriptPath);
            psi.ArgumentList.Add("-ServiceName");
            psi.ArgumentList.Add(ServiceName);
            psi.ArgumentList.Add("-CurrentExe");
            psi.ArgumentList.Add(currentExe);
            psi.ArgumentList.Add("-StagedExe");
            psi.ArgumentList.Add(stagedExePath);
            psi.ArgumentList.Add("-VersionDir");
            psi.ArgumentList.Add(versionDir);
            psi.ArgumentList.Add("-TargetExe");
            psi.ArgumentList.Add(targetExe);
            psi.ArgumentList.Add("-InstallRoot");
            psi.ArgumentList.Add(installRoot);
            psi.ArgumentList.Add("-LockFile");
            psi.ArgumentList.Add(LockFile);
            psi.ArgumentList.Add("-LogPath");
            psi.ArgumentList.Add(logPath);
            var proc = Process.Start(psi);
            if (proc == null) return false;
            try { proc.PriorityClass = ProcessPriorityClass.Idle; } catch { }
            logger?.LogInformation("Versioned update script started (pid={Pid})", proc.Id);
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Failed to launch versioned update script");
            return false;
        }
    }

    private static string FindInstallRoot(string currentExe)
    {
        var dir = Path.GetDirectoryName(currentExe) ?? @"C:\Program Files\BelfProctor";
        var parent = Directory.GetParent(dir);
        if (parent?.Name.Equals("versions", StringComparison.OrdinalIgnoreCase) == true)
        {
            return parent.Parent?.FullName ?? @"C:\Program Files\BelfProctor";
        }
        return dir;
    }

    private static string SanitizeVersion(string version)
    {
        var raw = string.IsNullOrWhiteSpace(version) ? DateTime.UtcNow.ToString("yyyyMMddHHmmss") : version.Trim();
        var chars = raw.Select(c => char.IsLetterOrDigit(c) || c == '.' || c == '-' || c == '_' ? c : '_').ToArray();
        return new string(chars);
    }

    private static string? ResolveUpdateScriptPath(string baseDir)
    {
        var candidates = new[]
        {
            Path.Combine(baseDir, "update-helper.ps1"),
            Path.Combine(baseDir, "scripts", "update-helper.ps1")
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
