// Класс: ProctorWorker
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using BelfProctor.Services;
using Timer = System.Threading.Timer;

namespace BelfProctor;

public class ProctorWorker : BackgroundService
{
    private readonly ILogger<ProctorWorker> _logger;
    private readonly ProctorSettings _settings;
    private readonly IScreenshotService _screenshotService;
    private readonly ISystemMonitorService _systemMonitorService;
    private readonly IDataTransmissionService _dataTransmissionService;
    private readonly IPolicyService _policyService;
    private readonly IReportingService _reportingService;
    private readonly IStabilityService _stabilityService;
    private readonly IActivityMonitorService _activityMonitorService;

    public ProctorWorker(
        ILogger<ProctorWorker> logger,
        IOptions<ProctorSettings> settings,
        IScreenshotService screenshotService,
        ISystemMonitorService systemMonitorService,
        IDataTransmissionService dataTransmissionService,
        IPolicyService policyService,
        IReportingService reportingService,
        IStabilityService stabilityService,
        IActivityMonitorService activityMonitorService)
    {
        _logger = logger;
        _settings = settings.Value;
        _screenshotService = screenshotService;
        _systemMonitorService = systemMonitorService;
        _dataTransmissionService = dataTransmissionService;
        _policyService = policyService;
        _reportingService = reportingService;
        _stabilityService = stabilityService;
        _activityMonitorService = activityMonitorService;
    }

    public override async Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("BelfProctor service starting...");
        
        try
        {
            // Инициализация директорий
            await InitializeDirectories();
            
            // Запуск мониторинга стабильности
            await _stabilityService.StartAsync(cancellationToken);
            
            // Запуск системного мониторинга
            await _systemMonitorService.StartAsync(cancellationToken);
            await _activityMonitorService.StartAsync(cancellationToken);
            _activityMonitorService.ActivityChanged += OnActivityChanged;
            
            // Загрузка политик безопасности
            await _policyService.LoadPoliciesAsync();
            
            _logger.LogInformation("BelfProctor service started successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start BelfProctor service");
            throw;
        }

        await base.StartAsync(cancellationToken);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var screenshotLoop = RunScreenshotLoop(stoppingToken);

        var heartbeatTimer = new Timer(async _ => await SendHeartbeat(), null,
            TimeSpan.Zero, TimeSpan.FromMilliseconds(_settings.HeartbeatInterval));
        
        var policyUpdateTimer = new Timer(async _ => await UpdatePolicies(), null,
            TimeSpan.Zero, TimeSpan.FromMilliseconds(_settings.PolicyUpdateInterval));

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(1000, stoppingToken);
            }
        }
        finally
        {
            try { await screenshotLoop; } catch { }
            heartbeatTimer?.Dispose();
            policyUpdateTimer?.Dispose();
        }
    }

    private async Task RunScreenshotLoop(CancellationToken ct)
    {
        var timer = new System.Threading.PeriodicTimer(TimeSpan.FromMilliseconds(_settings.ScreenshotInterval));
        // Немедленный снимок при старте
        await TakeScreenshot();
        while (await timer.WaitForNextTickAsync(ct))
        {
            await TakeScreenshot();
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("BelfProctor service stopping...");
        
        await _systemMonitorService.StopAsync(cancellationToken);
        await _stabilityService.StopAsync(cancellationToken);
        _activityMonitorService.ActivityChanged -= OnActivityChanged;
        
        _logger.LogInformation("BelfProctor service stopped");
        await base.StopAsync(cancellationToken);
    }

    private async Task InitializeDirectories()
    {
        await Task.Run(() =>
        {
            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

            var screenshotPath = _settings.ScreenshotPath;
            var logPath = _settings.LogPath;
            var reportsPath = _settings.ReportsPath;

            if (string.IsNullOrWhiteSpace(screenshotPath))
            {
                screenshotPath = Path.Combine(localAppData, "BelfProctor", "Screenshots");
                _settings.ScreenshotPath = screenshotPath;
            }

            if (string.IsNullOrWhiteSpace(logPath))
            {
                logPath = Path.Combine(localAppData, "BelfProctor", "Logs");
                _settings.LogPath = logPath;
            }

            if (string.IsNullOrWhiteSpace(reportsPath))
            {
                reportsPath = Path.Combine(localAppData, "BelfProctor", "Reports");
                _settings.ReportsPath = reportsPath;
            }

            var directories = new[]
            {
                Environment.ExpandEnvironmentVariables(screenshotPath),
                Environment.ExpandEnvironmentVariables(logPath),
                Environment.ExpandEnvironmentVariables(reportsPath)
            };

            foreach (var directory in directories)
            {
                if (string.IsNullOrWhiteSpace(directory))
                {
                    _logger.LogError("Directory path is empty. Please configure paths in appsettings.json");
                    continue;
                }

                if (!Directory.Exists(directory))
                {
                    Directory.CreateDirectory(directory);
                    _logger.LogInformation("Created directory: {Directory}", directory);
                }
            }
        });
    }

    private async Task TakeScreenshot()
    {
        try
        {
            await _screenshotService.CaptureScreenshotAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to take screenshot");
        }
    }

    private async Task SendHeartbeat()
    {
        try
        {
            await _dataTransmissionService.SendHeartbeatAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send heartbeat");
        }
    }

    private async Task UpdatePolicies()
    {
        try
        {
            if (_activityMonitorService.IsUserActive)
            {
                await _policyService.UpdatePoliciesFromServerAsync();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update policies");
        }
    }

    private void OnActivityChanged(object? sender, bool isActive)
    {
        var ms = (long)_activityMonitorService.ActiveElapsed.TotalMilliseconds;
        var ims = (long)_activityMonitorService.InactiveElapsed.TotalMilliseconds;
        _ = Task.Run(async () =>
        {
            try { await _dataTransmissionService.SendActivityAsync(isActive, ms, ims); }
            catch { }
        });
    }
}