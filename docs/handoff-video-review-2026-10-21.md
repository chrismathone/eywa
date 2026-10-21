# 핸드오프 — 영상 설명 AI 참고 메모: 연동 앱 1.0.8 게시만 남음 (2026-10-21, Windows 빌드 PC에서 재개)

> **새 세션 시작 프롬프트(복사-붙여넣기)**
> aywa에서 이어간다. 영상 설명 AI 참고 메모(`homework_video_reviews`, 0390a)는 **main 7177f4597에 반영·Vercel 배포 완료**, 운영 DB 마이그레이션(0390a·0391a) 적용 완료, 침산 지점 스위치 `video_review` 켜짐, Vercel 운영 환경변수 `ANTHROPIC_API_KEY_VIDEO` 등록 완료다. **남은 일은 연동 앱(AYWA 연동) 1.0.8 / 순번 10 게시 하나** — 영상 추출 코드가 1.0.7에 없어 새 영상이 추출 단계에서 기다린다. 이 문서 §2 순서대로 이 PC에서 빌드·게시·등록하고, §3으로 확인한다. 돈 드는 외부 키 호출(Anthropic)은 이미 승인된 밤 배치 경로 외에는 원장에게 먼저 묻는다(AssemblyAI는 키 사용 승인됨).

## 1. 지금 상태 (2026-10-21 14시 기준)

| 항목 | 상태 |
|---|---|
| 앱 코드 | main `7177f4597` (기능 본체 `67b199e9a`) · Vercel 배포 success 2회 확인 |
| DB | `0390a_homework_video_reviews` · `0391a_ai_usage_cache_tokens` 운영 적용됨(파일 번호는 main의 0387a~0389a와 겹쳐 10-21에 바꿈 — DB 재실행 없음) |
| 지점 스위치 | `tenant_licenses` 침산 `video_review` is_active=true → 10분 cron `/api/cron/video-review`가 돈다 |
| 운영 키 | Vercel Production `ANTHROPIC_API_KEY_VIDEO` = Max 20x 크레딧($200/월)이 들어오는 콘솔 조직 키(원장이 대시보드에 넣음 · 키 그룹 `video`) · AssemblyAI 키는 기존 것 |
| 분석 결과 | 수학 영상 392건 중 done 387 · skipped 4(말소리 없음) · failed 1(드라이브 원본 손상) — 전부 개발 PC 내부 요금제 CLI로 돌렸고 API 지출 0 |
| 연동 앱 | **1.0.7 / 순번 9**가 발송 PC에서 돌고 있다. 영상 추출(`scripts/_classnote/video-review-extract*.mjs`)은 런타임 매니페스트(`scripts/_sync-agent/runtime-manifest.json`)에 들어 있으나 1.0.7 빌드엔 없다 |
| 새 영상 | 업로드되면 `homework_video_reviews` 줄이 `extract` 단계에 멈춰 있다(돈 드는 단계로 안 넘어감 — 안전) |

## 2. 이 PC에서 할 일 — 1.0.8 / 순번 10 게시 (`apps/sync-agent/README.md`의 절차 그대로)

전제: Windows x64 · Node/npm · .NET Framework `csc.exe` · FFmpeg(ffmpeg.exe·ffprobe.exe) · 서명 개인키 `%LOCALAPPDATA%\AYWA\ReleaseKeys\sync-agent-private.pem`.

1. `git switch main && git pull` → 루트 `pnpm install`.
2. **키 파일이 있는지 먼저 확인** — 없으면 `prepare:runtime`이 새 키를 만들고, 설치된 앱이 새 서명을 거부한다. 멈추고 원장에게 묻는다.
3. `apps/sync-agent/package.json`의 `"version": "1.0.7"` → `"1.0.8"` (내 파일로 커밋).
4. PowerShell:
   ```powershell
   cd <저장소>\apps\sync-agent
   npm ci
   $env:EYWA_AGENT_FFMPEG_DIR = '<ffmpeg bin 경로>'
   $env:EYWA_AGENT_SEQUENCE = '10'
   npm run prepare:runtime        # 매니페스트 소스(영상 추출 포함) 복사 + 쿼리 카탈로그 재생성 + 네이티브 실행기 컴파일
   npm test
   npm run package
   node test/package-audit.cjs
   node test/ui-smoke.cjs --packaged
   node test/bundled-runtime.cjs
   $env:EYWA_AGENT_RELEASE_BASE_URL = 'https://<앱 프로젝트>.supabase.co/storage/v1/object/public/sync-agent-releases/10/'
   node release.cjs
   node test/release-acceptance.cjs
   node register-release.cjs                                    # 로컬 검증
   node --env-file=..\..\.env.local publish-release.cjs         # 업로드 계획 확인
   node --env-file=..\..\.env.local publish-release.cjs --apply # 공개 버킷 sync-agent-releases/10/ 에 TUS 업로드
   node --env-file=..\..\.env.local register-release.cjs --verify-remote
   node --env-file=..\..\.env.local register-release.cjs --apply # 게시 파일 해시 확인 뒤 sync_agent_releases 행 등록(순번 재사용 거부)
   ```
   - 순번 10 경로의 파일은 **게시 뒤 교체하지 않는다**(실패하면 11로).
   - `prepare:runtime`이 "새 소스 추가 → SQL 카탈로그·RLS 표 검토"를 요구한다. 영상 추출이 쓰는 표 `homework_video_reviews`는 0390a가 `eywa_sync_agent` 역할 정책(`sync_agent_allow`·`sync_agent_tenant_boundary`)을 이미 건다. 카탈로그 재생성 결과에 그 표가 보이는지만 확인.
