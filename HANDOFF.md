# eywa 이어가기 핸드오프 — 2026-06-17 (데모 데이터 정합·온보딩·브랜드 + 수납관리 책갈피 교재/지출)

다른 컴퓨터에서 **이 시점부터 바로** 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md),
이 문서는 **현재 상태 + 셋업 + 다음 할 일**만 담는다.

---

## 🚀 새 세션 시작 프롬프트 (다른 컴에서 복사-붙여넣기)

> eywa(예: `C:\Creative\eywa`, **main 브랜치**)에서 이어간다. 직전 세션에서 **3제품 비교(makeedu·ijw·eywa) → 데모 완성
> 백로그를 우선순위로 처리**했고, **수납관리에 책갈피 3면(수납/교재/지출) + 교재신청·지출 신규 테이블·실데이터 이식**까지
> 구현·검증·커밋·push(main)했다. 전 게이트 그린(typecheck·lint 0err·test 157·build). 처리한 것: 상담 데이터 다중 오매핑
> 버그(1338행 패치)·담임 263 유도·성적 3290 합성·멀티윈도우 온보딩 코치마크·브랜드 로고(botanical)·AI 목업 라벨·창 로딩 ← 가드.
> ⚠️ **데모 데이터 주의**: `ijw-demo` 테넌트는 깨끗한 `scripts/seed.ts`가 **아니라** ijw-calander 레거시를 적재한
> POC 임포트본(학생 ~564명, 실제 회의녹취·상담 포함)이다. 보이는 쓰레기 레코드·동명이인 접미사는 데이터 결함이지 코드 버그 아님.
> ⚠️ **`pnpm db:seed` 절대 금지** — 데모는 임포트본이라 seed가 전체 wipe한다. 데모 데이터 보정은 `scripts/_poc_migration/*.cjs`(멱등).
> **최종 목표는 ijw Firebase 전체 데이터 이식**(서비스계정 `F:\ijw-calander\serviceAccount.json`, Firestore DB `restore260202`).
> 단 재구성 export 파이프라인이 소멸해 재구축 필요(=별도 프로젝트). 시작 전 `HANDOFF.md` + `CLAUDE.md`("막혔던 점들 **#44~56**",
> "AI 모델 정책")를 읽어라. `.env.local` 필요(§2). `pnpm dev`는 포트 3100.

---

## 0. TL;DR — 새 컴에서 시작

```bash
# 1) 코드 받기 — 모든 작업이 main에 있음
git clone https://github.com/BIGSHOL/eywa.git C:\Creative\eywa
# (기존 클론이면) git switch main && git pull --rebase

# 2) .env.local 준비 (§2의 변수 — 값은 Supabase/Vercel 대시보드 또는 기존 머신에서 복사)
#    ⚠️ openai 패키지 + UPSTAGE_API_KEY 필요(AI provider 기본 = upstage Solar). §2 참고.

# 3) 설치 + 실행
pnpm install                  # openai 등 의존성 포함(설치 누락 시 AI 경로 Module not found)
pnpm dev                      # http://localhost:3100  (포트 3100 고정)

# 4) 로그인: chrismathone@gmail.com (원장 투어). 전체 계정은 CLAUDE.md "데모 로그인 계정" 표.
```

⚠️ **작업 위치는 NVMe 디스크. USB/외장(F: 등) 금지** — Turbopack 패닉·파일 손상(검증됨).

---

## 1. 저장소 / 브랜치 상태

- **`main` 최신** — 모든 작업 main에 머지·push 완료. 새 클론 그대로 사용.
- 본 세션 커밋(위=최신, 4커밋):
  ```
  docs: 핸드오프·CLAUDE·README 최신화                                ← 본 세션
  feat(marketing): 랜딩 재설계 WIP (outcomes·feature-switcher·photo) ← 병렬 세션 WIP 동반
  feat(qa,workspace): 데모 데이터 정합·온보딩·로고·AI라벨 + 창 로딩 ← 가드
  feat(billing): 수납관리 책갈피 3면 — 교재신청·지출 + 테이블·RLS·소스이식
  ```
- 📌 **직전 다른 세션(대시보드)**: `/dashboard`를 "운영 콕핏"으로 개편(`c6316fc`) + 워크스페이스 "커서 위치 창 열기"(`dc6a0f8`).
  그래서 본 세션의 #4(대시보드 차트 임팩트)는 **그 개편으로 대체**되어 미적용(로고만 적용).
