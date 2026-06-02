# PowerShell script to install BelfProctor Windows Service
# Run as Administrator

param(
    [string]$ServiceName = "BelfProctor",
    [string]$DisplayName = "Belf Proctor Service",
    [string]$Description = "Proctor service for monitoring system activities and taking screenshots",
    [string]$InstallPath = "C:\Program Files\BelfProctor",
    [string]$ExecutableName = "BelfProctor.exe",
    [string]$LogPath = "$env:ProgramData\BelfProctor\Install\install.log"
)

# Global logging to file (transcript)
$ErrorActionPreference = "Stop"
try {
    $logDir = Split-Path $LogPath -Parent
    if (-not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
    Start-Transcript -Path $LogPath -Append -ErrorAction SilentlyContinue | Out-Null
    Write-Host "Transcript started: $LogPath" -ForegroundColor Gray
} catch {
    Write-Warning "Failed to start transcript: $_"
}

# Check if running as Administrator
if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator. Please run PowerShell as Administrator and try again."
    exit 1
}

# Detect if framework-dependent build requires .NET Runtime and install if missing
$runtimeConfigPath = Join-Path (Get-Location) "BelfProctor.runtimeconfig.json"
$RequireDotNetRuntime = $false
$RequiredFxMajorMinor = "8.0"

if (Test-Path $runtimeConfigPath) {
    try {
        $rc = Get-Content $runtimeConfigPath -Raw | ConvertFrom-Json
        if ($rc.runtimeOptions -and $rc.runtimeOptions.framework) {
            $RequireDotNetRuntime = $true
            Write-Host "Detected framework-dependent package. .NET Runtime is required." -ForegroundColor Yellow
        } else {
            Write-Host "Detected self-contained package. .NET Runtime not required." -ForegroundColor Gray
        }
    } catch {
        Write-Warning "Failed to read runtimeconfig.json. Assuming self-contained."
        $RequireDotNetRuntime = $false
    }
} else {
    Write-Host "No runtimeconfig.json found. Assuming self-contained." -ForegroundColor Gray
}

function Test-DotNetRuntimeInstalled {
    param([string]$majorMinor = "8.0")
    try {
        $regPath = "HKLM:\SOFTWARE\dotnet\Setup\InstalledVersions\x64\sharedfx\Microsoft.NETCore.App"
        $versions = Get-ChildItem $regPath -ErrorAction SilentlyContinue | Select-Object -ExpandProperty PSChildName
        foreach ($v in $versions) {
            if ($v.StartsWith($majorMinor)) { return $true }
        }
        return $false
    } catch {
        return $false
    }
}

function Install-DotNetRuntime8 {
    Write-Host "Installing .NET 8 Runtime..." -ForegroundColor Yellow
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        winget install --id Microsoft.DotNet.Runtime.8 --silent --accept-package-agreements --accept-source-agreements
        if (-not (Test-DotNetRuntimeInstalled $RequiredFxMajorMinor)) {
            Write-Warning "Winget did not validate runtime install. Falling back to dotnet-install.ps1"
            try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
            $installer = Join-Path $env:TEMP "dotnet-install.ps1"
            Write-Host "Downloading dotnet-install.ps1..." -ForegroundColor Gray
            Invoke-WebRequest -UseBasicParsing -Uri "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer
            Write-Host "Running dotnet-install.ps1 for channel $RequiredFxMajorMinor..." -ForegroundColor Gray
            & $installer -Channel $RequiredFxMajorMinor -Runtime "dotnet" -InstallDir "C:\Program Files\dotnet"
        }
    } else {
        Write-Host "winget не найден. Использую dotnet-install.ps1..." -ForegroundColor Yellow
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        } catch {}
        $installer = Join-Path $env:TEMP "dotnet-install.ps1"
        Invoke-WebRequest -UseBasicParsing -Uri "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer
        & $installer -Channel "8.0" -Runtime "dotnet" -InstallDir "C:\Program Files\dotnet"
    }
    if (-not (Test-DotNetRuntimeInstalled $RequiredFxMajorMinor)) {
        Write-Warning "Установка .NET Runtime не подтвердилась по реестру."
        Start-Process "https://dotnet.microsoft.com/download/dotnet/8.0/runtime"
        throw "Missing .NET $RequiredFxMajorMinor Runtime after installation attempt."
    }
}
if ($RequireDotNetRuntime) {
    if (-not (Test-DotNetRuntimeInstalled $RequiredFxMajorMinor)) {
        Install-DotNetRuntime8
    } else {
        Write-Host ".NET $RequiredFxMajorMinor Runtime already installed." -ForegroundColor Gray
    }
}

Write-Host "Installing BelfProctor Service..." -ForegroundColor Green

