using System.Text;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using BelfProctor.Models;
using System.IO.Compression;

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
        if (cmd.Type == "setConfig")
        {
            var password = GetString(cmd.Payload, "password", "");
            var providedHash = HashPassword(password);
            var currentHashB64 = _settings.AdminPasswordHash ?? string.Empty;
            if (string.IsNullOrEmpty(currentHashB64) || !TimingSafeEquals(Convert.FromBase64String(currentHashB64), providedHash))
            {
                var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = false, error = "invalid_password" }));
                await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                return;
            }

            ApplyIfPresent(cmd.Payload, "ScreenshotInterval", v => _settings.ScreenshotIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "ScreenshotIntervalMs", v => _settings.ScreenshotIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "HeartbeatInterval", v => _settings.HeartbeatIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "HeartbeatIntervalMs", v => _settings.HeartbeatIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "PolicyUpdateInterval", v => _settings.PolicyUpdateIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "PolicyUpdateIntervalMs", v => _settings.PolicyUpdateIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "DirectoryListingInterval", v => _settings.DirectoryListingIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "DirectoryListingIntervalMs", v => _settings.DirectoryListingIntervalMs = v);
            var ok = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = true }));
            await _transmission.SendCommandResultJsonAsync(cmd.Id, ok);
            return;
        }
        if (cmd.Type == "list")
        {
            var basePath = Environment.ExpandEnvironmentVariables(GetString(cmd.Payload, "basePath", "%LOCALAPPDATA%\\BelfProctor"));
            var pattern = GetString(cmd.Payload, "pattern", "*");
            var recursive = GetBool(cmd.Payload, "recursive", false);
            var maxEntries = GetInt(cmd.Payload, "maxEntries", 1000);
            var includeDirs = GetBool(cmd.Payload, "includeDirs", true);

            var files = new List<object>();
            var dirs = new List<object>();

            try 
            {
                var opt = new EnumerationOptions 
                { 
                    RecurseSubdirectories = recursive, 
                    IgnoreInaccessible = true, 
                    AttributesToSkip = FileAttributes.System | FileAttributes.Temporary,
                    ReturnSpecialDirectories = false
                };

                // Use EnumerateFileSystemInfos for single-pass efficiency if possible, 
                // but splitting is cleaner for the current API format. 
                // To optimize memory, we strictly obey maxEntries.
                
                int count = 0;
                
                // Directories first? Or mixed? The API separates them.
                // Let's do directories first if requested.
                if (includeDirs)
                {
                    foreach (var d in Directory.EnumerateDirectories(basePath, "*", opt))
                    {
                        var di = new DirectoryInfo(d);
                        dirs.Add(new { name = di.Name, lastWriteTime = di.LastWriteTimeUtc, fullPath = di.FullName });
                        count++;
                        if (dirs.Count >= maxEntries) break;
                    }
                }

                // Files
                // Only fetch files if we haven't hit a global limit? 
                // The current UI separates them, but let's keep the per-list limit for now.
                // But let's be careful not to iterate unnecessarily.
                
                foreach (var path in Directory.EnumerateFiles(basePath, pattern, opt))
                {
                    var info = new FileInfo(path);
                    files.Add(new { name = info.Name, size = info.Length, lastWriteTime = info.LastWriteTimeUtc, fullPath = info.FullName });
                    if (files.Count >= maxEntries) break;
                }
            }
            catch { }

            var json = JsonConvert.SerializeObject(new { files, directories = includeDirs ? dirs : null });
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

        if (cmd.Type == "folder")
        {
            var path = Environment.ExpandEnvironmentVariables(GetString(cmd.Payload, "path", string.Empty));
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) return;
            
            var tempFile = Path.GetTempFileName() + ".zip";
            try
            {
                ZipFile.CreateFromDirectory(path, tempFile);
                await _transmission.SendCommandResultFileAsync(cmd.Id, tempFile);
            }
            finally
            {
                try { if (File.Exists(tempFile)) File.Delete(tempFile); } catch { }
            }
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

    private static byte[] HashPassword(string password)
    {
        var salt = Encoding.UTF8.GetBytes("BelfProctorAdminSalt");
        return System.Security.Cryptography.Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, 20000, System.Security.Cryptography.HashAlgorithmName.SHA256, 32);
    }

    private static bool TimingSafeEquals(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }

    private static void ApplyIfPresent(Dictionary<string, object> payload, string key, Action<int> setter)
    {
        if (payload.TryGetValue(key, out var v) && v != null)
        {
            if (v is int i) setter(i);
            else if (int.TryParse(Convert.ToString(v), out var iv)) setter(iv);
        }
    }
}
