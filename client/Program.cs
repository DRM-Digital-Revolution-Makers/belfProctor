using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using BelfProctor.Services;
using BelfProctor.Models;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Extensions.Options;
using System.Globalization;
using System.IO;
using BelfProctor.Services.WorkTracking;

namespace BelfProctor;

public class Program
{
    public static async Task Main(string[] args)
    {
        // Release-builder probe: prove that the trust anchor was embedded in
        // this exact single-file executable. No host, UI or configuration is
        // initialized in this mode.
        var signerProbeIndex = Array.IndexOf(args, "--verify-embedded-signer");
        if (signerProbeIndex >= 0)
        {
            var expected = signerProbeIndex + 1 < args.Length
                ? args[signerProbeIndex + 1].Replace(" ", string.Empty).ToUpperInvariant()
                : string.Empty;
            var actual = UpdateHelper.ResolveTrustedSignerThumbprint(string.Empty);
            Environment.ExitCode = expected.Length == 40 && actual == expected ? 0 : 41;
            return;
        }

        // Set DPI awareness before any WinForms/Screen API is touched. This is
        // required for physical-pixel multi-monitor bounds when displays use
        // different scaling factors.
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);

        var captureEvidenceIndex = Array.IndexOf(args, "--capture-desktop-evidence");
        if (captureEvidenceIndex >= 0)
        {
            if (captureEvidenceIndex + 1 >= args.Length ||
                !Path.IsPathFullyQualified(args[captureEvidenceIndex + 1]))
            {
                Environment.ExitCode = 42;
                return;
            }
            try
            {
                ScreenshotService.CaptureDesktopEvidence(args[captureEvidenceIndex + 1], 90L);
                Environment.ExitCode = 0;
            }
            catch
            {
                Environment.ExitCode = 43;
            }
            return;
        }

        // Immediate debug logging to verify process start
        try
        {
            var debugDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
            if (!Directory.Exists(debugDir)) Directory.CreateDirectory(debugDir);
            File.AppendAllText(Path.Combine(debugDir, "startup_log.txt"), $"{DateTime.Now}: Process started. Args: {string.Join(" ", args)}\n");
        }
        catch { }

        // Services run in Session 0 and cannot capture a user's desktop. SCM
        // therefore hosts only a lightweight supervisor; the actual monitoring
        // worker runs from an interactive scheduled task in the logged-on session.
        if (args.Contains("--service-host"))
        {
            var serviceHost = Host.CreateDefaultBuilder(args)
                .UseWindowsService(options => options.ServiceName = ServiceInstaller.ServiceName)
                .ConfigureServices(services => services.AddHostedService<DesktopAgentSupervisor>())
                .Build();
            await serviceHost.RunAsync();
            return;
        }

