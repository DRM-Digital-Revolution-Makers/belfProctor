using System.IO;
using System.Linq;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using BelfProctor.Services;
using Newtonsoft.Json;

namespace BelfProctor;

public class ClientLogUploadWorker : BackgroundService
{
    private readonly ILogger<ClientLogUploadWorker> _logger;
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _tx;
    private readonly string _logDir;
    private readonly string _statePath;
    private readonly Dictionary<string, long> _offsets = new(StringComparer.OrdinalIgnoreCase);

    private const int IntervalMs = 300000;
    private const int MaxChunkBytes = 200 * 1024;

    public ClientLogUploadWorker(
        ILogger<ClientLogUploadWorker> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService tx)
    {
        _logger = logger;
        _settings = settings.Value;
        _tx = tx;
        _logDir = Environment.ExpandEnvironmentVariables(_settings.LogPath ?? string.Empty);
        if (string.IsNullOrWhiteSpace(_logDir))
        {
            _logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor", "Logs");
        }
        Directory.CreateDirectory(_logDir);
        _statePath = Path.Combine(_logDir, "log_upload_state.json");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        LoadState();
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await UploadOnce(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "ClientLogUploadWorker failed");
            }

            try
            {
                await Task.Delay(IntervalMs, stoppingToken);
            }
            catch
            {
                break;
            }
        }
        SaveState();
    }

    private void LoadState()
    {
        try
        {
            if (!File.Exists(_statePath)) return;
            var raw = File.ReadAllText(_statePath, Encoding.UTF8);
            var dict = JsonConvert.DeserializeObject<Dictionary<string, long>>(raw);
            if (dict == null) return;
            foreach (var kv in dict)
            {
                if (kv.Value >= 0) _offsets[kv.Key] = kv.Value;
            }
        }
        catch
        {
        }
    }

    private void SaveState()
    {
        try
        {
            var json = JsonConvert.SerializeObject(_offsets, Formatting.Indented);
            File.WriteAllText(_statePath, json, Encoding.UTF8);
        }
        catch
        {
        }
    }

    private async Task UploadOnce(CancellationToken ct)
    {
        if (!Directory.Exists(_logDir)) return;

        var files = Directory.GetFiles(_logDir, "*.log", SearchOption.TopDirectoryOnly)
            .Concat(Directory.GetFiles(_logDir, "*.txt", SearchOption.TopDirectoryOnly))
            .ToArray();

        foreach (var file in files)
        {
            if (ct.IsCancellationRequested) return;
            if (file.EndsWith("log_upload_state.json", StringComparison.OrdinalIgnoreCase)) continue;

            await UploadFileIncremental(file, ct);
        }
        SaveState();
    }

    private async Task UploadFileIncremental(string filePath, CancellationToken ct)
    {
        var fileName = Path.GetFileName(filePath);
        long offset = 0;
        if (_offsets.TryGetValue(fileName, out var saved)) offset = Math.Max(0, saved);

        FileInfo info;
        try
        {
            info = new FileInfo(filePath);
            if (!info.Exists) return;
        }
        catch
        {
            return;
        }

        if (offset > info.Length) offset = 0;
        if (offset == info.Length) return;

        using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        fs.Seek(offset, SeekOrigin.Begin);

        var buf = new byte[MaxChunkBytes];
        int read;
        while ((read = await fs.ReadAsync(buf.AsMemory(0, buf.Length), ct)) > 0)
        {
            var text = Encoding.UTF8.GetString(buf, 0, read);
            await _tx.SendClientLogChunkAsync(fileName, text);
            offset += read;
            _offsets[fileName] = offset;
            if (ct.IsCancellationRequested) break;
            if (fs.Position >= fs.Length) break;
        }
    }
}
