# setup-classnote-pc.ps1 — "이 PC를 ClassNote 발송 PC로 지정" 원커맨드.
#
# 웹은 Playwright+ClassNote 로그인을 못 하므로(서버리스), 강사의 "ClassNote 발송"은 lesson_reports를 queued로만
# 남긴다(P3). 지정 PC에서 이 스크립트를 한 번 실행하면: ① 사전요건 확인 ② 작업 스케줄러 등록(로그온+10분 부활)
# ③ 데몬 시작 ④ dry-run 자가검사. 관리자 권한 불필요(현재 사용자 작업). 경로는 스크립트 위치에서 도출.
#
# 사용(이 PC에서 PowerShell):
#   .\scripts\_classnote\setup-classnote-pc.ps1            # 지정(등록+시작+검사)
#   .\scripts\_classnote\setup-classnote-pc.ps1 -Status    # 현재 상태만 확인
#   .\scripts\_classnote\setup-classnote-pc.ps1 -Test      # dry-run 1주기(게시 안 함 — 파이프라인만 확인)
#   .\scripts\_classnote\setup-classnote-pc.ps1 -Remove    # 지정 해제(옛 PC에서 실행)
#
# ⚠️ 발송 PC를 옮길 땐: 옛 PC에서 -Remove → 새 PC에서 실행. 두 PC 동시 데몬 금지(ClassNote 이중 로그인).
# ⚠️ 데몬 "일시 정지"는 Stop-ScheduledTask만으론 안 됨 — 10분 반복 트리거가 자동 부활(makeedu 2026-07-03 교훈).
#    정말 멈추려면 -Remove(해제) 또는 작업 스케줄러에서 '사용 안 함'. .env.local 교체 후엔 이 스크립트를 다시
#    실행하면 됨(아래 Stop-Worker가 옛 인스턴스를 내리고 fresh env로 재시작).
# ⚠️ env 필요: DATABASE_URL, CLASSNOTE_UPLOAD_ID/PW(실게시), 테넌트 2개+면 CLASSNOTE_TENANT_ID.

param([switch]$Remove, [switch]$Status, [switch]$Test)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$TASK = "eywa-classnote-worker"
$wrapper = Join-Path $repo "scripts\_classnote\run-classnote-worker.ps1"
$LOG = "D:\tmp\classnote\watch.log"

function Write-Head($t) { Write-Host "`n== $t ==" -ForegroundColor Cyan }

function Stop-Worker {
  # 실행 중 데몬을 확실히 내린다 — Stop-ScheduledTask는 래퍼(powershell)만 죽이고 자식 node가 orphan으로
  # 남을 수 있어(makeedu 2026-07-03 실측) 커맨드라인 매칭으로 node까지 명시 종료. 재등록/-Remove 시 fresh 보장.
  Stop-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "watch-classnote-queue" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Show-Status {
  Write-Head "현재 상태 (repo: $repo)"
  $t = Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue
  if ($t) {
    $info = $t | Get-ScheduledTaskInfo
    Write-Host ("  {0,-24} 상태={1} 마지막={2} 결과={3}" -f $TASK, $t.State, $info.LastRunTime, $info.LastTaskResult)
  } else {
    Write-Host ("  {0,-24} (미등록)" -f $TASK) -ForegroundColor DarkYellow
  }
  if (Test-Path $LOG) { Write-Host "  데몬 로그 마지막 기록: $((Get-Item $LOG).LastWriteTime)" }
}

function Test-Pipeline {
  # dry-run 1주기 — 게시 없이 DB 연결·tenant 해석·Playwright 스크린샷·payload 조립까지 확인(--post 없음).
  Write-Head "dry-run 파이프라인 검사 (게시 안 함)"
  Push-Location $repo
  try {
    & node --env-file=.env.local scripts/_classnote/process-classnote-queue.mjs | Out-Host
    return ($LASTEXITCODE -eq 0)
  } finally { Pop-Location }
}

if ($Status) { Show-Status; return }
if ($Test) { if (Test-Pipeline) { return } else { exit 1 } }

if ($Remove) {
  Write-Head "ClassNote 발송 PC 지정 해제"
  Stop-Worker  # 실행 중 데몬(래퍼+orphan node)을 먼저 내림 — Unregister는 러닝 프로세스를 안 죽임
  if (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TASK -Confirm:$false
    Write-Host "  해제됨: $TASK" -ForegroundColor Green
  } else { Write-Host "  이미 없음: $TASK" }
  Write-Host "`n이 PC는 더 이상 ClassNote 발송 PC가 아닙니다. 다른 PC에서 이 스크립트를 실행해 지정하세요." -ForegroundColor Green
  return
}

# ── 지정(기본) ──────────────────────────────────────────────────────────
Write-Head "ClassNote 발송 PC 지정 (repo: $repo)"

# ① 사전요건
$fail = $false
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Host "  ✖ node 없음 — Node.js 설치 필요" -ForegroundColor Red; $fail = $true }
else { Write-Host "  ✓ node: $((Get-Command node).Source)" }
if (-not (Test-Path (Join-Path $repo ".env.local"))) { Write-Host "  ✖ .env.local 없음 — DATABASE_URL·CLASSNOTE_UPLOAD_ID/PW 필요" -ForegroundColor Red; $fail = $true }
else { Write-Host "  ✓ .env.local 존재" }
$hasPw = (Test-Path (Join-Path $repo "node_modules\playwright")) -or (Test-Path (Join-Path $repo "node_modules\@playwright\test"))
if (-not $hasPw) { Write-Host "  ✖ playwright 없음 — 'pnpm install' 후 재실행" -ForegroundColor Red; $fail = $true }
else { Write-Host "  ✓ playwright 설치됨" }
if (-not (Test-Path $wrapper)) { Write-Host "  ✖ 래퍼 없음: $wrapper" -ForegroundColor Red; $fail = $true }
if ($fail) { Write-Host "`n사전요건 미충족 — 위 항목을 갖춘 뒤 다시 실행하세요." -ForegroundColor Red; exit 1 }

