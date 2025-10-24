namespace BelfProctor.Services;

public interface IScreenshotService
{
    Task CaptureScreenshotAsync();
    Task<string> CaptureScreenshotToFileAsync();
    Task CleanupOldScreenshotsAsync();
}