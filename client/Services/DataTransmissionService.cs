using System.Collections.Concurrent;
using System.Reflection;
using System.Security.Cryptography;
using System.Threading;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using BelfProctor.Models;
using System.Net.NetworkInformation;
using System.Net.Http;
using System.IO;

namespace BelfProctor.Services;

public class DataTransmissionService : IDataTransmissionService, IDisposable
{
    private static readonly string AppVersion =
        Assembly.GetEntryAssembly()?.GetName().Version?.ToString(3)
        ?? Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
        ?? "1.0.0";

    private readonly ILogger<DataTransmissionService> _logger;
    private readonly ProctorSettings _settings;
    private readonly HttpClient _httpClient;
    private readonly string _pendingBase;
    private readonly string _pendingScreenshots;
    private readonly string _pendingReports;
    private readonly string _pendingEvents;
    private readonly string _pendingActivity;
    private readonly string _pendingWorkEvents;
    private readonly string _pendingHeartbeats;
    private readonly string _pendingCmdJson;
    private readonly string _pendingCmdFiles;
    private readonly string _pendingPcSession;
    private readonly string _pendingBrowser;
    private System.Threading.Timer? _retryTimer;
    private System.Threading.Timer? _eventBatchTimer;
    private readonly ConcurrentQueue<SystemEvent> _eventQueue = new();
    private const int MaxBatchSize = 50;
    private readonly SemaphoreSlim _batchLock = new(1, 1);
    private readonly SemaphoreSlim _flushLock = new(1, 1);
    private string _currentBaseUrl = string.Empty;

    public event Action? HeartbeatSucceeded;

    public DataTransmissionService(
        ILogger<DataTransmissionService> logger,
        IOptions<ProctorSettings> settings)
    {
        _logger = logger;
        _settings = settings.Value;
        var handler = new SocketsHttpHandler
        {
            UseProxy = false,
            AllowAutoRedirect = false,
        };
        _httpClient = new HttpClient(handler);
        
        // Настройка HTTP клиента
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "BelfProctor/1.0");
        _httpClient.DefaultRequestHeaders.Add("X-Client-Id", _settings.ClientId);
        _httpClient.Timeout = TimeSpan.FromSeconds(30);

        var serverUrl = NormalizeServerUrl(_settings.ServerUrl);
        if (Uri.TryCreate(serverUrl, UriKind.Absolute, out _))
        {
            _currentBaseUrl = serverUrl;
            _logger.LogInformation("HTTP BaseAddress: {BaseAddress}", _currentBaseUrl);
        }
        else
        {
            _logger.LogWarning("ServerUrl is not configured or invalid: {ServerUrl}", _settings.ServerUrl);
            TryInitializeBaseAddress();
        }

