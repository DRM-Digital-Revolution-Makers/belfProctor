using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using BelfProctor.Services;
using BelfProctor.Models;
using System.Windows.Forms;
using Microsoft.Extensions.Options;

namespace BelfProctor;

public class Program
{
    public static async Task Main(string[] args)
    {
        // Immediate debug logging to verify process start
        try 
        {
            var debugDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemWorker");
            if (!Directory.Exists(debugDir)) Directory.CreateDirectory(debugDir);
            File.AppendAllText(Path.Combine(debugDir, "startup_log.txt"), $"{DateTime.Now}: Process started. Args: {string.Join(" ", args)}\n");
        }
        catch { }

        try
        {
            // Mutex to prevent multiple instances
            using var mutex = new Mutex(false, "Global\\BelfProctorSystemWorker", out bool createdNew);
            if (!createdNew)
            {
                // If auto-start, log and exit
                if (args.Contains("--auto-start")) 
                {
                    try { File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemWorker", "startup_log.txt"), $"{DateTime.Now}: Exiting - Instance already running.\n"); } catch { }
                    return;
                }
                
                if (args.Contains("--config-ui"))
                {
                    MessageBox.Show("Another instance is running.", "Already Running");
                    return;
                }
                var res = MessageBox.Show("The monitoring agent is already running.\n\nDo you want to configure settings?", "Already Running", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (res != DialogResult.Yes) return;
            }

            // Fix for running from Registry/Startup where CWD might be System32
            var baseDir = AppContext.BaseDirectory;
            Directory.SetCurrentDirectory(baseDir);
            
            try { File.AppendAllText(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemWorker", "startup_log.txt"), $"{DateTime.Now}: BaseDir set to {baseDir}\n"); } catch { }

            var builder = Host.CreateApplicationBuilder(args);
            
            // Ensure AppData directory exists
            var localAppData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemWorker");
            if (!Directory.Exists(localAppData)) Directory.CreateDirectory(localAppData);
            
            var appDataConfig = Path.Combine(localAppData, "appsettings.json");
            var baseConfig = Path.Combine(baseDir, "appsettings.json");

            // Explicitly load config from BaseDirectory and AppData
            builder.Configuration.SetBasePath(baseDir);
            builder.Configuration.AddJsonFile(baseConfig, optional: true, reloadOnChange: true);
            builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);

            builder.Services.AddWindowsService(options => options.ServiceName = "BelfProctor");
            
            var tempConfig = builder.Configuration.GetSection("ProctorSettings").Get<ProctorSettings>() ?? new ProctorSettings();
            
            bool isAutoStart = args.Contains("--auto-start");
            bool needsConfig = string.IsNullOrWhiteSpace(tempConfig.ClientId) || 
                               string.IsNullOrWhiteSpace(tempConfig.ServerUrl) || 
                               args.Contains("--config-ui");

            // If running manually (not auto-start) AND not installed (e.g. from Downloads),
            // FORCE UI to allow installation/registration.
            // Also force UI if running manually and installed, because user probably wants to reconfigure.
            // Basically: Manual run -> Always Show UI.
            // Auto-start -> Run Silent.
            if (!isAutoStart)
            {
                needsConfig = true;
            }

            // Log config status
            try { File.AppendAllText(Path.Combine(localAppData, "startup_log.txt"), $"{DateTime.Now}: AutoStart={isAutoStart}, NeedsConfig={needsConfig}, ClientId={tempConfig.ClientId}\n"); } catch { }

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
                var services = new ServiceCollection();
                services.Configure<ProctorSettings>(cfg.GetSection("ProctorSettings"));
                using var sp = services.BuildServiceProvider();
                var opts = sp.GetRequiredService<IOptions<ProctorSettings>>();
                
                var savePaths = new[] { appDataConfig, baseConfig };
                Application.Run(new UI.SettingsForm(cfg, opts.Value, savePaths));
                return; // Exit after config
            }

            // Final check before running services
            builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);
            
            builder.Services.Configure<ProctorSettings>(builder.Configuration.GetSection("ProctorSettings"));
            builder.Services.AddSingleton<IScreenshotService, ScreenshotService>();
            builder.Services.AddSingleton<ISystemMonitorService, SystemMonitorService>();
            builder.Services.AddSingleton<IActivityMonitorService, ActivityMonitorService>();
            builder.Services.AddSingleton<IDataTransmissionService, DataTransmissionService>();
            builder.Services.AddSingleton<IPolicyService, PolicyService>();
            builder.Services.AddSingleton<IReportingService, ReportingService>();
            builder.Services.AddSingleton<IStabilityService, StabilityService>();
            builder.Services.AddSingleton<CommandHandler>();
            
            builder.Services.AddHostedService<ProctorWorker>();
            builder.Services.AddHostedService<CommandChannelWorker>();

            builder.Services.AddLogging(logging =>
            {
                logging.AddConsole();
                logging.AddEventLog();
            });

            var host = builder.Build();
            await host.RunAsync();
        }
        catch (Exception ex)
        {
            try
            {
                var logPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemWorker", "crash_log.txt");
                File.AppendAllText(logPath, $"{DateTime.Now}: Critical Crash: {ex}\n");
            }
            catch { }
        }
    }
}