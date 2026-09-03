using System.Security.Cryptography;
using System.Text;

namespace BelfProctor.Services;

public static class WebSocketAuth
{
    private const string UpdateDownloadDomain = "belfproctor-update-download-v1";

    public static string CreateSignature(string clientId, long unixTimestampSeconds, string secret, string nonce = "")
    {
        var message = $"{clientId}\n{unixTimestampSeconds}\n{nonce}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret ?? string.Empty));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message))).ToLowerInvariant();
    }

    public static string CreateQuery(string clientId, string secret, DateTimeOffset? now = null)
    {
        var timestamp = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var nonce = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var signature = CreateSignature(clientId, timestamp, secret, nonce);
        return $"clientId={Uri.EscapeDataString(clientId)}&ts={timestamp}&nonce={nonce}&sig={signature}";
    }

    public static string CreateUpdateDownloadSignature(
        string clientId,
        string version,
        long unixTimestampSeconds,
        string secret,
        string nonce)
    {
        var message = $"{UpdateDownloadDomain}\n{clientId}\n{version}\n{unixTimestampSeconds}\n{nonce}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret ?? string.Empty));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message))).ToLowerInvariant();
    }
}
