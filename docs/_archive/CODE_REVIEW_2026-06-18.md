# aywa 코드 검토 리포트

**검토일** 2026-06-18 · **대상 커밋** `cc24afb` (main) · **범위** 전체 종합 (아키텍처 · 보안/RLS · 성능 · 코드 품질)
**방법** 정적 코드 리뷰 (멀티에이전트 fan-out + 핵심 발견 직접 재확인). 실행 검증 게이트는 아래 "검증 게이트" 절 참조.

---

## 한 줄 결론

**구조적으로 건강한 코드베이스다.** 옛 3,113줄·80-props 붕괴의 교훈(파일 분할, AI 단일 진입점, 페이지네이션 표준, 인덱스, 배치 헬퍼)은 실제로 내재화되어 있다. 다만 **`createAdminClient()`(RLS 우회)를 쓰면서 클라이언트가 보낸 id/role을 신뢰하는 서버 액션 한 곳에 실제 권한 상승·테넌트 탈취 취약점**이 있고, **반응속도(=명시된 1순위)를 직접 깎는 "전건 fetch 후 JS 집계" 패턴**이 대시보드·목록 곳곳에 남아 있으며, **돈/계산 로직의 순수함수+테스트 규칙이 가장 중요한 경로(급여·수강료·출석률)에서 지켜지지 않는다.** 보안 1건만 즉시 고치면 된다 — 나머지는 점진 개선.

---

## 심각도별 요약

| # | 영역 | 심각도 | 제목 | 근거 |
|---|---|---|---|---|
| S1 | 보안 | 🔴 **CRITICAL** | `changeStaffRole` 권한 검사 누락 → 권한 상승 + 크로스테넌트 계정 탈취 | `staff/server/actions.ts:157-200` |
| S2 | 보안 | 🟠 HIGH | `users` 테이블이 generic tenant 정책뿐 → PostgREST 직접 호출로 self-escalation | `0001a_rls_constraints_triggers.sql` (동적 정책 루프) |
| S3 | 보안 | 🟠 HIGH | AssemblyAI 웹훅 인증이 시크릿 미설정 시 무력화 + 서명검증 없음 | `api/webhooks/assemblyai/route.ts:51-54` |
| P1 | 성능 | 🟠 HIGH | 대시보드: 독립 커넥션 11개 + 전건 fetch 후 JS 집계 | `dashboard/server/queries.ts:159,187,332` |
| P2 | 성능 | 🟠 HIGH | `getStudentStatusCounts`가 전 학생 row를 받아 4개 카운트 (1000행 절단 위험) | `students/server/queries.ts:109` |
| Q1 | 품질 | 🟠 HIGH | 급여 계산이 DB 레이어에 인라인 — 순수함수 아님, 테스트 0 | `payroll/server/queries.ts:26-122` |
| Q2 | 품질 | 🟠 HIGH | 수강료(invoice) 집계는 순수함수지만 **테스트 없음** | `billing/server/queries.ts:159` |
| S4 | 보안 | 🟡 MED | 오디오 signed-URL이 경로 prefix만 검사 | `meetings/actions.ts`, `enrollment/actions.ts` |
| S5 | 보안 | 🟡 MED | `runAiAnalysis`에 역할 검사 없음 (비용 트리거 무방비, RLS로 누수는 차단) | `enrollment/server/actions.ts` |
| P3 | 성능 | 🟡 MED | 리텐션 로스터(가장 무거운 읽기)에 캐싱 없음 | `retention/server/queries.ts:46-111` |
| P4 | 성능 | 🟡 MED | 요청 간 캐싱 전무 (`unstable_cache`/`revalidate` 0건) | 전역 |
| Q3 | 품질 | 🟡 MED | 출석률 공식 5곳 중복 구현 | 5개 파일 (아래) |
| Q4 | 품질 | 🟡 MED | 큰 클라이언트 폼들 분할 여지 (recording-form 457줄 등) | `enrollment/new/recording-form.tsx` 외 |
| Q5 | 품질 | 🟢 LOW | 커버리지 게이트·CI 미설정 → "70%+"는 현재 희망사항 | `vitest.config.ts`, `.github/` 부재 |

---

## 1. 보안 / 멀티테넌트 RLS

### 🔴 S1 (CRITICAL) — `changeStaffRole` 권한 상승 + 크로스테넌트 계정 탈취

