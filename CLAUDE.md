@AGENTS.md

# eywa 프로젝트 가이드

이 프로젝트는 [D:\ijw-calander](D:\ijw-calander)(인재원 학원관리 SaaS)의 경량 재작성판입니다. 자세한 설계 결정은 [`C:\Users\user\.claude\plans\curried-popping-finch.md`](C:\Users\user\.claude\plans\curried-popping-finch.md)에 있습니다.

---

## 메뉴 12개

대시보드 / 시간표 · 출석부 · 수업목록 / 학생목록 · 등록상담 · 학생상담 · 퇴원관리 / 직원관리 · 수납관리 · 회의록 / 도움말

기존 ijw-calander의 43개 탭 중 마케팅, 셔틀관리, 자료실, 역할관리, 매출분석, 지출관리, 시간표배포, 알림센터, 학부모포털 등은 의도적으로 제외했습니다.

---

## 작업 원칙

- **반응속도(UI/UX)가 1순위**. 학원장/강사는 매일 수십 번 이 화면을 본다. 느리면 끝. 무거운 작업(특히 AI 호출, 큰 쿼리)은 가시적 progressive 렌더링 또는 백그라운드로 빼고, 보이는 데이터는 가능한 한 캐시·streaming·partial 렌더링으로 즉시 보여줄 것.
- **한 파일 200줄, 한 컴포넌트 props 10개 이하** — 기존 코드는 3,113줄 단일 컴포넌트, props 80개로 무너졌습니다.
- **Server Component 우선**. 클라이언트 컴포넌트는 상호작용이 필요할 때만.
- **모든 DB 테이블에 `tenant_id` + RLS**. 멀티테넌트 누수는 한 정책 빠지면 전사 노출 — pgTAP 테스트로 강제.
- **출석/급여/수강료 등 계산 함수**는 순수 함수로 분리해서 Vitest 단위테스트 강제(coverage 게이트 70%+).
- **AI 호출은 캐싱 + 명시적 트리거**: 재분석은 명시 버튼이 있을 때만. 페이지 로드만으로 절대 새 호출 안 함. 마지막 결과는 DB에 보존되며, "갱신" 버튼을 다시 누르기 전까지 그대로 표시.
- **UI에 model 이름 노출 금지**. "claude-opus-4-7-2026-05-27" 같은 문자열은 학원장 입장에서 노이즈. 생성 시점만 표시.

## AI 모델 정책

**모든 AI(JSON) 호출은 단일 진입점 `src/lib/ai/generate.ts`의 `generateJSON()`을 거친다.**
직접 `getAnthropic`/`getUpstage`를 부르지 말 것 — provider 라우팅·파싱·폴백이 한 곳에 모여 있다.

provider/모델 레지스트리는 `src/lib/ai/models.ts`의 `AI_MODELS`(티어×provider) + `resolveModel()`:

| Tier | Upstage (기본) | Anthropic (폴백/롤백) | 용도 |
|---|---|---|---|
| `fast` | `solar-pro3` | `claude-haiku-4-5` | 짧은 분류, 태깅, 간단 요약 (현재 미사용) |
| `balanced` | **`solar-pro3`** | `claude-sonnet-4-6` | **현재 모든 AI 호출의 기본값**. 회의록·학생 케어·등록상담. |
| `reasoning` | — (없음) | `claude-opus-4-7` | **금지** (명시 요청 시만). reasoning은 Anthropic 고정. |

- **기본 provider = `AI_PROVIDER` env (미설정 시 `upstage` = Solar Pro 3).** 한국어 강점 + Sonnet 대비
  ~20–25배 저렴($0.15/$0.60 per 1M, 128K). `AI_PROVIDER=anthropic` 한 줄로 즉시 Claude 롤백.
- Upstage는 OpenAI 호환 → `openai` SDK + baseURL `https://api.upstage.ai/v1`. JSON mode
  (`response_format: json_object`) 사용 — 프롬프트에 "JSON" 단어 필수(현 프롬프트 충족).
- **자동 폴백**: 기본 provider 키가 없으면 다른 provider(키 있는 쪽)로 1회 폴백 → 둘 다 없으면
  호출부의 기존 stub/error로 떨어짐(무중단). `model_version`엔 실제 사용 모델 id 저장(UI 미노출).
- 대안: **Gemini 2.5 Flash**(`GEMINI_API_KEY` 등록됨) — fast-tier 후보, 코드 통합 미구현.

키 분리 (사용량 추적):
- `UPSTAGE_API_KEY` / `ANTHROPIC_API_KEY` → 등록상담(/enrollment) + 회의록(/meetings)
- `UPSTAGE_API_KEY_CONSULTATIONS` / `ANTHROPIC_API_KEY_CONSULTATIONS` → 학생 케어 인사이트(/students/[id])
  (Upstage는 consultations 전용 키 없으면 `UPSTAGE_API_KEY`로 폴백)
- `GEMINI_API_KEY` → 향후 fast-tier 작업용 (현재 미사용)

---

## 데이터 모델 핵심 결정

- `enrollments`는 평면 테이블 + GiST EXCLUDE 제약 → 좀비 enrollment 클래스 자체가 사라짐
- 학생 자연키는 `(tenant_id, name_normalized, school, grade) WHERE status<>'withdrawn'` 부분 유니크 인덱스
- AI 분석 결과는 `print_payload jsonb` 스냅샷으로 동결 — 모델 변경에도 인쇄물 불변

---

## 학원 설정(`/owner`) — 설정은 "소비처까지" 배선해야 끝 (⚠️ write-only-orphan 금지)

**모든 학원(테넌트) 단위 설정은 단일 읽기/쓰기 경로를 거친다** — AI의 `generateJSON()`과 같은 단일 진입점
원칙. 기능 코드에서 `tenant_settings`를 직접 SELECT/UPDATE하지 말 것.

- **저장(쓰기)**: `saveOwnerSection`([`src/features/owner/server/actions.ts`](src/features/owner/server/actions.ts)) —
  master 게이트 → `SECTION_SCHEMAS`([`settings-types.ts`](src/features/owner/settings-types.ts)) Zod 검증 →
  `tenant_settings.data` jsonb에 **섹션 단위 머지 upsert**(다른 섹션 보존) → `audit_logs`(`owner_settings_update`)
  → `revalidatePath("/", "layout")` + `/owner`.
- **조회(읽기)**: `getTenantSettings()`([`src/features/owner/server/queries.ts`](src/features/owner/server/queries.ts),
  React `cache`) → `resolveSettings()`([`resolve.ts`](src/features/owner/resolve.ts))가 저장된 부분값을
  `DEFAULT_SETTINGS`([`defaults.ts`](src/features/owner/defaults.ts))에 deep-merge해 **항상 완전한 `TenantSettings`**
  반환(배열·원시는 교체, 객체는 재귀 병합). 비로그인/키오스크(service_role)는 `getTenantSettingsByTenantId(tenantId)`.
- **스키마 = 단일 소스**: `settings-types.ts`의 Zod에서 타입 추론. 섹션 4개(profile/operations/billing/notifications).

### ⚠️ 이 영역의 유일한 버그 패턴 = "저장은 되는데 아무도 안 읽음(write-only-orphan)"
쓰기·검증·머지·감사로그 인프라가 견고해 **저장 실패(broken-write)는 거의 안 난다.** 대신 스키마+폼에 필드만
추가하고 **소비처(consumer)를 안 만들어**, "저장됨 토스트는 뜨는데 화면/문서/메시지는 그대로"인 **거짓 약속**이
생긴다. 2026-06-19 전수 배선 감사: 편집 가능한 25개 필드 중 **11개만 정상 배선, 12개 orphan, 2개 미구현.**

**설정 필드 1개를 추가/변경할 때 5단계를 전부 끝내야 "완료"다:**
1. **스키마** — `settings-types.ts` 섹션 Zod에 필드 추가.
2. **기본값** — `defaults.ts`의 `DEFAULT_SETTINGS`에 같은 키 추가(없으면 deep-merge 폴백이 깨져 `undefined` 누출).
3. **폼** — 해당 `*-section.tsx`에 입력 추가(섹션 폼은 이미 `saveOwnerSection`에 배선됨).
4. **소비처(필수)** — 실제 기능 코드가 `getTenantSettings()`로 값을 읽어 **동작이 바뀌게** 한다.
   하드코딩 상수(`globals.css`의 `--primary`, `periods.ts`의 교시 enum 등)를 **설정값으로 대체**하는 게 핵심.
5. **검증** — 값을 바꿔 저장한 뒤 그 기능에서 실제로 반영되는지 확인. `grep "settings\.<section>\.<field>"`(또는
   해당 필드명)로 소비처가 **≥1곳** 나와야 한다. **안 나오면 그 필드는 UI에 노출하지 말 것**(거짓 약속 방지).

> **한 줄 규칙: 소비처(`getTenantSettings`로 읽어 동작이 바뀌는 코드)가 없는 설정은 만들지도, UI에 노출하지도 않는다.**

### 배선 현황 (2026-06-19 Phase 1·2 픽스 후 — "동작 예시" 인용 시 ✅만)
- **✅ 배선 완료**: profile `name`·`branchLabel`·`logoText`, operations `subjects`·`jobTitles`·`gradeLevels`·
  `weekdayPeriods`·`weekendPeriods`·`holidays`, billing `dueDay`, notifications `printHeader` (기존) +
  **Phase 1·2 신규**: profile `brandColor`(layout가 `--primary` 등 CSS 변수 주입, `src/lib/color-utils.ts`),
  profile `representativeName`·`phone`·`email`·`address` + billing `latePolicy`(등록 인쇄물 푸터/안내,
  `(print)/enrollment/[id]/print`), notifications `alimtalkSenderKey`(kakao `pf_id` 지연 폴백, `messaging/provider.ts`)·
  `googleSheetId`(시트 동기 폴백, `integrations/server/{actions,queries}.ts`).
  - ⚠️ 영어 교시는 여전히 `ENGLISH_PERIODS`(`periods.ts`) 하드코딩 → `weekdayPeriods` 설정과 무관(Phase 3 과목별 교시로 해소 예정).
- **🚫 입력 숨김(소비처 없어 v1 비노출 — 상태·스키마·저장은 보존, 소비처 생기면 입력만 복원)**: operations `terms`,
  billing `taxMode`·`defaultMethod`(invoices에 결제수단 컬럼 없음), notifications `kakaoChannelId`(발송 경로에 미사용·대응 컬럼 없음).
- **⚪ 아직 orphan(표시 화면 부재 — 후속)**: notifications `privacyTerms`·`serviceTerms`(약관 표시 페이지 필요).
  현재 콘솔에 입력은 떠 있으나 소비처 0 → 약관 페이지 구현 또는 숨김 결정 필요.

### DB가 필요한데 없는 것 (jsonb로 못 담는 것 포함)
`tenant_settings.data`는 텍스트/숫자/배열만 담는다 — **이미지·파일은 Supabase Storage 버킷이 별도 필요**:
- 로고 **이미지**(현재 `logoText` 텍스트 워드마크뿐)·직인/도장 이미지 → Storage 버킷 + `…profile.logoUrl`/`sealUrl` 경로.
- 사업자등록번호·운영시간(영업시간, 교시와 별개) → jsonb 필드 추가만으로 가능(스키마 확장).
- **과목별 교시 세트**(영어 1교시≠수학 1교시 시각 — 위 `ENGLISH_PERIODS` 하드코딩의 근본 원인) →
  `weekdayPeriods: PeriodTime[]` → `Record<subjectKey, PeriodTime[]>`로 확장 + 기존 데이터 마이그레이션.
- **역할/권한 편집**(현재 `permissions.ts` 코드 하드코딩 — ijw 패리티 갭) → `tenant_role_permissions` 테이블 또는
  `…data.permissions` jsonb + 편집 UI(RLS와의 경계 설계 필요).

---

## 기술 스택 (실제 적용된 것)

| 영역 | 선택 |
|---|---|
| 프레임워크 | **Next.js 16.2.6** (App Router, Turbopack) |
| 언어 | TypeScript (strict) |
| 스타일 | Tailwind v4 + shadcn/ui (**base-nova preset = base-ui 기반**, Radix 아님) |
| 폰트 | Pretendard Variable (정적 풀 한글 subset, dynamic-subset 아님) |
| 백엔드 | Supabase Postgres + Auth + RLS |
| ORM | Drizzle (`src/lib/db/schema.ts`, `drizzle-kit` for migrations) |
| Server data | Supabase JS server client (cookies adapter) → RLS 통과 |
| 클라이언트 데이터 | TanStack Query (현재 거의 미사용) + Server Components |
| 폼/검증 | react-hook-form + Zod (현재는 useActionState + 수동 검증 위주) |
| AI | `@anthropic-ai/sdk` — Claude Opus 4.7. 없으면 stub fallback |
| 테스트 | Vitest (happy-dom) + Playwright (smoke만) |
| 배포 | Vercel (`bigshols-projects/eywa`, alias `eywa-alpha.vercel.app`) |

### 폴더 컨벤션

```
src/
├─ app/
│  ├─ (auth)/login/             # 로그인 (passthrough layout)
│  ├─ (shell)/                  # 인증된 12개 메뉴 — 공용 사이드바/헤더
│  └─ (print)/enrollment/[id]/print/  # A4 인쇄 — 사이드바 없음
├─ features/<menu>/server/queries.ts  # 메뉴별 서버 쿼리 + actions
├─ components/                  # shadcn + 공용 컴포넌트
├─ lib/
│  ├─ db/schema.ts              # Drizzle 단일 소스
│  ├─ supabase/{server,client,proxy}.ts
│  ├─ auth/current-user.ts      # getCurrentUser() (auth.uid → public.users)
│  ├─ permissions.ts            # SystemRole × MenuKey × Access 매트릭스
│  ├─ navigation.ts             # NAV_GROUPS (사이드바 + 헤더 page title)
│  └─ ai/anthropic.ts
supabase/migrations/
├─ 0000_*.sql, 0001_*.sql, ...  # drizzle-kit generate 결과 (자동)
├─ 0001a_*.sql, 0002a_*.sql ... # 손수 작성한 RLS/제약/트리거 (drizzle 무관)
└─ meta/_journal.json           # drizzle 추적 — 손수 파일은 여기 없음
scripts/seed.ts                 # `pnpm db:seed` — 데모 시드 (idempotent)
```

---

## 진행 상황

**12개 메뉴 + ijw 패리티 + Admin 도구 + 제품 중심 랜딩 + UI 폴리시 + super-admin Phase 1
+ ijw 갭 P0·P1·P2 메우기 완성.**
디자인 시안 (Daylight: forest green + 라이트 톤) 전면 적용. (사이드바 메뉴는 retention·성적관리 추가로
실제 14개 — "12메뉴 정체성"은 초기 사이드바 기준 표현.)

### 역할/권한 override 배선 전수 감사 (2026-06-19) — ✅ 배선 완전, 보안 갭 2건
사용자 요청으로 owner "역할·권한"(Phase 4) override가 **실제 접근제어에 연결됐는지(write-only-orphan 아닌지)** 전수 검수
(다중 에이전트 + 직접 grep). **결론: 배선 완전 — 권한을 바꾸면 모든 소비처에서 동작이 실제로 바뀐다. orphan 0건.**
- **단일 진입점**: 하드코딩 `MENU_ACCESS`(기본) + `tenant_settings.data.permissions.overrides`(sparse) → `resolveMatrix()` →
  서버는 `getPermMatrix()`(React cache, [perm-matrix.ts](src/lib/auth/perm-matrix.ts)), 클라는 layout이 `resolveMatrix`로 prop 주입.
- **소비처 전수(전부 tenant-aware, 매트릭스 없는 bare `canAccess`/`accessLevel` 직접호출 = 0건)**:
  · 페이지 ~60개 = `requireAccess`(메뉴) · export/api 라우트 = `apiAccess`/`canAccessTenant`
  · 기능 액션(billing/exams/meetings/consultations/enrollment/kiosk/search) = `accessLevelTenant`/`canAccessTenant`
  · UI(사이드바·커맨드팰릿·모바일내비) = layout `permMatrix` prop → `canAccess(role,menu,permMatrix)`
  · (bare `canAccess`는 `super-admin.ts`(권한 직교)와 테스트뿐 — 정상)
- **쓰기·가드레일**: `saveOwnerSection` master 전용 게이트 + Zod `permissionsSchema.superRefine` ↔ 적용단 `isPermissionLocked`
  **이중 방어**(role-locked 메뉴·student 컬럼·master 자기잠금 금지). `resolveSettings` deep-merge가 sparse 배열 보존.
