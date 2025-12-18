using System.Text;
using System.Windows.Forms;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using BelfProctor.Models;
using System.Security.Principal;
using System.Security.Cryptography;

using Microsoft.Win32;

namespace BelfProctor.UI;

public class SettingsForm : Form
{
    private readonly IConfiguration _configuration;
    private readonly ProctorSettings _settings;
    private readonly string[] _configPaths;
    private TextBox _serverUrl = new();
    private TextBox _clientId = new();
    private TextBox _encryptionKey = new();
    private CheckBox _runOnStartup = new();
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
    private TextBox _adminEmail = new();
    private TextBox _adminPassword = new();
    private Button _testConnection = new();
    private Button _registerClient = new();
    private Button _save = new();
    private Button _cancel = new();

    public SettingsForm(IConfiguration configuration, ProctorSettings settings, string[] configPaths)
    {
        _configuration = configuration;
        _settings = settings;
        _configPaths = configPaths;
        Width = 800;
        Height = 850;
        Text = "BelfProctor Settings";
        StartPosition = FormStartPosition.CenterScreen;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 24, AutoSize = true, Padding = new Padding(10) };
        Controls.Add(panel);
        
        AddSectionHeader(panel, "Connection Settings");
        AddRow(panel, "Server Url (e.g. http://192.168.1.5:8080/api)", _serverUrl);
        
        var connButtons = new FlowLayoutPanel { AutoSize = true };
        _testConnection.Text = "Test Connection";
        _testConnection.AutoSize = true;
        _testConnection.Click += async (_, __) => await TestConnection();
        connButtons.Controls.Add(_testConnection);
        panel.Controls.Add(new Label()); // Spacer
        panel.Controls.Add(connButtons);

        AddSectionHeader(panel, "Client Identity");
        AddRow(panel, "Client Id", _clientId);
        AddRow(panel, "Encryption Key", _encryptionKey);
        
        AddSectionHeader(panel, "Server Registration (Optional)");
        AddRow(panel, "Admin Email", _adminEmail);
        AddRow(panel, "Admin Password", _adminPassword);
        
        var regButtons = new FlowLayoutPanel { AutoSize = true };
        _registerClient.Text = "Register Client on Server";
        _registerClient.AutoSize = true;
        _registerClient.Click += async (_, __) => await RegisterClient();
        regButtons.Controls.Add(_registerClient);
        panel.Controls.Add(new Label()); // Spacer
        panel.Controls.Add(regButtons);

        AddSectionHeader(panel, "Monitoring Settings");
        AddRow(panel, "Screenshot Interval (ms)", _screenshotInterval);
        AddRow(panel, "Screenshot Quality (1-100)", _screenshotQuality);
        AddRow(panel, "Run on Startup", _runOnStartup);
        AddRow(panel, "Monitor USB", _monitorUSB);
        AddRow(panel, "Monitor Processes", _monitorProcesses);
        AddRow(panel, "Monitor Network", _monitorNetwork);
        
