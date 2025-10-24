using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using BelfProctor.Services;

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

    public ProctorWorker(
        ILogger<ProctorWorker> logger,
        IOptions<ProctorSettings> settings,
        IScreenshotService screenshotService,
        ISystemMonitorService systemMonitorService,
        IDataTransmissionService dataTransmissionService,
        IPolicyService policyService,
        IReportingService reportingService,
        IStabilityService stabilityService)
    {
        _logger = logger;
        _settings = settings.Value;
        _screenshotService = screenshotService;
        _systemMonitorService = systemMonitorService;
        _dataTransmissionService = dataTransmissionService;
        _policyService = policyService;
        _reportingService = reportingService;
        _stabilityService = stabilityService;
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
        var screenshotTimer = new Timer(async _ => await TakeScreenshot(), null, 
            TimeSpan.Zero, TimeSpan.FromMilliseconds(_settings.ScreenshotInterval));
        
        var heartbeatTimer = new Timer(async _ => await SendHeartbeat(), null,
            TimeSpan.Zero, TimeSpan.FromMilliseconds(_settings.HeartbeatInterval));
        
        var policyUpdateTimer = new Timer(async _ => await UpdatePolicies(), null,
            TimeSpan.FromMinutes(1), TimeSpan.FromMilliseconds(_settings.PolicyUpdateInterval));

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(1000, stoppingToken);
            }
        }
        finally
        {
            screenshotTimer?.Dispose();
            heartbeatTimer?.Dispose();
            policyUpdateTimer?.Dispose();
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("BelfProctor service stopping...");
        
        await _systemMonitorService.StopAsync(cancellationToken);
        await _stabilityService.StopAsync(cancellationToken);
        
        _logger.LogInformation("BelfProctor service stopped");
        await base.StopAsync(cancellationToken);
    }

    private async Task InitializeDirectories()
    {
        var directories = new[]
        {
            _settings.ScreenshotPath,
            _settings.LogPath,
            _settings.ReportsPath
        };

        foreach (var directory in directories)
        {
            if (!Directory.Exists(directory))
            {
                Directory.CreateDirectory(directory);
                _logger.LogInformation("Created directory: {Directory}", directory);
            }
        }
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
            await _policyService.UpdatePoliciesFromServerAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to update policies");
        }
    }
}