# aywa 이어가기 핸드오프 — 2026-07-06 (영어 시간표 이식 + 과목 운영 설정 + 과목 흡수 삭제, main 반영 완료)

> **원생 기여도·학생 온톨로지(2026-10-26): [`docs/handoff-student-contribution-2026-10-26.md`](docs/handoff-student-contribution-2026-10-26.md)** — UI 개선 배포 완료 · 다음 자동 집계의 재원기간 확인과 설명회 참석 반영 계획 인계.
>
> **영상 설명 AI 참고 메모(2026-10-21): [`docs/handoff-video-review-2026-10-21.md`](docs/handoff-video-review-2026-10-21.md)** — 연동 앱 게시·운영 확인 상태는 해당 문서의 최신 갱신을 따른다.
>
> 아래는 2026-07-06 시점의 기록이다. 현재 작업의 검증 범위와 절차는 최신 `AGENTS.md`·`CLAUDE.md` 및 해당 작업 핸드오프를 우선한다.

다른 컴퓨터/세션에서 **이 시점부터 바로** 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md),
영어 시간표 동기화의 데이터/스크립트 상세는 [`docs/_archive/ENGLISH_SYNC_HANDOFF.md`](docs/_archive/ENGLISH_SYNC_HANDOFF.md).
이 문서는 **현재 상태 + 셋업 + 다음 할 일 + 세션 경계**만 담는다.

> ⚠️ **aywa는 실운영 중 — main = 프로덕션(`www.aywa.co.kr`, 옛 `eywa-alpha.vercel.app`은 넘김).** 변경은 **dev에서 검증을 끝낸 뒤
> 사용자 승인이 있을 때만** main에 반영한다(곧바로 main 커밋·push 금지). 여러 세션이 병렬로 작업하므로 push 전
> `git fetch` + `git merge origin/main`(rebase 아님), **force push 금지**, 커밋은 **명시 경로**로. (CLAUDE.md "작업 격리 정책")

---

## 🚀 새 세션 시작 프롬프트 (복사-붙여넣기)

> aywa에서 이어간다. 직전 세션이 **(1) ijw 영어 시간표를 시트("강사별영어시간표"/"통합영어시간표")와 1:1로
> 이식**(교시 11개·LAB 병렬 슬롯·SKY 실방·강사뷰 10분 격자·합반 통합 명단), **(2) 강사뷰 하드코딩 값(가로줄·격자
> 단위·영어 교시)을 학원설정 "과목 운영" 탭으로 배선**(과목별 평일 교시 = ENGLISH_PERIODS KNOWN_EXCEPTION 해소),
> **(3) 운영 과목 삭제 = "다른 과목에 흡수"**(전 저장 표면 이동 + 0077a 원자 RPC)까지 구현·검증하고 **main에 반영·배포
> 완료**(Vercel success)했다. 전 게이트 그린(typecheck·lint 0 / **test 703** / build) + 시트 패리티 diff 0 + 적대
> 리뷰(병합 교차 CONFIRMED 4건 수정). ⚠️ **테넌트 `injaewon`은 운영 실데이터**(ijw 이관본) —
> 데모 시드(`pnpm db:seed`)는 운영 DB를 지울 수 있어 **2026-09-19 영구 제거**했다. 시작 전 `HANDOFF.md` + `docs/_archive/ENGLISH_SYNC_HANDOFF.md` + `CLAUDE.md`
> ("디자인 시스템", "막혔던 점들", "AI 모델 정책", "Git 협업 규칙")를 읽어라. `.env.local` 필요(§2).

---

## 0. TL;DR — 새 컴에서 시작

```bash
git clone https://github.com/BIGSHOL/eywa.git   # 또는: git switch main && git pull --no-rebase
# .env.local 준비(§2 — 값은 Supabase/Vercel 대시보드 또는 기존 머신에서 복사)
pnpm install        # openai·@google-cloud/storage 등 포함(누락 시 Module not found)
pnpm dev            # 메인 체크아웃 포트 3100 / 영어 워크트리는 3002
# 로그인: chrismathone@gmail.com(원장 투어). 전체 계정 = CLAUDE.md "데모 로그인 계정"
```
⚠️ **작업 위치는 NVMe 로컬 디스크. USB/외장 금지**(Turbopack 패닉·파일 손상, 검증됨).
⚠️ 워크트리 dev는 **repo 안**(`.claude/worktrees/` 또는 `C:\tmp\eywa-english`)에 둬야 Turbopack이 node_modules
정션을 허용(밖이면 "Symlink points out of filesystem root" 패닉).

---

## 1. 저장소 / 브랜치 상태 (main 최신, 2026-07-06)

- **origin/main = `c6b33c4`** — 이번 세션 작업이 전부 반영·배포됨(Vercel deploy success).
- 이번 세션 작업 브랜치 `Injaewon/english-timetable-import`도 **main과 동일 커밋**(tip 일치).
- ⚠️ **다른 PC의 메인 체크아웃(`C:\Creative\eywa`)은 origin/main보다 뒤에 있을 수 있음** → 작업 전 `git pull`.

