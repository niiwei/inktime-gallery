param(
  [Parameter(Mandatory = $false)]
  [string]$WallpaperPath
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

[ComImport]
[Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")]
public class DesktopWallpaperClass { }

[ComImport]
[Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDesktopWallpaper {
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorId, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorId);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
    uint GetMonitorDevicePathCount();
    void GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorId, out RECT rect);
}

[StructLayout(LayoutKind.Sequential)]
public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}
"@

$desktop = [IDesktopWallpaper](New-Object DesktopWallpaperClass)
$primaryMonitor = $null
for ($index = 0; $index -lt $desktop.GetMonitorDevicePathCount(); $index++) {
  $monitor = $desktop.GetMonitorDevicePathAt([uint32]$index)
  $rect = New-Object RECT
  $desktop.GetMonitorRECT($monitor, [ref]$rect)
  if ($rect.Left -eq 0 -and $rect.Top -eq 0 -and $rect.Right -gt 0 -and $rect.Bottom -gt 0) {
    $primaryMonitor = $monitor
    break
  }
}
if (-not $primaryMonitor) { throw "Could not find the primary monitor." }
if ($WallpaperPath) {
  $resolved = [System.IO.Path]::GetFullPath($WallpaperPath)
  if (-not [System.IO.File]::Exists($resolved)) { throw "Wallpaper file does not exist: $resolved" }
  $desktop.SetWallpaper($primaryMonitor, $resolved)
}

$confirmedPath = $desktop.GetWallpaper($primaryMonitor).Trim()
if (-not $confirmedPath) { throw "IDesktopWallpaper returned an empty wallpaper path." }

if ($WallpaperPath) {
  $expected = [System.IO.Path]::GetFullPath($WallpaperPath)
  if (-not [string]::Equals($expected, [System.IO.Path]::GetFullPath($confirmedPath), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Windows did not confirm wallpaper change. target=$expected current=$confirmedPath"
  }
}

[ordered]@{ path = $confirmedPath } | ConvertTo-Json -Compress
