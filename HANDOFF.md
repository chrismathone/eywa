# eywa 이어가기 핸드오프 — 2026-06-16 (검증·머지 완료본)

다른 컴퓨터에서 **이 시점부터 바로** 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md),
이 문서는 **현재 상태 + 셋업 + 다음 할 일**만 담는다.

---

## 🚀 새 세션 시작 프롬프트 (다른 컴에서 복사-붙여넣기)

> eywa(예: `C:\Creative\eywa`, **main 브랜치**)에서 작업 이어간다. Stage Manager 워크스페이스 UI —
> 태블릿 드래그-팬, 메뉴별 창 크기, **배경 교체**(SendToBack, 연타 하드닝), 스냅/타일 **해제 시 원래
> 크기 복원**, 스냅바 히스테리시스, 상단 클램프, **창 애니메이션**(설정 토글이 OS reduce-motion
> 덮어씀), 커맨드 팰릿(빈→타이핑 필터) — **전부 구현·브라우저 검증·main 머지 완료**(`a044fe6`).
> 워크스페이스 UI(#12~21)는 전부 완료·검증·머지됨. **검색 데이터 색인(#18)도 완료**(pg_trgm 트라이그램
> 색인 + 팰릿 데이터 검색). 재등록 캠페인(#6)까지 **계획 작업(#6·#12~#21) 전부 구현·검증·main 머지 완료.**
> 시작 전 `HANDOFF.md` + `CLAUDE.md`(특히 "막혔던 점들 #44~48")를 읽어라. `.env.local` 필요(아래 §2).
> 개발은 NVMe에서(USB/F: 금지), `pnpm dev`는 포트 3100.

---

## 0. TL;DR — 새 컴에서 시작

```bash
# 1) 코드 받기 — 모든 작업이 main에 있음(브랜치 전환 불필요)
git clone https://github.com/BIGSHOL/eywa.git C:\Creative\eywa
# (기존 클론이면) git switch main && git pull

# 2) .env.local 준비 (§2의 변수 — 값은 Supabase/Vercel 대시보드 또는 기존 머신에서 복사)

# 3) 설치 + 실행
pnpm install
pnpm dev                      # http://localhost:3100  (포트 3100 고정)

# 4) 로그인: chrismathone@gmail.com (원장 투어). 전체 계정은 CLAUDE.md "데모 로그인 계정" 표.
```

⚠️ **작업 위치는 NVMe 디스크. USB/외장(F: 등) 금지** — Turbopack 패닉·파일 손상(검증됨). CLAUDE.md 참고.

---

## 1. 저장소 / 브랜치 상태

- **`main` = `feat/retention` = `a044fe6`** — 모든 작업이 **main에 머지·push 완료**. 새 클론은 그대로 사용.
- `cedde86`(이전 main) 대비 **7 커밋**:
  ```
  a044fe6 fix(workspace): 창 애니메이션 토글이 OS reduce-motion을 덮어쓰게
  325c793 docs: 다른 컴에서 이어가기 위한 핸드오프
  34fde7f docs(claude): 세션 난점·결정 기록 (#44~48)
  d714362 feat(search): 커맨드 팰릿 — 입력 전엔 안 펼치고 타이핑 시 매칭만
  3554639 feat(workspace): 배경 교체 + 창 컨트롤·레이아웃 복원·애니메이션
  5c71b5d feat(workspace): 태블릿 드래그-팬 스크롤 + 메뉴별 창 크기
  f3d40f8 feat(retention): 이탈 방어 — 위험 브리핑·리텐션 보드·학부모 메시지
  ```
- ⚠️ **여러 세션이 병렬로 작업하는 repo** — push 전 `git fetch` + 최신 확인, **force push 금지**. CLAUDE.md "Git 협업 규칙".

---

## 2. 환경변수 (`.env.local`, 값 미포함 — 대시보드/기존 머신에서)

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (admin/seed/super-admin) |
| `DATABASE_URL` | Postgres **Session pooler** URL (5432, `aws-1-…pooler`. CLAUDE.md #8) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_CONSULTATIONS` | 등록상담·회의록 / 학생 케어 AI |
| `ASSEMBLYAI_API_KEY` / `ASSEMBLYAI_WEBHOOK_SECRET` | 회의록 음성 STT |
| `GEMINI_API_KEY` | (등록만, 미사용) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` · `NEXT_PUBLIC_APP_URL`/`VERCEL_URL` | Sheets·웹훅(선택) |

명령: `pnpm dev`(3100) · `pnpm typecheck` · `pnpm lint` · `pnpm test`(124통과) · `pnpm build` · `pnpm db:seed`.

---

## 3. 이번 세션에 한 것 (요약 — 전부 main 반영)

1. **이탈 방어(retention)** — 출결·성적·상담·수납 신호로 위험 학생 산출(브리핑/보드/학부모 메시지,
   무비용 결정적 템플릿). 조치 → `student_consultations` INSERT. `src/features/retention/**`.
2. **태블릿 드래그-팬**(`DragScrollArea`) + `ROUTE_WINDOW_SIZE`(시간표 1040×680).
3. **배경 교체**(`SendToBack`) — 플로팅 창 ⇄ 배경 1:1 맞교환. `store.background`로 연타 레이스 제거.
4. **창 컨트롤/레이아웃** — 툴팁 4종, 스냅/타일 **해제 시 원래 크기 복원**(snapped), 스냅바 히스테리시스,
   드래그 상단 클램프.
5. **창 애니메이션** — 등장/퇴장(닫기·최소화·교체) + 설정 토글(`usePrefs`). **토글이 OS reduce-motion
   을 덮어씀**(기본값만 OS 따름).
6. **커맨드 팰릿** — 클릭 시 빈 검색창(센터), 타이핑해야 매칭만.

---

## 4. ✅ 브라우저 시각 검증 — 전부 통과 (Chrome, localhost:3100, 콘솔 0 에러)

- [x] 배경 교체 버튼 = `SendToBack` 아이콘 + 4개 툴팁(배경 교체/최소화/최대화/닫기)
- [x] 커맨드 팰릿: 빈 검색창 → "수납" 입력 시 "수납관리"만(처음부터 안 펼침), 중앙
- [x] 설정 "창 애니메이션" 토글 존재 + 동작 / 닫기 시 `animate-out`→언마운트
- [x] **애니메이션 OS reduce-motion 덮어쓰기**: OS 동작 줄이기 ON이어도 설정 ON이면 보임(확인)
- [x] 스냅(좌측) → snapped+prevRect 보존 → 드래그로 빼면 **원래 1040×680 복원**
- [x] 상단 클램프: 타이틀바 최상단으로 끌어도 헤더 아래(y=48) 완전 노출
- [x] 배경 교체 연타 → 유령 창 0개
- 코드 게이트: typecheck 0 · lint 0 errors · test 124/124 · build 성공

> 주의: 테스트로 데모 학생 "한지우"가 안정으로 바뀌어 있을 수 있음 → `pnpm db:seed`로 원복.
> **dev 전용(커밋 제외, 새 컴엔 없음)**: `src/app/retention-preview/` + `proxy.ts`의 `/retention-preview`
> PUBLIC_PATHS 1줄. 검증은 그냥 로그인해서 `/retention`으로.

---

## 5. 다음 작업 (택일)

- ~~#18 검색 데이터 색인~~ → **완료·검증**: pg_trgm 트라이그램 GIN 색인(`0024a_search_trgm.sql`, 적용됨) +
  팰릿이 학생·수업·상담·등록상담을 서버 검색(`/api/search/palette`, `src/features/search/server/queries.ts`).
  - 설계: 대상(학생·수업·상담 우선)에 `tsvector` generated 컬럼 + GIN 인덱스, RLS 통과 검색 RPC,
    `/api/search?q=` + 디바운스, 커맨드 팰릿에서 메뉴(클라 즉시)+데이터(서버) 합치기.
  - ⚠️ **공유 Supabase 스키마 마이그레이션** → 범위 합의 후. 흐름은 CLAUDE.md "마이그레이션 & 시드".
- ~~#20 배경 탭 스택~~ → **완료·검증**: 배경이 다중 스택(맨 뒤 대시보드 고정). 창의 '배경으로 보내기'로
  push, 상단 스트립에서 클릭=배경 전환 / 우클릭=창으로 꺼내기. `src/components/workspace/background-tabs.tsx`.
- ~~#6 재등록 캠페인~~ → **완료·검증**: 신규 테이블 `reenrollment_campaign_targets`(0024+0024b, RLS) +
  4번째 탭 `/retention/campaign`(KPI·재등록률 + 후보 스트립 + 4열 퍼널 칸반). 상태 전환 = 서버 액션
  (`retention/server/actions.ts`의 campaign*) + revalidate. 시드에 데모 8명.

---

## 6. 태스크 보드

완료: **#6 + #12~21** (워크스페이스 UI + 검색 색인 + 재등록 캠페인 — 전부). 미완 큰 작업 없음.

---

## 7. 코드 지도 (핵심)

- 워크스페이스: `src/components/workspace/` — `window-store.ts`(창·배경·snapped),
  `floating-window.tsx`(크롬·교체·애니메이션), `workspace-canvas.tsx`(캔버스·pathname 동기),
  `use-pointer-drag/resize.ts`, `window-geometry.ts`(순수 기하·ROUTE_WINDOW_SIZE), `motion.ts`·`use-prefs.ts`(모션).
- 공용: `src/components/ui/drag-scroll-area.tsx` · `command-palette.tsx` · `user-menu.tsx`(설정) · `app-sidebar.tsx`.
- 리텐션: `src/features/retention/**` · `src/app/(shell)/retention/**`.
- ⚠️ 함정·결정은 CLAUDE.md "막혔던 점들 **#44~48**"(배경교체 레이스·스냅 복원·드래그 클램프·애니메이션·커밋 분할).
