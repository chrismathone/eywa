# set-share-domain.ps1 — 연동 PC .env.local의 보고서 링크 주소를 새 도메인으로 + 침산 지점 못박기 + 워커 재시작.
#
# 배경(원장 2026-09-21): *"우리 도메인은 aywa.co.kr / www.aywa.co.kr"* · *"수업보고서로 발송되는 보고서 링크 주소도
# 새 도메인에 맞게. 이전건 괜찮고 앞으로 발송하는."* — ClassNote 게시글 본문의 `/r` 링크는 이 PC `.env.local`의
# CLASSNOTE_SHARE_BASE를 **가공 없이** 쓴다(코드 기본값보다 env가 이긴다). 그래서 코드를 바꿔도 이 값이 옛 주소면
# 계속 옛 주소로 나간다. 이미 나간 글은 그대로 둔다(옛 주소는 새 도메인으로 전환돼 계속 열리고, 회수 워커는
# 두 주소의 글을 다 찾는다 — share-bases.mjs).
#
# 이 스크립트가 하는 일(멱등 — 두 번 돌려도 같다):
#   ① .env.local 백업
#   ② CLASSNOTE_SHARE_BASE · CLASSNOTE_SCREENSHOT_BASE = https://www.aywa.co.kr (없으면 추가 · 같은 키가 여러 줄이면 전부)
#      + 옛 링크 주소 **원문**을 CLASSNOTE_LEGACY_SHARE_BASES에 남긴다(그 주소로 나간 글의 회수·중복 게시 방지)
#   ③ CLASSNOTE_TENANT_ID · MAKEEDU_TENANT_ID = 침산 id — **없거나 빈 칸일 때만**(다른 값이 있으면 건드리지 않고 경고)
#      (지점이 둘이 되는 날 워커가 제 지점을 못 정해 멈추지 않게 — docs/domain-cutover.md "지점을 하나 더 만드는 날" 0번)
#   ④ ClassNote 발송 워커 · makeedu 동기화 워처 재시작(돌고 있는 데몬은 옛 env를 든 채라 — setup 스크립트 재실행)
#
# 사용(이 PC에서): 발송PC-새도메인.bat 더블클릭 (또는 .\scripts\_classnote\set-share-domain.ps1)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = Join-Path $repo ".env.local"
$DOMAIN = "https://www.aywa.co.kr"
$CS_TENANT = "becaa316-e636-42e9-9d09-08b133e0b094"

