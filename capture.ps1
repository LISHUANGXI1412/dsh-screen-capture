param(
  [Parameter(Mandatory = $true)][string]$Out,
  [ValidateSet('screen', 'window', 'foreground', 'region')][string]$Mode = 'screen',
  [int]$Monitor = -1,
  [string]$Title = '',
  [int]$X = 0,
  [int]$Y = 0,
  [int]$W = 0,
  [int]$H = 0,
  [int]$MaxWidth = 1600
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class WinShot {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }

  public static List<string> Titles = new List<string>();
  public static IntPtr Found = IntPtr.Zero;
  public static string Needle = "";

  public static bool Cb(IntPtr h, IntPtr l) {
    if (!IsWindowVisible(h)) return true;
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    var t = sb.ToString();
    if (t.Length == 0) return true;
    Titles.Add(t);
    if (Needle.Length > 0 && Found == IntPtr.Zero && t.IndexOf(Needle, StringComparison.OrdinalIgnoreCase) >= 0) Found = h;
    return true;
  }

  public static IntPtr FindByTitle(string needle) {
    Needle = needle; Found = IntPtr.Zero; Titles.Clear();
    EnumWindows(new EnumProc(Cb), IntPtr.Zero);
    return Found;
  }

  public static string[] AllTitles() {
    Needle = ""; Found = IntPtr.Zero; Titles.Clear();
    EnumWindows(new EnumProc(Cb), IntPtr.Zero);
    return Titles.ToArray();
  }

  public static RECT VisibleBounds(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) == 0) return r;
    GetWindowRect(h, out r);
    return r;
  }
}
"@

[WinShot]::SetProcessDPIAware() | Out-Null

function Fail([string]$message, [int]$code = 1) {
  @{ error = $message } | ConvertTo-Json -Compress -Depth 4 | Write-Output
  exit $code
}

function CaptureRect([int]$left, [int]$top, [int]$width, [int]$height) {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
  $l = [Math]::Max($left, $vs.Left)
  $t = [Math]::Max($top, $vs.Top)
  $r = [Math]::Min($left + $width, $vs.Left + $vs.Width)
  $b = [Math]::Min($top + $height, $vs.Top + $vs.Height)
  $w = $r - $l
  $h = $b - $t
  if ($w -le 0 -or $h -le 0) { Fail 'capture area is outside the virtual screen' }

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.CopyFromScreen($l, $t, 0, 0, $bmp.Size)
  } finally {
    $g.Dispose()
  }
  return @{ bitmap = $bmp; left = $l; top = $t; width = $w; height = $h }
}

$capture = $null

switch ($Mode) {
  'screen' {
    if ($Monitor -ge 0) {
      $screens = [System.Windows.Forms.Screen]::AllScreens
      if ($Monitor -ge $screens.Count) { Fail ("monitor index {0} does not exist ({1} displays)" -f $Monitor, $screens.Count) }
      $b = $screens[$Monitor].Bounds
      $capture = CaptureRect $b.Left $b.Top $b.Width $b.Height
    } else {
      $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
      $capture = CaptureRect $b.Left $b.Top $b.Width $b.Height
    }
  }
  'foreground' {
    $hWin = [WinShot]::GetForegroundWindow()
    if ($hWin -eq [IntPtr]::Zero) { Fail 'no foreground window' }
    if ([WinShot]::IsIconic($hWin)) { Fail 'the foreground window is minimized' }
    $r = [WinShot]::VisibleBounds($hWin)
    $capture = CaptureRect $r.Left $r.Top ($r.Right - $r.Left) ($r.Bottom - $r.Top)
  }
  'window' {
    if ($Title -eq '') {
      $hWin = [WinShot]::GetForegroundWindow()
    } else {
      $hWin = [WinShot]::FindByTitle($Title)
      if ($hWin -eq [IntPtr]::Zero) {
        $titles = @([WinShot]::AllTitles() | Select-Object -First 40)
        @{ error = 'window-not-found'; titles = $titles } | ConvertTo-Json -Compress -Depth 4 | Write-Output
        exit 2
      }
    }
    if ([WinShot]::IsIconic($hWin)) { Fail 'the target window is minimized, restore it first' }
    $r = [WinShot]::VisibleBounds($hWin)
    $capture = CaptureRect $r.Left $r.Top ($r.Right - $r.Left) ($r.Bottom - $r.Top)
  }
  'region' {
    if ($W -le 0 -or $H -le 0) { Fail 'region mode needs a positive width and height' }
    $capture = CaptureRect $X $Y $W $H
  }
}

$bitmap = $capture.bitmap
$srcW = $bitmap.Width
$srcH = $bitmap.Height

if ($MaxWidth -gt 0 -and $bitmap.Width -gt $MaxWidth) {
  $ratio = $MaxWidth / $bitmap.Width
  $dw = [int][Math]::Round($bitmap.Width * $ratio)
  $dh = [int][Math]::Round($bitmap.Height * $ratio)
  $small = New-Object System.Drawing.Bitmap $dw, $dh
  $sg = [System.Drawing.Graphics]::FromImage($small)
  try {
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.DrawImage($bitmap, 0, 0, $dw, $dh)
  } finally {
    $sg.Dispose()
  }
  $bitmap.Dispose()
  $bitmap = $small
}

$dir = [System.IO.Path]::GetDirectoryName($Out)
if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)

$result = [ordered]@{
  path         = $Out
  mode         = $Mode
  width        = $bitmap.Width
  height       = $bitmap.Height
  sourceWidth  = $srcW
  sourceHeight = $srcH
  bounds       = [ordered]@{ x = $capture.left; y = $capture.top; width = $capture.width; height = $capture.height }
}
$bitmap.Dispose()

$result | ConvertTo-Json -Compress -Depth 4 | Write-Output
