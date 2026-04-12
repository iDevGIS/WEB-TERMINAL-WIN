Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class NativeMonitor {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion;
        public short dmSize, dmDriverExtra;
        public int dmFields;
        public int dmPositionX, dmPositionY;
        public int dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth, dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType;
        public int dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }

    public static string GetInfo(string device) {
        SetProcessDPIAware();
        var dm = new DEVMODE();
        dm.dmSize = (short)Marshal.SizeOf(dm);
        if (EnumDisplaySettings(device, -1, ref dm)) {
            return dm.dmPositionX + "|" + dm.dmPositionY + "|" + dm.dmPelsWidth + "|" + dm.dmPelsHeight;
        }
        return "";
    }
}
'@

Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$result = @()
foreach ($s in $screens) {
    $info = [NativeMonitor]::GetInfo($s.DeviceName)
    if ($info) {
        $parts = $info.Split('|')
        $result += [PSCustomObject]@{
            Name = $s.DeviceName
            X = [int]$parts[0]
            Y = [int]$parts[1]
            W = [int]$parts[2]
            H = [int]$parts[3]
            Primary = $s.Primary
        }
    }
}
$result | ConvertTo-Json -Compress
