using System.Reflection;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.IO;
using Microsoft.Win32;

namespace BelfProctor.Services.WorkTracking;

public class AutoCadComAdapter : IAppAdapter
{
    public string Name => "autocad.com";

    public bool CanHandle(ForegroundWindowSnapshot snapshot)
    {
        var process = (snapshot.ProcessName ?? string.Empty).Replace(".exe", string.Empty);
        return process.Equals("acad", StringComparison.OrdinalIgnoreCase)
            || process.Equals("acadlt", StringComparison.OrdinalIgnoreCase)
            || snapshot.WindowTitle.Contains("AutoCAD", StringComparison.OrdinalIgnoreCase);
    }

    public WorkArtifactCandidate Resolve(ForegroundWindowSnapshot snapshot)
    {
        var comPath = TryGetActiveDocumentPath();
        var titlePath = ExtractPathFromTitle(snapshot.WindowTitle);
        var recentPath = titlePath == null ? TryFindRecentDwg(snapshot.WindowTitle) : null;
        var filePath = comPath ?? titlePath ?? recentPath;
        return new WorkArtifactCandidate
        {
            Adapter = Name,
            ProcessName = snapshot.ProcessName,
            WindowTitle = snapshot.WindowTitle,
            FilePath = filePath,
            FolderPath = SafeDirectoryName(filePath),
            Confidence = comPath != null ? "high" : filePath != null ? "medium" : "low",
            Metadata = new Dictionary<string, object?>
            {
                ["source"] = comPath != null ? "com" : titlePath != null ? "window_title" : recentPath != null ? "recent_files" : "unknown"
            },
        };
    }

    private static string? TryGetActiveDocumentPath()
    {
        try
        {
            _ = Type.GetTypeFromProgID("AutoCAD.Application");
            var method = typeof(Marshal).GetMethod("GetActiveObject", BindingFlags.Public | BindingFlags.Static);
            if (method == null) return null;
            var app = method.Invoke(null, new object[] { "AutoCAD.Application" });
            if (app == null) return null;
            var doc = app.GetType().InvokeMember("ActiveDocument", BindingFlags.GetProperty, null, app, null);
            if (doc == null) return null;
            var fullName = doc.GetType().InvokeMember("FullName", BindingFlags.GetProperty, null, doc, null)?.ToString();
            return string.IsNullOrWhiteSpace(fullName) ? null : fullName;
        }
        catch
        {
            return null;
        }
    }

    private static string? ExtractPathFromTitle(string title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        var fullPath = Regex.Match(title, @"[A-Za-z]:\\[^:*?""<>|]+?\.(dwg|dxf|dwt)", RegexOptions.IgnoreCase);
        if (fullPath.Success) return fullPath.Value;
        var uncPath = Regex.Match(title, @"\\\\[^:*?""<>|]+?\.(dwg|dxf|dwt)", RegexOptions.IgnoreCase);
        if (uncPath.Success) return uncPath.Value;
        var fileName = Regex.Match(title, @"[^\\/:*?""<>|]+\.(dwg|dxf|dwt)", RegexOptions.IgnoreCase);
        return fileName.Success ? fileName.Value : null;
    }

    private static string? TryFindRecentDwg(string title)
    {
        var fileName = ExtractPathFromTitle(title);
        if (string.IsNullOrWhiteSpace(fileName) || fileName.Contains("\\"))
        {
            return fileName;
        }

        try
        {
            using var root = Registry.CurrentUser.OpenSubKey(@"Software\Autodesk\AutoCAD");
            return SearchRegistryForDwg(root, fileName, 0);
        }
        catch
        {
            return fileName;
        }
    }

    private static string? SearchRegistryForDwg(RegistryKey? key, string fileName, int depth)
    {
        if (key == null || depth > 5) return null;
        foreach (var valueName in key.GetValueNames())
        {
            var value = key.GetValue(valueName)?.ToString();
            if (!string.IsNullOrWhiteSpace(value) &&
                value.EndsWith(fileName, StringComparison.OrdinalIgnoreCase) &&
                File.Exists(value))
            {
                return value;
            }
        }

        foreach (var subName in key.GetSubKeyNames().Take(50))
        {
            using var sub = key.OpenSubKey(subName);
            var found = SearchRegistryForDwg(sub, fileName, depth + 1);
            if (found != null) return found;
        }
        return null;
    }

    private static string? SafeDirectoryName(string? filePath)
    {
        try { return string.IsNullOrWhiteSpace(filePath) ? null : Path.GetDirectoryName(filePath); }
        catch { return null; }
    }
}