        // Deliberately refuse the legacy self-install path. Registering the
        // current executable could point SYSTEM/Highest at a user-writable
        // directory. Deployment must go through the signed administrative
        // installer, which stages into a protected installation root.
        if (args.Contains("--install-service"))
        {
            MessageBox.Show(
                "Self-installation is disabled for security. Run the signed BelfProctor installer as Administrator.",
                "BelfProctor installation",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Environment.ExitCode = 44;
            return;
        }

        try
        {
            // Mutex to prevent multiple instances.
            // Global\ requires SeCreateGlobalPrivilege — services have it, but
            // a non-admin user-mode launch (HKCU\Run, double-click) does not and
            // gets UnauthorizedAccessException. Fall back to a session-local
            // mutex in that case so the agent still runs.
            Mutex? mutex = null;
            bool createdNew = true;
            try
            {
                mutex = new Mutex(false, "Global\\BelfProctor", out createdNew);
            }
            catch (UnauthorizedAccessException)
            {
                try { mutex = new Mutex(false, "Local\\BelfProctor", out createdNew); }
                catch { mutex = null; createdNew = true; }
            }
            catch (Exception)
            {
                mutex = null;
                createdNew = true;
            }
            using var _mutexGuard = mutex;

            bool showConfigUi = false;
            if (!createdNew)
            {
                if (args.Contains("--auto-start"))
                {
                    try { File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor", "startup_log.txt"), $"{DateTime.Now}: Exiting - Instance already running.\n"); } catch { }
                    return;
                }

                if (args.Contains("--config-ui"))
                {
                    MessageBox.Show("Another instance is running.", "Already Running");
                    return;
                }
                var res = MessageBox.Show("The monitoring agent is already running.\n\nDo you want to configure settings?", "Already Running", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (res != DialogResult.Yes) return;
                // User said Yes — open settings form only, don't start a second worker
                showConfigUi = true;
            }

            // Fix for running from Registry/Startup where CWD might be System32
            var baseDir = AppContext.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);
            
            try { File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor", "startup_log.txt"), $"{DateTime.Now}: BaseDir set to {baseDir}\n"); } catch { }

            var builder = Host.CreateApplicationBuilder(args);
            
            // Ensure AppData directory exists
            var localAppData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
            if (!Directory.Exists(localAppData)) Directory.CreateDirectory(localAppData);
            
            var appDataConfig = Path.Combine(localAppData, "appsettings.json");
            var baseConfig = Path.Combine(baseDir, "appsettings.json");

            // Explicitly load config from BaseDirectory and AppData
            builder.Configuration.SetBasePath(baseDir);
            builder.Configuration.AddJsonFile(baseConfig, optional: true, reloadOnChange: true);
#if DEBUG
            // Portable developer builds may keep a per-user override. Release
            // builds intentionally trust only the installer-protected file
            // beside the executable, because the worker runs at High integrity.
            builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);
#endif

            builder.Services.AddWindowsService(options => options.ServiceName = "BelfProctor");
            
            var section = builder.Configuration.GetSection("ProctorSettings");
            var clientIdStr = section["ClientId"] ?? string.Empty;
            var serverUrlStr = section["ServerUrl"] ?? string.Empty;
            var encryptionKeyStr = section["EncryptionKey"] ?? string.Empty;
            var allowInsecureTransport = bool.TryParse(section["AllowInsecureDevelopmentTransport"], out var insecureTransport) && insecureTransport;
            var validServerTransport = Uri.TryCreate(serverUrlStr, UriKind.Absolute, out var configuredServerUri) &&
                                       (configuredServerUri.Scheme == Uri.UriSchemeHttps || allowInsecureTransport);
            var validDeviceCredential = encryptionKeyStr.Length >= 32 &&
                                        !encryptionKeyStr.Contains("PROVISION_", StringComparison.OrdinalIgnoreCase) &&
                                        !string.Equals(encryptionKeyStr, "ABCDEFGHIJKLMNOP", StringComparison.Ordinal);
            var signerThumbprint = UpdateHelper.ResolveTrustedSignerThumbprint(
                section["TrustedUpdateSignerThumbprint"] ?? string.Empty);
            var updateV2Enabled = !bool.TryParse(section["Features:UpdateV2"], out var configuredUpdateV2) || configuredUpdateV2;
            var validUpdateTrust = !updateV2Enabled ||
                                   (signerThumbprint.Length == 40 && signerThumbprint.All(Uri.IsHexDigit));
            
            bool isAutoStart = args.Contains("--auto-start");
            bool needsConfig = showConfigUi ||
                               string.IsNullOrWhiteSpace(clientIdStr) ||
                               string.IsNullOrWhiteSpace(serverUrlStr) ||
                               clientIdStr.Contains("PROVISION_", StringComparison.OrdinalIgnoreCase) ||
                               !validServerTransport ||
                               !validDeviceCredential ||
                               !validUpdateTrust ||
                               args.Contains("--config-ui");

            // Log config status
            try { File.AppendAllText(Path.Combine(localAppData, "startup_log.txt"), $"{DateTime.Now}: AutoStart={isAutoStart}, NeedsConfig={needsConfig}, ClientId={clientIdStr}\n"); } catch { }

            // Sanitize numeric values that may be stored as "300000.0" strings
            var overrides = new Dictionary<string, string?>();
            void SanitizeInt(string name, int fallback)
            {
                var raw = section[name];
                if (string.IsNullOrWhiteSpace(raw))
                {
                    overrides[$"ProctorSettings:{name}"] = fallback.ToString(CultureInfo.InvariantCulture);
                    return;
                }
                var s = raw.Trim();
                if (s.EndsWith(".0")) s = s.Substring(0, s.Length - 2);
                if (!int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var iv))
                {
                    iv = fallback;
                }
                overrides[$"ProctorSettings:{name}"] = iv.ToString(CultureInfo.InvariantCulture);
            }
            SanitizeInt("ScreenshotIntervalMs", 300000);
            SanitizeInt("ScreenshotQuality", 75);
            SanitizeInt("HeartbeatIntervalMs", 60000);
            SanitizeInt("PolicyUpdateIntervalMs", 300000);
            SanitizeInt("DirectoryListingIntervalMs", 600000);
            SanitizeInt("MaxScreenshotAge", 7);
            SanitizeInt("ScreenshotRetentionMinutes", 60);
            SanitizeInt("InactivityThresholdMinutes", 3);
            if (overrides.Count > 0)
            {
                builder.Configuration.AddInMemoryCollection(overrides);
            }
            int GetOverride(string key, int fallback) =>
                overrides.TryGetValue(key, out var s) && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var v) ? v : fallback;

            FeatureSettings ReadFeatures(IConfigurationSection parent)
            {
                var features = parent.GetSection("Features");
                bool GetFeature(string key, bool fallback)
                {
                    var raw = features[key];
                    return bool.TryParse(raw, out var parsed) ? parsed : fallback;
                }
                return new FeatureSettings
                {
                    UpdateV2 = GetFeature("UpdateV2", true),
                    WorkTracking = GetFeature("WorkTracking", true),
                    ProjectMapping = GetFeature("ProjectMapping", true),
                    LiveView = GetFeature("LiveView", true),
                    RulesClassifier = GetFeature("RulesClassifier", true),
                    BrowserActivity = GetFeature("BrowserActivity", false),
                };
            }

            // If auto-start and config missing, we can't run.
            if (isAutoStart && needsConfig)
            {
                 // Log why we are exiting
                 File.AppendAllText(Path.Combine(localAppData, "startup_log.txt"), $"{DateTime.Now}: Auto-start failed. Missing config. BaseDir: {baseDir}\n");
                 return;
            }

            if (needsConfig)
            {
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                
                var cfg = builder.Configuration;
                var safeSettings = new ProctorSettings
                {
                    ClientId = clientIdStr,
                    ServerUrl = serverUrlStr,
                    ScreenshotIntervalMs = GetOverride("ProctorSettings:ScreenshotIntervalMs", 300000),
                    ScreenshotQuality = GetOverride("ProctorSettings:ScreenshotQuality", 75),
                    HeartbeatIntervalMs = GetOverride("ProctorSettings:HeartbeatIntervalMs", 60000),
                    PolicyUpdateIntervalMs = GetOverride("ProctorSettings:PolicyUpdateIntervalMs", 300000),
                    DirectoryListingIntervalMs = GetOverride("ProctorSettings:DirectoryListingIntervalMs", 600000),
                    MaxScreenshotAge = GetOverride("ProctorSettings:MaxScreenshotAge", 7),
                    ScreenshotRetentionMinutes = GetOverride("ProctorSettings:ScreenshotRetentionMinutes", 60),
                    InactivityThresholdMinutes = GetOverride("ProctorSettings:InactivityThresholdMinutes", 3),
                    EncryptionKey = section["EncryptionKey"] ?? string.Empty,
                    AllowInsecureDevelopmentTransport = allowInsecureTransport,
                    TrustedUpdateSignerThumbprint = signerThumbprint,
                    ScreenshotPath = section["ScreenshotPath"] ?? string.Empty,
                    LogPath = section["LogPath"] ?? string.Empty,
                    ReportsPath = section["ReportsPath"] ?? string.Empty,
                    MonitorUSB = bool.TryParse(section["MonitorUSB"], out var usbVal1) ? usbVal1 : true,
                    MonitorProcesses = bool.TryParse(section["MonitorProcesses"], out var procVal1) ? procVal1 : true,
                    MonitorNetwork = bool.TryParse(section["MonitorNetwork"], out var netVal1) ? netVal1 : true,
                    RunOnStartup = bool.TryParse(section["RunOnStartup"], out var runVal1) ? runVal1 : true,
                    Features = ReadFeatures(section),
                };
                
                var savePaths = new[] {
#if DEBUG
                    appDataConfig
#else
                    baseConfig
#endif
                };
                Application.Run(new UI.SettingsForm(cfg, safeSettings, savePaths));
                return; // Exit after config
            }

            // Final check before running services. Keep Release configuration
            // anchored in the protected install directory.
#if DEBUG
            builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);
#endif

