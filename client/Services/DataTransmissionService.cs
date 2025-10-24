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

    public DataTransmissionService(
        ILogger<DataTransmissionService> logger,
        IOptions<ProctorSettings> settings)
    {
        _logger = logger;
        _settings = settings.Value;
        _httpClient = new HttpClient();
        
        // Настройка HTTP клиента
        _httpClient.DefaultRequestHeaders.Add("User-Agent", "BelfProctor/1.0");
        _httpClient.DefaultRequestHeaders.Add("X-Client-Id", _settings.ClientId);
        _httpClient.Timeout = TimeSpan.FromMinutes(5);
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
            content.Add(new ByteArrayContent(encryptedData), "screenshot", Path.GetFileName(filePath));
            content.Add(new StringContent(_settings.ClientId), "clientId");
            content.Add(new StringContent(DateTime.UtcNow.ToString("O")), "timestamp");

            var response = await _httpClient.PostAsync($"{_settings.ServerUrl}/screenshots", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Screenshot sent successfully: {FilePath}", filePath);
            }
            else
            {
                _logger.LogWarning("Failed to send screenshot. Status: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending screenshot: {FilePath}", filePath);
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

            var response = await _httpClient.PostAsync($"{_settings.ServerUrl}/events", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("System event sent successfully: {EventType}", systemEvent.EventType);
            }
            else
            {
                _logger.LogWarning("Failed to send system event. Status: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending system event: {EventType}", systemEvent.EventType);
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
                Version = "1.0.0"
            };

            var json = JsonConvert.SerializeObject(heartbeat);
            var encryptedData = EncryptData(Encoding.UTF8.GetBytes(json));
            
            using var content = new ByteArrayContent(encryptedData);
            content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            var response = await _httpClient.PostAsync($"{_settings.ServerUrl}/heartbeat", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Heartbeat sent successfully");
            }
            else
            {
                _logger.LogWarning("Failed to send heartbeat. Status: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending heartbeat");
        }
    }

    public async Task<byte[]> DownloadPolicyAsync(string policyId)
    {
        try
        {
            var response = await _httpClient.GetAsync($"{_settings.ServerUrl}/policies/{policyId}");
            
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

            var response = await _httpClient.PostAsync($"{_settings.ServerUrl}/reports", content);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Report sent successfully: {ReportPath}", reportPath);
            }
            else
            {
                _logger.LogWarning("Failed to send report. Status: {StatusCode}", response.StatusCode);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error sending report: {ReportPath}", reportPath);
        }
    }

    private byte[] EncryptData(byte[] data)
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

    private byte[] DecryptData(byte[] encryptedData)
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

    private byte[] DeriveKeyFromPassword(string password)
    {
        using var rfc2898 = new Rfc2898DeriveBytes(password, Encoding.UTF8.GetBytes("BelfProctorSalt"), 10000, HashAlgorithmName.SHA256);
        return rfc2898.GetBytes(32); // 256-bit key
    }

    public void Dispose()
    {
        _httpClient?.Dispose();
    }
}