# eywa 이어가기 핸드오프 — 2026-06-17 (로그인 후 전수 QA + 창 내비게이션·쿼리 견고화)

다른 컴퓨터에서 **이 시점부터 바로** 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md),
이 문서는 **현재 상태 + 셋업 + 다음 할 일**만 담는다.

---

## 🚀 새 세션 시작 프롬프트 (다른 컴에서 복사-붙여넣기)

> eywa(예: `C:\Creative\eywa`, **main 브랜치**)에서 이어간다. 직전 세션에서 **로그인 후 전 화면(12+1메뉴·상세·관리자·super-admin)을
> 브라우저로 전수 점검 → 멀티에이전트로 코드 적대검증 → 발견 버그 다수 수정**했고, **워크스페이스 창 내비게이션(Idea A)**·**카드 전체 클릭**·
> **창 닫을 때 배경 즉시 새로고침**까지 구현·검증·커밋(main, 4커밋)했다. 전 게이트 그린(typecheck·lint·test 149·build).
> ⚠️ **데모 데이터 주의**: `ijw-demo` 테넌트는 깨끗한 `scripts/seed.ts`가 **아니라** ijw-calander 레거시를 적재한
> POC 임포트본(학생 ~564명, 실제 회의녹취·상담 포함)이다. 그래서 보이는 쓰레기 레코드("관리자"·"테스트"·"인재원학원")·
> 동명이인 접미사(박서연A~E)·담임 공란·성적 0건·6월 출석 공백은 **코드 버그가 아니라 임포트 데이터 결함**.
> **최종 목표는 ijw Firebase 전체 데이터의 성공적 이식**(서비스계정 `F:\ijw-calander\serviceAccount.json`, 명명 Firestore DB
> `restore260202`). 단 재구성 export 파이프라인이 소멸해 재구축이 필요(=별도 프로젝트). **지금은 그 전에 코드/앱 퀄리티 우선.**
> 시작 전 `HANDOFF.md` + `CLAUDE.md`("막혔던 점들 **#44~56**", "AI 모델 정책")를 읽어라. `.env.local` 필요(§2). `pnpm dev`는 포트 3100.

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
- 본 세션 커밋(위=최신):
  ```
  docs: 핸드오프·CLAUDE 최신화 — QA·창 내비게이션·쿼리 견고화          ← 본 세션
  fix: 표시·로직·권한 정합성 (회의참석자·과목라벨·수납·AI생성일·결석리포트·리다이렉트)
  fix(db): 대량 .in()/전건 fetch 안전화 — HTTP 414·1000행 절단·error 삼킴 해소 (batch 헬퍼)
  feat(workspace): 창 크롬이 내비게이션 소유 — 동적 제목·뒤로(←)·닫기 시 배경 새로고침
  feat(workspace): 카드 전체 클릭 → 상세/수정 이동
  cb08003 docs(db): 마이그레이션 README                                ← 이전 세션 베이스
  ```
- 📌 **직전 다른 세션(랜딩)**: `/`을 제품 중심으로 전면 재설계 — 제품 쇼케이스 Hero·기능 인앱 목업(시간표/출석부/수납)·
  **워크스페이스 멀티윈도우 자동재생**·카피 탈감성화·목업 이름 마스킹(강OO). 커밋 `afee3ab`·`44031d2`·`95d8d4b`. 상세는 **CLAUDE.md "제품 중심 랜딩"**.
- ⚠️ **여러 세션이 병렬로 작업하는 repo** — push 전 `git fetch` + `git pull --rebase`, **force push 금지**. CLAUDE.md "Git 협업 규칙".

---

