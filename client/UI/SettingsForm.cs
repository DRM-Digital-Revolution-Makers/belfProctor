using System.Text;
using System.Windows.Forms;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using BelfProctor.Models;
using System.Security.Cryptography;
using System.IO;
using System.Net.Http;

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

    public SettingsForm(IConfiguration configuration, ProctorSettings settings, string?[] configPaths)
    {
        _configuration = configuration;
        _settings = settings;
        _configPaths = configPaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Select(path => path!)
            .ToArray();
        Width = 800;
        Height = 850;
        Text = "BelfProctor Settings";
        StartPosition = FormStartPosition.CenterScreen;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 24, AutoSize = true, Padding = new Padding(10) };
        Controls.Add(panel);
        
        AddSectionHeader(panel, "Connection Settings");
        AddRow(panel, "Server URL (e.g. https://proctor.example.com/api)", _serverUrl);
        
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
        _save.Click += async (_, __) => await SaveSettings();
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
        _screenshotInterval.DecimalPlaces = 0;
        _heartbeatInterval.DecimalPlaces = 0;
        _policyUpdateInterval.DecimalPlaces = 0;
        _directoryListingInterval.DecimalPlaces = 0;
        _serverUrl.Width = _clientId.Width = _encryptionKey.Width = _screenshotPath.Width = _logPath.Width = _reportsPath.Width = _allowedProcesses.Width = _blockedProcesses.Width = _directoryRoots.Width = _adminEmail.Width = _adminPassword.Width = 500;
        _adminPassword.UseSystemPasswordChar = true;
        
        LoadSettings();
        
        // Auto-generate key if missing
        if (string.IsNullOrWhiteSpace(_encryptionKey.Text))
        {
            using var aes = Aes.Create();
            aes.GenerateKey();
            _encryptionKey.Text = Convert.ToBase64String(aes.Key);
        }
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
            using var handler = new HttpClientHandler
            {
                UseCookies = true,
                CookieContainer = new System.Net.CookieContainer(),
            };
            using var client = new HttpClient(handler);
            client.BaseAddress = new Uri(url.TrimEnd('/') + "/");
            client.Timeout = TimeSpan.FromSeconds(10);

            // Login establishes the HttpOnly bp_session cookie. The server no
            // longer exposes bearer tokens in JSON responses.
            var loginContent = new StringContent(Newtonsoft.Json.JsonConvert.SerializeObject(new { email, password }), Encoding.UTF8, "application/json");
            var loginResp = await client.PostAsync("auth/login", loginContent);
            
            if (!loginResp.IsSuccessStatusCode)
            {
                MessageBox.Show("Login failed. Check credentials.", "Registration Failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            // HttpClientHandler carries the session cookie to this admin-only
            // endpoint without exposing it to application code.
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
        _screenshotInterval.Value = _settings.ScreenshotIntervalMs > 0 ? _settings.ScreenshotIntervalMs : 300000;
        _screenshotQuality.Value = _settings.ScreenshotQuality > 0 ? _settings.ScreenshotQuality : 75;
        _screenshotPath.Text = _settings.ScreenshotPath;
        _logPath.Text = _settings.LogPath;
        _reportsPath.Text = _settings.ReportsPath;
        _heartbeatInterval.Value = _settings.HeartbeatIntervalMs > 0 ? _settings.HeartbeatIntervalMs : 60000;
        _policyUpdateInterval.Value = _settings.PolicyUpdateIntervalMs > 0 ? _settings.PolicyUpdateIntervalMs : 300000;
        _directoryListingInterval.Value = _settings.DirectoryListingIntervalMs > 0 ? _settings.DirectoryListingIntervalMs : 600000;
        _monitorUSB.Checked = _settings.MonitorUSB;
        _monitorProcesses.Checked = _settings.MonitorProcesses;
        _monitorNetwork.Checked = _settings.MonitorNetwork;
        _runOnStartup.Checked = _settings.RunOnStartup; 
        _allowedProcesses.Text = string.Join(Environment.NewLine, _settings.AllowedProcesses ?? new List<string>());
        _blockedProcesses.Text = string.Join(Environment.NewLine, _settings.BlockedProcesses ?? new List<string>());
        _directoryRoots.Text = string.Join(Environment.NewLine, _settings.DirectoryRoots ?? new List<string>());
        
        // Startup is owned by the signed installer and the protected
        // BelfProctor-Desktop scheduled task, not by user-writable HKCU entries.
        _runOnStartup.Checked = true;
        _runOnStartup.Enabled = false;
    }

    private async Task SaveSettings()
    {
        var serverUrl = _serverUrl.Text.Trim();
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var serverUri) ||
            (serverUri.Scheme != Uri.UriSchemeHttps && !_settings.AllowInsecureDevelopmentTransport))
        {
            MessageBox.Show("A valid HTTPS server URL is required.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var clientId = _clientId.Text.Trim();
        if (string.IsNullOrWhiteSpace(clientId) || clientId.Contains("PROVISION_", StringComparison.OrdinalIgnoreCase))
        {
            MessageBox.Show("A unique Client Id is required.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        var encryptionKey = _encryptionKey.Text.Trim();
        if (encryptionKey.Length < 32 ||
            encryptionKey.Contains("PROVISION_", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(encryptionKey, "ABCDEFGHIJKLMNOP", StringComparison.Ordinal))
        {
            MessageBox.Show("A unique encryption key of at least 32 characters is required.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // Auto-Register if credentials provided
        if (!string.IsNullOrWhiteSpace(_adminEmail.Text) && !string.IsNullOrWhiteSpace(_adminPassword.Text))
        {
            var res = MessageBox.Show("Do you want to register/update this client on the server now?", "Register Client", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (res == DialogResult.Yes)
            {
                await RegisterClient();
            }
        }

        // There is exactly one authoritative configuration target. In Release
        // Program.cs supplies the protected file beside the installed EXE; a
        // user-writable LocalAppData override is intentionally not loaded.
        var targetPath = _configPaths.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(targetPath))
        {
            MessageBox.Show("No writable configuration target is available.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        JObject document;
        try
        {
            document = File.Exists(targetPath)
                ? JObject.Parse(File.ReadAllText(targetPath))
                : new JObject();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"The existing configuration is invalid: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // Update only fields exposed by this form. Security-sensitive and
        // forward-compatible values (trusted signer, feature flags, retention,
        // transport policy, and future fields) remain intact.
        var section = document["ProctorSettings"] as JObject ?? new JObject();
        document["ProctorSettings"] = section;
        section["ServerUrl"] = serverUrl;
        section["ClientId"] = clientId;
        section["EncryptionKey"] = encryptionKey;
        section["RunOnStartup"] = true;
        section["ScreenshotIntervalMs"] = Convert.ToInt32(_screenshotInterval.Value);
        section["ScreenshotQuality"] = Convert.ToInt32(_screenshotQuality.Value);
        section["ScreenshotPath"] = _screenshotPath.Text;
        section["LogPath"] = _logPath.Text;
        section["ReportsPath"] = _reportsPath.Text;
        section["MonitorUSB"] = _monitorUSB.Checked;
        section["MonitorProcesses"] = _monitorProcesses.Checked;
        section["MonitorNetwork"] = _monitorNetwork.Checked;
        section["AllowedProcesses"] = new JArray(_allowedProcesses.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        section["BlockedProcesses"] = new JArray(_blockedProcesses.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        section["HeartbeatIntervalMs"] = Convert.ToInt32(_heartbeatInterval.Value);
        section["PolicyUpdateIntervalMs"] = Convert.ToInt32(_policyUpdateInterval.Value);
        section["DirectoryListingIntervalMs"] = Convert.ToInt32(_directoryListingInterval.Value);
        section["DirectoryRoots"] = new JArray(_directoryRoots.Text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        if (!string.IsNullOrWhiteSpace(_settings.AdminPasswordHash))
        {
            section["AdminPasswordHash"] = _settings.AdminPasswordHash;
        }

        var tempPath = targetPath + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            var directory = Path.GetDirectoryName(targetPath)
                ?? throw new InvalidOperationException("Configuration target has no parent directory");
            Directory.CreateDirectory(directory);
            File.WriteAllText(tempPath, document.ToString(), new UTF8Encoding(false));
            File.Move(tempPath, targetPath, true);
        }
        catch (Exception ex)
        {
            try { File.Delete(tempPath); } catch { }
            MessageBox.Show($"Could not save the protected configuration: {ex.Message}", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        MessageBox.Show(
            "Settings saved atomically. Restart the BelfProctor-Desktop task to apply them.",
            "BelfProctor",
            MessageBoxButtons.OK,
            MessageBoxIcon.Information);
        Close();
    }
}
