# setup-sync-pc.ps1 — "이 PC를 makeedu 동기화 PC로 지정" 원커맨드.
#
# 웹 버튼은 PC에 작업을 설치할 수 없으므로(브라우저 샌드박스·Vercel 원격), 지정 PC에서 이 스크립트를
# 한 번 실행하면: ① 사전요건 확인 ② 작업 스케줄러 3개 등록 ③ makeedu 로그인(신뢰 IP) 확인 ④ 워처 시작.
# 관리자 권한 불필요(현재 사용자 작업으로 등록). 경로는 스크립트 위치에서 도출(하드코딩 없음).
#
# 사용(이 PC에서 PowerShell):
#   .\scripts\_makeedu\setup-sync-pc.ps1            # 지정(등록+테스트+시작)
#   .\scripts\_makeedu\setup-sync-pc.ps1 -Status    # 현재 상태만 확인
#   .\scripts\_makeedu\setup-sync-pc.ps1 -Test      # makeedu 로그인만 테스트
#   .\scripts\_makeedu\setup-sync-pc.ps1 -Remove    # 지정 해제(옛 PC에서 실행)
#
# ⚠️ 동기화 PC를 옮길 땐: 옛 PC에서 -Remove → 새 PC에서 실행. 두 PC 동시 워처 금지(makeedu 이중 로그인).
# ⚠️ 워처 "일시 정지"는 Stop-ScheduledTask만으론 안 됨 — 10분 반복 트리거가 자동 부활시킴(2026-07-03).
#    정말 멈추려면 -Remove(해제) 또는 작업 스케줄러에서 '사용 안 함'. 크리덴셜(.env.local) 교체 후엔
#    이 스크립트를 다시 실행하면 됨(아래 Stop-Watcher가 옛 인스턴스를 내리고 fresh env로 재시작).

param([switch]$Remove, [switch]$Status, [switch]$Test)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$SYNC = "eywa-makeedu-sync"
$WATCH = "eywa-makeedu-sync-watcher"
$HEALTH = "eywa-makeedu-health"
$syncWrapper = Join-Path $repo "scripts\_makeedu\run-local-sync.ps1"
$watchWrapper = Join-Path $repo "scripts\_makeedu\run-watch-requests.ps1"
$healthWrapper = Join-Path $repo "scripts\_makeedu\run-health-check.ps1"
# ⚠️ 세 작업은 **한 세트**다 — 등록·해제·상태확인이 모두 같은 목록을 돈다. 헬스체크만 따로 schtasks로
#    등록하면 -Remove(지정 해제)가 그걸 안 지워서, 동기화 PC를 옮긴 뒤에도 **옛 PC가 계속 로그인을 시도**한다.
$TASKS = @($SYNC, $WATCH, $HEALTH)

