using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using BelfProctor.Models;
using Microsoft.Extensions.Logging;

namespace BelfProctor.Services;

/// <summary>
/// Silent background self-update helper.
/// Downloads new exe with low priority, verifies SHA-256, waits for user
/// to be idle, then spawns a detached hidden PowerShell script that does
/// Stop-Service → replace .exe → Start-Service with rollback on failure.
///
/// Resource budget per spec:
///   CPU < 5% avg (BelowNormal/Idle priority)
///   RAM < 30 MB (streamed download, streamed SHA)
///   Network ~1.3 MB/s (64KB chunks with 50ms delay)
///   UI: zero windows, zero notifications
/// </summary>
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

    /// <summary>
    /// Download a new client exe and schedule a silent self-replace.
    /// Returns true if update was successfully scheduled (PS-script
    /// started; process exit is imminent). Returns false on any
    /// failure (caller should report status back to server).
    /// </summary>
    public static async Task<bool> DownloadAndInstall(
        ProctorSettings settings,
        ILogger? logger,
        string downloadUrl,
        string sha256Expected,
        string newVersion,
        Func<string, string, Task>? progressCallback = null)
    {
        // Self-cleaning lock.
        // FileOptions.DeleteOnClose tells Windows to delete the file when the
        // last handle is closed — including when the process crashes/terminates.
        // This means stale lock files from previous failed updates simply
        // cannot accumulate on disk. As an extra safety net, if a lock somehow
        // remains (e.g. antivirus held a handle), we force-delete it after
        // 5 minutes instead of the previous 2 hours.
        try { Directory.CreateDirectory(TempRoot); } catch { }

        FileStream? lockStream = null;
        try
        {
            lockStream = new FileStream(
                LockFile,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                bufferSize: 4096,
                options: FileOptions.DeleteOnClose);
            var info = System.Text.Encoding.UTF8.GetBytes(
                $"pid={Environment.ProcessId} ts={DateTime.UtcNow:o}\n");
            await lockStream.WriteAsync(info, 0, info.Length);
            await lockStream.FlushAsync();
        }
        catch (IOException)
        {
            // Another process holds the lock OR antivirus is scanning.
            // If the stale file is older than 5 min, force-clear and retry once.
            try
            {
                if (File.Exists(LockFile))
                {
                    var age = DateTime.UtcNow - File.GetLastWriteTimeUtc(LockFile);
                    if (age.TotalMinutes >= 5)
                    {
                        File.Delete(LockFile);
                        lockStream = new FileStream(
                            LockFile,
                            FileMode.Create,
                            FileAccess.Write,
                            FileShare.None,
                            bufferSize: 4096,
                            options: FileOptions.DeleteOnClose);
                    }
                }
            }
            catch { }
            if (lockStream == null)
            {
                logger?.LogWarning("Could not acquire update lock (another update may be running)");
                return false;
            }
        }
        catch (Exception ex)
        {
            logger?.LogWarning(ex, "Could not acquire update lock");
            return false;
        }

        try
        {
            // Lower our own priority for the whole flow so user apps remain snappy.
            TryLowerSelfPriority();

            // Skip if already on the requested version.
            var currentVersion = GetCurrentVersion();
            if (!string.IsNullOrWhiteSpace(newVersion) &&
                string.Equals(currentVersion, newVersion, StringComparison.OrdinalIgnoreCase))
            {
                logger?.LogInformation("Already at version {V}, skipping update", newVersion);
                if (progressCallback != null) await progressCallback("already_up_to_date", currentVersion);
                return true;
            }

            // === Phase 1: download (chunked, throttled, streaming) ===
            if (progressCallback != null) await progressCallback("downloading", "0%");
            var downloadedPath = Path.Combine(
                TempRoot,
                $"BelfProctor_{DateTime.UtcNow:yyyyMMdd_HHmmss}.exe");
            var downloadOk = await DownloadFile(settings, logger, downloadUrl, downloadedPath, progressCallback);
            if (!downloadOk)
            {
                if (progressCallback != null)
                    await progressCallback("download_failed", downloadUrl);
                return false;
            }

            // === Phase 2: verify SHA-256 (streaming) ===
            if (progressCallback != null) await progressCallback("verifying", "");
            var actualHash = ComputeSha256(downloadedPath);
            var expectedHash = (sha256Expected ?? "").Trim().ToLowerInvariant();
            if (!string.Equals(actualHash, expectedHash, StringComparison.OrdinalIgnoreCase))
            {
                logger?.LogError("SHA-256 mismatch. expected={E} actual={A}", expectedHash, actualHash);
                TryDelete(downloadedPath);
                if (progressCallback != null) await progressCallback("sha_mismatch", actualHash);
                return false;
            }

            // === Phase 3: wait for user idle (silent UX) ===
            if (progressCallback != null) await progressCallback("waiting_idle", "");
            await WaitForUserIdle(logger);

            // === Phase 4: spawn hidden PowerShell to do the swap ===
            if (progressCallback != null) await progressCallback("installing", newVersion);
            var ok = LaunchHiddenReplaceScript(logger, downloadedPath, newVersion);
            if (!ok)
            {
                TryDelete(downloadedPath);
                return false;
            }

            // PowerShell will Stop-Service us in a moment. Give it time to start
            // before we exit, so service control sequence is clean.
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
                try { await progressCallback("exception", ex.Message); } catch { }
            }
            return false;
        }
        finally
        {
            // FileOptions.DeleteOnClose ensures the OS removes the lock file
            // when this handle is released — even if the process crashes.
            // Stale locks from killed/crashed processes cannot accumulate.
            try { lockStream?.Dispose(); } catch { }
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
        try
        {
            using var p = Process.GetCurrentProcess();
            p.PriorityClass = ProcessPriorityClass.BelowNormal;
        }
        catch { /* not critical */ }
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
            using var handler = new SocketsHttpHandler
            {
                UseProxy = false,
                AllowAutoRedirect = true,
            };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(15) };
            http.DefaultRequestHeaders.Add("User-Agent", "BelfProctor-Updater/1.0");
            if (!string.IsNullOrWhiteSpace(settings.ClientId))
                http.DefaultRequestHeaders.Add("X-Client-Id", settings.ClientId);
            if (!string.IsNullOrWhiteSpace(settings.EncryptionKey))
                http.DefaultRequestHeaders.Add("X-Client-Key", settings.EncryptionKey);

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

            var buf = new byte[ChunkSize];
            long got = 0;
            int read;
            int lastPercentReported = -1;
            while ((read = await src.ReadAsync(buf, 0, buf.Length)) > 0)
            {
                await dst.WriteAsync(buf, 0, read);
                got += read;

                // Throttle to avoid disk/network spikes that the user could feel.
                if (InterChunkDelayMs > 0)
                    await Task.Delay(InterChunkDelayMs);

                if (total > 0 && progress != null)
                {
                    int pct = (int)((got * 100) / total);
                    if (pct >= lastPercentReported + 10) // report each 10%
                    {
                        lastPercentReported = pct;
                        try { await progress("downloading", $"{pct}%"); } catch { }
                    }
                }
            }
            logger?.LogInformation("Downloaded update: {Bytes} bytes → {Path}", got, destPath);
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
            LASTINPUTINFO lii = new LASTINPUTINFO();
            lii.cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>();
            if (!GetLastInputInfo(ref lii)) return uint.MaxValue;
            uint tick = (uint)Environment.TickCount;
            uint idleMs = tick - lii.dwTime;
            return idleMs / 1000;
        }
        catch
        {
            // If P/Invoke fails (no user32, no interactive session — Session 0 service)
            // assume idle so we don't block forever.
            return uint.MaxValue;
        }
    }

    private static async Task WaitForUserIdle(ILogger? logger)
    {
        var deadline = DateTime.UtcNow.AddMinutes(IdleWaitTimeoutMinutes);
        while (DateTime.UtcNow < deadline)
        {
            try
            {
                var idle = GetIdleSeconds();
                if (idle >= IdleThresholdSeconds)
                {
                    logger?.LogInformation("User idle for {S}s → proceeding with replace", idle);
                    return;
                }
            }
            catch { return; }
            await Task.Delay(TimeSpan.FromSeconds(30));
        }
        logger?.LogInformation("Idle wait timeout — proceeding with replace anyway");
    }

    private static bool LaunchHiddenReplaceScript(
        ILogger? logger,
        string downloadedNewExePath,
        string newVersion)
    {
        try
        {
            Directory.CreateDirectory(TempRoot);

            // Resolve install dir from the running exe location (works whether
            // service installed in C:\Program Files\BelfProctor or anywhere else).
            var installedExePath = Process.GetCurrentProcess().MainModule?.FileName
                ?? Path.Combine(AppContext.BaseDirectory, InstalledExeName);
            var installDir = Path.GetDirectoryName(installedExePath) ?? "C:\\Program Files\\BelfProctor";
            var oldExe = installedExePath;
            var bakExe = installedExePath + ".bak";
            var newExe = downloadedNewExePath;

            var scriptPath = Path.Combine(
                TempRoot,
                $"update_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.ps1");
            var logPath = Path.Combine(
                TempRoot,
                $"update_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.log");

            // PowerShell script — fully silent + robust swap.
            // Key technique: use Move-Item to rename the locked old exe out of
            // the way (Windows allows renaming a running executable even when
            // overwriting it would fail). Then copy new exe into the original
            // path. This avoids the "file in use by another process" error.
            var script = $@"
$ErrorActionPreference = 'SilentlyContinue'
try {{ (Get-Process -Id $PID).PriorityClass = 'Idle' }} catch {{}}

$logFile  = '{logPath.Replace("'", "''")}'
$svc      = '{ServiceName}'
$oldExe   = '{oldExe.Replace("'", "''")}'
$newExe   = '{newExe.Replace("'", "''")}'
$bakExe   = '{bakExe.Replace("'", "''")}'
$lockFile = '{LockFile.Replace("'", "''")}'

function Log($m) {{ try {{ Add-Content -LiteralPath $logFile -Value (""{{0:o}}  {{1}}"" -f (Get-Date).ToUniversalTime(), $m) -ErrorAction SilentlyContinue }} catch {{}} }}

Log ""begin update to {newVersion}""

# === Step 1: Stop the service ===
try {{ Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue }} catch {{}}
# Wait up to 30 sec for service to reach Stopped state
for ($i=0; $i -lt 60; $i++) {{
  try {{
    $st = (Get-Service -Name $svc -ErrorAction SilentlyContinue).Status
    if ($st -eq 'Stopped' -or -not $st) {{ break }}
  }} catch {{}}
  Start-Sleep -Milliseconds 500
}}
Log ""service stop requested""

# === Step 2: Kill any lingering processes by FULL PATH (more reliable than name) ===
for ($k=0; $k -lt 5; $k++) {{
  $locking = @()
  try {{
    $locking = Get-Process | Where-Object {{
      try {{ $_.Path -ieq $oldExe }} catch {{ $false }}
    }}
  }} catch {{}}
  if (-not $locking -or $locking.Count -eq 0) {{ break }}
  foreach ($p in $locking) {{
    try {{ Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }} catch {{}}
  }}
  Start-Sleep -Milliseconds 800
}}
# Belt-and-suspenders: name-based kills for all known aliases
foreach ($n in 'BelfProctor','Microsoft OneDrive','SystemWorker') {{
  try {{ taskkill /F /IM ($n + '.exe') /T 2>$null | Out-Null }} catch {{}}
}}
Start-Sleep -Seconds 2

$swapOk = $false
try {{
  if (Test-Path $bakExe) {{ try {{ Remove-Item -LiteralPath $bakExe -Force }} catch {{}} }}

  # === Step 3: RENAME old exe out of the way (works even if file is briefly locked) ===
  # Windows allows Move-Item on a running exe file; only overwrite is blocked.
  if (Test-Path $oldExe) {{
    $moved = $false
    for ($m=0; $m -lt 10; $m++) {{
      try {{
        Move-Item -LiteralPath $oldExe -Destination $bakExe -Force -ErrorAction Stop
        $moved = $true
        break
      }} catch {{
        Start-Sleep -Milliseconds 500
      }}
    }}
    if (-not $moved) {{ throw 'cannot move old exe (file locked after retries)' }}
  }}
  Log ""old exe moved to .bak""

  # === Step 4: Copy new exe to original path ===
  Copy-Item -LiteralPath $newExe -Destination $oldExe -Force -ErrorAction Stop
  Log ""new exe installed""

  # Remove Mark-of-the-Web (downloaded files have NTFS Zone.Identifier ADS that
  # makes Defender re-scan on every execution, slowing startup massively).
  try {{ Unblock-File -LiteralPath $oldExe -ErrorAction SilentlyContinue }} catch {{}}

  # === Step 5: Start the service ===
  # Self-contained .NET on first run extracts native libs to %TEMP%\.net\<hash>\
  # which can take 30-90 sec (especially with Defender real-time scanning).
  # We wait up to 120 sec and accept 'StartPending' as in-progress (not failure).
  Start-Service -Name $svc -ErrorAction SilentlyContinue
  $running = $false
  $lastStatus = ''
  for ($i=0; $i -lt 240; $i++) {{
    try {{
      $st = (Get-Service -Name $svc -ErrorAction SilentlyContinue).Status
      if ($st -ne $lastStatus) {{
        Log (""service status: "" + $st)
        $lastStatus = $st
      }}
      if ($st -eq 'Running') {{ $running = $true; break }}
      # StartPending = still extracting / initializing — keep waiting
    }} catch {{}}
    Start-Sleep -Milliseconds 500
  }}
  if (-not $running) {{ throw ('service did not start within 120 sec (last status: ' + $lastStatus + ')') }}
  $swapOk = $true
  Log ""service running on new version""
}} catch {{
  Log (""swap failed: "" + $_.Exception.Message)
  # Rollback: move .bak back to oldExe
  try {{
    if (Test-Path $bakExe) {{
      if (Test-Path $oldExe) {{ Remove-Item -LiteralPath $oldExe -Force -ErrorAction SilentlyContinue }}
      Move-Item -LiteralPath $bakExe -Destination $oldExe -Force -ErrorAction SilentlyContinue
    }}
  }} catch {{}}
  try {{ Start-Service -Name $svc -ErrorAction SilentlyContinue }} catch {{}}
}}

# Cleanup
try {{ Remove-Item -LiteralPath $newExe -Force -ErrorAction SilentlyContinue }} catch {{}}
if ($swapOk) {{
  try {{ Remove-Item -LiteralPath $bakExe -Force -ErrorAction SilentlyContinue }} catch {{}}
}}
try {{ if (Test-Path $lockFile) {{ Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue }} }} catch {{}}

# Self-delete script
try {{ Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue }} catch {{}}
";

            File.WriteAllText(scriptPath, script, new UTF8Encoding(false));

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass " +
                            $"-WindowStyle Hidden -File \"{scriptPath}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            var proc = Process.Start(psi);
            if (proc == null)
            {
                logger?.LogError("Failed to start update PowerShell");
                return false;
            }
            try { proc.PriorityClass = ProcessPriorityClass.Idle; } catch { }
            logger?.LogInformation("Update PowerShell started (pid={Pid}, script={Script})", proc.Id, scriptPath);
            return true;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "LaunchHiddenReplaceScript failed");
            return false;
        }
    }
}
