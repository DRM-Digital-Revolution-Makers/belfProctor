using System.IO;
using System.Globalization;
using System.Text;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using BelfProctor.Models;

namespace BelfProctor.Services;

public class RollingFileLoggerProvider : ILoggerProvider
{
    private readonly string _dir;
    private readonly object _lock = new();
    private bool _disposed;

    public RollingFileLoggerProvider(IOptions<ProctorSettings> settings)
    {
        var baseDir = Environment.ExpandEnvironmentVariables(settings.Value.LogPath ?? string.Empty);
        if (string.IsNullOrWhiteSpace(baseDir))
        {
            baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BelfProctor", "Logs");
        }
        Directory.CreateDirectory(baseDir);
        _dir = baseDir;
    }

    public ILogger CreateLogger(string categoryName) => new RollingFileLogger(this, categoryName);

    internal void Write(string category, LogLevel level, string message, Exception? ex)
    {
        if (_disposed) return;
        var day = DateTime.UtcNow.ToString("yyyyMMdd", CultureInfo.InvariantCulture);
        var fp = Path.Combine(_dir, $"client_{day}.log");
        var ts = DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        var line = $"[{ts}] [{level}] [{category}] {message}";
        if (ex != null) line += $" {ex}";
        lock (_lock)
        {
            File.AppendAllText(fp, line + Environment.NewLine, Encoding.UTF8);
        }
    }

    public void Dispose()
    {
        _disposed = true;
    }

    private sealed class RollingFileLogger : ILogger
    {
        private readonly RollingFileLoggerProvider _provider;
        private readonly string _category;

        public RollingFileLogger(RollingFileLoggerProvider provider, string category)
        {
            _provider = provider;
            _category = category;
        }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => NullScope.Instance;

        public bool IsEnabled(LogLevel logLevel) => logLevel != LogLevel.None;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (!IsEnabled(logLevel)) return;
            var msg = formatter(state, exception);
            _provider.Write(_category, logLevel, msg, exception);
        }

        private sealed class NullScope : IDisposable
        {
            public static readonly NullScope Instance = new();
            public void Dispose() { }
        }
    }
}