`src/features/staff/server/actions.ts:157-200`. 형제 액션 `createStaff`(L59)·`updateStaff`(L124)·`deactivateStaff`(L210)는 모두 첫 줄에서 `canManageStaff(actor.systemRole)`로 게이트하는데, **`changeStaffRole`만 `getCurrentUser()`로 "로그인했는가"만 확인한다.** 그 결과:

1. **권한 게이트 부재** — `viewer`/`teacher`/`student` 등 누구든 이 서버 액션을 직접 호출할 수 있다 (서버 액션은 페이지 접근권한과 별개로 POST 가능).
2. **클라이언트가 보낸 값으로 인가 판정** — `id`·`newRole`·`currentRole` 모두 `formData`에서 온다(L164-166). `canAssignRole`이 **공격자가 보낸 `currentRole`**(L174)을 기준으로 검사하므로, 실제 대상이 `master`여도 `currentRole=viewer`로 위장하면 "더 센 사람 못 건드림" 방어가 무력화된다.
3. **service-role로 id만 필터해 쓰기** — `admin.from("users").update({ system_role: newRole }).eq("id", id)`(L182-185)는 RLS를 우회하며 `id`는 임의 UUID(타 테넌트 사용자 포함).
4. **테넌트 강제 이동** — 이어서 `admin.auth.admin.updateUserById(id, { app_metadata: { tenant_id: actor.tenantId, system_role: newRole } })`(L189-191)가 **피해 계정을 공격자 테넌트로 옮기고** 역할을 박는다. `auth_tenant_id()`가 이 값을 읽으므로 그 계정의 RLS 격리까지 깨진다.

**조치** (a) 맨 위에 `if (!canManageStaff(actor.systemRole)) return {error}` 추가; (b) **대상의 실제 `tenant_id`/`system_role`을 DB에서 읽어** `actor.tenantId`와 일치하는지 검증하고 불일치 시 거부; (c) `canAssignRole`을 **DB 역할** 기준으로 호출; (d) 여기서 `tenant_id`를 세션값으로 재기록하지 말 것.

> 직접 재확인함 — 파일을 읽어 4가지 모두 코드와 일치 확인.

### 🟠 S2 (HIGH) — `users` 테이블이 generic tenant 정책뿐

`users`는 다른 테이블과 동일한 `*_tenant_isolation` 정책(`FOR ALL ... using/with check (tenant_id = auth_tenant_id())`)만 받는다(`0001a` 동적 루프). **컬럼/역할 단위 제약이 없어** 어떤 인증 사용자든 anon 키 + 유효 세션으로 PostgREST에 직접 `UPDATE users SET system_role='master'`를 보낼 수 있고, RLS는 `tenant_id`만 보므로 통과한다. 앱 레이어의 역할 위계(`role-hierarchy.ts`)가 DB로 뒷받침되지 않는다 — S1의 DB-레이어 백업이기도 하다.

**조치** `users` 정책을 분리 — `SELECT`은 테넌트 스코프 허용, `UPDATE/INSERT/DELETE`는 `is_super_admin()` 또는 SECURITY DEFINER 역할 헬퍼(`auth_user_role()`)로 master/admin만, 비권한 사용자의 `system_role`/`tenant_id` 변경 금지.

### 🟠 S3 (HIGH) — AssemblyAI 웹훅 인증이 조건부 + 서명검증 없음

`src/app/api/webhooks/assemblyai/route.ts:51-54`:
```js
const expected = process.env.ASSEMBLYAI_WEBHOOK_SECRET;
if (expected && req.headers.get("x-eywa-webhook-secret") !== expected) { ... 401 }
```
`if (expected && ...)` — **시크릿이 미설정이면 조건이 통째로 거짓이 되어 검사를 건너뛴다**(엔드포인트 완전 개방). `.env.local.example`엔 빈 값으로 출하되어, 깜빡하면 조용히 무방비가 된다. 이후 `createAdminClient()`로 공격자가 제어하는 `transcript_id`를 조회해 AI 분석 + 학부모 PII(이름/전화)를 **임의 테넌트** 행에 쓴다(L71-101). 또한 HMAC 본문 서명이 아니라 헤더 고정 시크릿이라 변조 탐지 불가·재전송 가능. `proxy.ts`가 `/api/*`를 그대로 통과시키므로 상위 게이트도 없다.