function Write-Head($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

function Stop-Watcher {
  # 실행 중 워처를 확실히 내린다 — Stop-ScheduledTask는 래퍼(powershell)만 죽이고 자식 node가
  # orphan으로 남을 수 있어(2026-07-03 실측) 커맨드라인 매칭으로 node까지 명시 종료.
  # 재등록/-Remove 시 fresh 인스턴스 보장(옛 env·옛 크리덴셜 잔존 방지). IgnoreNew라 옛 인스턴스를
  # 안 내리면 Start-ScheduledTask가 no-op이 되는 것도 함께 해소.
  Stop-ScheduledTask -TaskName $WATCH -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "watch-sync-requests" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Show-Status {
  Write-Head "현재 상태 (repo: $repo)"
  foreach ($n in $TASKS) {
    $t = Get-ScheduledTask -TaskName $n -ErrorAction SilentlyContinue
    if ($t) {
      $info = $t | Get-ScheduledTaskInfo
      Write-Host ("  {0,-26} 상태={1} 마지막={2} 결과={3}" -f $n, $t.State, $info.LastRunTime, $info.LastTaskResult)
    } else {
      Write-Host ("  {0,-26} (미등록)" -f $n) -ForegroundColor DarkYellow
    }
  }
  $log = Join-Path $repo ".makeedu-tmp\watch-requests.log"
  if (Test-Path $log) {
    $last = (Get-Item $log).LastWriteTime
    Write-Host "  워처 로그 마지막 기록: $last"
  }
  # 헬스체크는 결과가 로그 한 줄이라 마지막 줄을 그대로 보여준다(✅ 정상 / 🔴 접속 실패).
  $hlog = Join-Path $repo ".makeedu-tmp\health-check.log"
  if (Test-Path $hlog) {
    $lastLine = @(Get-Content -Path $hlog -Encoding UTF8 -Tail 1)
    if ($lastLine.Count -gt 0) { Write-Host "  접속 점검 마지막 결과: $($lastLine[0])" }
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
  Stop-Watcher  # 실행 중 워처(래퍼+orphan node)를 먼저 내림 — Unregister는 러닝 프로세스를 안 죽임
  foreach ($n in $TASKS) {
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
if (-not (Test-Path $healthWrapper)) { Write-Host "  ✖ 래퍼 없음: $healthWrapper (zip을 폴더 전체로 덮었는지 확인)" -ForegroundColor Red; $fail = $true }
if ($fail) { Write-Host "`n사전요건 미충족 — 위 항목을 갖춘 뒤 다시 실행하세요." -ForegroundColor Red; exit 1 }

# ② 작업 등록 (관리자 불필요·현재 사용자). -Force = 멱등 재등록.
# ⚠️ 창 숨김 = conhost.exe --headless 로 powershell 실행(2026-07-03). Win11 기본 터미널(Windows Terminal)이
#    powershell의 -WindowStyle Hidden을 무시해 작업이 뜰 때마다 콘솔 창이 보였고(그 창을 닫으면 워처가
#    죽어 오프라인 사고 = exit 0xC000013A), --headless는 콘솔을 완전 창 없이 호스팅 → 닫을 창이 없음.
#    conhost는 자식(node)이 살아있는 동안 블로킹 → IgnoreNew 중복방지 유지. (Win11+ 필요.)
Write-Head "작업 스케줄러 등록"
$hidden = '--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"'
$syncAction = New-ScheduledTaskAction -Execute "conhost.exe" -Argument ($hidden -f $syncWrapper)
$syncTriggers = @(
  (New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(6))),
  (New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(18)))
)
$syncSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)
Register-ScheduledTask -TaskName $SYNC -Action $syncAction -Trigger $syncTriggers -Settings $syncSettings -Force | Out-Null
Write-Host "  ✓ $SYNC (매일 06시·18시 자동 동기화)" -ForegroundColor Green

$watchAction = New-ScheduledTaskAction -Execute "conhost.exe" -Argument ($hidden -f $watchWrapper)
# 트리거 2개: 로그온 시 시작 + 10분마다 자동 부활(2026-07-03 — 세션 중 워처가 죽으면[수동 정지·크래시]
# 로그온 트리거만으론 다음 로그온까지 오프라인이던 갭 해소. IgnoreNew라 이미 돌고 있으면 중복 실행 없음).
# ⚠️ RepetitionDuration은 생략 = 무기한([TimeSpan]::MaxValue는 "out of range"로 거부됨 — 2026-07-03 실측).
$watchTriggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
  (New-ScheduledTaskTrigger -Once -At ([datetime]::Today) -RepetitionInterval (New-TimeSpan -Minutes 10))
)
$watchSettings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $WATCH -Action $watchAction -Trigger $watchTriggers -Settings $watchSettings -Force | Out-Null
Write-Host "  ✓ $WATCH (로그온 시 상주 + 10분마다 자동 부활 — 지금동기화·역동기화 요청 처리)" -ForegroundColor Green

# 접속 헬스체크 — 하루 1회 08:30. 06시 동기화가 실패했으면 **업무 시작 전에** 원장 벨이 울린다.
# 이 작업이 감시하는 건 "동기화가 조용히 멈춘 상태"다 — 로그인이 깨지면 화면 숫자가 마지막 성공 시점에
# 얼어붙은 채 그대로 읽히고, 아무도 모른 채 며칠이 간다(2026-07-30 퇴원일 사고와 같은 실패 모양).
# ⚠️ 하루 1회로 충분하다 — 자주 시도할수록 계정 잠금 위험만 커진다(실패해도 재시도 안 함).
# ⚠️ StartWhenAvailable = PC가 꺼져 있어 08:30을 놓치면 켜진 뒤 한 번 따라잡는다.
$healthAction = New-ScheduledTaskAction -Execute "conhost.exe" -Argument ($hidden -f $healthWrapper)
$healthTrigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.AddHours(8).AddMinutes(30))
$healthSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $HEALTH -Action $healthAction -Trigger $healthTrigger -Settings $healthSettings -Force | Out-Null
Write-Host "  ✓ $HEALTH (매일 08:30 접속 점검 — 실패하면 원장 벨 알림)" -ForegroundColor Green

# ③ 워처 시작 — 옛 인스턴스(옛 env)를 먼저 내려 fresh 재시작(크리덴셜 교체 재실행에도 안전).
Stop-Watcher
Start-ScheduledTask -TaskName $WATCH
Write-Host "  ✓ 워처 시작됨(기존 인스턴스가 있었으면 fresh 재시작)"

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
