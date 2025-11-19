using System.Net.WebSockets;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;
using BelfProctor.Services;

namespace BelfProctor;

public class CommandChannelWorker : BackgroundService
{
    private readonly ProctorSettings _settings;
    private readonly CommandHandler _handler;

    public CommandChannelWorker(IOptions<ProctorSettings> settings, CommandHandler handler)
    {
        _settings = settings.Value;
        _handler = handler;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var ws = new ClientWebSocket();
                var wsUrl = BuildWsUrl(_settings.ServerUrl, _settings.ClientId);
                await ws.ConnectAsync(new Uri(wsUrl), stoppingToken);
                var buf = new byte[64 * 1024];
                while (ws.State == WebSocketState.Open && !stoppingToken.IsCancellationRequested)
                {
                    var result = await ws.ReceiveAsync(buf, stoppingToken);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                    var msg = Encoding.UTF8.GetString(buf, 0, result.Count);
                    var cmd = JsonConvert.DeserializeObject<Command>(msg);
                    if (cmd != null) await _handler.HandleAsync(cmd);
                }
            }
            catch
            {
            }
            await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        }
    }

    public static string BuildWsUrl(string serverUrl, string clientId)
    {
        var uri = new Uri(serverUrl);
        var scheme = uri.Scheme == "https" ? "wss" : "ws";
        var host = uri.Host;
        var port = uri.IsDefaultPort ? (uri.Scheme == "https" ? 443 : 80) : uri.Port;
        return $"{scheme}://{host}:{port}/ws?clientId={Uri.EscapeDataString(clientId)}";
    }
}