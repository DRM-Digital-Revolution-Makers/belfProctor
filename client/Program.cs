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
        var builder = Host.CreateApplicationBuilder(args);

        var environment = builder.Environment.EnvironmentName;
        
        // Ensure AppData directory exists for persistent config
        var localAppData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor");
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
        bool needsConfig = string.IsNullOrWhiteSpace(tempConfig.ClientId) || 
                           string.IsNullOrWhiteSpace(tempConfig.ServerUrl) || 
                           args.Contains("--config-ui");

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
            
            // If valid now, we must restart the builder/host construction to pick up new values cleanly 
            // OR just let the original builder continue if we reload. 
            // Simplest is to let original builder continue but we must ensure it reads latest file.
            // But builder.Configuration was already built. 
            // So better to just exit and expect restart (since SettingsForm says "Application will restart/continue")
            // BUT for user experience, let's try to proceed if we can reload.
            // Actually, "Host.CreateApplicationBuilder" loads config at start. 
            // We should reload it.
            ((IConfigurationRoot)builder.Configuration).Reload();
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

        if (args.Contains("--config-ui"))
        {
            Application.SetHighDpiMode(HighDpiMode.SystemAware);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var cfg = builder.Configuration;
            var services = new ServiceCollection();
            services.Configure<ProctorSettings>(cfg.GetSection("ProctorSettings"));
            using var sp = services.BuildServiceProvider();
            var opts = sp.GetRequiredService<IOptions<ProctorSettings>>();
            Application.Run(new UI.SettingsForm(cfg, opts.Value, new[]
            {
                Path.Combine(builder.Environment.ContentRootPath, "client", "appsettings.json"),
                Path.Combine(builder.Environment.ContentRootPath, "client", $"appsettings.{builder.Environment.EnvironmentName}.json"),
                Path.Combine(builder.Environment.ContentRootPath, "appsettings.json"),
                Path.Combine(builder.Environment.ContentRootPath, $"appsettings.{builder.Environment.EnvironmentName}.json")
            }));
            return;
        }

        var host = builder.Build();
        await host.RunAsync();
    }
}