try {
    # Stop service if it exists
    $existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($existingService) {
        Write-Host "Stopping existing service..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName -Force
        
        Write-Host "Removing existing service..." -ForegroundColor Yellow
        sc.exe delete $ServiceName
        Start-Sleep -Seconds 2
    }

    # Create installation directory
    if (-not (Test-Path $InstallPath)) {
        Write-Host "Creating installation directory: $InstallPath" -ForegroundColor Yellow
        New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null
    }

    # Copy files to installation directory
    $sourceFiles = @(
        "BelfProctor.exe",
        "BelfProctor.dll",
        "BelfProctor.runtimeconfig.json",
        "appsettings.json",
        "Microsoft.Extensions.Hosting.dll",
        "Microsoft.Extensions.Hosting.WindowsServices.dll",
        "Microsoft.Extensions.Configuration.dll",
        "Microsoft.Extensions.Configuration.Json.dll",
        "Microsoft.Extensions.Logging.dll",
        "Microsoft.Extensions.DependencyInjection.dll",
        "Newtonsoft.Json.dll",
        "System.Management.dll"
    )

    Write-Host "Copying files to installation directory..." -ForegroundColor Yellow
    foreach ($file in $sourceFiles) {
        if (Test-Path $file) {
            Copy-Item $file -Destination $InstallPath -Force
            Write-Host "  Copied: $file" -ForegroundColor Gray
        } else {
            Write-Warning "File not found: $file"
        }
    }

    # Create data directories
    $dataDirectories = @(
        "$InstallPath\Screenshots",
        "$InstallPath\Logs",
        "$InstallPath\Reports"
    )
    foreach ($dir in $dataDirectories) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Host "Created directory: $dir" -ForegroundColor Gray
        }
    }

    # Update appsettings.json with correct paths
    $configPath = Join-Path $InstallPath "appsettings.json"
    if (Test-Path $configPath) {
        $config = Get-Content $configPath -Raw | ConvertFrom-Json
        $config.ProctorSettings.ScreenshotPath = "$InstallPath\Screenshots"
        $config.ProctorSettings.LogPath = "$InstallPath\Logs"
        $config.ProctorSettings.ReportsPath = "$InstallPath\Reports"
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
        Write-Host "Updated configuration file with installation paths" -ForegroundColor Gray
    }

    # Create Windows Service
    # Service is started by SCM in Session 0 — the agent's Program.cs requires
    # --auto-start to skip the WinForms config UI and actually run the worker.
    $executablePath = Join-Path $InstallPath $ExecutableName
    $serviceBinaryPath = '"' + $executablePath + '" --auto-start'

    Write-Host "Creating Windows Service..." -ForegroundColor Yellow
    $serviceParams = @{
        Name = $ServiceName
        BinaryPathName = $serviceBinaryPath
        DisplayName = $DisplayName
        Description = $Description
        StartupType = "Automatic"
        Credential = $null
    }
    New-Service @serviceParams | Out-Null

    # Configure recovery and account
    sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000
    sc.exe config $ServiceName obj= "LocalSystem"

    # Permissions
    Write-Host "Setting up service permissions..." -ForegroundColor Yellow
    icacls $InstallPath /grant "NT AUTHORITY\SYSTEM:(OI)(CI)F" /T | Out-Null
    icacls $InstallPath /grant "BUILTIN\Administrators:(OI)(CI)F" /T | Out-Null

    # Start the service
    Write-Host "Starting service..." -ForegroundColor Yellow
    Start-Service -Name $ServiceName

    # Verify service is running
    Start-Sleep -Seconds 3
    $service = Get-Service -Name $ServiceName
    if ($service.Status -eq "Running") {
        Write-Host "✓ Service installed and started successfully!" -ForegroundColor Green
        Write-Host "Service Name: $ServiceName" -ForegroundColor Gray
        Write-Host "Display Name: $DisplayName" -ForegroundColor Gray
        Write-Host "Installation Path: $InstallPath" -ForegroundColor Gray
        Write-Host "Status: $($service.Status)" -ForegroundColor Gray
    } else {
        Write-Warning "Service installed but failed to start. Status: $($service.Status)"
        Write-Host "Check the Windows Event Log for more details." -ForegroundColor Yellow
    }

    # Create uninstall script
    $uninstallScript = @"
# PowerShell script to uninstall BelfProctor Windows Service
# Run as Administrator

if (-NOT ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Error "This script must be run as Administrator."
    exit 1
}

Write-Host "Uninstalling BelfProctor Service..." -ForegroundColor Yellow

try {
    Stop-Service -Name "$ServiceName" -Force -ErrorAction SilentlyContinue
    sc.exe delete "$ServiceName"
    # Remove-Item "$InstallPath" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✓ Service uninstalled successfully!" -ForegroundColor Green
} catch {
    Write-Error "Failed to uninstall service: `$_"
}
"@
    $uninstallPath = Join-Path $InstallPath "Uninstall-Service.ps1"
    $uninstallScript | Set-Content $uninstallPath
    Write-Host "Created uninstall script: $uninstallPath" -ForegroundColor Gray

} catch {
    Write-Error "Failed to install service: $_"
    exit 1
}

Write-Host "`nInstallation completed successfully!" -ForegroundColor Green
Write-Host "You can manage the service using:" -ForegroundColor Yellow
Write-Host "  - Services.msc (Windows Services Manager)" -ForegroundColor Gray
Write-Host "  - PowerShell: Get-Service $ServiceName" -ForegroundColor Gray
Write-Host "  - PowerShell: Stop-Service $ServiceName" -ForegroundColor Gray
Write-Host "  - PowerShell: Start-Service $ServiceName" -ForegroundColor Gray

# Stop transcript if started
try {
    Stop-Transcript | Out-Null
    Write-Host "Transcript stopped: $LogPath" -ForegroundColor Gray
} catch {}