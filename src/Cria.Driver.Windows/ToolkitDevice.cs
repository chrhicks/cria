using ASCOM.Com.DriverAccess;
using ASCOM.Common.Alpaca;
using ASCOM.Common.DeviceInterfaces;
using Cria.Contracts;
using Cria.Driver;
using Camera = ASCOM.Com.DriverAccess.Camera;

namespace Cria.Driver.Windows;

internal sealed class ToolkitDevice : IDevice
{
    private readonly ASCOMDevice device;
    private readonly int maxPixels;
    public ToolkitDevice(Binding b, int maxPixels)
    {
        this.maxPixels = maxPixels;
        device = b.Kind switch
        {
            "camera" => new Camera(b.ProgId),
            "mount" => new Telescope(b.ProgId),
            "focuser" => new Focuser(b.ProgId),
            "weather" => new ObservingConditions(b.ProgId),
            "switch" => new Switch(b.ProgId),
            _ => throw new InvalidDataException("Unsupported driver kind")
        };
    }
    public bool IsIdle => !device.Connected || device switch { Camera c => c.CameraState == CameraState.Idle, Telescope t => !t.Slewing && !t.IsPulseGuiding, Focuser f => !f.IsMoving, _ => true };
    public void Setup() => device.SetupDialog();
    public void Dispose() => device.Dispose();
    public object? Read(string member, int channel = 0)
    {
        try
        {
            return ReadCore(member, (short)channel);
        }
        // Toolkit DynamicAccess normalizes a driver's not-implemented HRESULT
        // to the base ASCOM exception, including for property reads.
        catch (ASCOM.NotImplementedException e) { throw new Unsupported(e.Message); }
    }
    private object? ReadCore(string m, short id)
    {
        if (m == "name")
            return device.Name;
        if (m == "connected")
            return device.Connected;
        return device switch
        {
            Camera c => m switch
            {
                "camerastate" => (int)c.CameraState,
                "imageready" => c.ImageReady,
                "ccdtemperature" => c.CCDTemperature,
                "cooleron" => c.CoolerOn,
                "setccdtemperature" => c.SetCCDTemperature,
                "coolerpower" => c.CoolerPower,
                "cansetccdtemperature" => c.CanSetCCDTemperature,
                "cangetcoolerpower" => c.CanGetCoolerPower,
                "canabortexposure" => c.CanAbortExposure,
                "canstopexposure" => c.CanStopExposure,
                "numx" => c.NumX,
                "numy" => c.NumY,
                "binx" => c.BinX,
                "biny" => c.BinY,
                "startx" => c.StartX,
                "starty" => c.StartY,
                "sensortype" => (int)c.SensorType,
                "bayeroffsetx" => c.BayerOffsetX,
                "bayeroffsety" => c.BayerOffsetY,
                "cameraxsize" => c.CameraXSize,
                "cameraysize" => c.CameraYSize,
                "pixelsizex" => c.PixelSizeX,
                "pixelsizey" => c.PixelSizeY,
                "maxbinx" => c.MaxBinX,
                "maxbiny" => c.MaxBinY,
                "canasymmetricbin" => c.CanAsymmetricBin,
                "exposuremin" => c.ExposureMin,
                "exposuremax" => c.ExposureMax,
                "exposureresolution" => c.ExposureResolution,
                "lastexposurestarttime" => c.LastExposureStartTime,
                "gain" => c.Gain,
                "gainmin" => c.GainMin,
                "gainmax" => c.GainMax,
                "gains" => c.Gains.ToArray(),
                "offset" => c.Offset,
                "offsetmin" => c.OffsetMin,
                "offsetmax" => c.OffsetMax,
                "offsets" => c.Offsets.ToArray(),
                _ => throw new Unsupported(m)
            },
            Telescope t => m switch
            {
                "rightascension" => t.RightAscension,
                "declination" => t.Declination,
                "slewing" => t.Slewing,
                "tracking" => t.Tracking,
                "atpark" => t.AtPark,
                "athome" => t.AtHome,
                "siderealtime" => t.SiderealTime,
                "equatorialsystem" => (int)t.EquatorialSystem,
                "sitelatitude" => t.SiteLatitude,
                "sitelongitude" => t.SiteLongitude,
                "siteelevation" => t.SiteElevation,
                "trackingrate" => (int)t.TrackingRate,
                "rightascensionrate" => t.RightAscensionRate,
                "declinationrate" => t.DeclinationRate,
                "sideofpier" => (int)t.SideOfPier,
                "canslewasync" => t.CanSlewAsync,
                "cansettracking" => t.CanSetTracking,
                "canfindhome" => t.CanFindHome,
                "canpark" => t.CanPark,
                "canunpark" => t.CanUnpark,
                "canmoveaxis" => t.CanMoveAxis(TelescopeAxis.Primary),
                "axisrates" => Rates(t),
                _ => throw new Unsupported(m)
            },
            Focuser f => m switch { "position" => f.Position, "ismoving" => f.IsMoving, "temperature" => f.Temperature, "absolute" => f.Absolute, "maxstep" => f.MaxStep, "maxincrement" => f.MaxIncrement, "stepsize" => f.StepSize, "tempcomp" => f.TempComp, "tempcompavailable" => f.TempCompAvailable, _ => throw new Unsupported(m) },
            ObservingConditions w => m switch { "temperature" => w.Temperature, "humidity" => w.Humidity, "dewpoint" => w.DewPoint, "pressure" => w.Pressure, "cloudcover" => w.CloudCover, "rainrate" => w.RainRate, "skybrightness" => w.SkyBrightness, "skyquality" => w.SkyQuality, "skytemperature" => w.SkyTemperature, "starfwhm" => w.StarFWHM, "winddirection" => w.WindDirection, "windgust" => w.WindGust, "windspeed" => w.WindSpeed, _ => throw new Unsupported(m) },
            Switch s => m switch { "maxswitch" => s.MaxSwitch, "getswitchname" => s.GetSwitchName(id), "getswitchdescription" => s.GetSwitchDescription(id), "canwrite" => s.CanWrite(id), "minswitchvalue" => s.MinSwitchValue(id), "maxswitchvalue" => s.MaxSwitchValue(id), "switchstep" => s.SwitchStep(id), "getswitch" => s.GetSwitch(id), "getswitchvalue" => s.GetSwitchValue(id), _ => throw new Unsupported(m) },
            _ => throw new Unsupported(m)
        };
    }
    private static object[] Rates(Telescope telescope)
    {
        var values = new List<object>();
        var rates = telescope.AxisRates(TelescopeAxis.Primary);
        try
        {
            foreach (IRate rate in rates)
                values.Add(new
                {
                    minimum = rate.Minimum,
                    maximum = rate.Maximum
                });
        }
        finally { rates.Dispose(); }
        return values.ToArray();
    }
    public void Write(string member, object value, int channel = 0)
    {
        if (member == "connected")
        {
            device.Connected = Convert.ToBoolean(value);
            return;
        }
        switch (device)
        {
            case Camera c:
                switch (member)
                {
                    case "cooleron":
                        c.CoolerOn = Convert.ToBoolean(value);
                        return;
                    case "setccdtemperature":
                        c.SetCCDTemperature = Convert.ToDouble(value);
                        return;
                    case "binx":
                        c.BinX = Convert.ToInt16(value);
                        return;
                    case "biny":
                        c.BinY = Convert.ToInt16(value);
                        return;
                    case "startx":
                        c.StartX = Convert.ToInt32(value);
                        return;
                    case "starty":
                        c.StartY = Convert.ToInt32(value);
                        return;
                    case "numx":
                        c.NumX = Convert.ToInt32(value);
                        return;
                    case "numy":
                        c.NumY = Convert.ToInt32(value);
                        return;
                    case "gain":
                        c.Gain = Convert.ToInt16(value);
                        return;
                    case "offset":
                        c.Offset = Convert.ToInt32(value);
                        return;
                }
                break;
            case Telescope t:
                if (member == "tracking")
                {
                    t.Tracking = Convert.ToBoolean(value);
                    return;
                }
                break;
            case Switch s:
                if (member == "setswitchvalue")
                {
                    s.SetSwitchValue((short)channel, Convert.ToDouble(value));
                    return;
                }
                break;
        }
        throw new Unsupported(member);
    }
    public void Command(string member, params object[] a)
    {
        switch (device)
        {
            case Camera c:
                switch (member)
                {
                    case "startexposure":
                        c.StartExposure(Convert.ToDouble(a[0]), Convert.ToBoolean(a[1]));
                        return;
                    case "abortexposure":
                        c.AbortExposure();
                        return;
                }
                break;
            case Focuser f:
                switch (member)
                {
                    case "move":
                        f.Move(Convert.ToInt32(a[0]));
                        return;
                    case "halt":
                        f.Halt();
                        return;
                }
                break;
            case Telescope t:
                switch (member)
                {
                    case "slewtocoordinatesasync":
                        t.SlewToCoordinatesAsync(Convert.ToDouble(a[0]), Convert.ToDouble(a[1]));
                        return;
                    case "abortslew":
                        t.AbortSlew();
                        return;
                    case "findhome":
                        t.FindHome();
                        return;
                    case "park":
                        t.Park();
                        return;
                    case "unpark":
                        t.Unpark();
                        return;
                    case "moveaxis":
                        t.MoveAxis((TelescopeAxis)Convert.ToInt32(a[0]), Convert.ToDouble(a[1]));
                        return;
                }
                break;
        }
        throw new Unsupported(member);
    }
    public byte[] Image()
    {
        if (!(device is Camera c) || c.NumX < 1 || c.NumY < 1 || (long)c.NumX * c.NumY > maxPixels)
            throw new InvalidDataException("Invalid camera geometry");
        if (!(c.ImageArray is int[,] pixels) || pixels.GetLowerBound(0) != 0 || pixels.GetLowerBound(1) != 0 || pixels.LongLength > maxPixels)
            throw new InvalidDataException("Rank-2 Int32 driver pixels required");
        return pixels.ToByteArray(1, 1, 0, AlpacaErrors.AlpacaNoError, "");
    }
}