## 2. 환경변수 (`.env.local`, 값 미포함 — 대시보드/기존 머신에서)

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (admin/seed/super-admin) |
| `DATABASE_URL` | Postgres **Session pooler** URL (5432, `aws-1-…pooler`. CLAUDE.md #8) |
| `AI_PROVIDER` | `upstage`(기본·Solar Pro 3) 또는 `anthropic`. 미설정 시 upstage. (CLAUDE.md "AI 모델 정책") |
| `UPSTAGE_API_KEY` / `UPSTAGE_API_KEY_CONSULTATIONS` | Upstage Solar (등록상담·회의록 / 학생 케어). 없으면 Anthropic 폴백 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_CONSULTATIONS` | Anthropic (폴백·reasoning) |
| `ASSEMBLYAI_API_KEY` / `ASSEMBLYAI_WEBHOOK_SECRET` | 회의록 음성 STT |
| `GEMINI_API_KEY` | (등록만, 미사용) |
| `GOOGLE_SERVICE_ACCOUNT_KEY` · `NEXT_PUBLIC_APP_URL`/`VERCEL_URL` | Sheets·웹훅(선택) |

명령: `pnpm dev`(3100) · `pnpm typecheck` · `pnpm lint` · `pnpm test`(**149통과**) · `pnpm build` · `pnpm db:seed`.
> ⚠️ `pnpm build`는 dev 서버를 끄고 돌릴 것(.next 충돌, CLAUDE.md #36). `pnpm install`이 esbuild/msw build script를
> ignore한다는 경고는 dev엔 무해(필요 시 `pnpm approve-builds`).

---

## 3. 한 것 (본 세션 — 전부 main)

**A. 로그인 후 전수 QA + 멀티에이전트 적대검증.** 12+1메뉴·상세 7탭·관리자·super-admin 접근통제를 브라우저로 훑어
증상을 모으고, Workflow(서브에이전트)로 **코드를 직접 읽어 코드버그/시드데이터/정상으로 판별**. 14+12개 증상을 파일:줄로 검증.

**B. 코드 버그 수정 (커밋 2~4).**
1. **이탈관리 CRITICAL 414** — `retention/server/queries.ts`가 재원생 전원 id를 5개 `.in()`에 → 원장이 이탈관리 열 때마다
   HTTP 414로 출결/성적/상담/수납/수강이 통째로 비어 위험점수가 거짓이던 것. → 100개 청크 분할 + error throw.
2. **공용 배치 헬퍼** `src/lib/supabase/batch.ts` — `fetchInChunks`(.in 청크), `fetchAllPaged`(.range 페이지네이션).
   admin 고아탐지·super-admin 카운트/청구·students export·withdrawals·recompute 전반에 적용(414·1000행 절단·error 삼킴 일괄 해소).
3. **고아탐지/중복** — `findOrphans`가 전 재원생 524명을 "수강 없음" 오탐하던 것 수정. `findDuplicateStudents`는 학교칸만
   달라도 동명+학년+동일연락처면 잡도록 전화번호 union-find 추가.
4. **표시/로직** — 회의 참석자 `[object Object]`→정규화 · 과목 칩 `HIGHMATH`→"수학(심화)" · 수납 "미수금" 건수 분해 ·
   퇴원 편집폼 enrollment 종료(F8)·전화 정규화(F5) · AI 재분석 `generated_at` 갱신 · 내학습 결석 리포트 모순 해소 ·
   권한없음 리다이렉트(대시보드 가능시 dashboard, 아니면 랜딩 — student 루프 방지) · super-admin 상태라벨.

**C. 워크스페이스 창 내비게이션(Idea A) + 카드 UX (커밋 1~2).**
5. **카드 전체 클릭** — 직원·학생상담 카드를 카드 어디나 클릭하면 상세/수정 열림(수정 버튼·힌트 제거).
6. **창 크롬이 내비 소유** — 타이틀바가 iframe 문서 제목을 라이브 동기화(드릴인 시 "직원관리"→"강사 정산"),
   **뒤로(←)는 드릴인했을 때만**(루트=닫기는 X 전담), 인페이지 "← …로" 백은 임베드에서 숨김(`EmbedProvider`+`<BackLink>` 23p).
7. **닫을 때 배경 새로고침** — 창(별도 iframe 문서)에서 한 저장/삭제가 배경 목록에 즉시 반영(`closeAndRefresh`=router.refresh).
8. **워크스페이스 버그** — 드래그 `onPointerCancel` 미처리 stuck 해소 · `setBackground` 창+배경탭 중복 가드.

**D. 환경.** `openai` 패키지 설치 + `UPSTAGE_API_KEY` 적용 → AI 기본 provider = Upstage Solar(없으면 Anthropic 폴백).

---

## 4. 창 내비게이션 모델 (Idea A — 동작 규칙)

라우트 창(메뉴·상세를 크롬리스 iframe으로 띄움)의 "뒤로/닫기"는 다음으로 통일됨:

| 상태 | 타이틀바 ← | 닫기 |
|---|---|---|
| **루트(첫 화면)** — 카드에서 직접 연 상세, 또는 메뉴 루트 | **없음**(드릴 안 함) | 우상단 X → 닫으면 배경 즉시 새로고침 |
| **드릴인** — 예: 김수진수정 → 급여정산 | **있음** → iframe `history.back()` (창 안 한 단계 뒤로) | 루트 도달 후 X |

- 제목은 iframe 현재 페이지 따라 라이브 변경(루트에선 연 시점 제목 유지).
- 인페이지 "← …로" 헤더는 **배경 풀페이지에서만** 보이고 창(임베드)에선 안 보인다(크롬이 대체).
- 구현: `floating-window.tsx`(← 버튼·closeAndRefresh·onPointerCancel), `route-window.tsx`(iframe 제목/경로 관찰·`iframeRegistry`),
  `window-store.ts`(`live`/`setLive`·setBackground 가드), `embed-context.tsx`+`back-link.tsx`(임베드 인지 백).

---

## 5. ✅ 검증 (Chrome, localhost:3100, 콘솔 0 에러)

- [x] 카드 클릭 → 상세/수정 창 (직원·학생상담) / 카드 "수정 →" 힌트 제거
- [x] 드릴인 시 타이틀바 "← 강사 정산"(제목 동기화 + ←), ← 클릭 시 복귀 / 루트 창은 ← 없음(X만)
- [x] **창에서 원일→김수진 저장 후 닫는 즉시 배경 카드 김수진 반영**(router.refresh)
- [x] retention 414 해소 → 위험점수 실데이터로 다양화(관심 0→4, "상담 공백 N일" 등)
- [x] 고아탐지 524→86(실제 고아) · 중복 1→4그룹(조아루 포착) · 회의참석자 실명 · 과목 "수학(심화)" · 수납 "부분 N·미수 M건"
- 코드 게이트: typecheck 0 · lint 0 errors(경고 12=기존) · test 149/149 · build 40/40

> 주의: QA·검증으로 데모 학생/직원 상태가 일부 바뀌었을 수 있음. 페르소나(원장 display_name = **김수진**)는 복원해 둠.

---

## 6. 다음 작업

- ▶ **데이터(최종): ijw Firebase 전체 이식** — `serviceAccount.json`으로 Firestore(`restore260202`) → eywa 재구성 export
  파이프라인 신규 구축(사라진 `_poc_migration`용 `ijw-export-*.json` 생성기 복원) → demo 적재. 임포트 시 쓰레기/접미사
  필터 + 성적/담임/현재월 출석까지 채우면 F9/F12/F13/F14(시드 공백류)도 함께 해소. **착수 전 퀄리티 우선이 현 방침.**
- ▶ **성능 최적화** — production 반응속도(Vercel cold start, pooler latency, 대시보드 N쿼리). CLAUDE.md "남은 작업".
- (잔여 감사 권장) super-admin 카운트는 장기적으로 RPC group-by로 더 견고화 가능(현재는 페이지네이션으로 1000행 한도 회피).

---

## 7. 코드 지도 (이번 세션 추가/변경)

- **배치 헬퍼**: `src/lib/supabase/batch.ts` — `fetchInChunks`·`fetchAllPaged`(대량 조회 안전 패턴, error throw).
- **임베드 인지 백**: `src/components/back-link.tsx` + `src/components/workspace/embed-context.tsx`(`EmbedProvider`/`useEmbed`).
  shell layout의 embed 분기가 `<EmbedProvider embed>`로 감싼다.
- **워크스페이스**: `floating-window.tsx`(← 버튼·closeAndRefresh·onPointerCancel), `route-window.tsx`(`iframeRegistry`+제목/경로 관찰),
  `window-store.ts`(`live`/`setLive`·setBackground 가드).
- **쿼리 견고화**: `features/{retention,super-admin,students,withdrawals,admin}/server/queries.ts`, `students/server/actions.ts`.
- **AI provider**: `src/lib/ai/{models,generate,upstage,anthropic}.ts`(Upstage Solar 기본, Anthropic 폴백 — CLAUDE.md "AI 모델 정책").
- ⚠️ 함정·결정은 CLAUDE.md "막혔던 점들 **#44~56**".