        AddSectionHeader(panel, "Advanced Paths & Intervals");
        AddRow(panel, "Screenshot Path", _screenshotPath);
        AddRow(panel, "Log Path", _logPath);
        AddRow(panel, "Reports Path", _reportsPath);
        AddRow(panel, "Heartbeat Interval (ms)", _heartbeatInterval);
        AddRow(panel, "Policy Update Interval (ms)", _policyUpdateInterval);
        AddRow(panel, "Directory Listing Interval (ms)", _directoryListingInterval);
        AddRow(panel, "Allowed Processes (one per line)", _allowedProcesses, true);
        AddRow(panel, "Blocked Processes (one per line)", _blockedProcesses, true);
        AddRow(panel, "Directory Roots (one per line)", _directoryRoots, true);
        
        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 50, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(10) };
        _save.Text = "Save & Start";
        _save.AutoSize = true;
        _cancel.Text = "Cancel";
        _cancel.AutoSize = true;
        _save.Click += (_, __) => SaveSettings();
        _cancel.Click += (_, __) => Close();
        buttons.Controls.Add(_cancel);
        buttons.Controls.Add(_save);
        Controls.Add(buttons);
        
        _screenshotInterval.Minimum = 1000;
        _screenshotInterval.Maximum = 3600000;
        _screenshotQuality.Minimum = 1;
        _screenshotQuality.Maximum = 100;
        _heartbeatInterval.Minimum = 1000;
        _heartbeatInterval.Maximum = 3600000;
        _policyUpdateInterval.Minimum = 1000;
        _policyUpdateInterval.Maximum = 3600000;
        _directoryListingInterval.Minimum = 1000;
        _directoryListingInterval.Maximum = 3600000;
        _serverUrl.Width = _clientId.Width = _encryptionKey.Width = _screenshotPath.Width = _logPath.Width = _reportsPath.Width = _allowedProcesses.Width = _blockedProcesses.Width = _directoryRoots.Width = _adminEmail.Width = _adminPassword.Width = 500;
        _adminPassword.UseSystemPasswordChar = true;
        
        LoadSettings();
    }

    private void AddSectionHeader(TableLayoutPanel panel, string text)
    {
        var l = new Label { Text = text, Font = new Font(Font, FontStyle.Bold), AutoSize = true, Margin = new Padding(0, 10, 0, 5) };
        panel.Controls.Add(l);
        panel.SetColumnSpan(l, 2);
    }

    private async Task TestConnection()
    {
        var url = _serverUrl.Text.Trim();
        if (string.IsNullOrEmpty(url))
        {
            MessageBox.Show("Please enter Server URL first.");
            return;
        }

        if (url.Contains("localhost") || url.Contains("127.0.0.1"))
        {
            var res = MessageBox.Show("You are using 'localhost'. If the server is on another machine (e.g. your Mac), this will NOT work.\n\nAre you sure you want to proceed?", "Warning", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (res == DialogResult.No) return;
        }

        _testConnection.Enabled = false;
        _testConnection.Text = "Testing...";

        try
        {
            using var client = new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(5);
            // Try health endpoint
            var healthUrl = url.TrimEnd('/') + "/health";
            var resp = await client.GetAsync(healthUrl);
            
            if (resp.IsSuccessStatusCode)
            {
                MessageBox.Show("Connection Successful! Server is reachable.", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                MessageBox.Show($"Server reachable but returned error: {resp.StatusCode}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to connect: {ex.Message}\n\nCheck URL and Firewall settings.", "Connection Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _testConnection.Enabled = true;
            _testConnection.Text = "Test Connection";
        }
    }

    private async Task RegisterClient()
    {
        var url = _serverUrl.Text.Trim();
        var email = _adminEmail.Text.Trim();
        var password = _adminPassword.Text;
        var clientId = _clientId.Text.Trim();
        var key = _encryptionKey.Text.Trim();

        if (string.IsNullOrEmpty(url) || string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
        {
            MessageBox.Show("Please fill Server URL, Admin Email and Admin Password.");
            return;
        }

        _registerClient.Enabled = false;
        _registerClient.Text = "Registering...";

        try
        {
            using var client = new HttpClient();
            client.BaseAddress = new Uri(url.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromSeconds(10);

            // 1. Login to get token
            var loginContent = new StringContent(Newtonsoft.Json.JsonConvert.SerializeObject(new { email, password }), Encoding.UTF8, "application/json");
            var loginResp = await client.PostAsync("auth/login", loginContent);
            
            if (!loginResp.IsSuccessStatusCode)
            {
                MessageBox.Show("Login failed. Check credentials.", "Registration Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            var loginJson = await loginResp.Content.ReadAsStringAsync();
            var loginObj = JObject.Parse(loginJson);
            var token = loginObj["token"]?.ToString();

            if (string.IsNullOrEmpty(token))
            {
                MessageBox.Show("Login succeeded but no token received.", "Registration Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // 2. Register client
            client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            var regContent = new StringContent(Newtonsoft.Json.JsonConvert.SerializeObject(new { id = clientId, encryptionKey = key }), Encoding.UTF8, "application/json");
            var regResp = await client.PostAsync("clients/register", regContent);

            if (regResp.IsSuccessStatusCode)
            {
                MessageBox.Show($"Client '{clientId}' successfully registered on server!", "Success", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            else
            {
                var err = await regResp.Content.ReadAsStringAsync();
                MessageBox.Show($"Registration failed: {regResp.StatusCode}\n{err}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Error during registration: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            _registerClient.Enabled = true;
            _registerClient.Text = "Register Client on Server";
        }
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
        _clientId.Text = string.IsNullOrWhiteSpace(_settings.ClientId) ? Guid.NewGuid().ToString() : _settings.ClientId;
        _encryptionKey.Text = _settings.EncryptionKey;
        _screenshotInterval.Value = _settings.ScreenshotIntervalMs;
        _screenshotQuality.Value = _settings.ScreenshotQuality;
        _screenshotPath.Text = _settings.ScreenshotPath;
        _logPath.Text = _settings.LogPath;
        _reportsPath.Text = _settings.ReportsPath;
        _heartbeatInterval.Value = _settings.HeartbeatIntervalMs;
        _policyUpdateInterval.Value = _settings.PolicyUpdateIntervalMs;
        _directoryListingInterval.Value = _settings.DirectoryListingIntervalMs;
        _monitorUSB.Checked = _settings.MonitorUSB;
        _monitorProcesses.Checked = _settings.MonitorProcesses;
        _monitorNetwork.Checked = _settings.MonitorNetwork;
        _runOnStartup.Checked = _settings.RunOnStartup; // Assuming this property exists in settings or registry logic
        _allowedProcesses.Text = string.Join(Environment.NewLine, _settings.AllowedProcesses ?? new List<string>());
        _blockedProcesses.Text = string.Join(Environment.NewLine, _settings.BlockedProcesses ?? new List<string>());
        _directoryRoots.Text = string.Join(Environment.NewLine, _settings.DirectoryRoots ?? new List<string>());
        
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
            // If key exists, use its state. If not, default to true (as per ProctorSettings default)
            if (key?.GetValue("BelfProctor") != null)
            {
                _runOnStartup.Checked = true;
            }
            else
            {
                _runOnStartup.Checked = true; // Default to true for new installs
            }
        }
        catch { }
    }

    private void SaveSettings()
    {
        // Simple password check for saving local settings (optional, skipped for now to allow easier setup)
        // if (!string.IsNullOrEmpty(_settings.AdminPasswordHash) && _adminPassword.Text != _settings.AdminPasswordHash) ...

        var newSettings = new JObject();
        var section = new JObject();
        section["ServerUrl"] = _serverUrl.Text;
        section["ClientId"] = _clientId.Text;
        section["EncryptionKey"] = _encryptionKey.Text;
        section["RunOnStartup"] = _runOnStartup.Checked;
        section["ScreenshotIntervalMs"] = _screenshotInterval.Value;
        section["ScreenshotQuality"] = _screenshotQuality.Value;
        section["ScreenshotPath"] = _screenshotPath.Text;
        section["LogPath"] = _logPath.Text;
        section["ReportsPath"] = _reportsPath.Text;
        section["MonitorUSB"] = _monitorUSB.Checked;
        section["MonitorProcesses"] = _monitorProcesses.Checked;
        section["MonitorNetwork"] = _monitorNetwork.Checked;
        section["AllowedProcesses"] = new JArray(_allowedProcesses.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        section["BlockedProcesses"] = new JArray(_blockedProcesses.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        section["HeartbeatIntervalMs"] = _heartbeatInterval.Value;
        section["PolicyUpdateIntervalMs"] = _policyUpdateInterval.Value;
        section["DirectoryListingIntervalMs"] = _directoryListingInterval.Value;
        section["DirectoryRoots"] = new JArray(_directoryRoots.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        
        // Preserve password if not changed/handled here
        section["AdminPasswordHash"] = _settings.AdminPasswordHash;

        newSettings["ProctorSettings"] = section;

        foreach (var path in _configPaths)
        {
            try
            {
                File.WriteAllText(path, newSettings.ToString());
                break; // Save to the first writable path
            }
            catch { }
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (_runOnStartup.Checked)
            {
                key?.SetValue("BelfProctor", Application.ExecutablePath);
            }
            else
            {
                key?.DeleteValue("BelfProctor", false);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Error setting startup: {ex.Message}");
        }

        MessageBox.Show("Settings saved. Application will restart/continue.");
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