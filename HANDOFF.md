# eywa 이어가기 핸드오프 — 2026-06-16

다른 컴퓨터에서 이 작업을 그대로 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md)에,
이 문서는 **현재 상태 + 다음 할 일 + 셋업**만 담는다.

---

## 0. TL;DR — 새 컴에서 시작

```bash
# 1) 코드 받기 (작업 브랜치 = feat/retention)
git clone https://github.com/BIGSHOL/eywa.git C:\Creative\eywa   # 또는 기존 클론에서:
git fetch origin && git switch feat/retention && git pull

# 2) .env.local 준비 (§2의 변수 — 값은 Supabase/Vercel 대시보드 또는 기존 머신에서 복사)

# 3) 설치 + 실행
pnpm install
pnpm dev                      # http://localhost:3100  (포트 3100 고정)

# 4) 로그인 계정은 CLAUDE.md "데모 로그인 계정" 표 참고 (chrismathone@gmail.com = 원장 투어)
```

⚠️ **작업 위치는 NVMe 디스크(예: `C:\Creative\eywa`). USB/외장(F: 등) 금지** — Turbopack PostCSS
워커 IPC 타임아웃 패닉·파일 손상 유발(검증됨). 자세히는 CLAUDE.md.

---

## 1. 저장소 / 브랜치 상태

- **작업 브랜치: `feat/retention`** (origin에 push됨). `main` 대비 **6 커밋 ahead, 0 behind**.
- PR 미생성 — 필요 시: https://github.com/BIGSHOL/eywa/pull/new/feat/retention
- 커밋(아래에서 위로 최신):
  ```
  (이 문서 커밋)  docs: 이어가기 핸드오프
  34fde7f docs(claude): 세션 난점·결정 기록 (#44~48 + 남은 작업)
  d714362 feat(search): 커맨드 팰릿 — 입력 전엔 안 펼치고 타이핑 시 매칭만
  3554639 feat(workspace): 배경 교체 + 창 컨트롤·레이아웃 복원·애니메이션
  5c71b5d feat(workspace): 태블릿 드래그-팬 스크롤 + 메뉴별 창 크기
  f3d40f8 feat(retention): 이탈 방어 — 위험 브리핑·리텐션 보드·학부모 메시지
  ```
- ⚠️ **여러 세션이 병렬로 작업하는 repo** — push 전 `git fetch` + 최신 확인. main에 직접 push 금지,
  feature 브랜치 유지. 자세히는 CLAUDE.md "Git 협업 규칙".

---

