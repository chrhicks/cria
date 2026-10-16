using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using Cria.Contracts;
using Cria.Driver;
using Cria.Driver.Windows;
using StreamJsonRpc;

if (args.Length != 2) throw new ArgumentException("Cria.Driver.Windows CONFIG PIPE");
var config = Wire.Decode<WorkerConfiguration>(File.ReadAllText(args[0]));
if (config.Fixture || !config.OwnershipConfirmed || !Guid.TryParse(config.BindingId, out _) || !config.Binding.ProgId.StartsWith("ASCOM.", StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Explicit real-driver ownership and ASCOM binding required");
Directory.CreateDirectory(Path.Combine(config.DataDirectory, "pending"));
var owner = new StaOwner(config);
var service = new DriverService(config, owner);
var security = new PipeSecurity();
security.SetAccessRuleProtection(true, false);
security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User!, PipeAccessRights.FullControl, AccessControlType.Allow));
using (var pipe = new NamedPipeServerStream(args[1], PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 65536, 65536, security))
{
    Console.CancelKeyPress += (_, e) => { e.Cancel = true; _ = Task.Run(async () => { if (!await service.CloseAsync()) Console.Error.WriteLine("Ownership unresolved; process retained"); }); };
    Console.WriteLine("Driver pipe ready");
    await pipe.WaitForConnectionAsync();
    using (var rpc = new JsonRpc(pipe))
    {
        rpc.AddLocalRpcTarget<IDriverRpc>(service, new JsonRpcTargetOptions());
        rpc.StartListening();
        await service.Stop.Task;
    }
}