**조치** 시크릿을 **필수**로(`if (!expected || header !== expected) return 401` — fail closed). 가능하면 AssemblyAI 실제 서명검증 사용.

> 직접 재확인함 — L51-54 단락 코드 일치 확인.

### 🟡 S4 / S5 (MEDIUM)

- **S4** 회의·등록상담의 오디오 흐름이 `audioPath.startsWith(`${tenantId}/`)`만으로 service-role `createSignedUrl`을 호출. 크로스테넌트는 막히지만(prefix 강제), 테넌트 내에서 권한 밖 객체의 1시간 signed URL을 발급할 여지. → 객체 존재/소유를 확인하거나 경로 정규식(`^${tenantId}/[\w.-]+$`)으로 제한.
- **S5** `runAiAnalysis`(enrollment)가 `getCurrentUser`/`canAccess` 없이 `consultationId`로 동작. RLS로 데이터 누수는 차단되나, `enrollment: none`인 역할도 유료 AI 호출을 트리거할 수 있어 비용통제 원칙 위반. → 액션 맨 위 역할 가드 추가.

### ✅ 보안에서 잘 된 점 (확인됨)

- **RLS 테이블 커버리지는 실제로 완전.** "26 CREATE TABLE vs 19 ENABLE RLS" grep 불일치는 오탐 — 7개 테이블(`tenants`/`users`/`classrooms`/`classes`/`students`/`enrollments`/`attendance_records`+`announcements`)은 `0001a`의 `do $$ ... format('alter table ... enable row level security')` **동적 루프**에서 켜져 문자열 grep에 안 잡힐 뿐. 26개 전부 RLS+정책 보유. `super_admins`/`audit`/`licenses`는 테넌트 격리 대신 super-admin/self 정책(설계상 올바름).
- 모든 `(shell)` 페이지 `requireAccess`, `(super-admin)/layout`이 `requireSuperAdmin()`, 6개 API 라우트 전부 가드.
- super-admin 서버 액션 전부 첫 줄 `requireSuperAdmin()`.
- 하드코딩 시크릿 없음 — 클라이언트엔 `NEXT_PUBLIC_*`만, service_role 키는 `"server-only"` 마킹된 `admin.ts`에만. (데모 비번은 `scripts/seed.ts`에 의도적·문서화됨.)
- 검색은 `sanitize()`로 PostgREST 구분자·ILIKE 와일드카드 제거 후 RLS 클라이언트로 질의 — SQL 인젝션 없음. (다만 super-admin `getTenantsPage`의 `.or(name.ilike...)`는 sanitize 미경유 — 영향 작으나 정렬 권장.)

---

## 2. 성능 (명시된 1순위)

### 🟠 P1 (HIGH) — 대시보드: 커넥션 11개 + 전건 fetch 후 JS 집계

`src/app/(shell)/dashboard/page.tsx:28-52`이 11개 쿼리를 `Promise.all`(병렬은 좋음). 단 각 함수가 `await createClient()`로 자기 라운드트립을 내고, 그중 다수가 전건을 JS로 끌어와 집계한다:
- `getActiveConsultationsCount`(`queries.ts:159`) — 활성 상담 전 row 받아 4버킷 `.filter().length`.
- `getTopOutstanding`(`:332`) — 미납 인보이스 전건 받아 학생별 JS 합산.
- `getPaymentRateThisMonth`(`:187`)·`getTrendDataLast7Days`(`:216`) — 당월 인보이스 전건 `reduce`.

콜드 스타트에서 각자 새 pooler 라운드트립이며, 가장 많이 보는 화면이 11개 중 가장 느린 것에 직렬로 묶인다. 데이터 증가 시 JS 집계는 1000행 무음 절단 위험(KPI 오류)도 동반.

**조치** 대시보드를 **단일 Postgres RPC**(SQL 집계로 전 KPI 반환)로 합치거나, 최소한 각 카운터를 `count:'exact',head:true`/SQL `sum()`으로. 느린 위젯은 `<Suspense>`로 감싸 커맨드 밴드부터 페인트. **체감 속도 최대 개선 지점.**

### 🟠 P2 (HIGH) — `getStudentStatusCounts` 전건 fetch

