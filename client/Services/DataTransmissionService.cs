using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;

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
        if (Uri.TryCreate(serverUrl, UriKind.Absolute, out var baseUri))
        {
            _httpClient.BaseAddress = baseUri;
            _logger.LogInformation("HTTP BaseAddress: {BaseAddress}", _httpClient.BaseAddress);
        }
        else
        {
            _logger.LogWarning("ServerUrl is not configured or invalid: {ServerUrl}", _settings.ServerUrl);
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

            var fileBytes = await File.ReadAllBytesAsync(filePath);
            var encryptedData = EncryptData(fileBytes);
            
            using var content = new MultipartFormDataContent();
            var sendName = $"{_settings.ClientId}_{DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss.fffZ")}.jpg";
            content.Add(new ByteArrayContent(encryptedData), "screenshot", sendName);
            content.Add(new StringContent(_settings.ClientId), "clientId");
            content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");

            var response = await _httpClient.PostAsync("screenshots", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Screenshot sent successfully: {FilePath}", filePath);
                try { if (File.Exists(filePath)) File.Delete(filePath); } catch { }
            }
            else
            {
                _logger.LogWarning("Failed to send screenshot. Status: {StatusCode}", response.StatusCode);
                var dest = Path.Combine(_pendingScreenshots, Path.GetFileName(filePath));
                try { File.Move(filePath, dest, true); } catch { }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending screenshot: {FilePath}", filePath);
            var dest = Path.Combine(_pendingScreenshots, Path.GetFileName(filePath));
            try { if (File.Exists(filePath)) File.Move(filePath, dest, true); } catch { }
        }
    }

    public async Task SendSystemEventAsync(SystemEvent systemEvent)
    {
        try
        {
            var json = JsonConvert.SerializeObject(systemEvent);
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await _httpClient.PostAsync("events", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("System event sent successfully: {EventType}", systemEvent.EventType);
            }
            else
            {
                _logger.LogWarning("Failed to send system event. Status: {StatusCode}", response.StatusCode);
                var name = Path.Combine(_pendingEvents, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json");
                try { await File.WriteAllTextAsync(name, json); } catch { }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending system event: {EventType}", systemEvent.EventType);
            try { var name = Path.Combine(_pendingEvents, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(systemEvent)); } catch { }
        }
    }

    public async Task SendActivityAsync(bool isActive, long activeMilliseconds, long inactiveMilliseconds)
    {
        try
        {
            var payload = new
            {
                ClientId = _settings.ClientId,
                Timestamp = DateTime.UtcNow,
                IsActive = isActive,
                ActiveMilliseconds = activeMilliseconds,
                InactiveMilliseconds = inactiveMilliseconds
            };
            var json = JsonConvert.SerializeObject(payload);
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
            var response = await _httpClient.PostAsync("activity", content);
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
            try { var name = Path.Combine(_pendingActivity, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(new { IsActive = isActive, ActiveMilliseconds = activeMilliseconds, InactiveMilliseconds = inactiveMilliseconds })); } catch { }
        }
    }

    public async Task SendHeartbeatAsync()
    {
        try
        {
            var heartbeat = new
            {
                ClientId = _settings.ClientId,
                Timestamp = DateTime.UtcNow,
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

            var response = await _httpClient.PostAsync("heartbeat", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Heartbeat sent successfully");
            }
            else
            {
                _logger.LogWarning("Failed to send heartbeat. Status: {StatusCode}", response.StatusCode);
                try { var name = Path.Combine(_pendingHeartbeats, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, json); } catch { }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending heartbeat");
            try { var name = Path.Combine(_pendingHeartbeats, DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + ".json"); await File.WriteAllTextAsync(name, JsonConvert.SerializeObject(new { ClientId = _settings.ClientId, Timestamp = DateTime.UtcNow, Status = "Online", Version = "1.0.0", Machine = Environment.MachineName, OS = Environment.OSVersion.ToString() })); } catch { }
        }
    }

    public async Task<byte[]> DownloadPolicyAsync(string policyId)
    {
        try
        {
            var response = await _httpClient.GetAsync($"policies/{policyId}");
            
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

            var fileBytes = await File.ReadAllBytesAsync(reportPath);
            var encryptedData = EncryptData(fileBytes);
            
            using var content = new MultipartFormDataContent();
            content.Add(new ByteArrayContent(encryptedData), "report", Path.GetFileName(reportPath));
            content.Add(new StringContent(_settings.ClientId), "clientId");
            content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");

            var response = await _httpClient.PostAsync("reports", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Report sent successfully: {ReportPath}", reportPath);
            }
            else
            {
                _logger.LogWarning("Failed to send report. Status: {StatusCode}", response.StatusCode);
                var dest = Path.Combine(_pendingReports, Path.GetFileName(reportPath));
                try { File.Move(reportPath, dest, true); } catch { }
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

            var response = await _httpClient.PostAsync($"commands/{commandId}/json", content);

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
        try
        {
            if (!File.Exists(filePath))
            {
                _logger.LogWarning("Command result file not found: {FilePath}", filePath);
                return;
            }

            var fileBytes = await File.ReadAllBytesAsync(filePath);
            var encryptedData = EncryptData(fileBytes);
            using var content = new MultipartFormDataContent();
            content.Add(new ByteArrayContent(encryptedData), "file", Path.GetFileName(filePath));
            content.Add(new StringContent(_settings.ClientId), "clientId");
            content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");

            var response = await _httpClient.PostAsync($"commands/{commandId}/result", content);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Failed to send command result file. Status: {StatusCode}", response.StatusCode);
                var destName = Path.Combine(_pendingCmdFiles, $"cmd_{commandId}_{Path.GetFileName(filePath)}");
                try { File.Move(filePath, destName, true); } catch { }
            }
            else
            {
                _logger.LogDebug("Command result file sent successfully: {CommandId}", commandId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending command result file");
            try { var destName = Path.Combine(_pendingCmdFiles, $"cmd_{commandId}_{Path.GetFileName(filePath)}"); if (File.Exists(filePath)) File.Move(filePath, destName, true); } catch { }
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
    }

    private async Task FlushPendingAsync()
    {
        try
        {
            foreach (var file in Directory.GetFiles(_pendingScreenshots))
            {
                try
                {
                    var fileBytes = await File.ReadAllBytesAsync(file);
                    var encrypted = EncryptData(fileBytes);
                    using var content = new MultipartFormDataContent();
                    var sendName = $"{_settings.ClientId}_{DateTime.UtcNow.ToString("yyyy-MM-ddTHH-mm-ss.fffZ")}.jpg";
                    content.Add(new ByteArrayContent(encrypted), "screenshot", sendName);
                    content.Add(new StringContent(_settings.ClientId), "clientId");
                    content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");
                    var resp = await _httpClient.PostAsync("screenshots", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
                }
                catch { }
            }

            foreach (var file in Directory.GetFiles(_pendingReports))
            {
                try
                {
                    var fileBytes = await File.ReadAllBytesAsync(file);
                    var encrypted = EncryptData(fileBytes);
                    using var content = new MultipartFormDataContent();
                    content.Add(new ByteArrayContent(encrypted), "report", Path.GetFileName(file));
                    content.Add(new StringContent(_settings.ClientId), "clientId");
                    content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");
                    var resp = await _httpClient.PostAsync("reports", content);
                    if (resp.IsSuccessStatusCode) File.Delete(file);
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
                    var resp = await _httpClient.PostAsync("events", content);
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
                    var resp = await _httpClient.PostAsync("activity", content);
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
                    var resp = await _httpClient.PostAsync("heartbeat", content);
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
                        var jsonBytes = await File.ReadAllBytesAsync(file);
                        var encrypted = EncryptData(jsonBytes);
                        using var content = new ByteArrayContent(encrypted);
                        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");
                        var resp = await _httpClient.PostAsync($"commands/{cmdId}/json", content);
                        if (resp.IsSuccessStatusCode) File.Delete(file);
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
                        var fileBytes = await File.ReadAllBytesAsync(file);
                        var encrypted = EncryptData(fileBytes);
                        using var content = new MultipartFormDataContent();
                        content.Add(new ByteArrayContent(encrypted), "file", Path.GetFileName(file));
                        content.Add(new StringContent(_settings.ClientId), "clientId");
                        content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");
                        var resp = await _httpClient.PostAsync($"commands/{cmdId}/result", content);
                        if (resp.IsSuccessStatusCode) File.Delete(file);
                    }
                }
                catch { }
            }
        }
        catch { }
    }
}
