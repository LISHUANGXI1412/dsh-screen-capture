param(
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$MaxWidth = 0,
  [string]$AutoRect = '',
  [int]$TimeoutSeconds = 120,
  [switch]$HideWindow,
  [string]$HideTitle = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class ShotPickNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

[ShotPickNative]::SetProcessDPIAware() | Out-Null

function Write-Outcome($payload) {
  $payload | ConvertTo-Json -Compress -Depth 4 | Write-Output
}

try {
  $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen

  $hidden = [IntPtr]::Zero
  $hiddenProc = $null
  if ($HideWindow) {
    $targets = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 })
    $match = $null
    if ($HideTitle -ne '') {
      $match = $targets | Where-Object { $_.MainWindowTitle -like ('*' + $HideTitle + '*') } | Select-Object -First 1
    }
    if ($null -eq $match) {
      $match = $targets | Where-Object {
        $_.ProcessName -like 'DSH*' -or $_.MainWindowTitle -like '*DeepSeek Harness*'
      } | Select-Object -First 1
    }
    if ($null -ne $match) {
      $hidden = $match.MainWindowHandle
      $hiddenProc = $match
      [void][ShotPickNative]::ShowWindow($hidden, 0)
      Start-Sleep -Milliseconds 320
    }
  }

  try {
    $screen = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
    $g = [System.Drawing.Graphics]::FromImage($screen)
    try {
      $g.CopyFromScreen($vs.Left, $vs.Top, 0, 0, $screen.Size)
    } finally {
      $g.Dispose()
    }
  } finally {
    if ($hidden -ne [IntPtr]::Zero) {
      [void][ShotPickNative]::ShowWindow($hidden, 5)
      [void][ShotPickNative]::SetForegroundWindow($hidden)
      $hidden = [IntPtr]::Zero
    }
  }

  $dimmed = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
  $dg = [System.Drawing.Graphics]::FromImage($dimmed)
  try {
    $dg.DrawImageUnscaled($screen, 0, 0)
    $db = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 0, 0, 0))
    $dg.FillRectangle($db, 0, 0, $vs.Width, $vs.Height)
    $db.Dispose()
  } finally {
    $dg.Dispose()
  }

  $selection = $null

  if ($AutoRect -ne '') {
    $parts = $AutoRect.Split(',')
    if ($parts.Count -ne 4) { throw 'AutoRect expects x,y,width,height' }
    $selection = New-Object System.Drawing.Rectangle ([int]$parts[0]), ([int]$parts[1]), ([int]$parts[2]), ([int]$parts[3])
  } else {
    $state = @{ start = $null; cur = $null; dragging = $false }

    $form = New-Object System.Windows.Forms.Form
    $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual
    $form.Bounds = New-Object System.Drawing.Rectangle $vs.Left, $vs.Top, $vs.Width, $vs.Height
    $form.TopMost = $true
    $form.ShowInTaskbar = $false
    $form.Cursor = [System.Windows.Forms.Cursors]::Cross
    $form.KeyPreview = $true
    $form.BackColor = [System.Drawing.Color]::Black

    # Flicker fix: paint into a back buffer instead of the live surface.
    $flags = [System.Reflection.BindingFlags]::Instance -bor [System.Reflection.BindingFlags]::NonPublic
    $setStyle = [System.Windows.Forms.Control].GetMethod('SetStyle', $flags)
    if ($null -ne $setStyle) {
      $style = [System.Windows.Forms.ControlStyles]::OptimizedDoubleBuffer -bor `
        [System.Windows.Forms.ControlStyles]::AllPaintingInWmPaint -bor `
        [System.Windows.Forms.ControlStyles]::UserPaint
      [void]$setStyle.Invoke($form, @($style, $true))
    }

    function Get-Selection {
      if ($null -eq $state.start -or $null -eq $state.cur) { return $null }
      $x1 = [Math]::Min($state.start.X, $state.cur.X)
      $y1 = [Math]::Min($state.start.Y, $state.cur.Y)
      $x2 = [Math]::Max($state.start.X, $state.cur.X)
      $y2 = [Math]::Max($state.start.Y, $state.cur.Y)
      return New-Object System.Drawing.Rectangle $x1, $y1, ($x2 - $x1), ($y2 - $y1)
    }

    $form.add_Shown({
      [void][ShotPickNative]::SetForegroundWindow($form.Handle)
      $form.Activate()
    })

    $form.add_Paint({
      param($sender, $e)
      $e.Graphics.DrawImageUnscaled($dimmed, 0, 0)
      $rect = Get-Selection
      if ($null -ne $rect -and $rect.Width -gt 0 -and $rect.Height -gt 0) {
        $e.Graphics.SetClip($rect)
        $e.Graphics.DrawImageUnscaled($screen, 0, 0)
        $e.Graphics.ResetClip()
        $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 74, 163, 255)), 2
        $e.Graphics.DrawRectangle($pen, $rect)
        $pen.Dispose()

        $label = "$($rect.Width) x $($rect.Height)"
        $labelFont = New-Object System.Drawing.Font('Microsoft YaHei', 11)
        $labelSize = $e.Graphics.MeasureString($label, $labelFont)
        $lx = [Math]::Max(0, [Math]::Min(($rect.X + 4), ($vs.Width - $labelSize.Width - 18)))
        $ly = $rect.Y - $labelSize.Height - 16
        if ($ly -lt 0) { $ly = $rect.Y + 8 }
        $ly = [Math]::Max(0, [Math]::Min($ly, ($vs.Height - $labelSize.Height - 12)))
        $lbg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(190, 0, 0, 0))
        $lfg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
        $e.Graphics.FillRectangle($lbg, ($lx - 6), ($ly - 3), ($labelSize.Width + 12), ($labelSize.Height + 6))
        $e.Graphics.DrawString($label, $labelFont, $lfg, $lx, $ly)
        $lfg.Dispose(); $lbg.Dispose(); $labelFont.Dispose()
      }
      $font = New-Object System.Drawing.Font('Microsoft YaHei', 13)
      $text = '拖动鼠标框选区域；Esc 或右键取消'
      $size = $e.Graphics.MeasureString($text, $font)
      $tx = [int](($vs.Width - $size.Width) / 2)
      $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(170, 0, 0, 0))
      $fg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
      $e.Graphics.FillRectangle($bg, ($tx - 18), 18, ($size.Width + 36), ($size.Height + 18))
      $e.Graphics.DrawString($text, $font, $fg, $tx, 26)
      $fg.Dispose(); $bg.Dispose(); $font.Dispose()
    })

    $form.add_MouseDown({
      param($sender, $e)
      if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Right) {
        $script:cancelled = $true
        $form.Close()
        return
      }
      if ($e.Button -ne [System.Windows.Forms.MouseButtons]::Left) { return }
      $state.start = $e.Location
      $state.cur = $e.Location
      $state.dragging = $true
      $form.Invalidate()
    })

    $form.add_MouseMove({
      param($sender, $e)
      if (-not $state.dragging) { return }
      $state.cur = $e.Location
      $form.Invalidate()
    })

    $form.add_MouseUp({
      param($sender, $e)
      if (-not $state.dragging) { return }
      $state.dragging = $false
      $rect = Get-Selection
      if ($null -eq $rect -or $rect.Width -lt 4 -or $rect.Height -lt 4) {
        $script:cancelled = $true
        $form.Close()
        return
      }
      $script:picked = $rect
      $form.Close()
    })

    $form.add_KeyDown({
      param($sender, $e)
      if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) {
        $script:cancelled = $true
        $form.Close()
      }
    })

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = [Math]::Max(1000, $TimeoutSeconds * 1000)
    $timer.add_Tick({
      $script:cancelled = $true
      $form.Close()
    })
    $timer.Start()

    [void]$form.ShowDialog()

    $timer.Stop()
    $timer.Dispose()
    $form.Dispose()

    if ($script:cancelled -or $null -eq $script:picked) {
      $dimmed.Dispose()
      $screen.Dispose()
      Write-Outcome @{ ok = $false; cancelled = $true }
      exit 0
    }
    $selection = $script:picked
  }

  $rect = New-Object System.Drawing.Rectangle 0, 0, $selection.Width, $selection.Height
  $crop = New-Object System.Drawing.Bitmap $selection.Width, $selection.Height
  $cg = [System.Drawing.Graphics]::FromImage($crop)
  try {
    $cg.DrawImage($screen, $rect, $selection, [System.Drawing.GraphicsUnit]::Pixel)
  } finally {
    $cg.Dispose()
    $screen.Dispose()
    $dimmed.Dispose()
  }

  $srcW = $crop.Width
  $srcH = $crop.Height
  if ($MaxWidth -gt 0 -and $crop.Width -gt $MaxWidth) {
    $ratio = $MaxWidth / $crop.Width
    $dw = [int][Math]::Round($crop.Width * $ratio)
    $dh = [int][Math]::Round($crop.Height * $ratio)
    $small = New-Object System.Drawing.Bitmap $dw, $dh
    $sg = [System.Drawing.Graphics]::FromImage($small)
    try {
      $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $sg.DrawImage($crop, 0, 0, $dw, $dh)
    } finally {
      $sg.Dispose()
      $crop.Dispose()
    }
    $crop = $small
  }

  $dir = [System.IO.Path]::GetDirectoryName($Out)
  if ($dir -and -not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $crop.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)

  $payload = [ordered]@{
    ok           = $true
    cancelled    = $false
    path         = $Out
    width        = $crop.Width
    height       = $crop.Height
    sourceWidth  = $srcW
    sourceHeight = $srcH
    x            = $selection.X
    y            = $selection.Y
    hidden       = ($hiddenProc -ne $null)
  }
  $crop.Dispose()
  Write-Outcome $payload
} catch {
  Write-Outcome @{ ok = $false; cancelled = $false; error = $_.Exception.Message }
  exit 1
}
