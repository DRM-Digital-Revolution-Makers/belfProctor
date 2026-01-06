using System.Diagnostics;
using System.Management;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using System.Runtime.InteropServices;
using System.Text;

namespace BelfProctor.Services;

public class SystemMonitorService : ISystemMonitorService
{
    private readonly ILogger<SystemMonitorService> _logger;
    private readonly ProctorSettings _settings;
    private readonly List<SystemEvent> _recentEvents = new();
    private readonly object _eventsLock = new();
    
    private ManagementEventWatcher? _processWatcher;
    private ManagementEventWatcher? _processStopWatcher;
    private ManagementEventWatcher? _usbWatcher;
    private CancellationTokenSource? _cancellationTokenSource;
    private Task? _processPollingTask;
    private readonly HashSet<int> _seenPids = new();
    private readonly Dictionary<string, FileSystemWatcher> _usbWatchers = new();

    private static readonly HashSet<string> IgnoredProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        // Windows System & Services
        "svchost", "runtimebroker", "backgroundtaskhost", "conhost", "dllhost",
        "sihost", "taskhostw", "searchindexer", "csrss", "winlogon",
        "services", "lsass", "smss", "system", "registry", "idle",
        "audiodg", "spoolsv", "wudfhost", "wmiprvse", "msmpeng",
        "nisrv", "tiworker", "trustedinstaller", "ctfmon", "smartscreen",
        "searchui", "shellexperiencehost", "lockapp", "dashost",
        "applicationframehost", "startmenuexperiencehost", "wermgr", "sppsvc",
        "mscorsvw", "wininit", "fontdrvhost", "memory compression", "werfault",
        "useroobebroker", "searchhost", "textinputhost", "securityhealthservice",
        "sgrmbroker", "taskmgr", "explorer", "systemsettings", "standardcollector.service",
        "searchapp", "settingsynchost", "skypehost", "gamebarftserver", "gamebarpresencewriter",
        "rundll32", "consent", "gamingservices", "gamingservicesnet", "ipoint", "itype",
        "oneapp.igcc.winservice", "compattelrunner", "devicecensus", "officeclicktorun",
        "sedsvc", "unsecapp", "wlanext", "aggregatorhost",
        
