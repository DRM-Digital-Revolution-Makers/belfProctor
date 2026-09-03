using System.Net.WebSockets;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;
using BelfProctor.Models;
using BelfProctor.Services;
using System.IO;

namespace BelfProctor;

public class CommandChannelWorker : BackgroundService
{
    private readonly ILogger<CommandChannelWorker> _logger;
    private readonly ProctorSettings _settings;
    private readonly CommandHandler _handler;

    public CommandChannelWorker(
        IOptions<ProctorSettings> settings,
        CommandHandler handler,
        ILogger<CommandChannelWorker> logger)
    {
        _settings = settings.Value;
        _handler = handler;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var backoffSeconds = 2;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var (ws, connectedUri) = await ConnectAsync(stoppingToken);
                using (ws)
                {
                    _logger.LogInformation("Command channel connected");
                    ConnectivityState.SetWsConnected(true);
                    backoffSeconds = 2;
                    // Matches the server's WebSocket maxPayload. The previous 64KB
                    // cap both under-sized the server's limit AND broke the whole
                    // connection on an over-limit frame; now we fully drain and
                    // discard only the offending message, keeping the channel up [C-M9].
                    const int MaxWsMessageBytes = 2 * 1024 * 1024;
                    var buf = new byte[16 * 1024];
                    while (ws.State == WebSocketState.Open && !stoppingToken.IsCancellationRequested)
                    {
                        using var ms = new MemoryStream();
                        WebSocketReceiveResult? result = null;
                        var oversize = false;
                        do
                        {
                            result = await ws.ReceiveAsync(buf, stoppingToken);
                            if (result.MessageType == WebSocketMessageType.Close) break;
                            if (result.Count > 0)
                            {
                                if (ms.Length + result.Count > MaxWsMessageBytes) oversize = true;
                                else ms.Write(buf, 0, result.Count);
                            }
                        } while (!result.EndOfMessage);

                        if (result == null || result.MessageType == WebSocketMessageType.Close) break;
                        if (oversize)
                        {
                            _logger.LogWarning("Discarded oversized WS message (> {Max} bytes)", MaxWsMessageBytes);
                            continue;
                        }
                        if (result.MessageType != WebSocketMessageType.Text) continue;

                        var msg = Encoding.UTF8.GetString(ms.ToArray());
                        Command? cmd = null;
                        try
                        {
                            cmd = JsonConvert.DeserializeObject<Command>(msg);
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to parse WS command JSON (len={Len})", msg.Length);
                        }

                        if (cmd == null) continue;

                        _ = Task.Run(async () =>
                        {
                            try
                            {
                                await _handler.HandleAsync(cmd);
                            }
                            catch (Exception ex)
                            {
                                _logger.LogError(ex, "Error handling command {Id}", cmd.Id);
                            }
                        });
                    }
                    _logger.LogInformation("Command channel disconnected");
                    ConnectivityState.SetWsConnected(false);
                }

            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Command channel error, will retry");
                ConnectivityState.SetWsConnected(false);
                ConnectivityState.SetWsError(ex.Message);
            }
            await Task.Delay(TimeSpan.FromSeconds(backoffSeconds), stoppingToken);
            backoffSeconds = Math.Min(backoffSeconds * 2, 30);
        }
    }

    public static string BuildWsUrl(string serverUrl, string clientId, string encryptionKey)
    {
        var uri = new Uri(serverUrl);
        if (uri.Scheme != Uri.UriSchemeHttps)
            throw new InvalidOperationException("Command channel requires an HTTPS server URL.");
        const string scheme = "wss";
        var host = uri.Host;
        var port = uri.IsDefaultPort ? 443 : uri.Port;
        return $"{scheme}://{host}:{port}/ws?{WebSocketAuth.CreateQuery(clientId, encryptionKey)}";
    }

    private async Task<(ClientWebSocket ws, Uri connectedUri)> ConnectAsync(CancellationToken ct)
    {
        foreach (var candidate in BuildWsCandidates(_settings.ServerUrl, _settings.ClientId, _settings.EncryptionKey))
        {
            var ws = new ClientWebSocket();
            ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
            try
            {
                _logger.LogInformation(
                    "Connecting to command channel: {Endpoint}",
                    candidate.GetLeftPart(UriPartial.Path));
                await ws.ConnectAsync(candidate, ct);
                if (ws.State == WebSocketState.Open)
                {
                    return (ws, candidate);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "WS connect failed: {Url}", candidate);
            }
            try { ws.Dispose(); } catch { }
        }
        throw new Exception("Command channel connection failed (no candidates succeeded)");
    }

    private static IEnumerable<Uri> BuildWsCandidates(string serverUrl, string clientId, string encryptionKey)
    {
        var query = WebSocketAuth.CreateQuery(clientId ?? string.Empty, encryptionKey);

        if (Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri))
        {
            if (uri.Scheme != Uri.UriSchemeHttps)
                throw new InvalidOperationException("Command channel requires an HTTPS server URL (WSS transport).");
            var scheme = uri.Scheme == "https" ? "wss" : "ws";
            var host = uri.Host;
            var port = uri.IsDefaultPort ? (uri.Scheme == "https" ? 443 : 80) : uri.Port;
            yield return new Uri($"{scheme}://{host}:{port}/ws?{query}");

            if (uri.IsDefaultPort)
            {
                yield return new Uri($"{scheme}://{host}:8080/ws?{query}");
            }
        }
        else throw new InvalidOperationException("Command channel server URL is invalid.");
    }
}
