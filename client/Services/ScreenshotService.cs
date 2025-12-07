using System.Drawing;
using System.Drawing.Imaging;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;

namespace BelfProctor.Services;

public class ScreenshotService : IScreenshotService
{
    private readonly ILogger<ScreenshotService> _logger;
    private readonly ProctorSettings _settings;
    private readonly IDataTransmissionService _dataTransmissionService;

    public ScreenshotService(
        ILogger<ScreenshotService> logger,
        IOptions<ProctorSettings> settings,
        IDataTransmissionService dataTransmissionService)
    {
        _logger = logger;
        _settings = settings.Value;
        _dataTransmissionService = dataTransmissionService;
    }

    public async Task CaptureScreenshotAsync()
    {
        try
        {
            var filePath = await CaptureScreenshotToFileAsync();
            
            // Отправляем скриншот на сервер
            await _dataTransmissionService.SendScreenshotAsync(filePath);
            // Планируем удаление локального файла спустя заданное время
            _ = Task.Run(async () =>
            {
                try
                {
                    await Task.Delay(TimeSpan.FromMinutes(_settings.ScreenshotRetentionMinutes));
                    if (File.Exists(filePath))
                    {
                        File.Delete(filePath);
                        _logger.LogDebug("Screenshot deleted after retention: {FilePath}", filePath);
                    }
                }
                catch { }
            });
            
            // Очищаем старые скриншоты
            await CleanupOldScreenshotsAsync();
            
            _logger.LogDebug("Screenshot captured and sent: {FilePath}", filePath);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to capture screenshot");
        }
    }

    public async Task<string> CaptureScreenshotToFileAsync()
    {
        return await Task.Run(() =>
        {
            var bounds = GetScreenBounds();
            var basePath = Environment.ExpandEnvironmentVariables(_settings.ScreenshotPath);
            Directory.CreateDirectory(basePath);
            var cid = string.IsNullOrWhiteSpace(_settings.ClientId) ? "client" : new string(_settings.ClientId.Select(c => Array.IndexOf(Path.GetInvalidFileNameChars(), c) >= 0 ? '_' : c).ToArray());
            var fileName = $"screenshot_{cid}_{DateTime.Now:yyyyMMdd_HHmmss}.jpg";
            var filePath = Path.Combine(basePath, fileName);

            using var bitmap = new Bitmap(bounds.Width, bounds.Height);
            using var graphics = Graphics.FromImage(bitmap);
            
            graphics.CopyFromScreen(bounds.X, bounds.Y, 0, 0, bounds.Size);
            
            var encoderParameters = new EncoderParameters(1);
            encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, _settings.ScreenshotQuality);
            
            var jpegCodec = ImageCodecInfo.GetImageDecoders()
                .FirstOrDefault(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
            
            if (jpegCodec != null)
            {
                bitmap.Save(filePath, jpegCodec, encoderParameters);
            }
            else
            {
                bitmap.Save(filePath, ImageFormat.Jpeg);
            }

            return filePath;
        });
    }

    public async Task CleanupOldScreenshotsAsync()
    {
        await Task.Run(() =>
        {
            try
            {
                var cutoffDate = DateTime.Now.AddDays(-_settings.MaxScreenshotAge);
                var basePath = Environment.ExpandEnvironmentVariables(_settings.ScreenshotPath);
                var screenshotFiles = Directory.GetFiles(basePath, "screenshot_*.jpg");

                foreach (var file in screenshotFiles)
                {
                    var fileInfo = new FileInfo(file);
                    if (fileInfo.CreationTime < cutoffDate)
                    {
                        File.Delete(file);
                        _logger.LogDebug("Deleted old screenshot: {FilePath}", file);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cleanup old screenshots");
            }
        });
    }

    private Rectangle GetScreenBounds()
    {
        var vs = System.Windows.Forms.SystemInformation.VirtualScreen;
        return new Rectangle(vs.X, vs.Y, vs.Width, vs.Height);
    }
}