Add-Type -AssemblyName System.Drawing
# 배경이 정말 투명한지 — 모서리 알파와 완전투명 픽셀 비율.
foreach ($f in Get-ChildItem -LiteralPath $(if ($env:ICON_SRC) { $env:ICON_SRC } else { "raw" }) -Filter "*.png" | Sort-Object Name) {
  $b = New-Object System.Drawing.Bitmap($f.FullName)
  $w = $b.Width; $h = $b.Height
  $corners = @($b.GetPixel(2,2), $b.GetPixel($w-3,2), $b.GetPixel(2,$h-3), $b.GetPixel($w-3,$h-3))
  $ca = ($corners | ForEach-Object { $_.A }) -join "/"
  $clear = 0; $tot = 0
  for ($y = 0; $y -lt $h; $y += 8) { for ($x = 0; $x -lt $w; $x += 8) { $tot++; if ($b.GetPixel($x,$y).A -lt 16) { $clear++ } } }
  $pct = [Math]::Round(100.0 * $clear / $tot, 1)
  $c0 = $corners[0]
  "{0,-16} corners_alpha={1,-16} transparent={2,5}%  corner_rgb=({3},{4},{5})" -f $f.BaseName, $ca, $pct, $c0.R, $c0.G, $c0.B
  $b.Dispose()
}
