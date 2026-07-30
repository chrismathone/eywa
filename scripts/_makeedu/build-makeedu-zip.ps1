# 연동 PC makeedu 스크립트 zip 빌드 — **출력 위치는 항상 data\연동PC-makeedu\ 한 곳**.
#
# 왜 스크립트로 고정하나: ClassNote 워커 zip과 같은 이유다(원장 지적 2026-07-29). zip을 만들 때마다 위치가
# 다르면 ① 지금 연동 PC에 들어가 있는 게 어느 버전인지 대조할 수 없고 ② 롤백에 쓸 옛 zip이 어디 있는지
# 아무데도 기록되지 않는다. 2026-07-30에 makeedu zip을 `D:\tmp`에 만들었다가 바로 이 지적을 다시 받았다.
# → 위치를 코드로 못 박고, 날짜별로 쌓아 두며, 지우지 않는다.
#
# 사용:
#   powershell -ExecutionPolicy Bypass -File scripts\_makeedu\build-makeedu-zip.ps1
#
# ⚠️ 담는 범위 = scripts\_makeedu **폴더 전체**(부분 전달 금지). 스크립트들이 lib.cjs 등을 공유하므로
#    일부만 덮으면 버전이 섞인다. ClassNote 워커 zip과 **같은 원칙**이다.
# ⚠️ makeedu 스크랩 산출물(.makeedu-tmp\*.json)은 **실 PII**(전화·사유)라 zip에 담지 않는다 — 소스만 담는다.

param(
  [string]$OutDir = "",
  [string]$Date = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # scripts\_makeedu → 저장소 루트
$src = Join-Path $repo "scripts\_makeedu"
if (-not (Test-Path $src)) { throw "makeedu 소스 폴더를 찾을 수 없습니다: $src" }

if (-not $OutDir) { $OutDir = Join-Path $repo "data\연동PC-makeedu" }
if (-not $Date) { $Date = Get-Date -Format "yyyy-MM-dd" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

# 같은 날 다시 빌드해도 **덮어쓰지 않는다** — 옛 zip이 곧 롤백 수단이다.
$zip = Join-Path $OutDir "연동PC-makeedu-$Date.zip"
if (Test-Path $zip) {
  $zip = Join-Path $OutDir ("연동PC-makeedu-$Date" + "_" + (Get-Date -Format "HHmm") + ".zip")
  $i = 1
  while (Test-Path $zip) {
    $zip = Join-Path $OutDir ("연동PC-makeedu-$Date" + "_" + (Get-Date -Format "HHmm") + "-$i.zip")
    $i++
  }
}

# 압축 안 경로가 `scripts\_makeedu\…`가 되도록 스테이징한다 —
# 연동 PC의 **저장소 폴더에서 "여기에 압축 풀기"** 하면 제자리에 덮인다(ClassNote zip과 동일 동작).
$stage = Join-Path $env:TEMP ("eywa-makeedu-stage-" + [guid]::NewGuid().ToString("N"))
$dest = Join-Path $stage "scripts\_makeedu"
New-Item -ItemType Directory -Force $dest | Out-Null
try {
  # _incoming(스크랩 원본·PII)과 .makeedu-tmp는 제외 — 소스만.
  Get-ChildItem -Path $src -File | Where-Object { $_.Name -notlike "*.json" } |
    ForEach-Object { Copy-Item $_.FullName -Destination $dest }

  Compress-Archive -Path (Join-Path $stage "scripts") -DestinationPath $zip
  $count = (Get-ChildItem $dest -File).Count
  $size = [math]::Round((Get-Item $zip).Length / 1KB)
  $hash = (Get-FileHash $zip -Algorithm SHA256).Hash.Substring(0, 16)
  Write-Output ""
  Write-Output "빌드 완료"
  Write-Output ("  파일 : " + $zip)
  Write-Output ("  내용 : " + $count + "개 · " + $size + "KB · sha256 " + $hash + "…")
  Write-Output ""
  Write-Output "연동 PC 적용: 저장소 폴더에서 '여기에 압축 풀기'(덮어쓰기)"
  Write-Output "적용 확인   : node --env-file=<저장소>\.env.local scripts\_makeedu\check-session.mjs --dry-run"
} finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