- **⚠️ 보안 갭 2건(후속 — 현재 데모 무방하나 기록)**:
  1. **자기상승(DB레벨 미가드)**: `tenant_settings` RLS가 `for all to authenticated using(tenant_id=auth_tenant_id())`라
     **테넌트 내 임의 인증 사용자가 직접 API로 UPDATE 가능** — permission 쓰기 제한이 **앱(master 게이트)에만** 있고 DB
     트리거 없음(0026a users-guard의 tenant_settings 판 부재). 비-master가 직접 API로 `owner:full` 등 자기부여 가능.
     **후속: tenant_settings 쓰기를 master로 제한하는 RLS 트리거/정책**(HANDOFF §5).
  2. **fail-open**: `getPermMatrix`가 `getTenantSettings` 실패 시 하드코딩 기본으로 폴백 → revoke override 일시 무효(로깅만,
     차단 안 함). 의도적 트레이드오프(fail-closed=락아웃 위험)지만 약점. 갭 #1 트리거와 함께 다룰 것.

> ⚠️ **권한/접근제어를 건드리는 새 코드는 반드시 `requireAccess`/`apiAccess`/`accessLevelTenant`/`canAccessTenant`(tenant-aware)로
> 게이트**할 것 — 매트릭스 인자 없는 `canAccess(role,menu)`/`accessLevel`은 override를 무시한다(위 orphan 0건을 깨지 말 것).
> 그리고 이런 중요한 배선은 **구현할 때마다 이 CLAUDE.md에 소비처·갭을 기록**한다(사용자 지침).

### 수강료 계산기 전면 재구현 — 신입생 상담 견적 도구 + 환불규정 + 공휴일 정밀화 (2026-06-19)
사용자 지적: 계산기의 "청구서로 저장"이 **재원생 + invoices 테이블**에 묶여 엉뚱했고(신입생 상담 견적 도구여야 함),
공휴일 이름이 전부 "공휴일"로 떴으며, 청구서에 환불규정이 없었다. ijw 계산기를 충실 재구현.
- **신입생 견적 도구로 재설계**: 학생 정보 **자유 입력**(이름/학교/학년/상담자/기간 — 재원생 선택 아님) + **다과목**
  (단가표에서 추가, 반/요일/시수/금액/비고 편집 + 공휴일 제외·월N회 고정 per-course) + 교재/기타 + 할인. 라이브
  **수강료 안내문**(우측, 인쇄용) — 월별 분할·소계, 최종 납부 금액. `tuition-calculator.tsx`(오케스트레이터) +
  `quote-editors.tsx`(행 편집) + `quote-document.tsx`(안내문) + 순수계산 `quote-calc.ts`(splitCoursesByMonth/quoteTotal,
  Vitest 10케이스).
- **별도 저장소 `tuition_quotes`**(`0037a` alpha, RLS — invoices와 완전 분리): 학생정보 + courses/extras/discounts jsonb
  스냅샷 + 총액. `server/tuition-quote-{queries,actions}.ts`(saveQuote/list/get/delete, billing-full). 계산기 서브탭에
  **저장된 청구서** 추가(`?csub=quotes`, `saved-quotes-{panel,list}.tsx`) — 목록/검색/삭제 + 클릭 시 `?qid=`로 계산기 재열람.
  ⚠️ 기존 `createInvoice`(재원생 청구)는 **수납 면 신규청구**에 그대로 — 계산기만 분리.
- **환불 규정 verbatim 이식**(`refund-policy.tsx`, ijw `TuitionInvoicePreview` 그대로): 학원 수칙 3항 + 환불 규정 표
  (제18조 제2항 1·2호/3호, 1개월 이내/초과 × 경과시점, rowspan/colspan) + 각주 2 + 소득공제 disclaimer. 안내문 하단 고정·인쇄 포함.
- **공휴일 정밀화**(`holidays-data.ts` → `{date,name}[]`): ijw KOREAN_HOLIDAYS 날짜에 **정확한 이름**(설날/추석/부처님오신날/
  대체공휴일/어린이날…) 부여(기존 8개만 이름 → 전부). 공휴일 면에 **연도 ◀▶ + 월 선택**(`?hy=&hm=`). 계산기는
  `koreanHolidayDatesForRange`로 차시 제외.
- 검증: typecheck0 / lint0(신규0) / test378 / build✓ + 브라우저 4서브탭 200(계산기=신입생도구·환불규정 포함, 견적목록, 공휴일 이름·연도이동).
- **후속(사용자 "학원 공휴일에 공휴일명도")**: 학원설정 `operations.holidays`를 `string[]` → **`{date,name}[]`**(`holidaySchema`)로.
  운영 폼에 `HolidayListEditor`(날짜+공휴일명 입력), 공휴일 면 "학원 지정 휴원일"이 이름과 함께 표시. **옛 string[] 저장데이터는
  `resolve.ts`의 `normalizeHolidays`가 `{date,name:""}`로 승격**(읽기 정규화 — DB 마이그 불요, 다음 저장 시 신형식). 계산기엔
  `holidays.map(h=>h.date)`로 날짜만 전달. ⚠️ `operations.holidays`를 읽는 새 코드는 객체 배열임에 유의.

### 수강료 계산기 "설정" 이식 — 단가표·할인·세션·공휴일 (2026-06-19)
ijw 수강료 계산기는 "설정"에 5탭(수강료 단가표 43과목·교재/기타·할인·공휴일·세션)이 붙어 있었는데, eywa는
회당 단가를 매번 손으로 치는 단순 폼뿐이었다(사용자 제보). ijw 5탭을 eywa 컨벤션으로 충실 이식.
- **신규 테이블 `tuition_catalog`**(`0034a` alpha, RLS 격리 — schema.ts + 교재 단가표 `textbook_catalog` 패턴 미러).
  ijw의 분리 컬렉션 3개(`tuition_courses`·`tuition_extras`·`tuition_discounts`)를 **한 테이블에 `category`로 통합**:
  과목 분류(수학/EIE/영어/국어) → 단가 picker, `기타` → 부가항목, `할인` → 할인 프리셋. 권한도 billing-full 일관.
  공유 상수·타입은 `features/billing/tuition-catalog.ts`(클라/서버 공용, ⚠️ server-only 금지), DB 쿼리는
  `server/tuition-catalog-queries.ts`(server-only), CRUD는 `server/tuition-catalog-actions.ts`.
- **계산기 면에 서브탭(FaceTabs)**: `계산기 · 수강료 단가 · 공휴일` (ijw "계산기 모드 ↔ 설정" 재현, `?csub=`/필터는
  `cat`/`cactive`/`cpage`로 네임스페이스해 상위 `?tab=`와 충돌 회피). `calculator-panel.tsx`가 서브탭 디스패치.
- **계산기 강화(소비처 배선)**: `tuition-calculator.tsx`에 **수강료 과목 picker**(선택→회당 단가 자동입력 + 청구서
  notes에 과목명) + **할인 프리셋 picker**(선택→할인액). 수기 입력도 그대로 가능(오버라이드).
- **공휴일 면**: 학원 휴원일은 테넌트 설정(master 전용)이라 계산기에선 **읽기전용 표시 + 학원설정(/owner?tab=operations)
  링크**, 양력 고정 공휴일은 그 해 목록을 이름과 함께 표시(계산기 "양력 공휴일 제외" 토글로 반영). 소비처는
  기존 `tuition-calc.ts`의 `mergeHolidays`/`countSessions`.
- **세션(드래그 다중기간 manager)는 의도적 미복제** — eywa는 `countSessions(시작~종료 + 요일 + 공휴일)`로 차시를
  이미 도출(ijw "default mode"와 동일 계산). ijw의 월별 드래그 다중 range는 데모 임팩트 대비 과중 → 보류.
- **데이터 이식**: ijw `constants/tuitionCourses.ts` 43과목 + `tuitionExtras.ts` 기타 4·할인 3 = 50행을
  `scripts/_poc_migration/import-tuition-catalog.cjs`(멱등, ijw-demo 테넌트)로 적재.
- **후속(같은 날, 사용자 요청 "ijw 공휴일·단가 그대로 + 교재단가표 두 곳에")**: ① **ijw 공휴일 전체 이식** —
  `features/billing/holidays-data.ts`에 ijw `KOREAN_HOLIDAYS`(2024–2030, 음력·대체·부처님오신날 포함) **그대로**
  포팅. 계산기 토글이 양력 고정 8개 대신 **그 해 전체 공휴일**을 제외(`koreanHolidaysForRange`), 공휴일 면도 전체
  목록(`holidayName`과 함께) 표시. (`tuition-calc.ts`의 `mergeHolidays`/`fixedHolidaysForYear`는 테스트만 유지·UI 미사용.)
  ② **교재 단가표를 "내부탭"으로 두 곳에 배치** — 최상위 `교재 단가표` 면 **제거** → 교재 면(내부탭 `목록`/`교재 단가표`,
  `tsub=`, `textbooks-face.tsx` 신설) + 계산기 서브탭에 `교재 단가표` 추가(공휴일 왼쪽: 계산기/수강료 단가/교재 단가표/공휴일).
  **같은 `CatalogPanel` 재사용**(`base` prop으로 위치별 필터/검색/페이지 링크를 해당 면 안에 보존). 검증 그린 + 4면 200.
