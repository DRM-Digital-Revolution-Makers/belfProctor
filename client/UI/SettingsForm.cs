using System.Text;
using System.Windows.Forms;
using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json.Linq;
using BelfProctor.Models;
using System.Security.Principal;
using System.Security.Cryptography;
using System.IO;
using System.Net.Http;

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

    public SettingsForm(IConfiguration configuration, ProctorSettings settings, string?[] configPaths)
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
        
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false);
            // Check for both old and new keys
            if (key?.GetValue("WindowsSystemWorker") != null || key?.GetValue("BelfProctor") != null)
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

    private async Task SaveSettings()
    {
        // Require Encryption Key
        if (string.IsNullOrWhiteSpace(_encryptionKey.Text))
        {
             MessageBox.Show("Encryption Key is required for server communication.", "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
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

        // Define install path
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var installDir = Path.Combine(appData, "BelfProctor");
        var installPath = Path.Combine(installDir, "BelfProctor.exe");
        var currentPath = Environment.ProcessPath ?? Application.ExecutablePath;

        // Save settings to config file (standard logic)
        var newSettings = new JObject();
        var section = new JObject();
        section["ServerUrl"] = _serverUrl.Text;
        section["ClientId"] = _clientId.Text;
        section["EncryptionKey"] = _encryptionKey.Text;
        section["RunOnStartup"] = _runOnStartup.Checked;
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
        section["AdminPasswordHash"] = _settings.AdminPasswordHash;

        newSettings["ProctorSettings"] = section;

        // Save to existing paths AND to the install directory if it exists
        var pathsToSave = new List<string>(_configPaths);
        pathsToSave.Add(Path.Combine(installDir, "appsettings.json"));

        foreach (var path in pathsToSave)
        {
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.WriteAllText(path, newSettings.ToString());
            }
            catch { }
        }

        // Install logic: Copy ALL files if not already running from install path
        bool isInstalled = string.Equals(currentPath, installPath, StringComparison.OrdinalIgnoreCase);
        
        if (!isInstalled)
        {
            try
            {
                if (!Directory.Exists(installDir)) Directory.CreateDirectory(installDir);

                // Check for existing running process in install path and kill it
                var existingProcess = Process.GetProcessesByName("BelfProctor").FirstOrDefault(p => !p.Id.Equals(Process.GetCurrentProcess().Id))
                    ?? Process.GetProcessesByName("SystemWorker").FirstOrDefault(p => !p.Id.Equals(Process.GetCurrentProcess().Id));
                if (existingProcess != null)
                {
                    try 
                    { 
                        existingProcess.Kill(); 
                        existingProcess.WaitForExit(3000);
                    } 
                    catch { }
                }

                // Copy all files from current directory to install directory to ensure dependencies (DLLs, JSONs) are present
                var sourceDir = Path.GetDirectoryName(currentPath);
                if (!string.IsNullOrEmpty(sourceDir))
                {
                    var files = Directory.GetFiles(sourceDir);
                    foreach (var file in files)
                    {
                        var fileName = Path.GetFileName(file);
                        var destFile = Path.Combine(installDir, fileName);
                        // Skip the main exe as we handle it specifically or it might be locked? 
                        // Actually, File.Copy allows overwriting. 
                        // Keep the main exe under the canonical BelfProctor.exe name.
                        
                        if (string.Equals(file, currentPath, StringComparison.OrdinalIgnoreCase))
                        {
                            File.Copy(file, installPath, true);
                        }
                        else
                        {
                            // Don't copy .pdb files to save space/stealth, and skip old configs
                            if (!fileName.EndsWith(".pdb") && !fileName.Equals("appsettings.json", StringComparison.OrdinalIgnoreCase)) 
                            {
                                File.Copy(file, destFile, true);
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show($"Failed to install to system directory: {ex.Message}. Running from current location.");
                installPath = currentPath; // Fallback
            }
        }

        // Setup Registry for Auto-Run (pointing to the PERMANENT install path)
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (_runOnStartup.Checked)
            {
                // IMPORTANT: Quote the path to handle spaces in username/path
                // Add --auto-start flag
                key?.SetValue("BelfProctor", $"\"{installPath}\" --auto-start");
                key?.DeleteValue("WindowsSystemWorker", false);
                
                // FALLBACK 1: Create Shortcut in Startup Folder
                CreateStartupShortcut(installPath, installDir);

                // FALLBACK 2: Scheduled Task (Persistence)
                CreateScheduledTask(installPath);
            }
            else
            {
                key?.DeleteValue("WindowsSystemWorker", false);
                key?.DeleteValue("BelfProctor", false);
                
                // Remove Shortcut
                var startupPath = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
                var shortcutPath = Path.Combine(startupPath, "BelfProctor.lnk");
                if (File.Exists(shortcutPath)) File.Delete(shortcutPath);
                var legacyShortcutPath = Path.Combine(startupPath, "SystemWorker.lnk");
                if (File.Exists(legacyShortcutPath)) File.Delete(legacyShortcutPath);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Error setting startup: {ex.Message}");
        }

        MessageBox.Show("Settings saved. Application updated and will restart in background.");

        // Make sure the BelfProctor Windows service exists and is running.
        // If we're not elevated, this kicks UAC for a child process that does the
        // sc.exe create + start, then returns ElevationRequested — we treat that
        // as success and exit; the service will own the worker from then on.
        var serviceResult = BelfProctor.Services.ServiceInstaller.EnsureInstalled(installPath);
        bool serviceOwnsWorker =
            serviceResult == BelfProctor.Services.ServiceInstaller.EnsureResult.AlreadyInstalled
            || serviceResult == BelfProctor.Services.ServiceInstaller.EnsureResult.Installed
            || serviceResult == BelfProctor.Services.ServiceInstaller.EnsureResult.ElevationRequested;

        if (serviceOwnsWorker)
        {
            // The service runs the worker as LocalSystem with --auto-start; no
            // need to spawn another user-mode copy.
            Application.Exit();
            return;
        }

        // Service install failed (e.g. user denied UAC) — fall back to the
        // legacy HKCU\Run launch so the agent still runs, just not as a service.
        if (!isInstalled && File.Exists(installPath))
        {
            Process.Start(installPath);
            Application.Exit();
        }
        else
        {
            var proc = new ProcessStartInfo(Application.ExecutablePath)
            {
                UseShellExecute = true,
                Arguments = "--auto-start",
            };
            Process.Start(proc);
            Application.Exit();
        }
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

    private void CreateStartupShortcut(string targetPath, string workingDir)
    {
        try
        {
            var startupPath = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            var shortcutPath = Path.Combine(startupPath, "BelfProctor.lnk");
            
            // Use VBScript to create shortcut to avoid COM dependencies
            var vbsScript = new StringBuilder();
            vbsScript.AppendLine("Set oWS = WScript.CreateObject(\"WScript.Shell\")");
            vbsScript.AppendLine($"sLinkFile = \"{shortcutPath}\"");
            vbsScript.AppendLine("Set oLink = oWS.CreateShortcut(sLinkFile)");
            vbsScript.AppendLine($"oLink.TargetPath = \"{targetPath}\"");
            vbsScript.AppendLine("oLink.Arguments = \"--auto-start\"");
            vbsScript.AppendLine($"oLink.WorkingDirectory = \"{workingDir}\"");
            vbsScript.AppendLine("oLink.WindowStyle = 7"); // 7 = Minimized
            vbsScript.AppendLine("oLink.Save");
            
            var vbsPath = Path.Combine(Path.GetTempPath(), "create_shortcut.vbs");
            File.WriteAllText(vbsPath, vbsScript.ToString());
            
            Process.Start(new ProcessStartInfo
            {
                FileName = "cscript",
                Arguments = $"//Nologo \"{vbsPath}\"",
                UseShellExecute = false,
                CreateNoWindow = true
            })?.WaitForExit();
            
            if (File.Exists(vbsPath)) File.Delete(vbsPath);
        }
        catch (Exception ex)
        {
            // Log or ignore, registry is primary method
            Debug.WriteLine($"Failed to create shortcut: {ex.Message}");
        }
    }

    private void CreateScheduledTask(string targetPath)
    {
        try
        {
            // Create a scheduled task that runs at logon for any user
            // We use schtasks.exe. This requires Admin usually, but if run as standard user, it might fail or create a user task.
            // We'll try to create a user-level task which doesn't strictly need Admin if it's for the current user.
            
            var taskName = "BelfProctorUpdate";
            // Use escaped double quotes for path to handle spaces correctly
            var args = $"/create /tn \"{taskName}\" /tr \"\\\"{targetPath}\\\" --auto-start\" /sc onlogon /f";
            
            Process.Start(new ProcessStartInfo
            {
                FileName = "schtasks",
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to create scheduled task: {ex.Message}");
        }
    }
}