- ⚠️ **여러 세션이 병렬로 작업하는 repo** — push 전 `git fetch` + `git pull --rebase`, **force push 금지**. CLAUDE.md "Git 협업 규칙".

---

## 2. 환경변수 (`.env.local`, 값 미포함 — 대시보드/기존 머신에서)

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (admin/seed/super-admin) |
| `DATABASE_URL` | Postgres **Session pooler** URL (5432, `aws-1-…pooler`. CLAUDE.md #8). 데모 보정 스크립트도 이걸 읽음 |
| `AI_PROVIDER` | `upstage`(기본·Solar Pro 3) 또는 `anthropic`. 미설정 시 upstage. (CLAUDE.md "AI 모델 정책") |
| `UPSTAGE_API_KEY` / `UPSTAGE_API_KEY_CONSULTATIONS` | Upstage Solar (등록상담·회의록 / 학생 케어). 없으면 Anthropic 폴백 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_CONSULTATIONS` | Anthropic (폴백·reasoning) |
| `ASSEMBLYAI_API_KEY` / `ASSEMBLYAI_WEBHOOK_SECRET` | 회의록 음성 STT |
| `GEMINI_API_KEY` | (등록만, 미사용) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` · `NEXT_PUBLIC_APP_URL`/`VERCEL_URL` | Sheets·웹훅(선택) |

명령: `pnpm dev`(3100) · `pnpm typecheck` · `pnpm lint` · `pnpm test`(**157통과**) · `pnpm build` · `pnpm db:seed`(⚠️데모엔 금지).
> ⚠️ `pnpm build`는 dev 서버를 끄고 돌릴 것(.next 충돌, CLAUDE.md #36).

---

## 3. 한 것 (본 세션 — 전부 main)

**A. 3제품 비교(makeedu·ijw·eywa).** 세 제품을 브라우저로 둘러보고 멀티에이전트로 eywa 코드 실측 + 5차원 비교 →
데모 완성 백로그 도출. eywa 약점은 "구현 깊이"가 아니라 "범위"(대부분 의도적 제외)로 확인.

**B. 데모 데이터 정합(DB 패치, 멱등 스크립트 `scripts/_poc_migration/*.cjs`).**
1. **상담 데이터 버그(데모 직격)** — import(`run.ts`)가 소스 필드를 다중 오매핑(summary←notes·category←type·follow←followUpContent)해
   1340 상담이 전부 "(내용 없음)"·category="parent"였음. run.ts 재매핑 수정 + `fix-consultations.cjs`로 기존 1338행 패치(소스 students 재조인).
2. **담임 263명** 실수강+시간표 시간으로 유도(`fix-primary-teacher.cjs`, 261은 반 teacher_id 공란이라 미설정).
3. **성적 3290행 합성**(`fabricate-grades.cjs`, 전 enrolled·결정적) — ⚠️**가짜 데이터**(소스에 성적 없음), 분석 근거로 쓰지 말 것.

**C. UX/브랜드.**
4. **멀티윈도우 온보딩** — 첫 진입 코치마크(`workspace-onboarding.tsx`, prefs.onboarded) + 닫을 때 사이드바 펼침(발견성).
5. **브랜드 로고** — 검은 동심원 → 포레스트그린 사각 + 흰 sprout(botanical) 마크(`app-sidebar.tsx`).
6. **AI 목업 라벨** — 퇴원관리 "인사이트"(sparkle) → "자동 요약"(pulse). 라이브 AI(등록/케어/회의록)와 구분.
7. **창 로딩 ← 버그** — `route-window.tsx`가 about:blank 단계 pathname("blank")으로 canBack 오판 → 스켈레톤에 ← 떴음. 가드 추가.

**D. 수납관리 책갈피 3면(신규 기능).**
8. 창 오른쪽 **세로 책갈피**(수납/교재/지출, 파스텔, 앨범 인덱스)로 `?tab=` 면 전환(드릴인 아님 → ← 안 뜸).
9. 신규 `textbook_orders`·`expenses` 테이블(`0025`+`0025a` RLS) + ijw 소스 **실데이터 이식**(교재 350·지출 95, `import-textbooks-expenses.cjs`).
10. 창 폭 760×620 등록 + floating-window 타이틀바=live 문서제목 항상 표시(탭 제목 노출). 자세히는 CLAUDE.md "데모 데이터 정합…" 섹션.

---

## 4. 창 내비게이션 모델 (Idea A — 동작 규칙, 유효)

라우트 창(메뉴·상세를 크롬리스 iframe으로 띄움)의 "뒤로/닫기":

| 상태 | 타이틀바 ← | 닫기 |
|---|---|---|
| **루트(첫 화면)** — 카드에서 직접 연 상세, 또는 메뉴 루트 | **없음**(드릴 안 함) | 우상단 X → 닫으면 배경 즉시 새로고침 |
| **드릴인** — 예: 김수진수정 → 급여정산 | **있음** → iframe `history.back()` | 루트 도달 후 X |

- 타이틀바 제목은 iframe 현재 문서제목을 항상 표시(루트·드릴인·`?tab=` 면 전환 모두). **`?tab=`(수납관리 책갈피)은 pathname
  불변이라 ←가 안 뜬다**(형제 면 전환).
- 인페이지 "← …로" 헤더는 **배경 풀페이지에서만** 보이고 창(임베드)에선 안 보인다.
- 구현: `floating-window.tsx`(← 버튼·closeAndRefresh·타이틀 live), `route-window.tsx`(iframe 제목/경로 관찰·about:blank 가드·`iframeRegistry`),
  `window-store.ts`(`live`/`setLive`), `embed-context.tsx`+`back-link.tsx`.

---

## 5. ✅ 검증 (Chrome/Preview, localhost:3100, 콘솔 0 에러)

- [x] 수납관리 책갈피: 수납/교재/지출 면 전환, 활성 책갈피 강조, 타이틀바 "수납관리 · 교재신청" 갱신, **← 안 뜸**, 교재 350·지출 95 표시
- [x] 창 로딩 스켈레톤·루트에서 ← 미표시 / 드릴인에서만 표시(로직 유지)
- [x] 멀티윈도우 온보딩 코치마크 1회 노출 → 닫으면 영속(재노출 안 함)
- [x] 브랜드 로고 포레스트그린 + sprout / 상담 빈값 0건(패치 후) / 성적 탭 데이터
- 코드 게이트: typecheck 0 · lint 0 errors(경고 11=기존) · test **157/157** · build OK

> 주의: 데모 데이터 보정은 DB에 직접 반영됨(상담 1338·담임 263·성적 3290·교재 350·지출 95). 다른 세션이 데모를 보면 즉시 반영.

---

## 6. 다음 작업

- ▷ (선택) **교재신청 상태 다양화** — 소스상 교재 350건이 거의 `납부(paid)`라 신청→배부→청구 흐름이 데모에서 평탄.
  시연용으로 일부를 in-flight 상태로 섞을 수 있음(데이터 조작이라 기본은 실데이터 유지).
- ▶ **데이터(최종): ijw Firebase 전체 이식** — Firestore(`restore260202`) → eywa export 파이프라인 재구축 → demo 적재.
  성공 시 쓰레기/접미사/빈 성적·담임/현재월 출석까지 근본 해소(현 보정 스크립트는 임시).
- ▶ **성능 최적화** — production 반응속도(Vercel cold start, pooler latency, 대시보드 streaming). CLAUDE.md "남은 작업".

---

## 7. 코드 지도 (이번 세션 추가/변경)

- **수납관리 책갈피**: `src/app/(shell)/billing/{page.tsx,_components/{billing-content,billing-tabs,textbooks-panel,expenses-panel}.tsx}`,
  `src/features/billing/server/{textbook,expense}-queries.ts`, `src/lib/db/schema.ts`(textbook_orders·expenses),
  `supabase/migrations/0025*`, `window-geometry.ts`(billing 760×620), `floating-window.tsx`(타이틀 live).
- **데모 보정 스크립트(멱등, `--apply`)**: `scripts/_poc_migration/{fix-consultations,fix-primary-teacher,fabricate-grades,import-textbooks-expenses}.cjs` + `run.ts`(상담 매핑 수정).
- **온보딩·로고·라벨**: `workspace-onboarding.tsx`+`workspace-canvas.tsx`+`use-prefs.ts`(onboarded), `app-sidebar.tsx`(로고), `withdrawals/page.tsx`(AI 라벨), `route-window.tsx`(← 가드).
- ⚠️ 함정·결정은 CLAUDE.md "막혔던 점들 **#44~56**" + "진행 상황".
