using System;

namespace BelfProctor.Services;

public static class ConnectivityState
{
    private static readonly object LockObj = new();

    public static bool WsConnected { get; private set; }
    public static DateTime WsLastChangeUtc { get; private set; } = DateTime.UtcNow;
    public static string WsLastError { get; private set; } = string.Empty;

    public static void SetWsConnected(bool connected)
    {
        lock (LockObj)
        {
            WsConnected = connected;
            WsLastChangeUtc = DateTime.UtcNow;
            if (connected) WsLastError = string.Empty;
        }
    }

    public static void SetWsError(string error)
    {
        lock (LockObj)
        {
            WsLastError = (error ?? string.Empty).Trim();
            if (WsLastError.Length > 300) WsLastError = WsLastError.Substring(0, 300);
            WsLastChangeUtc = DateTime.UtcNow;
        }
    }
}
