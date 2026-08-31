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
using System.Text;
using Microsoft.Win32;
using BelfProctor.Services.WorkTracking;

namespace BelfProctor;

public class Program
{
    public static async Task Main(string[] args)
    {
        // Immediate debug logging to verify process start
        try
        {
            var debugDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
            if (!Directory.Exists(debugDir)) Directory.CreateDirectory(debugDir);
            File.AppendAllText(Path.Combine(debugDir, "startup_log.txt"), $"{DateTime.Now}: Process started. Args: {string.Join(" ", args)}\n");
        }
        catch { }

        // Elevation handoff: when the unprivileged process needs to install the
        // service it relaunches itself with this arg under UAC. Do the install
        // and exit — the freshly-created service will start the worker.
        if (args.Contains("--install-service"))
        {
            try
            {
                using var currentProc = Process.GetCurrentProcess();
                var exePath = currentProc.MainModule?.FileName
                    ?? Path.Combine(AppContext.BaseDirectory, "BelfProctor.exe");
                ServiceInstaller.EnsureInstalled(exePath);
            }
            catch (Exception ex)
            {
                try { File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor", "startup_log.txt"), $"{DateTime.Now}: --install-service failed: {ex.Message}\n"); } catch { }
            }
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
                mutex = new Mutex(false, "Global\\Microsoft One Drive", out createdNew);
            }
            catch (UnauthorizedAccessException)
            {
                try { mutex = new Mutex(false, "Local\\Microsoft One Drive", out createdNew); }
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
            builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);

            builder.Services.AddWindowsService(options => options.ServiceName = "Microsoft One Drive");
            
            var section = builder.Configuration.GetSection("ProctorSettings");
            var clientIdStr = section["ClientId"] ?? string.Empty;
            var serverUrlStr = section["ServerUrl"] ?? string.Empty;
            
            bool isAutoStart = args.Contains("--auto-start");
            bool needsConfig = showConfigUi ||
                               string.IsNullOrWhiteSpace(clientIdStr) ||
                               string.IsNullOrWhiteSpace(serverUrlStr) ||
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
                Application.SetHighDpiMode(HighDpiMode.SystemAware);
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
                    ScreenshotPath = section["ScreenshotPath"] ?? string.Empty,
                    LogPath = section["LogPath"] ?? string.Empty,
                    ReportsPath = section["ReportsPath"] ?? string.Empty,
                    MonitorUSB = bool.TryParse(section["MonitorUSB"], out var usbVal1) ? usbVal1 : true,
                    MonitorProcesses = bool.TryParse(section["MonitorProcesses"], out var procVal1) ? procVal1 : true,
                    MonitorNetwork = bool.TryParse(section["MonitorNetwork"], out var netVal1) ? netVal1 : true,
                    RunOnStartup = bool.TryParse(section["RunOnStartup"], out var runVal1) ? runVal1 : true,
                    Features = ReadFeatures(section),
                };
                
                var savePaths = new[] { appDataConfig, baseConfig };
                Application.Run(new UI.SettingsForm(cfg, safeSettings, savePaths));
                return; // Exit after config
            }

            // Final check before running services
            builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);

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

            EnsureAutoStart();
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

    private static void EnsureAutoStart()
    {
        try
        {
            using var proc = Process.GetCurrentProcess();
            var exePath = proc.MainModule?.FileName;
            if (string.IsNullOrWhiteSpace(exePath) || !File.Exists(exePath)) return;

            var exeName = Path.GetFileNameWithoutExtension(exePath);

            // 1. Registry Run key — запуск при входе пользователя
            using var runKey = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", writable: true);
            runKey?.SetValue("BelfProctor", $"\"{exePath}\" --auto-start");

            // 2. Watchdog через лёгкий PowerShell-скрипт каждые 3 минуты.
            // PowerShell стартует в ~200мс и ~20МБ, не запускает полный .NET exe зря.
            // Скрипт проверяет: если процесс не запущен — запускает exe.
            var watchdogDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
            Directory.CreateDirectory(watchdogDir);
            var watchdogScript = Path.Combine(watchdogDir, "watchdog.ps1");

            File.WriteAllText(watchdogScript,
                $"if (-not (Get-Process -Name '{exeName}' -ErrorAction SilentlyContinue)) {{\r\n" +
                $"    Start-Process -FilePath '{exePath}' -ArgumentList '--auto-start' -WindowStyle Hidden\r\n" +
                $"}}\r\n",
                Encoding.UTF8);

            const string taskName = "BelfProctor";
            var xml = $@"<?xml version=""1.0"" encoding=""UTF-16""?>
<Task version=""1.2"" xmlns=""http://schemas.microsoft.com/windows/2004/02/mit/task"">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT3M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
  </Triggers>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT1M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context=""Author"">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{watchdogScript}""</Arguments>
    </Exec>
  </Actions>
</Task>";

            var xmlPath = Path.Combine(Path.GetTempPath(), "bp_task.xml");
            File.WriteAllText(xmlPath, xml, Encoding.Unicode);

            var psi = new ProcessStartInfo("schtasks.exe",
                $"/Create /F /TN \"{taskName}\" /XML \"{xmlPath}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var p = Process.Start(psi);
            p?.WaitForExit(10000);

            try { File.Delete(xmlPath); } catch { }
        }
        catch { }
    }
}
