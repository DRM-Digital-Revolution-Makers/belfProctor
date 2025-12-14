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
    private ManagementEventWatcher? _usbWatcher;
    private CancellationTokenSource? _cancellationTokenSource;
    private Task? _processPollingTask;
    private readonly HashSet<int> _seenPids = new();

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
        
        _usbWatcher?.Stop();
        _usbWatcher?.Dispose();
        
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
                // Мониторинг подключения USB устройств
                var usbQuery = new WqlEventQuery("SELECT * FROM Win32_VolumeChangeEvent WHERE EventType = 2");
                _usbWatcher = new ManagementEventWatcher(usbQuery);
                _usbWatcher.EventArrived += OnUSBDeviceConnected;
                _usbWatcher.Start();

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

    private void OnUSBDeviceConnected(object sender, EventArrivedEventArgs e)
    {
        try
        {
            var driveName = e.NewEvent["DriveName"]?.ToString() ?? "Unknown";

            var systemEvent = new SystemEvent
            {
                Timestamp = DateTime.Now,
                EventType = SystemEventType.USBConnected,
                Description = $"USB device connected: {driveName}",
                DeviceId = driveName
            };

            AddEvent(systemEvent);
            SystemEventOccurred?.Invoke(this, systemEvent);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing USB connection event");
        }
    }

    private void AnalyzeNetworkOutput(string output)
    {
        // Простой анализ сетевых соединений
        var lines = output.Split('\n');
        foreach (var line in lines)
        {
            if (line.Contains("ESTABLISHED") && !line.Contains("127.0.0.1"))
            {
                var parts = line.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 3)
                {
                    var localAddress = parts[1];
                    var remoteAddress = parts[2];

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
