# run-classnote-worker.ps1 — 작업 스케줄러용 ClassNote 발송 데몬 래퍼 (상시 실행).
#
# 강사가 원스크린에서 "ClassNote 발송"을 누르면 lesson_reports가 queued로 쌓이고(Vercel은 Playwright+ClassNote
# 로그인 불가 = 로컬 PC 필요), 이 PC의 데몬(watch-classnote-queue.mjs)이 15초 폴링으로 잡아 실게시(--post)한다.
# 정식 등록 경로는 setup-classnote-pc.ps1(트리거 = 로그온 + 10분마다 자동 부활).
#
# 로그는 데몬(node)이 직접 D:\tmp\classnote\watch.log 에 쓴다(장기 실행이라 리다이렉트 캡처 부적합).

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repo
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# --post = 실게시. dry-run으로 돌리려면 이 줄에서 --post를 빼고 재등록.
& node --env-file=.env.local scripts/_classnote/watch-classnote-queue.mjs --post
exit $LASTEXITCODE
