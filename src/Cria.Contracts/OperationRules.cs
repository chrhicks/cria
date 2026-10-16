using Newtonsoft.Json.Linq;

namespace Cria.Contracts;

public static class OperationRules
{
    public static readonly Dictionary<string, string> Kinds = new Dictionary<string, string>
    {
        ["capture"] = "camera",
        ["camera-configure"] = "camera",
        ["cooling"] = "camera",
        ["focuser-move"] = "focuser",
        ["focuser-halt"] = "focuser",
        ["mount-slew"] = "mount",
        ["mount-home"] = "mount",
        ["mount-stop"] = "mount",
        ["mount-tracking"] = "mount",
        ["mount-park"] = "mount",
        ["mount-unpark"] = "mount",
        ["mount-axis"] = "mount",
        ["mount-rotate"] = "mount",
        ["switch-set"] = "switch",
        ["device-connect"] = "*"
    };
    public static void Validate(OperationRequest request)
    {
        if (request == null || !Guid.TryParse(request.InstanceId, out _) || !Guid.TryParse(request.BindingId, out _) ||
            string.IsNullOrWhiteSpace(request.RequestId) || request.RequestId.Length > 128 || request.RequestId.Any(char.IsControl) ||
            string.IsNullOrWhiteSpace(request.DeviceId) || request.DeviceId.Length > 64 || string.IsNullOrWhiteSpace(request.ExpectedName) || request.ExpectedName.Length > 256 ||
            !Kinds.ContainsKey(request.Kind) || request.Parameters == null)
            throw new ArgumentException("Invalid operation identity or kind");
        var p = request.Parameters;
        switch (request.Kind)
        {
            case "capture":
                Allowed(p, "exposureSeconds", "light", "monochromeOnly");
                Number(p, "exposureSeconds", .000001, 3600);
                Boolean(p, "light");
                OptionalBool(p, "monochromeOnly");
                break;
            case "camera-configure":
                Allowed(p, "binX", "binY", "startX", "startY", "width", "height", "gain", "offset");
                Nonempty(p);
                foreach (var x in p.Properties())
                    Number(p, x.Name, x.Name == "startX" || x.Name == "startY" || x.Name == "gain" || x.Name == "offset" ? 0 : 1, 1000000, true);
                break;
            case "cooling":
                Allowed(p, "coolerOn", "setpointC");
                Nonempty(p);
                OptionalBool(p, "coolerOn");
                if (p["setpointC"] != null)
                    Number(p, "setpointC", -100, 100);
                break;
            case "focuser-move":
                Allowed(p, "position", "minPosition", "maxPosition");
                var target = Number(p, "position", 1, int.MaxValue - 1, true);
                var min = Number(p, "minPosition", 1, int.MaxValue - 1, true);
                var max = Number(p, "maxPosition", 1, int.MaxValue - 1, true);
                if (min > max || target < min || target > max)
                    throw new ArgumentException("Target is outside the requested focuser travel window");
                break;
            case "mount-slew":
                Allowed(p, "rightAscensionDegrees", "declinationDegrees", "coordinateSystem");
                Number(p, "rightAscensionDegrees", 0, 359.999999999);
                Number(p, "declinationDegrees", -90, 90);
                if (!new[] { "topocentric", "j2000", "j2050", "b1950" }.Contains((string?)p["coordinateSystem"]))
                    throw new ArgumentException("A known driver coordinate system is required");
                break;
            case "mount-tracking":
                Allowed(p, "tracking");
                Boolean(p, "tracking");
                break;
            case "mount-axis":
            case "mount-rotate":
                var amount = request.Kind == "mount-axis" ? "durationSeconds" : "distanceDegrees";
                Allowed(p, "rateDegreesPerSecond", amount);
                if (Number(p, "rateDegreesPerSecond", -10, 10) == 0)
                    throw new ArgumentException("Nonzero rate required");
                if (Number(p, amount, request.Kind == "mount-axis" ? .001 : -120, 120) == 0)
                    throw new ArgumentException("Nonzero travel required");
                break;
            case "switch-set":
                Allowed(p, "channelId", "value");
                Number(p, "channelId", 0, 63, true);
                Number(p, "value", -1e12, 1e12);
                break;
            case "device-connect":
                Allowed(p, "connected");
                Boolean(p, "connected");
                break;
            default:
                Allowed(p);
                break;
        }
    }
    public static double Number(JObject p, string key, double min, double max, bool integer = false)
    {
        var t = p[key];
        if (t == null || (t.Type != JTokenType.Integer && t.Type != JTokenType.Float))
            throw new ArgumentException("Numeric " + key + " required");
        double v = (double)t;
        if (!Wire.Finite(v) || v < min || v > max || (integer && Math.Truncate(v) != v))
            throw new ArgumentException("Invalid " + key);
        return v;
    }
    public static bool Boolean(JObject p, string key)
    {
        if (p[key]?.Type != JTokenType.Boolean)
            throw new ArgumentException("Boolean " + key + " required");
        return (bool)p[key]!;
    }
    private static void OptionalBool(JObject p, string key)
    {
        if (p[key] != null)
            Boolean(p, key);
    }
    private static void Nonempty(JObject p)
    {
        if (!p.HasValues)
            throw new ArgumentException("At least one setting required");
    }
    private static void Allowed(JObject p, params string[] keys)
    {
        if (p.Properties().Any(x => !keys.Contains(x.Name)))
            throw new ArgumentException("Unknown operation parameter");
    }
}
