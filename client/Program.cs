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
        var possibleConfigs = new[]
        {
            Path.Combine(builder.Environment.ContentRootPath, "client", "appsettings.json"),
            Path.Combine(builder.Environment.ContentRootPath, "client", $"appsettings.{environment}.json"),
            Path.Combine(builder.Environment.ContentRootPath, "appsettings.json"),
            Path.Combine(builder.Environment.ContentRootPath, $"appsettings.{environment}.json")
        };

        foreach (var cfg in possibleConfigs)
        {
            if (File.Exists(cfg))
            {
                builder.Configuration.AddJsonFile(cfg, optional: true, reloadOnChange: true);
            }
        }
        
        // Настройка для работы как служба Windows
        builder.Services.AddWindowsService(options =>
        {
            options.ServiceName = "BelfProctor";
        });

        // Регистрация сервисов
        builder.Services.Configure<ProctorSettings>(
            builder.Configuration.GetSection("ProctorSettings"));
        
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