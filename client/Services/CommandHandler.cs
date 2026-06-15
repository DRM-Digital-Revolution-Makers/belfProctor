using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using BelfProctor.Models;
using System.IO.Compression;
using System.IO;

namespace BelfProctor.Services;

public class CommandHandler
{
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _transmission;
    private readonly StreamingService _streaming;
    private readonly Microsoft.Extensions.Logging.ILogger<CommandHandler>? _logger;

    public CommandHandler(
        IOptions<ProctorSettings> settings,
        IDataTransmissionService transmission,
        StreamingService streaming,
        Microsoft.Extensions.Logging.ILogger<CommandHandler>? logger = null)
    {
        _settings = settings.Value;
        _transmission = transmission;
        _streaming = streaming;
        _logger = logger;
    }

    public async Task HandleAsync(Command cmd)
    {
        if (cmd.Type == "uninstall" || cmd.Type == "deleteClient")
        {
            var serviceName = GetString(cmd.Payload, "serviceName", "BelfProctor");

            try
            {
                var ack = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = true, started = true }));
                await _transmission.SendCommandResultJsonAsync(cmd.Id, ack);
            }
            catch { }

            UninstallHelper.StartUninstall(_settings, null, serviceName);

            return;
        }

        if (cmd.Type == "setConfig" || cmd.Type == "setIntervals")
        {
            if (cmd.Type == "setConfig")
            {
                var password = GetString(cmd.Payload, "password", "");
                var providedHash = HashPassword(password);
                var currentHashB64 = _settings.AdminPasswordHash ?? string.Empty;
                if (string.IsNullOrEmpty(currentHashB64))
                {
                    var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = false, error = "admin_password_not_set" }));
                    await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                    return;
                }
                byte[]? currentBytes = null;
                try
                {
                    currentBytes = Convert.FromBase64String(currentHashB64);
                }
                catch (FormatException)
                {
                    var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = false, error = "invalid_password" }));
                    await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                    return;
                }
                if (currentBytes == null || currentBytes.Length == 0 || !TimingSafeEquals(currentBytes, providedHash))
                {
                    var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = false, error = "invalid_password" }));
                    await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                    return;
                }
            }

            ApplyIfPresent(cmd.Payload, "ScreenshotInterval", v => _settings.ScreenshotIntervalMs = Math.Max(300000, v));
            ApplyIfPresent(cmd.Payload, "ScreenshotIntervalMs", v => _settings.ScreenshotIntervalMs = Math.Max(300000, v));
            ApplyIfPresent(cmd.Payload, "screenshotMs", v => _settings.ScreenshotIntervalMs = Math.Max(300000, v));
            ApplyIfPresent(cmd.Payload, "HeartbeatInterval", v => _settings.HeartbeatIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "HeartbeatIntervalMs", v => _settings.HeartbeatIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "heartbeatMs", v => _settings.HeartbeatIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "PolicyUpdateInterval", v => _settings.PolicyUpdateIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "PolicyUpdateIntervalMs", v => _settings.PolicyUpdateIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "DirectoryListingInterval", v => _settings.DirectoryListingIntervalMs = v);
            ApplyIfPresent(cmd.Payload, "DirectoryListingIntervalMs", v => _settings.DirectoryListingIntervalMs = v);
            try { SaveSettingsToAppData(); } catch { }
            var ok = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = true }));
            await _transmission.SendCommandResultJsonAsync(cmd.Id, ok);
            return;
        }

        if (cmd.Type == "stream.start" || cmd.Type == "start_stream")
        {
            var width = GetInt(cmd.Payload, "width", 1280);
            var fps = GetInt(cmd.Payload, "fps", 10);
            var quality = GetInt(cmd.Payload, "quality", 50);
            await _streaming.StartAsync(width, fps, quality);
            var ok = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = true, status = "stream_started" }));
            await _transmission.SendCommandResultJsonAsync(cmd.Id, ok);
            return;
        }

        if (cmd.Type == "stream.stop" || cmd.Type == "stop_stream")
        {
            await _streaming.StopAsync();
            var ok = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(new { ok = true, status = "stream_stopped" }));
            await _transmission.SendCommandResultJsonAsync(cmd.Id, ok);
            return;
        }

        if (cmd.Type == "list")
        {
            var basePath = ResolveAndValidatePath(GetString(cmd.Payload, "basePath", "%LOCALAPPDATA%\\BelfProctor")) ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
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
            var path = ResolveAndValidatePath(GetString(cmd.Payload, "path", string.Empty));
            if (string.IsNullOrWhiteSpace(path) || !File.Exists(path)) return;
            await _transmission.SendCommandResultFileAsync(cmd.Id, path);
            return;
        }

        if (cmd.Type == "folder")
        {
            var path = ResolveAndValidatePath(GetString(cmd.Payload, "path", string.Empty));
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

        if (cmd.Type == "update")
        {
            var newVersion = GetString(cmd.Payload, "version", "");
            var downloadUrl = GetString(cmd.Payload, "downloadUrl", "");
            var sha256Expected = GetString(cmd.Payload, "sha256", "");

            if (string.IsNullOrWhiteSpace(downloadUrl) || string.IsNullOrWhiteSpace(sha256Expected))
            {
                var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(
                    new { ok = false, error = "invalid_payload" }));
                await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                return;
            }

            // Run the update flow detached from this WS callback so we don't
            // block the channel. The flow itself can take 60+ minutes (idle wait).
            _ = Task.Run(async () =>
            {
                try
                {
                    var ok = await UpdateHelper.DownloadAndInstall(
                        _settings,
                        _logger,
                        downloadUrl,
                        sha256Expected,
                        newVersion,
                        async (status, detail) =>
                        {
                            try
                            {
                                var msg = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(
                                    new { ok = true, status, detail, version = newVersion }));
                                await _transmission.SendCommandResultJsonAsync(cmd.Id, msg);
                            }
                            catch { /* swallow — best-effort progress */ }
                        });

                    if (!ok)
                    {
                        var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(
                            new { ok = false, error = "update_failed", version = newVersion }));
                        await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                    }
                }
                catch (Exception ex)
                {
                    _logger?.LogError(ex, "Update task crashed");
                    try
                    {
                        var err = Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(
                            new { ok = false, error = "exception", detail = ex.Message }));
                        await _transmission.SendCommandResultJsonAsync(cmd.Id, err);
                    }
                    catch { }
                }
            });
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

    private static bool TimingSafeEquals(byte[]? a, byte[]? b)
    {
        if (a == null || b == null || a.Length != b.Length) return false;
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

    private string? ResolveAndValidatePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var resolved = Path.GetFullPath(Environment.ExpandEnvironmentVariables(path));
        var allowedBases = new List<string>
        {
            Environment.ExpandEnvironmentVariables(_settings.ScreenshotPath ?? ""),
            Environment.ExpandEnvironmentVariables(_settings.LogPath ?? ""),
            Environment.ExpandEnvironmentVariables(_settings.ReportsPath ?? ""),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor"),
        };
                foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady) continue;
                var root = drive.RootDirectory?.FullName;
                if (!string.IsNullOrWhiteSpace(root)) allowedBases.Add(root);
            }
            catch { }
        }
        foreach (var allowed in _settings.DirectoryRoots ?? new List<string>())
        {
            var a = Path.GetFullPath(Environment.ExpandEnvironmentVariables(allowed));
            if (!string.IsNullOrEmpty(a)) allowedBases.Add(a);
        }
        foreach (var basePath in allowedBases)
        {
            if (string.IsNullOrEmpty(basePath)) continue;
            var canon = Path.GetFullPath(basePath);
            if (resolved.Equals(canon, StringComparison.OrdinalIgnoreCase) || resolved.StartsWith(canon + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return resolved;
        }
        return null;
    }

    private void SaveSettingsToAppData()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
        var path = Path.Combine(dir, "appsettings.json");
        Directory.CreateDirectory(dir);
        JObject root;
        if (File.Exists(path))
        {
            var json = File.ReadAllText(path);
            root = string.IsNullOrWhiteSpace(json) ? new JObject() : JObject.Parse(json);
        }
        else
            root = new JObject();
        var section = root["ProctorSettings"] as JObject ?? new JObject();
        section["ScreenshotIntervalMs"] = _settings.ScreenshotIntervalMs;
        section["HeartbeatIntervalMs"] = _settings.HeartbeatIntervalMs;
        section["PolicyUpdateIntervalMs"] = _settings.PolicyUpdateIntervalMs;
        section["DirectoryListingIntervalMs"] = _settings.DirectoryListingIntervalMs;
        root["ProctorSettings"] = section;
        File.WriteAllText(path, root.ToString(Formatting.Indented));
    }
}
