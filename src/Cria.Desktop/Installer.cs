using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Cria.Desktop;

internal static class Installer
{
    public static string Install(string configuration, string tokenFile, string? settingsDirectory)
    {
        configuration = Path.GetFullPath(configuration);
        tokenFile = Path.GetFullPath(tokenFile);
        string desktop = Assembly.GetExecutingAssembly().Location;
        string release = Path.GetDirectoryName(Path.GetDirectoryName(desktop))!;
        string api = Path.Combine(release, "api", "Cria.Api.exe");
        if (!File.Exists(api)) throw new IOException("Extract the complete Windows package first.");
        var config = JObject.Parse(File.ReadAllText(configuration));
        if ((int?)config["version"] != 2 || (bool?)config["ownershipConfirmed"] != true)
            throw new IOException("Use the verified v2 rig configuration with explicit ownership confirmation.");
        var uri = new Uri((string?)config["listen"] ?? "");
        if (uri.Scheme != "http" || !System.Net.IPAddress.TryParse(uri.Host.Trim('[', ']'), out _) && !uri.IsLoopback)
            throw new IOException("Desktop control requires an IP address or localhost in the listen setting.");
        string token = File.ReadAllText(tokenFile).Trim();
        if (token.Length < 32 || token.Any(char.IsControl)) throw new IOException("The existing private token must have at least 32 characters and no control characters.");
        string directory = Path.GetFullPath(settingsDirectory ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Cria", "Desktop"));
        string stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-fffffff");
        bool directoryExisted = Directory.Exists(directory);
        string? priorAcl = directoryExisted ? Directory.GetAccessControl(directory).GetSecurityDescriptorSddlForm(AccessControlSections.Access | AccessControlSections.Owner | AccessControlSections.Group) : null;
        Directory.CreateDirectory(directory);
        string aclBackup = Path.Combine(directory, "directory-acl-before-" + stamp + ".sddl");
        if (priorAcl != null) File.WriteAllText(aclBackup, priorAcl, new UTF8Encoding(false));
        var acl = new DirectorySecurity();
        acl.SetAccessRuleProtection(true, false);
        foreach (var identity in new[] { WindowsIdentity.GetCurrent().User!, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null) })
            acl.AddAccessRule(new FileSystemAccessRule(identity, FileSystemRights.FullControl, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        Directory.SetAccessControl(directory, acl);
        string settingsPath = Path.Combine(directory, "desktop.json"), tokenPath = Path.Combine(directory, "token.dpapi");
        foreach (string path in new[] { settingsPath, tokenPath })
            if (File.Exists(path)) File.Copy(path, path + ".backup-" + stamp);
        byte[] clear = Encoding.UTF8.GetBytes(token);
        try { File.WriteAllBytes(tokenPath, ProtectedData.Protect(clear, null, DataProtectionScope.CurrentUser)); }
        finally { Array.Clear(clear, 0, clear.Length); }
        var settings = new Settings
        {
            Configuration = configuration, ApiExecutable = api, ProtectedToken = tokenPath,
            LogsDirectory = Path.Combine(directory, "logs"), StartOnOpen = true
        };
        AtomicFile.Write(settingsPath, JsonConvert.SerializeObject(settings, Formatting.Indented));
        string shortcutPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Cria.lnk");
        if (File.Exists(shortcutPath)) File.Copy(shortcutPath, Path.Combine(directory, "Cria.lnk.backup-" + stamp));
        object shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
        object? shortcut = null;
        try
        {
            shortcut = shell.GetType().InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
            void Set(string name, string value) => shortcut!.GetType().InvokeMember(name, BindingFlags.SetProperty, null, shortcut, new object[] { value });
            Set("TargetPath", desktop); Set("Arguments", "\"" + settingsPath + "\""); Set("WorkingDirectory", release);
            Set("Description", "Start and stop the local Cria rig service");
            shortcut!.GetType().InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, Array.Empty<object>());
        }
        finally
        {
            if (shortcut != null) Marshal.FinalReleaseComObject(shortcut);
            Marshal.FinalReleaseComObject(shell);
        }
        AtomicFile.Write(Path.Combine(directory, "install-receipt.json"), JsonConvert.SerializeObject(new
        {
            installedAt = DateTime.UtcNow, release, configuration, settingsPath, shortcutPath, backupSuffix = ".backup-" + stamp,
            tokenProtection = "Windows DPAPI CurrentUser", automaticWindowsStartup = false,
            directoryExisted, priorDirectoryAcl = priorAcl == null ? null : aclBackup
        }, Formatting.Indented));
        return shortcutPath;
    }
}