        // Vendor Specific & WebViews
        "nvdisplay.container", "storedesktopextension", 
        "lenovovantage-(modernpreloadaddin)", "lenovovantage-(devicesettingssystemaddin)",
        "msedgewebview2", "lenovovantage", "lenovo.modern.imcontroller",
        "nvidia web helper", "nvcontainer"
    };

    public event EventHandler<SystemEvent>? SystemEventOccurred;

    public SystemMonitorService(
        ILogger<SystemMonitorService> logger,
        IOptions<ProctorSettings> settings)
    {
        _logger = logger;
        _settings = settings.Value;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _cancellationTokenSource = new CancellationTokenSource();
        
        try
        {
            if (_settings.MonitorProcesses)
            {
                await StartProcessMonitoringAsync();
            }

            if (_settings.MonitorUSB)
            {
                await StartUSBMonitoringAsync();
            }

            if (_settings.MonitorNetwork)
            {
                _ = Task.Run(MonitorNetworkActivity, _cancellationTokenSource.Token);
            }
            
            _ = Task.Run(MonitorActiveWindow, _cancellationTokenSource.Token);

            _logger.LogInformation("System monitoring started");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start system monitoring");
            throw;
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _cancellationTokenSource?.Cancel();
        
        _processWatcher?.Stop();
        _processWatcher?.Dispose();
        
        _processStopWatcher?.Stop();
        _processStopWatcher?.Dispose();
        
        _usbWatcher?.Stop();
        _usbWatcher?.Dispose();

        foreach (var w in _usbWatchers.Values)
        {
            w.Dispose();
        }
        _usbWatchers.Clear();
        
        _logger.LogInformation("System monitoring stopped");
        await Task.CompletedTask;
    }

    public Task<List<SystemEvent>> GetRecentEventsAsync(TimeSpan timeSpan)
    {
        var cutoffTime = DateTime.Now - timeSpan;
        
        lock (_eventsLock)
        {
            var list = _recentEvents
                .Where(e => e.Timestamp >= cutoffTime)
                .OrderByDescending(e => e.Timestamp)
                .ToList();
            return Task.FromResult(list);
        }
    }

    private async Task StartProcessMonitoringAsync()
    {
        await Task.Run(() =>
        {
            try
            {
                // Мониторинг запуска процессов
                var startQuery = new WqlEventQuery("SELECT * FROM Win32_ProcessStartTrace");
                _processWatcher = new ManagementEventWatcher(startQuery);
                _processWatcher.EventArrived += OnProcessStarted;
                _processWatcher.Start();

                // Мониторинг остановки процессов
                var stopQuery = new WqlEventQuery("SELECT * FROM Win32_ProcessStopTrace");
                _processStopWatcher = new ManagementEventWatcher(stopQuery);
                _processStopWatcher.EventArrived += OnProcessStopped;
                _processStopWatcher.Start();

                _logger.LogInformation("Process monitoring started");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start process monitoring");
                if (_processPollingTask == null)
                {
                    _processPollingTask = Task.Run(async () =>
                    {
                        try
                        {
                            while (!(_cancellationTokenSource?.IsCancellationRequested ?? true))
                            {
                                try
                                {
                                    var processes = Process.GetProcesses();
                                    foreach (var p in processes)
                                    {
                                        if (!_seenPids.Contains(p.Id))
                                        {
                                            _seenPids.Add(p.Id);
                                            
                                            if (!IsRelevantProcess(p.ProcessName)) continue;

                                            var systemEvent = new SystemEvent
                                            {
                                                Timestamp = DateTime.Now,
                                                EventType = SystemEventType.ProcessStarted,
                                                Description = $"Process started: {p.ProcessName}",
                                                ProcessName = p.ProcessName,
                                                AdditionalData = new Dictionary<string, object> { ["ProcessId"] = p.Id }
                                            };
                                            AddEvent(systemEvent);
                                            SystemEventOccurred?.Invoke(this, systemEvent);
                                        }
                                    }
                                    if (_seenPids.Count > 50000)
                                    {
                                        _seenPids.Clear();
                                        foreach (var x in Process.GetProcesses()) _seenPids.Add(x.Id);
                                    }
                                }
                                catch (Exception e)
                                {
                                    _logger.LogDebug(e, "Process polling iteration failed");
                                }
                                await Task.Delay(5000, _cancellationTokenSource?.Token ?? CancellationToken.None);
                            }
                        }
                        catch (OperationCanceledException)
                        {
                        }
                        catch (Exception e)
                        {
                            _logger.LogError(e, "Process polling failed");
                        }
                    });
                    _logger.LogInformation("Process polling fallback started");
                }
            }
        });
    }

    private async Task StartUSBMonitoringAsync()
    {
        await Task.Run(() =>
        {
            try
            {
                // Мониторинг подключения/отключения USB устройств (Volume Change)
                var usbQuery = new WqlEventQuery("SELECT * FROM Win32_VolumeChangeEvent");
                _usbWatcher = new ManagementEventWatcher(usbQuery);
                _usbWatcher.EventArrived += OnVolumeChangeEvent;
                _usbWatcher.Start();

                // Инициализация вотчеров для уже подключенных дисков (Removable)
                foreach (var drive in DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Removable && d.IsReady))
                {
                    SetupUsbWatcher(drive.Name);
                }

                _logger.LogInformation("USB monitoring started");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start USB monitoring");
            }
        });
    }

    private async Task MonitorNetworkActivity()
    {
        var lastNetworkCheck = DateTime.Now;
        
        while (!_cancellationTokenSource?.Token.IsCancellationRequested ?? false)
        {
            try
            {
                await CheckNetworkConnections();
                await Task.Delay(5000, _cancellationTokenSource?.Token ?? CancellationToken.None);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in network monitoring");
                await Task.Delay(10000, _cancellationTokenSource?.Token ?? CancellationToken.None);
            }
        }
    }

    private async Task CheckNetworkConnections()
    {
        await Task.Run(() =>
        {
            try
            {
                var startInfo = new ProcessStartInfo
                {
                    FileName = "netstat",
                    Arguments = "-an",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    CreateNoWindow = true
                };

                using var process = Process.Start(startInfo);
                if (process != null)
                {
                    var output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit();
                    
                    // Анализируем вывод netstat для обнаружения новых соединений
                    AnalyzeNetworkOutput(output);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to check network connections");
            }
        });
    }

    private void OnProcessStarted(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var processName = e.NewEvent["ProcessName"]?.ToString() ?? "Unknown";
            var processId = e.NewEvent["ProcessID"]?.ToString() ?? "0";

            if (!IsRelevantProcess(processName)) return;

            var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.ProcessStarted,
                Description = $"Process started: {processName}",
                ProcessName = processName,
                AdditionalData = new Dictionary<string, object>
                {
                    ["ProcessId"] = processId
                }
            };

            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing process start event");
        }
    }

    private void OnProcessStopped(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var processName = e.NewEvent["ProcessName"]?.ToString() ?? "Unknown";
            var processId = e.NewEvent["ProcessID"]?.ToString() ?? "0";

            if (!IsRelevantProcess(processName)) return;

            var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.ProcessStopped,
                Description = $"Process stopped: {processName}",
                ProcessName = processName,
                AdditionalData = new Dictionary<string, object>
                {
                    ["ProcessId"] = processId
                }
            };

            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing process stop event");
        }
    }

    private bool IsRelevantProcess(string processName)
    {
        if (string.IsNullOrWhiteSpace(processName)) return false;
        
        // Remove extension if present
        if (processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
            processName = Path.GetFileNameWithoutExtension(processName);
            
        return !IgnoredProcesses.Contains(processName);
    }

    private void OnVolumeChangeEvent(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var driveName = e.NewEvent["DriveName"]?.ToString();
            var eventType = Convert.ToUInt16(e.NewEvent["EventType"]); // 2 = Insert, 3 = Remove

            if (string.IsNullOrEmpty(driveName)) return;

            if (eventType == 2) // Mounted
            {
                 // Give it a moment to mount
                Task.Delay(1000).Wait();
                HandleUsbInsertion(driveName);
            }
            else if (eventType == 3) // Unmounted
            {
                HandleUsbRemoval(driveName);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing Volume Change event");
        }
    }

    private void HandleUsbInsertion(string driveName)
    {
        try
        {
            var driveInfo = new DriveInfo(driveName);
            if (!driveInfo.IsReady) return;

            // Gather characteristics
            string label = driveInfo.VolumeLabel;
            string format = driveInfo.DriveFormat;
            long totalSize = driveInfo.TotalSize;
            long freeSpace = driveInfo.TotalFreeSpace;
            string sizeGb = (totalSize / (1024.0 * 1024 * 1024)).ToString("F2") + " GB";

            var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.USBConnected,
                Description = $"USB Connected: {driveName} ({label})",
                DeviceId = driveName,
                AdditionalData = new Dictionary<string, object>
                {
                    ["Label"] = label,
                    ["Format"] = format,
                    ["TotalSize"] = sizeGb,
                    ["FreeSpace"] = freeSpace,
                    ["DriveType"] = driveInfo.DriveType.ToString()
                }
            };

            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);

            SetupUsbWatcher(driveName);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"Failed to handle USB insertion for {driveName}");
        }
    }

    private void HandleUsbRemoval(string driveName)
    {
        try 
        {
            RemoveUsbWatcher(driveName);

            var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.USBDisconnected,
                Description = $"USB Disconnected: {driveName}",
                DeviceId = driveName
            };
            
            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);
        }
        catch (Exception ex)
        {
             _logger.LogError(ex, $"Failed to handle USB removal for {driveName}");
        }
    }

    private void SetupUsbWatcher(string driveName)
    {
        try
        {
            if (_usbWatchers.ContainsKey(driveName)) return;

            // Ensure driveName ends with backslash for path
            string path = driveName.EndsWith("\\") ? driveName : driveName + "\\";

            var watcher = new FileSystemWatcher(path);
            watcher.IncludeSubdirectories = true;
            // Watch for file creation (copying/moving to drive)
            watcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite;
            
            watcher.Created += (s, e) => OnFileCopiedToUsb(s, e, driveName);
            watcher.Renamed += (s, e) => OnFileRenamedOnUsb(s, e, driveName);
            
            watcher.EnableRaisingEvents = true;

            _usbWatchers[driveName] = watcher;
            _logger.LogInformation($"Started watching USB drive: {driveName}");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, $"Failed to setup watcher for {driveName}");
        }
    }

    private void RemoveUsbWatcher(string driveName)
    {
        if (_usbWatchers.TryGetValue(driveName, out var watcher))
        {
            watcher.Dispose();
            _usbWatchers.Remove(driveName);
            _logger.LogInformation($"Stopped watching USB drive: {driveName}");
        }
    }

    private void OnFileCopiedToUsb(object sender, FileSystemEventArgs e, string driveName)
    {
        // Avoid spamming events for temp files or system files
        if (e.Name.StartsWith("~$") || e.Name.EndsWith(".tmp")) return;

        try
        {
             var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.FileAccess,
                Description = $"File copied to USB ({driveName}): {e.Name}",
                AdditionalData = new Dictionary<string, object>
                {
                    ["Action"] = "Created",
                    ["Path"] = e.FullPath,
                    ["Drive"] = driveName,
                    ["FileName"] = e.Name
                }
            };
            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);
        }
        catch {}
    }

    private void OnFileRenamedOnUsb(object sender, RenamedEventArgs e, string driveName)
    {
         try
        {
             var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.FileAccess,
                Description = $"File renamed on USB ({driveName}): {e.OldName} -> {e.Name}",
                AdditionalData = new Dictionary<string, object>
                {
                    ["Action"] = "Renamed",
                    ["Path"] = e.FullPath,
                    ["OldPath"] = e.OldFullPath,
                    ["Drive"] = driveName
                }
            };
            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);
        }
        catch {}
    }

    private void AnalyzeNetworkOutput(string output)
    {
        // Простой анализ сетевых соединений
        var lines = output.Split('\n');
        foreach (var line in lines)
        {
            if (line.Contains("ESTABLISHED"))
            {
                var parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3)
                {
                    var localAddress = parts[1];
                    var remoteAddress = parts[2];
                    
                    // Filter out loopback
                    if (remoteAddress.StartsWith("127.0.0.1") || remoteAddress.StartsWith("[::1]"))
                        continue;

                    // Parse port to filter out common noise
                    if (IsIgnoredNetworkTraffic(remoteAddress))
                        continue;

                    var systemEvent = new SystemEvent
                    {
                        Timestamp = DateTime.Now,
                        EventType = SystemEventType.NetworkConnection,
                        Description = $"Network connection established",
                        NetworkAddress = remoteAddress,
                        AdditionalData = new Dictionary<string, object>
                        {
                            ["LocalAddress"] = localAddress,
                            ["RemoteAddress"] = remoteAddress
                        }
                    };

                    // Добавляем только уникальные соединения
                    if (!IsRecentDuplicateEvent(systemEvent))
                    {
                        AddEvent(systemEvent);
                        SystemEventOccurred?.Invoke(this, systemEvent);
                    }
                }
            }
        }
    }

    private bool IsIgnoredNetworkTraffic(string remoteAddress)
    {
        // Format is usually IP:PORT or [IP]:PORT
        var lastColonIndex = remoteAddress.LastIndexOf(':');
        if (lastColonIndex > 0 && lastColonIndex < remoteAddress.Length - 1)
        {
            var portStr = remoteAddress.Substring(lastColonIndex + 1);
            if (int.TryParse(portStr, out var port))
            {
                // Ignore standard web traffic and common background services
                if (port == 80 ||   // HTTP
                    port == 443 ||  // HTTPS
                    port == 53 ||   // DNS
                    port == 5228 || // Google Play Services
                    port == 123 ||  // NTP
                    port == 5353 || // mDNS
                    port == 1900)   // SSDP
                {
                    return true;
                }
            }
        }
        return false;
    }

    private bool IsRecentDuplicateEvent(SystemEvent newEvent)
    {
        lock (_eventsLock)
        {
            var recentSimilar = _recentEvents
                .Where(e => e.EventType == newEvent.EventType && 
                        e.Timestamp > DateTime.Now.AddMinutes(-1))
                .Any(e => e.NetworkAddress == newEvent.NetworkAddress);
            
            return recentSimilar;
        }
    }

    private async Task MonitorActiveWindow()
    {
        string? lastTitle = null;
        while (!_cancellationTokenSource?.IsCancellationRequested ?? false)
        {
            try
            {
                if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    var hWnd = GetForegroundWindow();
                    if (hWnd != IntPtr.Zero)
                    {
                        const int nChars = 256;
                        var buff = new StringBuilder(nChars);
                        if (GetWindowText(hWnd, buff, nChars) > 0)
                        {
                            var title = buff.ToString();
                            if (!string.IsNullOrWhiteSpace(title) && title != lastTitle)
                            {
                                lastTitle = title;
                                GetWindowThreadProcessId(hWnd, out var processId);
                                var processName = "Unknown";
                                try { processName = Process.GetProcessById((int)processId).ProcessName; } catch { }

                                var systemEvent = new SystemEvent
                                {
                                    Timestamp = DateTime.Now,
                                    EventType = SystemEventType.AppUsage,
                                    Description = $"User opened: {title}",
                                    ProcessName = processName,
                                    AdditionalData = new Dictionary<string, object>
                                    {
                                        ["WindowTitle"] = title,
                                        ["ProcessId"] = processId
                                    }
                                };
                                
                                AddEvent(systemEvent);
                                SystemEventOccurred?.Invoke(this, systemEvent);
                            }
                        }
                    }
                }
                await Task.Delay(1000, _cancellationTokenSource?.Token ?? CancellationToken.None);
            }
            catch (Exception)
            {
                 // Ignore errors in loop
            }
        }
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    private void AddEvent(SystemEvent systemEvent)
    {
        lock (_eventsLock)
        {
            _recentEvents.Add(systemEvent);
            
            // Ограничиваем количество событий в памяти
            if (_recentEvents.Count > 200)
            {
                _recentEvents.RemoveRange(0, 50);
            }
        }
    }
}
