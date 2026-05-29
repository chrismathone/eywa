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

`src/lib/ai/anthropic.ts`의 `CLAUDE_MODELS` 객체에서 tier 선택:

| Tier | 모델 | 용도 |
|---|---|---|
| `fast` | `claude-haiku-4-5` | 짧은 분류, 태깅, 간단 요약. 가장 빠르고 저렴 — 가능하면 이걸로. |
| `balanced` | `claude-sonnet-4-6` | **현재 모든 AI 호출의 기본값**. 회의록 요약, 학생 케어, 등록상담 진단 등. |
| `reasoning` | `claude-opus-4-7` | **금지** (사용자가 명시적으로 요청한 경우만). UX 비용이 큼. |

대안:
- **Gemini 2.5 Flash** (`GEMINI_API_KEY` 등록됨): Haiku와 같은 fast tier 후보. 더 저렴할 수 있어 분류·태깅성 작업에 평가 가치 있음. 코드 통합은 미구현.

키 분리 (사용량 추적):
- `ANTHROPIC_API_KEY` → 등록상담(/enrollment) + 회의록(/meetings)
- `ANTHROPIC_API_KEY_CONSULTATIONS` → 학생 케어 인사이트(/students/[id])
- `GEMINI_API_KEY` → 향후 fast-tier 작업용 (현재 미사용)

---

## 데이터 모델 핵심 결정

- `enrollments`는 평면 테이블 + GiST EXCLUDE 제약 → 좀비 enrollment 클래스 자체가 사라짐
- 학생 자연키는 `(tenant_id, name_normalized, school, grade) WHERE status<>'withdrawn'` 부분 유니크 인덱스
- AI 분석 결과는 `print_payload jsonb` 스냅샷으로 동결 — 모델 변경에도 인쇄물 불변

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

**12개 메뉴 + ijw 패리티 + Admin 도구 + 랜딩 8섹션 + UI 폴리시 + super-admin Phase 1 완성.**
디자인 시안 (Daylight: forest green + 라이트 톤) 전면 적용.

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
- OS별 단축키 자동 분기 — `useIsMac()` (useSyncExternalStore 기반) → Mac이면 ⌘, 아니면 Ctrl. Windows 기본.
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
- `/` = **랜딩 페이지 8섹션** (Hero·Flow·LogoWall·Manifesto·Testimonials·Pricing·CTA·Footer)
- `/dashboard` = 대시보드 (예전 `/`에서 이동)
- `/login` = 로그인. 성공 시 `/dashboard` redirect
- `/admin/*` = academy master 전용 (duplicates/cleanup/integrations/sheets)
- `/super-admin/*` = **SaaS owner 전용 super_admin 레이어** (academy 권한과 직교)
- `(marketing)/` = 랜딩 그룹 (사이드바·헤더 없음, marketing nav 64h)
- `(shell)/` = 인증된 12개 메뉴 + admin (사이드바 232px + Topbar 64px)
- `(super-admin)/` = super_admin 그룹 (다크 사이드바 + gold accent + "Super Admin" 라벨)
- `(print)/enrollment/[id]/print/` = A4 인쇄

### 12개 메뉴 — 핵심 위젯 (ijw 패리티 적용 후)

