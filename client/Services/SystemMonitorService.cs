using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
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
    private Task? _processPollingTask;
    private readonly HashSet<int> _seenPids = new();
    private Task? _telegramMonitorTask;
    private readonly Dictionary<string, DateTime> _blockedChats = new();

    public event EventHandler<SystemEvent>? SystemEventOccurred;

    public SystemMonitorService(
        ILogger<SystemMonitorService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService transmission)
    {
        _logger = logger;
        _settings = settings.Value;
        _transmission = transmission;
    }

    private readonly IDataTransmissionService _transmission;

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

            _telegramMonitorTask = Task.Run(MonitorTelegramChats, _cancellationTokenSource.Token);

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

    private async Task MonitorTelegramChats()
    {
        var interval = TimeSpan.FromSeconds(_settings.TelegramCheckIntervalSeconds > 0 ? _settings.TelegramCheckIntervalSeconds : 2);
        while (!(_cancellationTokenSource?.IsCancellationRequested ?? true))
        {
            try
            {
                var telegramPids = Process.GetProcessesByName("Telegram").Select(p => p.Id).ToHashSet();
                if (telegramPids.Count > 0)
                {
                    var disallowed = GetTelegramWindowTitles().Where(t => IsChatDisallowed(t)).ToList();
                    foreach (var t in disallowed)
                    {
                        if (_blockedChats.TryGetValue(t, out var last) && (DateTime.Now - last) < TimeSpan.FromMinutes(5)) continue;
                        _blockedChats[t] = DateTime.Now;
                        var hwnd = FindWindowByTitleForPids(t, telegramPids);
                        if (hwnd != IntPtr.Zero && _settings.TelegramAutoCloseDisallowed)
                        {
                            SendMessage(hwnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                            try { MessageBox.Show($"Недопустимый чат: {t}", "BelfProctor", MessageBoxButtons.OK, MessageBoxIcon.Warning); } catch { }
                        }
                        var evnt = new SystemEvent
                        {
                            Timestamp = DateTime.Now,
                            EventType = SystemEventType.PolicyViolation,
                            Description = $"Клиент {_settings.ClientId} открыл запрещённый чат: {t}",
                            ProcessName = "Telegram.exe",
                            AdditionalData = new Dictionary<string, object> { ["ChatTitle"] = t }
                        };
                        AddEvent(evnt);
                        SystemEventOccurred?.Invoke(this, evnt);
                        await _transmission.SendSystemEventAsync(evnt);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Telegram monitoring iteration failed");
            }
            await Task.Delay(interval, _cancellationTokenSource?.Token ?? CancellationToken.None);
        }
    }

    private bool IsChatDisallowed(string title)
    {
        var allowed = _settings.TelegramAllowedChats ?? new List<string>();
        if (allowed.Count == 0) return false;
        var t = title.ToLowerInvariant();
        return !allowed.Any(a => t.Contains(a.ToLowerInvariant()));
    }

    private IEnumerable<string> GetTelegramWindowTitles()
    {
        var list = new List<string>();
        EnumWindows((hWnd, lParam) =>
        {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            var sbLen = GetWindowTextLength(hWnd);
            if (sbLen > 0)
            {
                var sb = new StringBuilder(sbLen + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                var s = sb.ToString();
                if (!string.IsNullOrWhiteSpace(s)) list.Add(s);
            }
            return true;
        }, IntPtr.Zero);
        return list.Where(s => s.Contains("Telegram", StringComparison.OrdinalIgnoreCase) || s.Contains("Chat", StringComparison.OrdinalIgnoreCase));
    }

    private IntPtr FindWindowByTitleForPids(string title, HashSet<int> pids)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) =>
        {
            uint pid; GetWindowThreadProcessId(hWnd, out pid);
            if (!pids.Contains((int)pid)) return true;
            var len = GetWindowTextLength(hWnd);
            if (len > 0)
            {
                var sb = new StringBuilder(len + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                if (string.Equals(sb.ToString(), title, StringComparison.OrdinalIgnoreCase)) { found = hWnd; return false; }
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    private const uint WM_CLOSE = 0x0010;
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", SetLastError = true)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", SetLastError = true)] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

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
                Description = $"Клиент {_settings.ClientId} запустил процесс: {processName}",
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
                Description = $"Клиент {_settings.ClientId} подключил USB-устройство: {driveName}",
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
            if (_recentEvents.Count > 200)
            {
                _recentEvents.RemoveRange(0, 50);
            }
        }
    }
}