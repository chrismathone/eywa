# eywa 이어가기 핸드오프 — 2026-06-19 (반응형 폭 + 다면창 FaceTabs 통일 + 역할/권한 Phase 4)

다른 컴퓨터/세션에서 **이 시점부터 바로** 이어가기 위한 문서. 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md),
이 문서는 **현재 상태 + 셋업 + 다음 할 일 + 병렬 세션 경계**만 담는다.

> ⚠️ **지금 여러 세션이 병렬로 작업 중**(공유 작업트리). push 전 `git fetch` + `git pull --rebase`,
> **force push 금지**, 커밋은 **명시 경로**로(`git add -A`는 작업트리가 전부 자기 것일 때만). 같은 파일 동시
> 편집은 Edit 도구의 stale-guard가 막아주지만, **`git commit`이 남의 미커밋 작업을 쓸어담는 사고**가 있었으니
> 커밋 직전 `git diff HEAD -- <파일>`로 내 변경만 들었는지 확인. (CLAUDE.md "Git 협업 규칙")

---

## 🚀 새 세션 시작 프롬프트 (복사-붙여넣기)

> eywa(**main 브랜치**)에서 이어간다. 최근 세션들이 **(1) 반응형 창 폭 정비**(넓은창 공간활용+좁은창 접힘 규약),
> **(2) 다면 창 UI를 공용 `FaceTabs`(상단 가로 탭바 + URL `?tab=`)로 통일**(수납관리·학생상세·학원설정 — 옛 우측
> 종이 책갈피/내부탭 제거), **(3) 학원 설정 배선 Phase 1~3**(brandColor 테마·인쇄 연락처·알림톡/시트 폴백·사업자번호·
> 로고/직인 URL), **(4) 역할/권한 테넌트별 편집(Phase 4)**까지 구현·검증·push(main)했다. 전 게이트 그린
> (typecheck·lint 0err·test 367·build). ⚠️ **데모는 `scripts/seed.ts`가 아니라 ijw POC 임포트본**(학생 ~564) →
> **`pnpm db:seed` 절대 금지**(전체 wipe). 시작 전 `HANDOFF.md` + `CLAUDE.md`("디자인 시스템", "막혔던 점들",
> "AI 모델 정책", "Git 협업 규칙")를 읽어라. `.env.local` 필요(§2). `pnpm dev`는 포트 3100.

---

## 0. TL;DR — 새 컴에서 시작

```bash
git clone https://github.com/BIGSHOL/eywa.git   # 또는: git switch main && git pull --rebase
# .env.local 준비(§2 — 값은 Supabase/Vercel 대시보드 또는 기존 머신에서 복사)
pnpm install        # openai 등 의존성 포함(누락 시 AI 경로 Module not found)
pnpm dev            # http://localhost:3100 (포트 3100 고정)
# 로그인: chrismathone@gmail.com(원장 투어). 전체 계정 = CLAUDE.md "데모 로그인 계정"
```
⚠️ **작업 위치는 NVMe 디스크. USB/외장(F: 등) 금지** — Turbopack 패닉·파일 손상(검증됨).

---

## 1. 저장소 / 브랜치 상태 (main 최신, 2026-06-19)

최근 커밋(위=최신):
```
65787f1 feat(owner): 역할/권한 테넌트별 편집 (Phase 4) — jsonb sparse override + 전 소비처 배선
b7c4486 feat(owner): 학원 설정 Phase 3 — 사업자등록번호 + 로고/직인 이미지(URL) 인쇄물 배선
72bb388 refactor(ux): 다면 창을 공용 FaceTabs로 통일 + 학원 설정 소비처 없는 필드 숨김
9cd836b feat(owner): 학원 설정 배선 — 브랜드색 테마 + 인쇄 연락처/연체정책 + 알림톡·시트 폴백
2bbc255 feat(ux): 반응형 창 폭 정비 — 넓은창 공간활용 + 좁은창 접힘 규약
62ecc43 feat(ux): 이름앞 아바타 제거 · 성적관리 리네임 · 생성폼 창화 · 드롭다운 규약
```

### 🔭 병렬 세션 경계 (충돌 회피)
- **이 세션(권한)**: Phase 4 역할/권한 = `permissions.ts`, `lib/auth/{perm-matrix,require-access,api-access}.ts`,
  owner `permissions-section.tsx` + `page.tsx` 권한면, feature 게이트들, `settings-types`/`defaults`의 **permissions 섹션만**.
- **다른 세션(Phase 3 DB 확장)**: **과목별 교시 세트**(`operations.weekdayPeriods` → `Record<subject,PeriodTime[]>`) 진행 중 →
  `settings-types`의 **operations 섹션**, `defaults.operations`, `periods.ts`, `timetable/*`, `operations-section.tsx`, (필요시) `schema.ts`/새 alpha.
- 두 작업은 **다른 섹션 키**(permissions ↔ operations)라 additive — 같은 줄 안 건드리면 안전. owner `settings-types`/`defaults`/`page.tsx`를
  만질 땐 **블록 끝에 append**하고 operations 줄 미접촉.

