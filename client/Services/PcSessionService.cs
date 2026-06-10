using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Win32;
using Newtonsoft.Json;
using System.IO;

namespace BelfProctor.Services;

/// <summary>
/// Emits explicit Boot / Shutdown events so the server can pinpoint when the PC
/// became online or went offline. A persisted BootId keeps Boot idempotent across
/// agent restarts that happen without an actual reboot.
/// </summary>
public class PcSessionService : IHostedService
{
    private readonly ILogger<PcSessionService> _logger;
    private readonly IDataTransmissionService _transmission;
    private readonly string _statePath;
    private readonly object _stateLock = new();
    private string _bootId = string.Empty;
    private DateTime _bootAtUtc;
    private bool _bootSent;

    public PcSessionService(
        ILogger<PcSessionService> logger,
        IDataTransmissionService transmission)
    {
        _logger = logger;
        _transmission = transmission;
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BelfProctor");
        Directory.CreateDirectory(dir);
        _statePath = Path.Combine(dir, "last_boot.json");
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        LoadOrCreateBootId();
        _transmission.HeartbeatSucceeded += OnHeartbeatSucceeded;
        try { SystemEvents.SessionEnding += OnSessionEnding; } catch { /* not interactive */ }
        return Task.CompletedTask;
    }

    public Task StopAsync(CancellationToken cancellationToken)
    {
        _transmission.HeartbeatSucceeded -= OnHeartbeatSucceeded;
        try { SystemEvents.SessionEnding -= OnSessionEnding; } catch { }
        return Task.CompletedTask;
    }

    private void LoadOrCreateBootId()
    {
        // We tie the BootId to the system boot moment (Environment.TickCount64 isn't reset by agent restarts).
        // If the persisted file matches our system boot timestamp, reuse — else mint a new one.
        var systemBootUtc = DateTime.UtcNow - TimeSpan.FromMilliseconds(Environment.TickCount64);

        lock (_stateLock)
        {
            if (File.Exists(_statePath))
            {
                try
                {
                    var raw = File.ReadAllText(_statePath);
                    var saved = JsonConvert.DeserializeObject<BootState>(raw);
                    if (saved != null
                        && !string.IsNullOrWhiteSpace(saved.BootId)
                        && Math.Abs((saved.SystemBootUtc - systemBootUtc).TotalSeconds) < 30)
                    {
                        _bootId = saved.BootId;
                        _bootAtUtc = saved.SystemBootUtc;
                        _bootSent = saved.BootSent;
                        return;
                    }
                }
                catch { }
            }

            _bootId = Guid.NewGuid().ToString("N");
            _bootAtUtc = systemBootUtc;
            _bootSent = false;
            SaveState();
        }
    }

    private void SaveState()
    {
        try
        {
            File.WriteAllText(_statePath, JsonConvert.SerializeObject(new BootState
            {
                BootId = _bootId,
                SystemBootUtc = _bootAtUtc,
                BootSent = _bootSent,
            }));
        }
        catch { }
    }

    private async void OnHeartbeatSucceeded()
    {
        bool needSend;
        lock (_stateLock)
        {
            needSend = !_bootSent;
        }
        if (!needSend) return;

        try
        {
            await _transmission.SendPcSessionEventAsync("Boot", _bootAtUtc, _bootId);
            lock (_stateLock)
            {
                _bootSent = true;
                SaveState();
            }
            _logger.LogInformation("Boot event sent (bootId={BootId}, bootAt={BootAt:o})", _bootId, _bootAtUtc);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send Boot event — will retry on next heartbeat");
        }
    }

    private void OnSessionEnding(object? sender, SessionEndingEventArgs e)
    {
        // Synchronous: SessionEnding fires moments before OS termination.
        // Block up to 3 seconds so the encrypted POST has a chance to land.
        try
        {
            var task = _transmission.SendPcSessionEventAsync("Shutdown", DateTime.UtcNow, _bootId);
            task.Wait(TimeSpan.FromSeconds(3));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send Shutdown event synchronously");
        }
    }

    private sealed class BootState
    {
        public string BootId { get; set; } = string.Empty;
        public DateTime SystemBootUtc { get; set; }
        public bool BootSent { get; set; }
    }
}