# ② 작업 등록 (관리자 불필요·현재 사용자). -Force = 멱등 재등록.
# ⚠️ 창 숨김 = conhost.exe --headless 로 powershell 실행(makeedu 2026-07-03). Win11 기본 터미널(Windows Terminal)이
#    powershell의 -WindowStyle Hidden을 무시해 작업이 뜰 때마다 콘솔 창이 보였고(그 창을 닫으면 데몬이 죽어
#    오프라인 사고), --headless는 콘솔을 완전 창 없이 호스팅 → 닫을 창이 없음. conhost는 자식(node)이 살아있는
#    동안 블로킹 → IgnoreNew 중복방지 유지. (Win11+ 필요.)
Write-Head "작업 스케줄러 등록"
$hidden = '--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"'
$action = New-ScheduledTaskAction -Execute "conhost.exe" -Argument ($hidden -f $wrapper)
# 트리거 2개: 로그온 시 시작 + 10분마다 자동 부활(세션 중 데몬이 죽으면[수동 정지·크래시] 다음 로그온까지
# 오프라인이던 갭 해소. IgnoreNew라 이미 돌고 있으면 중복 실행 없음).
# ⚠️ RepetitionDuration 생략 = 무기한([TimeSpan]::MaxValue는 out-of-range로 거부 — makeedu 2026-07-03 실측).
$triggers = @(
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME),
  (New-ScheduledTaskTrigger -Once -At ([datetime]::Today) -RepetitionInterval (New-TimeSpan -Minutes 10))
)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
  -StartWhenAvailable -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName $TASK -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
Write-Host "  ✓ $TASK (로그온 시 상주 + 10분마다 자동 부활 — 발송 큐 자동 처리)" -ForegroundColor Green

# ③ 데몬 시작 — 옛 인스턴스(옛 env)를 먼저 내려 fresh 재시작(크리덴셜 교체 재실행에도 안전).
Stop-Worker
Start-ScheduledTask -TaskName $TASK
Write-Host "  ✓ 데몬 시작됨(기존 인스턴스가 있었으면 fresh 재시작)"

# ④ dry-run 파이프라인 검사(게시 안 함).
$ok = Test-Pipeline
Show-Status

Write-Head "완료"
if ($ok) {
  Write-Host "이 PC가 ClassNote 발송 PC로 지정됐습니다. 켜져 있는 한 queued 보고서를 자동 게시합니다." -ForegroundColor Green
} else {
  Write-Host "작업은 등록됐지만 dry-run 검사가 실패했습니다 — .env.local(DATABASE_URL·CLASSNOTE_TENANT_ID)·Playwright·스크린샷 BASE를 확인하세요." -ForegroundColor Yellow
}
Write-Host "옮기려면: 이 PC에서 -Remove 후 새 PC에서 이 스크립트를 실행. 두 PC 동시 데몬은 금지." -ForegroundColor DarkGray
