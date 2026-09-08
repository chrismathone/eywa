Add-Type -AssemblyName System.Drawing
# 40장 대조 시트 — 큰 그림 + 실제 쓰이는 크기(사이드바 18 / 허브 38)를 남색·흰 배경 위에.
$src = $(if ($env:ICON_OUT) { $env:ICON_OUT } else { "final" })
$out = "contact.png"
$files = Get-ChildItem -LiteralPath $src -Filter "*.png" | Sort-Object Name
$cols = 7
$rows = [Math]::Ceiling($files.Count / $cols)
$cw = 150; $ch = 168; $head = 54
$W = $cols * $cw + 24; $H = $head + $rows * $ch + 16
$bmp = New-Object System.Drawing.Bitmap($W, $H)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = "AntiAlias"; $g.InterpolationMode = "HighQualityBicubic"
$g.PixelOffsetMode = "HighQuality"; $g.TextRenderingHint = "ClearTypeGridFit"
$g.Clear([System.Drawing.Color]::White)
$fT = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$fC = New-Object System.Drawing.Font("Segoe UI", 8)
$bD = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(18,18,18))
$bG = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(120,120,126))
$bN = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(21,62,117))
$bS = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245,245,247))
$g.DrawString("eywa tab icons - FINAL ($($files.Count) files)", $fT, $bD, 14, 12)
$g.DrawString("per cell: large 84px  |  navy pill 18px (active tab)  |  soft 18px (idle)  |  hub 38px", $fC, $bG, 14, 34)
for ($i = 0; $i -lt $files.Count; $i++) {
  $r = [Math]::Floor($i / $cols); $c = $i % $cols
  $x = 12 + $c * $cw; $y = $head + $r * $ch
  $img = [System.Drawing.Image]::FromFile($files[$i].FullName)
  try {
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(($x + 30), ($y + 6), 84, 84)))
    $g.FillRectangle($bN, ($x + 8), ($y + 96), 34, 28)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(($x + 16), ($y + 101), 18, 18)))
    $g.FillRectangle($bS, ($x + 46), ($y + 96), 34, 28)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(($x + 54), ($y + 101), 18, 18)))
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(($x + 88), ($y + 91), 38, 38)))
    $g.DrawString($files[$i].BaseName, $fC, $bD, ($x + 8), ($y + 130))
  } finally { $img.Dispose() }
}
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "saved $out ($W x $H)"
