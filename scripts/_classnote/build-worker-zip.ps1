# 발송 PC(연동 PC) 워커 zip 빌드 — **출력 위치는 항상 data\발송PC-워커\ 한 곳**.
#
# 왜 스크립트로 고정하나(2026-07-29 원장 지적): 그동안 zip을 만들 때마다 위치가 달랐다(D:\tmp · 바탕화면 ·
# data\ …). 그러면 ① 지금 PC에 넣은 게 어느 버전인지 대조할 수 없고 ② 롤백에 쓸 **옛 zip이 어디 있는지**
# 아무데도 기록되지 않는다(적대 검증 2026-07-29 P2 "롤백 경로가 문서·도구 어디에도 없다").
# → 위치를 코드로 못 박고, 날짜별로 쌓아 두며, 지우지 않는다.
#
# 사용:
#   powershell -ExecutionPolicy Bypass -File scripts\_classnote\build-worker-zip.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\_classnote\build-worker-zip.ps1 -OutDir D:\전달   # 예외적 위치
#
# ⚠️ 담는 범위 = scripts\_classnote **폴더 전체**(부분 전달 금지). 워커는 폴더 안에서 서로를 import하므로
#    일부만 덮으면 버전이 섞여 기동조차 못 한다(안내문의 "폴더 전체를 푸세요"가 이 이유다).

param(
  [string]$OutDir = "",
  [string]$Date = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # scripts\_classnote → 저장소 루트
$src = Join-Path $repo "scripts\_classnote"
if (-not (Test-Path $src)) { throw "워커 소스 폴더를 찾을 수 없습니다: $src" }

if (-not $OutDir) { $OutDir = Join-Path $repo "data\발송PC-워커" }
if (-not $Date) { $Date = Get-Date -Format "yyyy-MM-dd" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

# 같은 날/같은 분에 다시 빌드해도 **덮어쓰지 않는다** — 옛 zip이 곧 롤백 수단이라 소실이 곧 손실이다.
# (Compress-Archive는 대상이 있으면 -Force 없이는 에러로 죽는다 → 빈 이름을 찾을 때까지 접미사를 늘린다.)
$zip = Join-Path $OutDir "발송PC-워커-$Date.zip"
if (Test-Path $zip) {
  $zip = Join-Path $OutDir ("발송PC-워커-$Date" + "_" + (Get-Date -Format "HHmm") + ".zip")
  $i = 1
  while (Test-Path $zip) {
    $zip = Join-Path $OutDir ("발송PC-워커-$Date" + "_" + (Get-Date -Format "HHmm") + "-$i.zip")
    $i++
  }
}

# 압축 안 경로를 scripts\_classnote\... 로 만들기 위해 스테이징(연동 PC에서 저장소 루트에 그대로 풀면 제자리).
$stage = Join-Path $env:TEMP ("eywa-worker-zip-" + [guid]::NewGuid().ToString("N"))
try {
  $stageInner = Join-Path $stage "scripts\_classnote"
  New-Item -ItemType Directory -Force $stageInner | Out-Null
  Copy-Item -Recurse -Force "$src\*" $stageInner
  Compress-Archive -Path (Join-Path $stage "scripts") -DestinationPath $zip
} finally {
  if (Test-Path -LiteralPath $stage) {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    $tempRoot = [IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    if (-not $resolvedStage.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $resolvedStage) -notmatch '^eywa-worker-zip-[0-9a-f]{32}$') {
      throw "스테이징 정리 경로가 임시 폴더 범위를 벗어났습니다."
    }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
  }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
$count = $archive.Entries.Count
$archive.Dispose()
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.Substring(0, 16)
$sizeKB = [math]::Round((Get-Item $zip).Length / 1KB)

Write-Host ""
Write-Host "빌드 완료" -ForegroundColor Green
Write-Host "  파일 : $zip"
Write-Host "  내용 : ${count}개 · ${sizeKB}KB · sha256 $hash…"
Write-Host ""
Write-Host "연동 PC 적용: 저장소 폴더에서 '여기에 압축 풀기'(덮어쓰기) → 발송PC-지정.bat"
Write-Host "적용 확인   : 발송 큐 현황의 '구버전 워커' 경고가 사라지면 완료"
