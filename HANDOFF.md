# eywa 이어가기 핸드오프 — 2026-06-16 (검증·머지 완료본)

다른 컴퓨터에서 **이 시점부터 바로** 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md),
이 문서는 **현재 상태 + 셋업 + 다음 할 일**만 담는다.

---

## 🚀 새 세션 시작 프롬프트 (다른 컴에서 복사-붙여넣기)

> eywa(예: `C:\Creative\eywa`, **main 브랜치**)에서 작업 이어간다. Stage Manager 워크스페이스 UI —
> 태블릿 드래그-팬, 메뉴별 창 크기, 배경 스택·전환 스트립, 스냅/타일 **해제 시 원래 크기 복원**,
> 스냅바 히스테리시스, 상단 클램프, 창 애니메이션(설정 토글이 OS reduce-motion 덮어씀),
> 커맨드 팰릿(빈→타이핑 필터), **검색 데이터 색인**(pg_trgm), **재등록 캠페인**(#6) — 전부 구현·검증·main 머지.
> **워크스페이스 드래그 어휘 통일**(최신): ①배경 탭을 아래로 끌면 창으로 꺼내기 ②창을 상단 '배경으로' 칩에
> 끌면 배경으로(스냅바와 공존) ③좌측 레일 아이콘을 오른쪽으로 끌면 드롭 지점에 창 — 모두 클릭·버튼 경로와 공존.
> 배경 탭은 **삽입 순서 고정**(선택해도 재정렬 X, 하이라이트만 이동). 출석부 범례 1행 우측. 시간표 dnd hydration 수정.
> **계획 작업(#6·#12~#21) + 후속 UI 다듬기 전부 완료·검증·main 머지**(HEAD `816a1ec`).
> 남은 큰 작업은 **성능 최적화**(CLAUDE.md "남은 작업"). 시작 전 `HANDOFF.md` + `CLAUDE.md`
> (특히 "막혔던 점들 **#44~52**")를 읽어라. `.env.local` 필요(아래 §2). 개발은 NVMe에서(USB/F: 금지), `pnpm dev`는 포트 3100.

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

- **`main` = `feat/retention` = `816a1ec`** — 모든 작업이 **main에 머지·push 완료**. 새 클론은 그대로 사용.
- 최근 커밋(위=최신):
  ```
  816a1ec feat(workspace): 좌측 레일 드래그-아웃 — 드롭 지점에 창 열기
  d33093c fix(timetable): DndContext에 id 지정 — hydration 불일치 해소
  0fc1e03 fix(attendance): 출석부 범례 1행 우측 정렬
  bf38c4f feat(workspace): 창→배경 드래그(배경 칩) — 스냅바와 공존
  8582e58 fix(workspace): 배경 탭 삽입 순서 고정 + 드래그로 창 꺼내기
  8fc37e3 feat(retention): 재등록 캠페인 (Phase 4) — 신규 테이블 + 퍼널 칸반
  b7201e6 feat(search): 데이터 검색 색인 — pg_trgm 트라이그램 + 팰릿 검색
  38655eb feat(workspace): 배경 탭 스택 — 다중 배경 + 상단 전환 스트립
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

## 3. 한 것 (요약 — 전부 main 반영)

**핵심 기능 (이전 세션들):**
1. **이탈 방어(retention)** — 출결·성적·상담·수납 신호로 위험 학생 산출(브리핑/보드/학부모 메시지,
   무비용 결정적 템플릿). 조치 → `student_consultations` INSERT. `src/features/retention/**`.
2. **태블릿 드래그-팬**(`DragScrollArea`) + `ROUTE_WINDOW_SIZE`(시간표 1040×680).
3. **배경 스택**(`SendToBack` → `swapToBackground`) — 다중 배경 + 상단 전환 스트립.
4. **창 컨트롤/레이아웃** — 툴팁 4종, 스냅/타일 **해제 시 원래 크기 복원**(snapped), 스냅바 히스테리시스, 상단 클램프.
5. **창 애니메이션** — 등장/퇴장 + 설정 토글(`usePrefs`, OS reduce-motion 덮어씀).
6. **커맨드 팰릿** — 빈 검색창 → 타이핑 시 매칭. **검색 데이터 색인**(pg_trgm) — 학생·수업·상담·등록상담 서버 검색.
7. **재등록 캠페인(#6)** — `reenrollment_campaign_targets`(RLS) + 4번째 탭 `/retention/campaign`(KPI·재등록률 + 4열 퍼널 칸반).

**후속 UI 다듬기 세션 (2026-06-16, HEAD `816a1ec`):**
8. **배경 탭 삽입 순서 고정** — `setBackground`가 선택 배경을 맨 위로 옮겨 스트립이 재정렬되던 것 수정.
   스택은 삽입 순서 불변, "보이는 배경"은 `activeBackgroundId`로 분리(하이라이트만 이동). 탭 클릭은 active 직접 갱신.
9. **워크스페이스 드래그 어휘 통일** — ①배경 탭 아래로 드래그 → 창(`backgroundToWindow`) ②창 → 상단 '배경으로'
   칩 드래그 → 배경(`swapToBackground`; 칩은 스냅바와 독립, 스냅바를 `SNAP_BAR_BG_OFFSET`만큼 밀어 공존)
   ③좌측 레일 아이콘 → 오른쪽 드래그 → 드롭 지점에 창(`open`+`setRect`). 전부 클릭/버튼 경로와 공존.
10. **출석부 범례 1행 우측 정렬** — 좁은 셀에서 5행 접힘 → 전체 폭 nowrap, 우측(`ml-auto`).
11. **시간표 dnd hydration 수정** — `<DndContext id="timetable-dnd">`로 `aria-describedby` SSR/CSR 불일치 해소.

---

## 4. ✅ 브라우저 시각 검증 — 전부 통과 (Chrome, localhost:3100, 콘솔 0 에러)

- [x] 배경 스택·전환 스트립, 스냅 복원(1040×680), 상단 클램프, 애니메이션 OS 덮어쓰기, 팰릿 빈→타이핑 (이전 세션)
- [x] **배경 탭 순서 불변**: 탭 반복 클릭에도 `[대시보드,시간표,출석부]` 유지, 하이라이트만 이동
- [x] **배경 탭 ↓드래그 → 창 복원** (`/timetable?embed=1` 재생성)
- [x] **창 → 상단 '배경으로' 칩 드롭 → 배경** (칩 강조 "놓으면 배경으로"), 칩+스냅바 비겹침 공존, **스냅 슬롯 드롭 = 2분할 타일링 정상**(934/934)
- [x] **레일 아이콘 →오른쪽 드래그 → 드롭 지점에 창** (작은 창 커서 일치 580/302, 큰 창 clamp) / **클릭 = cascade 유지**(회귀 없음)
- [x] `/timetable` 새로고침 **hydration 경고 0** (`aria-describedby='timetable-dnd'`, draggable 50개 정상)
- [x] 출석부 범례 1행 우측(flex-nowrap, 5개 Pill 동일 행)
- 코드 게이트: typecheck 0 · lint 0 errors · test 124/124 · build 성공

> 주의: 테스트로 데모 학생 상태가 바뀌어 있을 수 있음 → `pnpm db:seed`로 원복.
> **dev 전용(커밋 제외, 새 컴엔 없음)**: `src/app/retention-preview/` + `proxy.ts`의 `/retention-preview`
> PUBLIC_PATHS 1줄. 검증은 그냥 로그인해서 `/retention`으로.
> **워크스페이스 드래그를 합성 PointerEvent로 자동 검증할 땐 `setPointerCapture`+`releasePointerCapture`를
> 둘 다 no-op stub**해야 onPointerUp이 throw 없이 완주(CLAUDE.md #52).

---

## 5. 다음 작업

- ✅ **기능 백로그 전부 완료**: #6 재등록 캠페인 · #12~21 워크스페이스 UI · #18 검색 색인 · #20 배경 스택 ·
  후속 다듬기(배경 탭 순서·드래그 어휘·범례·hydration) — 모두 구현·검증·main 머지.
- ▶ **남은 큰 작업: 성능 최적화** — production 반응속도(Vercel cold start, pooler latency, 대시보드 N쿼리,
  미들웨어 중복). 상세는 **CLAUDE.md "남은 작업"** 참고.
- (선택) 워크스페이스 드래그 더 다듬기: 레일 드래그 tear-off(창이 커서 따라오기), 배경 칩 삽입 슬롯 선택 등.

---

## 6. 태스크 보드

완료: **#6 + #12~21 + 후속 UI 다듬기(드래그 어휘·배경 탭 순서·범례·hydration)** — 전부.
미완 큰 작업: **성능 최적화**(CLAUDE.md "남은 작업").

---

## 7. 코드 지도 (핵심)

- 워크스페이스: `src/components/workspace/` — `window-store.ts`(창·배경 스택·`activeBackgroundId`·`dragBackground`·snapped),
  `floating-window.tsx`(크롬·교체·애니메이션·배경 드롭 콜백), `workspace-canvas.tsx`(캔버스·pathname 동기),
  `use-pointer-drag.ts`(타이틀바 드래그 + 배경 칩 우선 판정), `use-pointer-resize.ts`,
  `window-geometry.ts`(순수 기하·ROUTE_WINDOW_SIZE·`backgroundDropZone`·`SNAP_BAR_BG_OFFSET`),
  `background-tabs.tsx`(전환 스트립 + 탭 드래그-아웃), `background-drop-zone.tsx`(창→배경 칩),
  `snap-layouts-bar.tsx`(칩 공존 오프셋), `motion.ts`·`use-prefs.ts`(모션).
- 공용: `drag-scroll-area.tsx` · `command-palette.tsx` · `user-menu.tsx`(설정) ·
  `app-sidebar.tsx`(아이콘 레일 + 레일 드래그-아웃 `RailItem`).
- 리텐션: `src/features/retention/**` · `src/app/(shell)/retention/**`.
- 시간표 dnd: `src/app/(shell)/timetable/_components/timetable-board.tsx`(`<DndContext id>`)·`class-cell.tsx`.
- ⚠️ 함정·결정은 CLAUDE.md "막혔던 점들 **#44~52**"(배경교체 레이스·스냅 복원·드래그 클램프·애니메이션·커밋 분할·
  배경 탭 순서·칩↔스냅바 공존·dnd hydration·합성 포인터 테스트).