| 메뉴 | 데이터 | 핵심 위젯 |
|---|---|---|
| 대시보드 (`/dashboard`) | dashboard 9개 쿼리 | 김수진 인사말 + KPI 4 + Timeline(1.55fr) + Announcements(1fr) + 7일 추세 |
| 시간표 (`/timetable`) | `class_schedules` + `enrollments` + `students` | **기본뷰(강사×교시) / 통합뷰(요일×교시) 토글** + 과목 chip + 학생 명단 |
| 출석부 (`/attendance`) | `attendance_records` | **학생 × 30일 매트릭스** + Stat 4 + 반 chip + 월 ◀▶ + 셀 클릭 입력 (`/attendance/[date]/[classId]`) |
| 수업목록 (`/classes`) | `classes` + schedules + enrollments | **테이블/카드 토글** + 과목·강사·요일 chip + 검색 + 메모/요일 컬럼 |
| 학생목록 (`/students`) | `students` + enrollments | Stat 4 + **검색 + 과목/상태 chip** + 학생별 수강 과목 다중 pill |
| 등록상담 (`/enrollment`) | `enrollment_consultations` + AI | **AI 배너 (forest gradient + sparkle)** + 4열 칸반 + 월/상담사 chip + 대시보드 (recharts) |
| 학생상담 (`/consultations`) | `student_consultations` | Stat 4 + **기간/카테고리/후속 chip + 검색** + Follow-up urgency 자동 |
| 퇴원관리 (`/withdrawals`) | `students.status='withdrawn'` | Stat 4 + 리스트(1.4fr) + 사유 분석 진행바(1fr) + **기간/사유 chip + 검색** + amber AI 인사이트 |
| 직원관리 (`/staff`) | `users` + classes/students 카운트 | Stat 5 + **역할/상태 chip + 검색** + 3col 카드 그리드 + Initial 8px |
| 수납관리 (`/billing`) | `invoices` | Stat 5 (할인 포함) + **월 ◀▶ + 검색 + 컬럼 정렬 ▼** + 할인/메모 컬럼 + 인라인 dialog + 일괄 처리 + 기한 경과 |
| 회의록 (`/meetings`) | `meeting_minutes` + AssemblyAI | Stat 3 + **기간/상태 chip + 검색** + 음성 + AI 요약 + LIVE pill |
| 도움말 (`/help`) | (정적) | Search hero(gradient) + 12 메뉴 가이드 + FAQ + 단축키 + 1:1 |

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
- **`Initial`** — 8px radius 정사각 (color 10% tint + 이니셜). **동그란 프사 절대 금지**.
- **`Pill`** — mono 11px uppercase, soft/solid + color (primary/gold/blue/rose/amber/danger/purple/neutral)
- **`SectionTitle`** — 14px 700 + action slot

### Botanical 아이콘 (22개)
- `src/components/icons/eywa-icons.tsx` — `<EyIcon name="tree" size={18} />` 단일 컴포넌트
- 이름: tree/leaf/pulse/branch/seed/sprout/wave/falling/roots/pollen/rings/spore/search/bell/arrowUp/arrowDown/arrowRight/play/check/plus/dot/sparkle
- 메뉴 매핑: `MENU_ICON[menuKey]` (대시보드=tree, 시간표=leaf, 출석부=pulse, 학생=seed, 등록상담=sprout, ...)
- AI 강조는 모든 곳에서 `sparkle + gold-soft` 일관

### AppShell
- **Sidebar 232px 고정** (bgSoft 배경, shadcn collapsible 제거)
- 5그룹: 홈 / 수업 / 학생 / 운영 / 지원 + 01~05 인덱스 (mono uppercase)
- 활성 메뉴: primary bg + white text + shadow-primary-glow
- 푸터: `김수진 / 원장 · chrismathone@gmail.com`
- **Topbar 64px**: breadcrumb (mono 11px primary) + 19px 800 페이지 제목 + 검색바 280px + 알림 + 사용자

### shadcn base-nova (Base UI) 유지 사항
- `render` prop (asChild 아님), `TooltipProvider delay` (delayDuration 아님)
- 일부 atom 함수형 컴포넌트 신규 작성, 나머지 shadcn 그대로 사용

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

---

## 마이그레이션 & 시드 흐름

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

## 검증 게이트 (commit 전)

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest unit
pnpm build       # next build (Turbopack)
```

네 단계 모두 그린이어야 push. Vercel은 push 후 자동 빌드.

## 두 master 계정 (현재 상태)

| 이메일 | 비밀번호 | 역할 | 용도 |
|---|---|---|---|
| chrismathone@gmail.com | mbplaza2* | master (지점장) | 인재원 지점장. super_admin 아님 |
| st2000423@gmail.com | qkrthtjs1234@ | master + super_admin | SaaS 총괄 (전체 지점 관리) |

둘 다 ijw-demo academy master지만 **super_admin은 st2000423만**. `display_name`은 김수진 / 석태선.
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
3. ✅ **랜딩 페이지 8섹션** — Hero/Flow/LogoWall/Manifesto/Testimonials/Pricing/CTA/Footer
4. **pgTAP RLS 테스트** — 두 테넌트 격리 자동 검증
5. **AI 분석 history 보존** — 현재는 UPDATE라 마지막 분석만 남음. 별도 테이블에 INSERT-only로 누적 + history viewer (옵션)
6. **Gemini Flash 통합** — fast-tier 작업이 생기면 비용 절감
7. **시드 확장** — 학생 30→90~248명 (페이지네이션·검색 가치 명확화). Phase 7에서 시드 구조만 잡고 데이터는 그대로 둠
8. **(장기) Firestore → Supabase 마이그레이션 스크립트** — 실제 운영 데이터 전환 시
