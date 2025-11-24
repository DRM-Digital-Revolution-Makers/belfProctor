using System.Text;
using System.Diagnostics;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;

namespace BelfProctor.Services;

public class ReportingService : IReportingService
{
    private readonly ILogger<ReportingService> _logger;
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _dataTransmissionService;
    private readonly string _logFilePath;
    private readonly object _logLock = new();

    public ReportingService(
        ILogger<ReportingService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService dataTransmissionService)
    {
        _logger = logger;
        _settings = settings.Value;
        _dataTransmissionService = dataTransmissionService;
        _logFilePath = Path.Combine(_settings.LogPath, $"events_{DateTime.Now:yyyyMMdd}.log");
    }

    public async Task GenerateStatusReportAsync()
    {
        try
        {
            var report = new
            {
                Timestamp = DateTime.UtcNow,
                ClientId = _settings.ClientId,
                Status = "Active",
                SystemInfo = await GetSystemInfoAsync(),
                Configuration = new
                {
                    ScreenshotInterval = _settings.ScreenshotInterval,
                    MonitorUSB = _settings.MonitorUSB,
                    MonitorProcesses = _settings.MonitorProcesses,
                    MonitorNetwork = _settings.MonitorNetwork
                },
                Statistics = await GetStatisticsAsync()
            };

            var reportJson = JsonConvert.SerializeObject(report, Formatting.Indented);
            var reportPath = Path.Combine(_settings.ReportsPath, $"status_report_{DateTime.Now:yyyyMMdd_HHmmss}.json");
            
            await File.WriteAllTextAsync(reportPath, reportJson);
            await _dataTransmissionService.SendReportAsync(reportPath);
            
            _logger.LogInformation("Status report generated: {ReportPath}", reportPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate status report");
        }
    }

    public async Task GenerateSecurityReportAsync()
    {
        try
        {
            var events = await GetRecentSecurityEventsAsync();
            
            var report = new
            {
                Timestamp = DateTime.UtcNow,
                ClientId = _settings.ClientId,
                ReportType = "Security",
                Period = new
                {
                    From = DateTime.UtcNow.AddHours(-24),
                    To = DateTime.UtcNow
                },
                EventsSummary = new
                {
                    TotalEvents = events.Count,
                    PolicyViolations = events.Count(e => e.EventType == SystemEventType.PolicyViolation),
                    ProcessEvents = events.Count(e => e.EventType == SystemEventType.ProcessStarted),
                    USBEvents = events.Count(e => e.EventType == SystemEventType.USBConnected),
                    NetworkEvents = events.Count(e => e.EventType == SystemEventType.NetworkConnection)
                },
                Events = events.Take(100) // Ограничиваем количество событий в отчете
            };

            var reportJson = JsonConvert.SerializeObject(report, Formatting.Indented);
            var reportPath = Path.Combine(_settings.ReportsPath, $"security_report_{DateTime.Now:yyyyMMdd_HHmmss}.json");
            
            await File.WriteAllTextAsync(reportPath, reportJson);
            await _dataTransmissionService.SendReportAsync(reportPath);
            
            _logger.LogInformation("Security report generated: {ReportPath}", reportPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate security report");
        }
    }

    public async Task LogEventAsync(SystemEvent systemEvent)
    {
        try
        {
            var logEntry = new
            {
                Timestamp = systemEvent.Timestamp,
                EventType = systemEvent.EventType.ToString(),
                Description = systemEvent.Description,
                ProcessName = systemEvent.ProcessName,
                DeviceId = systemEvent.DeviceId,
                NetworkAddress = systemEvent.NetworkAddress,
                AdditionalData = systemEvent.AdditionalData
            };

            var logLine = JsonConvert.SerializeObject(logEntry) + Environment.NewLine;
            
            lock (_logLock)
            {
                File.AppendAllText(_logFilePath, logLine);
            }

            // Проверяем размер лог-файла
            await CheckLogFileSizeAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to log event: {EventType}", systemEvent.EventType);
        }
    }

    public async Task<string> GetSystemStatusAsync()
    {
        try
        {
            var status = new
            {
                Timestamp = DateTime.UtcNow,
                ServiceStatus = "Running",
                LastScreenshot = GetLastScreenshotTime(),
                LastHeartbeat = DateTime.UtcNow,
                DiskSpace = await GetDiskSpaceInfoAsync(),
                Memory = await GetMemoryInfoAsync(),
                ActivePolicies = await GetActivePoliciesCountAsync()
            };

            return JsonConvert.SerializeObject(status, Formatting.Indented);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get system status");
            return "Error retrieving system status";
        }
    }

    public async Task ArchiveOldLogsAsync()
    {
        try
        {
            var logFiles = Directory.GetFiles(_settings.LogPath, "events_*.log");
            var cutoffDate = DateTime.Now.AddDays(-30); // Архивируем логи старше 30 дней

            foreach (var logFile in logFiles)
            {
                var fileInfo = new FileInfo(logFile);
                if (fileInfo.CreationTime < cutoffDate)
                {
                    var archivePath = Path.Combine(_settings.LogPath, "Archive");
                    if (!Directory.Exists(archivePath))
                    {
                        Directory.CreateDirectory(archivePath);
                    }

                    var archiveFile = Path.Combine(archivePath, fileInfo.Name + ".gz");
                    
                    // Сжимаем и перемещаем файл
                    using (var originalFileStream = File.OpenRead(logFile))
                    using (var compressedFileStream = File.Create(archiveFile))
                    using (var compressionStream = new System.IO.Compression.GZipStream(compressedFileStream, System.IO.Compression.CompressionMode.Compress))
                    {
                        await originalFileStream.CopyToAsync(compressionStream);
                    }

                    File.Delete(logFile);
                    _logger.LogInformation("Archived log file: {LogFile}", logFile);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to archive old logs");
        }
    }

    private async Task<object> GetSystemInfoAsync()
    {
        return await Task.FromResult(new
        {
            MachineName = Environment.MachineName,
            UserName = Environment.UserName,
            OSVersion = Environment.OSVersion.ToString(),
            ProcessorCount = Environment.ProcessorCount,
            WorkingSet = Environment.WorkingSet,
            Version = Environment.Version.ToString()
        });
    }

private Task<object> GetStatisticsAsync()
    {
        try
        {
            var screenshotCount = Directory.GetFiles(_settings.ScreenshotPath, "screenshot_*.jpg").Length;
            var logFiles = Directory.GetFiles(_settings.LogPath, "events_*.log");
            var totalLogSize = logFiles.Sum(f => new FileInfo(f).Length);

            return Task.FromResult<object>(new
            {
                ScreenshotsCount = screenshotCount,
                LogFilesCount = logFiles.Length,
                TotalLogSize = totalLogSize,
                UptimeHours = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalHours
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get statistics");
            return Task.FromResult<object>(new { Error = "Failed to retrieve statistics" });
        }
    }

    private async Task<List<SystemEvent>> GetRecentSecurityEventsAsync()
    {
        var events = new List<SystemEvent>();
        
        try
        {
            var logFiles = Directory.GetFiles(_settings.LogPath, "events_*.log")
                .OrderByDescending(f => new FileInfo(f).CreationTime)
                .Take(7); // Последние 7 дней

            foreach (var logFile in logFiles)
            {
                var lines = await File.ReadAllLinesAsync(logFile);
                foreach (var line in lines)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    
                    try
                    {
                        var logEntry = JsonConvert.DeserializeObject<dynamic>(line);
                        if (logEntry != null)
                        {
                            var eventType = Enum.Parse<SystemEventType>(logEntry.EventType.ToString());
                            var systemEvent = new SystemEvent
                            {
                                Timestamp = logEntry.Timestamp,
                                EventType = eventType,
                                Description = logEntry.Description,
                                ProcessName = logEntry.ProcessName,
                                DeviceId = logEntry.DeviceId,
                                NetworkAddress = logEntry.NetworkAddress
                            };
                            
                            events.Add(systemEvent);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogDebug(ex, "Failed to parse log line: {Line}", line);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get recent security events");
        }

        return events.OrderByDescending(e => e.Timestamp).ToList();
    }

    private DateTime GetLastScreenshotTime()
    {
        try
        {
            var screenshots = Directory.GetFiles(_settings.ScreenshotPath, "screenshot_*.jpg");
            if (screenshots.Length > 0)
            {
                var lastScreenshot = screenshots
                    .Select(f => new FileInfo(f))
                    .OrderByDescending(f => f.CreationTime)
                    .First();
                return lastScreenshot.CreationTime;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get last screenshot time");
        }

        return DateTime.MinValue;
    }

private Task<object> GetDiskSpaceInfoAsync()
    {
        try
        {
            var drive = new DriveInfo(Path.GetPathRoot(_settings.LogPath) ?? "C:\\");
            return Task.FromResult<object>(new
            {
                TotalSize = drive.TotalSize,
                AvailableSpace = drive.AvailableFreeSpace,
                UsedSpace = drive.TotalSize - drive.AvailableFreeSpace
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get disk space info");
            return Task.FromResult<object>(new { Error = "Failed to retrieve disk space info" });
        }
    }

private Task<object> GetMemoryInfoAsync()
    {
        try
        {
            var process = Process.GetCurrentProcess();
            return Task.FromResult<object>(new
            {
                WorkingSet = process.WorkingSet64,
                PrivateMemorySize = process.PrivateMemorySize64,
                VirtualMemorySize = process.VirtualMemorySize64
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get memory info");
            return Task.FromResult<object>(new { Error = "Failed to retrieve memory info" });
        }
    }

    private async Task<int> GetActivePoliciesCountAsync()
    {
        try
        {
            var policiesFile = Path.Combine(_settings.LogPath, "policies.json");
            if (File.Exists(policiesFile))
            {
                var json = await File.ReadAllTextAsync(policiesFile);
                var policies = JsonConvert.DeserializeObject<List<SecurityPolicy>>(json) ?? new List<SecurityPolicy>();
                return policies.Count(p => p.IsActive);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get active policies count");
        }

        return 0;
    }

private Task CheckLogFileSizeAsync()
    {
        try
        {
            var fileInfo = new FileInfo(_logFilePath);
            if (fileInfo.Exists && fileInfo.Length > _settings.MaxLogFileSize)
            {
                // Создаем новый лог-файл
                var newLogPath = Path.Combine(_settings.LogPath, $"events_{DateTime.Now:yyyyMMdd_HHmmss}.log");
                
                lock (_logLock)
                {
                    // Переименовываем текущий файл
                    File.Move(_logFilePath, newLogPath);
                }

                _logger.LogInformation("Log file rotated: {NewLogPath}", newLogPath);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check log file size");
        }
        return Task.CompletedTask;
    }
}