namespace BelfProctor.Models;

public class ProctorSettings
{
    public int ScreenshotInterval { get; set; } = 30000; // мс
    public int ScreenshotQuality { get; set; } = 85;
    public string ScreenshotPath { get; set; } = string.Empty;
    public string LogPath { get; set; } = string.Empty;
    public string ReportsPath { get; set; } = string.Empty;
    public string ServerUrl { get; set; } = string.Empty;
    public string ClientId { get; set; } = string.Empty;
    public string EncryptionKey { get; set; } = string.Empty;
    public bool MonitorUSB { get; set; } = true;
    public bool MonitorProcesses { get; set; } = true;
    public bool MonitorNetwork { get; set; } = true;
    public List<string> AllowedProcesses { get; set; } = new();
    public List<string> BlockedProcesses { get; set; } = new();
    public long MaxLogFileSize { get; set; } = 10485760; // 10MB
    public int MaxScreenshotAge { get; set; } = 7; // дни
    public int ScreenshotRetentionMinutes { get; set; } = 60; // минуты, удалять локальный файл после отправки
    public List<string> TelegramAllowedChats { get; set; } = new();
    public int TelegramCheckIntervalSeconds { get; set; } = 2;
    public bool TelegramAutoCloseDisallowed { get; set; } = true;
    public int HeartbeatInterval { get; set; } = 60000; // мс
    public int PolicyUpdateInterval { get; set; } = 300000; // мс
    public int DirectoryListingInterval { get; set; } = 600000; // мс
    public List<string> DirectoryRoots { get; set; } = new();
    public string AdminPasswordHash { get; set; } = string.Empty;
}