            // Build strongly-typed sanitized settings to avoid binder Int32 failures on "300000.0"
            var sanitizedSection = builder.Configuration.GetSection("ProctorSettings");
            var settings = new ProctorSettings
            {
                ClientId = sanitizedSection["ClientId"] ?? string.Empty,
                ServerUrl = sanitizedSection["ServerUrl"] ?? string.Empty,
                ScreenshotIntervalMs = GetOverride("ProctorSettings:ScreenshotIntervalMs", 300000),
                ScreenshotQuality = GetOverride("ProctorSettings:ScreenshotQuality", 75),
                HeartbeatIntervalMs = GetOverride("ProctorSettings:HeartbeatIntervalMs", 60000),
                PolicyUpdateIntervalMs = GetOverride("ProctorSettings:PolicyUpdateIntervalMs", 300000),
                DirectoryListingIntervalMs = GetOverride("ProctorSettings:DirectoryListingIntervalMs", 600000),
                MaxScreenshotAge = GetOverride("ProctorSettings:MaxScreenshotAge", 7),
                ScreenshotRetentionMinutes = GetOverride("ProctorSettings:ScreenshotRetentionMinutes", 60),
                InactivityThresholdMinutes = GetOverride("ProctorSettings:InactivityThresholdMinutes", 3),
                EncryptionKey = sanitizedSection["EncryptionKey"] ?? string.Empty,
                AllowInsecureDevelopmentTransport = allowInsecureTransport,
                TrustedUpdateSignerThumbprint = signerThumbprint,
                ScreenshotPath = sanitizedSection["ScreenshotPath"] ?? string.Empty,
                LogPath = sanitizedSection["LogPath"] ?? string.Empty,
                ReportsPath = sanitizedSection["ReportsPath"] ?? string.Empty,
                MonitorUSB = bool.TryParse(sanitizedSection["MonitorUSB"], out var usbVal2) ? usbVal2 : true,
                MonitorProcesses = bool.TryParse(sanitizedSection["MonitorProcesses"], out var procVal2) ? procVal2 : true,
                MonitorNetwork = bool.TryParse(sanitizedSection["MonitorNetwork"], out var netVal2) ? netVal2 : true,
                RunOnStartup = bool.TryParse(sanitizedSection["RunOnStartup"], out var runVal2) ? runVal2 : true,
                Features = ReadFeatures(sanitizedSection),
            };
            builder.Services.AddSingleton<IOptions<ProctorSettings>>(Options.Create(settings));

