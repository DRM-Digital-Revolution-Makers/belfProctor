using System.Diagnostics;
using System.IO;
using System.Text;
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
            var safeService = string.IsNullOrWhiteSpace(serviceName) ? "BelfProctor" : serviceName;
            var baseDir = AppContext.BaseDirectory ?? string.Empty;

            var tempDir = Path.Combine(Path.GetTempPath(), "BelfProctor");
            Directory.CreateDirectory(tempDir);
            var scriptPath = Path.Combine(tempDir, $"uninstall_{DateTime.Now:yyyyMMdd_HHmmss_fff}.ps1");
            var script = $@"
$ErrorActionPreference = 'SilentlyContinue'
$servicePrimary = '{safeService.Replace("'", "''")}'
$installHint = '{installRoot.Replace("'", "''")}'
$baseDir = '{baseDir.Replace("'", "''")}'

try {{ schtasks /End /TN ""WindowsSystemWorkerUpdate"" | Out-Null }} catch {{}}
try {{ schtasks /Delete /TN ""WindowsSystemWorkerUpdate"" /F | Out-Null }} catch {{}}

try {{
  $startup = [Environment]::GetFolderPath('Startup')
  if ($startup) {{
    $lnk = Join-Path $startup 'SystemWorker.lnk'
    if (Test-Path $lnk) {{ Remove-Item -LiteralPath $lnk -Force -ErrorAction SilentlyContinue }}
  }}
}} catch {{}}

try {{
  $rk = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (Test-Path $rk) {{
    Remove-ItemProperty -Path $rk -Name 'WindowsSystemWorker' -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $rk -Name 'BelfProctor' -ErrorAction SilentlyContinue
  }}
}} catch {{}}

try {{
  $rk2 = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'
  if (Test-Path $rk2) {{
    Remove-ItemProperty -Path $rk2 -Name 'WindowsSystemWorker' -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path $rk2 -Name 'BelfProctor' -ErrorAction SilentlyContinue
  }}
}} catch {{}}

$serviceNames = @($servicePrimary, 'BelfProctor', 'SystemWorker') | Where-Object {{ $_ -and $_.Trim().Length -gt 0 }} | Select-Object -Unique
foreach ($svc in $serviceNames) {{
  try {{ Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue }} catch {{}}
  try {{ sc.exe stop $svc | Out-Null }} catch {{}}
}}
Start-Sleep -Seconds 4
try {{ taskkill /F /IM 'BelfProctor.exe' /T | Out-Null }} catch {{}}
try {{ taskkill /F /IM 'SystemWorker.exe' /T | Out-Null }} catch {{}}
Start-Sleep -Seconds 2
foreach ($svc in $serviceNames) {{
  try {{ sc.exe delete $svc | Out-Null }} catch {{}}
}}

$paths = @(
  $installHint,
  $baseDir,
  (Join-Path $env:ProgramFiles 'BelfProctor'),
  (Join-Path $env:ProgramData 'BelfProctor'),
  (Join-Path $env:LOCALAPPDATA 'BelfProctor'),
  (Join-Path $env:LOCALAPPDATA 'SystemWorker')
) | Where-Object {{ $_ -and $_.Trim().Length -gt 0 }} | Select-Object -Unique

foreach ($p in $paths) {{
  try {{
    $pp = $p.TrimEnd('\')
    if (-not (Test-Path $pp)) {{ continue }}
    $exe1 = Join-Path $pp 'BelfProctor.exe'
    $exe2 = Join-Path $pp 'SystemWorker.exe'
    $name = Split-Path -Leaf $pp
    $looksLike = ($name -match 'BelfProctor' -or $name -match 'SystemWorker' -or (Test-Path $exe1) -or (Test-Path $exe2))
    if ($looksLike) {{
      for ($i=0; $i -lt 5; $i++) {{
        try {{ Remove-Item -LiteralPath $pp -Recurse -Force -ErrorAction SilentlyContinue }} catch {{}}
        if (-not (Test-Path $pp)) {{ break }}
        Start-Sleep -Seconds 2
      }}
    }}
  }} catch {{}}
}}
";
            File.WriteAllText(scriptPath, script, Encoding.UTF8);

            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"",
                UseShellExecute = false,
                CreateNoWindow = true
            };
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
}
