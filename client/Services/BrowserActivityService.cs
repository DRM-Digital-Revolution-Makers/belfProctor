using Microsoft.Data.Sqlite;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.IO;
using BelfProctor.Models;

namespace BelfProctor.Services;

/// <summary>
/// Periodically reads the browsing History of every installed Chromium-family
/// browser (and Firefox) and ships incremental visits to the server. No browser
/// configuration is required — we copy the History SQLite file to a temp path
/// to dodge the WAL lock, then query the urls table.
/// </summary>
public class BrowserActivityService : BackgroundService
{
    private readonly ILogger<BrowserActivityService> _logger;
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _transmission;
    private readonly string _statePath;
    private readonly Dictionary<string, long> _lastSeenMicros = new();

    private static readonly TimeSpan TickInterval = TimeSpan.FromMinutes(1);
    private const int MaxRowsPerProfile = 500;

    // Chrome stores last_visit_time as microseconds since 1601-01-01 (Windows FILETIME epoch).
    private static readonly DateTime WebKitEpoch = new(1601, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public BrowserActivityService(
        ILogger<BrowserActivityService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService transmission)
    {
        _logger = logger;
        _settings = settings.Value;
        _transmission = transmission;
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BelfProctor");
        Directory.CreateDirectory(dir);
        _statePath = Path.Combine(dir, "browser_state.json");
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_settings.Features.BrowserActivity)
        {
            _logger.LogInformation("Browser activity tracking disabled by feature flag");
            return;
        }

        LoadState();

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await TickAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Browser activity tick failed");
            }

