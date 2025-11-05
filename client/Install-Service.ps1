# PowerShell script to install BelfProctor Windows Service
# Run as Administrator

param(
    [string]$ServiceName = "BelfProctor",
    [string]$DisplayName = "Belf Proctor Service",
    [string]$Description = "Proctor service for monitoring system activities and taking screenshots",
    [string]$InstallPath = "C:\Program Files\BelfProctor",
    [string]$ExecutableName = "BelfProctor.exe"
)

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
    } catch { return $false }
}

function Install-DotNetRuntime8 {
    Write-Host "Installing .NET 8 Runtime..." -ForegroundColor Yellow
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if ($wingetCmd) {
        winget install --id Microsoft.DotNet.Runtime.8 --silent --accept-package-agreements --accept-source-agreements
        if (-not (Test-DotNetRuntimeInstalled $RequiredFxMajorMinor)) {
            Write-Warning "Winget reported success but runtime not detected. Please install manually."
            Start-Process "https://dotnet.microsoft.com/download/dotnet/8.0/runtime"
            throw "Missing .NET 8 Runtime"
        }
    } else {
        Write-Warning "winget not found. Opening .NET Runtime download page..."
        Start-Process "https://dotnet.microsoft.com/download/dotnet/8.0/runtime"
        throw "Automatic install unavailable without winget. Install .NET 8 Runtime and rerun."
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
        $config = Get-Content $configPath | ConvertFrom-Json
        $config.ProctorSettings.ScreenshotPath = "$InstallPath\Screenshots"
        $config.ProctorSettings.LogPath = "$InstallPath\Logs"
        $config.ProctorSettings.ReportsPath = "$InstallPath\Reports"
        
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
        Write-Host "Updated configuration file with installation paths" -ForegroundColor Gray
    }

    # Create Windows Service
    $executablePath = Join-Path $InstallPath $ExecutableName
    
    Write-Host "Creating Windows Service..." -ForegroundColor Yellow
    $serviceParams = @{
        Name = $ServiceName
        BinaryPathName = $executablePath
        DisplayName = $DisplayName
        Description = $Description
        StartupType = "Automatic"
        Credential = $null
    }
    
    New-Service @serviceParams | Out-Null

    # Set service to restart on failure
    Write-Host "Configuring service recovery options..." -ForegroundColor Yellow
    sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/30000

    # Set service to run as Local System
    sc.exe config $ServiceName obj= "LocalSystem"

    # Grant necessary permissions
    Write-Host "Setting up service permissions..." -ForegroundColor Yellow
    
    # Grant full control to the service directory
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
    # Stop service
    Stop-Service -Name "$ServiceName" -Force -ErrorAction SilentlyContinue
    
    # Remove service
    sc.exe delete "$ServiceName"
    
    # Remove installation directory (optional - uncomment if you want to remove all files)
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