function Write-Head($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

Write-Head "보고서 링크 주소 → $DOMAIN (repo: $repo)"
if (-not (Test-Path $envPath)) { Write-Host "  ✖ .env.local 없음: $envPath" -ForegroundColor Red; exit 1 }

# ① 백업 (원문 바이트 그대로)
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$envPath.bak-$stamp"
Copy-Item $envPath $backup
Write-Host "  ✓ 백업: $backup"

$text = [System.IO.File]::ReadAllText($envPath)
$nl = if ($text.Contains("`r`n")) { "`r`n" } else { "`n" }

function Unquote([string]$v) {
  $t = $v.Trim()
  if ($t.Length -ge 2 -and (($t.StartsWith('"') -and $t.EndsWith('"')) -or ($t.StartsWith("'") -and $t.EndsWith("'")))) { $t = $t.Substring(1, $t.Length - 2) }
  return $t
}

# 키의 모든 줄 값(따옴표 벗김). 같은 키가 여러 줄이면 node --env-file은 **뒤의 줄**을 쓴다.
function Get-Values([string]$key) {
  $pattern = "(?m)^[ \t]*$([regex]::Escape($key))[ \t]*=(.*?)(?=\r?$)"
  return @([regex]::Matches($script:text, $pattern) | ForEach-Object { Unquote $_.Groups[1].Value })
}

# 키를 한 값으로 — 줄이 있으면 **전부** 바꾸고, 없으면 끝에 추가한다.
function Write-KeyValue([string]$key, [string]$value) {
  $pattern = "(?m)^[ \t]*$([regex]::Escape($key))[ \t]*=.*?(?=\r?$)"
  if ([regex]::IsMatch($script:text, $pattern)) {
    $script:text = [regex]::Replace($script:text, $pattern, { param($m) "$key=$value" })
  } else {
    $script:text = $script:text.TrimEnd("`r", "`n") + "$nl$key=$value$nl"
  }
}

function Set-Key([string]$key, [string]$value) {
  $olds = Get-Values $key
  if ($olds.Count -gt 0 -and @($olds | Where-Object { $_ -ne $value }).Count -eq 0) { Write-Host "  · ${key} 이미 $value"; return @() }
  Write-KeyValue $key $value
  if ($olds.Count -gt 0) { Write-Host "  ✓ ${key}: $($olds -join ' / ') → $value" -ForegroundColor Green }
  else { Write-Host "  + ${key} 없음 → $value 추가" -ForegroundColor Yellow }
  return @($olds | Where-Object { $_ -and $_ -ne $value })
}

# 옛 링크 주소를 **원문 표기 그대로** 회수·중복확인 후보(CLASSNOTE_LEGACY_SHARE_BASES)에 남긴다 — 그 주소로 나간 글의 본문은
# 그때 env 원문(끝 슬래시·대문자 포함)이라, 정리한 표기만으론 못 찾는다(share-bases.mjs recallShareBases).
function Add-LegacyBases([string[]]$olds) {
  $key = "CLASSNOTE_LEGACY_SHARE_BASES"
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($v in (Get-Values $key)) { foreach ($p in ($v -split ",")) { $q = $p.Trim(); if ($q -and -not $parts.Contains($q)) { $parts.Add($q) } } }
  $added = @()
  foreach ($o in $olds) { if ($o -and $o -ne $DOMAIN -and -not $parts.Contains($o)) { $parts.Add($o); $added += $o } }
  if ($added.Count -eq 0) { return }
  Write-KeyValue $key ($parts -join ",")
  Write-Host "  + ${key}에 옛 주소 원문 보존: $($added -join ', ') (옛 글 회수·중복 게시 방지용)" -ForegroundColor Yellow
}

# 지점 id — 없거나 **비어 있으면** 침산으로. 다른 값이 있으면 건드리지 않는다(다른 지점용 PC일 수 있다).
function Add-KeyIfMissing([string]$key, [string]$value) {
  $vals = @(Get-Values $key | Where-Object { $_ })
  if ($vals.Count -eq 0) {
    Write-KeyValue $key $value
    Write-Host "  + ${key} 없음(또는 빈 칸) → 침산($value)" -ForegroundColor Yellow
    return
  }
  if (@($vals | Where-Object { $_ -ne $value }).Count -eq 0) { Write-Host "  · ${key} 이미 침산($value)"; return }
  Write-Host "  ⚠ ${key}=$($vals -join ' / ') — 침산 id와 다릅니다. 건드리지 않았습니다(다른 지점용 PC라면 정상)." -ForegroundColor Yellow
}

# ② 링크 주소 두 줄 (+ 옛 링크 주소 원문 보존)
$oldShare = Set-Key "CLASSNOTE_SHARE_BASE" $DOMAIN
Add-LegacyBases $oldShare
$null = Set-Key "CLASSNOTE_SCREENSHOT_BASE" $DOMAIN

# ③ 지점 못박기(없거나 빈 칸일 때만)
Write-Head "지점 못박기(침산)"
Add-KeyIfMissing "CLASSNOTE_TENANT_ID" $CS_TENANT
Add-KeyIfMissing "MAKEEDU_TENANT_ID" $CS_TENANT

# 원문의 다른 줄 바이트는 그대로 — UTF-8(BOM 없음)로 기록.
[System.IO.File]::WriteAllText($envPath, $text, (New-Object System.Text.UTF8Encoding($false)))

# ④ 두 데몬을 새 env로 재시작 — **별도 PowerShell 프로세스**로 띄워 그 스크립트 자체의 성공/실패만 본다
#    (같은 창에서 부르면 정상 종료여도 마지막 외부 명령의 종료 코드가 남아 헛경보가 난다). 하나가 실패해도 다른 하나는 돈다.
$problems = @()
function Invoke-Setup([string]$label, [string]$path) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $path
  if ($LASTEXITCODE -ne 0) { $script:problems += $label }
}

Write-Head "ClassNote 발송 워커 재시작 + 자가검사"
Invoke-Setup "ClassNote 발송 워커" (Join-Path $PSScriptRoot "setup-classnote-pc.ps1")

$makeedu = Join-Path $repo "scripts\_makeedu\setup-sync-pc.ps1"
if (Test-Path $makeedu) {
  Write-Head "makeedu 동기화 워처 재시작"
  Invoke-Setup "makeedu 동기화 워처" $makeedu
} else {
  Write-Host "`n  · makeedu 동기화가 이 PC에 없음 — 건너뜀"
}

if ($problems.Count -gt 0) {
  Write-Host ""
  Write-Host "  ============================================================" -ForegroundColor Red
  Write-Host "   ⚠ 확인 필요: $($problems -join ', ') — 재시작이 끝까지 가지 못했습니다." -ForegroundColor Red
  Write-Host "     이 경우 그 워커는 옛 주소로 계속 발송할 수 있습니다. 위 빨간 안내대로 조치한 뒤" -ForegroundColor Red
  Write-Host "     이 파일(발송PC-새도메인.bat)을 다시 실행하세요(두 번 실행해도 안전합니다)." -ForegroundColor Red
  Write-Host "  ============================================================" -ForegroundColor Red
} else {
  Write-Host "`n완료 — 앞으로 보내는 보고서 링크는 $DOMAIN 입니다." -ForegroundColor Green
  Write-Host "  (위에 노란 안내(자가검사·로그인 실패)가 있으면 그 내용도 확인하세요 — 주소는 이미 바뀌었습니다.)" -ForegroundColor Yellow
}
Write-Host "되돌리려면: 아래 백업 파일을 .env.local 이름으로 되돌린 뒤 발송PC-지정.bat(과 makeedu를 쓰면 동기화PC-지정.bat)을 실행하세요." -ForegroundColor DarkGray
Write-Host "  $backup" -ForegroundColor DarkGray
