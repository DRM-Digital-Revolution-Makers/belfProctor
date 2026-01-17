using System.Drawing;
using System.Drawing.Imaging;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using System.Runtime.InteropServices;
using System.IO;

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
        EnsureDpiAwareness();
    }

    public async Task CaptureScreenshotAsync()
    {
        try
        {
            var filePath = await CaptureScreenshotToFileAsync();
            
            // Отправляем скриншот на сервер
            // DataTransmissionService сам решит, удалить файл или переместить в Pending
            await _dataTransmissionService.SendScreenshotAsync(filePath);
            
            // Очищаем старые скриншоты
            await CleanupOldScreenshotsAsync();
            
            _logger.LogDebug("Screenshot captured: {FilePath}", filePath);
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
            foreach (var screen in System.Windows.Forms.Screen.AllScreens)
            {
                var destX = screen.Bounds.X - bounds.X;
                var destY = screen.Bounds.Y - bounds.Y;
                graphics.CopyFromScreen(screen.Bounds.X, screen.Bounds.Y, destX, destY, screen.Bounds.Size);
            }
            
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
                
                // Очищаем только основную папку скриншотов, не трогая Pending
                var screenshotFiles = Directory.GetFiles(basePath, "screenshot_*.jpg", SearchOption.TopDirectoryOnly);

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
        return new Rectangle(vs.Left, vs.Top, vs.Width, vs.Height);
    }

    private static bool _dpiSet = false;
    private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new IntPtr(-4);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);
    private enum PROCESS_DPI_AWARENESS
    {
        PROCESS_DPI_UNAWARE = 0,
        PROCESS_SYSTEM_DPI_AWARE = 1,
        PROCESS_PER_MONITOR_DPI_AWARE = 2
    }
    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(PROCESS_DPI_AWARENESS value);
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();
    private static void EnsureDpiAwareness()
    {
        if (_dpiSet) return;
        try { if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) { _dpiSet = true; return; } } catch { }
        try { if (SetProcessDpiAwareness(PROCESS_DPI_AWARENESS.PROCESS_PER_MONITOR_DPI_AWARE) == 0) { _dpiSet = true; return; } } catch { }
        try { if (SetProcessDPIAware()) { _dpiSet = true; return; } } catch { }
    }
}