---

## 2. 환경변수 (`.env.local`, 값 미포함)

| 변수 | 용도 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 클라이언트 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (admin/seed/super-admin/키오스크) |
| `DATABASE_URL` | Postgres **Session pooler**(5432, `aws-1-…pooler`. CLAUDE.md #8). 데모 보정 스크립트도 사용 |
| `AI_PROVIDER` | `upstage`(기본·Solar Pro 3) 또는 `anthropic`. 미설정 시 upstage |
| `UPSTAGE_API_KEY` / `UPSTAGE_API_KEY_CONSULTATIONS` | Upstage Solar. 없으면 Anthropic 폴백 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_CONSULTATIONS` | Anthropic (폴백·reasoning) |
| `ASSEMBLYAI_API_KEY` / `ASSEMBLYAI_WEBHOOK_SECRET` | 회의록 음성 STT |

명령: `pnpm dev`(3100) · `pnpm typecheck` · `pnpm lint` · `pnpm test`(**367통과**) · `pnpm build` · `pnpm db:seed`(⚠️데모엔 금지).
> ⚠️ `pnpm build`는 dev 서버를 끄고 돌릴 것(.next 충돌, CLAUDE.md #36). 파일 다수 삭제 후 dev가 Turbopack 모듈그래프
> 꼬임으로 죽을 수 있음 → 재시작(#23).

---

## 3. 한 것 (최근 세션들 — 전부 main)

**A. 반응형 창 폭 정비(`2bbc255`).** 창=iframe이라 Tailwind 브레이크포인트가 창 폭에 반응. 고정 좁은 `mx-auto max-w-4xl`
중앙정렬(최대화 시 좌우 여백 폭발)을 정비 — owner는 후속 FaceTabs로 대체, 단일입력 폼(meetings/new·sheets)은 좁히고,
kiosk-settings·admin/cleanup은 다열 카드, 표는 `DragScrollArea`. 규약=CLAUDE.md "반응형 창 폭" 섹션.

**B. 다면 창 = 상단 가로 탭바(공용 `FaceTabs`)로 통일(`72bb388`).** 한 창에서 여러 "면"을 바꾸는 UI가 3가지(수납=우측
종이책갈피 / 학생상세=상단탭 / 학원설정=좌측 내부탭)로 갈렸던 걸 **하나로 통일**:
- 신설 [`src/components/face-tabs.tsx`](src/components/face-tabs.tsx) — 상단 가로 탭바, **URL `?tab=`**(면마다 서버렌더·지연
  로딩·창 타이틀 동기·뒤로가기), `useEmbed`로 창 안에선 자동 `withEmbed`(embed 유지), 넘치면 가로 스크롤, `group` 구분선 지원.
- billing/owner/students-[id] 전부 FaceTabs로 이전. **삭제**: `billing-tabs.tsx`·`billing-tab-sync.tsx`·`window-bookmarks.tsx`·
  `owner-console.tsx`(+ floating-window의 billing 전용 책갈피 분기). **학생상세 잠복버그 해결**(옛 학생 탭은 embed 미유지로
  창 안 풀셸 떴음 → FaceTabs가 자동 해결).

**C. 학원 설정 배선 Phase 1~3(`9cd836b`·`b7c4486`, 다른 세션 주도).** brandColor→CSS변수 주입(`color-utils`), 프로필
연락처·연체정책→인쇄물, 알림톡/시트 폴백, 사업자등록번호·로고/직인 URL→인쇄물. 소비처 없는 필드(terms·taxMode·약관 등)는 입력 숨김.

**D. 역할/권한 테넌트별 편집 Phase 4(`65787f1`, 이 세션).** [[project_phase4-role-permissions]]
- `permissions.ts` 하드코딩 `MENU_ACCESS`를 **owner 콘솔 "역할·권한" 면**(메뉴×역할 그리드, 셀 클릭 순환)에서 학원별로 편집.
- 저장 = `tenant_settings.data.permissions = { overrides: Array<{menu,role,access}> }` **sparse**(새 테이블 0). **배열 모델**이
  핵심(resolve.ts deepMerge가 base 키만 순회 → 객체 record는 빈 기본값 아래 새 키 탈락; 배열은 통째 교체로 보존).
- 배선: `canAccess(role,menu,matrix?)` optional 인자 + `resolveMatrix` 순수함수. 서버 `getPermMatrix`(cache, 추가쿼리0,
  [`lib/auth/perm-matrix.ts`](src/lib/auth/perm-matrix.ts)) → require-access·api-access + 7개 feature 게이트
  (canAccessTenant/accessLevelTenant); layout이 사이드바·팰릿·모바일내비에 `permMatrix` prop 주입.
- 가드레일: master 자기잠금(owner/admin/대시보드) 불가, 원스크린·내 학습 역할 전용 고정(저장거부+적용무시 이중방어).

---

## 4. 핵심 패턴 (이어갈 때 따를 것)

- **다면 창 = `FaceTabs`(상단 가로탭 + URL `?tab=`)**. 새 다면 화면은 우측 책갈피/내부탭 만들지 말고 FaceTabs 재사용.
  면마다 서버렌더(무거운 면만 지연 로딩) + `generateMetadata`로 창 타이틀 면별 갱신. embed 유지는 FaceTabs가 자동.
- **반응형 폭**: pageType별 처방 = CLAUDE.md "반응형 창 폭". 고정 좁은 중앙정렬 금지, 넓은창=열 확장·좁은창=단일컬럼.
- **학원 설정 = 단일 진입점**: 저장 `saveOwnerSection`(섹션 Zod + 머지 upsert), 조회 `getTenantSettings`(cache)→`resolveSettings`
  (DEFAULT_SETTINGS deep-merge). 새 필드 = 5단계(스키마→기본값→폼→**소비처**→검증). 소비처 없는 필드는 UI 노출 금지.
- **권한**: 게이트는 `canAccess(role,menu,matrix)`로 — 서버는 `user`+`getPermMatrix()`, 클라는 `permMatrix` prop. 새 메뉴
  추가 시 `MENU_KEYS`/`MENU_ACCESS`에만 넣으면 자동(override는 sparse라 새 메뉴는 하드코딩 default 적용).

---

## 5. 다음 작업

- ▶ **관리자 도구(/admin) → owner 콘솔 병합** (이번 대화 원래 목표, **보류 중**). 이제 FaceTabs 위에 "데이터 관리·감사로그"
  면을 얹으면 됨(사용자 결정 = 상단 가로탭 + 설정/관리 구분선). 감사로그·cleanup·duplicates 콘텐츠를 컴포넌트로 추출 →
  owner `?tab=audit`/`?tab=data`로 면 렌더 + navigation.ts에서 /admin 사이드바 제거. 무거운 면이라 지연 fetch 유지.
- ▶ **Phase 4 보안 후속(권장)**: `tenant_settings` RLS가 `tenant_isolation` 한 줄뿐이라 같은 테넌트 인증자가 PostgREST로
  `data.permissions` 직접 UPDATE = 자기 권한상승 여지(앱 경로는 master 게이트라 안전, **직접 API만** 노출). 데이터 격리는
  안 깨짐. 후속 alpha(0034a류) 트리거로 "`auth.uid()` not null이면서 data.permissions 변경 시 raise" 차단(0026a 패턴).
- ▶ **Phase 3 마저**(다른 세션): 과목별 교시 세트(operations.weekdayPeriods → Record<subject,PeriodTime[]>) DB확장.
- ▷ **CLAUDE.md 문서화 보류분**: Phase 4 권한 패턴 + 위 자기상승 후속을 "학원 설정"/"디자인 시스템"에 추가(동시 편집 충돌 회피로 미반영).
- ▶ **성능**(Vercel cold start·pooler latency·대시보드 streaming) / **데이터 최종: ijw Firebase 전체 이식**(별도 프로젝트).

---

## 6. 검증 게이트 (2026-06-19 기준 그린)

typecheck **0** · lint **0 err**(경고 9=기존 미사용 `_prev`/`_formData` 등) · test **367** · build **✓**.
Phase 4 라우트 컴파일 확인(`/owner?tab=permissions` 등 307). ⚠️ 브라우저 실거동(권한 토글→사이드바 반영, FaceTabs 면 전환)은
Chrome/Whale로 재확인 권장(이 세션은 로직·게이트 레벨까지). [[reference_browser-verification-env]]

---

## 7. 코드 지도 (최근 변경)

- **다면 탭**: [`src/components/face-tabs.tsx`](src/components/face-tabs.tsx) + `(shell)/billing/page.tsx`,
  `students/[id]/_components/tabs-nav.tsx`, `owner/page.tsx`. (삭제: billing-tabs·billing-tab-sync·window-bookmarks·owner-console.)
- **권한(Phase 4)**: `src/lib/permissions.ts`(MENU_KEYS/SYSTEM_ROLES 튜플·resolveMatrix·optional matrix),
  `src/lib/auth/perm-matrix.ts`(getPermMatrix/canAccessTenant/accessLevelTenant), `require-access.ts`·`api-access.ts`,
  `owner/_components/permissions-section.tsx`, `features/owner/{settings-types,defaults,server/actions}.ts`(permissions 섹션),
  feature 게이트(exams·billing-catalog·consultations·enrollment·meetings·attendance/kiosk·search), `layout.tsx`+사이드바·팰릿·모바일내비(permMatrix prop).
- **학원 설정 배선**: `lib/color-utils.ts`, `(shell)/layout.tsx`(brandStyle), `(print)/enrollment/[id]/print`, `messaging/provider.ts`, `integrations/server/*`, owner `*-section.tsx`.
- ⚠️ 함정·결정은 CLAUDE.md "막혔던 점들" + "디자인 시스템" + "학원 설정(/owner)".
