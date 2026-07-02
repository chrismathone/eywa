# setup-sync-pc.ps1 — "이 PC를 makeedu 동기화 PC로 지정" 원커맨드.
#
# 웹 버튼은 PC에 작업을 설치할 수 없으므로(브라우저 샌드박스·Vercel 원격), 지정 PC에서 이 스크립트를
# 한 번 실행하면: ① 사전요건 확인 ② 작업 스케줄러 2개 등록 ③ makeedu 로그인(신뢰 IP) 확인 ④ 워처 시작.
# 관리자 권한 불필요(현재 사용자 작업으로 등록). 경로는 스크립트 위치에서 도출(하드코딩 없음).
#
# 사용(이 PC에서 PowerShell):
#   .\scripts\_makeedu\setup-sync-pc.ps1            # 지정(등록+테스트+시작)
#   .\scripts\_makeedu\setup-sync-pc.ps1 -Status    # 현재 상태만 확인
#   .\scripts\_makeedu\setup-sync-pc.ps1 -Test      # makeedu 로그인만 테스트
#   .\scripts\_makeedu\setup-sync-pc.ps1 -Remove    # 지정 해제(옛 PC에서 실행)
#
# ⚠️ 동기화 PC를 옮길 땐: 옛 PC에서 -Remove → 새 PC에서 실행. 두 PC 동시 워처 금지(makeedu 이중 로그인).

param([switch]$Remove, [switch]$Status, [switch]$Test)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SYNC = "eywa-makeedu-sync"
$WATCH = "eywa-makeedu-sync-watcher"
$syncWrapper = Join-Path $repo "scripts\_makeedu\run-local-sync.ps1"
$watchWrapper = Join-Path $repo "scripts\_makeedu\run-watch-requests.ps1"

function Write-Head($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

function Show-Status {
  Write-Head "현재 상태 (repo: $repo)"
  foreach ($n in @($SYNC, $WATCH)) {
    $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
    if ($t) {
      $info = $t | Get-ScheduledTaskInfo
      Write-Host ("  {0,-26} 상태={1} 마지막={2} 결과={3}" -f $n, $t.State, $info.LastRunTime, $info.LastTaskResult)
    } else {
      Write-Host ("  {0,-26} (미등록)" -f $n) -ForegroundColor DarkYellow
    }
  }
  $log = "D:\tmp\makeedu\watch-requests.log"
  if (Test-Path $log) {
    $last = (Get-Item $log).LastWriteTime
    Write-Host "  워처 로그 마지막 기록: $last"
  }
}

function Test-Login {
  Write-Head "makeedu 로그인(신뢰 IP) 테스트"
  Push-Location $repo
  try {
    # node 출력은 Out-Host로 콘솔에 직접 — 안 하면 함수 반환값에 섞여 결과가 안 보이고 반환이
    # 배열이 돼 판정이 항상 truthy(실패도 성공 오판). 반환은 $LASTEXITCODE 기반 boolean만.
    & node --env-file=.env.local scripts/_makeedu/check-login.cjs | Out-Host
    return ($LASTEXITCODE -eq 0)
  } finally { Pop-Location }
}

if ($Status) { Show-Status; return }
if ($Test) { if (Test-Login) { return } else { exit 1 } }

if ($Remove) {
  Write-Head "동기화 PC 지정 해제"
  foreach ($n in @($SYNC, $WATCH)) {
    if (Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $n -Confirm:$false
      Write-Host "  해제됨: $n" -ForegroundColor Green
    } else { Write-Host "  이미 없음: $n" }
  }
  Write-Host "`n이 PC는 더 이상 동기화 PC가 아닙니다. 다른 PC에서 이 스크립트를 실행해 지정하세요." -ForegroundColor Green
  return
}

# ── 지정(기본) ──────────────────────────────────────────────────────────
Write-Head "동기화 PC 지정 (repo: $repo)"

# ① 사전요건
$fail = $false
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "  ✖ node 없음 — Node.js 설치 필요" -ForegroundColor Red; $fail = $true }
else { Write-Host "  ✓ node: $((Get-Command node).Source)" }
if (-not (Test-Path (Join-Path $repo ".env.local"))) { Write-Host "  ✖ .env.local 없음 — MAKEEDU_ID/PW·DATABASE_URL 필요" -ForegroundColor Red; $fail = $true }
else { Write-Host "  ✓ .env.local 존재" }
$hasPw = (Test-Path (Join-Path $repo "node_modules\playwright")) -or (Test-Path (Join-Path $repo "node_modules\@playwright\test"))
if (-not $hasPw) { Write-Host "  ✖ playwright 없음 — 'pnpm install' 후 재실행" -ForegroundColor Red; $fail = $true }
else { Write-Host "  ✓ playwright 설치됨" }
if (-not (Test-Path $syncWrapper)) { Write-Host "  ✖ 래퍼 없음: $syncWrapper" -ForegroundColor Red; $fail = $true }
if (-not (Test-Path $watchWrapper)) { Write-Host "  ✖ 래퍼 없음: $watchWrapper" -ForegroundColor Red; $fail = $true }
if ($fail) { Write-Host "`n사전요건 미충족 — 위 항목을 갖춘 뒤 다시 실행하세요." -ForegroundColor Red; exit 1 }

# ② 작업 등록 (관리자 불필요·현재 사용자). -Force = 멱등 재등록.
Write-Head "작업 스케줄러 등록"
$syncAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $syncWrapper)
$syncTriggers = @(
  (New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(6))),
  (New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(18)))
)
$syncSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $SYNC -Action $syncAction -Trigger $syncTriggers -Settings $syncSettings -Force | Out-Null
Write-Host "  ✓ $SYNC (매일 06시·18시 자동 동기화)" -ForegroundColor Green

$watchAction = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument ('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $watchWrapper)
$watchTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$watchSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $WATCH -Action $watchAction -Trigger $watchTrigger -Settings $watchSettings -Force | Out-Null
Write-Host "  ✓ $WATCH (로그온 시 상주 — 지금동기화·역동기화 요청 처리)" -ForegroundColor Green

# ③ 워처 시작
Start-ScheduledTask -TaskName $WATCH
Write-Host "  ✓ 워처 시작됨"

# ④ 로그인(신뢰 IP) 확인
$ok = Test-Login
Show-Status

Write-Head "완료"
if ($ok) {
  Write-Host "이 PC가 makeedu 동기화 PC로 지정됐습니다. 켜져 있는 한 자동/수동 동기화·역동기화가 이 PC에서 실행됩니다." -ForegroundColor Green
} else {
  Write-Host "작업은 등록됐지만 makeedu 로그인이 실패했습니다 — 신뢰 IP(기존 makeedu 사용 PC)인지, .env.local 크리덴셜을 확인하세요." -ForegroundColor Yellow
}
Write-Host "옮기려면: 이 PC에서 -Remove 후 새 PC에서 이 스크립트를 실행. 두 PC 동시 워처는 금지." -ForegroundColor DarkGray