## 2. 환경변수 (`.env.local`, 값은 미포함 — 대시보드/기존 머신에서)

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon 키 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (admin/seed/super-admin) |
| `DATABASE_URL` | Postgres **Session pooler** URL (port 5432, `aws-1-…pooler`. Direct/IPv4·6543은 이슈 — CLAUDE.md #8) |
| `ANTHROPIC_API_KEY` | 등록상담·회의록 AI |
| `ANTHROPIC_API_KEY_CONSULTATIONS` | 학생 케어 인사이트 AI |
| `ASSEMBLYAI_API_KEY` / `ASSEMBLYAI_WEBHOOK_SECRET` | 회의록 음성 STT |
| `GEMINI_API_KEY` | (등록만, 현재 미사용) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google Sheets 동기(선택) |
| `NEXT_PUBLIC_APP_URL` / `VERCEL_URL` | 웹훅 콜백 URL(선택) |

명령: `pnpm dev`(3100) · `pnpm typecheck` · `pnpm lint` · `pnpm test`(vitest, 현재 124통과) · `pnpm build` ·
`pnpm db:seed`(데모 데이터 idempotent 리셋).

---

## 3. 이번 세션에 한 것 (요약)

1. **이탈 방어(retention)** — 출결·성적·상담·수납 신호로 위험 학생 산출하는 네이티브 기능
   (위험 브리핑/리텐션 보드/학부모 메시지). 메시지는 **무비용 결정적 템플릿**(LLM 0). 조치 기록 →
   `student_consultations` INSERT. `src/features/retention/**`, `src/app/(shell)/retention/**`.
2. **태블릿 드래그-팬**(`DragScrollArea`) — 넘치는 영역을 마우스로 잡고-끌기+관성+가장자리 페이드.
   시간표에 적용. `ROUTE_WINDOW_SIZE`로 넓은 메뉴(시간표 1040×680)는 플로팅 창을 크게 연다.
3. **배경 교체**(`SendToBack` 버튼) — 플로팅 창 ⇄ 배경(대시보드) 1:1 맞교환. `store.background`를
   pathname과 동기 → 연타 레이스 제거.
4. **창 컨트롤/레이아웃** — 툴팁(교체/최소/최대/닫기), 스냅·타일 **해제 시 원래 크기 복원**(snapped),
   스냅 바 **히스테리시스**(상단 끝까지 올려야 노출), 드래그 **상단 클램프**(타이틀 가림 방지).
5. **창 애니메이션** — 등장/퇴장(닫기·최소화·교체) + 설정 **"창 애니메이션" 토글**(UserMenu, `usePrefs`).
6. **커맨드 팰릿** — 클릭 시 빈 검색창(센터), 타이핑해야 매칭만 표시(처음부터 전체목록 X).

---

## 4. ⚠️ 미완료 / 반드시 확인할 것

- **🔴 브라우저 시각 검증이 안 됨** — 이번 세션 내내 Chrome 확장 연결이 끊겨, UI 변경을 **눈으로 확인 못 했다**.
  코드 게이트(typecheck/lint/test/**build**)는 전부 통과. **새 컴에서 Chrome로 아래를 먼저 검증할 것:**
  - [ ] 배경 교체 버튼 = `SendToBack` 아이콘 + 4개 컨트롤 툴팁(배경 교체/최소화/최대화/닫기)
  - [ ] 닫기·최소화·배경교체 시 **zoom-out 애니메이션**, 설정에서 "창 애니메이션" OFF 하면 즉시(모션 0)
  - [ ] 창을 스냅/타일 → 드래그로 빼면 **원래(처음) 크기로 복원**
  - [ ] 스냅 레이아웃 바는 창을 **상단 끝까지 올려야** 뜸(그냥 잡고 움직여선 안 뜸)
  - [ ] 드래그로 타이틀바가 **헤더 위로 사라지지 않음**
  - [ ] 헤더 검색 클릭 → **빈 검색창만**, 타이핑해야 결과. 위치 중앙(top 26vh)
  - [ ] 배경 교체 **연타**해도 유령 창(`route:admin` 등) 안 생김
- **데모 데이터 주의**: 테스트 중 학생 "한지우"가 안정으로 바뀌어 현재 위험/관심 0일 수 있음.
  다양성 복원하려면 `pnpm db:seed`.
- **dev 전용(커밋 제외, 로컬만)**: `src/app/retention-preview/`(무인증 fixture 미리보기) + `proxy.ts`의
  `PUBLIC_PATHS`에 `/retention-preview` 1줄. 이 두 개는 **푸시 안 했으니 새 컴엔 없다** — 검증은 그냥
  로그인해서 `/retention`으로. 필요하면 dev용으로 다시 만들면 됨.

---

## 5. 다음 작업 (순서대로)

1. **시각 검증** (§4 체크리스트, Chrome 필요) — 최우선.
2. **#18 검색 데이터 색인 (FTS)** — 방향 **확정: Postgres FTS**. 미구현.
   - 설계: 대상 테이블(학생·수업·상담 우선)에 `tsvector` 컬럼(generated) + GIN 인덱스, RLS 통과
     검색 RPC(`search(q)`), `/api/search?q=` + 디바운스, 커맨드 팰릿에서 메뉴(클라 즉시) + 데이터(서버) 합치기.
   - ⚠️ **공유 Supabase 스키마 마이그레이션**이라 범위 합의 후 진행. 마이그레이션 흐름은 CLAUDE.md 참고
     (drizzle generate + `0001a_*.sql` alpha 손수 SQL).
3. **#20 배경 탭 스택(다중 배경)** — 현재 1:1 맞교환만(`window-store.background` 단일). 다중은 배경 전환
     UI(하단 스트립/dots 등) 필요해 보류 — 1:1로 충분한지 실사용 보고 결정.
4. **#6 retention Phase 4 — 재등록 캠페인** — 신규 DB 테이블 필요. **미착수.**

---

## 6. 태스크 보드 (workspace UI 묶음)

완료: #12 애니메이션 · #13 애니메이션 토글 · #14 레이아웃 복원 · #15 스냅바 트리거 · #16 상단 클램프 ·
#17 커맨드 팰릿 · #19 배경교체 하드닝 · #21 아이콘.
미완: **#18 FTS(설계 확정·미구현)** · **#20 배경 탭 스택(보류)** · **#6 재등록 캠페인(미착수)**.

---

## 7. 코드 지도 (이번 변경 핵심 파일)

- 워크스페이스(Stage Manager): `src/components/workspace/` — `window-store.ts`(창 상태·배경·snapped),
  `floating-window.tsx`(창 크롬·교체·애니메이션), `workspace-canvas.tsx`(캔버스·pathname 동기),
  `use-pointer-drag.ts`/`use-pointer-resize.ts`(드래그·리사이즈), `window-geometry.ts`(순수 기하·ROUTE_WINDOW_SIZE),
  `motion.ts`·`use-prefs.ts`(애니메이션 게이트).
- 공용: `src/components/ui/drag-scroll-area.tsx`(드래그-팬), `src/components/command-palette.tsx`(검색),
  `src/components/user-menu.tsx`(설정 토글), `src/components/app-sidebar.tsx`(레일 활성표시).
- 리텐션: `src/features/retention/**`, `src/app/(shell)/retention/**`.
- ⚠️ 함정·결정은 CLAUDE.md "구현 중 막혔던 점들" **#44~48**(배경교체 레이스, 스냅 복원, 드래그 클램프,
  애니메이션·모션 토글·TS 클로저 narrowing, 커밋 분할)을 꼭 읽을 것.
