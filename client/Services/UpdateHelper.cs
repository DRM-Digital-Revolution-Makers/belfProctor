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

    public static async Task<bool> DownloadAndInstall(
        ProctorSettings settings,
        ILogger? logger,
        string downloadUrl,
        string sha256Expected,
        string newVersion,
        Func<string, string, Task>? progressCallback = null)
    {
        if (!Uri.TryCreate(downloadUrl, UriKind.Absolute, out var updateUri) ||
            !string.Equals(updateUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase))
        {
            logger?.LogError("Refusing update from non-HTTPS or invalid URL: {Url}", downloadUrl);
            if (progressCallback != null) await progressCallback("failed", "https_required");
            return false;
        }

        if (!settings.Features.UpdateV2)
        {
            if (progressCallback != null) await progressCallback("failed", "update_v2_disabled");
            return false;
        }

        string updateRoot;
        try
        {
            updateRoot = GetSecureUpdateRoot();
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Could not prepare the protected update directory");
            if (progressCallback != null) await progressCallback("failed", "secure_staging_unavailable");
            return false;
        }

        await using var lockStream = await TryAcquireLockAsync(updateRoot, logger);
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
            var downloadedPath = Path.Combine(updateRoot, $"BelfProctor_{Guid.NewGuid():N}.exe");
            if (!await DownloadFile(settings, logger, downloadUrl, downloadedPath, newVersion, progressCallback))
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

            var trustedSigner = ResolveTrustedSignerThumbprint(settings.TrustedUpdateSignerThumbprint);
            if (!VerifyAuthenticodeSignature(downloadedPath, trustedSigner, logger, updateRoot))
            {
                TryDelete(downloadedPath);
                if (progressCallback != null) await progressCallback("failed", "untrusted_signature");
                return false;
            }

            if (progressCallback != null) await progressCallback("installing", newVersion);
            await WaitForUserIdle(logger);

            if (!LaunchHiddenVersionSwitchScript(logger, downloadedPath, newVersion, updateRoot))
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

    internal static string ResolveTrustedSignerThumbprint(string configuredThumbprint)
    {
        var configured = NormalizeThumbprint(configuredThumbprint);
        var embedded = Assembly.GetExecutingAssembly()
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == "BelfProctor.TrustedUpdateSignerThumbprint")?.Value;
        var protectedValue = NormalizeThumbprint(embedded ?? string.Empty);
        if (protectedValue.Length == 0) return configured;
        // A writable configuration file may not redirect trust away from the
        // publisher identity embedded in (and protected by) the signed EXE.
        return configured.Length == 0 || configured == protectedValue ? protectedValue : string.Empty;
    }

    private static string NormalizeThumbprint(string value) =>
        (value ?? string.Empty).Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();

    internal static bool VerifyAuthenticodeSignature(
        string filePath,
        string expectedThumbprint,
        ILogger? logger,
        string? preparedUpdateRoot = null)
    {
        var normalized = (expectedThumbprint ?? "").Replace(" ", string.Empty, StringComparison.Ordinal).ToUpperInvariant();
        if (normalized.Length != 40 || !normalized.All(Uri.IsHexDigit))
        {
            logger?.LogError("Trusted update signer thumbprint is missing or invalid");
            return false;
        }

        var scriptPath = string.Empty;
        try
        {
            var updateRoot = preparedUpdateRoot ?? GetSecureUpdateRoot();
            scriptPath = Path.Combine(updateRoot, $"verify-authenticode-{Guid.NewGuid():N}.ps1");
            File.WriteAllText(scriptPath, @"
param([Parameter(Mandatory=$true)][string]$TargetPath,
      [Parameter(Mandatory=$true)][string]$ExpectedThumbprint)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $TargetPath
$actual = if ($signature.SignerCertificate) { $signature.SignerCertificate.Thumbprint } else { '' }
if ($signature.Status -ne 'Valid' -or $actual -ne $ExpectedThumbprint) { exit 23 }
exit 0
", new UTF8Encoding(false));
            var psi = new ProcessStartInfo("powershell.exe")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            psi.ArgumentList.Add("-NoProfile");
            psi.ArgumentList.Add("-NonInteractive");
            psi.ArgumentList.Add("-ExecutionPolicy");
            psi.ArgumentList.Add("Bypass");
            psi.ArgumentList.Add("-File");
            psi.ArgumentList.Add(scriptPath);
            psi.ArgumentList.Add("-TargetPath");
            psi.ArgumentList.Add(filePath);
            psi.ArgumentList.Add("-ExpectedThumbprint");
            psi.ArgumentList.Add(normalized);
            using var process = Process.Start(psi);
            if (process == null) return false;
            if (!process.WaitForExit(30_000))
            {
                try { process.Kill(true); } catch { }
                logger?.LogError("Authenticode verification timed out");
                return false;
            }
            if (process.ExitCode == 0) return true;
            logger?.LogError("Authenticode verification failed with code {Code}: {Error}",
                process.ExitCode, process.StandardError.ReadToEnd().Trim());
            return false;
        }
        catch (Exception ex)
        {
            logger?.LogError(ex, "Authenticode verification failed");
            return false;
        }
        finally
        {
            TryDelete(scriptPath);
        }
    }

    private static async Task<FileStream?> TryAcquireLockAsync(string updateRoot, ILogger? logger)
    {
        try
        {
            var lockFile = Path.Combine(updateRoot, "update.lock");
            var stream = new FileStream(
                lockFile,
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
        string version,
        Func<string, string, Task>? progress)
    {
        try
        {
            // A redirect could disclose device authentication headers to a
            // different HTTPS origin. Update URLs are generated by our server,
            // so redirects are neither required nor accepted.
            using var handler = new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false };
            using var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(15) };
            http.DefaultRequestHeaders.Add("User-Agent", "BelfProctor-Updater/2.0");

            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            var signature = WebSocketAuth.CreateUpdateDownloadSignature(
                settings.ClientId,
                version,
                timestamp,
                settings.EncryptionKey,
                nonce);
            req.Headers.Add("X-Client-Id", settings.ClientId);
            req.Headers.Add("X-Client-Timestamp", timestamp.ToString(System.Globalization.CultureInfo.InvariantCulture));
            req.Headers.Add("X-Client-Nonce", nonce);
            req.Headers.Add("X-Client-Signature", signature);
            using var resp = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
            // SocketsHttpHandler may follow redirects. Never allow a trusted HTTPS
            // update URL to be downgraded to plaintext by a redirect response.
            if (!IsHttpsUpdateResponse(req.RequestUri, resp.RequestMessage?.RequestUri))
            {
                logger?.LogError("Update download redirected to a non-HTTPS endpoint: {Url}",
                    resp.RequestMessage?.RequestUri);
                return false;
            }
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

    internal static bool IsHttpsUpdateResponse(Uri? requestedUri, Uri? finalUri) =>
        requestedUri != null && finalUri != null &&
        string.Equals(requestedUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(finalUri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);

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

    private static bool LaunchHiddenVersionSwitchScript(
        ILogger? logger,
        string stagedExePath,
        string newVersion,
        string updateRoot)
    {
        try
        {
            var currentExe = Process.GetCurrentProcess().MainModule?.FileName
                ?? Path.Combine(AppContext.BaseDirectory, InstalledExeName);
            var installRoot = FindInstallRoot(currentExe);
            var safeVersion = SanitizeVersion(newVersion);
            var versionDir = Path.Combine(installRoot, "versions", safeVersion);
            var targetExe = Path.Combine(versionDir, InstalledExeName);
            var operationId = Guid.NewGuid().ToString("N");
            var logPath = Path.Combine(updateRoot, $"update_{operationId}.log");
            var scriptPath = Path.Combine(updateRoot, $"update_{operationId}.ps1");
            var lockFile = Path.Combine(updateRoot, "update.lock");

            var script = $@"
$ErrorActionPreference = 'SilentlyContinue'
$logFile = '{Ps(logPath)}'
$svc = '{ServiceName}'
$desktopTask = '{DesktopAgentSupervisor.ScheduledTaskName}'
$currentExe = '{Ps(currentExe)}'
$stagedExe = '{Ps(stagedExePath)}'
$versionDir = '{Ps(versionDir)}'
$targetExe = '{Ps(targetExe)}'
$installRoot = '{Ps(installRoot)}'
$versionsRoot = Join-Path $installRoot 'versions'
function Log($m) {{ try {{ Add-Content -LiteralPath $logFile -Value (""{{0:o}} {{1}}"" -f (Get-Date).ToUniversalTime(), $m) }} catch {{}} }}
function StartAndWait($name) {{
  try {{ Start-Service -Name $name -ErrorAction SilentlyContinue }} catch {{}}
  for ($i=0; $i -lt 120; $i++) {{
    try {{
      $st = (Get-Service -Name $name -ErrorAction SilentlyContinue).Status
      if ($st -eq 'Running') {{
        # A service can briefly report Running and then crash. It must remain
        # alive through a stabilization window before the old ImagePath is
        # considered safely replaced.
        $stable = $true
        for ($j=0; $j -lt 15; $j++) {{
          Start-Sleep -Seconds 1
          try {{
            if ((Get-Service -Name $name -ErrorAction Stop).Status -ne 'Running') {{ $stable = $false; break }}
          }} catch {{ $stable = $false; break }}
        }}
        if ($stable) {{ return $true }}
      }}
    }} catch {{}}
    Start-Sleep -Seconds 1
  }}
  return $false
}}
function SetDesktopTask($exe) {{
  $action = New-ScheduledTaskAction -Execute $exe -Argument '--auto-start' -WorkingDirectory (Split-Path $exe -Parent)
  Set-ScheduledTask -TaskName $desktopTask -Action $action -ErrorAction Stop | Out-Null
}}
function PathEquals($a, $b) {{
  if ([string]::IsNullOrWhiteSpace($a) -or [string]::IsNullOrWhiteSpace($b)) {{ return $false }}
  try {{ return [string]::Equals([IO.Path]::GetFullPath($a), [IO.Path]::GetFullPath($b), [StringComparison]::OrdinalIgnoreCase) }}
  catch {{ return $false }}
}}
function GetDesktopAgents($exe) {{
  try {{
    return @(Get-CimInstance -ClassName Win32_Process -Filter ""Name='BelfProctor.exe'"" | Where-Object {{
      [uint32]$_.SessionId -gt 0 -and (PathEquals $_.ExecutablePath $exe) -and
        ([string]$_.CommandLine).IndexOf('--auto-start', [StringComparison]::OrdinalIgnoreCase) -ge 0
    }})
  }} catch {{ return @() }}
}}
function StopManagedAgents($firstExe, $secondExe) {{
  try {{ Stop-ScheduledTask -TaskName $desktopTask -ErrorAction SilentlyContinue }} catch {{}}
  try {{
    Get-CimInstance -ClassName Win32_Process -Filter ""Name='BelfProctor.exe'"" | Where-Object {{
      [uint32]$_.SessionId -gt 0 -and
        ((PathEquals $_.ExecutablePath $firstExe) -or (PathEquals $_.ExecutablePath $secondExe))
    }} | ForEach-Object {{ Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null }}
  }} catch {{}}
  for ($i=0; $i -lt 30; $i++) {{
    if ((GetDesktopAgents $firstExe).Count -eq 0 -and (GetDesktopAgents $secondExe).Count -eq 0) {{ return $true }}
    Start-Sleep -Milliseconds 500
  }}
  return $false
}}
function StartDesktopAndWait($exe) {{
  try {{ Start-ScheduledTask -TaskName $desktopTask -ErrorAction Stop }} catch {{ return $false }}
  for ($i=0; $i -lt 30; $i++) {{
    if ((GetDesktopAgents $exe).Count -gt 0) {{ return $true }}
    Start-Sleep -Seconds 1
  }}
  return $false
}}
Log 'begin versioned update'
try {{
  New-Item -ItemType Directory -Force -Path $versionsRoot | Out-Null
  if ((Get-Item -LiteralPath $versionsRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {{ throw 'versions root is a reparse point' }}
  New-Item -ItemType Directory -Force -Path $versionDir | Out-Null
  if ((Get-Item -LiteralPath $versionDir -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {{ throw 'version directory is a reparse point' }}
  Copy-Item -LiteralPath $stagedExe -Destination $targetExe -Force -ErrorAction Stop
  try {{ Unblock-File -LiteralPath $targetExe -ErrorAction SilentlyContinue }} catch {{}}
  # Mirror config files from install root next to the new exe — Program.cs
  # reads appsettings.json from AppContext.BaseDirectory and from LocalSystem's
  # AppData (empty), so without this the new versioned exe sees no ClientId
  # and the worker exits immediately.
  foreach ($cfg in 'appsettings.json','appsettings.Production.json') {{
    $src = Join-Path $installRoot $cfg
    if (Test-Path -LiteralPath $src) {{
      Copy-Item -LiteralPath $src -Destination (Join-Path $versionDir $cfg) -Force -ErrorAction SilentlyContinue
    }}
  }}
  Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (-not (StopManagedAgents $currentExe $targetExe)) {{ throw 'existing interactive agent did not stop' }}
  $imagePath = '""' + $targetExe + '"" --service-host'
  Set-ItemProperty -Path ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $svc) -Name 'ImagePath' -Value $imagePath -Type ExpandString -ErrorAction Stop
  SetDesktopTask $targetExe
  Log ('binPath set to ' + $imagePath)
  if (-not (StartAndWait $svc)) {{ throw 'new service version did not start' }}
  if (-not (StartDesktopAndWait $targetExe)) {{ throw 'new interactive desktop agent did not start' }}
  Log 'new version started'
  try {{
    Get-ChildItem -LiteralPath (Join-Path $installRoot 'versions') -Directory |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 3 |
      Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  }} catch {{}}
}} catch {{
  Log ('update failed: ' + $_.Exception.Message)
  try {{
    Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    StopManagedAgents $targetExe $currentExe | Out-Null
    $rollbackImage = '""' + $currentExe + '"" --service-host'
    Set-ItemProperty -Path ('HKLM:\SYSTEM\CurrentControlSet\Services\' + $svc) -Name 'ImagePath' -Value $rollbackImage -Type ExpandString -ErrorAction Stop
    SetDesktopTask $currentExe
    if (-not (StartAndWait $svc)) {{ throw 'rollback service did not start' }}
    if (-not (StartDesktopAndWait $currentExe)) {{ throw 'rollback desktop agent did not start' }}
    Log 'previous version restored'
  }} catch {{ Log ('rollback failed: ' + $_.Exception.Message) }}
}}
try {{ Remove-Item -LiteralPath $stagedExe -Force -ErrorAction SilentlyContinue }} catch {{}}
try {{ Remove-Item -LiteralPath '{Ps(lockFile)}' -Force -ErrorAction SilentlyContinue }} catch {{}}
try {{ Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue }} catch {{}}
";

            File.WriteAllText(scriptPath, script, new UTF8Encoding(false));
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"",
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
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

    private static string GetSecureUpdateRoot()
    {
        // The desktop agent is registered with RunLevel Highest. Never hand an
        // elevated PowerShell process a script stored in the user's writable
        // TEMP directory: a medium-integrity process could replace it between
        // creation and execution. The installer removes inherited write access
        // from the install root, granting the interactive user RX only, so this
        // child directory is writable solely by elevated Administrators/SYSTEM.
        var currentExe = Process.GetCurrentProcess().MainModule?.FileName
            ?? Path.Combine(AppContext.BaseDirectory, InstalledExeName);
        var updateRoot = ResolveUpdateRoot(currentExe);
        var installRoot = FindInstallRoot(currentExe);
        var expectedPrefix = Path.GetFullPath(installRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        if (!updateRoot.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Update staging escaped the protected install root");
        }

        Directory.CreateDirectory(updateRoot);
        if ((File.GetAttributes(updateRoot) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidOperationException("Update staging must not be a reparse point");
        }
        return updateRoot;
    }

    internal static string ResolveUpdateRoot(string executablePath) =>
        Path.GetFullPath(Path.Combine(FindInstallRoot(executablePath), ".update"));

    internal static string SanitizeVersion(string version)
    {
        var raw = string.IsNullOrWhiteSpace(version)
            ? DateTime.UtcNow.ToString("yyyyMMddHHmmss")
            : version.Trim();
        if (raw.Length > 64 || !char.IsAsciiLetterOrDigit(raw[0]) ||
            raw.Any(c => !char.IsAsciiLetterOrDigit(c) && c is not '.' and not '-' and not '_'))
        {
            throw new ArgumentException(
                "Update version must start with a letter or digit and contain at most 64 ASCII letters, digits, dots, hyphens, or underscores.",
                nameof(version));
        }
        return raw;
    }

    private static string Ps(string value) => value.Replace("'", "''");
}