            builder.Services.AddSingleton<IScreenshotService, ScreenshotService>();
            builder.Services.AddSingleton<ISystemMonitorService, SystemMonitorService>();
            builder.Services.AddSingleton<IActivityMonitorService, ActivityMonitorService>();
            builder.Services.AddSingleton<IDataTransmissionService, DataTransmissionService>();
            builder.Services.AddSingleton<IPolicyService, PolicyService>();
            builder.Services.AddSingleton<IReportingService, ReportingService>();
            builder.Services.AddSingleton<IStabilityService, StabilityService>();
            builder.Services.AddSingleton<StreamingService>();
            builder.Services.AddSingleton<CommandHandler>();
            
            builder.Services.AddHostedService<ProctorWorker>();
            builder.Services.AddHostedService<WorkTrackingService>();
            builder.Services.AddHostedService<CommandChannelWorker>();
            builder.Services.AddHostedService<ClientLogUploadWorker>();
            builder.Services.AddHostedService<PcSessionService>();
            builder.Services.AddHostedService<BrowserActivityService>();

            var fileLoggerProvider = new RollingFileLoggerProvider(Options.Create(settings));
            builder.Services.AddLogging(logging =>
            {
                logging.AddConsole();
                logging.AddEventLog();
                logging.AddProvider(fileLoggerProvider);
            });

            var host = builder.Build();
            await host.RunAsync();
        }
        catch (Exception ex)
        {
            try
            {
                var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor", "crash_log.txt");
                File.AppendAllText(logPath, $"{DateTime.Now}: Critical Crash: {ex}\n");
            }
            catch { }
        }
    }

}
