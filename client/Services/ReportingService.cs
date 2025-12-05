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
    private readonly IActivityMonitorService _activityMonitor;
    private readonly string _logFilePath;
    private readonly object _logLock = new();

    public ReportingService(
        ILogger<ReportingService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService dataTransmissionService,
        IActivityMonitorService activityMonitor)
    {
        _logger = logger;
        _settings = settings.Value;
        _dataTransmissionService = dataTransmissionService;
        _activityMonitor = activityMonitor;
        var logBase = Environment.ExpandEnvironmentVariables(_settings.LogPath ?? string.Empty);
        Directory.CreateDirectory(logBase);
        _logFilePath = Path.Combine(logBase, $"events_{DateTime.Now:yyyyMMdd}.log");
    }

    private static string ExpandPath(string? p)
    {
        return Environment.ExpandEnvironmentVariables(p ?? string.Empty);
    }

    public async Task GenerateStatusReportAsync()
    {
        try
        {
            var reportsDir = ExpandPath(_settings.ReportsPath);
            Directory.CreateDirectory(reportsDir);
            var reportPath = Path.Combine(reportsDir, $"status_report_{DateTime.Now:yyyyMMdd_HHmmss}.json");

            using var fileStream = new FileStream(reportPath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, true);
            using var writer = new StreamWriter(fileStream, Encoding.UTF8);
            using var jsonWriter = new JsonTextWriter(writer);
            jsonWriter.Formatting = Formatting.Indented;

            var sysInfo = await GetSystemInfoAsync();
            var stats = await GetStatisticsAsync();

            await jsonWriter.WriteStartObjectAsync();
            
            await jsonWriter.WritePropertyNameAsync("Timestamp");
            await jsonWriter.WriteValueAsync(DateTime.UtcNow);
            
            await jsonWriter.WritePropertyNameAsync("ClientId");
            await jsonWriter.WriteValueAsync(_settings.ClientId);
            
            await jsonWriter.WritePropertyNameAsync("Status");
            await jsonWriter.WriteValueAsync("Active");

            await jsonWriter.WritePropertyNameAsync("SystemInfo");
            JsonSerializer.CreateDefault().Serialize(jsonWriter, sysInfo);
            
            await jsonWriter.WritePropertyNameAsync("Configuration");
            await jsonWriter.WriteStartObjectAsync();
            await jsonWriter.WritePropertyNameAsync("ScreenshotInterval");
            await jsonWriter.WriteValueAsync(_settings.ScreenshotInterval);
            await jsonWriter.WritePropertyNameAsync("MonitorUSB");
            await jsonWriter.WriteValueAsync(_settings.MonitorUSB);
            await jsonWriter.WritePropertyNameAsync("MonitorProcesses");
            await jsonWriter.WriteValueAsync(_settings.MonitorProcesses);
            await jsonWriter.WritePropertyNameAsync("MonitorNetwork");
            await jsonWriter.WriteValueAsync(_settings.MonitorNetwork);
            await jsonWriter.WriteEndObjectAsync();

            await jsonWriter.WritePropertyNameAsync("Statistics");
            JsonSerializer.CreateDefault().Serialize(jsonWriter, stats);

            await jsonWriter.WriteEndObjectAsync();

            await jsonWriter.FlushAsync();
            await writer.FlushAsync();
            jsonWriter.Close();
            writer.Close();
            fileStream.Close();
            
            await _dataTransmissionService.SendReportAsync(reportPath);
            
            _logger.LogInformation("Status report generated: {ReportPath}", reportPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate status report");
        }
    }

    public async Task GenerateDailyReportAsync()
    {
        try
        {
            var reportsDir = ExpandPath(_settings.ReportsPath);
            Directory.CreateDirectory(reportsDir);
            var reportPath = Path.Combine(reportsDir, $"daily_report_{DateTime.Now:yyyyMMdd_HHmmss}.json");

            using var fileStream = new FileStream(reportPath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, true);
            using var writer = new StreamWriter(fileStream, Encoding.UTF8);
            using var jsonWriter = new JsonTextWriter(writer);
            jsonWriter.Formatting = Formatting.Indented;

            await jsonWriter.WriteStartObjectAsync();

            await jsonWriter.WritePropertyNameAsync("Timestamp");
            await jsonWriter.WriteValueAsync(DateTime.UtcNow);

            await jsonWriter.WritePropertyNameAsync("ClientId");
            await jsonWriter.WriteValueAsync(_settings.ClientId);

            await jsonWriter.WritePropertyNameAsync("ReportType");
            await jsonWriter.WriteValueAsync("Daily");

            // Расчетный период: с 00:00 текущего дня до текущего момента (или до конца дня, если отчет за прошлый день)
            // В данном случае считаем с начала текущего дня (локальное время машины)
            var today = DateTime.Today;
            await jsonWriter.WritePropertyNameAsync("PeriodStart");
            await jsonWriter.WriteValueAsync(today);
            await jsonWriter.WritePropertyNameAsync("PeriodEnd");
            await jsonWriter.WriteValueAsync(today.AddDays(1));

            // 1. Время запуска
            var processStartTime = Process.GetCurrentProcess().StartTime;
            await jsonWriter.WritePropertyNameAsync("BelfProctorStartTime");
            await jsonWriter.WriteValueAsync(processStartTime);

            // 2. Количество скриншотов за сегодня
            var screenshotsDir = ExpandPath(_settings.ScreenshotPath);
            var todayScreenshots = 0;
            if (Directory.Exists(screenshotsDir))
            {
                todayScreenshots = Directory.EnumerateFiles(screenshotsDir, "screenshot_*.jpg")
                    .Count(f => File.GetCreationTime(f).Date == today);
            }
            await jsonWriter.WritePropertyNameAsync("ScreenshotsCount");
            await jsonWriter.WriteValueAsync(todayScreenshots);

            // 3. Время активности и неактивности
            // Важно: _activityMonitor считает с момента запуска приложения.
            // Если приложение запущено сегодня, то это корректно.
            // Если приложение работает несколько дней, это будет общее время сессии.
            // Для строгого подсчета "за день" нужна персистентность, но пока берем текущие счетчики сессии.
            await jsonWriter.WritePropertyNameAsync("ActiveTimeSeconds");
            await jsonWriter.WriteValueAsync(_activityMonitor.ActiveElapsed.TotalSeconds);

            await jsonWriter.WritePropertyNameAsync("InactiveTimeSeconds");
            await jsonWriter.WriteValueAsync(_activityMonitor.InactiveElapsed.TotalSeconds);

            // 4. Открытые файлы/папки (заглушка на будущее)
            await jsonWriter.WritePropertyNameAsync("AccessedItems");
            await jsonWriter.WriteStartArrayAsync();
            // TODO: Добавить логику получения открытых файлов, когда появятся события
            await jsonWriter.WriteEndArrayAsync();

            await jsonWriter.WriteEndObjectAsync();

            await jsonWriter.FlushAsync();
            await writer.FlushAsync();
            jsonWriter.Close();
            writer.Close();
            fileStream.Close();

            await _dataTransmissionService.SendReportAsync(reportPath);
            
            _logger.LogInformation("Daily report generated: {ReportPath}", reportPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate daily report");
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
            var reportsDir = ExpandPath(_settings.ReportsPath);
            Directory.CreateDirectory(reportsDir);
            var reportPath = Path.Combine(reportsDir, $"security_report_{DateTime.Now:yyyyMMdd_HHmmss}.json");
            
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
            var logFiles = Directory.GetFiles(ExpandPath(_settings.LogPath), "events_*.log");
            var cutoffDate = DateTime.Now.AddDays(-30); // Архивируем логи старше 30 дней

            foreach (var logFile in logFiles)
            {
                var fileInfo = new FileInfo(logFile);
                if (fileInfo.CreationTime < cutoffDate)
                {
                    var archivePath = Path.Combine(ExpandPath(_settings.LogPath), "Archive");
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

    public async Task GenerateDirectoryListingReportAsync()
    {
        try
        {
            var roots = (_settings.DirectoryRoots != null && _settings.DirectoryRoots.Count > 0)
                ? _settings.DirectoryRoots
                : new List<string> { _settings.ScreenshotPath, _settings.LogPath, _settings.ReportsPath };

            var reportsDir = ExpandPath(_settings.ReportsPath);
            Directory.CreateDirectory(reportsDir);
            var reportPath = Path.Combine(reportsDir, $"dir_listing_{DateTime.Now:yyyyMMdd_HHmmss}.json");

            using var fileStream = new FileStream(reportPath, FileMode.Create, FileAccess.Write, FileShare.None, 4096, true);
            using var writer = new StreamWriter(fileStream, Encoding.UTF8);
            using var jsonWriter = new JsonTextWriter(writer);

            jsonWriter.Formatting = Formatting.Indented;

            await jsonWriter.WriteStartObjectAsync();
            
            await jsonWriter.WritePropertyNameAsync("Timestamp");
            await jsonWriter.WriteValueAsync(DateTime.UtcNow);
            
            await jsonWriter.WritePropertyNameAsync("ClientId");
            await jsonWriter.WriteValueAsync(_settings.ClientId);
            
            await jsonWriter.WritePropertyNameAsync("Type");
            await jsonWriter.WriteValueAsync("DirectoryListing");
            
            await jsonWriter.WritePropertyNameAsync("Roots");
            await jsonWriter.WriteStartArrayAsync();
            foreach (var r in roots) await jsonWriter.WriteValueAsync(r);
            await jsonWriter.WriteEndArrayAsync();

            await jsonWriter.WritePropertyNameAsync("Entries");
            await jsonWriter.WriteStartArrayAsync();

            foreach (var root in roots)
            {
                var basePath = Environment.ExpandEnvironmentVariables(root ?? "");
                if (string.IsNullOrWhiteSpace(basePath) || !Directory.Exists(basePath)) continue;

                await jsonWriter.WriteStartObjectAsync();
                await jsonWriter.WritePropertyNameAsync("root");
                await jsonWriter.WriteValueAsync(basePath);

                await jsonWriter.WritePropertyNameAsync("directories");
                await jsonWriter.WriteStartArrayAsync();
                try
                {
                    foreach (var d in Directory.EnumerateDirectories(basePath))
                    {
                        var di = new DirectoryInfo(d);
                        await jsonWriter.WriteStartObjectAsync();
                        await jsonWriter.WritePropertyNameAsync("name");
                        await jsonWriter.WriteValueAsync(di.Name);
                        await jsonWriter.WritePropertyNameAsync("fullPath");
                        await jsonWriter.WriteValueAsync(di.FullName);
                        await jsonWriter.WritePropertyNameAsync("lastWriteTime");
                        await jsonWriter.WriteValueAsync(di.LastWriteTimeUtc);
                        await jsonWriter.WriteEndObjectAsync();
                    }
                }
                catch { }
                await jsonWriter.WriteEndArrayAsync();

                await jsonWriter.WritePropertyNameAsync("files");
                await jsonWriter.WriteStartArrayAsync();
                try
                {
                    foreach (var f in Directory.EnumerateFiles(basePath))
                    {
                        var fi = new FileInfo(f);
                        await jsonWriter.WriteStartObjectAsync();
                        await jsonWriter.WritePropertyNameAsync("name");
                        await jsonWriter.WriteValueAsync(fi.Name);
                        await jsonWriter.WritePropertyNameAsync("fullPath");
                        await jsonWriter.WriteValueAsync(fi.FullName);
                        await jsonWriter.WritePropertyNameAsync("size");
                        await jsonWriter.WriteValueAsync(fi.Length);
                        await jsonWriter.WritePropertyNameAsync("lastWriteTime");
                        await jsonWriter.WriteValueAsync(fi.LastWriteTimeUtc);
                        await jsonWriter.WriteEndObjectAsync();
                    }
                }
                catch { }
                await jsonWriter.WriteEndArrayAsync();

                await jsonWriter.WriteEndObjectAsync();
            }

            await jsonWriter.WriteEndArrayAsync();
            await jsonWriter.WriteEndObjectAsync();
            
            // Ensure we flush before sending
            await jsonWriter.FlushAsync();
            await writer.FlushAsync();

            // Dispose is called by using, but we need file closed before sending
            jsonWriter.Close();
            writer.Close();
            fileStream.Close();

            await _dataTransmissionService.SendReportAsync(reportPath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to generate directory listing report");
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
            var screenshotCount = Directory.GetFiles(ExpandPath(_settings.ScreenshotPath), "screenshot_*.jpg").Length;
            var logFiles = Directory.GetFiles(ExpandPath(_settings.LogPath), "events_*.log");
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
            var logFiles = Directory.GetFiles(ExpandPath(_settings.LogPath), "events_*.log")
                .OrderByDescending(f => new FileInfo(f).CreationTime)
                .Take(7); // Последние 7 дней

            foreach (var logFile in logFiles)
            {
                if (events.Count >= 100) break;

                using var stream = File.OpenRead(logFile);
                using var reader = new StreamReader(stream);

                // Читаем файл построчно, сохраняя только последние N событий, чтобы минимизировать использование памяти.
                // Так как мы обрабатываем файлы от новых к старым, нам нужны последние записи.
                
                // Используем очередь для хранения только последних необходимых событий
                var neededCount = 100 - events.Count;
                var fileEventsQueue = new Queue<SystemEvent>();

                string? line;
                while ((line = await reader.ReadLineAsync()) != null)
                {
                    if (string.IsNullOrWhiteSpace(line)) continue;
                    try
                    {
                        using var jsonReader = new JsonTextReader(new StringReader(line));
                        var logEntry = JsonSerializer.CreateDefault().Deserialize<dynamic>(jsonReader);
                        
                        if (logEntry != null)
                        {
                            var eventTypeStr = (string)logEntry.EventType;
                            if (Enum.TryParse<SystemEventType>(eventTypeStr, out var eventType))
                            {
                                var systemEvent = new SystemEvent
                                {
                                    Timestamp = (DateTime)logEntry.Timestamp,
                                    EventType = eventType,
                                    Description = (string)logEntry.Description,
                                    ProcessName = (string)logEntry.ProcessName,
                                    DeviceId = (string)logEntry.DeviceId,
                                    NetworkAddress = (string)logEntry.NetworkAddress
                                };
                                
                                fileEventsQueue.Enqueue(systemEvent);
                                if (fileEventsQueue.Count > neededCount)
                                {
                                    fileEventsQueue.Dequeue();
                                }
                            }
                        }
                    }
                    catch { }
                }
                
                // Очередь содержит последние события из этого файла в хронологическом порядке.
                // Нам нужны они в обратном порядке (от новых к старым).
                var fileEventsList = fileEventsQueue.ToList();
                fileEventsList.Reverse();
                events.AddRange(fileEventsList);
                
                if (events.Count >= 100) break;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get recent security events");
        }

        return events;
    }

    private DateTime GetLastScreenshotTime()
    {
        try
        {
            var screenshots = Directory.GetFiles(ExpandPath(_settings.ScreenshotPath), "screenshot_*.jpg");
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

    private Task<int> GetActivePoliciesCountAsync()
    {
        try
        {
            var policiesFile = Path.Combine(_settings.LogPath, "policies.json");
            if (File.Exists(policiesFile))
            {
                using var stream = File.OpenRead(policiesFile);
                using var reader = new StreamReader(stream);
                using var jsonReader = new JsonTextReader(reader);
                var policies = JsonSerializer.CreateDefault().Deserialize<List<SecurityPolicy>>(jsonReader) ?? new List<SecurityPolicy>();
                return Task.FromResult(policies.Count(p => p.IsActive));
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get active policies count");
        }

        return Task.FromResult(0);
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