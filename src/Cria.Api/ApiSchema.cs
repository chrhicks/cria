using Newtonsoft.Json.Linq;
namespace Cria.Api;

internal static class ApiSchema
{
    public static readonly JObject Document = Load();
    private static JObject Load()
    {
        using var stream = typeof(ApiSchema).Assembly.GetManifestResourceStream("Cria.OpenApi.json")!;
        using var reader = new StreamReader(stream);
        return JObject.Parse(reader.ReadToEnd());
    }
}
