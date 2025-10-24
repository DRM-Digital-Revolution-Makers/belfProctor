using System.Diagnostics;
using System.Management;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;

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

    public async Task<List<SystemEvent>> GetRecentEventsAsync(TimeSpan timeSpan)
    {
        var cutoffTime = DateTime.Now - timeSpan;
        
        lock (_eventsLock)
        {
            return _recentEvents
                .Where(e => e.Timestamp >= cutoffTime)
                .OrderByDescending(e => e.Timestamp)
                .ToList();
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

    private void AddEvent(SystemEvent systemEvent)
    {
        lock (_eventsLock)
        {
            _recentEvents.Add(systemEvent);
            
            // Ограничиваем количество событий в памяти
            if (_recentEvents.Count > 1000)
            {
                _recentEvents.RemoveRange(0, 100);
            }
        }
    }
}