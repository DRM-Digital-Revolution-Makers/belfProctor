// Класс: StabilityService
using System.Diagnostics;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using System.Net.NetworkInformation;
using Timer = System.Threading.Timer;

namespace BelfProctor.Services;

public class StabilityService : BackgroundService, IStabilityService
{
    private readonly ILogger<StabilityService> _logger;
    private readonly ProctorSettings _settings;
    private readonly IServiceProvider _serviceProvider;
    private Timer? _healthCheckTimer;
    private Timer? _memoryCheckTimer;
    private DateTime _lastHeartbeat = DateTime.Now;
    private int _consecutiveFailures = 0;
    private readonly object _lockObject = new();

    public bool IsHealthy { get; private set; } = true;

    public StabilityService(
        ILogger<StabilityService> logger,
        IOptions<ProctorSettings> settings,
        IServiceProvider serviceProvider)
    {
        _logger = logger;
        _settings = settings.Value;
        _serviceProvider = serviceProvider;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Stability service started");

        // Запускаем таймер проверки здоровья каждые 30 секунд
        _healthCheckTimer = new Timer(PerformHealthCheck, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
        
        // Запускаем таймер проверки памяти каждые 5 минут
        _memoryCheckTimer = new Timer(CheckMemoryUsage, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5));

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
                
                // Обновляем heartbeat
                UpdateHeartbeat();
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Stability service is stopping");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Stability service encountered an error");
        }
        finally
        {
            _healthCheckTimer?.Dispose();
            _memoryCheckTimer?.Dispose();
        }
    }

    public new Task StartAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Starting stability monitoring");
        IsHealthy = true;
        _consecutiveFailures = 0;
        return Task.CompletedTask;
    }

    public new Task StopAsync(CancellationToken cancellationToken)
    {
        _logger.LogInformation("Stopping stability monitoring");
        _healthCheckTimer?.Dispose();
        _memoryCheckTimer?.Dispose();
        return Task.CompletedTask;
    }

    public async Task<bool> CheckHealthAsync()
    {
        try
        {
            var healthChecks = new List<Task<bool>>
            {
                CheckServiceResponsiveness(),
                CheckDiskSpace(),
                CheckMemoryUsage(),
                CheckCriticalFiles(),
                CheckNetworkConnectivity()
            };

            var results = await Task.WhenAll(healthChecks);
            var isHealthy = results.All(r => r);

            lock (_lockObject)
            {
                if (isHealthy)
                {
                    _consecutiveFailures = 0;
                    IsHealthy = true;
                }
                else
                {
                    _consecutiveFailures++;
                    _logger.LogWarning("Health check failed. Consecutive failures: {Failures}", _consecutiveFailures);
                    
                    if (_consecutiveFailures >= 3)
                    {
                        IsHealthy = false;
                        _logger.LogError("Service is unhealthy after {Failures} consecutive failures", _consecutiveFailures);
                    }
                }
            }

            return isHealthy;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Health check encountered an error");
            return false;
        }
    }

    public async Task RestartServiceAsync()
    {
        try
        {
            _logger.LogWarning("Attempting to restart service due to health issues");
            
            // Логируем причину перезапуска
            await LogRestartReasonAsync();
            
            // Попытка мягкого перезапуска сервисов
            await SoftRestartServicesAsync();
            
            // Если мягкий перезапуск не помог, выполняем жесткий перезапуск
            if (!await CheckHealthAsync())
            {
                await HardRestartAsync();
            }
            
            _logger.LogInformation("Service restart completed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to restart service");
            
            // В критической ситуации пытаемся перезапустить весь процесс
            await EmergencyRestartAsync();
        }
    }

    private void PerformHealthCheck(object? state)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var isHealthy = await CheckHealthAsync();
                
                if (!isHealthy && _consecutiveFailures >= 3)
                {
                    _logger.LogError("Service is critically unhealthy. Initiating restart procedure");
                    await RestartServiceAsync();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during health check");
            }
        });
    }

    private void CheckMemoryUsage(object? state)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                var process = Process.GetCurrentProcess();
                var memoryUsageMB = process.WorkingSet64 / (1024 * 1024);
                
                _logger.LogDebug("Current memory usage: {MemoryMB} MB", memoryUsageMB);
                
                // Если использование памяти превышает 500 МБ, принудительно собираем мусор
                if (memoryUsageMB > 500)
                {
                    _logger.LogWarning("High memory usage detected: {MemoryMB} MB. Forcing garbage collection", memoryUsageMB);
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    GC.Collect();
                }
                
                // Если использование памяти критично (> 1 ГБ), перезапускаем сервис
                if (memoryUsageMB > 1024)
                {
                    _logger.LogError("Critical memory usage: {MemoryMB} MB. Restarting service", memoryUsageMB);
                    await RestartServiceAsync();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during memory check");
            }
        });
    }

    private void UpdateHeartbeat()
    {
        _lastHeartbeat = DateTime.Now;
    }

    private Task<bool> CheckServiceResponsiveness()
    {
        try
        {
            // Проверяем, что heartbeat обновлялся в последние 2 минуты
            var timeSinceLastHeartbeat = DateTime.Now - _lastHeartbeat;
            if (timeSinceLastHeartbeat > TimeSpan.FromMinutes(2))
            {
                _logger.LogWarning("Service appears unresponsive. Last heartbeat: {LastHeartbeat}", _lastHeartbeat);
                return Task.FromResult(false);
            }

            return Task.FromResult(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking service responsiveness");
            return Task.FromResult(false);
        }
    }

    private async Task<bool> CheckDiskSpace()
    {
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(_settings.LogPath) ?? "C:\\");
            var freeSpaceGB = drive.AvailableFreeSpace / (1024 * 1024 * 1024);
            
            if (freeSpaceGB < 1) // Менее 1 ГБ свободного места
            {
                _logger.LogWarning("Low disk space: {FreeSpaceGB} GB available", freeSpaceGB);
                
                // Пытаемся очистить старые файлы
                await CleanupOldFilesAsync();
                return false;
            }

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking disk space");
            return false;
        }
    }

    private Task<bool> CheckMemoryUsage()
    {
        try
        {
            var process = Process.GetCurrentProcess();
            var memoryUsageMB = process.WorkingSet64 / (1024 * 1024);
            
            // Предупреждение при использовании более 800 МБ
            if (memoryUsageMB > 800)
            {
                _logger.LogWarning("High memory usage: {MemoryMB} MB", memoryUsageMB);
                return Task.FromResult(false);
            }

            return Task.FromResult(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking memory usage");
            return Task.FromResult(false);
        }
    }

    private Task<bool> CheckCriticalFiles()
    {
        try
        {
            var criticalPaths = new[]
            {
                _settings.ScreenshotPath,
                _settings.LogPath,
                _settings.ReportsPath
            };

            foreach (var path in criticalPaths)
            {
                if (!Directory.Exists(path))
                {
                    _logger.LogWarning("Critical directory missing: {Path}. Attempting to recreate", path);
                    Directory.CreateDirectory(path);
                }
            }

            return Task.FromResult(true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking critical files");
            return Task.FromResult(false);
        }
    }

    private async Task<bool> CheckNetworkConnectivity()
    {
        try
        {
            using var client = new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            
            var response = await client.GetAsync(_settings.ServerUrl + "/health");
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Network connectivity check failed");
            return false; // Не критично, сервер может быть временно недоступен
        }
    }

    private async Task LogRestartReasonAsync()
    {
        try
        {
            var restartInfo = new
            {
                Timestamp = DateTime.Now,
                Reason = "Health check failure",
                ConsecutiveFailures = _consecutiveFailures,
                LastHeartbeat = _lastHeartbeat,
                MemoryUsage = Process.GetCurrentProcess().WorkingSet64 / (1024 * 1024)
            };

            var logPath = Path.Combine(_settings.LogPath, "restart_log.txt");
            var logEntry = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} - Service restart: {System.Text.Json.JsonSerializer.Serialize(restartInfo)}{Environment.NewLine}";
            
            await File.AppendAllTextAsync(logPath, logEntry);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to log restart reason");
        }
    }

    private async Task SoftRestartServicesAsync()
    {
        try
        {
            _logger.LogInformation("Performing soft restart of services");
            
            // Сбрасываем счетчики и состояние
            _consecutiveFailures = 0;
            IsHealthy = true;
            UpdateHeartbeat();
            
            // Принудительная сборка мусора
            GC.Collect();
            GC.WaitForPendingFinalizers();
            GC.Collect();
            
            await Task.Delay(5000); // Даем время на стабилизацию
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during soft restart");
        }
    }

    private async Task HardRestartAsync()
    {
        try
        {
            _logger.LogWarning("Performing hard restart");
            
            // Останавливаем все таймеры
            _healthCheckTimer?.Dispose();
            _memoryCheckTimer?.Dispose();
            
            // Ждем завершения текущих операций
            await Task.Delay(10000);
            
            // Перезапускаем таймеры
            _healthCheckTimer = new Timer(PerformHealthCheck, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
            _memoryCheckTimer = new Timer(CheckMemoryUsage, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(5));
            
            _consecutiveFailures = 0;
            IsHealthy = true;
            UpdateHeartbeat();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during hard restart");
        }
    }

    private async Task EmergencyRestartAsync()
    {
        try
        {
            _logger.LogCritical("Performing emergency restart - terminating process");
            
            // Записываем критическую ошибку в лог
            var emergencyLogPath = Path.Combine(_settings.LogPath, "emergency_restart.log");
            var logEntry = $"{DateTime.UtcNow:yyyy-MM-dd HH:mm:ss} - EMERGENCY RESTART INITIATED{Environment.NewLine}";
            await File.AppendAllTextAsync(emergencyLogPath, logEntry);
            
            // Завершаем процесс с кодом перезапуска
            Environment.Exit(1);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during emergency restart");
            Environment.Exit(1);
        }
    }

    private Task CleanupOldFilesAsync()
    {
        try
        {
            _logger.LogInformation("Cleaning up old files to free disk space");
            
            // Удаляем старые скриншоты (старше 7 дней)
            var oldScreenshots = Directory.GetFiles(_settings.ScreenshotPath, "screenshot_*.jpg")
                .Where(f => new FileInfo(f).CreationTime < DateTime.Now.AddDays(-7));
            
            foreach (var file in oldScreenshots)
            {
                File.Delete(file);
            }
            
            // Удаляем старые отчеты (старше 30 дней)
            var oldReports = Directory.GetFiles(_settings.ReportsPath, "*_report_*.json")
                .Where(f => new FileInfo(f).CreationTime < DateTime.Now.AddDays(-30));
            
            foreach (var file in oldReports)
            {
                File.Delete(file);
            }
            
            _logger.LogInformation("Cleanup completed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during cleanup");
        }
        return Task.CompletedTask;
    }

    public override void Dispose()
    {
        _healthCheckTimer?.Dispose();
        _memoryCheckTimer?.Dispose();
        base.Dispose();
    }
}