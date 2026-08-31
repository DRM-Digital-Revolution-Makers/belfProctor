using System.Security.Cryptography;
using System.Text;

namespace BelfProctor.Services;

public static class WebSocketAuth
{
    public static string CreateSignature(string clientId, long unixTimestampSeconds, string secret)
    {
        var message = $"{clientId}\n{unixTimestampSeconds}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret ?? string.Empty));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(message))).ToLowerInvariant();
    }

    public static string CreateQuery(string clientId, string secret, DateTimeOffset? now = null)
    {
        var timestamp = (now ?? DateTimeOffset.UtcNow).ToUnixTimeSeconds();
        var signature = CreateSignature(clientId, timestamp, secret);
        return $"clientId={Uri.EscapeDataString(clientId)}&ts={timestamp}&sig={signature}";
    }
}
