using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using BelfProctor.Models;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;

namespace BelfProctor.Services;

public class WindowMonitorService : BackgroundService
{
    private readonly ILogger<WindowMonitorService> _logger;
    private readonly IDataTransmissionService _dataTransmissionService;
    private readonly ProctorSettings _settings;
    private readonly HashSet<string> _whitelist = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _whitelistLock = new();
    private DateTime _lastWhitelistUpdate = DateTime.MinValue;
    private string _lastTitle = string.Empty;
    private readonly TimeSpan _whitelistUpdateInterval = TimeSpan.FromMinutes(5);
    private const string TelegramProcessName = "Telegram"; // telegram.exe is usually "Telegram"

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public WindowMonitorService(
        ILogger<WindowMonitorService> logger,
        IDataTransmissionService dataTransmissionService,
        IOptions<ProctorSettings> settings)
    {
        _logger = logger;
        _dataTransmissionService = dataTransmissionService;
        _settings = settings.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Initial delay to let system settle
        await Task.Delay(5000, stoppingToken);
        
        await UpdateWhitelistAsync();

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (DateTime.UtcNow - _lastWhitelistUpdate > _whitelistUpdateInterval)
                {
                    await UpdateWhitelistAsync();
                }

                await CheckActiveWindowAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in WindowMonitorService loop");
            }

            await Task.Delay(1000, stoppingToken);
        }
    }

    private async Task UpdateWhitelistAsync()
    {
        try
        {
            var data = await _dataTransmissionService.DownloadWhitelistAsync("Telegram");
            if (data.Length > 0)
            {
                var json = Encoding.UTF8.GetString(data);
                var items = JsonConvert.DeserializeObject<List<string>>(json);
                if (items != null)
                {
                    lock (_whitelistLock)
                    {
                        _whitelist.Clear();
                        foreach (var item in items) _whitelist.Add(item);
                    }
                    _logger.LogDebug("Updated Telegram whitelist: {Count} items", items.Count);
                }
            }
            _lastWhitelistUpdate = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update whitelist");
        }
    }

    private async Task CheckActiveWindowAsync()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return;

        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return;

        GetWindowThreadProcessId(handle, out uint pid);
        if (pid == 0) return;

        try
        {
            var process = Process.GetProcessById((int)pid);
            if (process.ProcessName.Contains(TelegramProcessName, StringComparison.OrdinalIgnoreCase))
            {
                const int nChars = 256;
                var buff = new StringBuilder(nChars);
                if (GetWindowText(handle, buff, nChars) > 0)
                {
                    var title = buff.ToString();
                    
                    // Avoid spamming the same violation
                    if (title == _lastTitle) return;
                    _lastTitle = title;

                    // Check whitelist
                    bool allowed = false;
                    lock (_whitelistLock)
                    {
                        // Whitelist check: exact match or contains?
                        // User said "whitelist telegram chats".
                        // Usually title is just "ChatName".
                        // We check if any whitelisted item is contained in title?
                        // Or if title contains whitelisted item?
                        // Let's assume exact or contains.
                        if (_whitelist.Count == 0)
                        {
                            // If whitelist empty, maybe allow all or block all?
                            // Usually whitelist implies "Default Deny".
                            // But if not configured, we shouldn't block everything.
                            // Let's assume if whitelist is empty, we don't enforce.
                            allowed = true; 
                        }
                        else
                        {
                            allowed = _whitelist.Any(w => title.Contains(w, StringComparison.OrdinalIgnoreCase));
                        }
                    }

                    if (!allowed)
                    {
                        _logger.LogWarning("Telegram Whitelist Violation: {Title}", title);
                        
                        var ev = new SystemEvent
                        {
                            Timestamp = DateTime.Now,
                            EventType = SystemEventType.PolicyViolation,
                            Description = $"Unauthorized Telegram Chat: {title}",
                            Details = "Window Title does not match whitelist",
                            ProcessName = process.ProcessName
                        };
                        
                        await _dataTransmissionService.SendSystemEventAsync(ev);
                    }
                }
            }
            else
            {
                _lastTitle = string.Empty; // Reset if switched away from Telegram
            }
        }
        catch (ArgumentException)
        {
            // Process might have exited
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking active window");
        }
    }
}
