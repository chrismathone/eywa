Add-Type -AssemblyName System.Drawing
# 한 장의 배경이 진짜 투명한지 판정 — 네 모서리 알파가 0이어야 OK.
foreach ($n in $args) {
  $p = "$(if ($env:ICON_SRC) { $env:ICON_SRC } else { "raw" })\$n.png"
  if (-not (Test-Path -LiteralPath $p)) { "$n MISSING"; continue }
  $b = New-Object System.Drawing.Bitmap($p)
  $a = @($b.GetPixel(2,2).A, $b.GetPixel($b.Width-3,2).A, $b.GetPixel(2,$b.Height-3).A, $b.GetPixel($b.Width-3,$b.Height-3).A)
  $bad = ($a | Where-Object { $_ -gt 16 }).Count
  if ($bad -eq 0) { "$n OK" } else { "$n FAIL-opaque-background" }
  $b.Dispose()
}
