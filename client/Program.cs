using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using BelfProctor.Services;
using BelfProctor.Models;

namespace BelfProctor;

public class Program
{
    public static async Task Main(string[] args)
    {
        var builder = Host.CreateApplicationBuilder(args);
        
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

        var host = builder.Build();
        await host.RunAsync();
    }
}