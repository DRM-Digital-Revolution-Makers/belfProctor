using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
namespace BelfProctor.Services;

public class ActivityMonitorService : IActivityMonitorService
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    [DllImport("user32.dll")]
    private static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

    private readonly ILogger<ActivityMonitorService> _logger;
    private readonly TimeSpan _inactivityThreshold = TimeSpan.FromMinutes(3);
    private readonly object _lock = new();
    private System.Threading.Timer? _timer;
    private bool _active;
    private readonly System.Diagnostics.Stopwatch _activeStopwatch = new();
    private readonly System.Diagnostics.Stopwatch _inactiveStopwatch = new();

    public ActivityMonitorService(ILogger<ActivityMonitorService> logger)
    {
        _logger = logger;
    }

    public bool IsUserActive => _active;
    public TimeSpan ActiveElapsed => _activeStopwatch.Elapsed;
    public TimeSpan InactiveElapsed => _inactiveStopwatch.Elapsed;
    public event EventHandler<bool>? ActivityChanged;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        UpdateState();
        if (_active) { _activeStopwatch.Start(); _inactiveStopwatch.Stop(); }
        else { _inactiveStopwatch.Start(); _activeStopwatch.Stop(); }
        _timer = new System.Threading.Timer(_ => UpdateState(), null, TimeSpan.Zero, TimeSpan.FromSeconds(1));
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _timer?.Dispose();
        _timer = null;
        _activeStopwatch.Stop();
        _inactiveStopwatch.Stop();
        return Task.CompletedTask;
    }

    private void UpdateState()
    {
        var idle = GetIdleTime();
        var nowActive = idle < _inactivityThreshold;
        lock (_lock)
        {
            if (nowActive != _active)
            {
                _active = nowActive;
                if (_active) { _activeStopwatch.Start(); _inactiveStopwatch.Stop(); }
                else { _activeStopwatch.Stop(); _inactiveStopwatch.Start(); }
                ActivityChanged?.Invoke(this, _active);
            }
            else
            {
                if (_active && !_activeStopwatch.IsRunning) _activeStopwatch.Start();
                if (!_active && !_inactiveStopwatch.IsRunning) _inactiveStopwatch.Start();
            }
        }
    }

    private static TimeSpan GetIdleTime()
    {
        var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
        if (!GetLastInputInfo(ref info)) return TimeSpan.MaxValue;
        
        uint now = (uint)Environment.TickCount;
        uint last = info.dwTime;
        
        // Unsigned arithmetic handles rollover correctly
        uint diff = now - last;
        
        return TimeSpan.FromMilliseconds(diff);
    }
}