5. 커밋(내 파일만: `apps/sync-agent/package.json` + 바뀐 카탈로그 산출물이 추적 파일이면 그것) → 적대적 리뷰 → `git fetch` → 병합 → 푸시는 원장 승인 뒤 `# ALLOW_DANGER`.
6. 발송 PC의 AYWA 연동 앱: 6시간 안에 1.0.8을 내려받는다. 앱 화면에서 **지금 업데이트**(작업 사이에 멈추고 적용). 원장이 직접 누르거나 승인 후 진행.

## 3. 게시 뒤 확인 (돈 안 드는 조회만)

```sql
-- 단계 분포: extract에 멈춘 줄이 transcribe→transcribing→judge로 흘러가야 한다
select stage, count(*) from homework_video_reviews where tenant_id='becaa316-e636-42e9-9d09-08b133e0b094' group by stage;
-- 밤(KST 21~06) 배치 뒤: 어느 키로 불렸나 — 'video'여야 한다('default'면 전용 키를 못 읽은 것)
select provider, key_name, model, count(*), max(created_at) from ai_usage_logs
 where feature like 'video_review%' and created_at > now() - interval '1 day' group by 1,2,3;
-- 비용 재료(캐시 토큰 포함)
select model, sum(input_tokens) i, sum(output_tokens) o, sum(cache_read_tokens) cr, sum(cache_write_tokens) cw
  from ai_usage_logs where feature like 'video_review%' and key_name='video' group by model;
```
- 콘솔 잔액: platform.claude.com/settings/billing → **Promotional credits**(포함 크레딧이 먼저 소진, 매 결제 주기 소멸).
- 전사 비용: AssemblyAI `universal-2` 시간당 $0.15 — 지금까지 10.66시간 ≈ $1.6.

## 4. 결정·규칙(이 기능 한정 · 본문은 `docs/decisions/reports-ai.md` "영상 설명 AI 참고 메모")
- 수학 영상만 · 과목 미상 173건은 대상 아님(원장 "수학만해") · 7일 창 없이 분석 줄이 없는 수학 영상 전부 대기열.
- 전사는 영상당 1회(AssemblyAI) · 판정 Haiku 5.5 · 오류 주장만 Sonnet 5.5 확인 · 밤 Message Batches(50%) · 프롬프트 캐싱 켬.
- 화면 이미지 Claude 전송은 이 기능만 승인 · 소리·전사·화면은 비공개 버킷/DB에만, 외부로는 분석 결과만.
- 테스트는 내부 요금제(개발 CLI `claude -p`) · 외부 키로 돈 쓰기 전엔 반드시 묻기(AssemblyAI 제외) · 모델은 최신 세대만.

## 5. 개발 PC(맥)에 남은 것 — 정리해도 된다
- 워크트리 `~/eywa-recovery/wt-vreview`(브랜치 `feat/video-review`, main과 같은 내용) — `git worktree remove` 가능.
- 개발 서버(3100)·감시 루프·드라이버 전부 꺼져 있음. 전사 음성·화면 임시 파일은 `~/eywa-data/video-analysis/`(외부 반출 금지).
- SQL 도구 `~/eywa-recovery/sqltool/q.mjs`(맥 전용 · 운영 DB 읽기/적용).

## 6. 알고 있는 main의 기존 결함(이 작업과 무관 · 손대지 않음)
- 타입 오류 3개 `src/app/dev/dashboard-harness/harness.tsx`(`subjectKeys` 누락 · 빌드는 `ignoreBuildErrors`로 통과).
- 전체 vitest 20파일·74건 실패(퇴원보고서·셔틀 parent-rides·교재 school-exam·슬랙 카탈로그 등) — origin/main에서도 동일.
