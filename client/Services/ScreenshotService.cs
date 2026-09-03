using System.Drawing;
using System.Drawing.Imaging;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;
using System.Runtime.InteropServices;
using System.IO;
using System.ComponentModel;
using System.Text.Json;

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

            using var bitmap = CaptureVirtualDesktop(bounds);
            SaveJpeg(bitmap, filePath, _settings.ScreenshotQuality);

            return filePath;
        });
    }

    internal static bool IsUniformFrame(Bitmap bitmap)
    {
        int? first = null;
        var stepX = Math.Max(1, bitmap.Width / 20);
        var stepY = Math.Max(1, bitmap.Height / 20);
        for (var x = 0; x < bitmap.Width; x += stepX)
        for (var y = 0; y < bitmap.Height; y += stepY)
        {
            var color = bitmap.GetPixel(x, y).ToArgb();
            if (first == null) first = color;
            else if (first.Value != color) return false;
        }
        return true;
    }

    public static void CaptureDesktopEvidence(string outputPath, long quality)
    {
        if (!Path.IsPathFullyQualified(outputPath))
            throw new ArgumentException("Evidence path must be absolute.", nameof(outputPath));
        EnsureDpiAwareness();
        var bounds = GetScreenBounds();
        Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
        using var bitmap = CaptureVirtualDesktop(bounds);
        SaveJpeg(bitmap, outputPath, quality);

        var metadata = new
        {
            capturedAtUtc = DateTime.UtcNow,
            image = new { width = bitmap.Width, height = bitmap.Height },
            virtualScreen = new { bounds.X, bounds.Y, bounds.Width, bounds.Height },
            screens = System.Windows.Forms.Screen.AllScreens.Select(screen => new
            {
                deviceName = screen.DeviceName,
                primary = screen.Primary,
                x = screen.Bounds.X,
                y = screen.Bounds.Y,
                width = screen.Bounds.Width,
                height = screen.Bounds.Height
            }).ToArray()
        };
        File.WriteAllText(Path.ChangeExtension(outputPath, ".json"),
            JsonSerializer.Serialize(metadata, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static Bitmap CaptureVirtualDesktop(Rectangle bounds)
    {
        var bitmap = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        try
        {
            using var graphics = Graphics.FromImage(bitmap);
            try
            {
                foreach (var screen in System.Windows.Forms.Screen.AllScreens)
                {
                    graphics.CopyFromScreen(
                        screen.Bounds.X,
                        screen.Bounds.Y,
                        screen.Bounds.X - bounds.X,
                        screen.Bounds.Y - bounds.Y,
                        screen.Bounds.Size,
                        CopyPixelOperation.SourceCopy);
                }
            }
            catch (Win32Exception ex)
            {
                throw new InvalidOperationException(
                    "Interactive desktop capture is unavailable. The monitoring worker must run in a logged-on user session.", ex);
            }

            if (IsUniformFrame(bitmap))
                throw new InvalidOperationException("Desktop capture produced a uniform/blank frame; refusing to upload it.");
            return bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }

    private static void SaveJpeg(Bitmap bitmap, string filePath, long quality)
    {
        using var encoderParameters = new EncoderParameters(1);
        encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, Math.Clamp(quality, 1L, 100L));
        var jpegCodec = ImageCodecInfo.GetImageDecoders()
            .FirstOrDefault(codec => codec.FormatID == ImageFormat.Jpeg.Guid);
        using var output = new FileStream(filePath, FileMode.Create, FileAccess.Write, FileShare.None);
        if (jpegCodec != null) bitmap.Save(output, jpegCodec, encoderParameters);
        else bitmap.Save(output, ImageFormat.Jpeg);
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

    private static Rectangle GetScreenBounds()
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