`src/features/students/server/queries.ts:109` — `select("status")` 후 JS `.filter().length`. **바로 위 docstring(L101)은 "전체 fetch 회피"라고 적었지만 구현은 정반대.** `/students` 진입마다 564행을 실어 4개 숫자를 계산하고, 1000명 초과 시 카운트가 무음 과소집계(CLAUDE.md #54 그 버그). 같은 패턴이 `getStaffList`·`getClassAttendanceStats`에도.

**조치** 4개 `head:true` 카운트 병렬로 교체(`consultations/queries.ts:122`의 `getStudentConsultationCounts`가 정답 패턴).

> 직접 재확인함 — L101 docstring과 L109 구현 모순 확인.

### 🟡 P3 / P4 (MEDIUM)

- **P3** 리텐션 로스터(`retention/queries.ts:46-111`)는 전 재원생 × 5개 테이블을 페이지 진입마다 청크 fetch + JS 스코어링. 414/절단은 안전(청크화됨)하나 캐싱이 없어 앱에서 가장 무거운 읽기. → 스케줄/명시 "갱신" 기반 캐시(이미 AI 기능이 쓰는 모델) 또는 SQL RPC, 단기적으론 `<Suspense>` + `unstable_cache`.
- **P4** 전역적으로 `unstable_cache`/`revalidate` **0건**. `cache()`는 요청 내 중복제거만 — 같은 화면 재방문마다 전 쿼리 재실행. 콜드스타트·pooler 지연이 1순위 불만인데 요청 간 캐싱이 전무. → staleness 허용 집계(공지·플랜 통계·리텐션·트렌드)에 짧은 TTL.

### ✅ 성능에서 잘 된 점 (확인됨)

- **AI 게이팅 정확** — 모든 `generateJSON` 호출이 `"use server"` 액션/웹훅 내부, 페이지/RSC엔 0건. 결과는 DB 컬럼에 영속, 상세 페이지는 읽기만(자동 재호출 없음). CLAUDE.md 정책과 정확히 일치.
- **클라이언트 번들 비대화 없음** — `exceljs`·`googleapis`는 `import "server-only"`, `html2canvas`는 lazy `await import()`, `recharts`는 리프 차트 컴포넌트에만.
- **인덱스 충실** — 58개 인덱스, 핫 필터/조인/날짜 경로 전부 복합 `(tenant_id, …)` 커버 + trgm GIN 11개. 누락 없음.
- `.in()` 414 위험은 대량 id 전부 `fetchInChunks` 경유, 나머지는 ≤50/enum 등 소량.
- `getCurrentUser`/`createClient` 둘 다 `cache()` 래핑(요청당 1회).

---

## 3. 코드 품질 / 구조

세 핵심 컨벤션 채점:

| 컨벤션 | 상태 | 근거 |
|---|---|---|
| props ≤ 10 | **우수** | 전 저장소 최악이 **9 props**(`feature-block.tsx`). god-form 후보도 3-5 props. 80-props 재발 없음. |
| AI는 `generateJSON()`만 | **클린** | `getAnthropic`/`getUpstage`/`new Anthropic`/`new OpenAI`가 `lib/ai/` 밖에 0건. |
| Server/Client 경계 | **통과** | `'use client'` 파일에 server-only import(postgres/drizzle/googleapis/service key) 0건. |
| 파일 ≤ 200줄 | **부분** | 67개 초과 — 대부분 정당(schema 단일소스·shadcn 프리미티브·데이터테이블), 일부만 분할 후보. |

### 🟠 Q1 (HIGH) — 급여 계산이 DB 레이어 인라인, 순수함수 아님, 테스트 0

`src/features/payroll/server/queries.ts:26-122` `calculateMonthlyPayroll` — 출근시수×시급+월기본, 반-시수 평균(L96-98)이 Supabase fetch와 뒤섞여 단위테스트 불가. 수동 경로 `total = base + hourly + bonus - deduction`도 `actions.ts:28`에 인라인. CLAUDE.md는 급여를 순수+Vitest 필수로 명시 — **payroll 테스트 없음**(확인됨). → 순수 `computePayroll(...)`/`aggregateClassHours(...)`를 `payroll/calc.ts`로 추출 + 테스트.

### 🟠 Q2 (HIGH) — 수강료 집계는 순수함수지만 테스트 없음

`src/features/billing/server/queries.ts:159` `summarizeInvoices()`는 올바르게 순수 추출됨 — 그러나 **`billing/*.test.ts` 부재**(확인됨). `paymentRate`/`totalBilled/Collected/Discount`(L160-172) 즉 핵심 수강료 산식. 이미 순수라 가장 값싸게 추가 가능한 고가치 테스트. → 완납/부분/0청구(0 나눗셈 가드)/할인 케이스.

### 🟡 Q3 / Q4 (MEDIUM)

- **Q3** 출석률 `(present/total)*100`이 5곳 중복: `attendance/queries.ts:341`, `classes/queries.ts:382`, `consultations/actions.ts:89`, `dashboard/queries.ts:78`, `students/queries.ts:376`. 각자 0-나눗셈 가드 재구현. → 순수 `attendanceRate(present,total)` 하나로 통일 + 단일 테스트. (대시보드 잔액 `amount_total - amount_paid - amount_discount`도 `dashboard/queries.ts:307`·`347` 중복.)
- **Q4** 큰 클라이언트 폼이 분할 후보: `recording-form.tsx`(457, MediaRecorder+업로드+복구 한 컴포넌트), `new-meeting-form.tsx`(453), 출석 `input-form.tsx`(344), `student-form.tsx`(281) 등. → 커스텀 훅(`useAudioRecorder`/`useRecordingRecovery`) 추출, 다이얼로그 분리. (`billing-table.tsx` 582줄은 이미 5개 하위 컴포넌트로 응집 — 양호.)

### 🟢 Q5 (LOW) — 커버리지 게이트·CI 미설정 → "70%+"는 희망사항

`vitest.config.ts`에 v8 커버리지 provider는 있으나 **`thresholds` 블록 없음**(확인됨). 기본 `test`(`vitest run`)는 커버리지로 막지 않고, **`.github/workflows` 부재**(확인됨)로 네 게이트(typecheck/lint/test/build) 중 무엇도 CI 강제가 없다. 테스트 11개 + 위 돈/계산 경로 미테스트를 감안하면 *계산 로직* 실 커버리지는 70% 미만. **현재 게이트는 수동 규율에만 의존.** → `coverage.thresholds.lines/functions: 70` 추가 + 네 게이트 도는 CI 워크플로 추가.

### ✅ 품질에서 잘 된 점 (확인됨)

- 부채 마커 거의 0 — TODO/FIXME/HACK **0건**, `@ts-ignore`/`@ts-expect-error` **0건**, 의미있는 `any` **0건**, `eslint-disable` 1건(정당·문서화). 이 규모 치곤 이례적.
- 페이지네이션 표준 일관 적용 — 13개 목록이 공용 `<Pagination>`, 6개 `getXPage` 헬퍼. 무한 `.map` 목록 없음.

---

## 검증 게이트 (typecheck / lint / test / build)

**이 샌드박스에서 실행 불가.** `node_modules`가 Windows에서 설치된 pnpm 가상 스토어라 Linux 마운트에서 심볼릭 링크가 풀리지 않음(`node_modules/vitest` → I/O error, `@vitest/utils` 해석 실패). git 이력·CLAUDE.md는 4게이트 그린을 주장하나, **위 Q5대로 이를 강제하는 CI·임계값이 없다.** 로컬(Windows)에서 `pnpm typecheck && pnpm lint && pnpm test && pnpm build`로 확인 권장. 본 리포트의 코드 근거는 전부 정적 읽기로 검증했다.

---

## 권장 처리 순서

1. **S1 (CRITICAL)** — `changeStaffRole`에 권한 게이트 + DB 기준 테넌트/역할 검증. 즉시.
2. **S3, S2 (HIGH 보안)** — 웹훅 시크릿 fail-closed → `users` 쓰기 정책 분리(S1의 DB 백업).
3. **P1, P2 (HIGH 성능)** — 대시보드 RPC+Suspense → 전건 카운트들을 `head:true`로(성능+절단 버그 동시 해결).
4. **Q1, Q2 (HIGH 품질)** — 급여/수강료 순수함수 추출 + 테스트, 그리고 커버리지 임계값·CI 게이트(Q5) 도입.
5. **나머지 MEDIUM** — 리텐션 캐싱(P3/P4), 출석률 통일(Q3), 폼 분할(Q4), 오디오 경로 검증(S4), AI 비용 가드(S5).

> 전반적으로 "구현 중 막힌 점"을 47개나 기록하며 학습한 흔적이 코드에 그대로 남은, 보기 드물게 규율 있는 프로젝트다. 위 항목은 그 높은 기준선과 *실제 상태* 사이의 좁은 간극을 메우는 작업이다.
