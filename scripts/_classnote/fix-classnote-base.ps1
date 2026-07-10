# fix-classnote-base.ps1 — 연동 PC .env.local의 ClassNote 주소 오타 수정 + 데몬 fresh 재시작.
#
# 배경(2026-07-10 실발송 E2E에서 적발): 연동 PC .env.local의 CLASSNOTE_SCREENSHOT_BASE가
# "eywa-alpha-vercel.app"(점 대신 하이픈)로 수기 오타 → 워커 스크린샷 page.goto가
# ERR_NAME_NOT_RESOLVED → 발송 3회 재시도 후 failed. 정답은 "eywa-alpha.vercel.app".
# 이 스크립트는 ① .env.local 백업 ② 오타 도메인 치환 ③ 두 키(SCREENSHOT/SHARE_BASE) 값 확인 출력
# ④ setup-classnote-pc.ps1 재실행(데몬 fresh 재시작 + dry-run 자가검사)까지 한 번에 수행한다.
#
# 사용(이 PC에서): 발송PC-주소수정.bat 더블클릭 (또는 .\scripts\_classnote\fix-classnote-base.ps1)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo ".env.local"
$GOOD = "eywa-alpha.vercel.app"
$BAD = "eywa-alpha-vercel.app"

function Write-Head($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

Write-Head "ClassNote 주소 오타 수정 (repo: $repo)"
if (-not (Test-Path $envPath)) { Write-Host "  ✖ .env.local 없음: $envPath" -ForegroundColor Red; exit 1 }

# ① 백업 (원문 바이트 그대로)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$envPath.bak-$stamp"
Copy-Item $envPath $backup
Write-Host "  ✓ 백업: $backup"

# ② 오타 치환 — 원문을 통째로 읽어 치환 후 UTF-8(BOM 없음)로 기록(다른 줄 바이트 보존).
$text = [System.IO.File]::ReadAllText($envPath)
$hits = ([regex]::Matches($text, [regex]::Escape($BAD))).Count
if ($hits -gt 0) {
  $text = $text.Replace($BAD, $GOOD)
  [System.IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "  ✓ 오타 $hits 곳 치환: $BAD → $GOOD" -ForegroundColor Green
} else {
  Write-Host "  · 오타($BAD) 없음 — 치환 생략"
}

# ③ 현재 값 확인 출력 (사람 눈 검증용) — 키가 아예 없으면 정답 값으로 추가.
$lines = [System.IO.File]::ReadAllText($envPath)
$changed = $false
foreach ($key in @("CLASSNOTE_SCREENSHOT_BASE", "CLASSNOTE_SHARE_BASE")) {
  $m = [regex]::Match($lines, "(?m)^$key=(.*)$")
  if ($m.Success) {
    $val = $m.Groups[1].Value.Trim()
    $mark = if ($val -like "*$GOOD*") { "✓" } else { "⚠" }
    $color = if ($mark -eq "✓") { "Green" } else { "Yellow" }
    Write-Host "  $mark ${key}=$val" -ForegroundColor $color
  } else {
    $lines = $lines.TrimEnd() + "`n$key=https://$GOOD`n"
    $changed = $true
    Write-Host "  + $key 없음 → https://$GOOD 추가" -ForegroundColor Yellow
  }
}
if ($changed) { [System.IO.File]::WriteAllText($envPath, $lines, (New-Object System.Text.UTF8Encoding($false))) }

# ④ 데몬 fresh 재시작 + dry-run 자가검사 (setup 스크립트 재실행 = 멱등)
Write-Head "데몬 재시작 + 자가검사"
& (Join-Path $PSScriptRoot "setup-classnote-pc.ps1")