**이번 세션 랜드마크(위=최신, 상세는 CLAUDE.md "진행 상황"):**
| 묶음 | 핵심 | 상태 |
|---|---|---|
| main 병합 | origin/main 11커밋(합반 통합 명단·기본뷰 격자 리워크·상담 스코핑 등) ↔ 브랜치 병합, 충돌 1(import 합집합), 적대리뷰 CONFIRMED 4건 수정 | ✅ main push·배포 |
| 과목 흡수 삭제 | 운영 과목 삭제 = 다른 과목에 흡수(스칼라 9테이블 + users.subjects[] + jsonb 2 + 설정). **0077a RPC**(원자, 프로덕션 DB 적용) | ✅ |
| 과목 운영 탭 | 강사뷰 가로줄·격자단위·**과목별 평일 교시**를 학원설정 신규 FaceTab으로. `weekdayTableFor` 폴백체인(과목전용→english→전역) | ✅ ENGLISH_PERIODS 하드코딩 해소 |
| 영어 강사뷰 | 시트 "강사별영어시간표" 그대로 — 10분 격자·병합·LAB 다중 레인·칩 토글·합반 묶음 | ✅ 패리티 diff 0 |
| 영어 데이터 이식 | 교시 11개·LAB 병렬 슬롯 54건·SKY 실방 15슬롯(운영 DB 적용) | ✅ verify-sheet-parity.cjs 상시 검증 |

---

## 2. `.env.local` (필수 키)

값은 Supabase/Vercel 대시보드 또는 기존 머신에서 복사(여기 실값 미기재):
- `DATABASE_URL`(Supabase session pooler — CLAUDE.md #8 IPv6/pooler 함정 참조)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTAGE_API_KEY`(AI 기본 Solar) / `ANTHROPIC_API_KEY`(폴백) — 없으면 stub 폴백
- `FIREBASE_SERVICE_ACCOUNT_KEY`(base64 — 레거시 오디오 + GCS 미디어 + 구글시트 SA)
- (선택) `NEXT_PUBLIC_APP_URL`·`CRON_SECRET`(웹훅·cron), `EYWA_VERIFY_EMAIL`/`EYWA_VERIFY_PASSWORD`(검증 스크립트)

---

## 3. 검증 게이트 (commit 전 4단계)

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build   # 전부 그린이어야 push
node --env-file=.env.local scripts/_english_sync/verify-sheet-parity.cjs   # 영어 시간표 상시 패리티(diff 0)
```
현재 상태: typecheck 0 / lint 0(경고 7=baseline) / **test 703** / build ✓ / 패리티 diff 0.

---

## 4. DB 마이그레이션 상태

- 2026-10-27 SQL 시즌2: 시즌1은 `supabase/migrations/s1_season1.sql` 하나 · 새 SQL은 `s2_NNNN_설명.sql` · 새(빈) DB = `pnpm db:alphas`(`db:migrate`는 안내만) · 운영 DB는 새 시즌2 파일 하나만 승인 뒤 적용.
- (시즌1 기록) 드리즐 번호본은 `db:migrate`, RLS/트리거/RPC 등 **손수 alpha(`000Na_*`)** 는 개별 적용(README §4·§5).
- **이번 세션 신규: `0077a_absorb_subject_rpc.sql`**(과목 흡수 RPC `absorb_subject_key`) — **프로덕션 DB 적용됨**
  (함수 생성만, main 코드가 호출). 신규 DB 셋업 시 `supabase/migrations/README.md`의 alpha 전체 목록대로 적용.
- ⚠️ 데모 시드(`pnpm db:seed`·`scripts/seed.ts`)는 **2026-09-19 영구 제거** — 테넌트 데이터를 먼저 지우는 구조라
  운영 DB를 날릴 수 있었다. 되살리지 말 것.

---

## 5. 다음 할 일 (우선순위)

1. **영어 시간표 "시트 반영" 버튼 정식화** — 시트↔앱 라운드트립(readSheetGridWithMerges + diff + 액션 + UI).
   현재는 스크립트(`scripts/_english_sync/`)로만 반영. 상세 = docs/_archive/ENGLISH_SYNC_HANDOFF.md §3-4.
2. **영어 강사 5명(Elsa·Anna·Dom·JJ·이주희) 직원 등록** + `english_name` + 담임 재지정 —
   미등록이라 통합뷰 담임 폴백이 "이주희"로 뜰 수 있음.
3. **`st2000423@gmail.com` 비밀번호 회전** — 검증 스크립트에서 env로 뺐으나 계정 자체 비번은 미회전
   (CLAUDE.md 데모 표에도 노출 → 회전 시 문서 동반 갱신).
4. (옵션) 수학 export 커스텀 교시 8개 초과 대응 — 익스포터 그리드가 레거시 8교시 고정이라 초과분은 미배치
   (현재 onSkippedSlots로 경고 로깅만). 영어 강사뷰 격자 톤·과목 운영 UI는 완료.

---

## 6. 세션 경계 / 주의

- **병렬 세션이 공유 파일(`CLAUDE.md`·`schema.ts`·`navigation.ts`·`periods.ts` 등)을 동시 편집** 가능 →
  커밋 직전 `git diff HEAD -- <파일>`로 내 변경만 들었는지 확인, `git commit -- <명시경로>`로 파일 단위 분리.
- **워크스페이스 모듈(window-store·floating-window)·서버 액션 변경 후엔 dev 재시작**(HMR stale, CLAUDE.md #35·#69).
- **브라우저 검증**은 auth 게이트로 강사/학생 로그인 불가(#31) → 데이터 레이어(DB 쿼리·롤백 트랜잭션) + 게이트 + 적대
  리뷰로 대체하는 것이 이 코드베이스의 표준.
