using System.IO.Pipes;
using Cria.Contracts;
using Cria.Driver;
using StreamJsonRpc;

if (args.Length != 2) throw new ArgumentException("Fixture CONFIG PIPE");
var config = Wire.Decode<WorkerConfiguration>(File.ReadAllText(args[0]));
if (!config.Fixture || !config.Binding.ProgId.StartsWith("Cria.Fixture.", StringComparison.Ordinal)) throw new InvalidDataException("Fixture binding required");
var device = new FixtureDevice(config);
var owner = new FixtureOwner(device);
var service = new DriverService(config, owner, device.Control, device.Publication);
using var pipe = new NamedPipeServerStream(args[1], PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
await pipe.WaitForConnectionAsync();
using var rpc = new JsonRpc(pipe);
rpc.AddLocalRpcTarget<IDriverRpc>(service, new JsonRpcTargetOptions());
rpc.StartListening();
await service.Stop.Task;
