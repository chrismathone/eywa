Add-Type -AssemblyName System.Drawing

# 생성된 512px 원본을 앱이 쓸 크기로 줄여 public/icons에 넣는다.
# 화면 최대 표시 38px × 3배 DPR = 114 → 128px면 충분하고, 512 원본 그대로 넣으면 40장에 8MB다.
$src = $(if ($env:ICON_OUT) { $env:ICON_OUT } else { "final" })
$dst = $args[0]
$size = 128

if (-not (Test-Path -LiteralPath $dst)) { New-Item -ItemType Directory -Path $dst -Force | Out-Null }

$names = @()
foreach ($f in Get-ChildItem -LiteralPath $src -Filter "*.png" | Sort-Object Name) {
  $img = [System.Drawing.Image]::FromFile($f.FullName)
  try {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"
    $g.InterpolationMode = "HighQualityBicubic"
    $g.PixelOffsetMode = "HighQuality"
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
    $g.Dispose()
    $out = Join-Path $dst $f.Name
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $names += $f.BaseName
    "{0,-18} {1,7:N0} -> {2,6:N0} bytes" -f $f.BaseName, $f.Length, (Get-Item -LiteralPath $out).Length
  } finally { $img.Dispose() }
}
"---"
"총 $($names.Count)장 · " + ($names -join ",")