        var logBase = Environment.ExpandEnvironmentVariables(_settings.LogPath);
        _pendingBase = Path.Combine(logBase, "Pending");
        _pendingScreenshots = Path.Combine(_pendingBase, "Screenshots");
        _pendingReports = Path.Combine(_pendingBase, "Reports");
        _pendingEvents = Path.Combine(_pendingBase, "Events");
        _pendingActivity = Path.Combine(_pendingBase, "Activity");
        _pendingWorkEvents = Path.Combine(_pendingBase, "WorkEvents");
        _pendingHeartbeats = Path.Combine(_pendingBase, "Heartbeats");
        _pendingCmdJson = Path.Combine(_pendingBase, "CmdJson");
        _pendingCmdFiles = Path.Combine(_pendingBase, "CmdFiles");
        _pendingPcSession = Path.Combine(_pendingBase, "PcSession");
        _pendingBrowser = Path.Combine(_pendingBase, "Browser");
        Directory.CreateDirectory(_pendingScreenshots);
        Directory.CreateDirectory(_pendingReports);
        Directory.CreateDirectory(_pendingEvents);
        Directory.CreateDirectory(_pendingActivity);
        Directory.CreateDirectory(_pendingWorkEvents);
        Directory.CreateDirectory(_pendingHeartbeats);
        Directory.CreateDirectory(_pendingCmdJson);
        Directory.CreateDirectory(_pendingCmdFiles);
        Directory.CreateDirectory(_pendingPcSession);
        Directory.CreateDirectory(_pendingBrowser);
        _retryTimer = new System.Threading.Timer(_ => { try { FlushPendingAsync().GetAwaiter().GetResult(); } catch { } }, null, TimeSpan.FromSeconds(30), TimeSpan.FromMinutes(1));
        _eventBatchTimer = new System.Threading.Timer(_ => { try { FlushEventBatchAsync().GetAwaiter().GetResult(); } catch { } }, null, TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10));
        try
        {
            NetworkChange.NetworkAvailabilityChanged += OnNetworkAvailabilityChanged;
            NetworkChange.NetworkAddressChanged += OnNetworkAddressChanged;
        }
        catch { }
    }

    private async Task<HttpResponseMessage> GetWithAutoDiscoverAsync(string relativeUrl)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                TryInitializeBaseAddress();
            }
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                _logger.LogWarning("GetWithAutoDiscoverAsync: No server found for {Url}", relativeUrl);
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            var resp = await _httpClient.GetAsync(uri);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogWarning("GetAsync failed: {StatusCode} for {Url}. Retrying discovery...", resp.StatusCode, relativeUrl);
                _currentBaseUrl = string.Empty;
                TryInitializeBaseAddress(extendedScan: true);
                if (string.IsNullOrWhiteSpace(_currentBaseUrl))
                {
                    return resp;
                }
                uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
                resp = await _httpClient.GetAsync(uri);
            }
            return resp;
        }
        catch (TaskCanceledException)
        {
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.RequestTimeout);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            return await _httpClient.GetAsync(uri);
        }
        catch (Exception ex)
        {
             _logger.LogError(ex, "GetWithAutoDiscoverAsync failed for {Url}", relativeUrl);
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            return await _httpClient.GetAsync(uri);
        }
    }
    private void TryInitializeBaseAddress(bool extendedScan = false)
    {
        _logger.LogInformation("Starting server discovery...");
        var configured = NormalizeServerUrl(_settings.ServerUrl);
        
        // 1. Try Configured URL
        if (!string.IsNullOrWhiteSpace(configured) && Uri.TryCreate(configured, UriKind.Absolute, out _))
        {
            try
            {
                _logger.LogInformation("Trying configured URL: {Url}", configured);
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                var probeUri = new Uri(new Uri(configured), "heartbeat/latest");
                var resp = _httpClient.GetAsync(probeUri, cts.Token).GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode)
                {
                    _currentBaseUrl = configured;
                    _logger.LogInformation("Discovered server (Configured): {BaseAddress}", _currentBaseUrl);
                    return;
                }
                else
                {
                    _logger.LogWarning("Configured URL responded with {Status}", resp.StatusCode);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Configured URL failed: {Message}", ex.Message);
            }
        }

        // 2. Scan Candidates
        var candidates = GetServerCandidates(extendedScan);
        _logger.LogInformation("Scanning {Count} candidates...", candidates.Count());
        
        foreach (var candidate in candidates)
        {
            if (candidate == configured) continue; // Skip if already tried

            try
            {
                // _logger.LogDebug("Probing: {Url}", candidate); // Too noisy?
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(1)); // Fast timeout
                var probeUri = new Uri(new Uri(candidate), "heartbeat/latest");
                var resp = _httpClient.GetAsync(probeUri, cts.Token).GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode)
                {
                    _currentBaseUrl = candidate;
                    _logger.LogInformation("Discovered server (Auto): {BaseAddress}", _currentBaseUrl);
                    return;
                }
            }
            catch { }
        }
        
        _logger.LogWarning("Server discovery failed. No reachable server found.");
    }

    private IEnumerable<string> GetServerCandidates(bool extendedScan)
    {
        var list = new List<string>();
        var configured = NormalizeServerUrl(_settings.ServerUrl);
        // Do NOT add configured here, we handle it separately in TryInitializeBaseAddress
        
        // Priority 1: Localhost (fastest for local dev)
        list.Add(NormalizeServerUrl($"http://localhost:8080/api"));
        list.Add(NormalizeServerUrl($"http://127.0.0.1:8080/api"));
        
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                // Must be Up and not Loopback (since we added localhost manually)
                if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                
                var props = nic.GetIPProperties();
                
                // Priority 2: Gateway IPs (Router usually hosts server)
                foreach (var gw in props.GatewayAddresses)
                {
                    var ip = gw?.Address;
                    if (ip != null && ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        // Check if not 0.0.0.0
                        if (!ip.Equals(System.Net.IPAddress.Any))
                            list.Add(NormalizeServerUrl($"http://{ip}:8080/api"));
                    }
                }
                
                // Priority 3: Scan Subnet (x.x.x.1 and x.x.x.254)
                foreach (var uni in props.UnicastAddresses)
                {
                    var ip = uni?.Address;
                    var mask = uni?.IPv4Mask;
                    // Skip APIPA (169.254.x.x) unless extended scan? No, APIPA is useless usually.
                    // Actually APIPA is valid if server is also on APIPA.
                    
                    if (ip != null && mask != null && ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        var octets = ip.ToString().Split('.');
                        if (octets.Length == 4)
                        {
                            var prefix = $"{octets[0]}.{octets[1]}.{octets[2]}";
                            // Add Gateway assumption if not already added
                            list.Add(NormalizeServerUrl($"http://{prefix}.1:8080/api"));
                            list.Add(NormalizeServerUrl($"http://{prefix}.254:8080/api"));
                            
                            // If Extended Scan, scan entire subnet
                            if (extendedScan)
                            {
                                // Scan reasonable range or full 254?
                                // Full 254 is slow (254 * 1s timeout = 4 mins).
                                // Let's limit or rely on parallel scan?
                                // For now, keep as is but user beware.
                                // Actually, removing the "169.254" specific check to treat it like any other if extended.
                            }
                            
                            // Special case for APIPA if it's the ONLY thing we have
                            if (octets[0] == "169" && octets[1] == "254")
                            {
                                // Maybe server is also on AutoIP.
                                // But scanning 65k hosts is impossible.
                                // Just scan .1 to .10 maybe?
                            }
                        }
                    }
                }
            }
        }
        catch { }
        return list.Distinct();
    }

    private async Task<HttpResponseMessage> PostWithAutoDiscoverAsync(string relativeUrl, HttpContent content)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                TryInitializeBaseAddress();
            }
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                _logger.LogWarning("PostWithAutoDiscoverAsync: No server found for {Url}", relativeUrl);
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            var resp = await _httpClient.PostAsync(uri, content);
            if (!resp.IsSuccessStatusCode)
            {
                 var body = await resp.Content.ReadAsStringAsync();
                _logger.LogWarning("PostAsync failed: {StatusCode} for {Url}. Body: {Body}", resp.StatusCode, relativeUrl, body);
                _currentBaseUrl = string.Empty;
                TryInitializeBaseAddress(extendedScan: true);
                if (string.IsNullOrWhiteSpace(_currentBaseUrl))
                {
                    return resp;
                }
                uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
                resp = await _httpClient.PostAsync(uri, content);
            }
            return resp;
        }
        catch (TaskCanceledException)
        {
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.RequestTimeout);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            return await _httpClient.PostAsync(uri, content);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "PostWithAutoDiscoverAsync failed for {Url}", relativeUrl);
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            return await _httpClient.PostAsync(uri, content);
        }
    }

    public async Task SendScreenshotAsync(string filePath, WorkScreenshotMetadata? metadata = null)
    {
        if (!File.Exists(filePath))
        {
            _logger.LogWarning("Screenshot file not found: {FilePath}", filePath);
            return;
        }

        // Stamp UTC capture time before any network work so both the try and catch
        // paths use the same filename — the catch cannot access variables declared
        // inside the try block, and a 30-second HttpClient timeout would otherwise
        // shift the pending filename (and server timestamp) by up to 30 seconds.
        var now = DateTime.UtcNow;
        var sendName = $"{_settings.ClientId}_{now:yyyy-MM-ddTHH-mm-ss.fff}Z.jpg";
        var destPending = Path.Combine(_pendingScreenshots, sendName);

        try
        {
            bool sent = false;

            using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var streamContent = GetEncryptedStreamContent(fileStream))
            using (var content = new MultipartFormDataContent())
            {
                content.Add(streamContent, "screenshot", sendName);
                content.Add(new StringContent(_settings.ClientId), "clientId");
                // Explicit Z — server must treat this as UTC, no guessing.
                content.Add(new StringContent(now.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture)), "timestamp");
                AddScreenshotMetadata(content, metadata);

                var response = await PostWithAutoDiscoverAsync("screenshots", content);

                if (response.IsSuccessStatusCode)
                {
                    sent = true;
                    _logger.LogDebug("Screenshot sent successfully: {FilePath}", filePath);
                }
                else
                {
                    _logger.LogWarning("Failed to send screenshot. Status: {StatusCode}", response.StatusCode);
                }
            }

            if (sent)
            {
                try { if (File.Exists(filePath)) File.Delete(filePath); } catch { }
            }
            else
            {
                try { Directory.CreateDirectory(_pendingScreenshots); } catch { }
                try { if (File.Exists(filePath)) File.Move(filePath, destPending, true); } catch { }
                TryWriteScreenshotSidecar(destPending, metadata);
                _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending screenshot: {FilePath}", filePath);
            try
            {
                if (File.Exists(filePath)) File.Move(filePath, destPending, true);
                TryWriteScreenshotSidecar(destPending, metadata);
            } catch { }
            _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
        }
    }

    private static void AddScreenshotMetadata(MultipartFormDataContent content, WorkScreenshotMetadata? metadata)
    {
        if (metadata == null) return;
        if (!string.IsNullOrWhiteSpace(metadata.CaptureReason)) content.Add(new StringContent(metadata.CaptureReason), "captureReason");
        if (!string.IsNullOrWhiteSpace(metadata.LinkedSessionId)) content.Add(new StringContent(metadata.LinkedSessionId), "linkedSessionId");
        if (!string.IsNullOrWhiteSpace(metadata.ProcessName)) content.Add(new StringContent(metadata.ProcessName), "processName");
        if (!string.IsNullOrWhiteSpace(metadata.FilePath)) content.Add(new StringContent(metadata.FilePath), "filePath");
        if (!string.IsNullOrWhiteSpace(metadata.ProjectName)) content.Add(new StringContent(metadata.ProjectName), "projectName");
    }

    private static void TryWriteScreenshotSidecar(string imagePath, WorkScreenshotMetadata? metadata)
    {
        if (metadata == null || string.IsNullOrWhiteSpace(imagePath)) return;
        try
        {
            File.WriteAllText(imagePath + ".json", JsonConvert.SerializeObject(metadata));
        }
        catch { }
    }

    private static WorkScreenshotMetadata? TryReadScreenshotSidecar(string imagePath)
    {
        try
        {
            var sidecar = imagePath + ".json";
            if (!File.Exists(sidecar)) return null;
            return JsonConvert.DeserializeObject<WorkScreenshotMetadata>(File.ReadAllText(sidecar));
        }
        catch
        {
            return null;
        }
    }

    public Task SendSystemEventAsync(SystemEvent systemEvent)
    {
        _eventQueue.Enqueue(systemEvent);
        return Task.CompletedTask;
    }

    public async Task SendWorkEventsAsync(IEnumerable<WorkEventEnvelope> events)
    {
        var batch = events?.Where(e => e != null).ToList() ?? new List<WorkEventEnvelope>();
        if (batch.Count == 0) return;

        var json = JsonConvert.SerializeObject(batch, new JsonSerializerSettings
        {
            DateTimeZoneHandling = DateTimeZoneHandling.Utc,
            NullValueHandling = NullValueHandling.Ignore
        });

        try
        {
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await PostWithAutoDiscoverAsync("work/events", content);
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Work event batch sent successfully: {Count}", batch.Count);
                return;
            }

            _logger.LogWarning("Failed to send work events. Status: {StatusCode}", response.StatusCode);
            await SavePendingWorkEventsAsync(json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending work events");
            await SavePendingWorkEventsAsync(json);
        }
    }

    private async Task SavePendingWorkEventsAsync(string json)
    {
        try
        {
            Directory.CreateDirectory(_pendingWorkEvents);
            var name = Path.Combine(_pendingWorkEvents, $"work_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}_{Guid.NewGuid():N}.json");
            await File.WriteAllTextAsync(name, json);
            TrimPendingDirectory(_pendingWorkEvents, "*.json", 1000);
        }
        catch { }
    }

    private async Task FlushEventBatchAsync()
    {
        if (await _batchLock.WaitAsync(0))
        {
            try
            {
                while (!_eventQueue.IsEmpty)
                {
                    var batch = new List<SystemEvent>();
                    while (batch.Count < MaxBatchSize && _eventQueue.TryDequeue(out var evt))
                    {
                        batch.Add(evt);
                    }

                    if (batch.Count == 0) break;

                    try
                    {
                        var json = JsonConvert.SerializeObject(batch, new JsonSerializerSettings { DateTimeZoneHandling = DateTimeZoneHandling.Utc });
                        var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
                        
                        using var content = new ByteArrayContent(encryptedData);
                        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

                        var response = await PostWithAutoDiscoverAsync("events", content);
                        
                        if (response.IsSuccessStatusCode)
                        {
                            _logger.LogDebug("System event batch sent successfully: {Count} events", batch.Count);
                        }
                        else
                        {
                            _logger.LogWarning("Failed to send system event batch. Status: {StatusCode}", response.StatusCode);
                            var name = Path.Combine(_pendingEvents, $"batch_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.json");
                            try { await File.WriteAllTextAsync(name, json); } catch { }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error sending system event batch");
                        try { var name = Path.Combine(_pendingEvents, $"batch_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(batch, new JsonSerializerSettings { DateTimeZoneHandling = DateTimeZoneHandling.Utc })); } catch { }
                    }
                }
            }
            finally
            {
                _batchLock.Release();
            }
        }
    }

    public async Task SendActivityAsync(bool isActive, long activeMilliseconds, long inactiveMilliseconds)
    {
        var payload = new
        {
            ClientId = _settings.ClientId,
            Timestamp = DateTime.UtcNow,
            IsActive = isActive,
            ActiveMilliseconds = activeMilliseconds,
            InactiveMilliseconds = inactiveMilliseconds
        };
        var json = JsonConvert.SerializeObject(payload, new JsonSerializerSettings { DateTimeZoneHandling = DateTimeZoneHandling.Utc });

        try
        {
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            var response = await PostWithAutoDiscoverAsync("activity", content);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to send activity. Status: {StatusCode}", response.StatusCode);
                try { var name = Path.Combine(_pendingActivity, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, json); } catch { }
            }
            else
            {
                _logger.LogDebug("Activity sent: {IsActive} {Ms}", isActive, activeMilliseconds);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending activity");
            try { var name = Path.Combine(_pendingActivity, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, json); } catch { }
        }
    }

    public async Task SendPcSessionEventAsync(string kind, DateTime utcTimestamp, string bootId)
    {
        var payload = new
        {
            ClientId = _settings.ClientId,
            Kind = kind,
            BootId = bootId,
            TimestampUtc = DateTime.SpecifyKind(utcTimestamp, DateTimeKind.Utc),
        };
        var json = JsonConvert.SerializeObject(payload, new JsonSerializerSettings { DateTimeZoneHandling = DateTimeZoneHandling.Utc });

        try
        {
            var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
            using var content = new ByteArrayContent(encrypted);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await PostWithAutoDiscoverAsync("pc-session", content);
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("PcSession event sent: {Kind} {BootId}", kind, bootId);
                return;
            }
            _logger.LogWarning("Failed to send pc-session. Status: {StatusCode}", response.StatusCode);
            await SavePendingPcSessionAsync(json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending pc-session");
            await SavePendingPcSessionAsync(json);
        }
    }

    private async Task SavePendingPcSessionAsync(string json)
    {
        try
        {
            Directory.CreateDirectory(_pendingPcSession);
            var name = Path.Combine(_pendingPcSession, $"pc_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}_{Guid.NewGuid():N}.json");
            await File.WriteAllTextAsync(name, json);
            TrimPendingDirectory(_pendingPcSession, "*.json", 200);
        }
        catch { }
    }

    public async Task SendBrowserActivityAsync(IReadOnlyList<BrowserVisit> visits)
    {
        if (visits == null || visits.Count == 0) return;
        var json = JsonConvert.SerializeObject(visits, new JsonSerializerSettings
        {
            DateTimeZoneHandling = DateTimeZoneHandling.Utc,
            NullValueHandling = NullValueHandling.Ignore,
        });

        try
        {
            var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
            using var content = new ByteArrayContent(encrypted);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            var response = await PostWithAutoDiscoverAsync("browser-activity", content);
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Browser activity batch sent: {Count}", visits.Count);
                return;
            }
            _logger.LogWarning("Failed to send browser activity. Status: {StatusCode}", response.StatusCode);
            await SavePendingBrowserAsync(json);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending browser activity");
            await SavePendingBrowserAsync(json);
        }
    }

    private async Task SavePendingBrowserAsync(string json)
    {
        try
        {
            Directory.CreateDirectory(_pendingBrowser);
            var name = Path.Combine(_pendingBrowser, $"br_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}_{Guid.NewGuid():N}.json");
            await File.WriteAllTextAsync(name, json);
            TrimPendingDirectory(_pendingBrowser, "*.json", 500);
        }
        catch { }
    }

    public async Task<bool> SendHeartbeatAsync()
    {
        var heartbeat = new
        {
            ClientId = _settings.ClientId,
            Timestamp = DateTime.UtcNow,
            Status = "Online",
            Version = AppVersion,
            Machine = Environment.MachineName,
            OS = Environment.OSVersion.ToString(),
            UptimeSeconds = (int)(DateTime.UtcNow - System.Diagnostics.Process.GetCurrentProcess().StartTime.ToUniversalTime()).TotalSeconds,
            CommandChannel = new
            {
                Connected = ConnectivityState.WsConnected,
                LastChangeUtc = ConnectivityState.WsLastChangeUtc,
                LastError = ConnectivityState.WsLastError,
            },
            Memory = new
            {
                WorkingSet = System.Diagnostics.Process.GetCurrentProcess().WorkingSet64,
                PrivateMemorySize = System.Diagnostics.Process.GetCurrentProcess().PrivateMemorySize64,
            }
        };
        var json = JsonConvert.SerializeObject(heartbeat);

        try
        {
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await PostWithAutoDiscoverAsync("heartbeat", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Heartbeat sent successfully");
                try { HeartbeatSucceeded?.Invoke(); } catch { }
                try
                {
                    var body = await response.Content.ReadAsStringAsync();
                    if (!string.IsNullOrWhiteSpace(body))
                    {
                        var obj = JObject.Parse(body);
                        var uninstall = obj["uninstall"] as JObject;
                        if (uninstall != null)
                        {
                            var payload = uninstall["payload"] as JObject;
                            var serviceName = payload?["serviceName"]?.ToString() ?? "BelfProctor";
                            UninstallHelper.StartUninstall(_settings, _logger, serviceName);
                        }
                    }
                }
                catch { }
                _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
                return true;
            }
            else
            {
                _logger.LogWarning("Failed to send heartbeat. Status: {StatusCode}", response.StatusCode);
                try { var name = Path.Combine(_pendingHeartbeats, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, json); } catch { }
                return false;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending heartbeat");
            try { var name = Path.Combine(_pendingHeartbeats, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, json); } catch { }
            return false;
        }
    }

    public async Task<byte[]> DownloadPolicyAsync(string policyId)
    {
        try
        {
            var response = await GetWithAutoDiscoverAsync($"policies/{policyId}");
            
            if (response.IsSuccessStatusCode)
            {
                var encryptedData = await response.Content.ReadAsByteArrayAsync();
                var decryptedData = DecryptData(encryptedData);
                
                _logger.LogDebug("Policy downloaded successfully: {PolicyId}", policyId);
                return decryptedData;
            }
            else
            {
                _logger.LogWarning("Failed to download policy. Status: {StatusCode}", response.StatusCode);
                return Array.Empty<byte>();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error downloading policy: {PolicyId}", policyId);
            return Array.Empty<byte>();
        }
    }

    public async Task SendReportAsync(string reportPath)
    {
        try
        {
            if (!File.Exists(reportPath))
            {
                _logger.LogWarning("Report file not found: {ReportPath}", reportPath);
                return;
            }

            using (var fileStream = new FileStream(reportPath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var streamContent = GetEncryptedStreamContent(fileStream))
            using (var content = new MultipartFormDataContent())
            {
                content.Add(streamContent, "report", Path.GetFileName(reportPath));
                content.Add(new StringContent(_settings.ClientId), "clientId");
                content.Add(new StringContent(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture)), "timestamp");

                var response = await PostWithAutoDiscoverAsync("reports", content);
                
                if (response.IsSuccessStatusCode)
                {
                    _logger.LogDebug("Report sent successfully: {ReportPath}", reportPath);
                    try { if (File.Exists(reportPath)) File.Delete(reportPath); } catch { }
                }
                else
                {
                    _logger.LogWarning("Failed to send report. Status: {StatusCode}", response.StatusCode);
                    var dest = Path.Combine(_pendingReports, Path.GetFileName(reportPath));
                    try { File.Move(reportPath, dest, true); } catch { }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending report: {ReportPath}", reportPath);
            var dest = Path.Combine(_pendingReports, Path.GetFileName(reportPath));
            try { if (File.Exists(reportPath)) File.Move(reportPath, dest, true); } catch { }
        }
    }

    internal byte[] EncryptData(byte[] data)
    {
        if (string.IsNullOrEmpty(_settings.EncryptionKey))
        {
            _logger.LogWarning("Encryption key not configured. Data will be sent unencrypted.");
            return data;
        }

        try
        {
            using var aes = Aes.Create();
            aes.Key = DeriveKeyFromPassword(_settings.EncryptionKey);
            aes.GenerateIV();

            using var encryptor = aes.CreateEncryptor();
            using var msEncrypt = new MemoryStream();
            
            // Записываем IV в начало потока
            msEncrypt.Write(aes.IV, 0, aes.IV.Length);
            
            using (var csEncrypt = new CryptoStream(msEncrypt, encryptor, CryptoStreamMode.Write))
            {
                csEncrypt.Write(data, 0, data.Length);
            }

            return msEncrypt.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to encrypt data");
            return data;
        }
    }

    public async Task SendCommandResultJsonAsync(string commandId, byte[] jsonBytes)
    {
        try
        {
            var encryptedData = EncryptData(jsonBytes);
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await PostWithAutoDiscoverAsync($"commands/{commandId}/json", content);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to send command result json. Status: {StatusCode}", response.StatusCode);
                var name = Path.Combine(_pendingCmdJson, $"cmd_{commandId}_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.json");
                try { await File.WriteAllBytesAsync(name, jsonBytes); } catch { }
            }
            else
            {
                _logger.LogDebug("Command result json sent successfully: {CommandId}", commandId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending command result json");
            try { var name = Path.Combine(_pendingCmdJson, $"cmd_{commandId}_{DateTime.UtcNow:yyyyMMdd_HHmmss_fff}.json"); await File.WriteAllBytesAsync(name, jsonBytes); } catch { }
        }
    }

    public async Task SendCommandResultFileAsync(string commandId, string filePath)
    {
        HttpResponseMessage? response = null;
        try
        {
            if (!File.Exists(filePath))
            {
                _logger.LogWarning("Command result file not found: {FilePath}", filePath);
                return;
            }

            using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var streamContent = GetEncryptedStreamContent(fileStream))
            using (var content = new MultipartFormDataContent())
            {
                content.Add(streamContent, "file", Path.GetFileName(filePath));
                content.Add(new StringContent(_settings.ClientId), "clientId");
                content.Add(new StringContent(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture)), "timestamp");

                response = await PostWithAutoDiscoverAsync($"commands/{commandId}/result", content);
            }

            if (response == null || !response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to send command result file. Status: {StatusCode}", response?.StatusCode);
                var destName = Path.Combine(_pendingCmdFiles, $"cmd_{commandId}_{Path.GetFileName(filePath)}");
                try { File.Copy(filePath, destName, true); } catch { }
            }
            else
            {
                _logger.LogDebug("Command result file sent successfully: {CommandId}", commandId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending command result file");
            try { var destName = Path.Combine(_pendingCmdFiles, $"cmd_{commandId}_{Path.GetFileName(filePath)}"); if (File.Exists(filePath)) File.Copy(filePath, destName, true); } catch { }
        }
    }

    public async Task SendClientLogChunkAsync(string fileName, string text)
    {
        try
        {
            var payload = new
            {
                timestamp = DateTime.UtcNow.ToString("o", System.Globalization.CultureInfo.InvariantCulture),
                source = "client",
                fileName = fileName ?? "client.log",
                level = "INFO",
                text = text ?? string.Empty
            };
            var json = Newtonsoft.Json.JsonConvert.SerializeObject(payload);
            var jsonBytes = Encoding.UTF8.GetBytes(json);

            var encryptedData = EncryptData(jsonBytes);
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await PostWithAutoDiscoverAsync("logs", content);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to send client logs. Status: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending client logs");
        }
    }

    private StreamContent GetEncryptedStreamContent(Stream inputStream)
    {
        if (string.IsNullOrEmpty(_settings.EncryptionKey))
        {
            return new StreamContent(inputStream);
        }

        try 
        {
            using var aes = Aes.Create();
            aes.Key = DeriveKeyFromPassword(_settings.EncryptionKey);
            aes.GenerateIV();
            
            var ivStream = new MemoryStream(aes.IV);
            var encryptor = aes.CreateEncryptor();
            var cryptoStream = new CryptoStream(inputStream, encryptor, CryptoStreamMode.Read);
            
            var combined = new CombinedStream(ivStream, cryptoStream);
            return new StreamContent(combined);
        }
        catch
        {
            return new StreamContent(inputStream);
        }
    }

    private class CombinedStream : Stream
    {
        private readonly Stream _first;
        private readonly Stream _second;

        public CombinedStream(Stream first, Stream second)
        {
            _first = first;
            _second = second;
        }

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set => throw new NotSupportedException(); }

        public override void Flush() { }

        public override int Read(byte[] buffer, int offset, int count)
        {
            int totalRead = 0;
            int read = _first.Read(buffer, offset, count);
            totalRead += read;
            
            if (read < count)
            {
                int read2 = _second.Read(buffer, offset + read, count - read);
                totalRead += read2;
            }
            return totalRead;
        }

        public override void SetLength(long value) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        
        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _first.Dispose();
                _second.Dispose();
            }
            base.Dispose(disposing);
        }
    }

    internal byte[] DecryptData(byte[] encryptedData)
    {
        if (string.IsNullOrEmpty(_settings.EncryptionKey))
        {
            return encryptedData;
        }

        try
        {
            using var aes = Aes.Create();
            aes.Key = DeriveKeyFromPassword(_settings.EncryptionKey);
            
            // Извлекаем IV из начала данных
            var iv = new byte[aes.BlockSize / 8];
            Array.Copy(encryptedData, 0, iv, 0, iv.Length);
            aes.IV = iv;

            using var decryptor = aes.CreateDecryptor();
            using var msDecrypt = new MemoryStream(encryptedData, iv.Length, encryptedData.Length - iv.Length);
            using var csDecrypt = new CryptoStream(msDecrypt, decryptor, CryptoStreamMode.Read);
            using var msResult = new MemoryStream();
            
            csDecrypt.CopyTo(msResult);
            return msResult.ToArray();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to decrypt data");
            return encryptedData;
        }
    }

    internal byte[] DeriveKeyFromPassword(string password)
    {
        var salt = Encoding.UTF8.GetBytes("BelfProctorSalt");
        return Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, 10000, HashAlgorithmName.SHA256, 32);
    }

    private static string NormalizeServerUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        raw = raw.Trim();
        if (!raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
            !raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
        {
            raw = "http://" + raw;
        }

        if (!raw.EndsWith("/")) raw += "/";

        if (Uri.TryCreate(raw, UriKind.Absolute, out var uri))
        {
            var builder = new UriBuilder(uri);
            var p = (builder.Path ?? "/").Trim();
            if (string.IsNullOrWhiteSpace(p) || p == "/")
            {
                builder.Path = "/api/";
                return builder.Uri.ToString();
            }

            var trimmed = p.TrimEnd('/');
            if (trimmed.Equals("/api", StringComparison.OrdinalIgnoreCase))
            {
                builder.Path = "/api/";
                return builder.Uri.ToString();
            }

            return builder.Uri.ToString().TrimEnd('/') + "/";
        }

        return raw;
    }

    public void Dispose()
    {
        try { NetworkChange.NetworkAvailabilityChanged -= OnNetworkAvailabilityChanged; } catch { }
        try { NetworkChange.NetworkAddressChanged -= OnNetworkAddressChanged; } catch { }
        _retryTimer?.Dispose();
        _retryTimer = null;
        _eventBatchTimer?.Dispose();
        _eventBatchTimer = null;
        _httpClient?.Dispose();
    }

    private async Task FlushPendingAsync()
    {
        if (!await _flushLock.WaitAsync(0)) return;

        try
        {
            _logger.LogDebug("Starting FlushPendingAsync");

            // Send pending screenshots with a throttle: max 30 per flush cycle so a
            // large offline backlog doesn't flood the server on reconnect. Remaining
            // files stay in the queue and are sent on the next retry tick.
            const int MaxScreenshotsPerFlush = 30;
            var screenshotFiles = Directory.GetFiles(_pendingScreenshots)
                .Where(f => f.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase))
                .OrderBy(f => f)
                .Take(MaxScreenshotsPerFlush);

            foreach (var file in screenshotFiles)
            {
                try
                {
                    using (var fileStream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (var streamContent = GetEncryptedStreamContent(fileStream))
                    using (var content = new MultipartFormDataContent())
                    {
                        var sendName = Path.GetFileName(file);
                        // Filename was stamped with DateTime.UtcNow at capture time, so parsing it
                        // gives us back the original UTC. GetCreationTimeUtc is the safe fallback —
                        // GetCreationTime returns Local, which would later be misread as UTC.
                        var timestamp = TryExtractTimestampFromFileName(sendName) ?? File.GetCreationTimeUtc(file);
                        var utcTimestamp = timestamp.Kind == DateTimeKind.Utc
                            ? timestamp
                            : timestamp.ToUniversalTime();
                        var uploadName = $"{_settings.ClientId}_{utcTimestamp:yyyy-MM-ddTHH-mm-ss.fff}Z.jpg";

                        content.Add(streamContent, "screenshot", uploadName);
                        content.Add(new StringContent(_settings.ClientId), "clientId");
                        // Explicit 'Z' suffix so the server doesn't have to guess.
                        content.Add(new StringContent(utcTimestamp.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture)), "timestamp");
                        var metadata = TryReadScreenshotSidecar(file);
                        AddScreenshotMetadata(content, metadata);

                        var resp = await PostWithAutoDiscoverAsync("screenshots", content);

                        if (resp.IsSuccessStatusCode)
                        {
                            _logger.LogDebug("Pending screenshot sent successfully: {FileName}", sendName);
                            File.Delete(file);
                            try { File.Delete(file + ".json"); } catch { }
                            // Throttle to avoid a burst hitting the server back-to-back.
                            await Task.Delay(200);
                        }
                        else
                        {
                             _logger.LogWarning("Failed to send pending screenshot {FileName}. Status: {Status}", sendName, resp.StatusCode);
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error sending pending screenshot: {FileName}", Path.GetFileName(file));
                }
            }

            foreach (var file in Directory.GetFiles(_pendingReports))
            {
                try
                {
                    using (var fileStream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (var streamContent = GetEncryptedStreamContent(fileStream))
                    using (var content = new MultipartFormDataContent())
                    {
                        content.Add(streamContent, "report", Path.GetFileName(file));
                        content.Add(new StringContent(_settings.ClientId), "clientId");
                        content.Add(new StringContent(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture)), "timestamp");
                        var resp = await PostWithAutoDiscoverAsync("reports", content);
                        
                        if (resp.IsSuccessStatusCode) 
                        {
                            File.Delete(file);
                        }
                    }
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingEvents, "*.json"))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
                    using var content = new ByteArrayContent(encrypted);
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    var resp = await PostWithAutoDiscoverAsync("events", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingActivity, "*.json"))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
                    using var content = new ByteArrayContent(encrypted);
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    var resp = await PostWithAutoDiscoverAsync("activity", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingWorkEvents, "*.json"))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
                    using var content = new ByteArrayContent(encrypted);
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    var resp = await PostWithAutoDiscoverAsync("work/events", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingHeartbeats, "*.json"))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
                    using var content = new ByteArrayContent(encrypted);
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    var resp = await PostWithAutoDiscoverAsync("heartbeat", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingPcSession, "*.json"))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
                    using var content = new ByteArrayContent(encrypted);
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    var resp = await PostWithAutoDiscoverAsync("pc-session", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingBrowser, "*.json"))
            {
                try
                {
                    var json = await File.ReadAllTextAsync(file);
                    var encrypted = EncryptData(Encoding.UTF8.GetBytes(json));
                    using var content = new ByteArrayContent(encrypted);
                    content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                    var resp = await PostWithAutoDiscoverAsync("browser-activity", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingCmdJson, "cmd_*.json"))
            {
                try
                {
                    var name = Path.GetFileName(file);
                    var parts = name.Split('_');
                    if (parts.Length >= 3)
                    {
                        var cmdId = parts[1];
                        using (var fileStream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                        using (var streamContent = GetEncryptedStreamContent(fileStream))
                        {
                            streamContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                            var resp = await PostWithAutoDiscoverAsync($"commands/{cmdId}/json", streamContent);
                            if (resp.IsSuccessStatusCode) 
                            {
                                File.Delete(file);
                            }
                        }
                    }
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingCmdFiles, "cmd_*"))
            {
                try
                {
                    var name = Path.GetFileName(file);
                    var parts = name.Split('_');
                    if (parts.Length >= 3)
                    {
                        var cmdId = parts[1];
                        using (var fileStream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                        using (var streamContent = GetEncryptedStreamContent(fileStream))
                        using (var content = new MultipartFormDataContent())
                        {
                            content.Add(streamContent, "file", Path.GetFileName(file));
                            content.Add(new StringContent(_settings.ClientId), "clientId");
                            content.Add(new StringContent(DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture)), "timestamp");
                            var resp = await PostWithAutoDiscoverAsync($"commands/{cmdId}/result", content);
                            if (resp.IsSuccessStatusCode) 
                            {
                                File.Delete(file);
                            }
                        }
                    }
                }
                catch { }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in FlushPendingAsync");
        }
        finally
        {
            _flushLock.Release();
        }
    }

    private void OnNetworkAvailabilityChanged(object? sender, NetworkAvailabilityEventArgs e)
    {
        if (e.IsAvailable)
        {
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
        }
    }

    private void OnNetworkAddressChanged(object? sender, EventArgs e)
    {
        _currentBaseUrl = string.Empty;
        TryInitializeBaseAddress(extendedScan: true);
        _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
    }

    private static void TrimPendingDirectory(string directory, string pattern, int maxFiles)
    {
        try
        {
            var files = Directory.GetFiles(directory, pattern)
                .Select(p => new FileInfo(p))
                .OrderByDescending(f => f.CreationTimeUtc)
                .ToList();
            foreach (var file in files.Skip(maxFiles))
            {
                try { file.Delete(); } catch { }
            }
        }
        catch { }
    }

    private static DateTime? TryExtractTimestampFromFileName(string fileName)
    {
        // Filename is "CLIENTID_yyyy-MM-ddTHH-mm-ss.fff[.bla].jpg".
        // Pull the last underscore-separated token, strip extension, parse.
        // Critically: SendScreenshotAsync now writes DateTime.UtcNow, so the
        // string IS already UTC — return it tagged DateTimeKind.Utc to avoid
        // an accidental local-time re-interpretation at the next flush.
        try
        {
            var name = Path.GetFileNameWithoutExtension(fileName) ?? string.Empty;
            var lastUnderscore = name.LastIndexOf('_');
            if (lastUnderscore < 0 || lastUnderscore >= name.Length - 1) return null;
            var ts = name.Substring(lastUnderscore + 1);
            // Strip trailing Z (new format stamps the filename with explicit UTC marker).
            if (ts.EndsWith("Z", StringComparison.OrdinalIgnoreCase)) ts = ts.Substring(0, ts.Length - 1);

            DateTime parsed;
            if (DateTime.TryParseExact(ts, "yyyy-MM-ddTHH-mm-ss.fff", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out parsed) ||
                DateTime.TryParseExact(ts, "yyyyMMdd_HHmmss", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal, out parsed))
            {
                return DateTime.SpecifyKind(parsed, DateTimeKind.Utc);
            }
        }
        catch { }
        return null;
    }
}