            try
            {
                await Task.Delay(TickInterval, stoppingToken);
            }
            catch (TaskCanceledException)
            {
                break;
            }
        }
        SaveState();
    }

    private async Task TickAsync(CancellationToken ct)
    {
        var collected = new List<BrowserVisit>();

        foreach (var browser in EnumerateBrowsers())
        {
            if (ct.IsCancellationRequested) break;
            try
            {
                foreach (var profile in EnumerateProfiles(browser))
                {
                    if (ct.IsCancellationRequested) break;
                    var visits = TryReadVisits(browser, profile);
                    if (visits.Count > 0) collected.AddRange(visits);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to read browser {Browser}", browser.Name);
            }
        }

        if (collected.Count == 0) return;

        // Newest first — same as ORDER BY last_visit_time DESC.
        await _transmission.SendBrowserActivityAsync(collected);
        SaveState();
    }

    private List<BrowserVisit> TryReadVisits(BrowserDef browser, ProfileDef profile)
    {
        var visits = new List<BrowserVisit>();
        if (!File.Exists(profile.HistoryPath)) return visits;

        var tempPath = Path.Combine(
            Path.GetTempPath(),
            $"bp_{browser.Name}_{Guid.NewGuid():N}.sqlite");

        try
        {
            File.Copy(profile.HistoryPath, tempPath, overwrite: true);
        }
        catch
        {
            // Browser holds an exclusive lock on the master file occasionally —
            // skip this tick rather than spam the log.
            return visits;
        }

        var stateKey = $"{browser.Name}|{profile.Name}";
        var since = _lastSeenMicros.TryGetValue(stateKey, out var prev) ? prev : 0L;
        var maxMicros = since;

        try
        {
            using var conn = new SqliteConnection(
                $"Data Source={tempPath};Mode=ReadOnly;Cache=Shared");
            conn.Open();
            using var cmd = conn.CreateCommand();
            // Firefox uses moz_places; everything else uses Chrome's urls.
            cmd.CommandText = browser.Family == BrowserFamily.Firefox
                ? "SELECT url, title, last_visit_date FROM moz_places WHERE last_visit_date > @since ORDER BY last_visit_date DESC LIMIT @limit"
                : "SELECT url, title, last_visit_time FROM urls WHERE last_visit_time > @since ORDER BY last_visit_time DESC LIMIT @limit";
            cmd.Parameters.AddWithValue("@since", since);
            cmd.Parameters.AddWithValue("@limit", MaxRowsPerProfile);

            using var reader = cmd.ExecuteReader();
            while (reader.Read())
            {
                var url = reader.IsDBNull(0) ? string.Empty : reader.GetString(0);
                if (string.IsNullOrWhiteSpace(url)) continue;
                var title = reader.IsDBNull(1) ? null : reader.GetString(1);
                var raw = reader.GetInt64(2);

                DateTime visitedAtUtc;
                long microsForState;
                if (browser.Family == BrowserFamily.Firefox)
                {
                    // Firefox: microseconds since Unix epoch.
                    visitedAtUtc = DateTimeOffset.FromUnixTimeMilliseconds(raw / 1000).UtcDateTime;
                    microsForState = raw;
                }
                else
                {
                    visitedAtUtc = WebKitEpoch.AddTicks(raw * 10); // micros → ticks (100ns)
                    microsForState = raw;
                }

                visits.Add(new BrowserVisit
                {
                    Url = url,
                    Title = title,
                    Browser = browser.Name,
                    Profile = profile.Name,
                    VisitedAtUtc = visitedAtUtc,
                });
                if (microsForState > maxMicros) maxMicros = microsForState;
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "SQLite read failed for {Browser}/{Profile}", browser.Name, profile.Name);
        }
        finally
        {
            try { File.Delete(tempPath); } catch { }
        }

        if (maxMicros > since)
        {
            _lastSeenMicros[stateKey] = maxMicros;
        }
        return visits;
    }

    private IEnumerable<BrowserDef> EnumerateBrowsers()
    {
        var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var roamingApp = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);

        yield return new BrowserDef("chrome", BrowserFamily.Chromium, Path.Combine(localApp, "Google", "Chrome", "User Data"));
        yield return new BrowserDef("edge", BrowserFamily.Chromium, Path.Combine(localApp, "Microsoft", "Edge", "User Data"));
        yield return new BrowserDef("brave", BrowserFamily.Chromium, Path.Combine(localApp, "BraveSoftware", "Brave-Browser", "User Data"));
        yield return new BrowserDef("yandex", BrowserFamily.Chromium, Path.Combine(localApp, "Yandex", "YandexBrowser", "User Data"));
        yield return new BrowserDef("vivaldi", BrowserFamily.Chromium, Path.Combine(localApp, "Vivaldi", "User Data"));
        // Opera lives under Roaming, not Local.
        yield return new BrowserDef("opera", BrowserFamily.OperaChromium, Path.Combine(roamingApp, "Opera Software", "Opera Stable"));
        yield return new BrowserDef("firefox", BrowserFamily.Firefox, Path.Combine(roamingApp, "Mozilla", "Firefox", "Profiles"));
    }

    private IEnumerable<ProfileDef> EnumerateProfiles(BrowserDef browser)
    {
        if (!Directory.Exists(browser.RootPath)) yield break;

        if (browser.Family == BrowserFamily.Firefox)
        {
            foreach (var dir in SafeEnumerateDirectories(browser.RootPath))
            {
                var historyPath = Path.Combine(dir, "places.sqlite");
                if (File.Exists(historyPath))
                {
                    yield return new ProfileDef(Path.GetFileName(dir), historyPath);
                }
            }
            yield break;
        }

        if (browser.Family == BrowserFamily.OperaChromium)
        {
            var historyPath = Path.Combine(browser.RootPath, "History");
            if (File.Exists(historyPath))
            {
                yield return new ProfileDef("Default", historyPath);
            }
            yield break;
        }

        // Chromium: read Local State to enumerate profiles, fall back to "Default".
        var profileNames = ReadChromiumProfileNames(browser.RootPath);
        if (profileNames.Count == 0) profileNames.Add("Default");

        foreach (var name in profileNames)
        {
            var historyPath = Path.Combine(browser.RootPath, name, "History");
            if (File.Exists(historyPath))
            {
                yield return new ProfileDef(name, historyPath);
            }
        }
    }

    private List<string> ReadChromiumProfileNames(string userDataPath)
    {
        var result = new List<string>();
        try
        {
            var localState = Path.Combine(userDataPath, "Local State");
            if (!File.Exists(localState)) return result;
            var json = File.ReadAllText(localState);
            var root = JObject.Parse(json);
            var infoCache = root["profile"]?["info_cache"] as JObject;
            if (infoCache == null) return result;
            foreach (var prop in infoCache.Properties())
            {
                result.Add(prop.Name);
            }
        }
        catch { }
        return result;
    }

    private static IEnumerable<string> SafeEnumerateDirectories(string root)
    {
        try { return Directory.EnumerateDirectories(root); }
        catch { return Array.Empty<string>(); }
    }

    private void LoadState()
    {
        try
        {
            if (!File.Exists(_statePath)) return;
            var raw = File.ReadAllText(_statePath);
            var dict = JsonConvert.DeserializeObject<Dictionary<string, long>>(raw);
            if (dict == null) return;
            foreach (var kv in dict)
            {
                if (kv.Value >= 0) _lastSeenMicros[kv.Key] = kv.Value;
            }
        }
        catch { }
    }

    private void SaveState()
    {
        try
        {
            File.WriteAllText(_statePath, JsonConvert.SerializeObject(_lastSeenMicros));
        }
        catch { }
    }

    private enum BrowserFamily
    {
        Chromium,
        OperaChromium,
        Firefox,
    }

    private sealed record BrowserDef(string Name, BrowserFamily Family, string RootPath);
    private sealed record ProfileDef(string Name, string HistoryPath);
}
