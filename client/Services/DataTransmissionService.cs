using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Threading;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;
using System.Net.NetworkInformation;

namespace BelfProctor.Services;

public class DataTransmissionService : IDataTransmissionService
{
    private readonly ILogger<DataTransmissionService> _logger;
    private readonly ProctorSettings _settings;
    private readonly HttpClient _httpClient;
    private readonly string _pendingBase;
    private readonly string _pendingScreenshots;
    private readonly string _pendingReports;
    private readonly string _pendingEvents;
    private readonly string _pendingActivity;
    private readonly string _pendingHeartbeats;
    private readonly string _pendingCmdJson;
    private readonly string _pendingCmdFiles;
    private System.Threading.Timer? _retryTimer;
    private System.Threading.Timer? _eventBatchTimer;
    private readonly ConcurrentQueue<SystemEvent> _eventQueue = new();
    private const int MaxBatchSize = 50;
    private readonly SemaphoreSlim _batchLock = new(1, 1);
    private readonly SemaphoreSlim _flushLock = new(1, 1);
    private string _currentBaseUrl = string.Empty;

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
        _httpClient.Timeout = TimeSpan.FromMinutes(5);

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
        _pendingHeartbeats = Path.Combine(_pendingBase, "Heartbeats");
        _pendingCmdJson = Path.Combine(_pendingBase, "CmdJson");
        _pendingCmdFiles = Path.Combine(_pendingBase, "CmdFiles");
        Directory.CreateDirectory(_pendingScreenshots);
        Directory.CreateDirectory(_pendingReports);
        Directory.CreateDirectory(_pendingEvents);
        Directory.CreateDirectory(_pendingActivity);
        Directory.CreateDirectory(_pendingHeartbeats);
        Directory.CreateDirectory(_pendingCmdJson);
        Directory.CreateDirectory(_pendingCmdFiles);
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
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            var resp = await _httpClient.GetAsync(uri);
            if (!resp.IsSuccessStatusCode)
            {
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
        catch (HttpRequestException)
        {
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            return await _httpClient.GetAsync(uri);
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
    }
    private void TryInitializeBaseAddress(bool extendedScan = false)
    {
        foreach (var candidate in GetServerCandidates(extendedScan))
        {
            try
            {
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                var probeUri = new Uri(new Uri(candidate), "heartbeat/latest");
                var resp = _httpClient.GetAsync(probeUri, cts.Token).GetAwaiter().GetResult();
                if (resp.IsSuccessStatusCode)
                {
                    _currentBaseUrl = candidate;
                    _logger.LogInformation("Discovered server: {BaseAddress}", _currentBaseUrl);
                    return;
                }
            }
            catch { }
        }
    }

    private IEnumerable<string> GetServerCandidates(bool extendedScan)
    {
        var list = new List<string>();
        list.Add(NormalizeServerUrl($"http://localhost:8080/api"));
        list.Add(NormalizeServerUrl($"http://127.0.0.1:8080/api"));
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                var props = nic.GetIPProperties();
                foreach (var gw in props.GatewayAddresses)
                {
                    var ip = gw?.Address;
                    if (ip != null && ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        list.Add(NormalizeServerUrl($"http://{ip}:8080/api"));
                    }
                }
                foreach (var uni in props.UnicastAddresses)
                {
                    var ip = uni?.Address;
                    var mask = uni?.IPv4Mask;
                    if (ip != null && mask != null && ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        var octets = ip.ToString().Split('.');
                        if (octets.Length == 4)
                        {
                            var prefix = $"{octets[0]}.{octets[1]}.{octets[2]}";
                            list.Add(NormalizeServerUrl($"http://{prefix}.1:8080/api"));
                            list.Add(NormalizeServerUrl($"http://{prefix}.254:8080/api"));
                            if (extendedScan || (octets[0] == "169" && octets[1] == "254"))
                            {
                                for (int h = 1; h <= 254; h++)
                                {
                                    list.Add(NormalizeServerUrl($"http://{prefix}.{h}:8080/api"));
                                }
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
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            var resp = await _httpClient.PostAsync(uri, content);
            if (!resp.IsSuccessStatusCode)
            {
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
        catch (HttpRequestException)
        {
            _currentBaseUrl = string.Empty;
            TryInitializeBaseAddress(extendedScan: true);
            if (string.IsNullOrWhiteSpace(_currentBaseUrl))
            {
                return new HttpResponseMessage(System.Net.HttpStatusCode.ServiceUnavailable);
            }
            var uri = new Uri(new Uri(_currentBaseUrl), relativeUrl);
            return await _httpClient.PostAsync(uri, content);
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
    }

    public async Task SendScreenshotAsync(string filePath)
    {
        try
        {
            if (!File.Exists(filePath))
            {
                _logger.LogWarning("Screenshot file not found: {FilePath}", filePath);
                return;
            }

            bool sent = false;
            var destPending = Path.Combine(_pendingScreenshots, Path.GetFileName(filePath));

            using (var fileStream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var streamContent = GetEncryptedStreamContent(fileStream))
            using (var content = new MultipartFormDataContent())
            {
                var now = DateTime.Now;
                var sendName = $"{_settings.ClientId}_{now:yyyy-MM-ddTHH-mm-ss.fff}.jpg";
                content.Add(streamContent, "screenshot", sendName);
                content.Add(new StringContent(_settings.ClientId), "clientId");
                // Send Local Time exactly as is (no Z, no offset)
                content.Add(new StringContent(now.ToString("yyyy-MM-ddTHH:mm:ss.fff")), "timestamp");

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
                _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending screenshot: {FilePath}", filePath);
            var dest = Path.Combine(_pendingScreenshots, Path.GetFileName(filePath));
            try { if (File.Exists(filePath)) File.Move(filePath, dest, true); } catch { }
            _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
        }
    }

    public Task SendSystemEventAsync(SystemEvent systemEvent)
    {
        _eventQueue.Enqueue(systemEvent);
        return Task.CompletedTask;
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
                        var json = JsonConvert.SerializeObject(batch);
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
                            var name = Path.Combine(_pendingEvents, $"batch_{DateTime.Now:yyyyMMdd_HHmmss_fff}.json");
                            try { await File.WriteAllTextAsync(name, json); } catch { }
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Error sending system event batch");
                        try { var name = Path.Combine(_pendingEvents, $"batch_{DateTime.Now:yyyyMMdd_HHmmss_fff}.json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(batch)); } catch { }
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
        try
        {
            var payload = new
            {
                ClientId = _settings.ClientId,
                Timestamp = DateTime.Now,
                IsActive = isActive,
                ActiveMilliseconds = activeMilliseconds,
                InactiveMilliseconds = inactiveMilliseconds
            };
            var json = JsonConvert.SerializeObject(payload);
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
            try { var name = Path.Combine(_pendingActivity, DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(new { IsActive = isActive, ActiveMilliseconds = activeMilliseconds, InactiveMilliseconds = inactiveMilliseconds })); } catch { }
        }
    }

    public async Task SendHeartbeatAsync()
    {
        try
        {
            var heartbeat = new
            {
                ClientId = _settings.ClientId,
                Timestamp = DateTime.Now,
                Status = "Online",
                Version = "1.0.0",
                Machine = Environment.MachineName,
                OS = Environment.OSVersion.ToString(),
                UptimeSeconds = (int)(DateTime.Now - System.Diagnostics.Process.GetCurrentProcess().StartTime).TotalSeconds,
                Memory = new
                {
                    WorkingSet = System.Diagnostics.Process.GetCurrentProcess().WorkingSet64,
                    PrivateMemorySize = System.Diagnostics.Process.GetCurrentProcess().PrivateMemorySize64,
                }
            };

            var json = JsonConvert.SerializeObject(heartbeat);
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await PostWithAutoDiscoverAsync("heartbeat", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Heartbeat sent successfully");
            }
            else
            {
                _logger.LogWarning("Failed to send heartbeat. Status: {StatusCode}", response.StatusCode);
                try { var name = Path.Combine(_pendingHeartbeats, DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, json); } catch { }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending heartbeat");
            try { var name = Path.Combine(_pendingHeartbeats, DateTime.Now.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(new { ClientId = _settings.ClientId, Timestamp = DateTime.Now, Status = "Online", Version = "1.0.0", Machine = Environment.MachineName, OS = Environment.OSVersion.ToString() })); } catch { }
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
                content.Add(new StringContent(DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss.fff")), "timestamp");

                var response = await PostWithAutoDiscoverAsync("reports", content);
                
                if (response.IsSuccessStatusCode)
                {
                    _logger.LogDebug("Report sent successfully: {ReportPath}", reportPath);
                    streamContent.Dispose();
                    fileStream.Dispose();
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
            _logger.LogWarning("Encryption key not configured, sending data unencrypted");
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
                content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");

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

    private StreamContent GetEncryptedStreamContent(Stream inputStream)
    {
        if (string.IsNullOrEmpty(_settings.EncryptionKey))
        {
            return new StreamContent(inputStream);
        }

        try 
        {
            var aes = Aes.Create();
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
        if (!raw.EndsWith("/")) raw += "/";
        return raw;
    }

    public void Dispose()
    {
        _httpClient?.Dispose();
        _retryTimer?.Dispose();
        _eventBatchTimer?.Dispose();
    }

    private async Task FlushPendingAsync()
    {
        if (!await _flushLock.WaitAsync(0)) return;

        try
        {
            _logger.LogDebug("Starting FlushPendingAsync");

            foreach (var file in Directory.GetFiles(_pendingScreenshots))
            {
                try
                {
                    using (var fileStream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read))
                    using (var streamContent = GetEncryptedStreamContent(fileStream))
                    using (var content = new MultipartFormDataContent())
                    {
                        var sendName = Path.GetFileName(file);
                        var timestamp = TryExtractTimestampFromFileName(sendName) ?? File.GetCreationTime(file);
                        
                        content.Add(streamContent, "screenshot", sendName);
                        content.Add(new StringContent(_settings.ClientId), "clientId");
                        content.Add(new StringContent(timestamp.ToString("yyyy-MM-ddTHH:mm:ss.fff")), "timestamp");
                        
                        var resp = await PostWithAutoDiscoverAsync("screenshots", content);
                        
                        if (resp.IsSuccessStatusCode) 
                        {
                            _logger.LogDebug("Pending screenshot sent successfully: {FileName}", sendName);
                            streamContent.Dispose();
                            fileStream.Dispose();
                            File.Delete(file);
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
                        content.Add(new StringContent(DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss.fff")), "timestamp");
                        var resp = await PostWithAutoDiscoverAsync("reports", content);
                        
                        if (resp.IsSuccessStatusCode) 
                        {
                            streamContent.Dispose();
                            fileStream.Dispose();
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
                                streamContent.Dispose();
                                fileStream.Dispose();
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
                            content.Add(new StringContent(DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss.fff")), "timestamp");
                            var resp = await PostWithAutoDiscoverAsync($"commands/{cmdId}/result", content);
                            if (resp.IsSuccessStatusCode) 
                            {
                                streamContent.Dispose();
                                fileStream.Dispose();
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
            _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
        }
    }

    private void OnNetworkAddressChanged(object? sender, EventArgs e)
    {
        _ = Task.Run(async () => { try { await FlushPendingAsync(); } catch { } });
    }

    private static DateTime? TryExtractTimestampFromFileName(string fileName)
    {
        try
        {
            var name = Path.GetFileNameWithoutExtension(fileName);
            var parts = name.Split('_');
            if (parts.Length >= 3)
            {
                var ts = parts[^1];
                // Try parsing the format we actually use: yyyy-MM-ddTHH-mm-ss.fff
                // Also support legacy format just in case
                if (DateTime.TryParseExact(ts, "yyyy-MM-ddTHH-mm-ss.fff", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var local) ||
                    DateTime.TryParseExact(ts, "yyyyMMdd_HHmmss", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out local))
                {
                    // Return as is (Unspecified/Local) so it prints cleanly
                    return local;
                }
            }
        }
        catch { }
        return null;
    }
}
