using System.Text;
using System.Windows.Forms;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using BelfProctor.Models;
using System.Security.Principal;
using System.Security.Cryptography;

namespace BelfProctor.UI;

public class SettingsForm : Form
{
    private readonly IConfiguration _configuration;
    private readonly ProctorSettings _settings;
    private readonly string[] _configPaths;
    private TextBox _serverUrl = new();
    private TextBox _clientId = new();
    private TextBox _encryptionKey = new();
    private NumericUpDown _screenshotInterval = new();
    private NumericUpDown _screenshotQuality = new();
    private TextBox _screenshotPath = new();
    private TextBox _logPath = new();
    private TextBox _reportsPath = new();
    private CheckBox _monitorUSB = new();
    private CheckBox _monitorProcesses = new();
    private CheckBox _monitorNetwork = new();
    private TextBox _allowedProcesses = new();
    private TextBox _blockedProcesses = new();
    private NumericUpDown _heartbeatInterval = new();
    private NumericUpDown _policyUpdateInterval = new();
    private NumericUpDown _directoryListingInterval = new();
    private TextBox _directoryRoots = new();
    private TextBox _adminPassword = new();
    private Button _save = new();
    private Button _cancel = new();

    public SettingsForm(IConfiguration configuration, ProctorSettings settings, string[] configPaths)
    {
        _configuration = configuration;
        _settings = settings;
        _configPaths = configPaths;
        Width = 800;
        Height = 700;
        Text = "BelfProctor Settings";
        StartPosition = FormStartPosition.CenterScreen;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 20, AutoSize = true };
        Controls.Add(panel);
        AddRow(panel, "ServerUrl", _serverUrl);
        AddRow(panel, "ClientId", _clientId);
        AddRow(panel, "EncryptionKey", _encryptionKey);
        AddRow(panel, "ScreenshotInterval", _screenshotInterval);
        AddRow(panel, "ScreenshotQuality", _screenshotQuality);
        AddRow(panel, "ScreenshotPath", _screenshotPath);
        AddRow(panel, "LogPath", _logPath);
        AddRow(panel, "ReportsPath", _reportsPath);
        AddRow(panel, "MonitorUSB", _monitorUSB);
        AddRow(panel, "MonitorProcesses", _monitorProcesses);
        AddRow(panel, "MonitorNetwork", _monitorNetwork);
        AddRow(panel, "AllowedProcesses (one per line)", _allowedProcesses, true);
        AddRow(panel, "BlockedProcesses (one per line)", _blockedProcesses, true);
        AddRow(panel, "HeartbeatInterval", _heartbeatInterval);
        AddRow(panel, "PolicyUpdateInterval", _policyUpdateInterval);
        AddRow(panel, "DirectoryListingInterval", _directoryListingInterval);
        AddRow(panel, "DirectoryRoots (one per line)", _directoryRoots, true);
        AddRow(panel, "Admin Password (required to save)", _adminPassword);
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 40 };
        _save.Text = "Save";
        _cancel.Text = "Cancel";
        _save.Click += (_, __) => SaveSettings();
        _cancel.Click += (_, __) => Close();
        buttons.Controls.Add(_save);
        buttons.Controls.Add(_cancel);
        Controls.Add(buttons);
        _screenshotInterval.Maximum = 3600000;
        _screenshotQuality.Maximum = 100;
        _heartbeatInterval.Maximum = 3600000;
        _policyUpdateInterval.Maximum = 3600000;
        _directoryListingInterval.Maximum = 3600000;
        _serverUrl.Width = _clientId.Width = _encryptionKey.Width = _screenshotPath.Width = _logPath.Width = _reportsPath.Width = _allowedProcesses.Width = _blockedProcesses.Width = _directoryRoots.Width = _adminPassword.Width = 600;
        _adminPassword.UseSystemPasswordChar = true;
        LoadSettings();
    }

    private void AddRow(TableLayoutPanel panel, string label, Control control, bool multiline = false)
    {
        var l = new Label { Text = label, AutoSize = true };
        panel.Controls.Add(l);
        if (control is TextBox tb && multiline)
        {
            tb.Multiline = true;
            tb.Height = 80;
            tb.ScrollBars = ScrollBars.Vertical;
        }
        panel.Controls.Add(control);
    }

    private void LoadSettings()
    {
        _serverUrl.Text = _settings.ServerUrl;
        _clientId.Text = _settings.ClientId;
        _encryptionKey.Text = _settings.EncryptionKey;
        _screenshotInterval.Value = _settings.ScreenshotInterval;
        _screenshotQuality.Value = _settings.ScreenshotQuality;
        _screenshotPath.Text = _settings.ScreenshotPath;
        _logPath.Text = _settings.LogPath;
        _reportsPath.Text = _settings.ReportsPath;
        _monitorUSB.Checked = _settings.MonitorUSB;
        _monitorProcesses.Checked = _settings.MonitorProcesses;
        _monitorNetwork.Checked = _settings.MonitorNetwork;
        _allowedProcesses.Text = string.Join(Environment.NewLine, _settings.AllowedProcesses);
        _blockedProcesses.Text = string.Join(Environment.NewLine, _settings.BlockedProcesses);
        _heartbeatInterval.Value = _settings.HeartbeatInterval;
        _policyUpdateInterval.Value = _settings.PolicyUpdateInterval;
        _directoryListingInterval.Value = _settings.DirectoryListingInterval;
        _directoryRoots.Text = string.Join(Environment.NewLine, _settings.DirectoryRoots);
    }

    private void SaveSettings()
    {
        if (!IsAdmin()) { MessageBox.Show("Administrator privileges required", "Access denied", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }

        var entered = _adminPassword.Text ?? string.Empty;
        var currentHash = _settings.AdminPasswordHash ?? string.Empty;
        bool canSave = false;
        if (string.IsNullOrEmpty(currentHash))
        {
            if (string.IsNullOrEmpty(entered)) { MessageBox.Show("Enter admin password to initialize", "Validation", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            canSave = true;
        }
        else
        {
            var h = HashPassword(entered);
            if (!TimingSafeEquals(Convert.FromBase64String(currentHash), h)) { MessageBox.Show("Invalid admin password", "Access denied", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
            canSave = true;
        }
        if (!canSave) return;

        var obj = new JObject
        {
            ["ServerUrl"] = _serverUrl.Text.Trim(),
            ["ClientId"] = _clientId.Text.Trim(),
            ["EncryptionKey"] = _encryptionKey.Text,
            ["ScreenshotInterval"] = (int)_screenshotInterval.Value,
            ["ScreenshotQuality"] = (int)_screenshotQuality.Value,
            ["ScreenshotPath"] = _screenshotPath.Text.Trim(),
            ["LogPath"] = _logPath.Text.Trim(),
            ["ReportsPath"] = _reportsPath.Text.Trim(),
            ["MonitorUSB"] = _monitorUSB.Checked,
            ["MonitorProcesses"] = _monitorProcesses.Checked,
            ["MonitorNetwork"] = _monitorNetwork.Checked,
            ["AllowedProcesses"] = new JArray(_allowedProcesses.Text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)),
            ["BlockedProcesses"] = new JArray(_blockedProcesses.Text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries)),
            ["MaxLogFileSize"] = _settings.MaxLogFileSize,
            ["MaxScreenshotAge"] = _settings.MaxScreenshotAge,
            ["HeartbeatInterval"] = (int)_heartbeatInterval.Value,
            ["PolicyUpdateInterval"] = (int)_policyUpdateInterval.Value,
            ["DirectoryListingInterval"] = (int)_directoryListingInterval.Value,
            ["DirectoryRoots"] = new JArray(_directoryRoots.Text.Split(new[] { "\r\n", "\n" }, StringSplitOptions.RemoveEmptyEntries))
        };

        if (string.IsNullOrEmpty(currentHash))
        {
            obj["AdminPasswordHash"] = Convert.ToBase64String(HashPassword(entered));
        }

        foreach (var path in _configPaths)
        {
            try
            {
                if (!File.Exists(path)) continue;
                var text = File.ReadAllText(path, Encoding.UTF8);
                var root = JObject.Parse(text);
                root["ProctorSettings"] = obj;
                File.WriteAllText(path, root.ToString(), Encoding.UTF8);
            }
            catch
            {
            }
        }

        Close();
    }

    private static bool IsAdmin()
    {
        try
        {
            var wi = WindowsIdentity.GetCurrent();
            var wp = new WindowsPrincipal(wi);
            return wp.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    private static byte[] HashPassword(string password)
    {
        var salt = Encoding.UTF8.GetBytes("BelfProctorAdminSalt");
        return Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, 20000, HashAlgorithmName.SHA256, 32);
    }

    private static bool TimingSafeEquals(byte[] a, byte[] b)
    {
        if (a.Length != b.Length) return false;
        int diff = 0;
        for (int i = 0; i < a.Length; i++) diff |= a[i] ^ b[i];
        return diff == 0;
    }
}