using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace BelfProctor.Services.WorkTracking;

public class ForegroundWindowSnapshot
{
    public IntPtr Handle { get; init; }
    public int ProcessId { get; init; }
    public string ProcessName { get; init; } = string.Empty;
    public string WindowTitle { get; init; } = string.Empty;
    public string? ExecutablePath { get; init; }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    public static ForegroundWindowSnapshot? Capture()
    {
        var handle = GetForegroundWindow();
        if (handle == IntPtr.Zero) return null;

        var titleBuilder = new StringBuilder(512);
        _ = GetWindowText(handle, titleBuilder, titleBuilder.Capacity);
        _ = GetWindowThreadProcessId(handle, out var pid);
        if (pid == 0) return null;

        try
        {
            using var process = Process.GetProcessById((int)pid);
            string? exe = null;
            try { exe = process.MainModule?.FileName; } catch { }
            return new ForegroundWindowSnapshot
            {
                Handle = handle,
                ProcessId = (int)pid,
                ProcessName = process.ProcessName,
                WindowTitle = titleBuilder.ToString(),
                ExecutablePath = exe,
            };
        }
        catch
        {
            return new ForegroundWindowSnapshot
            {
                Handle = handle,
                ProcessId = (int)pid,
                WindowTitle = titleBuilder.ToString(),
            };
        }
    }
}
