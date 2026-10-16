using System.Diagnostics;
using System.Drawing;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Forms;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Cria.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try
        {
            if (args.Length >= 1 && args[0] == "--install")
            {
                if (args.Length is < 3 or > 4) throw new ArgumentException("Use install-cria.cmd CONFIGURATION.json EXISTING-TOKEN-FILE [SETTINGS-DIRECTORY].");
                string shortcut = Installer.Install(args[1], args[2], args.Length == 4 ? args[3] : null);
                MessageBox.Show("Cria is installed.\n\n" + shortcut + "\n\nClose ASCOM Remote Server before opening Cria.", "Cria installed", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            string path = args.Length == 1 ? Path.GetFullPath(args[0]) : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cria", "Desktop", "desktop.json");
            var settings = Settings.Load(path);
            using var sha = SHA256.Create();
            string key = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(settings.Configuration.ToUpperInvariant()))).Replace("-", "");
            using var single = new Mutex(true, @"Local\Cria.Desktop." + key, out bool first);
            if (!first)
            {
                MessageBox.Show("Cria is already open. Use its existing window on the taskbar.", "Cria", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            Application.Run(new MainWindow(settings));
        }
        catch (Exception e) { Environment.ExitCode = 1; MessageBox.Show("Cria could not open.\n\n" + e.Message, "Cria", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}

internal sealed class Settings
{
    public string Configuration { get; set; } = "";
    public string ApiExecutable { get; set; } = "";
    public string ProtectedToken { get; set; } = "";
    public string LogsDirectory { get; set; } = "";
    public bool StartOnOpen { get; set; } = true;
    [JsonIgnore] public string PathName { get; private set; } = "";
    public static Settings Load(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("Run install-cria.cmd with the verified rig configuration and existing token file first.");
        var result = JsonConvert.DeserializeObject<Settings>(File.ReadAllText(path)) ?? throw new InvalidDataException("Invalid desktop settings.");
        foreach (string p in new[] { result.Configuration, result.ApiExecutable, result.ProtectedToken, result.LogsDirectory })
            if (!Path.IsPathRooted(p)) throw new InvalidDataException("Desktop settings require absolute paths.");
        result.PathName = path;
        return result;
    }
    public void Save() => AtomicFile.Write(PathName, JsonConvert.SerializeObject(this, Formatting.Indented));
}

internal static class AtomicFile
{
    public static void Write(string path, string text)
    {
        string next = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var file = new FileStream(next, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                byte[] bytes = new UTF8Encoding(false).GetBytes(text);
                file.Write(bytes, 0, bytes.Length);
                file.Flush(true);
            }
            if (File.Exists(path)) File.Replace(next, path, path + ".previous", true);
            else File.Move(next, path);
        }
        finally { if (File.Exists(next)) File.Delete(next); }
    }
}

internal sealed class MainWindow : Form
{
    private readonly Settings settings;
    private readonly HttpClient http = new(new HttpClientHandler { UseProxy = false }) { Timeout = TimeSpan.FromSeconds(3) };
    private readonly Label headline = new() { AutoSize = true, Font = new Font("Segoe UI", 18, FontStyle.Bold), Text = "Cria" };
    private readonly Label detail = new() { AutoSize = true, MaximumSize = new Size(700, 0), Text = "Checking the local service…" };
    private readonly Label endpoint = new() { AutoSize = true };
    private readonly ListView devices = new() { View = View.Details, FullRowSelect = true, Height = 210, Dock = DockStyle.Fill };
    private readonly Button start = new() { Text = "Start Cria", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop Cria", AutoSize = true, Enabled = false };
    private readonly Button configure = new() { Text = "Settings", AutoSize = true };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 2000 };
    private Process? process;
    private JObject? service;
    private string token = "", dataDirectory = "", localOrigin = "";
    private bool action, refreshing, closeAllowed, stopRequested, unresolved;
    private StreamWriter? log;
    private long logBytes;
    private readonly object logGate = new();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool ShutdownBlockReasonCreate(IntPtr window, string reason);
    [DllImport("user32.dll")] private static extern bool ShutdownBlockReasonDestroy(IntPtr window);
    [DllImport("kernel32.dll")] private static extern bool SetProcessShutdownParameters(uint level, uint flags);

    public MainWindow(Settings settings)
    {
        this.settings = settings;
        Text = "Cria"; Icon = SystemIcons.Application; Font = new Font("Segoe UI", 10);
        ClientSize = new Size(760, 475); MinimumSize = new Size(730, 490); StartPosition = FormStartPosition.CenterScreen;
        var panel = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 7 };
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.RowStyles.Add(new RowStyle(SizeType.Absolute, 16)); panel.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize)); panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(headline, 0, 0); panel.Controls.Add(detail, 0, 1); panel.Controls.Add(devices, 0, 3);
        devices.Columns.Add("Device", 235); devices.Columns.Add("State", 130); devices.Columns.Add("Details", 315);
        endpoint.Margin = new Padding(0, 12, 0, 8); panel.Controls.Add(endpoint, 0, 4);
        var actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, WrapContents = true };
        var logs = new Button { Text = "Open logs", AutoSize = true };
        actions.Controls.AddRange(new Control[] { start, stop, configure, logs }); panel.Controls.Add(actions, 0, 5);
        panel.Controls.Add(new Label { AutoSize = true, Text = "Use Vela for equipment controls. Stop Cria before shutting down Windows.", Margin = new Padding(0, 12, 0, 0) }, 0, 6);
        Controls.Add(panel);
        start.Click += async (_, _) => await StartService();
        stop.Click += async (_, _) => await StopService();
        configure.Click += (_, _) => EditSettings();
        logs.Click += (_, _) => { Directory.CreateDirectory(settings.LogsDirectory); Process.Start("explorer.exe", Quote(settings.LogsDirectory)); };
        timer.Tick += async (_, _) => { if (process != null || service != null) await RefreshState(); };
        Shown += async (_, _) =>
        {
            // Windows asks the supervisor before default-priority API/driver processes.
            SetProcessShutdownParameters(0x380, 0);
            await RefreshState();
            if (settings.StartOnOpen && process == null && service == null) await StartService();
            timer.Start();
        };
        FormClosing += async (_, e) =>
        {
            if (closeAllowed) return;
            if (action) { e.Cancel = true; return; }
            if (process != null && !process.HasExited || service != null)
            {
                e.Cancel = true;
                if (await StopService()) { closeAllowed = true; Close(); }
            }
        };
        FormClosed += (_, _) => { timer.Stop(); http.Dispose(); process?.Dispose(); lock (logGate) log?.Dispose(); };
        LoadConnection();
    }
    private static string Quote(string value) => "\"" + value.Replace("\"", "") + "\"";
    private string Clean(string message) => token.Length == 0 ? message : message.Replace(token, "[redacted]");
    private JObject Configuration() => JObject.Parse(File.ReadAllText(settings.Configuration));
    private void LoadConnection()
    {
        var config = Configuration();
        var uri = new Uri((string?)config["listen"] ?? "");
        if (uri.Scheme != "http" || !System.Net.IPAddress.TryParse(uri.Host.Trim('[', ']'), out _) && !uri.IsLoopback)
            throw new InvalidDataException("Desktop control requires an IP address or localhost in the listen setting.");
        localOrigin = "http://127.0.0.1:" + uri.Port;
        dataDirectory = Resolve((string?)config["dataDirectory"] ?? "./data");
        byte[] protectedBytes = File.ReadAllBytes(settings.ProtectedToken);
        byte[] clear = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
        try { token = Encoding.UTF8.GetString(clear).Trim(); }
        finally { Array.Clear(clear, 0, clear.Length); }
        if (token.Length < 32 || token.Any(char.IsControl)) throw new InvalidDataException("The saved private token is invalid.");
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        endpoint.Text = uri.IsLoopback ? "Local connection: " + localOrigin : "Network access enabled • port " + uri.Port + " • token required";
    }
    private string Resolve(string path) => Path.GetFullPath(Path.IsPathRooted(path) ? path : Path.Combine(Path.GetDirectoryName(settings.Configuration)!, path));
    private async Task<JObject> Get(string route)
    {
        using var response = await http.GetAsync(localOrigin + route);
        if (!response.IsSuccessStatusCode) throw new IOException("Local service returned HTTP " + (int)response.StatusCode + ". Check that the installed configuration and token match.");
        return JObject.Parse(await response.Content.ReadAsStringAsync());
    }
    private void ValidateService(JObject identity)
    {
        if (!string.Equals(Path.GetFullPath((string?)identity["dataDirectory"] ?? ""), dataDirectory, StringComparison.OrdinalIgnoreCase))
            throw new IOException("This port belongs to a different Cria data directory. Its service has been left alone.");
        int pid = (int)identity["pid"]!;
        if (process != null && !process.HasExited && process.Id != pid)
            throw new IOException("The responding service is a different process. Check the logs before continuing.");
        if (process == null)
        {
            var existing = Process.GetProcessById(pid);
            if (!string.Equals(existing.MainModule.FileName, settings.ApiExecutable, StringComparison.OrdinalIgnoreCase))
            { existing.Dispose(); throw new IOException("Another Cria release is running. Stop it before opening this release."); }
            process = existing;
        }
    }
    private bool Alive => process != null && !process.HasExited;
    private void Buttons()
    {
        bool alive = Alive || service != null;
        start.Enabled = !action && !alive && !unresolved;
        stop.Enabled = !action && alive && !stopRequested;
        configure.Enabled = !action && !alive;
    }
    private async Task RefreshState()
    {
        if (refreshing || action) return;
        refreshing = true;
        try
        {
            if (process != null && process.HasExited) { ReadExit(); return; }
            var identity = await Get("/v2/service");
            ValidateService(identity); service = identity;
            var state = await Get("/v2/state");
            int ready = 0;
            devices.BeginUpdate(); devices.Items.Clear();
            foreach (var d in (JArray)state["devices"]!)
            {
                bool available = (bool?)d["commandReady"] == true;
                if (available) ready++;
                string status = available ? "Ready" : (string?)d["health"] ?? "Unknown";
                string reason = (string?)d["reason"] ?? "";
                if (status == "starting") reason = "Complete any driver setup window";
                devices.Items.Add(new ListViewItem(new[] { (string?)d["expectedName"] ?? (string)d["id"]!, status, reason }));
            }
            devices.EndUpdate();
            bool stopping = (bool?)identity["stopping"] == true;
            headline.Text = stopping ? "Stopping Cria…" : ready == devices.Items.Count ? "Cria is ready" : "Cria is starting or needs attention";
            detail.Text = stopping ? "Waiting for drivers to release. Keep the computer powered on." : ready + " of " + devices.Items.Count + " devices ready. " + ((int?)identity["activeOperations"] > 0 ? "Equipment work is in progress." : "Open Vela to use the rig.");
        }
        catch (Exception e)
        {
            if (Alive) { headline.Text = stopRequested ? "Stopping Cria…" : "Waiting for Cria"; detail.Text = "Service process is running. " + Clean(e.Message); }
            else { service = null; headline.Text = unresolved ? "Cria needs attention" : "Cria is stopped"; detail.Text = unresolved ? "Driver release was not confirmed. Check the logs before restarting." : "Start Cria to make the rig available in Vela."; }
        }
        finally { refreshing = false; Buttons(); }
    }
    private void ReadExit()
    {
        string? instance = (string?)service?["instanceId"];
        int pid = process!.Id, code = process.ExitCode;
        bool clean = false;
        try
        {
            var receipt = JObject.Parse(File.ReadAllText(Path.Combine(dataDirectory, "service-exit.json")));
            clean = code == 0 && instance != null && (string?)receipt["instanceId"] == instance && (int?)receipt["pid"] == pid && (bool?)receipt["cleanReleased"] == true;
        }
        catch { }
        unresolved = !clean;
        headline.Text = clean ? "Cria is stopped" : "Cria needs attention";
        detail.Text = clean ? "All Cria driver workers released cleanly. You can start Cria again or shut down Windows." : "The service exited without confirmed driver release. Check the logs; no restart was attempted.";
        devices.Items.Clear();
        process.Dispose(); process = null; service = null; stopRequested = false;
        lock (logGate) { log?.Dispose(); log = null; }
        ShutdownBlockReasonDestroy(Handle);
    }
    private void OpenLog()
    {
        Directory.CreateDirectory(settings.LogsDirectory);
        foreach (var old in new DirectoryInfo(settings.LogsDirectory).GetFiles("cria-*.log").OrderByDescending(f => f.LastWriteTimeUtc).Skip(31))
            try { old.Delete(); } catch (IOException) { }
        string path = Path.Combine(settings.LogsDirectory, "cria-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".log");
        lock (logGate) { log?.Dispose(); logBytes = 0; log = new StreamWriter(new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read)) { AutoFlush = true }; }
    }
    private void LogLine(string? line)
    {
        if (line == null) return;
        lock (logGate)
        {
            if (log == null || logBytes >= 16 * 1024 * 1024) return;
            string safe = DateTime.UtcNow.ToString("O") + " " + Clean(line.Length > 8192 ? line.Substring(0, 8192) : line);
            try { log.WriteLine(safe); logBytes += Encoding.UTF8.GetByteCount(safe) + 2; } catch (IOException) { logBytes = long.MaxValue; }
        }
    }
    private async Task StartService()
    {
        if (action || Alive || unresolved) return;
        action = true; Buttons();
        while (refreshing) await Task.Delay(50);
        try
        {
            LoadConnection();
            // Bind/lease checks do not establish ownership of vendor devices. The configured
            // ownership acknowledgement and absence of the former rig owner are required too.
            if ((bool?)Configuration()["ownershipConfirmed"] != true) throw new IOException("Rig ownership has not been confirmed in the configuration.");
            var previous = Process.GetProcessesByName("RemoteServer");
            try { if (previous.Length > 0) throw new IOException("Close ASCOM Remote Server before starting Cria. It is another possible owner of this rig."); }
            finally { foreach (var p in previous) p.Dispose(); }
            using (var listener = new System.Net.Sockets.TcpClient())
            {
                var connecting = listener.ConnectAsync("127.0.0.1", new Uri(localOrigin).Port);
                try { await connecting; throw new IOException("The configured port is already in use. Open the existing Cria window or stop the previous service."); }
                catch (System.Net.Sockets.SocketException) { }
            }
            Directory.CreateDirectory(dataDirectory);
            using (new FileStream(Path.Combine(dataDirectory, "service.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None)) { }
            OpenLog();
            var info = new ProcessStartInfo(settings.ApiExecutable, Quote(settings.Configuration))
            {
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                WorkingDirectory = Path.GetDirectoryName(settings.ApiExecutable)!
            };
            info.EnvironmentVariables["CRIA_TOKEN"] = token;
            var launched = new Process { StartInfo = info };
            launched.OutputDataReceived += (_, e) => LogLine(e.Data); launched.ErrorDataReceived += (_, e) => LogLine(e.Data);
            try { if (!launched.Start()) throw new IOException("The service could not start."); }
            catch { launched.Dispose(); throw; }
            process = launched;
            process.BeginOutputReadLine(); process.BeginErrorReadLine();
            stopRequested = false;
            ShutdownBlockReasonCreate(Handle, "Stop Cria to release astronomy drivers before shutting down Windows.");
            headline.Text = "Starting Cria…"; detail.Text = "If a camera setup window appears, select the guide camera by name and press OK.";
        }
        catch (Exception e) { headline.Text = "Cria could not start"; detail.Text = Clean(e.Message); LogLine(e.Message); }
        finally { action = false; Buttons(); }
    }
    private async Task<bool> StopService()
    {
        if (action) return false;
        action = true; Buttons();
        while (refreshing) await Task.Delay(50);
        try
        {
            var identity = await Get("/v2/service"); ValidateService(identity); service = identity;
            using var body = new StringContent(new JObject { ["instanceId"] = identity["instanceId"] }.ToString(Formatting.None), Encoding.UTF8, "application/json");
            using var response = await http.PostAsync(localOrigin + "/v2/service/stop", body);
            var result = JObject.Parse(await response.Content.ReadAsStringAsync());
            if (!response.IsSuccessStatusCode) throw new IOException((string?)result["error"]?["message"] ?? "Stop was not accepted.");
            stopRequested = true; headline.Text = "Stopping Cria…";
            detail.Text = "Waiting for driver release. Keep the computer powered on.";
            // UI stays responsive; a timeout is not permission to kill the API or workers.
            var began = Stopwatch.StartNew();
            while (Alive && began.Elapsed < TimeSpan.FromMinutes(6)) await Task.Delay(200);
            if (Alive) throw new IOException("Driver release is still pending. Check the logs; no process was force-stopped.");
            ReadExit(); return !unresolved;
        }
        catch (Exception e) { detail.Text = Clean(e.Message); LogLine(e.Message); MessageBox.Show(this, Clean(e.Message), "Cria could not finish stopping", MessageBoxButtons.OK, MessageBoxIcon.Information); return false; }
        finally { action = false; Buttons(); }
    }
    private void EditSettings()
    {
        if (Alive || service != null) return;
        try
        {
            using var editor = new SettingsWindow(Configuration(), settings.StartOnOpen);
            if (editor.ShowDialog(this) != DialogResult.OK) return;
            AtomicFile.Write(settings.Configuration, editor.Configuration.ToString(Formatting.Indented));
            settings.StartOnOpen = editor.StartOnOpen; settings.Save(); LoadConnection();
            detail.Text = "Settings saved. Start Cria to apply them.";
        }
        catch (Exception e) { MessageBox.Show(this, Clean(e.Message), "Cria settings", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
    protected override void WndProc(ref Message m)
    {
        if (m.Msg == 0x0011 && (Alive || service != null || action)) // WM_QUERYENDSESSION
        {
            ShutdownBlockReasonCreate(Handle, "Stop Cria first so astronomy driver release can be confirmed.");
            m.Result = IntPtr.Zero;
            return;
        }
        base.WndProc(ref m);
    }
}

internal sealed class SettingsWindow : Form
{
    public JObject Configuration { get; }
    private readonly NumericUpDown port = new() { Minimum = 1024, Maximum = 65535, Width = 130 };
    private readonly ComboBox network = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 480 };
    private readonly string currentHost;
    private readonly CheckBox auto = new() { Text = "Start Cria when I open the desktop app", AutoSize = true };
    public bool StartOnOpen => auto.Checked;
    public SettingsWindow(JObject configuration, bool startOnOpen)
    {
        Configuration = configuration;
        Text = "Cria settings"; Font = new Font("Segoe UI", 10); ClientSize = new Size(550, 315); FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; StartPosition = FormStartPosition.CenterParent;
        var uri = new Uri((string)configuration["listen"]!); port.Value = Math.Max(1024, uri.Port); auto.Checked = startOnOpen;
        currentHost = uri.Host;
        network.Items.AddRange(new object[] { "Only this computer", "All network connections", "Current network address (" + currentHost + ")" });
        network.SelectedIndex = uri.IsLoopback ? 0 : uri.Host == "0.0.0.0" ? 1 : 2;
        var panel = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, Dock = DockStyle.Fill, Padding = new Padding(20), WrapContents = false };
        panel.Controls.Add(new Label { Text = "Connection port", AutoSize = true }); panel.Controls.Add(port); panel.Controls.Add(new Label { Text = "Allow connections from", AutoSize = true }); panel.Controls.Add(network); panel.Controls.Add(auto);
        panel.Controls.Add(new Label { Text = "Network access requires your private token. Keep it on your trusted network or Tailscale. Changing the port also requires updating Vela.", MaximumSize = new Size(500, 0), AutoSize = true, Margin = new Padding(0, 12, 0, 12) });
        var save = new Button { Text = "Save", AutoSize = true };
        save.Click += (_, _) => { Configuration["listen"] = "http://" + (network.SelectedIndex == 0 ? "127.0.0.1" : network.SelectedIndex == 1 ? "0.0.0.0" : currentHost) + ":" + port.Value; DialogResult = DialogResult.OK; };
        panel.Controls.Add(save); Controls.Add(panel); AcceptButton = save;
    }
}
