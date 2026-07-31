# run-health-check.ps1 — Windows 작업 스케줄러용 makeedu **접속 헬스체크** 래퍼.
#
# 왜 필요한가: 연동 PC(신뢰 IP)에서는 ID/PW 자동 로그인이 CAPTCHA 없이 통과해서(2026-07-30 실측)
# 동기화가 하루 2회 무인으로 돈다. 그래서 진짜 위험은 "세션 만료"가 아니라 **로그인이 실패하게 되는 날**
# (비밀번호 변경 · CAPTCHA 도입 · 계정 잠금 · 사이트 개편)이다. 그날 동기화는 **조용히** 멈추고,
# 화면의 숫자는 마지막 성공 시점에 얼어붙은 채 그대로 읽힌다(2026-07-30 퇴원일 사고와 같은 실패 모양).
# → 하루 1회 접속만 확인해 실패하면 원장 벨에 알린다(`check-session.mjs`).
#
# 전제: .env.local 에 MAKEEDU_ID / MAKEEDU_PW / DATABASE_URL. node 가 PATH 에. (run-local-sync.ps1과 동일)
# 등록: `setup-sync-pc.ps1`(= 동기화PC-지정.bat)이 `eywa-makeedu-health` 작업으로 매일 08:30 실행.
#       06시 동기화가 실패했다면 그날 업무 시작 전에 벨이 울린다.
# 로그: <repo>\.makeedu-tmp\health-check.log
#
# ⚠️ 실패해도 재시도하지 않는다 — 반복 로그인 실패는 계정 잠금을 부른다(check-session.mjs가 1회만 시도).

$ErrorActionPreference = "Continue"
# 스크립트 위치(scripts/_makeedu) 기준으로 repo 루트 도출 → 경로 하드코딩 없이 이동 가능.
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo

# ⚠️ 로그 인코딩: node 는 UTF-8 출력인데 PowerShell 5.1 은 OEM 코드페이지로 읽고 `*>>`는 UTF-16 으로 써서
#    한글이 깨진다 → 콘솔 인코딩을 UTF-8 로 맞추고 Add-Content -Encoding UTF8 로 일관 기록(run-local-sync와 동일).
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$logDir = Join-Path $repo ".makeedu-tmp"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Force -Path $logDir | Out-Null }
$log = Join-Path $logDir "health-check.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$out = & node --env-file=.env.local scripts/_makeedu/check-session.mjs 2>&1 | Out-String
$code = $LASTEXITCODE
Add-Content -Path $log -Encoding UTF8 -Value "[$stamp] (exit $code) $($out.Trim())"

# 로그 무한 증가 방지 — 하루 1줄이라 2,000줄이면 5년치다. 넘으면 뒤(최근) 절반만 남긴다.
try {
  $lines = @(Get-Content -Path $log -Encoding UTF8)
  if ($lines.Count -gt 2000) { Set-Content -Path $log -Encoding UTF8 -Value $lines[-1000..-1] }
} catch { }

exit $code