- 검증: typecheck 0 / lint 0(기존 경고 9 외 신규 0) / test 368 / build ✓. **브라우저 실검증**: 3개 서브탭
  200 + 단가표에 임포트 데이터(Dr.Phonics·중등M·형제 할인·시스템 사용료)·계산기 picker 마크업 확인.
  ⚠️ 검증 중 만난 `/billing` 500은 **병렬 expenses 세션의 stale HMR**(setExpenseApproval)이지 이 작업 무관(#35).

### UX 정돈 — 이름앞 아바타 제거 · 성적관리 리네임 · 생성폼 창화 · 드롭다운 규약 (2026-06-19)
세션 단위 UX 정돈 묶음.
- **이름 앞 아바타(Initial) 전면 제거**: 12개 화면의 `<Initial>` 14곳 + `atoms/initial.tsx` 컴포넌트 삭제.
  사람 표시는 **이름 텍스트만**(영구 규칙 — "디자인 시스템 › Atoms" + `design_handoff_eywa` 문서 갱신). 죽은
  헬퍼(colorForGrade 등)·ROLE 맵 `init` 필드·빈 아바타 placeholder도 정리.
- **메뉴 리네임 시험관리 → 성적관리**(`/exams` 라우트·테이블 유지, 라벨만): navigation·메타·권한 주석·docs 갱신.
- **"새 X" 생성 폼 = 우측 Sheet 패널 → 플로팅 창**(반·직원·학생·등록상담·상담·회의록 6개). 기존 `/X/new` 라우트를
  `useOpenFormWindow`로 창 오픈 + `WindowParams.autoClose` → 제출 성공(=/X/new 경로 이탈) 시 RouteWindow가
  창 닫기+배경 새로고침(서버액션·폼 무수정). `ROUTE_WINDOW_SIZE`에 `X/new` 크기 등록. 자세히는 "디자인 시스템 ›
  생성 폼은 우측 패널이 아니라 창으로" 참고.
- **수업목록 강사 필터**: 과목 선택 시 해당 과목 담당(`users.subjects`) 강사만 노출 + 과목 전환 시 비해당 강사 초기화.
- **드롭다운/셀렉트 규약 문서화**: `SearchableSelect` 단일 통일(native `<select>` 신규 금지) + 옛 Base UI `<Select>` 권고 정리.
- 검증: typecheck 0 / lint 0. ⚠️ 브라우저 실검증은 auth-gate로 보류. student-quick-panel Sheet는 모바일 peek 폴백으로 잔존.

### 시간표 ijw 충실 이식 — 그룹밴드·평일/주말 분리·2D 병합·엑셀 격자 (2026-06-18)
"기능 자체를 완전히 이식해 자연스러운 이전 느낌"이 목표(디자인 복제 아님). ijw 수학 시간표 코드(`TimetableGrid.tsx`)+
스크린샷 대조로 기본뷰 전면 재구축.
- **교시 축 과목 인지**(`features/timetable/lib/periods.ts` `slotPeriodRow`/`subjectPeriodRows`) — 16시→1교시 휴리스틱
  제거. 수학 8교시→4그룹, 영어 10교시, 주말 8교시(시간단위). 매칭 실패는 '기타' 폴백. 데모 데이터가 ijw 교시 시각 보존.
- **요일그룹 밴드 + 평일/주말 분리**(`_components/weekday-group-tables.tsx`) — 월목/화금/수 그룹 컬럼 밴드(3단 헤더),
  주말은 1교시 시작시각이 달라(09:00) 우측에 자체 교시열로. 행높이 2:1(2주말교시=1평일그룹) 격자 정렬.
- **2D 병합**(`lib/grid.ts` `computeBlocks`) — 같은 반이 연속교시(rowSpan)·인접요일(colSpan)에 걸치면 한 칸 + 셀 내
  같은 반 합치기. **엑셀 격자**(table-fixed+colgroup 균일 폭, 빈 교시도 균일 높이, 넘치면 셀 내부 스크롤).
- 셀=학생 세로 명단(이름·학교·학년, 신입 빨강/전입 초록). 통합뷰도 실교시 축.
- ⚠️ **분리등원(월-only/목-only 학생)·합반**은 데모 데이터(attendance_days 전건 빔, merge_group 희소)가 없어 보류.
- **남은 기능 이식(학생/수업목록 빠른승리 · 죽은기능 배선 · import복원/강의실배정)은 [`docs/ijw-feature-port.md`](docs/ijw-feature-port.md)** 에 정리 — 다른 컴퓨터에서 이어가기.

### ijw 기능 갭 P2 — 운영 깊이 7건 + 카카오 알림톡 머지 (2026-06-18)
ijw-calander ↔ eywa 전수 갭검수(143건)에서 P0(막다른 길 9건)·P1(일상운영 9건)에 이어 **P2(운영 깊이 7건)
전부 완료**. 신규 테이블이 필요한 무거운 기능 — 데모를 '진짜 운영툴'로 보이게 하는 깊이. 계획서
[`C:\Users\user\.claude\plans\sunny-coalescing-diffie.md`]. 항목별 커밋·검증 그린(typecheck0/lint0/test332/build✓).
- **P2-1 시험(Exam) 모듈 = 신규 최상위 메뉴 `/exams`**: `exams` 테이블(`0028a` alpha) + `student_grades.exam_id`
  (부분유니크 `ux_grades_exam_student WHERE exam_id is not null`). 순수 `features/exams/calc.ts`(examStats/rankByScore).
  목록(통계 on-the-fly, denormalize 안 함) + 상세(반선택→**일괄 점수 그리드**, `batchSaveScores`=제출분 delete→insert 멱등).
  학생그룹 메뉴(teacher scoped·accountant none), 창 960×680.
- **P2-2 수강종료(과목 이탈) 추적**(마이그레이션 無): 재원이지만 특정 과목 enrollment 전부 종료된 학생.
  순수 `withdrawals/subject-ended.ts`(getEndedSubjects) + `withdrawals/page.tsx` 퇴원/수강종료 유형 토글.
- **P2-3 급여 월별 전직원표** `/staff/payroll`(master): 월 ◀▶ + 상태칩 + tfoot 합계. ⚠️ 미작성 직원은
  월기본만(전원 동시 calculateMonthlyPayroll 지양 — 반응속도 #1). ⚠️ 데모: 39명 중 급여설정 1명뿐 → 거의 0원.
- **P2-4 수강료 계산기** `/billing?tab=calculator`(책갈피 4면): 순수 `billing/tuition-calc.ts`(countSessions 공휴일제외)
  → 라이브 견적 → 청구서 저장(createInvoice 재사용) + 인쇄.
- **P2-5 교재 카탈로그(단가표)** `textbook_catalog`(`0030a`) + `/billing` 책갈피 5면 '단가표' CRUD + textbook-dialog
  '교재 검색' picker. **ijw `data/textbookCatalog.ts` 146종 이식**(`import-catalog.cjs`, 초/중/고 수학142+영어4).
- **P2-6 운영 감사로그** `audit_logs`(`0031a`, RLS 격리) + `/admin/audit` 뷰어(master). **8개 mutation 계측**
  (역할변경·직원삭제·청구서생성·시험생성/삭제/일괄성적·급여정산·퇴원사유).
- **P2-7 레벨테스트** `level_tests`(`0032a`) + 학생 상세 성적탭 섹션(배치/승급/진단·과목별 세부점수 jsonb).
- **카카오 알림톡 PR#1 머지**(`8e27419`) + **main CI 복구**(`43ff624` verify 잡 `NODE_OPTIONS=4096`로 tsc OOM 방지 /
  `150e490` typecheck 전 최소 `next-env.d.ts` 생성 — gitignore라 CI에 없음). 마이그 `0027d_kakao→0029a`(충돌 해소).
- ⚠️ **버그픽스 2건**: `18649ba` deleteStaff가 auth 404("User not found")에 멈추던 것 건너뛰고 public 삭제(#31).
  `8dd7d30` 인페이지 `BackLink`를 `useInFrame`으로도 숨김 — 탭 Link 드릴인이 `?embed=1` 떨궈 ← 이중 + /classes 오이동.
- ⚠️ **미구현/후속**: ① 데모 갭 — `audit_logs`·`level_tests` 비어있음(필요 시 시드), 급여설정 38명 무설정.
  ② **브라우저 실검증 보류**(이 세션 Chrome MCP 미연결 — 로직 레벨만). ③ **drizzle 스냅샷 reconciliation 별도 과제**
  (P2 신규 테이블은 전부 손수 alpha — `db:generate` 금지, #P0-6 드리프트). ④ **P3 미착수**(상담녹음AI / QR공개접수 /
  시간표시뮬 / 엑셀라운드트립 / 지출결재) + 급여 정책엔진(과정별 단가). ⑤ 시간표 P1 2건(인라인검색·강사색상)은
  병렬 timetable 세션 소관(이 세션 검토 시 미반영 상태였음 — 그 세션 병합 후 재확인).

### 데모 데이터 정합·온보딩·브랜드 + 수납관리 책갈피(교재/지출) (2026-06-17)
3제품 비교(makeedu·ijw·eywa) 후 데모 완성 백로그를 우선순위로 처리 + 수납관리 확장.
- **상담 데이터 버그**(데모 직격): import(`scripts/_poc_migration/run.ts`)가 소스 필드를 다중 오매핑
  (summary←notes·category←type·follow←followUpContent)해 1340 상담이 전부 "(내용 없음)"·category="parent"였음.
  run.ts 재매핑 수정 + 기존 행 `fix-consultations.cjs`로 1338행 패치(소스 students로 재조인).
- **데모 데이터 보강**: 담임 263명 실수강 데이터로 유도(`fix-primary-teacher.cjs`, 261은 반 teacher_id 공란), 성적
  3290행 **합성**(`fabricate-grades.cjs`, 전 enrolled — ⚠️가짜).
- **멀티윈도우 온보딩**: 첫 진입 코치마크(`workspace-onboarding.tsx`, prefs.onboarded) + 닫을 때 사이드바 펼침(발견성).
- **브랜드 로고**: 검은 동심원 → 포레스트그린 사각 + 흰 sprout(botanical) 마크(app-sidebar). (대시보드 차트는 병렬
  세션의 "운영 콕핏 개편"으로 대체되어 미적용.)
- **AI 목업 라벨링**: 퇴원관리 "인사이트"(sparkle) → "자동 요약"(pulse) — 라이브 AI(등록/케어/회의록)와 구분.
- **창 로딩 ← 버그**: route-window가 about:blank 단계 pathname("blank")으로 canBack 오판 → 스켈레톤에 ← 떴음. 가드 추가.
- **수납관리 책갈피 3면**: 창 오른쪽 세로 책갈피(수납/교재/지출, 파스텔, 앨범 인덱스)로 `?tab=` 면 전환(드릴인 아님 →
  ← 안 뜸). 신규 `textbook_orders`·`expenses` 테이블(`0025`+`0025a` RLS) + ijw 소스 **실데이터 이식**(교재 350·지출 95,
  `import-textbooks-expenses.cjs`). 창 폭 760×620. floating-window 타이틀바=live 문서제목 항상 표시.
- ⚠️ **시연 계정**: 데모는 POC 임포트본이라 `db:seed` 금지(전체 wipe). super-admin 사용자관리는 실-auth(박지훈 등)만.

### 전수 컴팩트화 — 대량 데이터에서 폭발하던 목록·매트릭스·칸반 정비 (2026-06-17)
멀티에이전트 감사로 "전건 평면 `.map`" 안티패턴 20여 건을 우선순위 순 정비. 모두 기존 표준(`<Pagination>`·
slice+토글·`DragScrollArea`·네이티브 `<details>`) 재사용. 브라우저 검증 완료(classes 129→3p 페이지 nav,
billing tfoot·상태칩, attendance 30→14열·출석률 sticky, enrollment 칸반 +N, 콘솔 에러 0).
- **서버 페이지네이션 신설**: 회의록(메모리)·퇴원(메모리)·수업목록(`getClassesPage`+`getClassesStats`, day는 SQL
  .in()로 총계 정확)·직원(메모리)·감사로그(`getAuditLogsPage`)·테넌트(`getTenantsPage`+`getTenantPlanStats`,
  .in()스코프 카운트)·중복그룹(20/p)·테넌트사용자(소수면 자동숨김). **회의록·퇴원·직원은 사이드 집계/필터가
  전체 기준이라 billing식 메모리 페이지네이션**(전건 fetch는 기존과 동일, 렌더만 캡).
- **캡+토글**: 회의 전사 발화(60)·등록상담 칸반(8)·이탈캠페인(10)·학생 상담탭(15, `<details>`)·타임라인(50).
- **수납 테이블**: 11→10컬럼(항목 인라인) + 상태분포 칩 + `<tfoot>` 페이지 합계행.
- **출석부**: 매트릭스 `DragScrollArea`+출석률 sticky right-0 + 월/2주 토글; 일자상세 반별 `<details>`(기본 접힘).
- **시간표 통합뷰**: 셀 수업 5개 + 더보기(client `IntegratedCell`).
- ⚠️ **의도적 미적용 2건**: ① 출석 입력폼 페이지네이션 — 반은 소그룹(정원 ~8)이라 벽 없음 + 단일 저장폼
  분할 시 미저장분 유실 위험. ② 대시보드 결석위험 캡 — 리스트 아님(카운트만), 캡 시 카운트 과소(버그) +
  쿼리도 안 가벼워짐. 둘 다 컴팩트 이슈 아님.
- ⚠️ **병렬 세션 함정 재확인**: 다른 세션이 staged한 파일을 `git add 특정경로` 후 `git commit`이 쓸어담음
  (랜딩 day-numbers/roi 삭제가 섞임 → reset --soft로 분리). 이후 **`git commit -m "msg" -- <명시경로>`** 사용.
- **재검수(멀티에이전트 18 agent) — 1차에서 놓친 11건 발견·수정**: 핵심은 **수백 옵션 native `<select>`**
  (학생 ~547·반 ~129 — 벽 + 전역 스크롤바 미적용 + 페이로드). 새 **`SearchableSelect`**
  ([src/components/ui/searchable-select.tsx](src/components/ui/searchable-select.tsx)) — 타이핑 필터 + 렌더 캡(50) +
  디자인 스크롤바 div 팝업. 폼 모드(`name`→hidden input, 필수성은 서버 액션 검증) / 네비 모드(`value`+`onValueChange`).
  적용: 수강배정 다이얼로그(학생·반)·상담 폼(학생). **`FilterSelect`에 `searchable` prop** 추가(네비 콤보박스) → 출석부 반 스위처.
  또 **리텐션 보드**(기본 진입 524명 평면 — 최대 누락 벽)·admin/cleanup 고아목록·상담→학생 전환 반 체크박스도 캡/페이지네이션.
  **새 대량 옵션 드롭다운은 native `<select>` 금지 → `SearchableSelect`** (수십 옵션 넘으면).

### 로그인 후 전수 QA + 창 내비게이션·쿼리 견고화 (2026-06-17)
- **전수 QA + 멀티에이전트 적대검증**: 로그인 후 전 화면을 브라우저로 훑어 증상 수집 → Workflow 서브에이전트가 코드를
  직접 읽어 코드버그/시드데이터/정상으로 판별(파일:줄 근거). 발견 코드버그 다수 수정(아래), 시드/데이터 결함은 Firebase 재이식 과제로 분리.
- **창 내비게이션(Idea A)**: 라우트 창 타이틀바가 iframe 제목/경로 라이브 동기화 + 뒤로(←)는 드릴인 때만(루트=X로 닫기) +
  인페이지 백은 임베드에서 숨김(`EmbedProvider`+`back-link.tsx`) + 닫을 때 부모 `router.refresh()`로 배경 즉시 반영. (#55·#56)
- **카드 전체 클릭**: 직원·학생상담 카드 어디나 클릭 → 상세/수정(수정 버튼·힌트 제거).
- **쿼리 견고화**: 공용 `src/lib/supabase/batch.ts`(`fetchInChunks`/`fetchAllPaged`)로 대량 `.in()` 414·1000행 절단·error
  삼킴을 retention(CRITICAL)·super-admin·students(export/recompute)·withdrawals·admin 전반에서 해소. (#53·#54)
- **표시/로직**: 회의 참석자 `[object Object]`, 과목 `HIGHMATH`→"수학(심화)", 수납 미수금 라벨, 퇴원 enrollment 종료,
  전화 정규화, AI 재분석 generated_at, 내학습 결석 리포트 모순, 권한 리다이렉트(루프 방지), super-admin 상태라벨.
- **AI provider = Upstage Solar 기본** 적용(`openai` 패키지 설치 + `UPSTAGE_API_KEY`; 없으면 Anthropic 폴백). "AI 모델 정책" 참고.
- ⚠️ **데모 데이터는 seed가 아니라 ijw POC 임포트본**(564명). 쓰레기 레코드·접미사·빈 성적·담임공란은 데이터 결함(코드 아님).
  최종 목표는 Firebase 전체 이식(serviceAccount `F:\ijw-calander\serviceAccount.json`, 명명DB `restore260202`) — 별도 과제.

### 선생님 원스크린 (강사 전용, 2026-06-01)
- 강사용 **수업 마감 원스크린** (`/onescreen`) — `data/원스크린_전달/` 디자인 핸드오프(React/JSX 프로토타입)를 eywa 톤으로 충실 이식.
- 한 화면: ① 진도 확인 ② 일일/확인 테스트 점수 ③ today 보고서 작성·발송. 좌(학생 9명 + 진/테/보 셀) · 중(진도+테스트) · 우(보고서).
- **데모 충실 이식**: 입력은 클라이언트 state(새로고침 리셋), 보고서는 **템플릿 자동생성**(`buildReport`, 라이브 AI 0), 발송은 **sonner 토스트 목업**(실제 전송 없음 — 알림센터 제외 원칙 유지). 새 DB 테이블·마이그레이션 없음.
- **강사 전용**: `permissions.ts`에 `teacher_onescreen: { teacher:"full", 나머지 none }` → 원장(master) 사이드바엔 미표시(12메뉴 정체성 유지), 직접 URL 진입 시 `requireAccess`가 `/`로 리다이렉트. 강사용 투어는 `teacher@ijw-demo.com` 계정.
- 순수함수 `report.ts`(buildReport/studentStatus/pct/delta) + Vitest 15케이스. `src/features/onescreen/`로 도메인 격리.

### 학생 원스크린 — 내 학습 현황 + 데일리 리포트 (학생 전용, 2026-06-01)
- `data/원스크린_패키지/`의 학생/학부모용 2화면을 강사 원스크린과 **마찬가지 패턴**으로 이식.
- **내 학습 현황** (`/my-learning`): KPI4(평균정답률·출석률·학습횟수·진도%) + 점수추이 차트(recharts, 과목 필터) + 과목별 진도 바 + 출결 달력 + 최근 기록(→데일리 리포트).
- **데일리 리포트** (`/my-learning/report?date=M/D`): 그날 진도·일일/확인 테스트(점수·%·delta) + 선생님 한마디(`buildReport` 재사용).
- **데모 충실 이식**: `src/features/my-learning/history.ts`가 프로토타입 `data.js`의 **결정적 9세션 이력**(LCG RNG)을 이식 — 정적·AI 0·네트워크 0. 강사 원스크린 9명(`DEMO_ONESCREEN`)·`buildReport`·`subjectTone` 재사용. Vitest 10케이스.
- **학생 전용 접근**: `SystemRole`에 `student` 신설(enum + 망라 맵), `my_learning: { student:"full", 나머지 none }`. `(shell)/layout`이 teacher·student면 **사이드바 없는 미니멀 셸**. 로그인 시 student → `/my-learning` 리다이렉트. 데모 학생 `student@ijw-demo.com`.

### Super-admin Phase 2~5 (4개 commit, 2026-05-29)
- **Phase 2 audit log**: `super_admin_audit_logs` 테이블 + `logSuperAdminAction` helper + `/super-admin/audit` viewer. 모든 super-admin mutation 추적.
- **Phase 3 지점장 보기**: `/super-admin/tenants/[id]/view` read-only 미러 (KPI+학생+회의, service_role). 진입 시 `impersonate_view` audit. 실제 조작 진입(RLS 함수 분기)은 Phase 6으로 보류.
- **Phase 4 라이선스**: `tenant_licenses` 테이블 (좌석형 student_seats + 토글형 ai_analysis/google_sheets/meeting_recording). tenants/[id] 라이선스 섹션.
- **Phase 5 사용자 관리**: changeUserRole/resetUserPassword/setUserActive (auth admin API) — tenants/[id] 사용자 행 액션.
- **⚠️ seed 가짜 강사 auth 부재**: seed의 teacher 5명은 `public.users`에만 INSERT (auth.users 없음). auth admin API(updateUserById)가 "User not found" 반환 → Phase 5 액션이 가짜 강사엔 실패. 실 운영 user(createTenantWithMaster/createStaff로 생성)는 auth 있어 정상. 데모 강사 관리하려면 seed를 auth.admin.createUser 기반으로 바꿔야 함 (후속).

### Super-admin Phase 1 (3개 commit, 2026-05-28)
- `super_admins` 별도 테이블 (academy 권한과 직교 — chrismathone은 master + super_admin 둘 다)
- RLS: 본인 row select만, write는 service_role 전용 + `is_super_admin(uid)` SQL helper
- `(super-admin)/` 라우트 그룹 — academy `(shell)`과 시각적 완전 분리 (ink 다크 배경 + gold accent)
- 4개 페이지: 대시보드 / 학원 목록 / 신규 발급 / 상세
  - 학원 신규 발급 = tenants INSERT + auth.admin.createUser(app_metadata)로 master 동시 생성
  - 트리거 `tg_sync_user_from_auth`가 public.users에 자동 mirror
- 모든 query는 service_role 클라이언트로 RLS bypass (multi-tenant read가 본질)
- impersonate / audit log / 라이선스 관리는 Phase 2로

### UI 폴리시 (1개 commit, 2026-05-28)
- ~~OS별 단축키 자동 분기 (`useIsMac()`)~~ → **2026-06-15 단축키 기능 전부 제거.** 가짜 단축키(⌘N·G+D/S/B, 미구현)·키캡 칩·전역 키바인딩·`useIsMac()`/`_shortcuts.tsx` 삭제. 검색 팰릿은 헤더 검색 **클릭**으로만 열림(메뉴 점프 그대로).
- 모바일 top nav 재구성 — 가로 스크롤 제거, 브랜드 banner 자체 행으로 분리, 메뉴 grid `auto-fit minmax(96px, 1fr)`로 균등 분할 (그룹 구분선 제거)
- `.scrollbar-thin` 유틸 (globals.css) — 6px width, line-tinted thumb. 디자인 톤에 녹는 스크롤바

### ijw-calander 패리티 (9개 commit, 2026-05-28)
- 학생 상세 7탭 (Overview/Billing/Grades/Attendance/Consultations/Memos/Timeline)
- 상태 전환 모달 (퇴원/휴원/재원 복구)
- 수강 배정 모달 + 반 신규/수정 폼
- 출석 셀 메모 + 숙제 체크박스
- 시간표 드래그앤드롭 + PNG export + A4 인쇄
- 강사 급여 정산 (자동 + 수동) + 휴가 관리
- billing 카테고리 + 담임 자동 매칭
- 상담 통계뷰 (전환율/사유/추세 차트)
- 대시보드 위젯 (결제 예정 / 결석 위험)
- 엑셀 export (시간표 색상 보존 / 학생 / 수납)
- Google Sheets 동기화 (service account JWT)
- Admin 도구 (중복 병합 / 데이터 정리) — 시나리오는 엑셀/스프레드시트로 대체

### 라우트 구조
- `/` = **제품 중심 랜딩** (Hero 제품 쇼케이스 → 자동연동(0.4s) → 기능 목업 시간표/출석부/수납 → **워크스페이스 멀티윈도우** → AI → 데이터 → ROI → 12메뉴 점선목차 → 단일 인터뷰 → 베타 요금 → CTA). 구 8섹션(Flow/LogoWall/Manifesto 등) 폐기. 컴포넌트: `(marketing)/_sections/*` + `_ui/*`(BrowserFrame·product-showcase·mock-{timetable,attendance,billing,workspace}·feature-block·cta-button) + `_motion/*`(Reveal·CountUp·landing.css). 워크스페이스 목업 레일은 실제 `app-sidebar`와 동일한 Lucide 아이콘.
- `/dashboard` = 대시보드 (예전 `/`에서 이동)
- `/exams`, `/exams/[id]` = **성적관리** (신규 최상위 메뉴, 학생 그룹) — 일괄 성적입력
- `/staff/payroll` = 급여 월별 전직원표 (master 전용, /staff 드릴인)
- `/login` = 로그인. 성공 시 `/dashboard` redirect
- `/admin/*` = academy master 전용 (duplicates/cleanup/integrations/sheets/**audit** 감사로그)
- `/super-admin/*` = **SaaS owner 전용 super_admin 레이어** (academy 권한과 직교)
- `(marketing)/` = 랜딩 그룹 (사이드바·헤더 없음, marketing nav 64h)
- `(shell)/` = 인증된 12개 메뉴 + admin (사이드바 232px + Topbar 64px)
- `(super-admin)/` = super_admin 그룹 (다크 사이드바 + gold accent + "Super Admin" 라벨)
- `(print)/enrollment/[id]/print/` = A4 인쇄

### 12개 메뉴 — 핵심 위젯 (ijw 패리티 적용 후)

| 메뉴 | 데이터 | 핵심 위젯 |
|---|---|---|
| 대시보드 (`/dashboard`) | dashboard 9개 쿼리 | 김수진 인사말 + KPI 4 + Timeline(1.55fr) + Announcements(1fr) + 7일 추세 |
| 시간표 (`/timetable`) | `class_schedules` + `enrollments` + `students` | **과목 단일선택(기본 수학)** + 기본뷰(요일그룹밴드 월목/화금/수 + 주말 별도판, 과목별 실교시, 같은반 2D병합, 엑셀격자) / 통합뷰(요일×교시) + 셀 학생 세로명단(신입·전입색). [`docs/ijw-feature-port.md`] |
| 출석부 (`/attendance`) | `attendance_records` | **학생 × 30일 매트릭스** + Stat 4 + 반 chip + 월 ◀▶ + 셀 클릭 입력 (`/attendance/[date]/[classId]`) |
| 수업목록 (`/classes`) | `classes` + schedules + enrollments | **테이블/카드 토글** + 과목·강사·요일 chip + 검색 + 메모/요일 컬럼 |
| 학생목록 (`/students`) | `students` + enrollments | Stat 4 + **검색 + 과목/상태 chip** + 학생별 수강 과목 다중 pill (상세 성적탭에 **레벨테스트** 섹션) |
| 성적관리 (`/exams`) | `exams` + `student_grades` | 시험 목록(응시/평균/최고/최저 통계) + 등록 + 상세 **반선택 → 일괄 점수 그리드** + 석차 |
| 등록상담 (`/enrollment`) | `enrollment_consultations` + AI | **AI 배너 (forest gradient + sparkle)** + 4열 칸반 + 월/상담사 chip + 대시보드 (recharts) |
| 학생상담 (`/consultations`) | `student_consultations` | Stat 4 + **기간/카테고리/후속 chip + 검색** + Follow-up urgency 자동 |
| 퇴원관리 (`/withdrawals`) | `students.status='withdrawn'` | Stat 4 + 리스트(1.4fr) + 사유 분석 진행바(1fr) + **기간/사유 chip + 검색** + amber AI 인사이트 |
| 직원관리 (`/staff`) | `users` + classes/students 카운트 | Stat 5 + **역할/상태 chip + 검색** + 3col 카드 그리드 + **급여 월별표 진입(`/staff/payroll`)** |
| 수납관리 (`/billing`) | `invoices` + `textbook_orders` + `expenses` + `textbook_catalog` + `tuition_catalog` | Stat 5 + 월 ◀▶ + 검색 + 정렬 + **FaceTabs 4면**(수납/교재/지출/**계산기**). 교재 면=내부탭(목록/교재 단가표), 계산기 면=서브탭(계산기/**수강료 단가**/교재 단가표/공휴일/**저장된 청구서**). 계산기=**신입생 상담 견적 도구**(자유입력 학생정보 + 다과목 + 교재/할인 + 환불규정 포함 인쇄 안내문 → `tuition_quotes` 저장, invoices와 분리). 교재 단가표는 두 면이 같은 `CatalogPanel` 재사용, 공휴일은 ijw 전체(음력·대체·이름·연도이동) |
| 회의록 (`/meetings`) | `meeting_minutes` + AssemblyAI | Stat 3 + **기간/상태 chip + 검색** + 음성 + AI 요약 + LIVE pill |
| 도움말 (`/help`) | (정적) | Search hero(gradient) + 12 메뉴 가이드 + FAQ + 1:1 문의 |

### 인증 / RLS

- 두 master 계정 (`chrismathone@gmail.com`, `st2000423@gmail.com`)이 `ijw-demo` 테넌트에 sync됨
- master `chrismathone`의 `display_name = "김수진"`, `job_title = "원장"`, `hire_date = 1998-03-15` (시안 페르소나)
- **`st2000423`만 super_admin (SaaS 총괄)**, **`chrismathone`은 인재원 지점장(academy master)일 뿐 super_admin 아님.** 둘 다 ijw-demo의 academy master지만 super_admins 테이블엔 st2000423만 있음. (super_admin ⊥ academy master — 직교.)
- 권한 매트릭스는 `lib/permissions.ts`의 `canAccess(role, menuKey)` 헬퍼. AppSidebar에서 필터링, 빈 그룹 자동 숨김
- super_admin 권한은 `getCurrentSuperAdmin()` / `requireSuperAdmin()` (`src/lib/auth/super-admin.ts`)
- 실제 데이터 보안은 RLS (`auth_tenant_id()` 함수 + tenant_isolation 정책)에서 강제
- super-admin 영역은 `createAdminClient()` (service_role)로 RLS bypass — multi-tenant read가 본질이므로

---

## 디자인 시스템 (Daylight 시안 적용)

`data/design_handoff_eywa/`의 픽셀 시안 → eywa 코드 매핑 완료. **라이트 전용**, 다크모드 제거.

### 컬러 토큰 (`src/app/globals.css`)
| 토큰 | hex | 용도 |
|---|---|---|
| `--background` | `#fbf9f3` | 페이지 배경 (따뜻한 아이보리) |
| `--bg-soft` | `#f1ede2` | 섹션 구분 / 사이드바 배경 |
| `--card` | `#ffffff` | 카드 표면 |
| `--foreground` / `--ink` | `#1a1f1c` / `#0d1110` | 본문 / 다크 강조 |
| `--text-dim` / `--text-faint` | `#5a635f` / `#9aa39d` | 보조 / 캡션 |
| `--primary` | `#1a5f3c` | **포레스트 그린** — CTA, 활성 메뉴, 출석/완납 |
| `--gold` | `#b8893a` | 강조 · 베타 배지 · AI 라벨 (POWERED BY CLAUDE) |
| `--blue` | `#1f6ba8` | 정보 · 학생 안정 · 영어 과목 |
| `--rose` | `#c44d6d` | 상담 · 학부모 · 국어 과목 |
| `--amber` | `#d68f1a` | 지각 · 부분 납부 · 경고 |
| `--danger` | `#d04848` | 결석 · 미수 · 긴급 |
| `--purple` | `#7a4ba8` | 회계 · 과학 과목 |

차트 슬롯 재매핑: chart-1(blue) · chart-2(primary) · chart-3(amber) · chart-4(danger) · chart-5(rose).

### 라운드 (ijw 운영 톤에 맞춰 시안에서 대폭 축소)
| 토큰 | 시안 | 적용값 |
|---|---|---|
| `--radius-xl` (카드) | 16px | **6px** |
| `--radius-pill` | 999px | **4px** (사각 batch) |
| `--radius-2xl` | 20px | 8px |
| `--radius-3xl` | 24px | 10px |

### 타이포
- **Pretendard Variable** (self-host) + **JetBrains Mono** (메타·숫자·키칩)
- 헬퍼 클래스: `.display-xl 96px / .display-md 56px / .h1-large 32px / .h2 24px / .h3 19px / .body / .body-sm / .caption / .micro (mono 11px 700 uppercase) / .tabular (숫자 강조)`

### Atoms (`src/components/atoms/`)
- ~~**`Initial`** — 이니셜 사각 배지~~ → **제거됨 (2026-06-19, `initial.tsx` 삭제).** 이름 앞에 붙던
  프로필사진/이니셜 배지는 전 화면에서 전부 떼어냈다. **이름 앞 아바타 금지 (⚠️ 영구 규칙)**: 사람
  표시는 **이름 텍스트만** — 이니셜 사각 배지·동그란 프사·이미지 아바타 어느 것도 이름 앞/옆에 새로
  붙이지 말 것 (앞으로도 불필요). 자리 채우기용 빈 아바타 placeholder(`size-N rounded` 회색 칸)도 금지.
- **`Pill`** — mono 11px uppercase, soft/solid + color (primary/gold/blue/rose/amber/danger/purple/neutral)
- **`SectionTitle`** — 14px 700 + action slot

### Botanical 아이콘 (22개)
- `src/components/icons/eywa-icons.tsx` — `<EyIcon name="tree" size={18} />` 단일 컴포넌트
- 이름: tree/leaf/pulse/branch/seed/sprout/wave/falling/roots/pollen/rings/spore/search/bell/arrowUp/arrowDown/arrowRight/play/check/plus/dot/sparkle
- 메뉴 매핑: `MENU_ICON[menuKey]` (대시보드=tree, 시간표=leaf, 출석부=pulse, 학생=seed, 등록상담=sprout, ...)
- AI 강조는 모든 곳에서 `sparkle + gold-soft` 일관

### AppShell
- **Sidebar = 너비 조절형 레일** (bgSoft 배경). 오른쪽 경계선을 잡고 끌면 너비가 따라오고,
  충분히 줄이면 **접힘(52px 아이콘만)**, 늘이면 **펼침(150~360px 아이콘+라벨)**으로 스냅. 더블클릭=빠른
  토글, ←/→ 키도 지원(`role=separator`). 너비/펼침 여부는 `usePrefs`(localStorage `eywa-prefs`)에 영속.
  구현: [`use-sidebar-resize.ts`](src/components/workspace/use-sidebar-resize.ts) 훅 + [`app-sidebar.tsx`](src/components/app-sidebar.tsx).
  접힘 시 hover Tooltip 라벨, 펼침 시 그룹 헤더(01~05) 노출.
- **접힘↔펼침 모핑 애니메이션**(200ms `cubic-bezier(0.22,0.61,0.36,1)`): 아이콘은 left 26px(접힘 레일
  중앙)에 **고정**해 안 튀고, 활성/hover 하이라이트는 절대배치 bg의 `left/right`(8↔4)로 **사각형↔행 모핑**,
  라벨은 `max-width+opacity` 페이드, 그룹 슬롯은 `height`(접힘 6/13 ↔ 펼침 22)로 "패널이 열리듯" 성장.
  **모션 OFF(`usePrefs.animations`)면 트랜지션 전부 0s**(즉시). 드래그 중엔 1:1 추종이라 트랜지션 off.
- 5그룹: 홈 / 수업 / 학생 / 운영 / 지원 + 01~05 인덱스 (mono uppercase)
- 활성 메뉴: primary bg + white text + shadow-primary-glow
- 푸터: `김수진 / 원장 · chrismathone@gmail.com`
- **Topbar 64px**: breadcrumb (mono 11px primary) + 19px 800 페이지 제목 + 검색바 280px + 알림 + 사용자

### shadcn base-nova (Base UI) 유지 사항
- `render` prop (asChild 아님), `TooltipProvider delay` (delayDuration 아님)
- 일부 atom 함수형 컴포넌트 신규 작성, 나머지 shadcn 그대로 사용

### 스크롤바 — 전역 하네스 (⚠️ 무조건 적용)
**모든 스크롤 영역은 디자인 톤 스크롤바로 통일한다. 옵트인 아님.** `globals.css`의 전역 규칙
(`*`, `*::-webkit-scrollbar*`)이 페이지·패널·드롭다운 팝업·textarea 등 **모든 스크롤 컨테이너에
자동 적용** — 6px, line 컬러(`rgba(13,17,16,0.18)`, hover 0.32) thumb, 투명 track, 999px radius.
- 새 스크롤 영역을 만들 때 **별도 클래스가 필요 없다** (이미 전역). `.scrollbar-thin`은 기존 사용처
  호환용 별칭으로만 남김.
- ⚠️ **네이티브 `<select>`의 옵션 팝업 스크롤바는 OS가 그려 CSS가 닿지 않는다.** 그래서 드롭다운은
  아래 "드롭다운/셀렉트 규약"대로 [`SearchableSelect`](src/components/ui/searchable-select.tsx)로 통일한다
  (styleable 팝오버 `div` → 전역 스크롤바 자동 적용).
- 회색 기본 스크롤바가 한 군데라도 보이면 위반. 새 화면 추가 시 점검.

### 드롭다운/셀렉트 규약 (⚠️ 새 드롭다운 기본값)
- 모든 드롭다운은 [`SearchableSelect`](src/components/ui/searchable-select.tsx)로 통일.
  테두리·padding·ChevronDown·검색 팝오버 일관 + 전역 디자인 스크롤바 적용.
- URL 필터는 [`FilterSelect`](src/components/filter-select.tsx)를 쓴다 — 내부에서 SearchableSelect 렌더
  (`searchable`/`ariaLabel` prop은 호환용, 무시).
- 폼 필드는 `SearchableSelect`에 `name`을 주면 hidden input으로 값 제출.
- **native `<select>` 신규 금지** — OS 팝업은 디자인 스크롤바 미적용·스타일 불일치.

### 줄바꿈 / 워드브레이크 — 한글 어절 단위 (⚠️ 전역, 좁은 창에서 특히 중요)
**텍스트가 "발표·세미 / 나" 식으로 단어 한가운데서 깨지지 않게 한다.** 플로팅 창은 폭이 좁아
(기본 480px) 이런 "얼토당토 않은 곳에서의 줄바꿈"이 흉한 뷰를 만든다. 전역 규칙이 기본을 잡는다:
- **`globals.css`의 `body { word-break: keep-all; overflow-wrap: anywhere; }`** — `keep-all`은 CJK를
  글자 사이에서 끊지 않고 **공백(어절) 경계에서만** 줄바꿈 → 한글이 자연스럽게 단어 단위로 접힌다.
  `overflow-wrap: anywhere`는 URL·긴 영문 같은 끊을 곳 없는 토큰이 넘칠 때만 강제로 끊는다. **새 화면은
  별도 클래스 없이 이미 이 동작**(옵트인 아님).
- **절대 쪼개지면 안 되는 인라인 조각**(라벨·배지·Pill·버튼 텍스트·날짜/시각·"N개 발화" 같은 메타)은
  **`whitespace-nowrap`**(flex 안이면 `shrink-0` 동반)을 붙인다. `keep-all`도 공백은 끊으므로 "AI 분석"
  처럼 공백 든 짧은 라벨은 nowrap 없으면 "AI / 분석"으로 깨진다(회의 상세 AI 헤더가 이 케이스였음).
- **좁은 창 헤더에 라벨 + 긴 부제 + 메타를 한 줄에 욱여넣지 말 것.** 긴 부제(예: 회의 유형)는 **자기
  full-width 줄로 내려** keep-all로 깔끔히 접히게 한다(라벨/메타는 윗줄에 nowrap으로 고정).
- **긴 본문에는 `whitespace-nowrap` 금지**(가로 오버플로 유발) — keep-all에 맡긴다. `truncate`/`line-clamp`는
  "한 줄/N줄 자르고 …" 의도일 때만.

### 드래그-팬 (잡고 끌기) — 넘치는 영역의 기본 인터랙션 (⚠️ 새 화면 기본값)
**가로/세로로 넘치는 영역은 막대 스크롤바에만 의존하지 말고, 마우스로 빈 곳을 끌어 내용을
움직일 수 있게 한다** — 태블릿/지도 앱 느낌(놓으면 관성 글라이드 + 넘치는 가장자리 페이드).
구현체: [`src/components/ui/drag-scroll-area.tsx`](src/components/ui/drag-scroll-area.tsx)의 `<DragScrollArea>`.
- **적용**: 기존 `<div className="… overflow-auto …">{내용}</div>` →
  `<DragScrollArea className="… (overflow-auto 빼고)">{내용}</DragScrollArea>`.
  안쪽 컨테이너가 overflow를 담당하므로 바깥 className에서 `overflow-auto`는 뺀다.
- **양축 자동**: 넘치는 축만 팬. 안 넘치면 grab 커서·페이드 자동 off.
- **충돌 안전**: 터치는 네이티브 스크롤에 위임, dnd-kit draggable(`[aria-roledescription="draggable"]`)·
  폼 컨트롤 위에선 팬을 시작하지 않는다. 5px 임계값으로 "탭=클릭 / 끌기=팬"을 구분하고, 실제로
  끌었으면 뒤따르는 click 1회를 차단(카드·링크 오작동 방지). 팬을 막을 자식엔 `data-no-drag-scroll`.
- 전역 스크롤바 하네스와 **병행** — 스크롤바는 그대로 보이고 드래그가 더해질 뿐. 새 화면에서
  넓은 표·캔버스·가로 목록을 만들 땐 처음부터 `DragScrollArea`로 감쌀 것.

### 플로팅 창 기본 크기 — 넓은 메뉴는 크게 연다
메뉴는 플로팅 창(크롬리스 iframe)으로 열리고 기본 480×560인데, 넓은 표는 거기 안 들어가 가로
스크롤이 과해진다(#24). **넓은 메뉴는 크게 연다** —
[`src/components/workspace/window-geometry.ts`](src/components/workspace/window-geometry.ts)의
`ROUTE_WINDOW_SIZE: Record<menuKey, {w,h}>`에 등록(없으면 `DEFAULT_WINDOW`). 캔버스보다 크면
`cascadeNext`가 자동 clamp(작은 화면 안전). 예: `timetable: { w: 1040, h: 680 }`.

### 다열 보드 = 큰창 그리드 / 작은창 탭 (⚠️ 칸반형 레이아웃 기본값, 2026-06-19)
플로팅 창은 기본 480px로 좁다. **여러 독립 컬럼을 가로로 늘어놓는 보드(칸반)** 를 좁은 창에서 그냥
1열로 떨구면 컬럼들이 세로로 쌓여 "다른 컬럼 보려고 한참 스크롤"하는 흉한 뷰가 된다(등록상담 제보).
**해법: 창이 넓으면(lg≥1024px) N열 그리드로 전부 펼치고, 좁으면 상단 탭바로 컬럼을 전환해 한 번에
1개만 보인다.** 창=iframe이라 Tailwind `lg:` 브레이크포인트가 **창 폭에 그대로 반응** → 같은 창을
리사이즈/스냅하면 "큰창=그리드 ↔ 작은창=탭"이 라이브로 바뀐다(JS 미디어쿼리 불필요, 활성 탭 state만
클라이언트가 소유).
- **레퍼런스 구현**: [`enrollment/_components/enrollment-kanban.tsx`](<src/app/(shell)/enrollment/_components/enrollment-kanban.tsx>).
  서버 페이지는 컬럼별 데이터(`{key,label,color,cards}[]`)만 만들어 넘기고, 이 클라이언트 컴포넌트가
  탭 state·아이콘·렌더를 소유.
- **핵심 클래스 레시피**: ① 탭바 컨테이너 `flex overflow-x-auto lg:hidden`(좁을 때만), 활성칩은 보드
  필터 톤과 통일(`bg-foreground text-background`). ② 그리드 `grid grid-cols-1 lg:grid-cols-N`.
  ③ 각 컬럼 카드 `lg:flex ${i===active ? "flex" : "hidden"}` — 좁을 땐 활성 1개만, lg부턴 전부.
- **적용 기준(=칸반일 때만)**: 컬럼들이 **동등·독립한 평행 목록**일 때만 맞다(상태별 보드 등).
  - ✅ 칸반(등록상담: 대기·예약 / 상담완료 / AI완료 / 등록·종료).
  - ❌ **동질 카드 그리드**(수업목록·직원 `lg:grid-cols-3`)는 탭 아님 → **목록 페이지네이션** 표준으로.
  - ❌ **상세 본문+사이드 분할**(`lg:grid-cols-3`의 1.5+1 류)은 그냥 세로로 쌓이면 됨.
  - △ 약한 후보: `/retention`(이탈 방어) 2열 대시보드(`lg:grid-cols-[1.5fr_1fr]`) — 필요해지면 적용.
- 2번째 칸반이 생기면 그때 제네릭 컴포넌트로 추출(지금은 단일 사용처라 등록상담에 인라인).

### 반응형 창 폭 — 넓은창 공간활용 + 좁은창 접힘 (⚠️ 새 페이지 기본값, 2026-06-19)
모든 (shell) 페이지는 크롬리스 iframe(플로팅 창)에서 렌더되고, 창은 **360px(MIN_W) ~ 최대화 시
전체폭(~2300px)** 까지 자유 리사이즈/스냅된다. **창=iframe이라 Tailwind 브레이크포인트
(sm 640 / md 768 / lg 1024 / xl 1280)가 창 폭에 그대로 반응** → 같은 창을 리사이즈하면 레이아웃이
라이브로 바뀐다(미디어쿼리·JS 불필요). 그래서:
- ⚠️ **고정 좁은 `mx-auto max-w-4xl` 중앙정렬은 안티패턴** — 창을 최대화하면 콘텐츠가 그 폭에 갇혀
  좌우 여백이 수백 px씩 비고, 그 안에서도 열이 안 늘어 단일 입력칸만 비대해진다(owner 학원설정이 주범이었음).
- **원칙: 넓은 창은 여백 대신 "열/콘텐츠"로 채우고, 좁은 창(sm 미만)은 단일 컬럼으로 접는다.** max-w를
  막연히 키워 단일 입력이 가로로 폭주하게 두지 말 것.

**pageType별 처방:**
- **설정(탭형 다카드)** = 좌측 세로탭 + 우측 본문 **마스터-디테일**: 바깥 `lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8`,
  nav는 좁으면 상단 가로탭(`flex flex-wrap … lg:flex-col`), 섹션 카드는 `grid gap-4 xl:grid-cols-2`로 펼침.
  **레퍼런스: [owner-console.tsx](<src/app/(shell)/owner/_components/owner-console.tsx>)** (페이지 캡 `max-w-7xl`).
- **설정(비탭 다카드, 예 kiosk-settings)** = `grid gap-6 lg:grid-cols-2 lg:items-start` + `max-w-5xl`(헤더는 그리드 밖 full-width).
- **단일 입력만 있는 폼**(meetings/new, sheets 연결) = 오히려 **`max-w-xl~2xl`로 좁혀 가둔다**(열 늘릴 콘텐츠가
  없어 안 좁히면 한 줄 입력이 폭주). admin/cleanup처럼 짧은 카드 스택은 `grid md:grid-cols-2 xl:grid-cols-3`.
- **데이터 입력 폼**(학생/직원/반/상담) = 필드로 꽉 찬 중앙 `max-w-4xl`는 **OK**(희박한 낭비 아님 — 그대로 둠).
  더 채우려면 필드 grid를 `sm:grid-cols-2 xl:grid-cols-3` / `sm:grid-cols-3 xl:grid-cols-4`로(cap는 유지).
- **list / detail / dashboard** = full-width + `grid lg:grid-cols-[…]` 마스터-디테일(**이미 정석, 손대지 말 것**).
  넘치는 표는 막대스크롤만 두지 말고 **[`DragScrollArea`](src/components/ui/drag-scroll-area.tsx)** 로 감싼다
  (`<div className="… overflow-auto">표</div>` → `<DragScrollArea className="…(overflow-auto 뺀)">표</DragScrollArea>`).
- **student-screen / print / 단일 키패드** = 의도적 `mx-auto max-w-[680~768px]` 유지(읽기 흐름·단일 입력). 넓은창 여백 정당.

**좁은 창(360~480px) 체크리스트** (새 페이지 추가 시 필수):
- 모든 다열 grid가 sm 미만에서 `grid-cols-1`로 접히는가(기본 `grid-cols-1` 명시).
- 편집 헤더(타이틀 + 삭제/이동 버튼)는 `flex flex-wrap items-end justify-between gap-3`(안 그러면 360px서 한 줄에 낌).
- 버튼 그룹(상태칩 등)도 `flex-wrap`(출석 입력폼 6버튼 케이스).
- 가로 오버플로는 BREAKS가 아니라 `DragScrollArea`/`overflow-x`로 흡수(전역 스크롤바 하네스와 병행).

⚠️ **새 설정·폼 페이지를 만들 때 이 규약을 점검** — 특히 `mx-auto max-w-Nxl` 중앙정렬을 기본으로 박지 말 것.
같은 "큰창=펼침 / 작은창=접힘" 패러다임의 칸반 버전은 위 "다열 보드" 섹션 참고.

### 생성 폼은 우측 패널이 아니라 창으로 — autoClose 창 (⚠️ "새 X" 진입점 기본값, 2026-06-19)
"새 반/직원/학생/등록상담/상담/회의록" 같은 생성 폼은 우측 슬라이드 `<Sheet>`를 **쓰지 않는다**. 이미 있는
`/X/new` 라우트를 **플로팅 창**으로 연다(윈도우 패러다임 일관). 트리거는 기존 버튼 마크업을 그대로 두고
[`useOpenFormWindow()`](src/components/workspace/open-window-button.tsx)로 `openFormWindow("/X/new", "제목", e)`만
호출(데스크톱=창, 모바일=풀페이지 네비). 창은 `WindowParams.autoClose`로 열려, iframe이 `/X/new` 경로를
**벗어나면**(=제출 성공 후 서버 `redirect` 또는 `router.push`) RouteWindow가 **창을 닫고 배경을 새로고침**한다
(옛 패널의 "닫고 목록 갱신"과 동일 — 서버액션·폼 로직 수정 0). `ROUTE_WINDOW_SIZE`에 `"X/new"` 폭 등록(옛 패널 폭 계승).
- ⚠️ 콘텐츠용 우측 슬라이드 `<Sheet side="right">`는 **신규 추가 금지** — 창으로 연다. (`Sheet`는 모바일 내비
  드로어 등에 한정. `students/_components/student-quick-panel`의 Sheet는 모바일 peek 폴백으로만 잔존.)
- 한계: 배경(메인 프레임) 목록은 `router.refresh()`로 갱신되지만, 목록이 **별도 창**이면 그 창은 즉시
  갱신되지 않음(창 X 버튼 `closeAndRefresh`와 동일한 앱 전반 한계).

### 목록 페이지네이션 표준 — 큰 목록은 전부 이 패턴으로 통일 (⚠️ 새 목록 기본값)
실데이터 이전 후 목록이 수백~천 행이 되며 페이지가 22s까지 느려졌다(전 행 fetch + 전 행 렌더).
**행이 수십을 넘을 수 있는 모든 목록은 서버 페이지네이션으로 통일한다.** 스타일·구조를 한 곳에
맞춰 학생·수납·상담이 동일하게 보이고 동작하도록:

- **공용 컴포넌트** [`src/components/pagination.tsx`](src/components/pagination.tsx)의 `<Pagination>` —
  `이전/다음` + `현재/전체` 칩. **인라인으로 nav를 다시 짜지 말 것.** props: `page`, `totalPages`,
  `hrefForPage(p)=>string`. `totalPages<=1`이면 자동으로 null. (서버 컴포넌트끼리 함수 prop 안전.)
- **쿼리 헬퍼 2종** (feature `server/queries.ts`):
  - `getXPage(filters, page=1, pageSize=50): Promise<{ rows, total }>` — Supabase `.range(from,from+size-1)`
    + `.select(cols, { count: "exact" })`. **필터는 가능한 한 SQL로** (eq/gte/ilike/or). 조인 컬럼
    검색은 별도 id 해석 후 `.or("base.ilike.%q%,fk.in.(ids)")` (상담 학생명 검색 참고).
  - **Stat 카드용 경량 집계** — 행을 fetch하지 말고 `.select("*", { count:"exact", head:true })`로 count만
    (학생 `getStudentStatusCounts`, 상담 `getStudentConsultationCounts`). 카드는 페이지가 아니라 **전체**
    기준이어야 하므로 페이지 rows에서 도출 금지.
  - 월 단위처럼 모집단이 이미 작으면(수납 ~400행/월) **한 번만 fetch 후 메모리에서 검색·슬라이스**해도
    됨(수납 `summarizeInvoices` + `filtered.slice`). 이중 fetch만 피하면 됨.
- **페이지 컴포넌트 표준 코드**:
  ```ts
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total }, counts] = await Promise.all([ getXPage(filters, page, PAGE_SIZE), getXCounts() ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p) => { /* 현재 필터 보존 + p>1일 때만 page= 세팅 */ };
  // 빈 상태 판정은 rows.length이 아니라 total === 0
  // …목록… <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
  ```
- **page 리셋 규칙**: 필터 chip·검색·정렬·월이동 href(`buildHref`/`buildSortHref`)는 **page 파라미터를
  넣지 않는다** → 자동으로 1페이지로. `pageHref`만 `p>1`일 때 `page=`를 세팅. "결과 N건"은 `total`
  (페이지 rows.length 아님), 옆에 `{page}/{totalPages} 페이지` 표기.
- **PAGE_SIZE = 50** 고정(표·카드 공통). 변경 시 전 목록 동시 변경.

---

## 구현 중 실제로 막혔던 점들 (시간순)

미래의 자기/팀이 같은 함정에 빠지지 않도록 기록.

### 1. Next.js 16 — "middleware" 컨벤션 deprecation
`middleware.ts` 사용 시 dev 서버에 deprecation 경고. Next.js 16에서는 `proxy.ts`로 rename됨. 시그니처는 동일하지만 함수 이름이 `middleware` → `proxy`. `src/middleware.ts` → `src/proxy.ts`, 그리고 helper `src/lib/supabase/middleware.ts` → `proxy.ts`로 정리.

### 2. shadcn base-nova preset = base-ui 기반 (Radix 아님)
shadcn `init -d`로 부트스트랩하면 기본이 base-nova preset인데 이건 **Radix UI가 아닌 [Base UI](https://base-ui.com)** 기반. 결과:
- `asChild` prop이 존재하지 않음 → 대신 **`render` prop** 사용 (`<SidebarMenuButton render={<Link href="..." />}>` 형태)
- `TooltipProvider`는 `delayDuration` 아닌 `delay` prop
- `DropdownMenuTrigger`도 `render` prop 패턴

shadcn 코드를 외부에서 복붙해서 가져올 때마다 `asChild` → `render` 변환 필요. 첫 빌드에서 typecheck 5개 에러로 발견.

### 3. Pretendard dynamic-subset이 SVG 텍스트를 못 감지
`pretendardvariable-dynamic-subset.min.css` (CDN) 사용 시 페이지에 등장한 글자만 동적 로딩. 단 **SVG `<text>` 노드 안의 글자는 감지 안 됨** → fallback 시스템 폰트로 일부 글리프 깨짐 ("월"→"원", "수"→"스", "선린중"→"선린종" 같은 자모 수준 변형).

해결: SVG 안 한글 텍스트를 모두 **HTML로 빼서 absolute positioning**으로 align. 또 추후 폰트를 **정적 풀 한국어 subset** (`pretendardvariable.min.css`)으로 전환해서 SVG에 한글이 들어가도 정상 표시.

### 4. SVG viewBox 비례 확대 = fontSize도 확대
`<svg viewBox="0 0 720 180" className="w-full">`에서 컨테이너 width가 ~1300px이면 `fontSize="9"`가 16px+로 렌더됨 ("거대해 보임" 버그의 진짜 원인).

해결: 
- 차트의 X축 라벨을 SVG 밖 HTML로 빼서 `left: ${xPct}%` absolute positioning
- 차트 자체는 `max-w-[860px] mx-auto`로 wrapper 크기 제한해서 SVG의 자연 비례 유지

### 5. postgres-js batch insert의 컬럼 이름
postgres-js의 `sql`insert into table ${sql(rows)}` ` 형태에서 rows 객체의 키는 **DB 컬럼명 그대로** (snake_case)여야 함. JS 측 camelCase로 주면 "column "tenantId" does not exist" 에러.

`{ tenant_id, class_id, ... }` 형식으로 바로 만들어서 전달.

### 6. drizzle-kit이 .env.local 자동 로드 안 함
`drizzle-kit migrate` 실행 시 `DATABASE_URL` 누락 에러. drizzle-kit은 Node CLI라 Next.js의 dotenv 처리를 거치지 않음.

해결: `dotenv` 패키지 설치 후 `drizzle.config.ts` 상단에서:
```ts
import { config } from "dotenv";
config({ path: ".env.local" });
```

### 7. Drizzle migration 번호 vs 손수 RLS SQL의 prefix 충돌
`drizzle-kit generate`가 `0001_*.sql`을 만드는데, 우리가 손수 작성한 RLS 파일도 같은 prefix를 쓰려다가 보면 두 `0001_*`가 됨. drizzle은 _journal.json 기반이라 자기 파일만 인식해서 실행에는 문제 없지만 git에서 헷갈림.

컨벤션: **drizzle 파일은 `0001_*.sql`, 손수 RLS는 `0001a_*.sql`** 같은 alpha suffix. drizzle은 alpha 파일을 무시하지만 우리는 그 파일을 별도로 `node --env-file=.env.local -e "..."` 스크립트로 적용.

### 8. Supabase 새 프로젝트는 IPv4 direct connection이 deprecated
처음에 `postgresql://postgres:PWD@db.{ref}.supabase.co:5432/postgres` (direct connection) URL을 사용했더니 `ENOTFOUND` — 새 Supabase 프로젝트는 **IPv6 전용**이라 IPv4만 라우팅되는 환경에서 안 됨. DNS는 AAAA 레코드만 (`Resolve-DnsName ... -Type AAAA`로 확인).

해결: **Session pooler** URL (`postgres.{ref}:PWD@aws-1-{region}.pooler.supabase.com:5432/postgres`) 사용. region 부분은 dashboard에서 확인 필요 (Seoul = `ap-northeast-2`였고 prefix는 `aws-0`이 아니라 `aws-1`이었음). Transaction pooler (port 6543)는 prepared statement 비활성이라 drizzle-kit과 호환 이슈, 그래서 Session pooler를 사용.

### 9. DB password를 Google OAuth secret과 혼동
사용자가 처음 "db 패스워드"라며 보낸 값이 `GOCSPX-...` 형태였는데 이건 **Google OAuth 2.0 client secret**의 표준 형식 (`GOCSPX-` prefix). Supabase가 자동 생성하는 비번은 그런 prefix 안 씀. 문자열 형식만 보고 "잘못된 키"라고 짚어서 사용자가 진짜 supabase 비번을 다시 보냄.

교훈: 키 형식이 의외이면 사용자 입력을 그대로 적용하기 전에 형식 검증해서 확인할 것.

### 10. Server Action 로그인이 cookie 전파 안 되는 무한 redirect (가장 큰 버그)
사용자 보고: "로그인 후 바로 로그아웃되버린다". Chrome MCP로 재현해보니:
1. 로그인 폼 submit → Server Action `signInWithPassword` 호출 → Supabase가 `sb-{ref}-auth-token` cookie를 set (`base64-...` prefix 형식, length 2799)
2. Server Action이 `redirect("/")` 호출 → 브라우저가 `/`로 navigate
3. middleware (`proxy.ts`)가 그 cookie로 `supabase.auth.getUser()` 호출 → **user `null` 반환**
4. middleware가 `/login`으로 다시 redirect → 사용자에겐 "로그인 직후 자동 로그아웃"

원인 추정: `@supabase/ssr 0.10.x`의 `base64-` prefix cookie 포맷이 Next.js 16 + Vercel 환경의 middleware cookies adapter를 통과할 때 server-side `getUser()`가 cookie를 verify 못 함. 클라이언트는 같은 라이브러리지만 정상 동작.

**해결 (2단계)**:
1. **로그인을 client-side로 전환** — `createBrowserClient`로 `signInWithPassword` 호출. browser SDK는 자체적으로 cookie + localStorage 동기화. 그 후 `router.push(next ?? "/")` + `router.refresh()`.
2. **middleware를 단순화** — `supabase.auth.getUser()` 호출을 빼고 **단순히 `sb-*-auth-token` cookie 존재 여부만** 체크. 실제 user 검증은 `(shell)/layout`의 `getCurrentUser()`가 처리 (같은 cookies adapter지만 layout 컨텍스트에선 정상 작동). RLS가 최종 보안 레이어이므로 등급 동일.

### 11. React Server Component에서 `Date.now()` 호출 lint 에러
새 `react-hooks/purity` 룰이 RSC body에서 `Date.now()`를 catch함. 그러나 RSC는 매 request마다 새로 실행되어 "stable per request"이므로 사실 문제 없음.

해결: `const cutoff = Date.now() - 7 * 86_400_000`을 `// eslint-disable-next-line react-hooks/purity -- server component renders once per request` 코멘트와 함께 사용.

### 12. Lucide React 화살표 아이콘이 한글 자모로 오인됨
KPI 카드의 `<ArrowUpRight className="size-3" />` (12px, default strokeWidth=2)이 작은 화면에서 한글 "ㄱ"/"ㄴ"과 흡사하게 보임. "ㄱ +12 최근 7일" 식으로 읽힘.

해결: `size-3.5 strokeWidth={2.5}`로 굵게 + 살짝 크게. 아이콘 모양이 명확해짐.

### 13. trend window가 오늘 포함하면 0% drop
대시보드 7일 추세 차트가 마지막 점 (오늘)에서 0%로 떨어짐 — 오늘은 attendance 시드 안 됨 + 진행 중인 날이라 의미 없음. delta "-93.3pt" 같은 거짓 정보 표시.

해결: window를 `end = yesterday`로 잡음. "최근 7일"의 의미를 "어제까지 7일"로 (학원 운영 관점에서 자연스러움).

### 14. 시드 변수 중복 선언 (`today`)
attendance loop에서 `const today = new Date()` 사용 후, invoice loop에서 또 `const today = new Date()` 추가 → esbuild parse 에러 "The symbol 'today' has already been declared". 둘 다 같은 함수 스코프.

교훈: seed.ts처럼 긴 함수에서는 변수 이름 prefix를 명확하게 (`invoiceNow`, `enrolledAt` 식으로).

### 15. Drizzle이 GiST EXCLUDE / 부분 인덱스 / generated column을 표현 못 함
- `EXCLUDE USING gist (...)` — Drizzle schema로 표현 불가
- `CREATE UNIQUE INDEX ... WHERE status<>'withdrawn'` — `uniqueIndex` builder는 WHERE 미지원
- `name_normalized text GENERATED ALWAYS AS (...) STORED` — Drizzle generated column 미지원

모두 손수 작성한 `0001a_*.sql` raw 파일에서 추가. drizzle generate는 base 테이블만, 손수 SQL이 후처리.

### 16. UI 자잘한 어색함들 (frontend-design swing 후)
사용자가 "어색해" 피드백한 점들:
- 트렌드 차트가 거대 (viewBox 비례 확대)
- KPI 화살표가 한글 자모로 보임
- 로그인 좌측 패널이 vertical 균형 깨짐 (`justify-between` → `my-auto`)
- Hero 우측 stats 카드가 작음 (`text-sm` → `text-base`, `py-2.5` → `py-3`)
- "선린종" 같은 한글 깨짐 (Pretendard subset)

Chrome MCP로 직접 production을 봐가며 조정한 것들. **자동 fix 후 사용자에게 "맞춰주세요" 묻기 전에 실제로 캡처해서 확인하는 사이클**이 중요.

### 17. Vercel deployment queue / dev 서버 hang
- Push 후 Vercel 빌드가 큐에 대기 (1-2분). 두 번 연달아 push하면 큐에 두 개 쌓임 — 두 번째 push의 결과를 보려면 1-3분 기다림.
- 로컬 dev 서버가 file convention 변경 (`middleware.ts` → `proxy.ts`) 같은 큰 변경 후 hang. 죽이고 재시작 필요.
- 포트 3000을 다른 앱이 점유 (MathGen Vite 등). `PORT=3100 pnpm dev`로 우회.

### 18. Server Component의 cookies() / RSC vs Server Action
Next.js 16의 `cookies()`는 async (`await cookies()`). Server Action에서는 set 가능하지만 Server Component에서는 set 불가. 우리 `lib/supabase/server.ts`의 `setAll`은 try/catch로 swallow (Server Component에서는 무시, Server Action에서는 실제 적용). 이 패턴이 일반적이지만 위 (10) 버그처럼 일부 환경에서 round-trip 깨질 수 있음.

### 19. 시안 디자인 vs 실 운영 도구 갭
시안(Daylight)이 단순 주간 일정 그리드를 가정하는데, 실제 ijw 운영 화면은 강사 × 학생 × 월 매트릭스, 마스터-디테일, 다중 chip 필터 등 정보 밀도가 훨씬 높음.

**해결**: 시안 디자인 토큰만 차용하고, 화면 구조는 ijw 운영 패턴 채택. 시간표 = 강사/요일/교시 + 학생 명단, 출석부 = 학생 × 30일 매트릭스, 학생목록 = 검색 + 과목/상태 chip, 수업관리 = 테이블 + 다중 필터, 수납 = 검색 + 월 selector + 컬럼 정렬 ▼.

### 20. 라운드 디자인 톤 조정
시안의 16px 카드 / 999px pill이 운영 도구로는 과해 보임. **globals.css 한 곳에서 토큰 일괄 축소** (`--radius-xl 16→6`, `--radius-pill 999→4`) + raw 픽셀 radius 7개 파일 (rounded-[7px] 등) 일괄 변경. ijw 직선 위주 톤에 가깝게.

### 21. (marketing) 라우트 그룹과 `/` 경로 충돌
랜딩을 `/`로 잡으려면 기존 `(shell)/page.tsx` (대시보드)와 충돌. Next.js 라우트 그룹은 URL에 영향 없으므로 같은 path 잡으면 conflict.

**해결**: `(shell)/page.tsx` → `(shell)/dashboard/page.tsx`로 이동. `(marketing)/page.tsx`가 `/` 차지. proxy.ts에서 `PUBLIC_PATHS = new Set(["/"])`로 비로그인 통과. 로그인 후 navigation은 `/dashboard`로.

### 22. invoices delete 순서 (시드 재실행)
seed.ts wipe 단계에서 students를 invoices 삭제 전에 지우면 FK 위반. 순서: attendance → invoices → enrollments → student_consultations → enrollment_consultations → students → class_schedules → classes → classrooms → announcements → meeting_minutes → users.

### 23. dev 서버 background 출력 stdout flush 안 됨
PowerShell에서 `pnpm dev`를 background로 띄우고 turbopack의 컴파일 로그를 보려고 .output 파일 read 했을 때, 이미 ready 후 새 GET 요청 로그가 즉시 안 보임. Bash run_in_background는 자식 프로세스 stdout buffer가 line buffered되지 않을 수 있음.

**우회**: 새 GET 직접 curl로 → 상태코드 확인. 또는 dev 서버 logical 통신 (Chrome MCP read_console_messages)으로.

### 24. 시간표 컬럼 폭 (강사 × 다중 요일)
ijw 스타일 기본뷰는 강사 컬럼 안에 가르치는 요일만 sub-column으로 표시. 강사 수 × 평균 2~3요일 → 가로 스크롤 필수.

**해결**: 좌측 4개 컬럼 (교시/이름/학년/학교) sticky `left: 0/40px` 고정. 헤더도 sticky `top: 0`. 컬럼 폭 `min-width: 180px` 부여.

### 25. React 19 `react-hooks/set-state-in-effect` 룰 — setState in useEffect 금지
OS 감지 hook을 `useEffect(() => setIsMac(...))`로 짰더니 React 19 / Next 16의 새 lint 룰이 즉시 차단. setState 동기 호출이 cascading render를 일으킬 수 있어서 권장 안 됨.

**해결**: `useSyncExternalStore`로 리팩토링. `getSnapshot` (client에서 navigator.userAgent 검사), `getServerSnapshot` (false 반환)으로 SSR/CSR mismatch 없이 안전하게 동기화.

```ts
export function useIsMac() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

### 26. 모바일 nav `overflow-x-auto` 가로 스크롤바 + 어색한 wrap
좁은 폭에서 14개 메뉴를 `overflow-x-auto + shrink-0` 패턴으로 두면 회색 기본 스크롤바가 뜸. `flex-wrap`으로 바꾸면 wrap은 되지만 그룹 구분선 위치가 어색하고 마지막 줄 우측 공백이 큼.

**해결 (2단계 진화)**:
1. `flex-wrap`로 일단 가로 스크롤바 제거 + `.scrollbar-thin` 유틸로 디자인 톤 스크롤바
2. 브랜드 banner를 자체 행으로 분리하고 메뉴는 CSS Grid `auto-fit minmax(96px, 1fr)` — 모든 cell 균등 너비 + 그룹 구분선 제거

`.scrollbar-thin` 유틸은 globals.css에 한 번 정의:
```css
.scrollbar-thin { scrollbar-width: thin; scrollbar-color: rgba(13,17,16,0.18) transparent; }
.scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(13,17,16,0.18); border-radius: 999px; }
```

table.tsx / billing / attendance / kanban-filters / 학생 상세 탭 nav에 일괄 적용.

**진화(이후)**: 사용자 지시로 **전역 하네스화** — `.scrollbar-thin` 옵트인을 `globals.css`의 `*` 전역
규칙으로 승격해 **앱 전체 스크롤바 무조건 통일**. 자세한 규칙은 위 "디자인 시스템 › 스크롤바 — 전역
하네스" 참고. 네이티브 `<select>` 팝업은 CSS가 안 닿으니 드롭다운은 `SearchableSelect`로 통일(드롭다운/셀렉트 규약).

### 27. super_admin layer를 만들 때 깨질 가정 4가지
`users` 테이블은 강력하게 1:1 tenant 매핑 (NOT NULL, RLS도 `auth_tenant_id()`로 강제). SaaS owner 같은 multi-tenant viewer를 같은 테이블에 끼우면 schema가 무너짐.

**결정**: `super_admins` 별도 테이블 신설 — academy 권한과 직교. `chrismathone`은 academy master + super_admin 둘 다 가짐. RLS도 super_admins 자체엔 본인 row select만, write는 service_role 전용.

**multi-tenant read는 service_role 클라이언트로 처리** — `createAdminClient()` (`src/lib/supabase/admin.ts`). RLS bypass라 모든 tenant 데이터 한 번에 조회 가능. (이게 위험해 보이지만, 모든 사용처가 `requireSuperAdmin()` 가드를 거치므로 안전.)

mathlab의 `viewing_tenant` 쿠키 + Zustand 패턴은 매력적이지만 eywa의 RLS 강제를 회피해야 해서 Phase 2로 미룸.

### 28. `(super-admin)` 라우트 그룹 + `/super-admin/*` URL → 폴더가 두 번 중첩
Next.js 라우트 그룹 `(super-admin)`은 URL에 영향 없음. 그래서 `/super-admin` URL을 잡으려면 폴더 구조가:
```
src/app/(super-admin)/super-admin/page.tsx
src/app/(super-admin)/super-admin/tenants/page.tsx
```
바깥 `(super-admin)`은 layout 적용용, 안쪽 `super-admin`은 URL용. 처음에 `(super-admin)/page.tsx`로 짜면 `/` 충돌 (랜딩이 차지함).

### 29. Server Component layout에서 active pathname 못 받음
`(super-admin)/layout.tsx`가 server component인데 사이드바에 active 메뉴 highlight하려면 pathname이 필요. `headers().get('x-pathname')`는 기본 동작 안 함 (Next.js가 자동으로 set 안 함).

**해결**: 사이드바를 client component로 만들어서 `usePathname()` 사용. 작은 인터랙티브 부품이라 client로 빼는 비용 작음.

### 30. invoices 컬럼명 `amount` vs `amount_total`
Super-admin 쿼리에서 `invoices.select("amount")`로 시작했더니 KPI가 "0원" 표시. 실제 schema는 `amount_total / amount_paid / amount_discount` 3개 컬럼. 다른 도메인 코드를 참고하지 않고 추측한 결과.

**교훈**: 새 도메인 쿼리 작성 시 항상 `src/lib/db/schema.ts`에서 해당 테이블 컬럼명을 먼저 확인. typecheck로는 안 잡힘 (supabase 클라이언트는 string-typed).

### 31. seed 가짜 강사가 auth.users에 없음 → auth admin API "User not found"
super-admin Phase 5(사용자 관리)에서 강사 계정에 `auth.admin.updateUserById`(role 변경/비번 재설정/ban) 호출 시 **"User not found"**. 원인: `scripts/seed.ts`가 만든 teacher 5명은 `public.users`에 **직접 INSERT**만 하고 `auth.users`는 거치지 않음 (가짜 이메일 `teacher.xxx@ijw-demo.local`). 즉 로그인·auth 관리 불가능한 "데이터 전용" 레코드.

**영향**: 시간표/출석/수업 등 `public.users`만 참조하는 기능엔 무해. 단 로그인·super-admin 사용자 관리(auth admin API)는 실패. 실 운영 user(`createTenantWithMaster`/`createStaff` = `auth.admin.createUser`로 생성)는 auth 있어 정상.

**교훈**: auth가 필요한 계정은 반드시 `auth.admin.createUser`로 생성 (트리거가 public.users mirror). 데모 강사를 진짜 로그인·관리 가능하게 하려면 seed를 그 방식으로 전환해야 함 (후속).

### 32. seed wipe가 실제 gmail 계정(teacher로 강등된 st2000423)을 삭제 → 로그인 튕김
`db:seed`의 wipe `delete from users where tenant_id=... and system_role <> 'master'`가 academy 시뮬레이션용 teacher였던 `st2000423`(실제 auth 계정)을 `public.users`에서 삭제. auth.users엔 남아 signInWithPassword는 성공하지만 `getCurrentUser()`가 null → `(shell)` layout이 `/login`으로 redirect = "로그인 직후 튕김".

**해결**: seed에 wipe 이후 실제 auth 계정을 명시 복구하는 블록(1c/1d). 또는 그 계정을 master로 두면 wipe 조건에서 보존됨. **교훈**: wipe 조건이 실제 로그인 계정을 건드리지 않도록 항상 점검.

### 33. Chrome MCP 좌표 클릭이 작은 토글의 form submit을 못 트리거
super-admin 라이선스 토글·사용자 비활성화 버튼(작은 `<button type=submit>` 안에 span)을 `computer left_click(ref)`로 눌러도 **server action POST가 안 일어남** (network 0건). 반면 `javascript_tool`로 `button.click()` (native click dispatch)하면 정상 submit + DB 반영.

**진단/우회**: MCP 합성 마우스 이벤트가 작은 버튼의 React form submit을 항상 트리거하진 않음. 검증 시 `javascript_tool`의 `el.click()` 또는 `form.requestSubmit()`로 우회. **실제 사용자 마우스 클릭은 native click이라 정상** — 코드 버그 아님.

### 34. 로그인 폼 autofill이 MCP 입력을 덮어씀
Chrome MCP로 `st2000423` 이메일을 `form_input`한 뒤 로그인 클릭했더니 브라우저 autofill이 직전 `chrismathone`으로 되돌려 엉뚱한 계정 로그인 실패. 

**우회**: `read_page`로 ref 새로 얻은 뒤 `form_input(email) → form_input(password) → click`을 **한 batch**로 연속 실행 (autofill 개입 전에). navigate 후엔 ref가 무효화되므로 매번 새로 얻을 것.

### 35. server action 신규 추가 시 dev hot reload가 stale
Phase 4/5에서 새 server action(`toggleTenantLicense`, `setUserActive` 등)을 추가한 직후 dev에서 호출해도 반영 안 됨. dev 재시작 후 정상. Turbopack hot reload가 새 `"use server"` export를 즉시 등록 못 하는 경우가 있음.

**우회**: server action 추가 후 검증 전 `PORT=3100 pnpm dev` 재시작. (단 이번엔 재시작해도 #33/#31이 겹쳐 진단이 길어짐 — 증상이 여러 개면 하나씩 분리할 것.)

### 36. dev 서버가 build와 동시 실행 시 자주 죽음 + screenshot clip 에러
`pnpm build`를 dev 서버 켜둔 채 돌리면 `.next` 충돌로 dev가 exit 1/7로 죽음 (background task가 "failed"로 뜨지만 실제론 ready였다가 죽은 것). 또 Chrome MCP `screenshot`이 간헐적으로 `clip.scale` 에러(`-32602`) — window resize 직후 발생. 

**우회**: 검증은 dev로, build는 별도 타이밍에. dev 죽으면 `curl`로 확인 후 재시작. screenshot 에러는 잠시 후 재시도 또는 resize 없이 호출.

### 37. Base UI Sheet/Dialog는 React state mount에 시간차 (~1.5–2.5s)
`open={true}` set 직후 `document.querySelectorAll('[data-slot="sheet-content"]').length`가 0 → 1.5~2.5초 뒤 1. Chrome MCP로 sheet open 검증 시 즉시 확인하면 false negative.

**우회**: 클릭 후 `wait 3s` 또는 `setTimeout` 후 sheet count 확인.

### 38. Chrome MCP 전체 버튼 재검증 — `[BLOCKED: Cookie/query string data]`
`javascript_tool`로 칩 필터의 활성 상태를 확인하려고 `location.search`나 `a.getAttribute('href')`(쿼리스트링 포함)를 읽으면 **`[BLOCKED: Cookie/query string data]`** 로 차단됨. 쿼리스트링이 민감정보 유출 경로로 취급되기 때문.

**우회**: 현재 URL은 `tabs_context_mcp`(권위 있는 URL 반환)로, 칩 href 검사는 `find` 툴로. JS 안에서는 쿼리스트링을 절대 읽지 말 것.

### 39. MCP 합성 ref-click이 앵커 내비·React onClick을 항상 트리거하진 않음 (#33 확장)
칩(앵커 링크)·작은 버튼을 `computer left_click(ref)`로 눌러도 내비게이션/`onClick`이 안 일어나는 경우가 잦음 (meetings 상태 칩 → URL 그대로, billing 수정 버튼). #33의 "작은 토글 form submit" 증상과 같은 뿌리 — MCP 합성 마우스 이벤트의 한계.

**우회**: `javascript_tool`의 native `element.click()`은 핸들러/내비를 안정적으로 발화. `<select>`는 `form_input`. **실제 사용자 마우스는 native click이라 정상** — 코드 버그 아님(검증 도구의 한계).

### 40. `read_network_requests`가 base64 `data:image` 포함 시 토큰 한도 초과
AI 호출 0건을 검증하려 `read_network_requests`를 호출했더니 응답에 base64 `data:image/png` 요청이 섞여 **179KB → 토큰 한도 초과**로 파일에 덤프됨. 그 파일을 파싱하려 했더니: 로컬 **`jq`는 깨진 npm shim**(`Cannot find module 'commander'`), **PowerShell `ConvertFrom-Json`**도 임베디드 base64에서 파싱 실패(`':' or '}' expected`).

**우회**: 덤프 파일은 버리고 새 DOM 쿼리로 재확인. (네트워크 목록은 에러 출력에 이미 인라인으로 찍혀 있어 **AI 호출 0건**은 그걸로 확인됨.) 네트워크 검증은 처음부터 필터링된 작은 쿼리로.

### 41. 커스텀 인라인 다이얼로그·아이콘 버튼 탐지
billing 수납 "수정"이 여는 건 `[role=dialog]`/`[data-slot*=dialog]`가 아니라 **커스텀 `div.space-y-4`** (취소/저장 버튼 보유). 표준 셀렉터로는 "다이얼로그 안 열림"으로 오판.

**우회**: 클릭 후 **새로 나타난 취소/저장 버튼 유무**로 다이얼로그 열림을 판정. 아이콘 전용 버튼(수정 등)은 `innerText`가 비어 텍스트 매치 실패 → `aria-label`("수정")로 매치.

### 42. 셀프투어 재검증에서 잡은 진짜 깨진 창문 — 상태 변경 메뉴가 항상 "재원으로 전환…"만
학생 상세에서 휴원·퇴원 학생인데도 상태 변경 드롭다운이 항상 "재원으로 전환…"만 노출. 원인: `students/[id]/page.tsx`가 `StatusAction`에 `currentStatus`로 **한글 라벨**(`STATUS_LABEL[student.status]`)을 넘김 → `status-action.tsx`의 분기가 raw enum(`enrolled`/`on_hold`/`withdrawn`) 기준이라 전부 빗나가 `else`(전환)로 떨어짐.

**해결**: page는 **raw enum** 그대로 전달(`currentStatus={student.status}`), `status-action`은 분기는 enum으로 하고 다이얼로그 표시용으로만 자체 `STATUS_LABEL`로 라벨화. **교훈**: enum 분기 컴포넌트엔 절대 표시용 라벨을 넘기지 말 것 — 표시 변환은 컴포넌트 안에서. 셀프투어에선 이런 "옵션이 틀린 메뉴"가 전형적 깨진 창문.

### 43. Chrome MCP 로그인 — form_input이 React 상태 미동기 + 합성 submit 미발화 (#33/#34/#39 합본)
강사 계정 로그인 검증에서 `form_input`으로 이메일·비번을 채우고 `computer left_click(submit)`을 눌렀는데 **/login 그대로**(제출 안 됨). 두 원인 겹침: (1) `form_input`은 DOM value만 바꾸고 React controlled state의 onChange를 안 태워 제출 시 빈 값일 수 있음; (2) 합성 클릭이 submit을 항상 띄우진 않음(#33/#39).

**우회**: `javascript_tool`로 **native setter + input/change 이벤트 dispatch** 후 `form.requestSubmit()` — React 폼 값 주입의 정석.
```js
const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
set(email,'…'); set(pw,'…'); email.closest('form').requestSubmit();
```
autofill(#34)도 이 방식이면 덮어쓰니 무관. 버튼·드롭다운 클릭도 native `element.click()`이 안정적(예: 사용자 메뉴 → 로그아웃).

### 44. Stage Manager 배경 교체 — `router.push` 직후 pathname 비동기 레이스
플로팅 창 ⇄ 배경(메인 프레임 라우트) 1:1 맞교환 버튼(`SendToBack`). 처음엔 옛 배경 라우트를
`usePathname()`로 읽었는데, `router.push`가 비동기라 전환 완료 전 **연타하면 pathname이 옛 값** →
엉뚱한 배경 탭(유령 `route:admin` 등) 생성.

**해결**: 배경 라우트를 store에 명시 필드(`background`)로 두고 캔버스가 pathname과 동기,
`swapToBackground`는 그 값을 결정적으로 읽고 갱신. + 전환(퇴장 애니메이션) 중 버튼 `disabled`.
**교훈**: 비동기 네비 직후 `usePathname()`에 의존하지 말 것 — 필요한 상태는 store에 명시적으로 들고 동기화.

### 45. 스냅/타일 "해제 시 원래 크기 복원" — applyLayout이 prevRect를 지웠음
Snap Layouts 바·Snap Assist 타일링(`applyLayout`/`applyDragLayout`)이 `prevRect: undefined`로
자유(레이아웃 전) 크기를 **지워버려**, 드래그로 빼도 원래 작은 크기로 못 돌아갔다(최대화만 복원됐음).

**해결**: `Win`에 `snapped` 플래그 추가 → 레이아웃/스냅 진입 시 원본 rect를 `prevRect`에 보존
(이미 snapped/maximized면 최초 원본 유지), 드래그 시작 시 `restoreUnderPointer`(기존
`unmaximizeUnderPointer`를 snapped까지 일반화)로 커서 아래 복원. 수동 이동/리사이즈는 snapped 해제.

### 46. 드래그가 드롭 때만 clamp → 타이틀 가림 + 스냅 바 과민
- 타이틀바 드래그는 이동 중 clamp 없이 **drop에서만** clamp → 타이틀바를 헤더 위로 끌어올려 가릴 수
  있었다. `onPointerMove`에서 `y = Math.max(0, …)`로 상단 클램프(포인터 sy는 계속 위로 갈 수 있어 스냅 바 소환엔 무영향).
- 스냅 레이아웃 바가 `TOP_BAND=150`으로 너무 빨리 떠 "선택만 해도 뜨는" 느낌 → **히스테리시스**
  (소환 ≤44px, 유지 ≤160px)로 "상단에 올렸을 때만" 노출.

### 47. 창 애니메이션 — 지연 언마운트 + 모션 토글 + TS 클로저 narrowing 소실
- 닫기/최소화/배경교체는 React가 **즉시 언마운트**라 퇴장 애니메이션이 없었다 → `exiting` 상태 set →
  150ms 후 실제 동작 실행(`runExit`). tw-animate `animate-out fade-out-0 zoom-out-95`.
- **모션 토글**: `usePrefs`(zustand persist "eywa-prefs"). `motionDisabled()`=설정 **단일 기준**(`!animations`).
  설정 **기본값만** OS '동작 줄이기'를 따르고(`animations: !osReducedMotion()`), 한 번 토글하면 그 값이
  OS를 **덮어씀**(ON이면 reduce-motion이어도 애니메이션 보임). 훅(비-React)은 `usePrefs.getState()` 임의
  읽기로 게이트, 컴포넌트는 구독으로 반응. UI는 UserMenu의 `DropdownMenuCheckboxItem`(`closeOnClick={false}`).
- 가드로 좁힌 타입(`win.params.href`)이 `runExit(() => …)` **클로저 안에서 `string|undefined`로 풀림**
  → 상수로 캡처(`const href = win.params.href`) 후 사용.

### 48. 커밋 분할 — 결합된 변경은 같은 커밋, 파일 단위로만 쪼갬
여러 기능이 같은 파일을 건드리면(`window-store`·`floating-window` 등) **파일 단위로만 분할 가능**
(비대화형 환경은 `git add -p` 불가). 또 강결합 변경(예: `avatar.tsx` 삭제 ↔ `user-menu`의 avatar
import 제거)은 **반드시 같은 커밋**에 — 안 그러면 중간 커밋이 빌드 깨짐.

### 49. 배경 탭 스트립이 선택할 때마다 재정렬 — 스택 순서 ≠ 활성 표시
`setBackground`가 선택된 배경을 `[...filter(id), params]`로 **항상 맨 끝(top)으로 이동**시켜,
탭 클릭(=pathname 변경)마다 캔버스가 이를 호출 → 스트립이 재정렬됐다(사용자: "들어온 순서대로 있어야").

**해결**: 배경 스택은 **삽입 순서로 고정**(append만), "현재 보이는 배경"은 별도 `activeBackgroundId`로 분리
→ 하이라이트만 이동, 배열 불변. 탭 클릭 핸들러는 `setBackground`로 **active를 직접** 갱신(router.push
타이밍에 의존 X; 같은 경로면 pathname 효과가 안 떠 active가 안 바뀌는 사각지대 제거).
**교훈**: "스택/순서"와 "현재 선택"은 다른 상태 — 한 배열의 위치로 둘 다 표현하면 선택이 순서를 흔든다.

### 50. 창→배경 드래그 칩 ↔ 스냅 레이아웃 바 — 같은 상단을 두 어포던스가 다툼
워크스페이스 드래그 어휘를 통일하며(배경 탭↓→창 `backgroundToWindow` / 창→상단 '배경으로' 칩
`swapToBackground` / 레일 아이콘→오른쪽 드래그→드롭 지점에 창 `open`+`setRect`), 창→배경 칩이
스냅 레이아웃 바와 **같은 상단 중앙**을 차지해 충돌. 칩은 **창 1개여도** 떠야 하는데 스냅바는 2개+에서만 뜸.

**해결**: 칩(`backgroundDropZone`)을 스냅바와 **독립**으로 띄우고, 스냅바는 `SNAP_BAR_BG_OFFSET`(44px)만큼
**아래로 밀어** 겹침 회피 — 렌더(`snap-layouts-bar`)와 히트테스트(`use-pointer-drag`)에 **동일 오프셋** 적용
(렌더 +offset, 히트테스트 py −offset). 드래그 훅이 칩 영역을 스냅보다 **우선** 판정. 드롭은
`FloatingWindow`의 `handleSwapToBackground`(router.push + 퇴장 애니메이션)를 콜백으로 재사용. 타이틀바
'배경으로 보내기' 버튼은 그대로 유지(중복 경로 공존). 레일 드래그는 세로 스크롤과 충돌 안 나게 **가로 우세**만 판정.

### 51. dnd-kit `DndContext`는 SSR에서 명시적 `id` 필수 (hydration 불일치)
`@dnd-kit`은 `id`를 안 주면 `aria-describedby="DndDescribedBy-N"`을 **모듈 전역 카운터**로 생성 →
SSR(0)↔CSR(1) 카운터가 어긋나 hydration 경고("attributes … didn't match"). 기능은 정상이나 a11y 연결이 깨짐.
**해결**: `<DndContext id="timetable-dnd" …>`처럼 **안정 id 지정** → SSR=CSR 일치. (timetable-board.tsx)

### 52. 합성 PointerEvent로 워크스페이스 드래그 테스트 — 캡처 메서드 둘 다 stub
`usePointerDrag`는 pointerdown에서 `setPointerCapture`, pointerup에서 `releasePointerCapture` 호출.
합성 `PointerEvent`(가짜 pointerId)는 둘 다 throw → **하나만 stub하면** onPointerUp 첫 줄에서 멈춰
드롭이 적용 안 됨(**테스트 아티팩트, 제품 버그 아님**). `Element.prototype.{set,release}PointerCapture`를
**둘 다** no-op stub해야 정확 재현. 또 드래그 결과 측정은 **outer div의 `.style.width`/rect**로 —
inner dialog `getBoundingClientRect`는 글라이드 트랜지션 중 mistimed(스냅 후 456으로 보였다가 outer는 934).
배경 칩/스냅 셀 위로 가려면 포인터를 먼저 상단(stage sy≤44)으로 올려 reveal 후 셀로 내려야 함.

### 53. 대량 `.in("…id", ids)` = HTTP 414 + error 삼킴 (반복 안티패턴)
수백~수천 개 id를 단일 `.in()`에 넣으면 supabase-js가 GET 쿼리스트링에 전부 직렬화 → URL이 ~16KB+ 한도를
넘겨 **HTTP 414(URI Too Long)** 로 실패한다. 그런데 `const { data } = await …; data ?? []`로 받으면 **error를
조용히 삼켜** 결과가 통째로 비고, 화면은 에러 없이 "정상"처럼 오작동한다(고아탐지가 전 재원생을 오탐, 이탈관리
위험점수가 거짓, export 과목 누락 등). 발견처: admin findOrphans, retention 로스터(5쿼리), students export·
recomputePrimaryTeacher, withdrawals 로스터.
**처방(공용)**: [`src/lib/supabase/batch.ts`](src/lib/supabase/batch.ts) — `fetchInChunks`(id를 100개 청크로 나눠
병렬 `.in()` 후 합침: URL 안전 + 청크당 행이 1000 미만), `fetchAllPaged`(`.range(from,to)` 페이지네이션으로 1000행
한도 초과 전건 확보). **둘 다 `error`를 throw**(절대 `?? []`로 삼키지 말 것). 새 대량 조회는 처음부터 이 헬퍼로.

### 54. PostgREST 기본 max-rows ≈ 1000 — 전건 fetch는 silent 절단
`.in()`/필터 없이 전건을 가져와 JS로 집계(카운트·SUM)하면 PostgREST 기본 1000행에서 **에러 없이 잘린다**
(`config.toml`·max-rows 오버라이드 없음). super-admin `getAllTenants`/`getSaaSStats`가 멀티테넌트 users·students·
invoices를 전건 받아 JS Map으로 세다가 테넌트 증가 시 과소집계. **단순 카운트는 `count:"exact", head:true`,
합계·그룹은 RPC group-by 또는 `fetchAllPaged`로.** "세기만 하려고 수백 행을 JS로 끌어오기"는 신호.

### 55. 창(iframe) ⇄ 배경(메인 프레임)은 **별도 문서** — 저장이 자동 반영 안 됨
플로팅 창은 크롬리스 same-origin iframe(별도 Next 인스턴스). 창에서 server action으로 저장하면 그 **iframe 안**은
revalidate되지만, 이미 렌더된 **부모(배경) 라우트는 stale**(다른 문서라 모름). → 라우트 창을 **닫을 때 부모를
`router.refresh()`**(`floating-window.tsx`의 `closeAndRefresh`)해 배경 목록이 즉시 갱신되게 한다. iframe 제목/경로도
부모가 자동으로 모르므로 `route-window.tsx`가 `contentDocument.title`/`location`을 MutationObserver+popstate로 관찰해
타이틀바에 동기화(`window-store`의 `live`).

### 56. 창 내비게이션 모델 — 루트에선 ← 숨김(닫기=X), 권한 리다이렉트는 루프 주의
- **뒤로(←)는 드릴인했을 때만**(iframe path ≠ 창 루트). 루트(첫 화면)에선 ← 가 "닫기"와 중복이라 숨기고 우상단 X로
  닫는다. 인페이지 "← …로" 백은 임베드(창)에서 숨김(`EmbedProvider`+`<BackLink>`), 배경 풀페이지에선 표시. 닫으면
  부모 새로고침(#55)으로 배경 메뉴가 그대로 드러난다(= 사용자가 기대하는 "창 닫힘").
- **권한없음 리다이렉트는 `/dashboard`로 무조건 보내면 안 됨** — `student`는 dashboard 접근이 `none`이라 `/dashboard`가
  또 막혀 **무한 리다이렉트 루프**. `requireAccess`/`requireSuperAdmin`은 "대시보드 접근 가능하면 `/dashboard`, 아니면
  공개 랜딩 `/`"로 분기(`canAccess(role,"dashboard")`).

### 57. 너비 조절 사이드바 — 드래그 핸들 + 프리뷰 트랜지션 얼음 함정
사용자 요청으로 사이드바에 "접기/펼치기 버튼"을 넣었다가(하단 토글이 계정 줄과 겹쳐 어색) **버튼 대신
오른쪽 경계선 드래그-리사이즈**로 전환(`use-sidebar-resize.ts`). THRESHOLD(120px) 미만으로 끌면 접힘(52px)
스냅, 이상이면 펼침(150~360 클램프). 드래그 중엔 `dragging` 플래그로 `transition-[width]`를 끈다(커서 1:1 추종).
더블클릭=토글, ←/→ 키 + `role=separator`로 접근성. 너비/펼침은 `usePrefs`에 영속.
- ⚠️ **검증 중 "inline `width:240px`인데 computed/getBoundingClientRect는 52px" 미스터리** — 원인은
  **프리뷰 백그라운드 탭의 멈춘 document 타임라인**. 하이드레이션 점프(52→240)가 띄운 width transition이
  `currentTime:0`에 얼어 **inline `!important`까지 덮어쓴다**(러닝 트랜지션이 캐스케이드 최상위). 제품 버그 아님.
  구분법: `MutationObserver`로 style 속성 mutation을 1초 카운트 → 0이면 렌더루프 아님(트랜지션 얼음).
  `el.getAnimations().forEach(a=>a.finish())` 후 측정하거나, 렌더 박스 말고 **inline style + 영속 store**(진실값)를
  읽어 검증. 자세한 환경 함정은 메모리 `reference_browser-verification-env`.

---

## 마이그레이션 & 시드 흐름

> 적용 방식·순서·alpha 파일 목록·**현재 적용 상태(검증 2026-06-16: 번호본 0000~0024 + alpha 전부 적용,
> trgm 색인 11개·RLS 미적용 테이블 0개 확인)**는 [`supabase/migrations/README.md`](supabase/migrations/README.md).
> ⚠️ **2026-06-18 이후 alpha 추가**(드리즐 스냅샷은 `0027_big_swordsman`에 멈춤 — 신규는 전부 손수 alpha, `db:generate` 금지):
> `0027b` 학생메모핀 · `0027d~f` 직원phone/조퇴/학생프로필 · `0027g/h` 시간표포트 RLS·이전 · **`0028a` 시험(exams) ·
> `0029a` 카카오메시징 · `0030a` 교재카탈로그 · `0031a` 운영감사로그 · `0032a` 레벨테스트**(전부 dev DB 적용·RLS 격리).
> drizzle 번호본은 `db:migrate`가 자동, RLS/트리거/확장/GIN trigram 색인 등 `000Na_*` **alpha는 손수** 적용
> (신규 DB 셋업 시 누락 주의).

1. **스키마 수정** — `src/lib/db/schema.ts`
2. **`pnpm db:generate`** — drizzle이 SQL diff 생성 (`supabase/migrations/000N_*.sql`)
3. **손수 RLS/제약/트리거 작성** — `0001a_*.sql` 같은 alpha suffix 파일로
4. **`pnpm db:migrate`** — drizzle이 자기 파일만 적용
5. **`node --env-file=.env.local -e "..."`** 식으로 alpha 파일을 raw SQL 실행 (또는 supabase dashboard SQL editor)
6. **`pnpm db:seed`** — `scripts/seed.ts` 실행. idempotent (테넌트 데이터 전부 삭제 후 재삽입).

## Git 협업 규칙 (⚠️ 여러 세션이 병렬로 작업함)

**여러 Claude 세션·사용자가 동시에 이 repo에 커밋·push한다.** 그래서:

1. **작업 시작 전 항상 최신 커밋 확인**:
   ```bash
   git fetch origin && git log origin/main..HEAD --oneline   # 로컬에 미push 커밋 확인
   git log HEAD..origin/main --oneline                       # 원격에 내가 모르는 커밋 확인
   ```
   origin/main에 내가 모르는 커밋이 있으면 **먼저 그 위로 맞춘 뒤** 작업.

2. **push 전 반드시 최신에 merge/rebase**:
   ```bash
   git pull --rebase origin main   # 원격 최신을 내 커밋 아래로 당겨와 충돌 없이 쌓기
   git push origin main
   ```
   바로 `git push`로 reject되면(`non-fast-forward`) 위 rebase 후 재시도. **force push 금지.**

3. **working tree가 clean인데 "ahead of origin by N commits"** = 다른 세션이 만든 로컬 커밋이 push 안 된 상태일 수 있음. push 전 그 N개가 무엇인지 `git log origin/main..HEAD`로 확인하고, 의도된 것이면 함께 push.

4. **커밋은 작게·자주**. 한 기능 = 한 커밋. 여러 세션이 같은 파일을 건드릴 수 있으니 큰 덩어리는 충돌 위험이 큼.

## 여러 세션 병렬 작업 — 언제 좋고, 어떻게 격리하나

**핵심 원칙: 두 세션이 같은 것을 동시에 *쓰면* 충돌, 다른 것을 쓰면 안전.** 여기서 "같은 것" = 파일 · `.next` · 같은 포트의 dev 서버 · Supabase DB · main 브랜치.

⚠️ **이 repo는 세션들이 단일 작업 트리(`D:/eywa_refactoring`)를 공유**한다 (`git worktree list` 하면 워크트리 1개뿐). 그래서 격리 없는 동시 *쓰기*는 위험:
- **같은 파일 동시 편집** → 나중 쓴 쪽이 덮어씀, 상대 세션의 화면은 stale
- **둘 다 `pnpm dev`** → `.next` 락 충돌·생성파일 손상 (#17/#23 — `routes.d.ts` 깨짐 → `.next` nuke 후 재빌드해야 복구)
- **둘 다 `db:seed`/마이그레이션** → 같은 Supabase를 상호 wipe (seed가 idempotent-wipe라 더 위험)
- **둘 다 push** → non-fast-forward 도돌이표 (위 Git 협업 규칙)

### 병렬이 안전·유용한 경우
- **파일이 안 겹치는 독립 작업** (예: `/billing` ∥ `/meetings`). 단 공유 파일(`globals.css`·`schema.ts`·`navigation.ts`·`permissions.ts`)은 한쪽만 건드릴 것.
- **읽기·탐색 ∥ 코딩** — 한 세션은 쓰기를 안 함.
- **긴 작업(빌드·마이그레이션·긴 AI 호출) 돌려두고** 다른 작업 진행.
- **다른 repo/프로젝트** — 공유 상태 없으니 무조건 안전.

### 진짜 병렬 코딩은 worktree로 격리
```bash
git worktree add ../eywa-billing -b feat/billing   # 별도 디렉터리 + 별도 브랜치
PORT=3101 pnpm dev                                  # dev 서버는 포트 분리 (3100과 다르게)
```
세션마다 자기 worktree(= 자기 `.next`·자기 파일)를 열면 파일·빌드 충돌이 원천 차단되고, 끝나면 브랜치를 merge.
⚠️ **단 Supabase DB·Vercel 프로젝트는 worktree로도 안 갈라진다** — DB 변경(seed/migrate)은 격리해도 동시 금지.

### 오히려 한 세션 안에서가 나은 병렬
"조사하면서 구현"류는 새 세션보다 **서브에이전트(Agent)**(여러 곳 동시 탐색, 결과가 한 맥락으로 복귀) + **백그라운드 실행**이 안전하고 맥락이 안 흩어진다.

**한 줄 규칙: 읽기·탐색은 마음껏 병렬. 쓰기(편집·dev·DB·push)는 "격리됐는가?"를 먼저 확인 — 아니면 한 세션으로.**

## 검증 게이트 (commit 전)

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest unit
pnpm build       # next build (Turbopack)
```

네 단계 모두 그린이어야 push. Vercel은 push 후 자동 빌드.

## 데모 로그인 계정 (현재 상태)

| 이메일 | 비밀번호 | 역할 | 용도 |
|---|---|---|---|
| chrismathone@gmail.com | mbplaza2* | master (지점장) | 인재원 지점장. super_admin 아님. **원장용 투어** (12메뉴) |
| st2000423@gmail.com | qkrthtjs1234@ | master + super_admin | SaaS 총괄 (전체 지점 관리) |
| teacher@ijw-demo.com | ijwteacher1! | teacher (박지훈) | **강사용 투어** — 선생님 원스크린. seed가 auth 생성 + wipe-safe 보존 |
| student@ijw-demo.com | ijwstudent1! | student (김서연) | **학생용 투어** — 내 학습 현황 + 데일리 리포트. seed가 auth 생성 + wipe-safe 보존 |

두 master 모두 ijw-demo academy master지만 **super_admin은 st2000423만**. `display_name`은 김수진 / 석태선.
데모 강사/학생은 `scripts/seed.ts`의 `ensureDemoAuth`가 idempotent 생성하고, wipe(#32) 직후 `public.users` 행을
on-conflict로 재upsert한다(강사=박지훈 `TEACHERS[0]`, 학생=김서연). `student`는 `system_role` enum에 없어
시드가 `ALTER TYPE … ADD VALUE IF NOT EXISTS 'student'`로 멱등 추가 후 사용(#31/#32 회피).
`st2000423`을 teacher 등 다른 role로 되돌리려면 admin API 한 번:
```js
fetch(URL + '/auth/v1/admin/users/fcf735fa-edf7-4095-8fa6-724285a018ed', {
  method: 'PUT',
  headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_metadata: { system_role: 'teacher', tenant_id: 'becaa316-e636-42e9-9d09-08b133e0b094' } }),
});
// + super_admins 테이블에서 제거: delete from super_admins where email='st2000423@gmail.com'
```

## 남은 작업

### 성능 (최우선)

production 반응속도가 느림. 의심 가는 병목:

1. **Vercel 함수 cold start** — Serverless 함수가 cold일 때 첫 응답이 1-3초. 미들웨어 + RSC가 매번 실행.
   - 대응 후보: 일부 라우트를 `export const dynamic = 'force-dynamic'` 대신 ISR/static로 (가능한 곳)
   - 또는 Vercel Edge runtime (단 `@supabase/ssr` cookies 이슈 재발 가능 — 확인 필요)

2. **Supabase pooler latency** — 서울 region이지만 매 함수 호출마다 새 connection. `postgres-js` connection caching이 함수 인스턴스 안에서만 가능.
   - 대응 후보: Drizzle을 쓰는 server actions은 connection 재사용. supabase JS도 cache.

3. **대시보드 9개 Promise.all** — getCurrentUser + 9개 쿼리 = 10 round-trips.
   - 대응 후보: 단일 RPC 함수로 합치기 (서버 측에서 한 번에) 또는 PostgREST의 cte 기능
   - 또는 Suspense streaming — 위젯별로 비동기 렌더링하여 빠른 위젯 먼저 노출

4. ✅ **(shell)/layout 인증 호출 중복** — `getCurrentUser`/`createClient`를 React `cache()`로 래핑, `requireAccess` 반환값 재활용. (ef53e86 다음 커밋)

5. ✅ **Pretendard CDN 첫 로드** — variable font를 `next/font/local`로 self-host. CDN RTT 제거 + Next 자동 preload + font-display swap.

6. **AI 호출 자체는 느림** (Claude 응답 2-10초). 단 명시적 버튼이라 사용자 기대치 OK. 개선이라면 Suspense + streaming response.

### 기능

1. ✅ **Hero 한글 호칭** — chrismathone → 김수진 원장 (seed에서 display_name 업데이트)
2. ✅ **ijw 운영 패리티** — 시간표 매트릭스 / 출석부 30일 그리드 / 학생·수업·수납 검색·필터 / 4개 메뉴 chip 추가
3. ✅ **제품 중심 랜딩 전면 재설계** (경쟁사 학원조아·makeedu 벤치마크) — "코더 느낌" 탈피, 제품 전면화:
   제품 쇼케이스 Hero(브라우저 프레임 + 플로팅 카드 부유) · 기능 인앱 목업(시간표·출석부·수납) ·
   **워크스페이스 멀티윈도우 차별점(cascade↔1+2 타일 자동재생, 실제 스냅 이징 cubic-bezier(0.22,0.61,0.36,1))** ·
   카피 탈감성화(날짜 서사 제거) · 목업 이름 마스킹(강OO, 개인정보 오해 차단) · 전 모션 reduced-motion 폴백.
4. **pgTAP RLS 테스트** — 두 테넌트 격리 자동 검증
5. **AI 분석 history 보존** — 현재는 UPDATE라 마지막 분석만 남음. 별도 테이블에 INSERT-only로 누적 + history viewer (옵션)
6. **Gemini Flash 통합** — fast-tier 작업이 생기면 비용 절감
7. **시드 확장** — 학생 30→90~248명 (페이지네이션·검색 가치 명확화). Phase 7에서 시드 구조만 잡고 데이터는 그대로 둠
8. **(장기) Firestore → Supabase 마이그레이션 스크립트** — 실제 운영 데이터 전환 시
9. ✅ **검색 데이터 색인** — 완료: **pg_trgm 트라이그램 GIN 색인**(`0024a_search_trgm.sql`, 적용됨 — tsvector 아님: 한국어 부분일치 때문). 커맨드 팰릿이 메뉴(클라) + 학생·수업·상담·등록상담(서버 `/api/search/palette`, `src/features/search/server/queries.ts`, RLS 테넌트 격리, RPC 없이 `.ilike`)을 함께 검색. 한국어 1~2글자는 trgm 효율 낮음(후속 pg_bigm 평가 가능).
10. ✅ **배경 탭 스택(다중 배경)** — 완료: `background`를 스택 배열로(맨 뒤 대시보드). 창 '배경으로 보내기'로 push, 상단 스트립(`background-tabs.tsx`)에서 클릭=전환/우클릭=창으로 꺼내기. 라우트는 창이거나 배경 탭이거나(중복 방지).
11. ✅ **ijw 기능 갭 메우기 P0·P1·P2** — 전수검수 143건 중 P0(막다른 길 9)·P1(일상운영 9)·P2(운영 깊이 7) 완료.
    P2 = 시험모듈(`/exams`)·수강종료추적·급여월별표·수강료계산기·교재카탈로그·운영감사로그·레벨테스트 + 카카오 알림톡 머지.
    상세: 위 "진행 상황 › ijw 기능 갭 P2"(2026-06-18). (남은 P3는 #14.)
12. **데모 시드 갭(P2 신규 테이블)** — `audit_logs`는 mutation 사용 시 자동 채워짐(현재 비어있음). `level_tests`는 비어있음
    (필요 시 시드). 급여 월별표는 활성직원 39명 중 급여설정 1명뿐이라 거의 0원 — 데모용 급여설정 시드 필요. (⚠️ `db:seed`는 POC 데모 wipe — 금지.)
13. **P2 브라우저 실검증** — 시험 일괄입력·계산기·단가표·감사로그·레벨테스트는 **로직 레벨만 검증**(타입/테스트/빌드 그린).
    Chrome MCP 재연결 후 웨일에서 실거동 일괄 검증 필요(역할별 메뉴 노출 포함). [[reference_browser-verification-env]]
14. **ijw 갭 P3(미착수)** — 상담 녹음 AI / QR 공개접수 / 시간표 시뮬레이션 / 엑셀 라운드트립(import) / 지출 결재 +
    급여 정책엔진(과정별 단가·강사 override). 무겁고 데모 임팩트는 P2 < — 우선순위 재점검 후 진행.
15. **drizzle 스냅샷 reconciliation** — P0~P2 신규 테이블(0027b~0032a)은 전부 **손수 alpha**(`db:generate` 금지, #P0-6 드리프트).
    0027 시리즈(kiosk·timetable·messaging) 전부 main 안착 후 드리즐 스냅샷 정식 재산출을 **별도 과제**로.
16. **시간표 P1(인라인 검색·강사 시간표 색상)** — 병렬 timetable 세션 소관. 이 세션 검토 시점엔 미반영(시간표가 과목×교시
    그리드로 재설계되어 방향이 다름). 그 세션 병합 후 실제 구현 여부 재확인.
