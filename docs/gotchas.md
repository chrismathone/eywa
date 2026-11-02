# aywa — 구현 중 막혔던 점들 (#1~#74 함정 사전, Tier 1)

> CLAUDE.md에서 분리된 **Tier 1 참조 문서**. 막혔을 때 검색. 트리거 한 줄은 CLAUDE.md 막힌 점 인덱스에, 상세·재현·원인은 여기.

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

### 12. 작은 화살표 아이콘이 한글 자모로 오인됨
구 Lucide 기반 KPI 카드의 12px 화살표가 작은 화면에서 한글 "ㄱ"/"ㄴ"과 흡사하게 보였음. "ㄱ +12 최근 7일" 식으로 읽힘.

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
> 기록용 — `scripts/seed.ts`·`pnpm db:seed`는 2026-09-19 영구 제거됐다(운영 DB wipe 위험). #14·#31·#32도 같은 시드의 기록이다.

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

mathlab의 `viewing_tenant` 쿠키 + Zustand 패턴은 매력적이지만 aywa의 RLS 강제를 회피해야 해서 Phase 2로 미룸.

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

**교훈**: auth가 필요한 계정은 반드시 `auth.admin.createUser`로 생성 (트리거가 public.users mirror). ~~데모 강사를 진짜 로그인·관리 가능하게 하려면 seed를 그 방식으로 전환해야 함 (후속).~~ → 폐기: 시드는 2026-09-19 영구 제거됐다.

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
- **⚠️ 정정(2026-07-04): dnd-kit 시간표 드래그도 합성으로 가능** — 옛 "dnd-kit 합성 한계로 자동 미검" 기록은
  캡처 stub 누락이 원인이었다. 레시피: ① `Element.prototype.{set,release}PointerCapture` 둘 다 no-op stub
  ② 드래그 소스는 **`[aria-roledescription="draggable"]`** 로 선택(cursor-grab 클래스는 DragScrollArea 팬 컨테이너도
  잡아 오선택) ③ PointerEvent 시퀀스: 소스에 `pointerdown`(buttons:1) → document에 `pointermove` +12px(활성화
  임계 5px 초과) → document에 `pointermove` 타겟 좌표 → document에 `pointerup`(buttons:0), 각 단계 60~150ms 대기.
  합반 반+요일 팝업(ClassPickPopover)을 이 방식으로 실검증(드롭→팝업→선택→큐잉 E2E).

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
- 🔴 **청크로 나눴다고 끝난 게 아니다 — 청크 *안에서* 또 잘린다** (2026-09-07 실사고, 원장 제보
  *"이 반은 왜 스케줄이 안나와?"*). 수업목록이 `fetchInChunks`로 100반씩 `class_schedules`를 읽었는데,
  이 표는 운영 이력을 함께 담아([[#88]]) 반 하나가 12행씩이라 **한 청크가 1,042행**을 요청했다 → 1,000행에서
  침묵 절단 → 꼬리에 걸린 반은 슬롯이 **한 행도 안 와서** 요일 칸이 `—`. 반 상세엔 화·금이 멀쩡히 떠 있어
  "화면마다 다른 사실"이 됐다. 고침 = **`fetchAllPagedInChunks`**(청크 × 페이징) + `.order("id")`.
- 🔑 **누가 잘리는지는 사람마다 다르다** — RLS(`tenant_id = auth_tenant_id()`)가 붙으면 실행 계획이 바뀌어
  버려지는 꼬리가 달라진다(같은 청크에서 service_role 5반 vs 로그인 세션 9반, 겹치는 건 2반뿐). 그래서
  ⚠️ **service_role 프로브로 "정상"을 확인하면 안 된다**([[#91]]과 같은 결) — 재현은 세션 조건으로.
- ⚠️ 청크 크기를 줄이는 건 답이 아니다 — 이력을 쌓는 표(`class_schedules`는 시간표 가져오기마다 행 분할)는
  계속 자라서 언젠가 다시 넘는다. 절단은 **에러가 없어** 다음 사람이 데이터 문제로 오진한다.
- 🔴 **집합을 돌려주는 RPC(`returns table`·`setof`)도 같은 한도에 잘린다**(2026-09-30, 원생상담 반 후보
  `consultation_class_candidates`) — 배열 인자로 수백 쌍을 한 번에 물으면 응답이 1,000행에서 끊기고, 잘린 꼬리의 상담은
  "그날 수강 반 없음 → 미매핑(자동)"으로 **저장까지 돼** 다시는 판정되지 않는다(엑셀 가져오기 수백 건). jsonb 한 값을 돌려주는
  집계 RPC는 무관하다. 고침 = 인자를 묶음(120쌍)으로 나누고, 응답이 한도에 닿으면 반으로 쪼개 다시 묻는다
  (`class-support.ts` `loadClassCandidatesRpc` · 가드 `class-support.test.ts`).

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

### 58. 권한 게이트는 tenant-aware 헬퍼만 — bare `canAccess`/`accessLevel` 직접호출 금지 (⚠️ 하면 안 됨)
역할/권한 override(owner "역할·권한")는 `getPermMatrix()`(=하드코딩 MENU_ACCESS + tenant override) 매트릭스로만
반영된다. **새 게이트는 반드시** 페이지=`requireAccess`, 라우트=`apiAccess`, 액션=`accessLevelTenant`/`canAccessTenant`,
UI=layout의 `permMatrix` prop을 쓴다. **`canAccess(role,menu)`/`accessLevel(role,menu)`을 매트릭스 인자 없이 직접
부르면 하드코딩 기본만 봐서 owner override를 무시**(write-only-orphan) — 금지. (2026-06-19 전수 감사: orphan 0건 — 깨지 말 것.
bare `canAccess`는 super-admin(권한 직교)·테스트에서만 정상.)

### 59. tenant_settings 직접 쓰기 금지 — owner 단일 진입점 + DB 트리거가 비-master를 막는다
`tenant_settings`(학원 설정·권한 override)는 `saveOwnerSection`(master 게이트)이 유일한 쓰기 경로다. 기능 코드에서
`tenant_settings`를 직접 INSERT/UPDATE하지 말 것 — **0038a 트리거가 `auth.uid()`가 비-master면 raise**(self-escalation
차단). service_role(admin)·직접 DB연결(`auth.uid()` null)만 통과한다. 즉 일반 RLS 클라이언트로 비-master가 쓰면 막힌다.
(읽기는 `getTenantSettings()`→`resolveSettings()` 단일 경로.)

### 60. 권한 폴백은 fail-open 고정 — fail-closed로 바꾸지 말 것 (⚠️ 복구불능 락아웃)
`getPermMatrix`가 `getTenantSettings` 실패 시 코드 기본(master=full)으로 폴백한다. **fail-closed(차단)로 바꾸면
설정 조회 장애 시 master까지 /owner에 못 들어가 override를 고칠 길이 없어진다**(복구불능). #59 트리거로 override가
항상 정당(master 설정)해져 일시 무효의 잔여 위험은 낮다. fail-open은 의도적·최종 결정(perm-matrix.ts 주석에 근거).

### 61. 클라가 import하는 공유 모듈에 `import "server-only"` 금지 — 런타임 상수 누출 빌드깨짐
순수 계산·공유 상수 모듈(`features/billing/{tuition-catalog,quote-calc,holidays-data}.ts`)은 **클라이언트 컴포넌트도
import**하므로 `server-only`를 넣으면 빌드가 깨진다. 특히 **런타임 값(상수/함수)을 server-only 모듈에서 클라로 import
하면** `'server-only' cannot be imported from a Client Component`로 폭발(예: `DISCOUNT_CATEGORY`를 server-only
`*-queries.ts`에서 클라 계산기로 import → 실패). **규약: 타입+런타임 상수+순수함수는 server-only 없는 공유 모듈에,
DB 쿼리만 `server/*-queries.ts`(server-only)에.** 클라는 서버 모듈에서 `import type`(타입만, 빌드시 소거)만 허용.

### 62. 병렬 세션 schema.ts/공유파일 충돌 — 통째 `git add` 금지, 내 hunk만 인덱스에 적용
여러 세션이 `schema.ts`(+ CLAUDE.md·README 등 공유파일)를 **동시에 편집**한다. 통째 `git add <file>`로 커밋하면
**남의 미커밋 변경을 내 커밋이 휩쓸어** 간다. 비대화형이라 `git add -p` 불가 → 충돌 시:
`git diff -- file | awk '내 hunk만 추출' | git apply --cached --recount`로 **내 hunk만 인덱스에 적용**(작업파일 불변 →
상대 WIP 보존). 커밋 후 반드시 `git diff <parent> <commit> -- file`로 **삭제(남의 코드 clobber) 0줄** 확인.
충돌이 없으면(diff가 내 변경만) 통째 add OK. 항상 `git commit -- <명시경로>`로 파일 단위 분리. (이번 세션 schema.ts에
tuition_catalog·tuition_quotes 추가 시 students 0036a와 같은 파일에서 충돌 → 이 방식으로 분리 커밋.)

### 63. 내 커밋 단독 검증 = 격리 워크트리 typecheck (작업트리 전체는 남의 WIP로 깨질 수 있음)
작업 트리 전체 `tsc`가 **다른 세션의 미커밋 WIP**(예: classes `page.tsx` prop 불일치)로 실패할 수 있다 — 내 변경과
무관. **내 커밋만 단독 검증**: `git worktree add --detach /d/tmp/x <commit>` → node_modules 정션 + `next-env.d.ts`
복사 → `./node_modules/.bin/tsc --noEmit`. ⚠️ **정리 순서 함정(Windows)**: 워크트리 제거 전 **정션을 먼저 `rmdir`로
끊어라**(`cmd //c "rmdir D:\tmp\x\node_modules"`) — 안 그러면 `git worktree remove`가 정션을 타고 들어가 **실제
node_modules를 지울 위험** + permission-denied. 또: 다른 세션이 내 커밋 위에 쌓아 push하면 **내 ff push가 "behind"로
거부돼도 이미 내 커밋이 origin에 올라간 정상 상태**일 수 있다(merge-base로 확인 후 종료).

### 64. 같은 탭 다중 창(복제) + 크로스 창/탭 저장 경고 — 창 id 인스턴스 모델·BroadcastChannel·publish 타이밍
사용자 요청으로 (A) **같은 탭을 여러 창으로**(듀얼) + (B) 같은 레코드를 다른 창/탭에서 저장하면 **경고 토스트**를 구현.
핵심 함정·규칙:
- **창 id 인스턴스 모델 (A)**: primary 창 id는 오늘과 동일(`route:students`)로 두고 **복제본만 `#n` 접미사**
  ([`windowId(kind,paramId,instance?)`](src/components/workspace/window-store.ts) + `isDuplicate`/`baseWindowId`/`instanceLabel`).
  영속 레이아웃·배경 매핑이 primary id에 묶여 있어 **primary를 절대 바꾸지 말 것**. `params.id`는 base 라우트(`students`,
  크기·아이콘 매핑)라 **`baseWindowId`(=`route:students`, kind 접두 포함)와 혼동 금지** — `duplicate()`는 `params`를
  통째 복제(`params.id` 보존)하고 화면은 **nav 현재 URL·live 제목**을 따른다(`win.params.href`는 최초 URL이라 드릴인 후
  복제 시 엉뚱한 화면). 진입점 2개: 타이틀바 "복제" 버튼(`duplicate`) + 탭/링크 **shift+클릭**(`openNewInstance`,
  사이드바·SubTab·WindowLink. ctrl/cmd/alt는 브라우저 기본 유지). 사이드바 관리자도구 아래 shift 안내 문구.
- **복제본은 window-only — 배경 가드는 store 레벨에서 (A)**: 타이틀바 버튼 숨김만으론 부족(드래그 훅·스포트라이트 스왑은
  FloatingWindow를 안 거침). `swapToBackground`는 `isDuplicate`면 no-op, `swapFocusedWithBackground`는 복제본이면
  `sendFocused=false`, `use-pointer-drag`/`background-drop-zone`은 `!isDuplicate(id)`로 칩 비활성. "라우트↔배경 1:1" 불변식 보존.
- **저장 경고는 레코드 스코프 + BroadcastChannel (B)**: 키를 라우트/탭이 아니라 **레코드**(`student:123`·`tenant-settings:profile`)로
  잡아 같은 레코드 편집창만 경고하고 무관한 "새 X" 폼끼린 오경고 안 함. [`record-channel.ts`](src/lib/realtime/record-channel.ts)가
  same-origin 모든 iframe·탭을 한 채널로 묶어 **다중 창 + 다중 브라우저 탭 동시 보호**. 토스트는 메시지 받은 그 문서가
  자기 Toaster(루트 레이아웃이 모든 iframe에 마운트)로 띄움 → "그 창 안에" 뜬다.
- **dirty는 onInput 아니라 FormData 스냅샷 (B)**: 반 시간표 토글·학원설정 add/remove는 **버튼→state→hidden input**이라
  `onInput` 미발생. 값 단일 출처인 `new FormData(form)`을 [`serializeForm`](src/lib/realtime/form-snapshot.ts)(정렬 tuple
  JSON, `$ACTION_*` 제외)으로 스냅샷해 비교. 마운트 시 baseline, 저장 후 재스냅샷.
- **⚠️ publish는 "성공 확정 후" — onSubmit(제출 전) 금지 (B)**: `onSubmit`은 서버 액션 실행 전이라 실패 저장도 경고하고
  상대가 저장 전 데이터를 다시 읽을 수 있다. 그래서 `updateStudent/Class/Staff`를 **`redirect()` 대신 `{ ok, redirectTo, nonce }`
  반환**으로 바꿨다(클라가 성공 확정 후 publish→`router.push`). `saveOwnerSection`도 `nonce` 추가(in-window). **effect는
  `state.ok`만 보면 안 됨** — 첫 성공 후 ok가 계속 true라 owner 2번째 저장이 누락 → **`state.nonce` 관찰 + 처리한 nonce를
  ref로 비교**해 매 성공 1회 발화.
- **server-only 금지 (B)**: `record-channel.ts`·`form-snapshot.ts`는 클라 컴포넌트/훅이 import → `server-only` 넣으면
  빌드 폭발([[#61]] 규칙). 둘 다 client 전용 순수 모듈로 유지.

### 65. 워크스페이스 창 rehydrate는 모듈 로드 시점 — effect에서 부르면 영속본이 파괴됨(새로고침 시 창 전멸)
사용자 제보: 플로팅 창을 열고 **새로고침하면 전부 사라지고 배경탭(헤더)만 남음**. localStorage의 `eywa-workspace` `windows`가 `{}`로
비워져 영속본까지 파괴됐다. 원인: [window-store.ts](src/components/workspace/window-store.ts)는 `persist({skipHydration:true})`라
수동 rehydrate가 필요한데, 이를 [workspace-canvas.tsx](src/components/workspace/workspace-canvas.tsx) **effect에서** 호출했다.
그런데 같은 컴포넌트의 **다른 effect**(`setBackground`/`setStage`)가 rehydrate effect보다 **먼저 `set`을 호출** → persist
미들웨어가 **빈 초기상태(`windows={}`)를 localStorage에 써서 영속 창을 파괴** → 그 뒤 rehydrate가 빈 걸 읽음(복원할 게 없음).
**해결**: rehydrate를 **모듈 로드 시점(클라이언트, 어떤 effect의 set보다 먼저)**으로 이동 — `if (typeof window !== "undefined")
void useWindowStore.persist.rehydrate();`(create 직후). 컴포넌트는 `hasHydrated()`면 즉시 `adoptOwner`, 아니면
`onFinishHydration(() => adoptOwner)`. SSR mismatch 없음(서버=window 없음→미실행, 캔버스도 isDesktop=false로 SSR null).
⚠️ **rehydrate를 다시 effect 안으로 옮기지 말 것**(재발). autoClose(새 X 폼) 창은 partialize에서 의도적 영속 제외(부활 방지).
검증: 창 심고 새로고침 → iframe 복원·localStorage 보존, window-store 테스트 12 passed. [[reference_window-store-rehydrate-module-level]].

### 66. 테이블 셀 배경/음영은 td에 — 내부 고정 크기 자식에 주면 셀을 못 채운다 (출석부 주말 음영)
사용자 제보: 출석부 매트릭스의 주말(토/일) 음영이 "셀 전체가 아니라" 일부에만 칠해졌다. 원인: 주말 배경을 셀(`<td>`)이
아니라 셀 안의 **고정 크기 자식**([attendance-cell.tsx](<src/app/(shell)/attendance/_components/attendance-cell.tsx>)의
`<button size-7>`=28px)에 줬다. 그런데 컬럼 실폭은 63px·행 높이 34px이라(이름/번호 칸 `py-2`로 행이 칩보다 큼) 28px 칩에만
칠한 음영이 셀 왼쪽·위아래로 띠를 남겨 "셀을 못 채운" 것처럼 보였다. 헤더(th)는 처음부터 셀 전체를 음영(`bg-bg-soft/70`)했는데
본문만 어긋났다. **해결**: 주말 음영을 **td(셀 전체)** 로 옮기고([page.tsx](<src/app/(shell)/attendance/page.tsx>) day `<td>`에
`${d.isWeekend ? "bg-bg-soft/40" : ""}` + `align-middle`), 칩은 `mx-auto`로 셀 중앙에. 라이브 검증: 주말 td 배경이 63×34 셀
전체·전 행 연속·칩 좌우 17px 대칭(중앙). **규칙: 칸(셀/행/열) 단위 배경·음영·hover는 컨테이너(td/tr)에 준다 — 셀보다 작은
고정 크기 내부 요소(칩·버튼)에 주면 셀을 못 채워 어긋난다.** (상태 칩처럼 "칸 안의 작은 표식"만 내부 요소 배경 OK.)

### 67. 항상 마운트된 다이얼로그 + 가드 없는 useActionState 성공 부수효과 = 재오픈 즉시닫힘("클릭 무반응")
다이얼로그가 부모에서 **항상 마운트(`<Dialog open={open}/>`, 내부 `if(!open) return null`)** 되면 닫혀도 언마운트되지 않아
`useActionState`의 성공 state(예: `state.enrollmentId`/`state.ok`)가 **stale하게 잔존**한다. 성공 처리 부수효과(close/refresh/navigate)에
"한 번만" 가드가 없으면 **재오픈 렌더에서 그 stale state가 다시 발화**해 다이얼로그가 열리자마자 닫히거나(=클릭 무반응) 중복 네비가 난다.
(enrollment-assign-dialog 실측: 첫 학생배정 성공 뒤 재오픈 불가 — 2026-06-30. 멀티에이전트 적대 검증 `hypothesisHolds:true,high`.)
- **규칙**: 성공 부수효과는 **`useEffect` + "처리완료" 가드**로 1회만 발화. 처리한 식별자를 ref에 기록(`handledRef.current !== state.id`)하는
  **id-키 가드**가 가장 견고 — 같은 stale state는 재오픈해도 다시 안 돌고, 진짜 새 결과(새 id)만 발화한다([class-form.tsx](<src/app/(shell)/classes/_components/class-form.tsx>) `handledNonce`·[speaker-editor.tsx](<src/app/(shell)/meetings/[id]/speaker-editor.tsx>) `handled` 패턴 참조).
  ⚠️ **boolean 가드를 "open될 때 리셋"하는 건 함정** — stale state를 재무장시켜 버그가 재발한다. **렌더 본문에서 `queueMicrotask`로 부수효과 내기**도 가드 없으면 매 렌더 실행이라 금지.
- **대안(안전한 기존 패턴)**: 부모를 **조건부 마운트(`{open && <Dialog/>}`)** 로 두면 닫힐 때 언마운트→`useActionState` 리셋이라 가드 없이도 안전(aywa
  다이얼로그 대다수가 이쪽 — 시험/청구서/지출/강의실). 새 다이얼로그는 둘 중 하나를 **명시적으로** 택할 것. always-mounted를 쓰면 id-키 가드가 필수다.

### 68. 스포트라이트(앨범)모드 = 다중 창 타일 + 배경 딤 + 배경 카드를 앨범 안으로 (2026-06-30)
사용자 요청 2건: ① 앨범모드에서 배경탭이 실제 배경과 어긋나고, 포커스 창이 배경을 덮어 **배경이 의미 없음** ② 공간이 여유로우니
**2~3개 창을 상단에 올려** 다중 스포트라이트. → 스포트라이트 모델을 "포커스 1개만 큼"에서 **`spotlightRaised: string[]`(최대 3, 상단 가로 타일)** 로 일반화.
- **store**([window-store.ts](src/components/workspace/window-store.ts)): `spotlightRaised` 상태 + `raiseToSpotlight`(스트립 카드→상단, 3 초과 시 FIFO)·`lowerFromSpotlight`(상단→스트립, 마지막 1개는 유지). enter/exit/backgroundToWindow가 세팅, **close/minimize가 raised에서 제거**(비면 스포트라이트 해제 — 상단 빈 화면 방지).
- **타일**([window-geometry.ts](src/components/workspace/window-geometry.ts) `spotlightTile(bounds,index,count)`): count<=1=중앙 큰 박스(spotlightTop), 2~3=상단 가로 균등 분할. [floating-window](src/components/workspace/floating-window.tsx)는 `raisedIndex>=0`이면 타일 rect·`spotlightRaised.length>1`이면 타이틀바 "내리기(↓)" 버튼.
- **배경 처리(2026-06-30 2차 수정)**: 스포트라이트 창(spotlightTop 60%)이 캔버스를 다 안 덮어 **배경(메인 프레임)이 뒤에
  비쳐** 산만했다(사용자 제보). → ① [workspace-canvas](src/components/workspace/workspace-canvas.tsx)에 `spotlight`면 **딤 막**(`bg-background/70 backdrop-blur`,
  창들 뒤 z-0, 빈 영역 클릭=나가기)으로 배경을 흐림. ② 헤더 배경탭은 숨기되([background-tabs](src/components/workspace/background-tabs.tsx) `spotlight→null`),
  **배경을 [spotlight-strip](src/components/workspace/spotlight-strip.tsx)의 카드("배경")로 가져온다** — 클릭=swapFocusedWithBackground(그 배경을 위로). "배경탭을 앨범 안으로".
  (⚠️ 1차엔 "배경 제거"였으나, 배경이 실제로 가려지지 않아 딤+스트립 카드로 방향 전환.)

### 69. 미저장 닫기 가드 — winId 경로추측 금지(iframe→부모 postMessage) + 컨트롤드-미러 폼은 커밋 후 읽기 + 워크스페이스 HMR은 stale
창 폼의 "작성 중 닫으면 확인"([useUnsavedGuard](src/components/workspace/use-unsaved-guard.ts))을 만들며 3함정:
- **① winId를 경로로 추측하면 드릴인에서 깨진다**: 처음엔 `windowIdForHref(pathname)`로 창 id를 계산해 BroadcastChannel로 dirty를
  보냈는데, 드릴인 창(목록→상세→수정)은 **iframe pathname이 바뀌어도 창 id는 그대로**(`route:students/123`)라 계산한 id(`students/123/edit`)와
  **불일치 → dirty가 엉뚱한/없는 창으로** 갔다. → **iframe이 `window.parent`로 postMessage**하고 부모(workspace-canvas)가 `event.source ===
  el.contentWindow`로 iframeRegistry를 뒤져 **프레임 단위로 정확한 창**을 찾는다(EmbedFocusSignal·shift+클릭 브리지와 동일). 창(iframe)이 아니면
  `window.parent===window`라 안 보냄(전체화면·미니셸 무해).
- **② 컨트롤드 입력이 hidden input에 값을 미러하는 폼은 즉시 `serializeForm`하면 stale**: 학원설정 section-form은 편집 위젯이 unnamed
  controlled이고 값은 `<input name="data" value={JSON.stringify(payload)}>`에만 실린다. 네이티브 `input` 리스너는 **React 커밋 전(버블 단계)**
  에 돌아 옛 `data`를 읽어 dirty=false로 놓쳤다(적대리뷰 HIGH — "타이핑 후 blur 없이 X" 흐름에서 무음 닫힘). → 리스너에서 **`setTimeout(0)`으로 미뤄
  커밋 후 비교**. uncontrolled(named defaultValue) 폼은 원래도 정상이라 무해. + 컨트롤드 값은 **hidden input에 미러돼 있어야** 스냅샷이 본다
  (등록상담 `subjectDetails`는 이미 hidden으로 미러 중 → 자동 커버).
- **③ 워크스페이스 모듈 HMR은 stale — 라이브 검증은 dev 재시작**: window-store(zustand+persist)·floating-window·workspace-canvas는 모듈
  전역 상태(iframeRegistry·store 인스턴스)라 **HMR이 부분 적용**돼, 한 세션에서 이 파일들을 여러 번 고치면 실행 코드가 어긋난다(실측: 새 dirty 배선이
  "동작 안 함"으로 보였다가 `.next` 삭제+dev 재시작 후 정상). ⚠️ 이 계열 변경의 라이브 검증은 **깨끗한 dev**에서. 검증: 재시작 후 owner 설정 창에서
  타이핑(blur 없이)→X→확인 오버레이 / 계속 작성=유지 / Esc=확인 취소 / 저장 안 함=닫힘, 전부 통과. + resume 편집 하단 sticky 바(취소/저장).

### 70. 미러 트리거가 metadata-only 갱신에서 role을 stale app_metadata로 덮음 → 임포트 강사 조용한 강등 (2026-07-01)
프로덕션(injaewon)에서 임포트 강사 계정 8명이 `auth.users.app_metadata.system_role='viewer'`인데 `public.users.system_role='teacher'`로 어긋나 있었다.
원인 = 미러 트리거 [`tg_sync_user_from_auth`](supabase/migrations/s1_season1.sql#0001a_rls_constraints_triggers.sql)의 `on conflict do update set system_role = excluded.system_role`.
`excluded.system_role`은 `coalesce(app_metadata.system_role, 'viewer')`라, **GoTrue가 어떤 `updateUserById`(비번리셋·ban·이메일변경)에서든 `raw_app_meta_data`를 재기록**하며
`update of raw_app_meta_data` 트리거를 발동 → app_metadata에 role이 없거나 stale하면 `public.users` role을 **덮어써** teacher→viewer로 강등(2026-07-01 이수연/kelly에 실발생, 이후 8명 추가 확인).
`getCurrentUser`/`auth_tenant_id()`는 `public.users`를 읽어 평소엔 무해하나, **트리거가 write 시 stale app_metadata를 재전파**하는 게 함정.
- **하드닝**([`0075a`](supabase/migrations/s1_season1.sql#0075a_mirror_trigger_role_hardening.sql), `create or replace`, dev=prod 적용): `v_role`(viewer 폴백)을 **`v_role_explicit`**(app_metadata에 role이 **명시적으로 있을 때만** non-null)로 분리.
  on conflict 브랜치를 **`system_role = coalesce(v_role_explicit, public.users.system_role)`** 로 바꿔, **명시 role이 있을 때만 채택하고 없으면 기존(권위) role 보존**. INSERT 경로(신규=viewer 폴백)는 불변.
- **회귀 0**: 모든 의도적 role 변경 경로(createStaff·super-admin createTenantWithMaster·changeStaffRole·changeUserRole)는 **app_metadata.system_role을 명시**로 넣어 v_role_explicit이 non-null → 옛 동작과 동일. metadata-only 갱신만 "강등 안 함"으로 바뀜.
- **데이터 교정**: 8명 auth app_metadata를 `updateUserById`로 `teacher`로 정정(provider/providers/tenant_id 병합 보존). ⚠️ **하드닝만으로는 이 8명이 안 고쳐진다** — 그들 app_metadata가 **명시적으로 'viewer'**라 다음 비번리셋에 또 강등 → 정정 필수.
- **검증**: 실 트리거를 **`BEGIN…ROLLBACK` 트랜잭션**(무영속)으로 10/10 통과(옛=강등 재현, 하드=보존·명시변경 추종·신규 viewer·정정 시나리오 안정). 정정 후 테넌트 auth-backed **drift=0**.
  ⚠️ **검증 함정**: postgres-js 템플릿에서 `${JSON.stringify(obj)}::jsonb` 바인딩은 트리거가 `->>'tenant_id'`를 null로 읽는 값을 만들어(클라 직렬화 quirk) 트리거가 조용히 no-op(early-return). **jsonb는 서버측 `jsonb_build_object`로** 만들 것(GoTrue 저장 방식과 동일). 프로덕션(GoTrue)은 무관.
- ⚠️ **범위 밖(별도 백로그)**: 8명 중 5명(Florence·Kristine·김주희·김태건)은 **케이스만 다른 이메일**(`florence@`↔`Florence@` 등)의 **auth 없는 viewer 중복 `public.users` 행**이 잔존(#31 id-mismatch 산물). role drift와 무관 — 병합/삭제는 별도 결정.
- ⚠️ **마이그 번호 정정(2026-07-03)**: 원래 `0063a`로 만들었으나 병렬 세션 `0063a_move_enrollments_attendance_days.sql`과 충돌 → main 병합 시 **`0075a`로 리넘버**(내용 동일, 멱등이라 재적용 안전).

### 71. border-collapse 표의 sticky 행/열 테두리는 셀 border·box-shadow가 아니라 `::before`/`::after` 실선으로
`border-collapse: collapse` 표에서 **`position: sticky` 셀의 테두리·표 외곽 border는 sticky 셀을 안 따라온다** — 병합모드에선
테두리 소유권이 개별 셀이 아니라 **표(table)**에 있어, 가로/세로 스크롤 시 sticky 셀만 남고 **테두리는 표와 함께 밀려 사라진다**
(시간표 기본뷰 좌측 sticky 교시열의 좌·우 테두리가 스크롤 시 증발 — 사용자 2회 제보). **`box-shadow`도 병합모드 `td`/`th`에선
불안정**(렌더 안 되거나 얇게 잘림 — 1차 시도 실패). **해결 = sticky 셀의 자식 가상요소 실선**: `::before`(왼쪽/위 프레임)·`::after`
(오른쪽/아래 divider)를 `absolute inset-y-0 left-0`(또는 `right-0`) `w-px bg-<color>`로. 가상요소는 셀의 자식이라 sticky 셀과
**함께 고정**되고 실 `<div>`/실선이라 렌더 안정적. ⚠️ **주의**: sticky 셀은 이미 positioned라 `after:absolute`의 기준이 됨 —
`relative`를 추가로 붙이면 `position`이 덮여 **sticky가 깨진다**(둘 다 position 값). 비-sticky 셀(스크롤로 안 밀리는)은 일반
`border`로 충분 → sticky 여부로 분기. 레퍼런스: [weekday-group-tables.tsx](<src/app/(shell)/timetable/_components/weekday-group-tables.tsx>)
`STICKY_EDGES`·`periodDivider`. (대안: 표를 `border-separate border-spacing-0`로 바꾸면 셀이 테두리를 소유해 sticky를 따라오나,
외곽/이중선 처리가 번거로워 미채택.)
- **대안(separate) 채택 사례(2026-07-06)**: 영어 강사뷰 [teacher-grid.tsx](<src/app/(shell)/timetable/_components/teacher-grid.tsx>)는
  **border-separate로 전환**해 해결 — 가상요소/span 우회는 collapse 테두리(경계 중앙 걸침)와 **렌더 경로가 달라 같은 가로줄이 1px
  어긋나 보이고**, collapse는 굵은 경계(2px) 절반을 행 높이에 얹어 고정 행높이 축(10분 격자)이 드리프트한다. **가로줄이 sticky
  셀과 본문을 하나의 연속선으로 가로질러야 하는 표(고정 시간축 격자)는 separate가 정석**(전 셀 실제 border 단일 경로, border-r만
  써서 이중선 회피). 기본뷰(weekday-group-tables)는 collapse+가상요소 유지(굵기 혼합 없는 균일 1px라 어긋남 비가시).

### 72. Realtime WS 무한 재연결(콘솔 폭주) = 배포 env의 anon 키 끝 개행이 apikey를 `%0A`로 오염 (2026-07-06)
프로덕션(Vercel) 브라우저 콘솔에 `wss://…/realtime/v1/websocket?apikey=…%0A&vsn=2.0.0` 연결 실패가 수백 줄 폭주.
원인 = **`NEXT_PUBLIC_SUPABASE_ANON_KEY` 값 끝에 붙은 개행(`\n`)** — Vercel env UI 붙여넣기 시 흔한 실수. Supabase
realtime-js가 그 키로 WS URL을 만들며 `\n`이 `%0A`로 인코딩돼 **서버가 apikey를 거부 → "transport failure" → 무한 재연결**.
실측(node): 깨끗한 키=`SUBSCRIBED` / 키+`\n`=`CHANNEL_ERROR: transport failure`(콘솔 증상과 정확히 일치).
- **폭주 증폭 = 채널 오프너**: Realtime 채널을 여는 곳 = [edit-presence.tsx](src/features/presence/edit-presence.tsx)(수정중
  presence, **창=iframe마다 마운트** → 각 창이 실패 WS를 각자 무한 재시도, **폴백 없음**) + 회의/등록상담 status-watcher
  (처리 중일 때만 + 5초 폴링 폴백이라 그나마 degrade). ⚠️ `BroadcastChannel`(window-busy·record-channel)은 Supabase 아님(브라우저 로컬, 무관).
- **로컬 아닌 배포 env 문제**: `.env.local`은 `cat -A`로 트레일링 `\n`/`^M` 없음(깨끗) → 브라우저 URL의 `%0A`는 **빌드에
  박힌 Vercel env 값**에서 옴(`NEXT_PUBLIC_*`는 빌드 시 문자열로 인라인).
- **코드 하드닝(재발 방지)**: 신규 [lib/supabase/env.ts](src/lib/supabase/env.ts)가 공개 URL·anon 키를 **`.trim()`으로 읽어
  단일 소스화** → client/server/proxy가 사용. admin.ts는 service_role 키도 인라인 trim. ⚠️ **`.trim()`은 런타임에 실행**되므로
  **이 코드만 재배포하면 Vercel env를 안 고쳐도 개행이 런타임에 제거돼 폭주 소멸**(env 정리는 위생상 병행 권장).
- **교훈**: 배포 UI 붙여넣기 env(특히 클라 번들에 박히는 `NEXT_PUBLIC_*`)는 트레일링 개행/공백이 섞이기 쉽다 → **키를
  URL/헤더/WS apikey로 넘기는 소비처는 `.trim()`으로 방어**. 증상이 "WS 무한 재연결 + `%0A`"면 이 케이스.

### 73. 새 Zod 스키마 필드가 저장 시 사라짐 = dev `.next`가 서버 모듈만 stale 컴파일(클라 fresh/서버 stale 분기) (2026-07-06)
과목 설정에 새 필드(`teacherViewPxPerMin`)를 추가하고 라이브 검증하니, **편집기 입력은 렌더되고 payload에도 실리는데 저장하면 DB에서 그 필드만 사라졌다**(액션은 `ok:true`). 원인 = Zod `z.object`는 기본이 **미지 키 strip**인데, **dev 서버의 `.next` 캐시가 필드 추가 이전에 컴파일된 서버측 스키마 모듈(settings-types)을 재사용**해, 그 서버 스키마엔 새 필드가 없어 저장 시 strip한 것. **클라 번들은 새로 컴파일(입력 렌더됨)됐는데 서버 모듈만 stale** = Turbopack 클라/서버 캐시 분기. `.env.local`처럼 파일은 최신인데도 발생(이전 dev 세션이 남긴 `.next` 캐시가 화근).
- **해소**: dev 서버 종료 → **`.next` 삭제** → 재시작(fresh 재컴파일). 그 후 저장이 새 필드를 정상 persist(실측: DB에 값 반영). **프로덕션은 매 배포가 fresh 빌드라 무관** — dev 전용 함정.
- **교훈**: **새 스키마/서버액션 필드를 추가한 뒤 라이브 검증**하는데 "저장은 성공인데 값만 안 남는다"면 코드 의심 전에 **`.next` 삭제+dev 재시작**부터. (서버액션 stale은 [[#35]]의 확장 — #35는 "새 액션 미등록", 여기선 "새 스키마 필드 strip".)

### 74. 반투명 `-soft` 토큰 셀을 sticky로 만들면 본문이 비친다 → 불투명 base + 색밴드 레이어 (2026-07-06)
시간표 기본뷰 헤더를 sticky-top으로 고정하니 스크롤 시 헤더에 본문(학생 이름)이 **비쳐 보였다**. 원인 = aywa `-soft` 색 토큰(`bg-blue-soft` 등)이 **12% 알파(반투명)**·`/50`은 6% → sticky 셀이 반투명이라 아래로 스크롤되는 본문이 그대로 비침(computed `rgba(31,107,168,0.12)`로 확인). 불투명한 `bg-bg-soft`(rgb, 알파 없음)·`bg-card`는 안 비친다.
- **수정**: 반투명 색을 셀에 직접 주지 말고 **불투명 base(`bg-card`) 셀 + 그 위에 반투명 색밴드를 얹는 자식 div**로 분리(색감 동일, 본문 비침 차단). 두 bg-color 클래스 스택(`bg-card bg-blue-soft`)은 Tailwind 출력 순서로 승자가 갈려 불안정 → 레이어(자식 div) 방식.
- **교훈**: **sticky/fixed로 스크롤 본문 위에 겹치는 셀은 배경이 불투명해야 한다.** aywa `-soft`(12%)·`/50` 토큰을 스크롤 컨테이너 안 sticky로 쓰면 비친다 → 불투명 base + 색 레이어. (겹치는 요소는 배경/차단을 명시 — body-portal 오버레이 `print:hidden` [[#68]]과 같은 결.)

### 75. localStorage를 lazy `useState` 초기값으로 읽으면 hydration 크래시(#418) — 페이지 전체 클릭 먹통 (2026-07-13)
직원 상세 '월간일정' 탭이 **프로덕션에서 열리지 않았다**(콘솔 `Minified React error #418` = "Text content did not match" hydration mismatch). 원인 = 뷰 선호(달력/목록)를 `useState(() => localStorage.getItem(...))`로 **첫 렌더에서 읽어**, 서버 HTML(항상 "grid")과 클라 첫 렌더가 어긋남 → React가 hydration 도중 죽으면서 **그 페이지의 모든 이벤트 핸들러가 안 붙어 클릭이 전부 먹통**(탭이 "안 들어가짐"). #51(dnd-kit SSR id)과 같은 계열 — SSR/CSR 첫 렌더 불일치.
- **수정**: `useSyncExternalStore(subscribe, () => localStorage값, () => "grid")` — **서버 스냅샷(3번째 인자)은 항상 "grid"**라 SSR HTML과 첫 클라 렌더가 일치하고, hydration 후 저장값으로 전환. localStorage 쓰기는 리스너로 리렌더 브로드캐스트.
- **교훈**: **`'use client'`라도 SSR로 HTML이 먼저 나가는 컴포넌트에서 localStorage/window/Date를 첫 렌더 값으로 쓰면 안 된다**(lazy useState 초기값 포함). 클라 전용 값은 `useSyncExternalStore`(서버 스냅샷 상수) 또는 mount 후 effect로. 증상이 "프로덕션에서 페이지 클릭 전부 무반응 + 콘솔 #418/#425"면 이 케이스. (dev에선 non-minified라 더 요란하고, 프로덕션 minified는 페이지만 죽어 진단이 어렵다.)

### 76. 외부 API 전건 스캔을 서버 컴포넌트 첫 페인트에서 await = 서버리스 타임아웃 → 화면 안 열림 (2026-07-13)
월간일정 미매핑 직원 진입 시, 이메일 자동매칭용으로 Notion 업무 DB **담당자를 전건 스캔**(4,000행+ = 순차 40+ 왕복)했는데, 이게 **서버 탭 컴포넌트가 첫 페인트에서 `await`** → Vercel 함수 타임아웃 → 탭이 안 열림([[#54]] silent 절단의 시간축 버전, B2/B7 위반). 실측: 3개월 한정 필터도 19페이지·65초.
- **수정**: ① 서버 첫 페인트는 **미매핑이면 즉시 반환**(Notion 호출 0) → 화면 먼저 뜸(B7). ② 무거운 담당자 스캔·자동매칭은 **클라가 화면 표시 후 서버 액션(`prepareNotionMapping`)으로 지연 호출**(effect+"확인 중…" 스켈레톤). ③ 스캔 자체도 **최신 마감순 정렬 + `maxPages` 상한(8p≈800행)**으로 bounded + `unstable_cache` 10분(B6). 활동 중 담당자는 최근 창에 반드시 등장하므로 커버리지 손실 없음.
- **교훈**: **외부 API(Notion/시트 등) 페이지네이션 전건 순회는 페이지 로드 경로에서 절대 await하지 말 것** — 사용자 트리거 액션으로 빼고, 스캔은 항상 `maxPages`로 bounded + 캐시. "전건 스캔"은 행 수만이 아니라 **왕복 수 × 지연**이 타임아웃을 만든다. (Supabase 전건은 [[#54]] `fetchAllPaged`; 외부 REST 전건은 이 규칙.)

### 77. "화면에서만 잠갔다" = 우회 폭 — 게이트는 **모든 표면**이 같은 함수를 통과해야 (2026-07-15, 이력서 적대검수)
직원 이력서는 열람에 **재인증(본인 비밀번호 재입력 → 이력서별 10분 서명쿠키)** 을 걸어 뒀는데, 그 게이트가
**뷰 페이지(RSC)에만** 있었다. 실제로 뚫린 구멍 2개:
- **클릭으로 도달**: 같은 행이 `/documents`(탐색기)에도 뜨는데 `deleteDocument`는 `canWriteTenant("documents")`만
  보고 `restricted`·`form_type`·열람토큰을 안 봤다 → **열람 못 하는 이력서를 삭제**할 수 있었다(재인증 0회).
- **서버액션 직접 호출**: `saveStaffResume`/`deleteStaffResume`는 역할만 봤다. 화면의 `canWrite = canView && canWriteRole`는
  **렌더용 계산일 뿐** — 액션 id는 클라 번들에 있으므로 폼 없이 호출 가능하다.
- **수정**: 공용 [`canViewResume`](src/features/staff/server/resume-access.ts)(작성 본인 ∪ 원장 ∪ 재인증 토큰) **단일 소스**를
  뷰·쓰기 액션(`requireResumeAccess`)·`deleteDocument`가 **함께** 통과. 탐색기는 폼 문서 삭제 버튼도 숨김(폼은 자기 화면에서 관리).
- **교훈**: **UI 조건은 게이트가 아니다.** 한 레코드가 여러 표면(전용 화면 + 목록 + 탐색기 + 서버액션 + 내보내기)에
  노출되면, "가장 느슨한 표면"이 그 레코드의 실제 권한이다. 새 표면을 만들 때 게이트를 **재구현하지 말고 공용 함수**를 태울 것.
  ⚠️ **아직 남은 구조적 갭(원장 결정 = 지금은 그대로 둠, 2026-07-15)**: 재인증은 **RSC에만** 있고 RLS(0072a)는
  `admin/manager/accountant`를 전부 통과시킨다. 이 앱은 브라우저 Supabase 클라이언트(공개 anon 키)를 쓰므로
  **재인증의 대상 집단이** devtools 한 줄(`.from('academy_documents').select('form_data')`)로 전 직원 주민번호·계좌·급여를
  읽을 수 있다. 즉 **앱 게이트가 RLS보다 엄격한 만큼이 그대로 우회 폭**이다(0072a 주석의 "거친 백스톱"은 쓰기 게이팅
  얘기라 이 갭은 인지 밖이었음). 닫으려면 restricted 행 SELECT를 `uploaded_by = auth.uid() or auth_system_role()='master'`로
  좁히고 재인증 열람분을 **서버 전용 경로**(admin client + 코드 tenant 스코프)로 내리는 설계 변경 필요.
  **현재 전제 = 학원 내부 단일 운영**(로그인 세션 정책과 같은 결) — **외부/공개 SaaS로 가면 반드시 먼저 닫을 것.**

### 78. 초안 자동저장(`useFormDraft`)은 **name 가진 칸을 전부** 캡처 — 민감 폼은 `exclude` 필수 (2026-07-15)
이력서 폼이 `exclude` 없이 훅을 불러 **주민번호·계좌·월급여·연봉이 IndexedDB에 평문·무기한** 저장됐다.
`cancel()`도 초안을 안 지웠고(성공 저장 경로에만 `clearDraft()`), `form-draft.ts`엔 TTL·purge·로그아웃 정리가 0건,
scope에 userId도 없었다 → **로그인조차 없이** DevTools › Application › IndexedDB에서 평문 조회 + 공용 PC의
다음 사용자에게 **DraftBanner가 앞사람 주민번호를 복구 제안**. 서버의 재인증·RLS·10분 TTL·httpOnly 쿠키가 전부 무의미.
- **수정**: `RESUME_DRAFT_EXCLUDE`/`REFUND_DRAFT_EXCLUDE` + `cancel()`에서 폐기 + **scope에 userId**(교차복구 차단)
  + **레거시 초안 자동 폐기**(use-form-draft 로드 시 exclude 대상 키가 담겨 있으면 복구 않고 즉시 clear — 배포 후 첫 열기에 잔재 정리).
- **교훈**: **민감 폼에 초안을 붙일 땐 `exclude`가 기본값**(선례 `staff-form.tsx` `exclude:["password"]`). "서버에서 잠갔다"가
  클라 영속 저장(IDB/localStorage)으로 새면 잠금은 0이다. **새 민감 칸을 추가하면 exclude 목록도 함께** 갱신할 것 —
  회귀 그물은 [resume-sheet.draft.test.tsx](<src/app/(shell)/staff/resumes/_components/resume-sheet.draft.test.tsx>)처럼
  **컴포넌트→훅→saveDraft 배선을 실제로 태워 저장값을 검사**해야 한다(`readFormValues(form, EXCLUDE)`를 테스트가 직접
  부르면 컴포넌트 배선을 안 태워 **exclude를 빼도 통과하는 가짜 테스트**가 된다 — 실제로 처음에 그렇게 짰다가 잡음).

### 79. `sr-only`(=position:absolute)가 스크롤 컨테이너를 빠져나가 **창 안에 스크롤바 2개** (2026-07-15)
원장: "이력서 적을 때 외부 스크롤이 쓸데없이 길게 되어있는데? 스크롤이 2개나 있네."
이력서 **근무요일 체크박스 7개**가 `className="sr-only"`인데, Tailwind `sr-only` = **`position:absolute`**다.
감싼 `<label>`이 static이고 셸 `main`(스크롤 컨테이너)도 `relative`가 아니라서, 이 input들의 **컨테이닝 블록이
문서(ICB)** 가 됐다 → `main`의 `overflow:auto` **클리핑을 빠져나가** 정적 위치(스크롤 안쪽 깊은 y)에 눌러앉고,
**문서 높이**를 그만큼 늘려 `main` 스크롤바 옆에 **문서 스크롤바가 하나 더** 생겼다.
- **실측**(창 iframe): `html 606/1255` · `body 606/606` · `main 606/1544` → 범인 = `absolute INPUT.sr-only bot:1255` ×7
  (= html.scrollHeight와 정확히 일치). 라벨에 `position:relative`를 주자 **`html 606/606`, 문서 스크롤 소멸**.
- **수정**: sr-only를 감싼 라벨/스팬에 **`relative`**([resume-sheet.tsx](<src/app/(shell)/staff/resumes/_components/resume-sheet.tsx>)).
- **교훈**: **`sr-only`는 시각적으로만 숨기지 레이아웃에서 사라지지 않는다 — absolute라서 positioned 조상이 없으면
  스크롤 컨테이너를 뚫고 나가 문서를 늘린다.** `sr-only` 요소(특히 스크롤 영역 깊은 곳의 것)는 **항상 positioned
  부모 안에** 둘 것. `fixed` 조상이 있으면(예: 다이얼로그 `fixed inset-0` — documents 드롭존) 컨테이닝 블록이 잡혀 안전.
- **진단법**: `body`는 정상인데 `html.scrollHeight`만 크면 = **컨테이닝 블록이 ICB인 absolute가 클리핑을 탈출**한 것.
  ⚠️ 스크롤 컨테이너를 `overflow:auto|scroll`로만 찾는 조회는 **문서 스크롤바를 못 잡는다**(html은 `overflow:visible`).
  반드시 `document.scrollingElement.scrollHeight > clientHeight`를 따로 볼 것.
- **재발(2026-07-16, 운영실 대시보드)**: AI 운영실 개편(`6962b14`)이 슬림 추세 스파크라인 `p.sr-only`([slim-trend.tsx](<src/app/(shell)/dashboard/_components/slim-trend.tsx>))·브리핑 갱신 안내 `span.sr-only`([briefing-auto-refresh.tsx](<src/app/(shell)/dashboard/_components/briefing-auto-refresh.tsx>))를 **static 부모**에 넣어 재발(실측: 뷰포트 674인데 `html.scrollHeight` 1294 = 아래 620px 유령 스크롤 영역). **감싼 부모에 `relative`**로 해소.
  ⚠️ **덮기(마스킹) 금지 — 이번 커밋은 근본원인 대신 전역 `html:has([data-aywa-shell]) { overflow:hidden }`(globals.css)로 스크롤바만 가렸다.** `overflow:hidden`은 스크롤바·사용자 조작만 막고 **프로그램적 스크롤은 허용**(`scrollTop=200` 실제로 먹힘) → 문서는 여전히 620px 넘쳐 있고, `scrollIntoView`/포커스 이동이 셸을 밀면 **스크롤바가 없어 새로고침 외 복구 불가**. 이 전역 잠금은 대시보드 커밋에서 처음 생긴 것(직전 커밋엔 없음)이라 **제거 = 안정적 이전 상태 복귀** + sr-only 근본수정으로 마무리.

- **재발(2026-10-12, 강사 영상 제출 현황)**: 풀셸·이전 화면 유지에는 `main.relative`가 있었지만 **강사·학생 미니셸과 일반 창의 본문에는 누락**되어 `caption.sr-only`가 문서 높이를 늘렸다. 두 본문에도 `relative` 적용. 실제 CSS로 Chromium 재현 시 900px 화면의 문서 높이 **2813 → 900px**(일반 창 **2729 → 900px**). `node tests/browser/shell-scroll.mjs`로 공통 셸 6종 × 긴 표/스크롤 표/입력 폼 × 화면 크기 3종을 검증한다. 본문·표 스크롤과 마지막 항목 포커스는 유지하고, 문서 높이 및 프로그램적 문서 스크롤까지 검사한다.

### 80. Anthropic **Claude 5 계열은 `temperature` 파라미터가 deprecated** — 보내면 400, 폴백 경로 전멸 (2026-07-17)
운영실 비서에서 Solar 실패 → Claude(sonnet-5) 폴백이 `temperature: 0.2` 때문에
**400 `{"type":"invalid_request_error","message":"\`temperature\` is deprecated for this model."}`** 로 죽고,
그 영문 JSON 원문이 패널에 그대로 노출됐다(ai_usage_logs 실측 + 실 API 재현: sonnet-5 = temperature 포함 400/제거 200,
**haiku-4-5는 temperature 수용**(200) — 모델별로 다르다).
- **수정**: ① 비서 Anthropic 루프([loop.ts](<src/features/assistant/server/loop.ts>))에서 temperature 제거(금지 주석).
  ② `generateJSON`([generate.ts](src/lib/ai/generate.ts))은 temperature 지정 호출(멘트 0.3 등)이 거부 모델을 만나면
  `isTemperatureDeprecatedError`로 판별해 **파라미터만 떼고 같은 모델로 1회 재시도**(자가 회복 — 수용 모델에선 튜닝 유지).
  ③ 사용자향 에러는 한글만 통과([actions.ts](src/features/assistant/server/actions.ts) — raw 원문 UI 노출 금지 규칙).
- **교훈**: **새 Anthropic 모델에 sampling 파라미터(temperature 등)를 보낼 땐 deprecated 여부를 전제하지 말 것** —
  Anthropic 직접 호출을 새로 만들면 temperature를 넣지 말거나 generateJSON 경유로. 에러 문구가 model-specific이라
  모델 교체(레지스트리 갱신) 때마다 재발 가능 — 재시도 가드가 있는 generateJSON 경로가 안전하다.

### 81. `"use client"` 모듈의 **비컴포넌트 export(문자열 상수)를 서버가 import하면 런타임 undefined** — 쿠키 기본값 침묵 사망 (2026-07-19)
시간표 표시 선호 쿠키 이름(`EMPTY_DAYS_COOKIE`/`EMPTY_PERIODS_COOKIE`)을 클라 컴포넌트 파일
([prefs-sync.tsx](<src/app/(shell)/timetable/_components/prefs-sync.tsx>))에서 export하고 서버 페이지가 import했더니,
클라이언트 모듈의 모든 export가 서버 그래프에선 **클라이언트 참조 프록시**가 되어 문자열이 **런타임 undefined**로
평가됐다(실측: 서버 로그 `JSON.stringify(EMPTY_PERIODS_COOKIE)` → `undefined`). 결과 `cookieStore.get(undefined)`가
항상 미적중 → **쿠키 기본값(기기 기억) 경로가 조용히 죽고** URL 파라미터 경로만 동작. 쿠키는 요청에 실려 오고
(`getAll()`엔 이름·값 정상) 클라 쪽 쓰기도 정상이라, 증상이 "가끔 초기화되는 것 같다" 수준으로만 보인다.
- **⚠️ 타입체크·lint·빌드 전부 통과하는 침묵 버그** — TS는 타입만 보고, 번들러는 프록시를 만들 뿐 에러가 없다.
- **수정**: 상수를 지시어 없는 일반 모듈([pref-cookies.ts](src/features/timetable/lib/pref-cookies.ts))로 분리 —
  클라(쓰기)·서버(읽기)가 둘 다 거기서 import. 클라 파일엔 "여기서 재-export 금지" 주석.
- **규칙**: **서버와 클라가 함께 쓰는 상수(쿠키/스토리지 키, 매직 문자열)는 절대 "use client" 파일에 두지 말 것.**
  진단법: 서버에서 `JSON.stringify(그_상수)` 로그가 `undefined`면 이 병.

---

## #81 node_modules 정션은 Turbopack dev에서 panic — 워크트리 dev 서버는 실제 pnpm install (2026-07-19)

- **증상**: 격리 워크트리에 `mklink /J node_modules → 메인트리`로 정션을 걸고 `next dev`(Turbopack)를 띄우면
  `FATAL: Symlink [project]/node_modules is invalid, it points out of the filesystem root` panic으로 서버가 즉사.
  preview 프로세스 레지스트리에도 안 잡혀 "포트만 안 열리는" 침묵 실패처럼 보인다.
- **원인**: Turbopack이 프로젝트 루트(락파일 기준) 밖을 가리키는 심링크/정션을 파일시스템 루트 위반으로 거부.
- **결론**: **정션은 typecheck·lint까지만 유효.** 워크트리에서 dev 서버를 띄우려면 정션을 떼고(`cmd /c rmdir` — 링크만)
  `pnpm install`로 실제 설치(스토어 하드링크라 ~30초). launch.json에 `pnpm -C <워크트리> dev` 항목을 추가해 쓴다.

---

## #83 React 19는 액션 폼을 제출할 때마다 자동 리셋 — 컨트롤드 입력이 "저장했는데 옛 값"으로 굳는다 (2026-07-21)

- **증상**: /owner 보고서 설정에서 '사진/파일 첨부'를 켜고 **저장**을 누르면 "저장됨"이 뜨는데 **체크는 다시 꺼진
  상태**로 보인다. 새로고침하면 켜져 있다(= DB엔 제대로 저장됨). 원장 제보: "저장이 한박자 늦게 되는지?"
- **원인**: `<form action={서버액션}>`을 제출하면 react-dom의 `startHostTransition`이 **액션 실행 직전에
  `requestFormReset(formFiber)`을 무조건 호출**한다(react-dom 19.2.4 소스 확인). 커밋 시 `form.reset()`이 돌아
  모든 입력이 **마운트 시점 default**로 되돌아간다. 컨트롤드 체크박스는 그 순간 `checked` 프로퍼티가
  `defaultChecked`로 밀리는데, **React는 자기 prop(state)이 안 바뀌었으니 DOM을 다시 쓰지 않는다** →
  DOM과 state가 갈라진 채 영영 안 맞는다(리마운트/새로고침 전까지).
  - 실측: 체크박스를 끄면 `checked=false / defaultChecked=true`, `form.reset()` 후 `checked=true`로 복귀,
    이후 무관한 필드를 바꿔 재렌더해도 `checked=true` 유지(React가 안 고침).
- **⚠️ 더 위험한 2차 증상**: payload를 담은 **hidden input도 함께 리셋**된다. 저장 직후 아무것도 안 고치고
  **저장을 한 번 더 누르면 마운트 시점 payload가 제출돼 직전 저장이 되돌아간다**(조용한 데이터 손실).
- **수정**: 네이티브 액션 제출을 쓰지 않는다. 폼은 `onSubmit`으로 받아 `preventDefault()` 하고, payload를 그
  자리에서 FormData로 만들어 `startTransition(() => formAction(fd))`로 **직접 디스패치**
  ([section-form.tsx](src/app/(shell)/owner/_components/section-form.tsx)). 리셋이 안 생기고 항상 최신 state가 나간다.
  Enter 저장도 그대로 살아 있다(폼의 submit 이벤트는 여전히 발생).
- **규칙**: **제출 후에도 화면에 남는 폼**(설정 화면처럼 저장하고 계속 편집하는 표면)은 `action={formAction}`을
  쓰지 말 것. 제출 후 닫히거나 이동하는 다이얼로그는 리셋이 안 보이므로 그대로 둬도 된다.

### #83 후속 — 전수 스캔 결과와 "고치면 안 되는 폼" (2026-07-21)

앱 전체 `action={...}` 폼 **111개**를 스캔해 세 부류로 나눴다. 판정 기준은 **"제출 후에도 화면에 남는가"** +
**"입력이 컨트롤드(또는 payload를 hidden으로 나르는가)"**.

- **① 편집 폼(제출 후 남음) = 고침(7개)**: 출석 입력·성적 일괄입력·직원 근무일정·회의 화자편집·퇴원 사유·
  수강료 계산기·급여 입력. 공통 특징은 **React state를 hidden input으로 나른다**는 것 —
  리셋되면 다음 저장에 마운트 시점 값이 섞여 나가 **직전 저장이 되돌아갈 수 있다**(출석부가 특히 위험:
  저장→몇 명 더 입력→저장이 일상 패턴).
- **② 추가(create) 폼 = 손대지 않음**: 강의실 추가·팝업 추가·회의 메모 추가 등. 여기선 자동 리셋이
  **"입력칸 비우기"라 의도된 동작** — 없애면 저장 후에도 이전 입력이 남는 퇴행이 된다.
- **③ 확인/삭제 버튼 폼, 제출 후 닫히는 다이얼로그 = 무해**: 리셋이 화면에 보이지 않는다(대다수).
- 헬퍼 [`submitAction`](src/components/forms/submit-action.ts) — 네이티브 제출과 **동일한 FormData**
  (누른 버튼 name/value 포함)를 만들어 액션에 넘긴다. `<form onSubmit={(e) => submitAction(e, formAction)}>`.
  ⚠️ 앱에 `formAction={}`(버튼별 액션 오버라이드)은 0건이라 이 치환이 안전하다 — 생기면 재검토.

## #84 "정렬 편향 × 상위 N 자르기" = 카테고리 통째 실종 (2026-07-21)

- **증상**: 출석부 반 미선택 허브의 "바로 열기"가 항상 **영어반만** 보여줬다. 수학반 65개는 필터를 안 걸면
  단 하나도 뜨지 않았고, 데이터가 바뀌어도 계속 그랬다(수학 담당자에겐 그 패널이 영구히 무용).
- **원인**: 반 이름 정렬(`.order("class_name")`)에서 **로마자가 한글보다 앞선다.** 영어반은 로마자 코드(DP5·JP1·KW1),
  수학반은 한글 이름(고등M·개별)이라 정렬 상위 43개가 통째로 영어반 → `slice(0, 8)`은 8/8 영어반. 첫 수학반은 17번째.
  즉 **자르기 자체는 죄가 없고, 정렬축과 카테고리가 상관돼 있을 때 자르면 한 카테고리가 0이 된다.**
- **함정인 이유**: 에러도 경고도 없고, 목록은 "정상적으로 8개"를 보여준다. 그 8개가 항상 같은 카테고리라는 건
  데이터 분포를 실제로 세보기 전엔 안 보인다. 페이지네이션이 있는 목록과 달리 **상위 N 미리보기는 나머지에 도달할
  경로가 없어** 은폐가 영구적이다.
- ⚠️ **콜레이션이 뒤집힌다**: Postgres 바이너리 정렬은 로마자→한글, **ICU `localeCompare(_, "ko")`는 한글→로마자**로
  정반대다. 같은 파일 안에서 한쪽은 DB 정렬·다른 쪽은 JS 정렬이면 두 화면이 **반대 카테고리를 독점**한다
  (`classes/server/queries.ts`의 `getClassesList`(로마자 독점) vs `getClassesPage`(한글 독점)가 실제 사례).
- **처방**: 목록을 **상위 N으로 미리보기할 땐 자르는 축을 카테고리별로 옮긴다** — 전체에서 N개가 아니라
  카테고리마다 N/k개. 레퍼런스 = [`quick-open.ts`](../src/features/attendance/quick-open.ts)
  (`clamp(floor(예산/그룹수), 2, 6)` + "어떤 그룹도 0이 되지 않는다"를 Vitest로 고정).
- ⚠️⚠️ **고칠 때 같은 함정을 버킷 안에서 재현하지 말 것(실제로 밟음).** 위 처방을 넣으면서 "DB 정렬을 믿지 말자"고
  버킷 **안**을 `localeCompare(_, "ko")`로 재정렬했더니, 영어 과목(한글 이름 27 + 로마자 코드 16 혼재)에서
  상위 6개가 한글 반에 독점돼 **로마자 반 16개가 전멸**했다 — 그것도 옛 화면이 유일하게 보여주던 반이라 회귀까지 됐다.
  **카테고리 편향은 버킷팅으로만 푼다. 버킷 안에서는 순서를 건드리지 마라** — 이름 정렬은 어떤 콜레이션이든
  섞인 문자 체계 중 한쪽을 굶기므로, 재정렬은 "누가 굶을지"만 바꿀 뿐 문제를 못 없앤다.
- **점검 질문(새 `.slice(0, N)`/`limit N` 미리보기를 쓸 때)**: ① 정렬 키가 카테고리와 상관돼 있나?
  ② 상위 N의 카테고리 분포를 **실데이터로 세봤나**? ③ 잘린 나머지에 도달할 경로가 실제로 있나(있다고 적어만 둔 게 아니라)?
- **같은 실패의 다른 표면(2026-07-21 스윕, 미수정)**: AI 비서 `search_classes`(상위 25 = 영어 22:수학 3, 게다가 툴
  스키마에 과목 인자가 없고 수학반 이름에 '수학'이 없어 도달 불가) · 반 배정 다이얼로그와 반 드롭다운의
  `SearchableSelect` 기본 `cap=50`(훑어보면 영어만) · 대시보드 '어제 미기록' 미리보기 2개(항상 한글=수학반).

## #85 배포가 "초록색 success"인데 실제로는 안 나감 — `ignoreCommand`는 **tip 커밋 1개만** 본다 (2026-07-27)

원장 제보 "배포가 안 되었는데". 그날 main에 push한 **3커밋 전부 미배포**였는데 GitHub 커밋 상태는
전부 **초록색 `success`**였다. 설명란을 열어야만 진실이 보인다 — `Canceled by Ignored Build Step`.
**초록색을 배포 성공으로 읽으면 안 된다**는 게 이 항목의 핵심이다(스킵도 초록색이다).

- **메커니즘**: `vercel.json`의 `ignoreCommand`가 `git diff --quiet HEAD^ HEAD -- <제외경로>` 였다.
  Vercel은 **push 범위가 아니라 tip 커밋 하나만** 평가한다(exit 0=skip / 1=build).
- **왜 항상 터지나(워크트리 정책과 정면충돌)**: CLAUDE.md 정책상 push 직전 `git merge origin/main`을 하므로
  **tip이 병합커밋**이 된다. 병합커밋에서 `HEAD^`=제1부모=**내 마지막 커밋**이라, diff에는 "머지가 상대편에서
  가져온 것"만 잡힌다. 내 실제 src 변경은 `HEAD^` **쪽에 있어** 애초에 diff 대상이 아니다.
  그날 origin/main이 가져온 건 빈 chore 커밋 3개 → **diff 0 → skip**. 즉 **머지하고 push하면 항상 skip**이었다.
- **수정**: 병합커밋(`HEAD^2` 존재)이면 무조건 빌드.
  `git rev-parse -q --verify HEAD^2 >/dev/null && exit 1 || git diff --quiet HEAD^ HEAD -- <제외경로>`
  (docs/scripts 단독 커밋 skip은 유지 — 빌드가 비용의 64%라 그 절감은 살려야 한다.)
- ⚠️ **남은 구조적 함정(미해결)**: 여러 커밋을 **한 번에 push**할 때 **tip이 docs/scripts-only면 그 앞의 src
  커밋까지 통째로 skip**된다. Vercel은 "직전 배포 sha"를 env로 주지 않아 push 범위를 알 수 없다.
  → **뭉쳐 push할 땐 docs 커밋을 tip에 두지 말 것**(`docs/perf` 문서화 커밋을 마지막에 얹는 습관이 특히 위험).
  이건 "main 푸시를 뭉쳐라"(빌드 비용 절감)와 정면으로 부딪히는 지점이라 의식적으로 순서를 잡아야 한다.
- **점검 명령(초록색 대신 이걸로)**:
  `gh api repos/<owner>/eywa/commits/$(git rev-parse HEAD)/status --jq '.statuses[].description'`
  → `Canceled by Ignored Build Step`이면 **안 나간 것**. `Deployment has completed`여야 실제 배포다.
- ⚠️ 배포 상태 조회한다고 워크트리에서 `npx vercel ls`를 돌리지 말 것 — **폴더명으로 새 프로젝트를 자동 생성·링크**하고
  `.vercel/`을 만든다(실제로 `eywa-ai-assistant-review-fb9a08` 빈 프로젝트가 생겼다). 조회는 위 `gh api`로.

## #86 창 시스템 앱에서 `router.push`는 **눈에 안 보인다** — 배경 프레임이 창에 덮여 있다 (2026-07-27)

**증상**: 벨 알림을 눌렀는데 "아무런 출력이 없다"(원장 제보). 오류도 없고, 읽음 처리도 되고, 라우트도 실제로 바뀐다.
그런데 화면은 그대로다.

- **원인**: aywa 데스크톱 풀셸은 **메뉴 = 플로팅 창(iframe)** 이라, 사용자가 일하는 동안 **화면이 창으로 덮여
  있는 게 정상 상태**다. 그 상태에서 `router.push("/students")`는 창 **뒤의 배경 `<main>`** 만 바꾼다 →
  보이는 변화 0. 개발자 화면(창 0개)에선 멀쩡히 동작해 **재현이 안 되는** 유형의 버그다.
- **규칙**: 앱 안에서 **프로그램적으로 이동**시키는 코드는 `router.push`가 아니라
  [WindowLink](../src/components/workspace/window-link.tsx)와 **같은 경로**를 쓴다 —
  `windowIdForHref(href)` → `useWindowStore.getState().open("route", { id, title, href })`.
  가드도 같게: `isDesktop && workspaceEnabled && isTopFrame()`일 때만 창, 아니면 `router.push` 폴백
  (강사 미니셸·모바일·임베드엔 캔버스가 없다). 외부 절대 URL은 `router.push`가 아예 안 먹으므로 별도 처리.
- **점검**: `grep -rn "router.push" src/` 중 **최상위 프레임에서 도는 UI**(벨·팰릿·토스트 액션·전역 단축키)가
  있으면 의심. 페이지 **안**의 이동(창 내부 드릴인)은 그 창 문서 안이라 정상.
- **함께 나온 규칙(알림 설계)**: **본문이 N명을 말하는데 `link`가 1개면 그 link는 반드시 거짓말이 된다.**
  진도 이상 알림이 3명 묶음 + `link:"/students"`(전체 목록)라 도착해도 정보가 0이었다 → 수신 단위를
  **학생 1명 = 알림 1건**으로 쪼개고 `/students/{id}?tab=progress`로 직행. 묶고 싶으면 **그 N명만 보여주는
  화면을 먼저** 만들어야 한다.
- **착지 화면도 같이 볼 것**: 링크가 맞아도 도착지가 "빨간 배지 하나"면 사용자는 여전히 아무것도 모른다.
  알림이 행동을 요구하면 도착지에 **언제·무엇이·얼마나**가 있어야 한다(진도 탭 이상 카드 = 날짜 + 위치
  변화 + 건너뛴 차시).

---

## #87 `overflow-x: scroll`은 **넘치지 않아도** 스크롤바를 그린다 — "스크롤할 게 없는데 스크롤바가 있다" (2026-07-30)

**증상**: 통합뷰 표 아래에 가로 스크롤바가 있는데 **thumb가 트랙을 꽉 채워** 아무리 끌어도 안 움직인다
(원장 제보 *"스크롤이 없는데도 스크롤이 있네"*). 섹션마다 하나씩 생겨 화면이 지저분해진다.

- **원인**: `.scroll-x-always`가 `overflow-x: scroll`이었다. `scroll`은 **넘침 여부와 무관하게 트랙을 예약**한다
  (`auto`만 넘칠 때 그린다). 이 클래스는 "시간표는 **항상** 넓다"는 전제로 도입됐는데, 통합뷰 섹션은
  `w-max max-w-full`이라 **반이 적거나 창이 넓으면 실제로 안 넘친다** → 전제가 그때만 틀렸다.
- **실측(같은 페이지에서 대조, 결정적)**:
  · 수리 전(`scroll`) = `scrollWidth-clientWidth = 0`인데 `offsetHeight-clientHeight = 10` → **가짜 바**
  · 수리 후(`auto`) = 넘침 0 → 예약 0(바 없음) / 일부러 좁히면 넘침 1418 → 예약 10(바 그대로)
  즉 넓은 표에서 바가 사라지는 회귀는 없다.
- **규칙**: 스크롤바를 "항상 보이게" 하려고 `overflow: scroll`을 쓰지 말 것. **넘침은 브라우저가 판정**하게
  두고(`auto`) 굵기·색만 손댄다. "이 컨테이너는 항상 넘친다"는 전제는 창 크기·데이터 양이 바뀌면 깨진다.
- **진단법**: `offsetHeight - clientHeight`(가로바) / `offsetWidth - clientWidth`(세로바)가 **0이 아닌데**
  `scrollWidth - clientWidth`가 **0**이면 그 스크롤바는 가짜다. 눈으로는 "꽉 찬 thumb"로만 보여서
  실제 오버플로와 구분이 안 된다 → 반드시 두 값을 같이 재라.

---

## #88 `class_schedules`는 **운영 이력을 함께 담는다** — 전 행을 그리면 "이미 끝난 교시"가 현재로 보인다 (2026-07-30)

**증상**: 반 상세(/classes/[id])의 '시간표' 카드가 **25줄**(월~금 × 5)이었다. 그런데 DP5는 실제로 하루 2교시
(14:20~15:40)만 한다. 원장 제보 *"스마트하게 정리할 수 있으면 좋겠는데"*.

- **원인**: `class_schedules`는 현재 배치만 담는 테이블이 **아니다**. 영어 시트 구조 가져오기가 옛 배치를
  `valid_to`로 마감하고 새 배치를 넣기 때문에 **한 반의 지난 학기 교시가 같은 테이블에 남는다**.
  injaewon 실측 **1,068행 중 480행(45%)이 이미 만료**. 카드는 `.eq("class_id", id)`로 전 행을 받아
  그대로 그렸다 → 3~7월에 끝난 16:20·17:00 교시가 **아직 하는 것처럼** 보였다(활성 반 108개 중 **41개**가 이 상태).
- **⚠️ 반대 방향도 있다**: `valid_from`이 미래인 행(개강 예정 특강 4행)은 **아직 시작도 안 했는데** 현재로 보였다.
- **경계(전부 동일)**: `valid_from ≤ 오늘 ≤ valid_to`, **`valid_to`는 포함**, `valid_to is null`=무기한.
  시간표 쿼리(`.lte("valid_from", …).or("valid_to.is.null,valid_to.gte.…")`)·`isCurrentSlot`과 같은 식이다.
- **규칙**: `class_schedules`를 읽는 새 코드는 **먼저 "이 화면은 언제 기준인가"를 정하고 거른다.** 화면·요약·
  AI 툴은 [`summarizeSchedule`](src/features/classes/schedule-summary.ts)(current/upcoming/past 분리 + 시각 묶음),
  쿼리는 `liveValidTo` 절. bare `.eq("class_id", …).select()`로 받아 그대로 쓰지 말 것.
- **같이 물렸던 곳(전부 수리)**: ① 상세 카드 ② `classDays`(만료 요일이 **분리등원 후보**로 떠서 실제로 안 하는
  요일을 고를 수 있었다) ③ **AI 비서 `get_class_detail`**(모델에게 만료 교시를 먹여 "17:40까지"라고 답하게
  — 사실 원칙 위반) ④ **강의실 자동배정**(끝난 교시를 점유로 세어 **없는 충돌 3건**을 만들었다: 37 → 34).
- **⚠️ 종강 반엔 이 필터를 걸지 말 것**: 종강 반은 슬롯이 전부 만료라 필터를 걸면 요일이 **통째로 사라진다**
  (실측 종강 22반 중 18반). 수업목록은 종강 반도 보여주므로 지금도 전 행을 쓴다 — 운영 중 반을 다루는 곳에만 건다.
- **숨긴 건 밝힐 것**: 만료·예정 행을 조용히 빼면 "내가 넣은 교시가 왜 없지"가 된다. 카드는
  `지난 배치 N개는 숨김` / `8/18부터`로 남은 행의 존재를 표시한다.

## #89 — "상한 걸린 목록의 길이"를 건수로 쓰지 말 것 + 가드는 프롬프트가 준 사실을 자기가 막을 수 있다 (2026-07-31)

일일 브리핑 문장을 전부 DB와 대조하다 나온 3종. 서로 다른 층이지만 **"보고 있는 값이 진짜 그 값인가"**라는
같은 질문에 걸린다.

### (a) 미리보기 상한이 그대로 "건수"가 된다 — 34명이 영원히 "30"
`dashboard_unassigned_enrolled(_admin)`은 `limit 30`(미리보기용)인데 호출부가 **반환 배열 길이**를 건수로
보고했다. 도입 시점엔 "대개 1~2명"이라 상한이 안 보였고, 실제로 34명이 된 날 화면은 조용히 **30**을 유지했다
(잘린 4명은 매일 누락). 같은 함정: `.limit(n)`·`slice(0,n)`·`fetchInChunks` 결과를 세는 모든 자리.
- **규칙**: 목록에 상한이 있으면 **건수는 별도 소스**에서 온다 — `count(*) over ()`(0159a: LIMIT 이전 평가라
  왕복이 안 늘어난다) 또는 `count: "exact", head: true`. 배열 길이를 세려면 그 쿼리에 상한이 없어야 한다.
- **냄새**: 화면 숫자가 상한값과 **정확히 같고** 며칠째 안 변한다(30·30·30…). 상한값과 같은 숫자를 보면 의심할 것.

### (b) "최근 N일 창"으로 센 숫자에서 창을 떼면 거짓말이 된다
지출 결재 대기가 화면엔 13건, DB엔 미결 **171건**(가장 오래된 건 4개월 전)이었다. 13은 최근 7일분이 맞지만
그 단서("최근 7일")가 요약·프롬프트를 거치며 사라져 총건수처럼 읽혔다 — **창 밖에 잠긴 158건이 정확히
가장 조치가 급한 것들**이었다.
- **규칙**: 창으로 좁힌 수치는 **창을 뗄 수 없는 형태로** 들고 다닌다(라벨·note에 범위를 묶어서). 소비처가
  단서를 버릴 수 있는 필드에 두지 말 것. 총계를 함께 세는 편이 대개 옳다.

### (c) 후검증 가드가 **프롬프트가 사실로 준 것**을 막고 있었다
팀 보고 검증은 영문 3자 이상을 막는다(코드·키 이름 환각 차단). 그런데 프롬프트가 사실 목록에
`- makeedu 동기화 이상: 상태 이상`을 준다 → 운영 매니저가 그 신호를 보고하는 순간 **정상 응답이 통째로 탈락**.
makeedu 신호가 뜬 유일한 날이 유일한 검증 탈락일이었다(재현 3회 중 1회가 이 사유).
- **규칙**: 금지 가드는 **payload grounding**으로 — 숫자 화이트리스트와 같은 원리로 "payload에 실제로 있는
  영문만 허용"(`narrativeWordWhitelist`). 근거 없는 영문은 그대로 차단된다.
- **함께**: 형식 실수(같은 영역 2번)로 하루치 보고를 버리던 것은 **병합**으로 수렴시켰다. 가드의 일은
  환각을 막는 것이지 회복 가능한 형식 오류로 산출물을 폐기하는 게 아니다.

### (d) max_tokens 절단이 "JSON 문법 오류"로 위장한다
`Expected ',' or ']' after array element`가 4일치 실패의 사유로 남아 있었는데, 진짜 원인은 응답이 한도에서
끊긴 것이었다 — **실패한 날의 `ai_usage_logs.output_tokens`가 전부 정확히 `max_tokens`**(1200).
- **진단**: AI JSON 파싱이 실패하면 **먼저 output_tokens가 한도와 같은지** 본다. 같으면 모델 문제가 아니다.
- **규칙**: `generateJSON`이 `stop_reason=max_tokens`(Anthropic)·`finish_reason=length`(OpenAI 호환)를 읽어
  파싱 실패를 한글 사유로 바꾼다. 한국어 응답은 토큰을 많이 먹으니 **영역·길이 상한을 프롬프트에도** 적을 것.

### 왜 아무도 몰랐나 — 폴백이 "정상처럼 보이는 문장"을 내놓기 때문
AI가 죽어도 결정론 요약이 같은 카드 구조로 렌더돼 화면은 매일 멀쩡해 보였다. **폴백이 있는 기능은 실패율을
따로 계측해서 봐야 한다**(여기선 `daily_briefings.team_report is null` 집계로 16일 중 6일이 드러났다).

## #93 이름이 비슷한 두 컬럼이 **다른 사실**일 수 있다 — 작성자 ≠ 소유자 (2026-07-31)

`textbook_orders`에 `created_by`를 넣으면서 하마터면 소유권을 통째로 옮길 뻔했다.

- **두 사실**: `created_by` = 이 행을 **실제로 저장한 계정**(감사·위조 방지) · `teacher_name` = **소유자**
  (수정·삭제·학부모 발송을 해도 되는 사람). 교재 요청은 **대리 작성이 의도된 동작**이라(폼의 '담임 선생님'을
  비우면 요청자로 채운다) 사무실이 강사 앞으로 내면 **작성자=사무실·소유자=그 강사**로 갈린다.
- 🔴 **`textbook-ownership.ts`에 "created_by가 생기면 그걸 1순위로 보라"고 적혀 있었지만 따르면 안 됐다** —
  1순위로 올리면 대리 작성분의 소유권이 작성자에게 넘어가 **그 강사가 자기 요청을 못 고치게 된다.**
  📌 **과거의 나(또는 남)가 남긴 TODO도 전제가 바뀌었는지 확인하고 따를 것.** 그 메모는 컬럼이 무엇을
  의미할지 정해지기 전에 쓰인 것이었다.
- 🔴 **백필 유혹을 참을 것.** `teacher_name`→계정 매칭이 15명 중 11명 1:1·**동명이인 0명**이라 기술적으론
  깨끗했지만, 그건 **소유자**를 **작성자** 칸에 적는 것이라 사실이 아닌 값이 447행에 남는다.
  **모르는 과거는 null이 정직하다**(= "컬럼 도입 전, 작성자 미상"). 게이트를 null에 의존하지 않게 설계하면 된다.
- ⚠️ **UPDATE의 `WITH CHECK`는 NEW 행만 본다 — OLD와 비교할 수 없다.** 그래서 `created_by = auth.uid()`를
  걸면 "남이 만들어 준 내 행"을 내가 수정할 때 막힌다(락아웃). 소유 판정은 `USING`에서, 그것도 **소유자를
  뜻하는 컬럼**으로 할 것.
- **확인법**: 역할별이 아니라 **행별로** 재라 — "그 사람의 행"과 "남의 행"을 각각 UPDATE 해서 영향 행 수를
  본다(1행 vs 0행). 역할만 보면 "teacher는 수정 가능"까지밖에 안 보인다.
---

## #92 RLS를 한 테이블에 걸었다고 **그 계열이 다 잠긴 게 아니다** — "의도적 제외"를 안 적으면 닫힌 걸로 오인된다 (2026-07-31)

0158a가 수납 구멍을 막았다고 선언한 뒤, 같은 계열의 나머지가 그대로 열려 있었다.

- **뚫려 있던 것**: `invoice_teacher_splits`(강사별 분배액·단가) · `invoice_session_terms`(회당 단가·확정 회차,
  1,337행) · `staff_contracts`(계약 조건 132행 — **54행이 급여성 문구**). 셋 다 `*_tenant_isolation`
  (`tenant_id = auth_tenant_id()`) 하나뿐이라 **역할을 전혀 안 봤다.** 앱은 다 잠겨 있었지만(billing 게이트 ·
  `requireAccess("staff")`) 강사·뷰어가 자기 access token으로 PostgREST에 직접 붙으면 그대로 받았다(#77 변종).
- 🔑 **왜 못 봤나 = 0158a가 `textbook_orders`만 "의도적 제외"로 적어 뒀기 때문.** 적힌 것 하나뿐이라
  "나머지는 다 검토됐다"로 읽혔다. **잠그는 마이그레이션은 같은 계열에서 안 잠근 테이블을 전부 이름으로
  적고 이유를 남길 것** — 안 적힌 테이블은 존재하지 않는 것처럼 취급된다.
- ⚠️ **잠그기 전에 `auth_menu_access` DEFAULTS에 그 메뉴가 있는지 확인.** 0158a DEFAULTS엔
  billing·expense_requests뿐이라 `auth_menu_access('staff')`가 **master 빼고 전부 'none'**을 돌려줬다.
  그대로 잠갔으면 admin·manager가 계약을 못 보는 **fail-closed 락아웃**(gotchas #60). DEFAULTS에 행을
  추가하고 `permissions-sql-mirror.test.ts`의 미러 목록도 **같은 커밋에서** 갱신해야 한다.
- ⚠️ **앱에 없는 경로를 DB만 열지 말 것.** `staff_contracts`에 "본인 열람" 예외를 넣고 싶었지만
  `/me`는 계약을 읽지 않는다 — 넣었으면 화면엔 없는 열람 권한을 REST에만 만들어 주는 셈이었다.
- **확인법**: 잠근 뒤 **역할 × 테이블 가시 행 수**를 롤백 트랜잭션에서 전후 대조한다. 바뀐 칸이
  의도한 칸(teacher·viewer의 그 테이블)뿐인지 눈으로 본다.
---

## #91 RLS 정책에 **컬럼을 안 쓰는 게이트 함수를 맨몸으로** 쓰면 행마다 호출된다 — STABLE로는 안 접힌다 (2026-07-31)

- **증상**: 수납관리 창이 눈에 띄게 느리다. 표는 50건만 그리는데 화면이 뜨기까지 1~2초가 걸리고, 월 칩을
  누르면 더 오래 멈춘다. 코드에는 `Promise.all`·페이징·캐시가 다 돼 있어 볼 게 없어 보인다.
- **진짜 원인**: 0158a가 invoices·expenses에 건 RESTRICTIVE 역할 게이트의 조건이
  **`auth_billing_can_read()` — 컬럼을 하나도 참조하지 않는 순수 불리언 함수 호출**이었다. 플래너는 이걸
  상수로 접지 못하고 **스캔한 행마다 호출**한다(`EXPLAIN`에 `Filter: auth_billing_can_read()`).
  그 함수 1회가 **14ms**다(내부에서 `users` + `tenant_settings` jsonb lateral 조회) → 행 수만큼 곱해진다.
- **⚠️ `STABLE` 표시로는 안 고쳐진다.** STABLE은 "한 문장 안에서 값이 안 변한다"는 **보장**일 뿐,
  플래너가 1회 평가로 바꿔주겠다는 **약속이 아니다**. 실제로 이 함수들은 전부 이미 STABLE이었다.
- **고치는 법**: 함수 호출을 **스칼라 서브쿼리로 감싼다** — `using ((select public.auth_billing_can_read()))`.
  플래너가 InitPlan으로 끌어올려 문장당 한 번만 실행한다(`Filter: (InitPlan 1).col1`).
- **실측(injaewon 프로덕션 · authenticated 롤 + 실 사용자 클레임, 0164a)**:

  | | 전 | 후 |
  |---|---|---|
  | invoices 2026-07 count(402행) | 273ms | **19ms** |
  | `invoice_periods()`(3,225행 스캔) | 2,148ms | **19ms** |
  | invoices 전건(3,225행) | 2,046ms | **155ms** |
  | EXPLAIN 실행시간 | 2,120ms | **2.7ms** |

- **권한은 안 바뀐다** — 인자 없는 STABLE 함수라 문장 안에서 값이 같다. 같은 불리언을 3,225번 계산하던 걸
  1번 계산할 뿐. 5개 역할(master/admin/manager/teacher/viewer) 전부로 적용 전·후 **보이는 행 수 동일**을
  대조하고 적용했다(master/admin/manager 3,225건, teacher/viewer 0건).
- **⚠️ 감싸면 안 되는 것**: 컬럼을 쓰는 항(`created_by = auth.uid()`, `restricted is not true`)은
  **행마다 평가돼야 맞다**. 감싸는 대상은 "이 사용자가 이 메뉴를 볼 수 있나" 같은 **행과 무관한 판정**뿐.
- **왜 안 걸렸나**: 에러가 아니라 **지연**이라 아무도 안 알려준다. 게다가 service_role로 재는 프로브는
  RLS를 통째로 우회해서 **정상으로 보인다** — 성능 측정은 반드시 `set local role authenticated` +
  실 사용자 클레임으로 할 것.
- **규칙**: 정책에 **컬럼을 참조하지 않는 게이트 함수는 맨몸으로 쓰지 말 것.** 항상 `(select f())`.
  테이블이 커질수록 조용히 느려진다.

### 후속(2026-07-31) — 판별 기준은 "함수를 썼나"가 아니라 **"컬럼과 비교되나"**

전수 조사에서 처음 세운 가설이 **틀렸다.** "`auth_tenant_id()`가 맨몸인 정책 86개(75테이블)도 같은 병"이라
지목했는데, 실제로 감싸 보고 재니(롤백 트랜잭션) **차이가 없었다** — lesson_reports 18→15ms ·
activity_log 257→268 · attendance_records 12→12 · invoices 13→13.

이유는 EXPLAIN에 있다. `tenant_id = auth_tenant_id()`는 **컬럼과의 동등비교**라 플래너가 함수를
**인덱스 스캔 키로 1회 평가**한다:

```
Index Only Scan using lesson_reports_tenant_idx
  Index Cond: (tenant_id = auth_tenant_id())      ← Filter가 아니다 = 행마다 안 돈다
```

반면 `auth_billing_can_read()`나 `auth_system_role() = ANY (…)`처럼 **컬럼이 안 끼는 항**은 비교 대상이
없어 스캔 키가 못 되고 `Filter`로 떨어져 행마다 돈다. 같은 함수라도 **쓰이는 자리**가 비용을 가른다.

- **진단 순서**: `EXPLAIN`을 떠서 그 항이 `Index Cond`인지 `Filter`인지 본다. `Filter`면 감싼다.
  코드만 보고 "함수 = 느림"으로 단정하지 말 것(`Index Cond`인 걸 감싸도 손해는 없지만 **무의미**하다).
- **실측 잔여분은 6개뿐**이었고 이득은 `activity_log`(18,334행) **255ms → 17ms**에 몰려 있었다(0166a).
- ⚠️ **상관 서브쿼리는 감싸면 안 된다** — `exists (select 1 from x where x.id = 이테이블.컬럼)`처럼
  바깥 행을 참조하면 행마다 평가돼야 맞다(`consultation_ai_analysis`는 그래서 제외했다).
- ⚠️ **감싸기를 원본 마이그레이션에도 접어 넣을 것.** 나중 파일이 `alter policy`로 덧칠만 하면, 원본만
  단독 재적용하는 경로(단일 파일 핫픽스·권한 미러 수정)에서 느린 형태가 **에러 0건으로** 되살아난다.
- ⏳ `academy_documents_restricted_guard`도 0166a에서 함께 감쌌다(역할 항만 — 컬럼 항 2개는 그대로).
---

## #90 — 브라우저에 저장한 "사용자 설정"은 계정 설정이 아니다: localStorage는 **포트까지 포함한 origin 단위** (2026-07-31)

원장 제보: *"공지사항이 계정별이 아니라 아이피별로 처리되나? 분명히 다시보지않기 눌렀는데 또 뜨네"* →
*"개발서버에서 localhost의 포트마다 누르고 있네."*

IP도 계정도 아니었다. 공지 팝업 dismiss가 `localStorage["eywa-notice-dismiss"]`에**만** 있었고 서버엔 기록이
아예 없었다(0060a가 "일반 사이트 팝업광고" 관행을 그대로 따름). localStorage 격리 단위는
**스킴+호스트+포트(origin)** 라서 `localhost:3000`↔`:3001`, 프로덕션↔로컬, 크롬↔웨일, 시크릿창,
사무실 PC↔집 PC가 전부 남남이다. 쿠키는 포트를 안 가리므로(호스트 단위) **로그인은 유지되는데 설정만
초기화**되는 게 특히 헷갈린다 — "로그인은 그대로인데 왜 설정만 리셋되지?"

- **규칙**: 사람을 따라다녀야 하는 값(안 보기·구독 해제·온보딩 완료·읽음 처리)은 **DB에 계정 단위로**.
  localStorage는 **그 기기/그 창의 상태**(창 위치·접힘·사이드바 폭)에만 쓴다.
- **판별 질문**: "다른 PC에서 로그인해도 이 값이 따라와야 하나?" → 그렇다면 localStorage는 오답이다.
- **옮길 때**: 필터를 클라 → **서버 쿼리**로 올리면 하이드레이션 게이트(클라 전용 상태 때문에 필요했던 것)가
  통째로 사라져 첫 페인트부터 보인다. 단 **테넌트 캐시(`unstable_cache`)에 개인 상태를 넣지 말 것** —
  팝업 본문은 테넌트 단위로 캐시하고 개인 dismiss만 캐시 밖 1쿼리로 읽는다.
- ⚠️ **기존 localStorage 값은 승계 불가**(서버가 읽을 방법이 없다). 전환 후 한 번은 다시 뜬다고 안내할 것.

### 같이 걸린 것 — "저장 시점이 닫을 때"라 체크만 하면 조용히 유실
체크박스 `onChange`는 로컬 state만 바꾸고 기록은 `close()`에서만 했다. 체크해놓고 새로고침·이동하면 그대로
날아간다(공지 링크 클릭으로 카드가 닫히는 경로가 생기면서 더 잦아졌다). 사용자에겐 "분명히 눌렀는데"가 된다.
- **규칙**: 설정 토글은 **바꾸는 순간 저장**한다(닫기·확인 버튼에 매달지 말 것). 실패하면 토글을 되돌리고
  이유를 보여준다 — 조용히 삼키면 다음 진입에 또 떠서 원인이 안 보인다.

### 곁가지 — 마이그레이션 번호는 "채번 시점"이 아니라 "rebase 시점"에 정해진다
origin/main 기준으로 0161a를 채번했는데 작업 중 다른 세션이 `0161a_document_categories_and_links.sql`을
먼저 올려 충돌 → 0162a로 개명. ⚠️ 이때 `0161a`→`0162a` **일괄 치환은 금물** — rebase로 딸려온 남의 파일이
자기 마이그 번호를 주석에 참조하고 있어(여기선 `schema.ts` 4곳) 통째로 깨뜨렸다.
- **규칙**: 개명은 **내 파일만**. 치환 후 `git diff origin/main -- <파일>`로 남의 hunk가 안 변했는지 확인.
- ⚠️ **`docs/changelog.md`·`docs/gotchas.md`도 "남의 파일"이다** — 모두의 항목이 한 파일에 섞여 살아서, 여기에
  전역 치환을 돌리면 남의 항목 안의 번호가 조용히 바뀐다(2026-07-31 재발: 이 문단 자체가 `0162a`→`0164a`로
  깨졌다. 하필 "일괄 치환은 금물"이라 적힌 줄이었다). 치환은 `(?!_남의파일명)` 같은 예외를 걸고,
  끝나면 **`git diff origin/main`에 `-`(삭제) 줄이 있는지**로 확인 — 있으면 남의 것을 건드린 것이다.
- 📌 번호는 **push 직전에 한 번 더** 확인(`git ls-tree origin/main supabase/migrations/`). 병렬 세션이 많은 날엔
  머지 대기 중에도 채인다 — 2026-07-31엔 한 브랜치가 **3번**(0159a→0161a→0163a·0160a→0162a→0164a) 밀렸다.

## #94 임베드에 FK를 안 적으면 **컬럼 하나 추가가 손도 안 댄 화면을 끈다** — 게다가 "0건"으로 위장한다 (2026-08-03)

수업보고서 '목록' 탭이 8월 **51건**을 두고 "총 0건"이었고, 화면엔 영문 원문
`Could not embed because more than one relationship was found for 'lesson_reports' and 'classes'`.
원장 제보는 "뷰 설정 눌렀을 뿐인데"였고 **그 말이 맞았다** — 클릭과 무관하게 그 쿼리는 이미 죽어 있었다.

원인은 그 화면이 아니라 **같은 날 다른 세션의 마이그레이션** 0171a(`lesson_reports.makeup_class_id`,
보강 앵커)다. `lesson_reports → classes` FK가 2개가 된 순간, 목록이 쓰던 힌트 없는 `classes(class_name)`
임베드를 PostgREST가 해석하지 못해 **HTTP 300 `PGRST201`로 쿼리 전체가 실패**했다.

- 🔴 **컬럼을 더한 쪽엔 아무 신호가 없다.** 보고서 화면 코드는 한 줄도 안 바뀌었고, 마이그레이션 diff에
  "이게 저 화면을 끈다"가 보일 자리가 없다 — 리뷰로 잡히는 종류가 아니다.
- 🔴 **에러가 아니라 빈 목록으로 위장한다.** 쿼리가 통째로 실패하니 rows=[] → 화면은 "총 0건" = 데이터가
  없는 것처럼 보인다. **같은 페이지의 다른 카드는 멀쩡하다**(그 쿼리는 임베드를 안 쓰므로). "일부만 안
  나온다"는 제보가 오면 화면 상태가 아니라 **그 쿼리 하나만 죽은 것**을 먼저 의심할 것.

**규칙**: `.select("… ident(…)")` 임베드는 **항상 `ident!<FK이름>(…)`** — 예:
`classes!lesson_reports_class_id_fkey(class_name)`. 전수 가드 =
[`postgrest-embed-hints.test.ts`](src/lib/supabase/postgrest-embed-hints.test.ts).

- ⚠️ **정렬 문자열은 반대다.** `order=classes(class_name)`에 `!FK`를 넣으면 order 파서가 `!`를 못 읽어
  **PGRST100(400)**. select만 힌트로 확정하면 정렬은 그 임베드를 가리켜 정상 동작한다(둘 다 프로덕션
  REST 실측). 그래서 가드는 `.select(` 인자만 본다.
- 📌 힌트를 붙여도 **응답 키는 테이블명 그대로**(`classes`/`students`) — 소비처는 안 바꿔도 된다.
- 🔑 **이건 한 쌍의 문제가 아니다.** 프로덕션 실측: 같은 대상으로 **FK 2개 이상인 조합이 11쌍**이고 그중
  **8쌍이 `→ users`**(classes·notifications·staff_contracts·lesson_reports·invoice_teacher_splits·
  invoice_session_terms·staff_leaves·academy_documents·class_delegations). 그 조합에 맨몸 임베드를
  새로 쓰면 **처음부터 깨진 채로 배포된다** — `.from("classes").select("…, users(display_name)")`은
  지금 쓰면 바로 죽는다. 진단은 REST 상태코드(`300`=모호 / `400`=파스)로, service_role로도 재현되니
  RLS를 의심하기 **전에** 확인할 것.

### 곁가지 — "에러 전부 한글화했다"는 헬퍼 존재가 아니라 **배선 표면**을 세어야 한다
같은 사고에서 영문 원문이 그대로 토스트에 떴다. 헬퍼가 없어서가 아니라
[`humanizeDbError`](src/lib/supabase/db-error.ts)가 **staff·documents에만 배선**돼 있고 report-admin
13곳은 `error.message`를 날것으로 반환하고 있었다.
- **확인법**: `grep humanizeDbError` 개수 vs `grep "error.message"` 개수 대조. 헬퍼를 만든 것과 배선한 것은 다르다.
- ⚠️ **스키마/관계 오류 분기는 입력·권한 패턴보다 먼저** 둘 것. 안 그러면 "입력한 값이 올바르지 않아…"로
  흘러가 **원장이 자기 입력을 계속 고치게 된다**. 그리고 배포로만 고쳐지므로 "다시 시도" 안내도 하지 말 것.

---

## #96 지원 안 하는 모델을 요청에 넣어도 **에러가 안 난다** — 조용히 폴백하고 주석만 거짓이 된다 (2026-08-06)

원장 질문(*"assembly api도 상위모델이 나왔는지 체크해봐"*)에서 드러났다. [`assemblyai.ts`](src/lib/ai/assemblyai.ts)는
`speech_models: ["universal-3-pro", "universal-2"]`를 보내고 주석엔 *"pro 우선, 미지원/실패 시 universal-2로 폴백"*
이라 적혀 있었다. 실제 전사를 AssemblyAI에 직접 조회하니 **전건이 `speech_model_used="universal-2"`** —
pro로 돈 적이 **한 번도 없었다**(2026-07-14·07-16·07-30 전수, confidence 0.693·0.711·0.757).

- 🔴 **미지원 모델은 400을 안 낸다.** 배열에서 조용히 건너뛰고 다음 모델로 간다. 그래서 코드·주석·커밋
  메시지에는 "상위 모델 씀"이 남고 **실제로는 구형 모델로 도는 상태**가 몇 달간 유지된다. 요청 로그를 봐도
  `speech_models`(=요청)는 pro가 들어 있어 정상으로 보인다 — **판별은 응답의 `speech_model_used`(=실제)뿐이다.**
- 🔴 **"상위 모델 = 더 좋다"가 언어별로는 성립하지 않는다.** AssemblyAI는 상위 라인
  `universal-3-pro`(2026-02)·`universal-3.5-pro`를 **18개 언어**(영·스·불·독·이·포·아랍·덴마크·네덜란드·
  핀란드·히브리·힌디·일본어·중국어·노르웨이·스웨덴·터키·베트남)로 냈는데 **한국어가 빠져 있다.**
  한국어는 `universal-2`(99개 언어)에만 있다. 일본어·중국어가 들어갔으니 한국어도 있겠거니 하면 틀린다.

**규칙**: 외부 API의 모델·기능 배열에 항목을 추가할 땐 ① 그 언어/용도를 **지원 언어표에서 직접 확인**하고
② **응답이 알려주는 실제 사용값**으로 검증할 것(요청값 말고). 주석은 강제력이 없어 같은 착각이 반복되므로
한국어 지원 모델은 [`KOREAN_SPEECH_MODELS`](src/lib/ai/assemblyai.ts) 한 곳으로 모으고
[`assemblyai-models.test.ts`](src/lib/ai/assemblyai-models.test.ts)로 잠갔다(미지원 모델 재유입 차단).

- 📌 이 착각은 문서까지 오염시킨다 — CLAUDE.md에 *"전사(AssemblyAI `universal-3-pro`)는 ijw와 동일 엔진"*
  이라 적혀 있었고(실제론 universal-2), 06-24 A/B의 "품질 차 없음" 결론 자체는 유효하지만 **근거로 적힌
  모델명이 틀렸다.** 실측으로 확인 안 한 모델명을 문서에 옮기지 말 것.

## #97 표를 **잡고 끌 수 있게** 만들면 더블클릭이 새어나간다 + 자동 폭은 접을 때마다 표를 밀어낸다 (2026-08-06)

원장 제보 두 건이 사실은 같은 표(출석부 매트릭스)의 서로 다른 함정이었다.

**(가) "더블클릭 메모가 작동하지 않음"** — 원장은 *"아 7일 지난분이라 그렇구나"*로 짐작했지만
**master 계정은 어떤 칸도 안 잠긴다**(`lockBefore`는 `accessLevelTenant==="scoped"`일 때만 생기고,
강사뷰 토글은 데이터 스코프만 바꾸지 `system_role`은 그대로다). 진짜 원인은
[`DragScrollArea`](src/components/ui/drag-scroll-area.tsx)다 — 더블클릭 사이에 포인터가 **5px만**
움직이면 팬이 시작되며 `setPointerCapture`가 걸려 **두 번째 클릭이 칸이 아니라 스크롤 컨테이너로 간다.**
그래서 "될 때도 있고 안 될 때도 있는" 증상이 된다.
- **규칙**: 드래그-팬 영역 안의 요소에 **더블클릭만으로 여는 기능을 두지 말 것.** 우클릭(`onContextMenu`)은
  팬이 `button!==0`을 걸러서 구조적으로 안 겹친다 — 안내 문구도 우클릭으로 적고 더블클릭은 별칭으로만 둔다.
- ⚠️ `preventDefault`는 **잠긴 칸에서도 항상** — 조기 return하면 브라우저 기본 메뉴가 튀어나온다.
- 📌 사용자의 원인 가설을 그대로 받지 말 것. 권한 계산 한 줄만 확인하면 반증됐다.

**(나) "반을 접을 때마다 열너비가 변경된다"** — `table-layout: auto`는 열 너비를 **그 열의 최장 내용**에서
뽑는다. 그룹을 접어 긴 학교 이름이 사라지는 순간 이름 열이 줄고 **그 오른쪽 전부가 밀린다**(실측 135→115px).
- **규칙**: 접기/필터로 행이 사라지는 표는 **`<colgroup>` + `table-fixed`** 로 폭을 내용에서 떼어낸다.
  · **가변 칸(날짜 등)만 폭을 비워** 남는 폭을 나눠 갖게 하고, 하한은 표 `minWidth`로 보장한다.
  · 폭을 전 열에 박으면 넓은 화면에서 **비례 확대**돼 `right-[64px]` 같은 sticky 오프셋과 실폭이 어긋난다.
  · 고정 폭이면 넘치는 글자를 **잘라야** 옆 칸을 안 덮는다 → 안쪽 `<span class="block truncate">` + `title`
    (`td`에 건 `overflow:hidden`은 표 셀에서 신뢰할 수 없다).

**(다) 검증 함정** — 창(캔버스) 셸에서 라우트를 **직접 navigate**하면 내용이 React 스트리밍 홀더
`<div hidden id="S:0">`에 남는다(하이드레이션 미완). 이때 `getBoundingClientRect`는 전부 **0**이고
`.click()`도 안 먹는다 → `document.querySelector('main table')`로 잡을 것(숨은 사본이 먼저 잡힌다).
창은 사이드바 링크를 `.click()`해 열면 정상 하이드레이션된다.

---

## #98 `transform`이 걸린 조상은 **`position:fixed` 자손의 좌표계를 갈아탄다** — 끌고 있는 칩이 엉뚱한 데 그려진다 (2026-08-06)

원장 제보: *"그룹설정 드래그드랍이 이상한데서 렌더링됨"* — 반 칩을 끌면 **다이얼로그 바깥 오른쪽**에
칩이 떠 있었다(스크린샷상 커서와 900px 넘게 벌어짐).

**원인은 dnd-kit이 아니라 다이얼로그의 센터링이다.** dnd-kit `DragOverlay`는
`position:fixed; top:<rect.top>; left:<rect.left>` + `transform: translate3d(delta)`로 그린다 —
**뷰포트 좌표를 그대로 쓴다는 전제**다. 그런데 CSS 명세상 **`transform`(그리고 `filter`·`perspective`·
`will-change`·`contain:paint`)이 걸린 요소는 `position:fixed` 자손의 containing block이 된다.**
모달을 관용구대로 `fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2`로 가운데 놓으면
그 `-translate-*`가 바로 그 transform이라, 오버레이의 `left: 355px`가 **뷰포트가 아니라 패널 좌상단**
기준이 된다 → 패널 원점(여기선 ~+290,+90)만큼 통째로 밀린다.

- **규칙**: **드래그·팝오버 등 `position:fixed` 자손을 품는 컨테이너는 `transform`으로 센터링하지 말 것.**
  `fixed inset-0 flex items-center justify-center`(+ 래퍼 `pointer-events-none` / 패널
  `pointer-events-auto`)로 바꾸면 transform이 사라져 자손이 뷰포트 기준으로 돌아온다. 래퍼에
  `pointer-events-none`을 안 주면 그 칸이 backdrop 클릭(닫기)을 통째로 가로챈다.
- **판별(1줄)**: 조상을 타고 올라가며 `getComputedStyle(n).transform !== 'none'`을 찾는다. 하나라도
  있으면 그게 범인이다. 고쳤는지 확인은 **오버레이 좌상단 ≈ 포인터 − 잡은 지점**(실측 2px 이내).
- 🔑 같은 뿌리의 사촌 함정: **`zoom`은 fixed 자손의 좌표를 배율만큼 곱한다**(gotcha 없음, 코드 주석에만
  있었음) → 시간표 글씨 크기(zoom) 래퍼는 반드시 **`DndContext` 안쪽**에 둔다. 즉 드래그를 붙일 땐
  **transform 조상 0개 + zoom 조상 0개**가 오버레이의 전제 조건이다.
- ⚠️ 합성 PointerEvent로 검증할 땐 **한 스크립트 안에서 재지 말 것** — React 커밋이 비동기라 같은 틱에선
  오버레이가 아직 DOM에 없다(호출을 시작/측정/놓기 3번으로 쪼갠다).

## #99 `aspect-ratio` 박스에 높이를 주면 **폭이 열을 넘어 옆 칸을 덮는다** — 창을 넓혀도 안 줄어든다 (2026-08-07)

**증상**: 관리자가 출석부(반 미선택 허브)를 열면 좌측 사진이 우측 '바로 열기' 목록 **위로 넘어와 가린다**.
원장: *"사진이 너무 커서 우측 목록을 덮어버리는데, 사진 크기가 고정인가? 창 크기에 따라 변하지 않고?"*
실측(웨일, 실화면 DOM): 창을 **1280 → 1536으로 넓혀도 사진 폭은 926px 그대로**였다(가린 폭만 368 → 253으로 줄 뿐).

**원인은 사진도 이미지 최적화도 아니라 정렬 규칙이다.** [`PhotoCard`](src/components/atoms/photo-card.tsx)는
`style={{aspectRatio}}`가 붙은 `figure`인데, 호출부가 `h-full`을 주고 부모 격자가 `items-stretch`라 **높이가
확정**됐다. CSS Box Alignment는 **비율이 있는 아이템에 한해 `justify-self:normal`을 stretch가 아니라 `start`로**
해석한다(비율을 지키려는 규칙) → 폭이 열에 맞춰 늘어나는 대신 **높이×비율로 되계산**된다:
618 × 3/2 = **927px**인데 열은 **658px**. 넘친 268px은 잘리지도 않고(부모는 `overflow-auto`지만 격자 아이템은
그냥 그려진다), `figure`엔 캡션 오버레이 때문에 **`relative`**가 붙어 있어 정적 요소인 목록보다 **위에** 칠해진다.

- **규칙**: **`aspect-ratio`를 쓰는 카드/사진은 폭을 `w-full`로 확정한다.** 두 축이 다 정해지면 비율은
  폴백이 되고(높이를 안 주는 호출부에선 그대로 산다) 박스는 제 칸을 못 벗어난다. 크롭은 `object-cover`가 한다.
  아톰이 항상 붙이도록 못박았다(`photo-card.test.tsx`가 클래스를 잠근다 — happy-dom엔 레이아웃이 없어 폭은 못 잰다).
- **판별(1줄)**: `figure.getBoundingClientRect().right > 옆칸.left`. 🔑 그보다 빠른 지문은 **"창을 넓혀도
  안 변한다"** — 폭이 폭에서 안 나오고 **높이에서** 나온다는 뜻이다. 반대로 창을 낮추면 사진이 좁아진다.
- ⚠️ **한 열로 접히는 좁은 창은 반대 사고**가 난다: 높이를 안 주면 폭(=창 전체)에서 비율로 커져 목록을
  화면 밖으로 밀고, `h-full`만 주면 남는 높이가 0이라 도리어 **손톱만 한 사진**(실측 232×155)이 된다 →
  접히는 쪽은 `h-40 lg:h-full`처럼 **띠 높이를 명시**할 것(실측 855×160, 목록 402/407px 보임).

## #100 단일 구간(`starts~ends`) 스키마에 **흩어진 날짜**를 넣으면 모델이 하나만 남기고, 하필 "오늘"이 사라진다 (2026-08-07)

학부모 원문: *"저 8월 7일 (오늘) 이랑 8월 11일, 8월 12일에 개인일정으로 학원 못 옵니다."*
저장된 판정: `absence 2026-08-12 ~ 2026-08-12`. 셔틀이 보는 벨 제목은 **"이수빈 결석 8/12"** —
**오늘 결석이 통째로 사라졌다.** 모델이 헛것을 본 게 아니라, 표가 `starts_on`·`ends_on` **한 구간**뿐이라
띄엄띄엄한 세 날짜를 담을 자리가 없었고 프롬프트에도 그 경우 규칙이 없어 **마지막 하나만** 남은 것이다.

- **왜 위험한가**: 이 기능의 목적이 "셔틀이 오늘 누구를 빼야 하나"인데, 정확히 그 **오늘**이 빠진다.
  게다가 화면·집계를 `starts_on`으로 거르는 순간 그 학생은 오늘 목록에서 **조용히** 없어진다(에러 없음).
- **규칙 ①(프롬프트)**: 띄엄띄엄한 날짜는 기간이 아니다 → **가장 이른 날**을 잡고 나머지는 요약(detail)에.
  🔴 **가장 늦은 날을 `endsOn`으로 잡지 말 것** — 사이에 오는 날까지 결석으로 만들어 **아이가 학원에 못 온다**.
- **규칙 ②(후검증)**: [`uncoveredDatesIn`](src/features/attendance/parent-alerts/intent.ts)이 원문에서
  `8월 7일`·`8/7`·(앞의 달을 승계한) `12일`을 뽑아 **판정이 못 담은 날**을 제목·본문에 적는다(`⚠️8/7·8/11 확인`).
  🔴 **날짜를 고쳐 쓰지는 않는다**: 원문의 이른 날로 판정을 당기면 *"7일에 보강 될까요? 12일은 결석입니다"*
  에서 오늘을 결석으로 만들어 **없는 결석**을 만든다(같은 사고의 반대 방향). 알리기만 하고 판단은 사람이.
- ⚠️ 달 없는 맨 `3일`은 날짜로 보지 않는다 — 실제 문장 *"보강은 3일을 해야되니"*가 그대로 걸린다.
- 🔑 일반화: **모델 출력을 담는 그릇이 표현할 수 없는 입력**은 "오류"가 아니라 **조용한 손실**로 나온다.
  그릇을 못 넓히면(마이그레이션 비용) 최소한 **"담지 못한 게 있다"는 사실을 사람에게 보여줄 것.**

## #101 폰에 알림이 안 오는 건 권한 문제가 아니다 — **API가 다르고**(안드로이드) **설치가 필요하다**(iOS) (2026-08-07)

원장 *"모바일에서 (안드로이드) 알림을 받으려면 그냥 알림 켜놓으면 자동으로 오나? ios는 사파리에서 홈으로
내보내기 해놓으면 되고"* → **둘 다 아니었다.** aywa의 OS 알림은 `new Notification()`(생성자) 한 줄인데:

- **안드로이드 크롬은 그 생성자를 아예 지원하지 않는다**(서비스워커의 `registration.showNotification()` 필수).
  권한을 허용해도, 탭을 열어놔도 **아무 일도 안 일어난다** — 코드의 `catch`가 조용히 삼켜서 "권한 문제"로 보인다.
- **iOS는 홈 화면 추가가 필요조건이지 충분조건이 아니다**(16.4+). manifest·서비스워커·구독·VAPID가 다 있어야
  하고, 하나라도 없으면 설치해도 안 온다. 게다가 사파리에서 그냥 연 상태에선 **구독 자체가 거부**된다.
- **그래서 웹 푸시(0188a)를 따로 깔았다** — `public/sw.js` + `push_subscriptions` + `VAPID_*` env +
  벨의 '휴대폰 알림 켜기'. PC 경로(`desktop-notify.ts`)는 **창이 열려 있을 때만**이라 그대로 두고 공존시킨다.
- ⚠️ **`sw.js`에 fetch 캐싱을 넣지 말 것** — 서비스워커가 응답을 캐시하기 시작하면 새 배포가 **폰에만**
  옛 코드로 남는다("배포했는데 안 바뀐다"의 최악판). 핸들러 자체를 두지 않는 게 구조적 방어다.
- ⚠️ 자동화로는 마지막 한 칸을 못 잰다 — `Notification.requestPermission()`은 **사용자 제스처**가 필요하고
  브라우저 권한 팝업은 탭 화면 밖(브라우저 크롬)이라 스크린샷·클릭이 안 된다. 실기기 확인은 사람 몫.

## #102 서버 액션 뒤의 `router.push`는 삼켜진다 — 목적지를 이미 받아놓고 화면이 안 넘어간다 (2026-08-07)

**증상**: 로그인 버튼이 **'로그인 중…'에서 영영 멈춘다**(입력칸까지 disabled, 에러 메시지 없음).
새로고침하면 이미 로그인돼 있다. 원장 제보로 발견 — typecheck·lint·4,005 테스트·프로덕션 빌드가
**전부 그린**이었다(클라 라우터 타이밍이라 어느 것도 못 잡는다).

**진단이 뒤집힌 지점**: 콘솔의 `400`을 보고 "자격증명 오류"로 갈 뻔했다(그건 이전 내비의 보존 메시지였다).
결정적 증거는 **네트워크 목록**이었다:

```
POST https://…supabase.co/auth/v1/token?grant_type=password  → 200   로그인 성공
POST http://localhost:3100/login                             → 200   서버 액션 실행
GET  http://localhost:3100/ecs?_rsc=…                        → 200   목적지 RSC를 이미 받았다
```

즉 **목적지를 정확히 정하고 받아오기까지 다 해놓고 화면만 안 바뀐다.** 기능(어디로 보낼지)은 멀쩡하고
이동만 유실된 것이라, 로그만 보면 "정상 동작"으로 보인다.

**원인**: Server Action의 응답은 그 액션을 부른 **현재 페이지의 RSC 트리를 다시 적용**한다. 같은 핸들러에서
`router.push(목적지)`를 이어 부르면, 뒤늦게 도착한 액션의 트리 적용이 방금 시작한 이동을 덮어 **원래
페이지로 되돌린다**. `router.refresh()`를 붙여도 마찬가지(그쪽도 현재 라우트를 갱신할 뿐이다).

**규칙**: **서버 액션을 부른 뒤 클라에서 이동하는 자리는 `window.location.assign`(풀 문서 네비)** 로 확정한다.
- 이 리포는 이미 같은 이유로 뷰 전환에서 그 규약을 쓰고 있었다(`switchToTeacherView`/`switchToAdminView`가
  `redirect()` 대신 **경로를 반환**하고 호출부가 `window.location`으로 이동 — CLAUDE.md 결정 로그).
  즉 **새 함정이 아니라 이미 아는 함정의 다른 얼굴**이다. 액션이 `redirect()`를 하든 값을 돌려주든,
  "액션 → 클라 이동" 조합이면 전부 해당된다.
- 부수 효과로 풀 로드라 모든 서버 컴포넌트가 새 세션 쿠키를 확실히 본다(로그인엔 오히려 더 안전).

**⚠️ 같이 갈 것 — 클라가 서버에 물어보고 이동하는 자리엔 타임아웃**: 응답이 안 오면 `pending`이 영영
`true`라 폼이 잠긴다. `Promise.race([action(), 3초 후 null])`로 **덜 정확한 착지 > 멈춤**을 택한다.
(aywa 로그인 = `resolveLoginLanding()` 실측 ~300ms, 타임아웃 3초 + role 기반 폴백.)

**🔑 진단 순서**: 클릭이 "먹통"인데 에러가 없으면 콘솔보다 **네트워크 목록을 먼저** 본다.
목적지 요청이 `200`으로 찍혀 있으면 그건 데이터·권한 문제가 아니라 **이동(라우터) 문제**다.

**같은 계열 (2026-10-16) — 오래 도는 서버 액션을 `startTransition(async …)`로 감싸면 그동안 화면 이동이 전부 멈춘다**:
직원 포트폴리오 '지금 집계'(수십 초) 도중 왼쪽 강사 목록을 눌러도 화면이 안 넘어갔다(원장 제보). Next 라우터는 이동을
서버 액션보다 앞세우는데도(`app-router-instance.js` — 진행 중 액션을 버리고 이동부터) 막혔다. 원인은 **React**다:
비동기 트랜지션이 도는 동안 `requestTransitionLane()`이 새 트랜지션 전부에 **같은 갈래(`currentEntangledLane`)** 를 주고,
그 갈래의 갱신을 처리하면 진행 중 액션의 thenable을 던져 **액션이 끝날 때까지 커밋하지 않는다**(라우터 내부의
`startTransition`도 예외가 아니다). 그래서 이동 요청은 이미 200으로 와 있는데 화면은 그대로다.
- **규칙**: 몇 초 넘게 걸릴 수 있는 서버 액션은 이벤트 핸들러에서 **트랜지션 없이** 부르고, 진행 표시는 `useState`로
  둔다(`RefreshButton` · `portfolio-board.tsx`). 저장 버튼처럼 짧고 모달 안에서만 도는 액션은 그대로 둬도 된다.
- ⚠️ 트랜지션을 빼도 **라우터 대기열**은 남는다 — 이동은 액션을 앞지르지만 같은 화면의 **다른 서버 액션**(비교 표 불러오기 ·
  입력 창 불러오기 · 보기 설정 저장)은 그 액션이 끝날 때까지(이동이 끼면 이동이 끝날 때까지) 뒤에 줄을 선다(`dispatchAction`의 마지막 갈래). 다른 액션까지
  막히면 안 되는 긴 작업은 라우트 핸들러 + `fetch`로 뺄 것(#137과 같은 결 · 포트폴리오 집계는 아직 서버 액션).

**⚠️ 액션이 `redirect()`를 하는 경우는 더 나쁘다(2026-09-12)** — 클라가 `await action()`으로 부른 promise는 **NEXT_REDIRECT로
reject**된다(Next 16 `server-action-reducer` — 라우터가 스스로 목적지로 가면서 호출부엔 예외를 던진다). 새 회의록 녹음 경로가
그랬다: 성공인데 catch로 떨어져 원문 "NEXT_REDIRECT"가 잠깐 보이고, 버튼이 다시 열려(재클릭 = 업로드·전사 두 번) 성공 뒤
정리(복구 조각·초안 삭제)가 **한 번도** 안 돌았다. → 프로그램으로 await하는 액션은 `redirect()` 대신 **id·경로를 돌려주고**
호출부가 풀 문서 이동한다(`startMeetingFromAudio` = `createTextMeeting`과 같은 규약). `useActionState`/`<form action>`으로 쓰는
액션의 `redirect()`는 이 함정이 아니다.

## #103 칸을 잠그면 **이동 경로와 뒷문**까지 함께 봐야 한다 — 잠금은 UI 한 줄이 아니다 (2026-08-07)

원장 *"결석 체크하면 우측 입력창 비활성화 여부 쳌"* → 멘트만 잠갔더니 같은 날 *"결석을 눌렀는데
**진도 같은거 전부다 적을 수 있던데?**"*. 잠금 범위를 기록 칸까지 넓히면서 **잠금이 혼자 사는 게
아니라는 것**이 드러났다. 칸 하나를 `disabled`로 만들면 최소 세 가지가 함께 움직인다.

- 🔴 **`focus()`는 disabled 입력에 안 먹는다** → 키보드 세로 이동(Enter/↑↓)이 그 행에서 **멈춘다**.
  결석 학생 한 명이 반 전체의 Enter 흐름을 끊고, 증상은 "Enter를 눌렀는데 무반응"이라 잠금과 연결이 안 된다.
  → 이동 헬퍼가 **잠긴 칸을 건너뛰고 다음 살아 있는 행으로** 가야 한다(`grid-nav.ts`, 테스트로 고정).
  (`readOnly`는 포커스가 되므로 대상이 아니다 — 값을 읽고 복사할 수 있는 편이 낫다.)
- 🔴 **잠근 칸에 값을 넣는 다른 문이 남아 있다** — '맨 위 행 복사'·'값 일괄 적용'·'이전 회차 가져오기'는
  행을 목록으로 훑어 값을 밀어 넣는다. 잠금을 UI에서만 걸면 그 경로로 들어온 값이 **강사가 지울 수 없는
  값**으로 남는다(#77의 뒤집힌 꼴 — 잠근 문 옆의 뒷문). → 세 계획 함수 전부 `locked`를 받아 건너뛴다.
  ⚠️ 단 **행 목록에서 빼지는 말 것**: 같은 목록을 출결 일괄 적용이 쓰는데 거기서 빠지면 잘못 찍은 결석을
  일괄로 되돌릴 수 없다. **값 적용만** 건너뛴다.
  ⚠️ 건너뛴 건수를 세는 라벨도 함께 고칠 것 — "발송 완료 N행"만 적으면 결석분까지 삼켜 **거짓 안내**가 된다.
- 🔴 **되돌릴 문은 절대 잠그지 말 것** — 결석은 오클릭이 잦다. 출결 알약·수업타임·결석 사유까지 함께
  잠그면 그 행은 **영영 잠긴다**. 잠금 판정 함수가 출결을 보지 않게 두고, 출결을 바꾸는 순간 열리는지를
  테스트로 고정한다(`isRowInputEditable`).

**🔑 판별**: 잠글 값이 **발송물이냐 기록이냐**를 먼저 가른다. 여기선 "그 학생이 그 수업에 없었다"라
기록도 거짓이 되므로 둘 다 잠갔지만, 출결은 **그 사실 자체를 적는 칸**이라 잠금 대상이 아니다.

**📌 곁다리**: `<tr>`의 자식은 `<td>`여야 해서 행 전체를 `<fieldset disabled>`로 감쌀 수 없다 —
**칸(td) 안에서** `fieldset` + `display:contents`로 감싼다(레이아웃 불변). 이 방식은 base-ui
드롭다운(`<button>` 트리거)까지 확실히 잠근다(jsdom 렌더 테스트로 확인).

## #104 RLS 정책이 **하나도 없는 표**는 사용자 클라이언트로 읽으면 에러 없이 **0행**이다 (2026-08-07)

**증상**: ECS 시트에 분명히 적혀 있는 교재·진도·과제를 원스크린 보고서 초안으로 당겨왔는데, 화면엔
**아무것도 안 들어온다**. 에러도, 콘솔 로그도, 실패 토스트도 없다. 조회는 성공(200)했고 결과만 비어 있다.

**원인**: `class_sheet_plan_lines`·`class_sheet_student_marks`는 RLS가 켜져 있고 **정책이 0개**다
(`pg_policies`에 행이 없다). Postgres에서 정책 없는 RLS = **전부 거부**라, 사용자(anon/authenticated)
클라이언트로는 항상 빈 결과가 온다. 같은 데이터를 그리는 ECS 화면(`server/today.ts`)이 처음부터
`createAdminClient()`를 쓰고 있었던 이유가 이것이다 — 새 소비처(`onescreen/server/roster.ts`)가 관례를
모른 채 `createClient()`를 쓰면서 재현됐다.

**규칙**: **정책이 없는 표는 admin 클라이언트로만 읽는다. 그리고 admin은 RLS를 우회하므로 `tenant_id`
필터를 직접 건다**(격리의 진짜 방벽이 사라진 자리라, 반 id로 좁혀 놨어도 tenant 조건이 있어야 한다).

```sql
-- 새 표를 읽기 전에 1초면 확인된다
select tablename, count(*) from pg_policies
where tablename in ('내가_읽을_표') group by tablename;   -- 0행 = 사용자 클라이언트로는 못 읽는다
```

**🔑 판별**: "쿼리는 성공인데 0행"이면 필터를 의심하기 전에 **정책 유무**를 본다. 데이터가 진짜 없는 것과
정책이 없는 것은 화면에서 똑같이 보인다(둘 다 조용하다). `.catch`로 감싼 fail-soft 조회라면 더더욱
아무 소리도 안 난다 — 로그조차 안 찍힌다(실패가 아니니까).

**⚠️ 곁가지**: 이번 것은 **읽기**만 막혔다. 쓰기는 원래 서버 액션이 admin으로 하고 있어서(같은 이유)
"저장은 되는데 안 보인다"가 될 수도 있었다. 한 표의 읽기·쓰기 경로가 서로 다른 클라이언트를 쓰면
증상이 이렇게 갈린다.

## #105 **조치가 필요한 항목**에 짧은 시간창을 걸면, 고치기도 전에 목록에서 사라진다 (2026-08-11)

**증상**: 원장 제보 — *"분명히 어제는 미발송분이 있었는데, 날이 바뀌니까 미발송분이 사라졌네."*
수업보고서 발송 큐 카드에 실패 1건만 남아 "거의 정상"으로 보였다.

**원인**: 큐 카드 조회가 `report_date >= 오늘-3`이라 **날이 바뀔 때마다 하루치씩 목록에서 빠졌다.**
실측(2026-08-11): 발송 실패 **16건 중 15건이 이미 창 밖**이었고, 그 사이 **11건은 발송 기한(7일)까지
넘겨 학부모에게 영영 못 나갔다**(손민우 5·정다온 5·최수호 2·김수련 2·이도윤B 1 — 7/22부터 누적).
재발송 UI는 이 카드가 **유일**해서, 창 밖으로 밀린 건 **화면에서 되살릴 방법 자체가 없었다**.

같은 함정을 이미 한 번 겪고 `blocked_shared`·`name_conflict`만 창에서 면제해 뒀는데(`HUMAN_RESOLVED_STATUSES`),
**`failed`가 실은 같은 부류**라는 걸 놓쳤다 — 실패 사유가 전부 "보드에 연결된 원아가 없습니다"류,
즉 **워커가 몇 번을 재시도해도 안 풀리고 사람이 ClassNote에서 배정해야 끝나는** 것들이었다.

**규칙**: 목록의 시간창은 **"언제 생겼나"가 아니라 "언제까지 손 쓸 수 있나"로 잡는다.**
- 사람이 조치해야 풀리는 항목은 **조치 가능한 동안 절대 사라지지 않아야** 한다(창 면제).
- 조치 기한이 있으면 **남은 날을 행에 적는다**("오늘까지"·"내일까지") — 기한이 안 보이면 "나중에 고치지"가
  그대로 영구 미발송이 된다.
- 기한이 끝난 뒤에도 **며칠은 '만료'라는 결말을 보여 준 다음** 내린다. 마지막 날까지 보이던 행이 다음 날
  흔적 없이 사라지면 사용자가 겪는 일은 처음 문제와 똑같다.
- ⚠️ 자동 재시도가 있는 상태(`failed`)라고 해서 "시스템이 알아서 끝낸다"고 보지 말 것 — **재시도로 안 풀리는
  실패**가 실제로는 다수다. 판별은 상태 이름이 아니라 **사유**다.
- ⚠️ 목록 상한(slice)에 걸려 잘리면 그 사실을 화면에 적는다([[#89]]) — 빅스탯은 전건, 표는 상한이라 둘이 어긋난다.

---

## #106 시작시각이 같은 교시가 둘이면, 찍어둔 수업이 **다른 교시 칸으로 옮겨 보인다** (2026-08-13)

**증상**: 원장 제보 — *"나는 분명 4교시에 체크했는데, 7교시와 시간이 겹치니까 7에 자꾸 입력됨."*
반정보 수정 → 주간 스케줄에서 EiE 4교시(16:20)에 체크해 저장하면, 그 반을 다시 열었을 때 체크가
IJW 1교시(16:20) 칸에 가 있었다. 함께 제보된 두 번째 증상 — *"1~6까지를 EiE 1~6교시로 세팅해놨는데
여전히 1~7 이런식으로 보임"* — 은 같은 화면의 별개 원인(라벨 미배선)이다.

**원인**: 클릭그리드가 저장된 슬롯을 교시 칸으로 되돌릴 때 **시작시각만** 키로 썼다
(`new Map(periods.map(p => [p.startTime, p.id]))`). 학원설정에 시작이 같은 교시가 둘 있으면
(실측 injaewon 영어: **EiE 4교시 16:20~17:00** 과 **IJW 1교시 16:20~17:20**) Map은 **뒤에 나온 교시가
앞을 덮어써** 항상 IJW 1교시로 매핑됐다. DB 행은 내내 정확했고(16:20~17:00) **화면만** 틀렸다 —
다만 그 상태로 저장을 한 번 더 누르면 그 칸의 시각(17:20)으로 **종료시각이 실제로 바뀐다**.
(같은 표를 읽는 시간표 축은 `if (!has)`라 **앞을 유지** — 두 화면의 규약이 서로 반대였다.)

교시 이름은 별개 원인이었다: `settingsToPeriodsConfig`가 설정 행의 `label`을 **버리고** 시각만
`{startTime,endTime}`으로 옮겨서, 소비처는 지어낼 수 있는 게 번호(`index+1`)뿐이었다.

**규칙**
- 저장된 시각 → 교시 역매핑은 **(시작,종료) 짝을 먼저** 맞추고, 없을 때만 시작시각으로 폴백한다
  ([`buildPeriodMatcher`](../src/features/classes/grid-slots.ts), 순수·Vitest).
- 🔴 **시작시각 폴백을 없애지 말 것** — `splitGridSlots`가 "시작시각이 표에 있으면 그리드"로 분류하므로,
  폴백이 없으면 종료시각이 어긋난 슬롯이 그리드에서 **사라지고 저장 시 삭제**된다(이 파일 #상단 경고와 한 쌍).
- 중복이 남을 땐 **먼저 나온 교시**(작은 번호)를 쓴다 — 시간표 축과 규약을 맞춘다.
- 교시 **이름은 학원설정이 단일 소스**다(운영 enum 하드코딩 금지 규칙의 교시판). 코드가 `${id}교시`를
  지어내는 건 설정에 이름이 없을 때의 **폴백**일 뿐이다.
- ⚠️ 교시 번호(`index+1`)는 표시용 위치일 뿐 DB에 저장되지 않는다 — 설정에서 교시 순서를 바꿔도
  기존 수업은 시각으로 연결돼 그대로다(그래서 순서 바꾸기를 열어도 안전하다).
## #107 "권한 위에 있다"를 **override 폐기**로 구현하면, 기본값이 닫힌 메뉴에선 super_admin이 일반 직원보다 **덜** 본다 (2026-08-13)

원장 제보: *"수업평가가 사라졌는데 지금 버튼이 너무많아서 그런가?"* — 메뉴 개수와 무관했다.
스크린샷 한 장에 증거가 셋 있었다: **수업 평가 없음**(개인 예외 full로 열어 둔 메뉴) · **학원 설정 없음**
(역할 override admin=full로 열어 둔 메뉴) · 그런데 **이탈 방어·성적관리·직원관리는 보임**(원장이 override로
`none`으로 닫아 둔 메뉴들). 즉 **override가 켜는 건 안 되고 끄는 것도 안 되는** 상태 = override 통째 무시.

- **원인**: 그 계정이 **그날 super_admin이 됐다**(`super_admins` 부여 시각 = 제보 몇 분 전). 그리고
  `getPermMatrix`/`getUserPermMatrix`의 super_admin 우회가 `return resolveMatrix([])` — **override를
  통째로 버리고 코드 기본값만** 썼다. 의도는 "원장이 super_admin을 잠그지 못하게"(결정 2026-07-02)였고
  당시 근거는 *"기본 master=전 메뉴 full이라 실질 전체 접근"* 이었다.
- 🔑 **그 전제가 두 군데서 깨진다.** ① 대상이 master가 아니면(여기선 admin) 기본값은 전체 접근이 아니다 —
  `owner`는 admin 기본 `none`이라 학원 설정이 사라진다. ② **테스트 단계 메뉴는 기본값이 전 역할 `none`**이고
  개방을 override로만 한다(`class_review`) → 기본값으로 되돌리는 것이 곧 **차단**이다.
  결과가 역전이다: 가장 권한이 센 사람이 **아무 예외도 없는 직원보다 덜** 본다.
- **고침**: 우회를 폐기가 아니라 **병합**으로 — `mergeMostPermissive(기본값, override)`(순수함수, Vitest 4).
  셀마다 더 허용적인 쪽을 취하니 **잠금은 여전히 무시**(기본값이 살아남음)되고 **부여는 보존**된다.
  개인 예외도 같은 규칙(`mergeMostPermissive(base, applyUserOverrides(...))`)이라 낮추는 개인 예외만 무시된다.
- ⚠️ 병합 순위는 `none<readonly<scoped<full`. readonly↔scoped는 서로를 포함하지 않지만(전체 읽기 vs 담당 쓰기)
  병합이 **항상 올라가는 방향**이라 이 순서 때문에 잠기는 셀은 없다.
- 🔑 **진단 요령**: "메뉴가 사라졌다"에서 사라진 것만 보지 말고 **남아 있는 것도 볼 것**. 원장이 닫아 둔
  메뉴가 보이면 그건 권한 부족이 아니라 **override가 적용되지 않는 것**이고, 원인은 게이트가 아니라 그 위의
  우회 분기다. (역할 하나만 보고 "기본값이면 충분히 열려 있다"고 가정하지 말 것 — 역할별로 기본값이 다르다.)

## #108 `window.location.origin`으로 만든 문자열을 **화면에 텍스트로 그리면** 하이드레이션이 깨진다 (React #418, 2026-08-14)

원장 콘솔 제보: `Uncaught Error: Minified React error #418; …args[]=text&args[]=`.
#418은 **"서버가 그린 텍스트가 클라와 다르다"**이고, 인자가 `["text", ""]` — **한쪽이 빈 문자열**이라는 뜻이다.

- **원인**: 원스크린 카드([report-card.tsx](src/features/onescreen/components/report-card.tsx))가 학부모 공유
  링크를 이렇게 만들었다 —
  `const origin = typeof window !== "undefined" ? window.location.origin : ""` → `` `${origin}/r/${token}` ``
  → 그 값을 `<code>{shareUrl}</code>`로 **텍스트 렌더**. 이 카드는 클라 컴포넌트지만 **SSR도 된다**:
  서버에선 origin이 `""`라 `/r/…`, 클라에선 `https://…/r/…` → 같은 자리의 텍스트가 갈린다.
- **증상**: React가 그 subtree의 서버 HTML을 버리고 **클라에서 통째로 재생성**한다. 대개 화면은 결국 맞게
  그려져서 "콘솔만 빨간" 것처럼 보이지만, ① 첫 페인트 후 재렌더 비용(반응속도 1순위인 화면이다)
  ② 같은 오류로 **페이지 클릭이 전부 먹통**이 된 전례가 있다([[#75]] — localStorage를 lazy 초기값으로 읽었을 때).
- **고침**: **표시와 복사를 분리**한다.
  · 표시 = `process.env.NEXT_PUBLIC_APP_URL`(빌드 시 인라인 = 서버·클라 값이 같아 갈릴 수 없다)
  · 복사 = 클릭 핸들러에서 `window.location.origin`(그 순간 열려 있는 호스트라 커스텀 도메인·프리뷰에서도 유효)
- 🔑 **판별**: `window.*`에서 온 값이 **렌더 스코프**에 있으면 위험, **핸들러·useEffect 안**이면 안전하다.
  같은 파일 계열에서 [report-list.tsx](<src/app/(shell)/lesson-reports/_components/report-list.tsx>)도 같은
  `origin` 관용구를 쓰지만 **`openReport()` 핸들러 안에서만** 소비해서 문제가 없다 — 관용구가 아니라
  **소비 위치**가 기준이다.
- ⚠️ `suppressHydrationWarning`으로 덮지 말 것 — 경고만 지우고 subtree 재생성(비용)은 그대로다.
- ⚠️ 진단 시 배포 id(`?dpl=…`)만으로는 화면을 특정할 수 없다. 코드 쪽에서 **"클라 전용 값이 텍스트로 나가는 곳"**
  을 찾는 게 빠르다: `git grep -n "location\.origin" -- src`로 훑고 **렌더 스코프에 있는 것만** 남긴다.
## #109 — RLS 정책 **둘이 서로의 표를 조회**하면 무한 재귀(42P17)로 그 표가 통째로 안 읽힌다 (2026-08-14)

휴가관리(0210a)를 배포하자 `/leave` 창이 검은 화면 **"This page couldn't load"**. 표도 컬럼도 앱 코드도
멀쩡했다 — 죽은 건 **RLS**였다.

- **증상**: 그 표에 대한 **모든** select가 500. 자기 행만 읽어도, **0행이어도** 실패한다
  (재귀는 행 평가가 아니라 **쿼리 재작성 단계**에서 잡히기 때문). 화면엔 아무 단서도 안 남는다.
- **원인**: 정책 안의 서브쿼리에도 **그 표의 RLS가 다시 걸린다.**
  `leave_requests` 정책이 `leave_approvals`를 보고, `leave_approvals` 정책이 `leave_requests`를 보면
  A→B→A로 순환 → `42P17 infinite recursion detected in policy for relation "…"`.
  ⚠️ 자기 표를 참조하는 자기참조(같은 표 안의 계층 검사)도 같은 함정이다.
- **고침**: 교차 조회를 **`security definer` 함수로 감싼다**(0211a `auth_is_leave_approver` /
  `auth_is_leave_requester`). 함수 안에서는 소유자 권한으로 돌아 RLS가 다시 안 걸려 고리가 끊긴다.
  `auth_tenant_id()`(0001a)가 처음부터 쓰던 수법이다. 함수는 **자기 자신에 대한 사실만** 돌려주게 할 것
  (남의 데이터를 반환하면 RPC로 직접 불러 우회할 수 있다).
- 🔑 **왜 미리 못 잡았나 — service_role로는 재현이 안 된다.** service_role은 RLS를 우회해서
  조회가 **말짱하게 200**을 준다(실제로 표·컬럼 검증을 그렇게 통과시켰다). 검증하려면 **RLS를 받는 롤**로
  때려야 한다 → 배포된 앱의 **공개 anon 키**(client JS에 인라인돼 있다)로 `GET /rest/v1/<표>?select=id`
  한 방이면 42P17이 그대로 나온다. **새 표에 RLS를 붙였으면 anon으로 한 번 긁어 볼 것**(2초).
- ⚠️ **정책이 다른 표를 참조하면 그 표의 정책도 함께 읽어라.** 한쪽만 보면 순환이 안 보인다.
  단방향 참조(예: 정책이 `users`만 조회)는 안전 — 상대가 이쪽을 다시 안 보기 때문이다.
- ⚠️ 부수 교훈: **읽기 실패가 페이지 전체를 죽이게 두지 말 것.** 조회 throw가 서버 컴포넌트를 500으로
  만들면 창이 검게 죽어 원인이 화면에 한 글자도 안 남는다 → 한글 요약 배너 + 원문은 `title` 툴팁으로.

## #110 하단 고정(sticky) 바와 "스크롤 끝 여백"은 **같은 속성(main pb)을 반대로 요구한다** — 나중 규약이 앞 규약을 조용히 깬다 (2026-08-17)

원장 제보: 학원설정 셔틀 노선 편집기에서 하단 고정 저장 바("저장됨 · 테넌트 전체 적용 / 저장") **아래로
본문("+ 노선 추가" 버튼)이 그대로 보였다.** 저장 바가 있는 모든 창 폼이 같은 상태였다.

- **원인 = 규약 충돌.** `sticky bottom-0`은 스크롤포트의 **콘텐츠 박스 하단**에 붙는다 — 스크롤 컨테이너(셸
  `main`)가 `padding-bottom`을 가지면 바가 그 높이만큼 떠 있고, 그 틈으로 본문이 스크롤돼 지나간다.
  그래서 2026-07-10에 셸 main 3곳의 pb를 제거했었는데(design-conventions "저장 버튼 = sticky 바" 절),
  **2026-08-14에 "스크롤 끝이 빠듯하다"(강사 ECS 시트) 여백 요구로 같은 3곳에 `pb-8 lg:pb-10`을 되살리면서**
  이 전제가 깨졌다 — 저장 바 화면 전부가 한꺼번에 다시 떴다. 두 요구는 둘 다 정당하다: 저장 바 **없는**
  화면은 끝 여백이 필요하고, 저장 바 **있는** 화면은 바 자체가 끝이라 여백이 있으면 안 된다.
- **고침 = 마커 클래스 + 조건부 CSS 한 곳.** 바 루트에 `.sticky-save-bar` 마커를 달고(globals.css)
  `main:has(.sticky-save-bar) { padding-bottom: 0 }` — 저장 바가 있는 화면만 main의 pb가 자동으로 빠진다.
  **unlayered**(레이어 밖)에 둬서 Tailwind 유틸(@layer utilities의 `pb-8`·`lg:pb-10`)을 확실히 덮는다
  (이력서 `.resume-sheet` 모바일 재배치와 같은 수법). 셸 main 3곳(창·미니셸·풀셸)이 전부 `main` 요소라
  한 규칙으로 커버된다.
- **적용 지점**: [`FormActionBar`](../src/components/forms/form-action-bar.tsx)(공용 — 소비처 7곳 자동) +
  수제 바 2곳(시간표 [integrated-edit-board](../src/app/(shell)/timetable/_components/integrated-edit-board.tsx)·
  수업평가 [score-panel](../src/app/(shell)/class-review/_components/score-panel.tsx)).
  ⚠️ **새 하단 고정 저장 바를 만들면 반드시 `sticky-save-bar` 클래스를 붙일 것** — 안 붙이면 main pb 위에 떠서 같은 버그 재현.
- 🔑 **교훈: 한 속성(main의 pb)을 두 규약이 반대로 요구하면, 전역 값을 어느 한쪽으로 정하는 순간 다른 쪽이
  조용히 깨진다**(08-14 커밋은 저장 바 규약을 몰랐고, 화면상 즉사가 아니라 아무 에러도 없다). 화해는 조건부
  CSS(`:has` 마커) 한 곳 — 화면마다 제각각 패치(음수 margin·`after:` 덮개)는 이미 실패한 시도다
  (sticky 클램프는 margin으로 못 옮기고, 덮개는 스크롤 오버플로를 늘려 맨아래 점프 유발 — form-action-bar.tsx 주석).

## #111 **인라인 `<a>`에 건 `truncate`는 아무 일도 하지 않는다** — 옆 요소가 둘째 줄로 꺾여 그 행만 부푼다 (2026-08-19)

원장 제보(305·JJ실 표, 스크린샷): *"열 구분을 명확히해서 흐트러짐 수정하자. **이름에 문자가 붙는 학생 때문에
열이 흐트러짐**"* (`이서온A`·`김준영D` — 동명이인 구분 접미사).

- **먼저 아닌 것부터**: 표는 이미 `table-fixed` + `colgroup`이라 **열 폭은 멀쩡했다**(블록마다 폼도 같다 —
  자리로 걸러 오므로 전 블록 selfStudy). 즉 흐트러진 건 열이 아니라 **행 높이**였다.
- **원인**: 이름 칸이 `<div>`(블록) 안에 **인라인** `<a class="truncate">` + `inline-block` 배지였다.
  `truncate`는 `overflow:hidden`+`text-overflow:ellipsis`+`nowrap`인데 **`overflow`는 비치환 인라인 요소에
  적용되지 않는다**(CSS 2.1 — 적용 대상은 블록 컨테이너). 그래서 이름은 잘리지도 줄지도 않고, 이름+배지가
  칸 폭(112px)을 넘는 순간 **배지가 둘째 줄로 꺾여** 그 행만 22px → **37px**로 부풀었다.
  접미사 한 글자(≈9px)가 정확히 그 경계를 넘긴다: `이서온A`(48)+`중1 정규 A`(62)=114 → 꺾임 /
  `김현준B`(47)+`중2 심화`(51)=102 → 한 줄. 행마다 키가 다르니 옆 열 입력 상자들이 위아래로 밀려
  **"열이 흐트러진" 것처럼** 보인다.
- 🔑 **판별**: `truncate`를 걸었는데 말줄임(…)이 **한 번도 안 보이면** 그 요소는 인라인이다. 부모가 flex/grid면
  자식이 블록화(blockify)돼 같은 클래스가 **잘 동작한다** — 그래서 옆 화면(주간 로스터 `RosterNameCell`,
  `flex min-w-0`)은 멀쩡하고 복사해 온 이 칸만 깨졌다. **관용구가 아니라 부모의 display가 정한다.**
- **고침**: `flex min-w-0 items-center gap-1 overflow-hidden` + 이름 `shrink-0 whitespace-nowrap`(안 줄고
  안 꺾임) + 배지 `min-w-0 truncate`(먼저 줄고 전문은 `title`). 열 폭은 이름 몫+배지 몫을 더해 한 곳에서
  ([`seat-day-columns.ts`](../src/features/class-sheets/lib/seat-day-columns.ts)).
- ⚠️ **여기서 `flex-wrap`으로 접지 말 것** — 고정 폭 칸의 가로 나열은 `flex-wrap`으로 접는 게 규약이지만
  ([[#design-conventions]] 2026-08-04), 그건 **행 높이가 자유로운 표**의 이야기다. 접히는 순간 그 행만 두 줄이
  되어 같은 증상이 돌아온다. 밀도 높은 입력 표에서는 **한 줄 유지 + 보조 정보부터 truncate**가 맞다.
- ⚠️ **jsdom·타입체크·기존 테스트는 이걸 못 잡는다**(레이아웃을 계산하지 않는다). 확인은 실제 브라우저 측정
  (헤드리스 크롬으로 `getBoundingClientRect` — 행 높이 22 vs 37로 재현/검증)이고, 회귀 방지는 구조 가드
  (`shrink-0`·`min-w-0 truncate`·colgroup 폭)로 잠갔다.
## #112

**"대표 행 하나"를 최신순으로 집으면, 하루에 여러 번 있는 축에서 **엉뚱한 행**을 집는다** (2026-08-19)

보강↔결석 메모 연결이 결석 칸을 `(반,학생,날짜)` **최신 1건**으로 집고 나서 "이게 결석인가"를 확인했다.
한 반이 하루 여러 교시를 도는 곳에서는 그 1건이 **다른 교시의 출석**이라, 강사가 방금 목록에서 고른 결석을
눈앞에 두고 *"그날 결석 기록이 없습니다"* 라는 답을 받았다. 실측(프로덕션, 최근 120일): 같은 (반,학생,날짜)에
결석이 있는데 최신 행은 출석인 조합이 **21건**. 영어는 더 심해서 **하루 한 교시만 도는 반이 아예 없다**
(활성 반-요일 115개가 전부 2~4교시) — 즉 그 축에서는 사실상 상시 발생한다.

같은 파일의 자매 경로(`linkMakeupToAbsence`)는 한 단계 더 나빴다. **상태를 아예 안 보고** 최신 1건에 메모를
붙여서, 출석한 칸에 "N/N 보강 예정"이 적혔다.

🔑 **찾는 조건을 정렬로 흉내 내지 말 것.** "결석 칸"을 원하면 쿼리가 `status`로 좁혀야 한다. 최신순 정렬은
"여러 개 중 무엇을 먼저 볼까"이지 "무엇인가"의 답이 아니다.
⚠️ 좁힌 뒤에도 **여러 개가 남는다** — 하나만 골라야 한다면 그 규칙을 명시하고(이른 교시 순, 하루 단위 행 먼저)
**이미 처리된 행이 있으면 그 행이 이기게** 해야 멱등이 된다(두 번 눌러도 다른 교시에 같은 줄이 늘지 않는다).
⚠️ 같은 판정을 두 액션이 따로 구현하고 있었다 — 한쪽만 고치면 다른 쪽은 **조용히** 옛 동작으로 남는다.
공용 모듈(`src/features/attendance/server/absence-cell.ts`)로 뽑고 **양쪽이 그것을 쓰는지**를 가드로 잠근다.
⚠️ 조회 실패를 빈 배열로 삼키면 "그날 결석이 없다"는 **거짓 결론**이 나온다 — 이 증상의 뿌리가 정확히 그것이다.

**How to apply**: 하루에 여러 행이 생길 수 있는 축(교시·회차·세션)에서 "그날의 그 기록"을 찾을 때는
① 쿼리를 상태·종류로 좁히고 ② 남은 여럿 중 고르는 규칙을 명시하고 ③ 이미 처리된 행 우선(멱등) ④ 실패를 로그로.
## #113 **부분(partial) 유니크 인덱스는 `ON CONFLICT (컬럼들)`로 추론되지 않는다** — upsert가 전부 42P10 (2026-08-19)

셔틀 등하원 표(0225a)에 "회차가 지워진 옛 기록은 유니크 밖으로 빼자"는 생각으로 부분 유니크 인덱스를
걸었다: `unique (tenant_id, boarded_on, student_id, run_id, io_kind) where run_id is not null`.
앱은 그 축으로 `upsert(onConflict: "tenant_id,boarded_on,student_id,run_id,io_kind")` 한다.

- **증상**: 등하원 찍기가 **한 건도 안 된다** —
  `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification`.
  Postgres는 부분 유니크 인덱스를 추론하려면 문장에 **인덱스 술어와 같은 WHERE**가 있어야 하는데,
  PostgREST(supabase-js `upsert`)는 `index_predicate`를 붙여주지 않는다.
- **실증**(임시 테이블, 운영 표 무손상):
  부분 인덱스 + `ON CONFLICT (a,b)` → ❌ 42P10 · 비부분 인덱스 + 같은 문장 → ✅ 통과.
- **고침 = 술어를 뺀다.** 나눠 놓고 싶던 그 성질(NULL 행은 서로 충돌하지 않음)은 **일반 유니크
  인덱스가 이미 준다** — NULL은 NULL과 같지 않아 각자 남는다(같은 실증에서 행 2개 유지 확인).
  즉 `where col is not null`은 이 경우 **얻는 것 없이 upsert만 깨뜨리는 술어**였다.
- ⚠️ **부분 인덱스 자체가 나쁜 게 아니다** — 앱이 그 축으로 upsert하지 **않을 때만** 쓸 것.
  이 프로젝트의 `shuttle_stops (tenant_id, btrim(name)) where not archived`는 upsert 대상이 아니고
  `on conflict do nothing`(타겟 없음)만 쓰므로 안전하다(타겟 없는 ON CONFLICT는 추론이 필요 없다).
- 🔑 **판별 한 줄**: 새 유니크 인덱스에 `WHERE`를 붙이려 할 때, 그 컬럼 조합으로 **`upsert(onConflict)`를
  쓸 계획이 있는지** 먼저 보라. 있으면 술어를 빼거나, 정말 필요하면 raw SQL RPC로 술어를 함께 보낸다.
- ⚠️ 타입체크·lint·테스트가 전부 통과한다 — **실행해야만** 드러난다(표가 아직 없으면 실행도 못 한다).
  마이그레이션을 손으로 적용하는 이 프로젝트에서는 특히 "적용 후 첫 클릭"에서 터진다.

## #114 카드 **테두리가 `border`가 아니라 그림자 링**이라, 스크롤 컨테이너가 좌·우를 깎아낸다 (2026-08-19)

원장 제보: *"테두리들이 전반적으로 깨져보이는데?"* → *"테두리가 왜 이렇게 짤려? 일부 테두리가 여백 때문에
안 보이는 거 같은데?"* 맞다. 셔틀 편성의 회차·정류장 카드가 **왼쪽·오른쪽 세로선만** 사라져 있었다.

- **원인**: 팔레트 v4에서 카드 432곳의 테두리를 `border`가 아니라 **`--shadow-card`의 첫 레이어
  `0 0 0 1px`(링)** 으로 바꿨다(박스가 1px 커지면 그리드·sticky·표 높이가 전부 밀려서). 링은 **박스 밖**에
  그려진다. 그런데 그 카드를 담은 열이 `overflow-y-auto`였다 — **CSS는 한 축만 `visible`일 수 없어**
  `overflow-x`도 자동으로 `auto`가 되고(실측 `getComputedStyle(col).overflowX === "auto"`), 카드가 열 폭을
  꽉 채우고 있으니 **박스 밖 1px이 잘려 나간다**. 위·아래 링은 스크롤 영역 안이라 살아 있어서, 증상이
  "테두리 일부만 없다 = 깨져 보인다"로 나온다.
- **고침**: 스크롤 컨테이너에 **안쪽 여백**(`px-1 py-0.5` 정도)을 준다. 컨테이너 안 요소가 다 같이 밀리므로
  헤더·본문 줄맞춤은 그대로다. (`overflow-x: visible`로는 못 고친다 — 위 CSS 규칙 때문에 무시된다.)
- 🔑 **판별**: 의심 카드에서 `getComputedStyle(card).boxShadow`에 `0px 0px 0px 1px`가 있고
  `getComputedStyle(scrollParent).overflowX !== "visible"`이면 이 함정이다. 카드의 `borderTopWidth`는 `0px`다.
- ⚠️ **DPR 함정과 헷갈리지 말 것**: 윈도우 배율 125%(DPR 1.25)에서 Chrome은 **`border`는 정수 디바이스
  픽셀로 스냅**해(1px → computed `0.8px`) 또렷하게 그리지만, **`box-shadow` 링은 스냅하지 않아** 1.25px로
  안티앨리어싱된다. 그래서 같은 화면에서 버튼 테두리는 또렷하고 카드 테두리만 흐릿해 "선 굵기가 제각각"으로
  보인다 — 이건 렌더링 특성이지 버그가 아니다(잘림과는 다른 문제).
- ⚠️ **새 화면에서 카드를 스크롤 컨테이너에 직접 담을 때마다 재발한다.** 셔틀에서는
  [run-column](<../src/app/(shell)/shuttle/_components/run-column.tsx>)·[stop-column](<../src/app/(shell)/shuttle/_components/stop-column.tsx>)
  두 곳을 고쳤다.

## #115 같은 사실을 **FK와 텍스트 라벨 두 벌**로 들면, 한쪽이 비는 순간 표시가 갈린다 (2026-08-25)

원장 제보: *"세팅이 본원302로 되어있는데도 강의실이 302로 되어있어서 3층에 배정 안되어있음."* 오늘의 출결
좌석표에 **`본원 3층`(본원301·본원303)과 별도로 `3층`(302)** 이 따로 서 있었다.

- **원인 ①(값)**: 그 교시(`중등E_초등 브릿지 C` 월 17:20)의 `class_schedules` 행이 **`classroom_id`는 비고
  `slot_room_label`만 `302`** 였다. 강의실 이름은 [`resolveRoomName`](<../src/features/attendance/live/seating-floors.ts>)이
  **① 슬롯 FK 이름 → ② 슬롯 텍스트 라벨 → ③ 반 기본 강의실** 순으로 고르는데, ①이 없어 ②가 나왔다.
  반 세팅(`classes.classroom_id`)은 내내 `본원302`였지만 **②가 ③보다 앞이라** 거기까지 내려가지 않는다
  (그 순서는 의도다 — 라벨만 있는 이식분·요일별 방 변경이 반 기본값에 덮이면 안 된다).
- **원인 ②(묶음)**: [`roomGroupOf`](<../src/features/timetable/lib/room-groups.ts>)는 **`건물명+호수`**를 읽는다.
  `본원302` → 건물 `본원`·층 3. `302`는 건물명이 없어 파싱에 실패하고 `seatingFloorOf`의 맨숫자 폴백으로
  떨어져 **건물 `호수`·라벨 `3층`** 이 된다 → 그룹 키가 `본원|3` ≠ `호수|3` 이라 같은 층인데 묶음이 둘.
- **어쩌다 FK가 비었나**: [`preserveScheduleFields`](<../src/features/classes/schedule-preserve.ts>)는
  `slot_room_label`을 **기존 행에서 승계**하지만 `classroomId`는 **폼이 보낸 값을 그대로** 쓴다. 반 수정 폼의
  교시별 강의실 칸이 빈 채로 제출되면 그 순간부터 **FK 없는 구간이 하루 열린다**(감사로그 `class_update`
  08-24 17:57 KST). 다음 저장에서 다시 채워졌지만, **행 분할([[#88]])이라 그 하루짜리 행은 이력으로 영구히
  남는다** — 날짜를 그날로 놓고 보면 계속 갈라져 보인다. 실측 전수: 시간표 커토버(07-03) 이후 이 상태의
  행은 **딱 1건**이라 코드가 매번 만드는 버그는 아니다.
- **고침**: [`canonicalRoomName`](<../src/features/attendance/live/seating-floors.ts>) — 라벨 폴백을
  **등록된 강의실 이름으로 맞춘 뒤** 내보낸다(`302` → `본원302`). ⚠️ **애매하면 손대지 않는다**(`602`는
  `바른602`·`본원602` 둘에 걸린다 — 임의로 고르면 없는 건물로 방을 옮기는 셈이라 갈라진 묶음보다 나쁘다).
  ⚠️ 접미사 앞이 숫자인 후보(`본원1302`)는 제외. 데이터도 그 1행을 `본원302`로 보정했다.
- 🔑 **일반화**: 같은 사실을 **FK(정본)와 텍스트(표시)** 두 벌로 들면, 한쪽이 비는 날 화면이 갈린다.
  표시 문자열을 만들 때 **폴백 값도 정본의 형식으로 정규화**해서 내보낼 것 — 안 하면 같은 방인데 이름이
  둘이라 **묶음뿐 아니라 "같은 방인가" 비교까지 틀어진다**(`spanAdjacentEnd`의 연강 이어붙이기가 그렇다).
- ⚠️ 라벨 `302`·`305`·`603` 같은 **맨숫자는 영어 시트 구조 가져오기가 넣는다**(`slotRoomLabel: p.room`).
  시트 표기를 그대로 보존하는 게 맞으니 라벨은 두고, **읽는 쪽에서 맞춘다**.

## #116 좁은 `table-fixed` 퍼센트 칸에서 **`whitespace-nowrap` 라벨은 접지도 자르지도 못하고 흘러넘친다** — 게다가 공유 클래스 상수에서 값을 **빼면** 충돌 유틸의 승자가 조용히 뒤바뀐다 (2026-08-25)

원장 제보(지출결의서): `사업자 / 작성자`가 옆 값 칸 위로 흐르고 `총액(VAT포함)`이 표 오른쪽 밖으로 나갔다.

- **원인**: 라벨 칸이 값 칸과 **같은 `px-3`**(좌우 24px)을 쓰는데, 칸 폭은 `table-fixed` + `<colgroup>` 퍼센트라
  내용과 무관하게 고정된다. `w-[15%]` × 문서 680px = 102px → 내용 폭 76px인데 `사업자 / 작성자`는 **72.2px**
  (bold 12px 실측), `총액(VAT포함)`은 14% 칸에서 **73.6px vs 68.7px**. `whitespace-nowrap`이라 줄바꿈이 막혀 있고
  자르는 규칙도 없어 **그대로 넘친다**.
- 🔑 **풀 폭에서는 재현이 안 된다** — 넘친 만큼을 먼저 **패딩이 먹기 때문**이다(760px에선 "빠듯"해 보일 뿐).
  문서 폭이 좁아질수록(창=iframe) 커져서 **~650px 이하에서 표 테두리 밖**으로 나간다. 실측 스윕(문서 폭):
  496px = 라벨 8건 넘침·3건이 칸 밖 / 576px = 4건·3건 / 656px = 3건·1건 / 736px 이상 = 2건(패딩 안). 
  ⚠️ 화면 하나만 보고 "재현 안 됨"으로 닫지 말 것 — **폭을 쓸어서** 볼 것.
- **고침**: 라벨 칸만 `whitespace-nowrap` → **`break-keep`**(넘치면 한글 어절 단위로 접는다) + 여백 `px-1.5`,
  값 칸 여백은 그대로. 🔴 **`truncate`/`overflow-hidden`으로 덮지 말 것** — 종이 서식에서 잘린 라벨
  (`사업자 / 작성…`)은 넘치는 것보다 나쁘다. 그래도 두 줄이 되면 `<colgroup>` 퍼센트를 조정(합 100% 유지).
  · 전역 `body { word-break: keep-all; overflow-wrap: anywhere }`가 이미 깔려 있어, 접을 자리가 없는 라벨
  (`No.`)도 **칸 안에서** 쪼개질 뿐 넘치지 않는다(마지막 안전망).
- 🔴🔴 **함께 밟은 두 번째 함정 — 공유 클래스 상수를 쪼갤 때 값을 빼면 충돌 유틸의 승자가 뒤집힌다.**
  호출부가 `${상수} px-5 py-0.5`처럼 덮어쓰고 있으면, 승자는 **클래스 문자열 순서가 아니라 생성된 CSS 순서**가
  정한다. 상수에서 `py-2`를 빼자(있을 땐 `py-2`가 이기고 있었다) `py-0.5`가 이겨 **결재 도장칸 머리 행이
  34px→22px로 납작**해졌다 — 타입체크·린트·테스트 전부 통과하고, 고치려던 표가 아니라 **옆 표**가 바뀌었다.
  🔑 판별은 추론이 아니라 **실측**(변경 전/후 같은 폭에서 행 높이·셀 폭을 재서 대조). 안전한 리팩터는
  **옛 문자열을 글자 그대로 떼어 두는 것**(값 하나도 빼지 말 것).
- ⚠️ 좁은 화면(폰 375px)에서 **값 칸**(`num whitespace-nowrap` 금액·수량)이 겹치는 건 별개의 미해결 건이다 —
  종이 서식 표를 카드로 쌓는 `data-label` 규약(`design-conventions.md`)이 이 문서엔 아직 없다.

## #117 한 배열에 **모양이 셋인 결과**를 담으면 `!x.ok`가 성공을 실패로 뒤집는다 (2026-08-25)

원장 제보: *"사유가 없음으로 나오는데 발송 실패 확인해봐"* → *"근데 실제로는 발송했어"* → *"크리티컬 오류.
실제 사용자는 발송안됐다고 착각함."* 발송 콘솔 한 줄이 **"발송 완료 · 실패 7 · 사유 없음"** 이었다.

- **사실**: 7명 전원 게시 성공(ClassNote에 글 7개 실재, `reports[]`에 id·url 보유). 같은 행에 학생 이름
  링크 7개가 붙어 있는데 옆에서 "실패 7"이라고 말하는 **자기모순**이었다.
- **원인**: `classnote_notices.results[]`는 **용도가 셋이고 모양이 다르다** —
  게시 `{ok, board, reports[]}` · **수정 `{board, reports[]}`** · **회수 `{board, revoked[]}`**.
  워커 `editNotice`가 `out.push({ board: r.board, reports: patched })`로 **새로 만들어** `ok`를 흘렸고,
  화면은 `filter((x) => !x.ok)` — `!undefined === true`라 **전건이 실패로 뒤집혔다.** `note`도 없어
  사유가 "없음". 상태는 `success`라 라벨은 "발송 완료"(그래서 모순된 한 줄).
- 🔴 **왜 크리티컬인가**: 발송자가 "안 갔다"고 알고 **재발송**하면 학부모 알림장에 같은 글이 2개 남는다.
  회수는 id를 캡처한 쪽만 지우므로 되돌릴 수 없다. 화면이 사실과 다른 말을 하는 것 자체가 사고다.
- 🔑 **이미 한 번 잡힌 함정이다**: DB 알림 트리거 0144a가 **2026-07-23 회수 오탐**(회수 2건이 '사유없음
  실패')을 겪고 `r ? 'ok' and (r->>'ok')::boolean is not true`로 고쳐 두었다. **트리거만 고치고 화면은
  안 고쳤다** — 그래서 벨은 조용한데(정상) 화면만 거짓말했다. 실제로 이번 건의 알림은 0건이다.
- **고침**: ① 규약을 순수 모듈 [`noticeFailures`](<../src/features/report-admin/notice-failures.ts>) 한 곳으로
  (`ok` 키가 **있고** true가 아닌 것만 실패 = 0144a와 같은 판정) — 이건 **이미 저장된 행까지 즉시** 고친다
  (전수 8건: 회수 7 + 수정 1). ② 워커 `editNotice`는 `{...r, reports: patched}`로 원본을 이어받아 `ok`를 보존.
- ⚠️ **`revokeNotice`엔 그 스프레드를 따라 하지 말 것** — 회수는 `reports`를 `revoked`로 **갈아끼우는**
  것이라 원본을 이어받으면 `reports`가 남아 `flattenNoticeReportLinks`가 그쪽을 먼저 읽어 **회수 취소선이 죽는다.**
- ⚠️ `results`는 jsonb라 원소가 객체가 아닐 수 있다 — `"ok" in x`를 typeof로 감싸지 않으면 **한 줄이
  공지 이력 화면 전체를 죽인다.**
- 🔑 **일반화**: 한 컬럼에 **단계마다 다른 모양**을 쌓으면, 읽는 쪽의 `!x.flag` 같은 truthy 검사가 조용히
  뒤집힌다. 판정은 **"키가 있는가 + 값이 무엇인가"** 로, 그리고 **화면·트리거·워커가 같은 단일 소스**로.

## #118 **크레딧 소진은 400이라 "폴백할 오류"로 안 잡힌다** — 폴백 사다리가 있는데도 기능이 이틀간 조용히 죽었다 (2026-08-28)

**증상**: 강사 제보 *"수업보고서에서 '내일 보강'이라는 멘트가 안 적힌다"*. 특정 문구가 차단된 것처럼 보였다
(멘트 차단 목록은 코드 어디에도 없다).

**실제**: 2026-08-27 16:08(KST)부터 Anthropic 크레딧이 바닥나 **멘트 AI가 전건 실패**했다
(`ai_usage_logs`: 8/27 77건·8/28 32건 전부 `ok=false`, 8/28 일일 브리핑도). 오류는

```
400 {"type":"error","error":{"type":"invalid_request_error",
     "message":"Your credit balance is too low to access the Anthropic API. …"}}
```

🔑 **폴백 사다리는 그때도 있었다** — `isRetryableProviderError`가 401·403·429·키무효 문구만 봐서
**400인 이 오류가 사다리를 안 탔을 뿐이다.** 그래서 다른 provider를 시도조차 않고 곧장 호출부 폴백
(템플릿)으로 떨어졌다. 즉 "폴백이 있으니 무중단"이라는 안전장치가 **판정 하나 때문에 통째로 무효**였다.

**두 번째 피해 — 폴백이 사실을 흘렸다**: 그 템플릿(`buildSubjectReport`)은
① 특이사항 칸이 **아예 없었고**(그래서 "내일 4시에 보강입니다"가 증발 — 학부모는 보강을 모른다)
② 태도·점수·과제를 **학생 단위 값**으로 읽었다(2026-08-13에 행 단위로 갈렸는데 AI 경로만 따라갔다).
실측(8/28 김근호): 21/25·매우 좋음·100%가 다 입력됐는데 나간 문구는 진도 한 줄 + 과제 한 줄뿐.
이렇게 나간 보고서가 **8/27 40건 · 8/28 9건**이고 전부 학부모에게 발송 완료됐다.

**고침**
- `isCreditExhaustedError` 신설 → `isRetryableProviderError`에 포함. provider마다 모양이 다르다:
  Anthropic=400 + `credit balance` / DeepSeek=**402** `Insufficient Balance` / OpenAI 호환=429 `insufficient_quota`
  → **상태코드와 문구를 둘 다** 본다. 오탐의 대가는 "다음 provider 한 번 더 시도"뿐이라 넉넉히 잡는다.
- 사다리를 **anthropic → deepseek → upstage(Solar)** 로 명시(`FALLBACK_LADDER`, 원장 2026-08-28).
- 마지막 후보까지 막히면 `rethrowAi`가 **한글로** "AI 잔액 소진 … 크레딧을 충전해야 합니다"(429의 "잠시 후
  다시"와 섞으면 관리자가 기다리기만 한다).
- 폴백 템플릿이 특이사항을 **원문 그대로**(줄 단위, `flatten` 금지 — 나열형이라 ", "로 이으면 뭉개진다) 싣고
  평가값을 `resolveRowFields`로 읽는다.

⚠️ **폴백이 있는 기능은 실패율을 따로 봐야 보인다**([[#89]]와 같은 결) — 화면은 매일 멀쩡했고, 강사가 문구를
이상히 여겨 제보할 때까지 아무도 몰랐다. 판별 질의는 `ai_usage_logs`를 **날짜×feature×ok**로 세는 것.
⚠️ **폴백 산출물은 원본의 부분집합이 아니어야 한다** — 폴백이 원본보다 **적게 말하면** 그 차이가 곧 조용한
사실 손실이다. 새 입력 칸을 만들 때 AI 경로만 배선하고 템플릿을 잊으면 이 사고가 그대로 재현된다.
⚠️ plain object로 오는 오류는 `String(err)`가 `"[object Object]"`라 **어떤 문구 판정에도 안 걸린다**
(`providerErrorText`가 `message`를 먼저 읽는다).

## #119 **`"use server"` 파일은 async 함수만 export할 수 있다** — typecheck·lint·테스트를 다 통과하고 **빌드만** 깨진다 (2026-08-29)

**증상.** 배포가 실패한다. 로컬에선 아무 신호가 없다 — `tsc --noEmit` 0, `eslint` 0, `vitest` 6,832개 전부 초록.

**무엇을 했나.** 수강 관련 DB 오류를 한글로 바꾸는 동기 헬퍼 `toKoreanDbError`가
`features/enrollments/server/actions.ts` 안에 있었고, 다른 화면에서도 쓰려고 `export`를 붙였다.
그 파일 맨 위는 `"use server"`다.

**왜.** `"use server"` 파일의 export는 전부 **클라이언트에서 부를 수 있는 서버 액션**이 된다 —
네트워크 경계를 넘으므로 반드시 Promise를 돌려줘야 한다. 그래서 번들러가 **빌드 시점에** 동기 export를
거절한다. 타입 시스템은 이걸 모르고(그냥 함수다), lint 규칙도 없다.

**고침.** 공유용 동기 헬퍼는 서버 액션 파일 **밖**의 평범한 모듈로 옮긴다
([`features/enrollments/db-errors.ts`](../src/features/enrollments/db-errors.ts)).
⚠️ 거기에 `import "server-only"`를 붙이지 말 것 — 순수 문자열 매핑이라 클라가 import해도 안전해야 한다([[#61]]).

**가드.** [`src/lib/server-action-exports.test.ts`](../src/lib/server-action-exports.test.ts)가 `src` 전체를 훑어
`"use server"` 파일의 값 export가 전부 async인지 검사한다(타입 export는 컴파일에서 지워지므로 제외).

🔑 **교훈**: 이 리포에서 **빌드만 잡는 오류 부류**가 있다([[#61]]과 같은 결). 로컬 게이트 3종이 초록이어도
`"use server"`·`"use client"` 경계를 건드렸으면 배포 결과를 확인할 것 —
`gh api .../status --jq '.statuses[].description'`([[#85]]).

## #120 **유니크 인덱스에 `WHERE is_active`가 없으면 폐지된 반이 이름을 붙든다** — 예약은 성사되고 그날 cron만 조용히 실패한다 (2026-08-29)

**증상.** 9/1로 예약한 반 이름 변경 17건 중 **2건만** 적용되지 않는다. 화면·로그 어디에도 경고가 없고,
cron은 다음 날 다시 시도하지도 않는다.

**왜.** `classes_tenant_name_subject_idx (tenant_id, class_name, subject)`엔 술어가 없어서
**폐지(`is_active=false`)·종강된 반도 이름 한 칸을 차지한다.** 이 학원은 레벨 사다리가 해마다 회전해
이름을 재활용하므로(`PJ1→PJ2`, `KW2→KW3`) 지난 학기 종강 반이 그 이름을 쥐고 있으면 개명이 **23505**로
거절된다. 실측: 비활성이 쥔 영어 반 이름이 **19개**.

**세 겹으로 숨는다.**
1. 컷오버의 `--rename` 검사가 **활성 반만** 봐서 예약이 그대로 성사된다.
2. cron(`apply-due-class-updates`)은 항목마다 `continue`라 **나머지는 적용된다** → 15/17만 바뀐다.
3. cron은 실패해도 `class_updates_applied` **표식을 남긴다**(사람이 손댄 값을 덮지 않으려는 의도) →
   **영원히 재시도하지 않는다.**

**어떻게 잡았나.** 활성 반만 보는 시뮬레이션은 "겹침 0 ✅"이라고 했다 — 실제로 잡은 건 **cron이 하는 일을
그대로 트랜잭션 안에서 돌려 본 것**이다(끝에 throw로 롤백). 🔑 제약이 걸린 쓰기는 **모사하지 말고 실행**할 것.

**고침.** ① 컷오버 `--rename` 검사가 **비활성까지** 본다(예약 시점에 중단 + 무엇을 하라는지 안내).
② [`free-class-name.mts`](../scripts/_english_sync/free-class-name.mts)로 폐지 반 이름을 보관 접미사로 비운다
(`PJ2` → `PJ2 (~2026-07)`). 반 id가 키라 수강·성적·출결은 그대로 붙어 있다.

③ (2026-10-01) **반 수정·생성 화면은 앱이 알린다** — 23505면 `같은 과목에 중복되는 반 이름이 있습니다. (종강 처리된 반)`처럼
그 반의 상태를 반 이름 칸에 적고, 종강·폐지 반이면 "그 반 이름을 'PL5 (~2026-07)'로 바꾸고 저장" 버튼(관리자만)을 누를 때만
앱이 그 반 이름을 비운다([`class-name-guard.ts`](../src/features/classes/server/class-name-guard.ts)). 🔴 말없이 자동으로 비우지 않는다(원장).
⚠️ cron·시간표 가져오기는 그대로 — 화면이 없어 여전히 실패하고 Vercel 함수 로그(`reportError`, where=`apply-due-class-updates:update`)에만 남는다.

⚠️ **근본 해결은 부분 유니크 인덱스**(`WHERE is_active`)지만 보류 — 그러면 활성/비활성 동명이 가능해져
이름으로 반을 찾는 곳(컷오버의 폐지 반 재활성 조회 등)이 **어느 행을 집을지 모호**해진다. 전수 감사 후 결정.
(⚠️ 다행히 그 인덱스를 `on conflict` 타겟으로 쓰는 upsert는 없다 — [[#113]] 위험은 없음.)

---

## #121 **내부 기준의 이름을 그대로 화면 문구로 쓰면 거짓말이 된다** — 숫자는 맞는데 시각이 틀렸다 (2026-08-30)

**증상**: 원장 제보 *"2시간 뒤 1개 반이 말이 안 됨. 일요일 새벽 2시에 수업이 없는데 2시간 뒤래."*
좌석표 머리줄이 `지금 수업 중 0개 반 · 2시간 뒤 1개 반`.

**실제**: 그날(일) 수업은 **있었다** — `고등M_일 개별진도` 14:00~17:00(3월부터 매주, 학생 4명. "입력 0/4"의
그 4다). 새벽 2시 기준으로 **12시간 뒤**다. 즉 **개수는 정확했고 시각만 거짓**이었다.

🔑 원인은 계산이 아니라 **작명**이다. 좌석표는 `SOON_WINDOW_MIN = 120`(2시간) 앞창 안에 시작하는 수업만
펼치고 나머지를 `later`로 접는데, 그 머리줄 문구를 **앞창의 이름을 빌려** `2시간 뒤 N개 반`이라고 적었다.
`later`의 뜻은 "2시간 뒤에 시작한다"가 아니라 **"앞창 밖이라 접었다"**이고, 둘은 앞창 경계에서만 겹친다
(13:00에 15:30 수업이면 우연히 그럴듯해 보이고, 새벽 2시엔 대놓고 틀린다).

**고침**: 문구가 **시각을 지어내지 않게** 한다 — 접힌 수업들의 **가장 이른 시작 시각**을 적고
(`14:00부터 1개 반`), 모르면 시각을 빼고 센다(`이후 1개 반`). 판정·문구는
[`laterStartPrefix`](../src/features/attendance/live/now-band.ts) 단일 소스 + Vitest,
좌석표에 `2시간 뒤`가 되살아나지 않게 구조 가드도 함께.

⚠️ **일반화**: 임계값·창(window)·버킷의 **이름은 개발자 어휘**다. 화면에 그대로 내보내면
"유예 10분"·"최근 30일"처럼 사용자가 **사실로 읽는 수치**가 된다. 화면엔 그 기준이 만들어 낸 **실제 값**
(시각·날짜·건수)을 적고, 기준 이름은 주석·코드에만 둘 것.
⚠️ 이런 문구 버그는 **테스트가 안 잡는다**(숫자는 맞으니까) — 사람이 그 시각에 화면을 봐야 드러난다.

---

## #122 **번호만 적힌 시트 값은 "보관된" 후보에도 붙는다** — 원장이 3주 전에 닫아 둔 강의실에 9월 배치가 들어갔다 (2026-08-31)

**증상**: 원장 제보 *"바른602는 더이상 사용하지 않는 강의실임. 절대 그럴일이 없어야함."* 9/1 배치 6칸과
반 하나의 기본 강의실이 `바른602`에 붙어 있었다.

**실제**: 마스터 시트는 강의실을 **번호만으로** 적는다(`PL4/ 602`). 매칭은 이름에서 3자리 숫자를 뽑아
`번호 → 방` Map을 만드는데, 그 번호를 쓰는 방이 둘이면(`바른602`·`본원602`) **뒤에 온 것이 앞을 덮는다** —
어느 쪽에 붙을지가 **강의실 목록 순서**로 정해진다. 그래서 같은 라벨 `602`가 어떤 행은 본원602,
어떤 행은 바른602로 갈려 있었다(실측 17 vs 6).

🔑 **표시는 이미 되어 있었다.** `classrooms.archived_at`이 있고 원장이 **2026-08-06에 바른602를 보관**해
뒀다. 반 수정 드롭다운(`queries.ts` 강의실 목록)은 그 필터를 걸고 있었는데, **가져오기의 후보 목록만**
안 걸고 전부 읽고 있었다. 즉 사람은 "안 쓴다"고 눌러 뒀고 기계만 그걸 안 봤다.

**고침**: 앱 `loadStructureContext`와 스크립트 `loadContext`의 **강의실 후보 조회**에 `archived_at is null`.
가드(`archived-room-wiring.test.ts`)가 두 경로를 함께 잠근다(한쪽만 걸면 앱과 스크립트 결과가 갈린다).

⚠️ **id→이름 조회에는 걸지 말 것** — 좌석표·오늘 시트는 이미 배정된 방의 이름을 되읽는 자리라,
거기까지 거르면 지난 배치가 쓰던 보관 강의실이 화면에서 **빈칸**이 된다. 필터는 **후보를 고르는 곳**에만.
⚠️ 일반화: 사용자가 **자유 텍스트/약칭으로 적는 값**(방 번호·과목 약자·강사 닉네임)을 id로 바꿀 때는
"후보가 둘 이상이면 무엇으로 가를 것인가"를 **먼저 정해야 한다**. 안 정하면 목록 순서가 대신 정한다.

---

## #123 **"어제까지 마감·오늘부터 새로"가 미래 예약과 만나면 하루가 빈다** (2026-08-31, 미해결)

**증상**: 원장 제보 *"ecs는 왜 월요일 밖에 안보이지? 9/1 예약 걸어놨는데 원래 월목 수업인데."*
`중고E_중1 의치대`가 그 주 시트에서 목요일만 보였다.

**실제**: 반 수정은 이력을 남기려고 옛 슬롯을 **어제까지**로 마감하고 새 슬롯을 **오늘부터** 연다
(`planSlotArchives`, 2026-08-04). 그런데 이 반은 새 배치가 이미 **9/1로 예약**돼 있었다:

```
옛 배치  … ~ 8/30 마감   ← 오늘(8/31) 수정이 여기까지 당김
8/31                    ← 아무 행도 없다
새 배치  9/1 ~
```

그 주의 월요일이 **8/31 하나뿐**이라 그날 3교시가 통째로 화면에서 사라졌다(출석부·ECS 모두).
목요일은 다음 목요일이 9/3이라 새 배치가 덮어 멀쩡했고, 그래서 "목요일만 남은" 모양이 됐다.

**응급 처치**: 옛 행의 `valid_to`를 컷오버가 정한 **8/31**로 되돌렸다(6행 + 감사로그).

🔴 **근본 고침은 아직 안 했다.** 예약이 걸린 반은 새 행을 **오늘부터** 열고 **예약일 하루 전**에서
닫아야 한다(`valid_to = 예약일 − 1`). 지금은 예약의 존재를 모른 채 "오늘부터 무기한"만 생각한다.
⚠️ 이 함정은 **적용일 전날에 그 반을 수정할 때만** 터진다 — 평소엔 안 보이다가 컷오버 직전에 나온다.

---

## #124 **한 칸에 값이 둘일 수 있는데 첫 조각만 읽으면 나머지가 조용히 사라진다** — 합반 반이 시간표에서 통째로 없어졌다 (2026-08-31)

**증상**: 원장 제보 *"여긴 또 왜 안뜨나?"* → *"합반으로 존재하는데 뭔소리야"*.
`고등E_중3 최상위`가 9월 시간표에 **JJ 2칸만** 떴다(재적 학생이 있는 반인데 담임 수업이 0칸).

**실제**: 마스터 시트는 합반을 **한 칸에 두 반 이름**으로 적는다 —
`중등E_중3 정규 A/ 고등E_중3 최상위/ 304`. 그런데 파서의 `className()`은
`raw.split("/")[0]` 로 **첫 조각만** 취했다. 그래서 둘째 반은 파싱 결과에 **존재조차 하지 않았고**,
가져오기는 그걸 "시트에 없는 슬롯"으로 읽어 **9/1부터 마감**까지 했다 — 없는 것으로 만든 셈이다.
실측(9월 탭): 합반 5칸에서 `고등E_중3 최상위` 4칸 · `중등E_초5 MED` 1칸이 버려졌다.

🔑 **드러나기 어려운 이유**: 첫 반은 멀쩡히 들어가고 경고도 안 난다. 둘째 반이 **다른 칸에도 나오면**
그 반은 살아 있어서(초5 MED가 그랬다) 아무도 모른다. `고등E_중3 최상위`처럼 **합반 칸에만 있는 반**이
있어야 비로소 "그 반이 통째로 비었다"로 보인다.

**고침**: `classNames(raw)` — `/`로 자른 조각 중 **방번호(3자리·SKY)와 자리 칸의 학생 수를 뺀 전부**가
반 이름이고, **반마다 슬롯을 만든다**(같은 시간·같은 방·같은 강사). 충돌 검사는 이미 "같은 방·같은
강사 = 합반(경고만)"이라 그대로 통과한다 — 그게 원장이 8/28에 정한 규칙이다.

⚠️ **일반화**: 사람이 자유롭게 적는 칸에서 **구분자로 자른 첫 조각만** 쓰는 코드는, 그 칸에 값이
둘 이상 들어오는 날 나머지를 **에러 없이** 버린다. 자를 거면 **전부 처리하거나, 둘 이상이면 경고**할 것.
[[#122]](번호만 적힌 값이 후보 둘에 걸림)와 같은 가족이다 — 자유 입력을 id로 바꾸는 자리의 함정.


## #125 **넓은 SQL 프리필터로 끝내면 반열림 종료 경계의 하루가 겹친다** — 반이동한 학생이 옛 반·새 반 양쪽 명단에 섰다 (2026-09-01)

원장 제보: *"9/1 이동건에 대해서 JJ / LAB 출석부가 일치하지 않는다는데 확인"*. 실제 버그였고
**이동 적용일 하루만** 나서, 다음 날이면 저절로 사라져 재현이 안 된다.

**증상**: 9/1자 시간표 가져오기로 12명이 반을 옮겼는데, 그날 자리 출석부에 **옛 반과 새 반 양쪽**으로
섰다(JJ 87행 중 8 · LAB 62행 중 4). 다섯은 `중등E_초6 MED a`와 `b`에 동시에, 셋은 **교시까지 다른**
옛 칸에(15:00에 왔다가 정작 16:20 자기 칸엔 안 온 것처럼 보인다), 한 명은 **오늘 자리 수업이 아예
없는데** LAB 16:20에 서 있었다. 반 상세·수업목록·반별 출석부는 정상이라 화면끼리 갈렸다.

**원인**: 이동 RPC(`move_enrollments_batch`)는 옛 수강을 `end_date = 적용일`로 닫는다. DB의 GiST
`enrollments_no_overlap`이 `daterange(start, end, '[)')`라 **그날은 이미 새 반**이고, 이건 정상 규약이다.
앱에도 그 규약의 단일 소스가 있다 — `isEnrollmentEndedOn`(반이동 `end <= date` / 일반 종료 `end < date`).

문제는 쿼리가 그 판정까지 안 갔다는 것이다. 명단 쿼리는 1000행 캡([[#54]])을 피하려고
`.or("end_date.is.null,end_date.gte.${date}")`를 거는데 **이 비교는 종료일을 포함**한다. 그래서
그건 답이 아니라 **후보를 줄이는 프리필터**인데, 자리 계열은 거기서 끝냈다 — `is_transferred`를
**select조차 안 해** 좁힐 수단이 없었다.

🔑 **판별법**: 명단 쿼리에서 `end_date.gte`를 grep한 뒤, 그 결과를 받는 코드가 `is_transferred`를
**실제로 select하고 판정 함수를 부르는지** 본다. 둘 중 하나만 있으면 걸린 것이다(select만 하고
안 쓰는 경우가 실제로 있었다). 화면에서 보면 **"두 반에 같은 이름"** 이 지문이다.

⚠️ **모르면 지우지 말 것** — `isTransferred`가 undefined면 **일반 종료**로 본다. 반대로 잡으면
퇴원 예정 학생이 마지막 날 하루 일찍 명단에서 사라진다(2026-07-17 시간표 주간뷰가 그렇게 틀렸고,
`isEnrollmentEndedOn`은 그때 만들어졌다).

⚠️ **표시 규약과 저장 규약을 같은 함수로 쓰지 말 것** — `enrollmentsOverlap`(DB GiST와 같은 반열림)은
"저장이 될까"를 미리 알려주는 용도고, `isEnrollmentEndedOn`은 "화면에 보일까"다. 섞으면 "화면은
괜찮다는데 저장이 거부"가 난다.

🔑 **읽기를 고치면 쓰기도 같이 닫히는 구조가 이득이다** — 자리 출석부의 쓰기 게이트(`rosterKeys`)가
읽기와 **같은 함수**로 명단을 만들어서, 배포 전부터 열려 있던 탭에서 유령을 눌러도 서버가 거절했다
([[#77]]의 좋은 쪽 사례). 게이트를 따로 짰으면 화면만 고쳐지고 쓰기 구멍은 남았을 것이다.

**고친 자리**: 자리 일별·자리 월별·반별 월별(매트릭스)·키오스크 체크인·결석 접수·수업보고서 반 해석
여섯 곳. 뿌리 하나는 `isEnrolledOn`이 `date <= s.end`를 직접 쓰던 것이라, `EnrollSpan`에
`isTransferred`를 얹어 위임하니 월별 세 화면이 함께 나았다.

⚠️ **일반화**: **반열림 경계**(`[start, end)`)를 쓰는 DB 제약이 있으면, 그 경계를 아는 판정 함수를
거치지 않는 SQL 비교는 **하루를 더 준다**. 그리고 그 하루는 이동이 실제로 일어난 날에만 보여서
"어제는 멀쩡했는데" 소리를 듣는다.

## #126 — "이 반만 왜 다르지" = 여러 반을 한꺼번에 정리한 뒤 **정정이 일부에만** 들어갔다 · 사라진 배치는 **스냅샷 id**로 되짚는다 (2026-09-01)

**증상**: 원장이 *"초등 브릿지 B반 시간대 표시가 왜 제대로 안되는것 같지?"* 라고 물었다. 그 반 화·금
수업이 `16:00~16:20`, 즉 **20분짜리**로 떠 있었다. 같은 날 같은 시트에서 온 형제 반 둘(브릿지 A·초5 MED)은 멀쩡했다.

**틀린 첫 가설을 먼저 적어 둔다** — "시트 파서가 시간 사다리를 등간격으로 가정해 20분이 됐다"고 봤는데
**아니었다.** 마스터 시트를 실제로 다시 읽어 보니 그 칸은 시트에 정말로 20분(2행 병합)으로 그려져 있고,
컷오버 파서(`parse-grid.ts`)는 10분 격자 상수를 쓰지 별도 추정을 하지 않는다. 🔑 **"파서가 이상하다"는
가설은 원본을 한 번 읽어 보면 대개 죽는다** — 원본 확인이 코드 정독보다 싸다.

**진짜 원인**: 데이터는 정확히 들어갔었다. `apply_english_structure` 로그가 `inserted: 154`로 전건 성공을
기록하고 있었다. 사라진 건 **그다음 날 사람이 지운 것**이다 — 2026-08-31 11:02 *"9/1 예약 배치
정리(스크립트·원장 지시)"* 가 교시 격자와 어긋나 보이던 칸을 **세 반에서** 지웠고, 10분 뒤
*"MED의 JJ를 한칸 아래로"* 정정이 왔는데 **그 정정이 한 반(초5 MED)에만 적용됐다.** 나머지 한 반은
위·아래가 뒤집힌 채 남아 20분 수업이 됐다.

🔑 **진단 레시피 — 사라진 행은 스냅샷 id로 되짚는다.** `timetable_snapshots.payload.apply.inserts[].id`는
**서버가 미리 만든 uuid**라(롤백 식별용) `class_schedules`와 대조하면 "계획됐는데 지금 없는 행"이 바로
나온다. 여기선 154건 중 48건이 없었지만 **42건은 9/1자 같은 내용의 행이 다른 id로** 살아 있었다(그 뒤 재가져오기·정정
스크립트가 다시 넣은 것) — 그래서 **id로만 세면 31%가 실종된 것처럼 보인다.** 내용(반·요일·시각)으로 한 번 더
걸러야 진짜 실종 6건이 남는다. 그 6건은 감사로그에 누가·왜 지웠는지 그대로 적혀 있었다.

⚠️ **여러 반을 한 번에 손보는 정리 작업은 "정정"이 전수인지 확인할 것.** 첫 정리와 정정이 10분 간격으로
붙어 있어 사람은 같은 작업으로 기억하지만, 정정은 **한 반만** 훑고 끝났다. 되돌아보는 단서는 감사로그의
`target_label`이 정리엔 셋, 정정엔 하나뿐이라는 것이다.

🔴 **손으로 지운 배치는 다음 가져오기에 되살아난다** — 시트가 진실이기 때문이다(그 정리 스크립트의
감사로그가 스스로 *"⚠️ 시트에는 그대로 있어 다시 가져오면 되살아난다"* 라고 적어 뒀다). 화면에서 지우는
것은 **임시 조치**지 결정이 아니다. 영구히 하려면 시트를 고치거나 가져오기 쪽에서 거른다.

⚠️ **"교시와 안 맞는 칸"은 종류가 둘이고 심각도가 다르다** — 시작시각이 교시표에 **있는데 종료만 다른**
칸은 격자에 붙기는 한다(`splitGridSlots`가 시작시각으로 분류한다, [[#106]]). 실제로 9/1 유효 영어 슬롯
327개 중 17개가 정확히 일치하지 않는데 13개는 예전부터 있던 `17:40~18:10`·`20:20~21:00`이고 아무도
불평하지 않았다. **문제가 되는 건 길이가 뭉텅 잘려 "수업이 20분"으로 읽히는 칸**이다.

🔴🔴 **배치 시각은 이미 찍힌 출결의 앵커다 — 고치기 전에 그 슬롯을 보라.** 이 건에서 "형제 반과 같은
모양"을 만들려고 `16:00~16:20`을 `16:20~17:00`으로 **옮겼는데**, 그날 그 반 출결이 이미
`slot_start=16:00`으로 6건 찍혀 있었다(계획 줄도 같은 키를 쓴다). 옮겼으면 그 기록들이 슬롯에서
떨어져 나갔을 것이다 — 적대적 리뷰에서 잡아 **끝만 펴는**(`16:00~17:00`) 쪽으로 되돌렸다. 🔑 **시작시각을
움직이는 것과 종료시각만 늘리는 것은 위험도가 전혀 다르다**(전자는 기존 기록을 고아로 만든다).
확인 = `attendance_records.slot_start` · `class_sheet_plan_lines.slot_start`. 🔴 **되돌려도 늦다 — 그때 열려 있던 화면은 옛 교시로 저장한다.** 실제로 되돌린 지 2분 뒤, 아까 화면을 띄워 둔 강사가 **없어진 16:20 칸에** 6명을 찍었다(클라가 슬롯 목록을 들고 있다). `rollupDay`는 **슬롯이 실재하는지 안 보고 합산**하므로 그 고아 기록은 조용히 그날 시수를 한 칸 더 만든다 — 읽는 쪽이 `student|slot`로만 중복을 접기 때문이다. 수습 = 상태·시수는 그대로 두고 **교시만 실재하는 칸으로 옮긴다**(같은 칸에 이미 다른 사람의 기록이 있어도 최신 1건만 쓰이므로 안전하다). ⚠️ **수업 시간 중에는 배치 시각을 건드리지 말 것.** ⚠️ 그리고 **"형제 반과
모양을 맞추자"는 그 자체로는 근거가 아니다** — 시트에서 브릿지 B는 사람 강사가 16:00부터, 형제 둘은
자리(JJ)가 16:20부터라 **원래 다른 게 맞았다**(그날 찍힌 출결 시각이 그걸 그대로 말해 주고 있었다).

## #127 **선택자 목록 안의 `:has(> …)`가 dev 산출 CSS에서 조용히 사라진다** — 규칙이 "안 먹는" 게 아니라 아예 없다 (2026-09-02)

등록상담 목록뷰의 좁은 화면 카드 규약(`.consult-sheet`)에 빈 칸을 감추려고
`.consult-sheet td:empty, .consult-sheet td:has(> [data-empty="true"]) { display:none }`을 적었다. 타입체크·테스트는
당연히 통과하고 브라우저에서도 에러가 없는데 **칸이 안 감춰졌다**. `document.styleSheets`를 뒤져 보니 서빙된 CSS엔
`.consult-sheet td:empty { display:none }` **한 줄만** 있고 `:has` 쪽은 흔적도 없었다 — 파일은 맞게 저장돼 있었고(디스크
grep 일치), dev 서버를 재시작해도 같았다. 즉 빌드 파이프라인이 선택자 목록에서 그 항목만 떨어뜨렸다.

- 🔑 **판별**: 규칙이 "안 맞는다"고 의심하기 전에 **서빙된 CSS에 그 선택자가 있는지**부터 본다
  (`[...document.styleSheets].some(s => [...s.cssRules].some(r => r.cssText.includes("data-empty")))` 또는
  `.next/dev/static/chunks/*globals_css*.css`를 grep). 있으면 매칭 문제, 없으면 파이프라인 문제다.
- ⚠️ **원인은 확정 못 했다** — `node_modules/.pnpm/lightningcss@1.32.0`을 단독으로 돌리면(타깃 유무 무관) `:has( > …)`를
  그대로 보존한다. 같은 청크에 다른 `:has(` 규칙은 9개나 살아 있다. Tailwind v4/Next의 CSS 처리 어딘가에서
  **선택자 목록 + 상대 선택자(`> `) 조합**이 떨어지는 것으로 보인다.
- **회피(채택)**: 감출 요소에 **표식을 직접** 단다 — 표가 `<td data-empty="true">`를 달고 `.consult-sheet td[data-empty="true"]`로
  감춘다. 부모를 자식으로 판정하는 `:has()`가 필요해지면 구조를 바꿔 표식을 올리는 쪽이 낫다.
- ⚠️ 이 함정은 **아무 게이트에도 안 걸린다**(CSS는 타입도 테스트도 없다) — 새 CSS 규칙은 실브라우저에서 `getComputedStyle`로
  실제 적용을 한 번은 확인할 것.
- 🔑 **"떨어졌다"고 결론 내리기 전에 한 번 더 저장(터치)해 재컴파일시킬 것**(2026-09-08 실측): 같은 증상 — 소스엔 있는데
  `.next/dev/static/chunks/*globals_css*.css`에 없고 hard reload도 소용없음 — 이 **stale**이었다. 스크립트 한 번에 globals.css와
  tsx 여러 파일을 같이 썼고, 그 순간 다른 파일(loading.tsx)이 파싱 에러를 내며 CSS 청크가 옛 내용으로 남았다. 파일을 다시
  저장하자 같은 선택자(`main.embed-main:has(.edge-to-edge)`)가 그대로 살아 나왔다. 판별 순서 = ① 소스 grep → ② 청크 grep →
  ③ **재저장 후** 청크 grep → 그래도 없으면 파이프라인(위 `:has(> …)` 케이스).

## #128 **`overflow-hidden` 카드 안에서 절대배치한 겹판은 카드 경계에서 잘린다** — 아랫줄 학생은 출결 메뉴가 아예 안 보였다 (2026-09-04)

오늘 출결(좌석표)에서 **아래쪽 학생 이름을 눌러도 출석·지각·결석 메뉴가 안 나왔다**(원장 제보).
버튼은 정상이고 상태도 열렸는데(React state `open=true`) **카드가 그림을 잘라 낸 것**이다 —
반 카드([`seating-room.tsx`](../src/features/attendance/live/components/seating-room.tsx)의 `<article>`)에
`overflow-hidden`이 있고(머리 색띠가 둥근 모서리 밖으로 새지 않게), 칸 안에서 `absolute top-full`로
띄운 메뉴가 그 경계에 걸렸다. 실측(1400x900, dev): 마지막 줄 칸 바닥 490 / 카드 바닥 498 / 메뉴
494~528 — 카드 밖 30px이 통째로 잘려 **4px만 보였다**. 윗줄 학생은 카드 안에 여유가 있어 멀쩡해서,
증상이 "가끔 안 된다"로 위장한다.

- 🔑 **판별은 클릭이 아니라 기하다**: 메뉴 DOM이 있는지(`document.querySelector`)와 그 rect가 조상
  카드 rect 안에 들어가는지, 조상의 `getComputedStyle(el).overflow`를 함께 볼 것. DOM이 있는데 안 보이면
  z-index가 아니라 **잘림**을 먼저 의심한다(z-index는 형제에 가려질 때고, 잘림은 조상이 자른다).
- **고침 = 겹판만 카드 밖으로**: 카드의 overflow는 그대로 두고(풀면 머리띠가 깨진다) 겹판을
  `createPortal(…, document.body)` + `position: fixed`로 띄우고 앵커 rect에서 좌표를 잰다
  (시간표 hover 카드와 같은 규약). 오른쪽 끝은 왼쪽으로 당기고, 아래가 모자라면 위로 뒤집는다.
- 🔴 **포털로 옮기면 따라오는 것이 셋이다.** ① **스크롤·리사이즈마다 다시 재야 한다** — 안 재면 칸은
  움직이는데 겹판만 남는다. ② **앵커가 화면 밖으로 나가면 닫아야 한다** — 가장자리에 클램프된 채
  남으면 이미 안 보이는 학생의 메뉴가 다른 카드 위에서 눌린다(엉뚱한 학생 출결). ③ **Tab 순서가
  끊긴다**(겹판이 DOM 끝으로 간다) — 열릴 때 첫 항목에 초점을 주고 Esc로 앵커에 되돌린다.
- ⚠️ **위치를 재기 전 한 프레임을 `visibility: hidden`으로 감추지 말 것** — 숨은 요소는 초점을 못 받아
  자동 초점이 조용히 무시된다. `opacity: 0` + `pointer-events: none`이라야 초점은 살고 안 보이는 판이
  화면 왼쪽 위에서 클릭을 가로채지도 않는다.
- ⚠️ 같은 카드 안의 **오류 문구도 함께 잘리고 있었다**(같은 `absolute`) — 겹판을 옮길 땐 그 형제도 같이
  본다. 단 둘이 같은 자리에 뜨므로 메뉴가 열린 동안엔 오류를 안 그린다.
- 가드 = `seating-cell.test.tsx`(rect를 물려 위로 뒤집기·오른쪽 클램프·스크롤 이탈 닫힘·포털 여부를 고정).

## #129 **끌던 줄이 언마운트되면 dnd-kit `active.data`가 빈 객체가 된다** — "출발 반을 알 수 없어" 거절은 판정이 아니라 데이터 증발이었다 (2026-09-09)

**증상**: 수학 기본뷰에서 학생을 끌어 놓으면 우상단에 *"출발 반을 알 수 없어 옮기지 못했습니다"*(원장 제보). 반 블록은
되고 학생만 그랬다.

**원인**: 픽업 렉을 없애려고 **마우스가 올라간 줄만** `useDraggable`을 다는 무장(arming) 방식을 쓰는데(drag-flag.ts),
무장은 `pointerover`로 갈아탄다. 끄는 동안 고스트는 `pointer-events:none`이라 포인터가 지나는 **다른 줄**의 `pointerover`가
그대로 불리고 → 그 줄이 무장되면서 원래 줄은 평소 줄로 돌아가 훅이 **언마운트** → dnd-kit은 `draggableNodes`에서 노드를
지우고 `active.data`를 `defaultData`(빈 객체)로 바꾼다(core.esm 주석 *"It's possible for the active node to unmount while
dragging"*). 놓는 순간 `data.classId`가 없어 거절 갈래로 떨어졌다. 학생 줄이 빽빽한 수학 기본뷰에선 거의 매번이다.
- 🔑 **판별**: `active.data.current`가 `{}`(undefined가 아니라 빈 객체)면 노드가 사라진 것이다. 터치 기기(모든 줄 무장)에선
  재현이 안 된다 — 이 PC가 그랬다(`(any-pointer: coarse)` true). 재현·판정은 단위 테스트로.
- **고침 둘**: ① **누르고 있는 동안·끌고 있는 동안은 무장을 안 바꾼다**(`holdArmedRow` — 줄의 `onPointerDownCapture`,
  풀림은 window `pointerup`·`pointercancel`·`blur`). 🔴 `dragging` 플래그만으론 부족하다 — 활성화 문턱(5px) **앞**에도
  같은 일이 나므로 "누름"에 건다. ② 보드가 **집는 순간의 data를 스냅샷**으로 들고 놓을 때 그것을 쓴다(안전망 — 줄이 어떤
  이유로든 다시 그려져도 산다). 가드 = `drag-flag.test.ts`.
- ⚠️ 같은 날 곁가지 둘: **막힌 칸에 놓았을 때 "칸을 찾지 못했다"**고 하던 것은 `okCellAt`(갈 수 있는 칸만 찾음)의 빈손을
  "격자 밖"으로 읽은 것 — 아무 칸(`anyCellAt`)을 찾아 `annotateDropCells`가 `title`에 적어 둔 **이유**를 말한다(제자리는
  취소라 조용히). 놓을 칸이 0개면 집는 순간 말한다(초록 칸이 안 켜지면 "표시가 안 된다"로 읽힌다). **드래그 직후의
  더블클릭**(크롬은 더블클릭을 요소가 아니라 시간·좌표로 센다 — 짧게 끌다 놓고 다시 잡으면 창이 열린다)은 DnD 영역 루트의
  `onDoubleClickCapture`에서 삼킨다(`swallowDoubleClickAfterDrag`, 유예 700ms).

## #130 **내보낸 걸 그대로 되읽었는데 “전건 변경”** — export는 *해석한 이름*을 쓰고 import는 *원문*과 비교했다 (2026-09-10)

**증상**: 원장이 시간표 툴바에서 '시트 반영'을 누른 **직후** '시트에서 가져오기'를 열었더니
`생성 1 · 변경 199 · 제거 1`. *"왜 변경점이 이렇게 많지? 하나도 없어야 정상 아닌가"* — 맞는 말이다.
방금 DB를 시트에 통째로 덮어썼으니 되읽으면 0이어야 한다.

**틀린 가설을 먼저 적어 둔다** — 변경 줄이 전부 `강사/방/종료시각` 꼴(`PL4 화 16:20 → 정유진/605/17:00`)이라
[[#106]](시작시각 같은 교시 둘 → 종료시각 역매핑)·[[#122]](방 번호 후보 둘)·[[#115]](FK와 라벨 두 벌)·
[[#88]](적용일 축)을 의심했다. **전부 아니었다.** 실데이터로 왕복을 재현해 원인을 쪼개니
`teacherOnly 199 / roomOnly 0 / endOnly 0` — 방과 종료시각은 **한 건도** 안 어긋났다.
(적용일 축도 아니다: 오늘·9/14 두 날짜의 결과가 글자까지 같았다.)

**진짜 원인 — 왕복이 대칭이 아니다.**
- export('시트 반영')는 강사 밴드에 **해석된 표기 이름**을 쓴다: `queries.ts`가
  `slotTeacherLabel: resolveTeacherLabel(...)`로 `Jane`→`추민아`, `Sam`→`김태건`, `Yoojin`→`정유진`으로 바꿔 내보낸다
  (원장 2026-07-27 *"영어 선생님도 시간표에서 전부 닉네임이 아닌 이름이 나오도록"*).
- import는 시트 글자(`추민아`)를 DB **원문**(`Jane`)과 그대로 비교했다(`diff.ts` `teacherSame`).
- 두 값은 같은 사람인데 문자열이 다르니 **닉네임이 붙은 슬롯 전건이 '변경'**. 실측 injaewon 2026-09-10:
  유효 영어 슬롯 **321칸 중 199칸**이 그 꼴이고, 나머지 121칸은 원문이 이미 표기와 같은 것뿐이었다
  (`JJ` 61 · `LAB` 57 · 라벨 null 4 — null은 보수적으로 '동일' 처리).

**고침**: `ExistingSchedule.slotTeacherDisplay`(= export와 **같은 해석기**를 태운 값)를 서버가 함께 실어 보내고,
diff가 **원문과 해석값을 둘 다** 본다(OR). 원문은 그대로 둔다 — `slot_teacher_label`은 ijw 임포트·시트 동기의
원본이라 UPDATE 금지가 규약이다(teacher-label.ts 📌). 실데이터 드라이런: `변경 199 → 0`, 320칸 무변경.
가드 = `teacher-label-roundtrip.test.ts`(export가 해석해 나가는 것 ↔ import가 해석해 비교하는 것을 **짝으로** 잠근다).

🔴 **적용했으면 어땠나**: 199칸이 마감·재삽입되고 `slot_teacher_label` 원문이 전부 한글 이름으로 덮였다.
시각은 안 움직이니 출결 앵커([[#126]])는 살지만, 이력 행 199개와 규약 위반이 남는다.

⚠️ **남은 곁가지(미해결) — 요일 칸의 '언제'가 export와 import에서 다르다.** export는 요일 칸마다
**이번 주 그 요일의 날짜**로 유효 행을 고르는데(`slotLiveOnDate`, 화면과 같아야 하니 옳다) import는
**적용일 하루**로 고른다. 그래서 목요일에 '오늘부터' 배치를 바꾸면 월·화·수 칸은 **바뀌기 전 모습**이
시트에 실리고, 되읽으면 그게 `생성 1 · 제거 1`로 나온다 — 실제로 그날 13:01에 바꾼 `중등E_중2 심화` 수요일이
정확히 그랬다(적용했다면 **10분 전에 한 변경이 되돌아간다**). 🔑 **반영과 가져오기 사이에 배치를 바꾸지 말 것**,
바꿨으면 **반영을 다시 누르고** 가져올 것.

🔑 **일반화**: 표시용으로 한 번 해석해 내보낸 값을 되읽어 **원문과 비교하면 전건이 어긋난다.**
왕복하는 두 방향은 **같은 정규화 함수를 태우거나**, 아니면 원문을 함께 실어 보내야 한다.
🔑 **진단 레시피**: 왕복을 코드와 같은 규약으로 **오프라인 재현**해 (create/update/keep/remove)를 원인 축별로
쪼개면(강사/방/종료/날짜) 어느 칸이 범인인지 한 번에 나온다 — 화면 숫자와 정확히 같아지면 모델이 맞은 것이다.

## #131 **`display:none`인 iframe은 preload한 폰트를 "안 쓴다"** — 최소화한 창이 문서를 통째로 로드하고 있었다 (2026-09-10)

원장 제보: 프로덕션 콘솔에 `PretendardVariable-….woff2 was preloaded using link preload but not used within
a few seconds from the window's load event`가 **주기적으로 계속 쌓인다**(`timetable?embed=1`·`ecs?embed=1`·
`menu`·최상위 프레임).

**폰트 배선은 멀쩡했다.** 흔한 용의자를 실측으로 전부 지웠다 — preload URL과 `@font-face`의 `src`가
**`?dpl=`(스큐 프로텍션 쿼리)까지 글자 그대로 같고**(한쪽에만 붙어 두 번 받는 그 함정이 아니다), `crossorigin`도
맞고, `--font-pretendard` 변수·`<html>` 클래스도 배선돼 있다. 프로덕션·dev 문서 **11개**(최상위 4 · iframe 7)에서
`FontFace.status`가 전부 `loaded`였다. 비용도 실측했다: 콜드 캐시 1회 요청 **2,057,988B / 548ms**,
웜 캐시 `transferSize:0`·`duration:0`. `_next/static/media`는 `immutable`이라 **창 N개 = 네트워크 1회 +
나머지는 공짜 캐시 히트**다(중복 다운로드 없음).

**진짜 원인은 창 시스템이었다.** [`floating-window.tsx`](src/components/workspace/floating-window.tsx)는 최소화한
창을 언마운트하지 않고 Tailwind `hidden`(= `display:none`)으로 감춘다(문서·스크롤 보존이 목적). 그런데
[`route-window.tsx`](src/components/workspace/route-window.tsx)의 stagger 활성화가 그걸 **안 보고** 최소화
상태에서도 iframe `src`를 채웠다. `display:none` 문서는 레이아웃이 0이라 글리프를 한 자도 안 그리므로
**preload는 받아 놓고 폰트를 안 쓴다** → 크롬이 문서마다 경고를 찍는다.

실측 대조(같은 페이지·같은 순간, 최소화 창 하나를 심고 새로고침):

| iframe | 표시 | 폰트 요청 | `FontFace.status` |
|---|---|---|---|
| `/dashboard?embed=1` | 보임 | 1 | **loaded** |
| `/newcomers?…&embed=1` | `display:none` | 1 | **unloaded** |

`visibility:hidden`·화면 밖(`left:-5000px`)은 **레이아웃이 살아 있어 정상적으로 쓴다** — `display:none`만 이렇다.

🔑 **경고는 증상이고 손해는 그 아래 있었다**: 최소화된 창이 셸 레이아웃·인증·DB 쿼리·RSC 렌더·하이드레이션을
**아무도 못 보는 문서**에 대해 전부 치르고 있었다(B6가 걱정하던 "창 N개 = 인증·설정 쿼리 N배"가 보이지도 않는
창에서 일어난 것). `minimize`는 창을 `order`에 남기므로 그대로 영속되고 **페이지를 열 때마다 되살아난다** —
그래서 "주기적으로 쌓인다"였다.

**고침**: `activated`가 `win.minimized`를 함께 본다 — 최소화 창은 **복원될 때** 로드한다.
🔴 **이미 로드된 창은 그대로 살려 둔다**(`activated`는 한 번 서면 유지) — 최소화·BL3 warm 풀의 "문서·스크롤
보존"이 그 위에 서 있다. 막는 건 **한 번도 안 연 채 최소화로 복원된 창**뿐이다.
가드 = `route-window-minimized.test.ts`(고치기 전 2건 실패를 실제로 확인했다).

⚠️ **`preload:false`로 "고치지" 말 것** — 실측상 preload는 제 일을 하고 있다(콜드 캐시에서 폰트가 **573ms**에
끝나 FCP **780ms** 전에 도착). 2MB 한글 폰트라 빼면 첫 페인트가 시스템 폰트로 튄다.
⚠️ JetBrains Mono는 이미 `preload:false`다(2026-07-19 de-mono) — **같은 경고를 한 번 겪고** 그렇게 고친 자리라,
이번에도 폰트 설정을 의심하기 쉬웠다.
⚠️ **서브프레임 경고는 도구에 따라 부모 콘솔 목록에 안 잡힌다** — 재현을 경고 문구로 기다리지 말고
`document.fonts`를 훑어 **`status === "unloaded"`인 face**를 찾을 것(그게 곧 "preload했는데 안 씀"이다).

## #132 **이름·학교·학년이 같다고 붙인 자동 연결이 동명이인을 합쳤다** — 그리고 트리거가 한 일은 감사로그에 0줄이었다 (2026-09-10)

**증상**: 학부모 QR 접수(새 학생 김근우, 대구일중 중1)가 접수 순간 이미 다니는 **다른 아이** 김근우(같은 학교·학년)에게 붙었다.
상담 화면이 '수업 배정' 대신 '학생 정보 보기'가 되어, 직원은 **기존 아이 화면에서** 새 아이의 수학 반 2개·교재를 배정했다.
상담 이름을 김근우A로 고쳐도 연결은 안 풀렸고(트리거는 `student_id is null`일 때만 돈다), 연결 해제 UI도 없었다. makeedu
보내기도 "연결 학생이 이미 원생"이라 막혔다(push-eligibility). 감사로그엔 아무 흔적이 없어 "누가 방어로직을 넘었나"로 오인됐다.

**원인**: 0107a `eywa_cs_match` tier1 = 이름+학교+학년이고 **연락처를 안 본다**(두 아이의 보호자 이름·연락처는 달랐다).
동명이인 방어는 "비퇴원 학생 중 유일 매칭"뿐이라, 기존 1명 + 새 아이 = **"유일"로 통과**한다. 동명이인 접미사 방어
(`convertConsultationToStudent` → `resolveUniqueStudentNameFor`)는 **연결이 먼저 일어나면 무력하다**(버튼 자체가 바뀐다).
그리고 연결은 DB 트리거 안에서 일어나 앱의 `logAction`을 한 번도 안 지나갔다.

**고침**: 0258a — 양쪽 보호자 연락처가 **둘 다 확실한 국내 번호**(0 시작 9~11자리, +82→0)이고 서로 다르면 tier1 불일치 +
트리거가 감사로그(`consultation_autolink`)를 직접 쓴다 + definer 함수 RPC revoke. 앱은 등록상담 작성·QR 접수·수정·상태·삭제·
기존 학생 재사용까지 감사로그. 데이터는 상담 1건 연결 해제(원장 승인).
⚠️ "번호가 다르면"을 **숫자 9자리 이상**으로만 판정하지 말 것 — 연락처 칸에 금액·암호화 흔적·번호 두 개가 든 행이
상담 236건·학생 13건이라(실측), 그걸 '다른 번호'로 치면 같은 가족의 옛 상담이 영영 안 붙는다(적대 리뷰가 잡음).

**교훈**:
- **"유일 매칭"은 동명이인 방어가 아니다** — 기존에 1명뿐이면 새 사람이 그 1명에 붙는다. **모순 증거(다른 연락처)** 를 보는 것이 방어다.
- 잘못 붙이는 비용과 못 붙이는 비용을 **비대칭**으로 볼 것 — 못 붙이면 중복(병합으로 복구), 잘못 붙이면 **조용한 오염**.
- DB 트리거가 데이터를 바꾸면 **트리거가 감사로그를 남겨야** 한다(앱 한 곳에서 남기면 다른 진입 경로 — 학생 쪽 트리거·동기화 — 가 빠진다).
- 🔴 **같은 모양이 두 곳에 더 있다(미해결)**: makeedu 학생 동기화(`import-students-list.cjs` tier1 = 이름+학교core+학년)와 수납
  가져오기(`import-invoices.cjs` = makeedu_id → **이름+학년 폴백**). 새 아이가 makeedu에 **접미사 없이 '김근우'** 로 원생 등록되면,
  학생 동기화가 기존 아이에 매칭하고(그 아이는 makeedu_id가 이미 차 있어 백필이 막힘) 새 원생은 aywa에 안 들어오며, 수납 줄은
  이름+학년 폴백으로 **기존 아이의 월 청구에 합쳐질 수 있다**. makeedu에서도 접미사 이름(김근우A)으로 등록할 것.

## #133 창 안 **소프트 이동이 주소에서 `embed=1`을 지우면**, 다음 `router.refresh()`에 창 안에 **전체 셸**이 뜬다 (2026-09-12)

**증상**: 출석부 창에서 달을 옮기거나(PeriodNav) 허브의 강사 줄(맨 `<Link>`)을 누른 뒤 정렬·기간을 바꾸면(= `router.refresh()`·
서버 액션 재검증) 창 안에 사이드바까지 달린 **전체 셸**이 겹쳐 뜬다. 이동 **직후엔 멀쩡해 보인다** — 공유 레이아웃은 소프트
이동에서 다시 안 그려지기 때문이다(그래서 첫 화면만 보고는 못 잡는다).

**원인**: `proxy.ts`는 **주소의 embed 파라미터만** 보고 창 갈래를 고르고, `(shell)/layout.tsx`가 그 표식으로 창/전체 셸을 가른다.
Next 16의 refresh는 **지금 주소로 공유 레이아웃까지** 다시 받는다(`refresh-reducer`). 소프트 이동의 href에 embed가 없으면 그 순간부터
주소가 거짓이고, 다음 refresh가 그 거짓을 서버에 보낸다. 창 안 하드 이동(`location.assign/replace`·맨 `<a href="/…">`·GET 폼)은
더 빠르다 — 그 자리에서 바로 전체 셸이다.

**고침(2026-09-12)**:
- 이동 부품(PeriodNav·HrefSelect 링크 모드·ParamLink·ECS 날짜·`EmbedLink`)이 `useEmbed()`면 `withEmbed` — 호출부 주소 빌더는 그대로.
- 하드 이동은 `EmbedAnchor`·`EmbedHiddenInput`·`useInFrame() ? withEmbed(href) : href`(선례 원생 삭제). 가드 `embed-hard-nav-wiring.test.ts`.
- 안전망 **`EmbedUrlKeeper`**(창 갈래 레이아웃에 한 번): 창 문서 주소에 embed가 없으면 `history.replaceState(null, "", withEmbed(…))`로
  되붙인다 — Next의 history 패치가 ACTION_RESTORE로 canonicalUrl까지 갱신해 refresh·reload가 embed를 유지한다. 🔴 첫 인자는 **null**
  (Next 내부 상태 객체면 라우터 동기화를 건너뛴다).
- ⚠️ 복원은 **URL만** 바꾸고 라우터 트리의 page 키는 embed 없는 옛 값이라, **그 뒤 첫 refresh가 트리 불일치 재시도**(라우트 캐시
  무효화·보이는 링크 재prefetch, 이미 한 번 어긋났으면 창 문서 새로고침)를 치른다. 그래서 키퍼는 **안전망**이고, 자주 도는 출처는
  이동 시점에 embed를 싣는다.

**교훈**: 창 여부를 **주소가 나른다**면 창 안의 모든 이동은 그 표식을 나르거나 되붙여야 한다. 창 안 이동을 검증할 땐 이동 한 번으로
끝내지 말고 **refresh를 한 번 돌려** 볼 것.

## #134 창(iframe)은 **`load`를 기다리면 스트리밍이 안 보이고**, 창 문서의 **`visibilityState`는 탭 기준**이다 (2026-09-25)

**증상 ①**: 창에 `loading.tsx`를 달아도(B7) 창을 열면 회색 덮개만 돌다가 완성 화면이 한 번에 뜬다. **원인**: 창 틀(RouteWindow)이
iframe `load`에서 덮개를 걷었는데, `load`는 HTML 스트림 끝 + 이미지·폰트까지 기다린다 — 그 사이 흘러온 스켈레톤·본문이 덮개 밑에 있었다.
**고침**: 창 문서에 `main.embed-main`이 도착한 프레임에 걷는다(`hasPainted`). 🔴 비교 기준은 **마지막으로 보여 준 문서**(로딩 상태와
무관) — `readyState==="complete"`로 옛 문서를 거르면 이미지 받는 중인 옛 문서를 새 문서로 오인해 ⟳ 직후 옛 화면이 눌린다. 🔴 덮개를
일찍 걷으면(또는 덮개 없이 창 안에서 하드 이동하면) **`load` 전에 입력이 시작된다** — `load`에서 미저장 표식을 무조건 지우던 것을
**"떠난 문서의 표식만"**으로(`noteDirtyOwner`가 표식을 받을 때 그 창에 붙은 문서를 주인으로 적고 `clearDirtyForNewDocument`가 주인이
지금 문서면 안 지운다 — 미저장 가드는 바뀔 때만 알려서 지우면 다시 안 온다). 처음엔 "문서당 한 번"으로 막았는데 덮개 없는 하드 이동은
첫 페인트 감시가 안 돌아 load가 첫 정리가 되어 그대로 새었다(2026-09-25 후속). 🔴 옛 문서가 표식을 쏘고 곧바로 떠나면 메시지가
**새 문서가 붙은 뒤** 도착한다(창의 `contentWindow`는 이동해도 같은 객체라 출처로는 못 가른다) — 그대로 받으면 새 문서가 거짓 주인이 되어
**그 문서가 사는 내내** 닫기 확인이 뜨고 창 개수 한도 축출·다시 보일 때 새로고침에서 빠진다. 그래서 메시지에 **보낸 문서의 표지
`performance.timeOrigin`**을 싣고(`windowDirtyMessage` — 보내는 곳 5곳이 전부 이걸 쓴다) 부모가 지금 문서의 표지와 다르면 버린다.

**증상 ②**: 최소화·보관·최대화 창 뒤에 가린 창에서도 폴링이 돈다. **원인**: iframe 문서의 Page Visibility는 **최상위 탭**을 따른다
(`display:none`이어도 `visible`). **고침**: 부모가 창 문서의 `visibilityState`/`hidden`을 **그 문서 객체에** 덮고 `visibilitychange`를
쏜다(`frame-visibility.ts`) — 소비처 수정 0. ⚠️ 새 문서가 뜰 때마다 다시 걸어야 한다(문서 객체에 붙은 속성) · ⚠️ 이벤트는
**`bubbles: true`**(진짜 이벤트처럼 — `window`에서 듣는 Supabase auth-js가 받는다).

**곁가지**: 서버 액션이 `redirect()`로 끝나면 fetch 응답은 **303**이라 `ok`가 false다 — "저장 성공"을 상태코드로 판정하면 리다이렉트형
저장이 전부 빠진다. 서버 액션은 `x-action-revalidated`(1|2)만 볼 것(Next가 finally에서 단다).

## #135 더블클릭과 구분하려고 **첫 클릭을 보류**하면 모든 클릭이 그만큼 늦다 — 즉시 보내고 더블클릭이 이동을 멈추게 (2026-09-30)

원장 제보 *"데이터베이스에서 폴더 이동할 때 한 번 누르고 기다려야 들어가지는데"*. 데이터는 문서 46건·폴더 30개, 쿼리는 전부 0.2~2ms였다 —
느린 건 서버가 아니라 **클라가 500ms를 일부러 기다린 것**이었다. `InlineRename`이 더블클릭(이름 변경)과 구분하려고 링크의 첫 클릭을
`setTimeout(500)` 뒤에 다시 눌렀고, 쓰기 권한자(원장·관리자·매니저)만 걸려서 읽기 전용 계정으로는 재현되지 않았다. 게다가 `loading.tsx`가 없는
동적 라우트라 보류가 끝난 뒤에도 서버 응답까지 **화면에 아무 변화가 없었다** — "눌렸는지 모르는" 두 구간이 이어 붙은 것.
- **규칙**: 같은 창 안 이동(검색 파라미터 이동)은 보류하지 말 것. 즉시 `router.push` + 누른 대상은 **낙관 표시**(`useOptimistic`) + 목록은 `aria-busy`.
  더블클릭 동작이 필요하면 **편집이 열리는 순간 첫 클릭의 이동을 멈춘다** — 진행 중 이동은 새 이동이 오면 버려지므로(Next 액션 큐 `discarded`)
  지금 주소로 `router.replace`하면 된다. 첫 클릭 뒤 화면이 먼저 바뀌어 두 번째 클릭이 **다른 요소**에 떨어지는 것은 1초 창으로 삼킨다.
- 새 창을 여는 첫 클릭(파일 미리보기)은 예외 — 즉시 열면 더블클릭 때 창이 먼저 뜬다. 거기만 보류가 남는다.
- 🔑 검색 파라미터만 바뀌는 이동은 페이지의 클라 상태를 **보존**한다(`layout-router`가 `createRouterCacheKey(segment, true)`로 검색 파라미터를 뺀 키를 쓴다).
  그래서 트리를 `key={activeKey}`로 재마운트하던 것을 "조상만 더 펼치기"로 바꾸면 이동 중에도 편집 칸·펼침이 산다.
- ⚠️ **테스트 함정**: RTL의 `act()` 안에서는 매달린 트랜지션(라우터 흉내가 `use(영원히 안 끝나는 약속)`) **뒤의 동기 업데이트가 커밋되지 않는다** —
  실제 브라우저는 이동 중에도 입력이 되는데 테스트만 "편집 칸이 안 열림"으로 실패한다. 그 시험만 `IS_REACT_ACT_ENVIRONMENT=false` + `waitFor`로
  (선례 `folder-navigation.test.tsx`). 모의 `router.push`가 곧장 끝나면 isPending·낙관 값이 바로 사라져 이동 중 상태를 시험할 수 없다 —
  라우터 상태를 루트의 매달린 약속으로 흉내 낼 것.

## #136 ClassNote `my_reactions`는 **그 명의로 읽어야** 나온다 — 안 붙이면 늘 빈 배열이라 "안 눌렸다"로 읽고 풀기를 건너뛴다 (2026-10-01)

**증상**: 공감(리액션) API를 학원이 테스트 글에서 시험하던 프로브가 "누르기 → `my_reactions`에 남은 것 전부 풀기"를 돌렸는데, 풀기 단계가
**아무것도 안 하고 끝났다**(오류 없음). 글·댓글에는 시험 공감 4개가 그대로 남아 있었다. 같은 봇 계정으로 방금 눌렀는데도 조회 응답의
`my_reactions`는 `[]`, `reaction_counts`만 `{like: 2, thanks: 1}`였다.

**원인**: ClassNote의 공감은 계정이 아니라 **(계정 · 명의 `author_name` · 종류)** 로 센다. 웹앱은 글·댓글을 읽을 때 늘
`?author_name=<지금 명의>`를 붙이고, 서버는 **그 명의의 공감만** `my_reactions`에 담는다. 명의 없이 읽으면 "내 공감"을 정할 기준이 없어 빈 배열이다.
같은 이유로 같은 봇 계정이 **명의만 바꿔** 같은 종류를 또 누르면 새 공감이 하나 더 생긴다(실측 `like` 2). 같은 명의·같은 종류를 다시 보내면
같은 번호가 돌아온다(멱등 — 수는 그대로).

**고침**: 워커는 공감 상태를 읽을 때 항상 그 행의 명의를 붙인다(`getPost(…, { authorName })` · `listComments(…, { authorName })`). 누르기 전에
그 명의의 같은 종류가 있으면 쓰지 않고, 풀 때는 **그 명의의 목록에 그 번호가 있을 때만** 지운다. `my_reactions`가 배열이 아니면(필드가 사라졌으면)
"안 눌림"이 아니라 **확인 못 함**(쓰지 않고 다시 시도)으로 본다.

**교훈**: "내 것" 목록이 비어 있는 것은 **없다**는 뜻이 아닐 수 있다 — 서버가 "나"를 무엇으로 정하는지(계정? 요청에 실은 값?) 먼저 확인할 것.
빈 목록을 근거로 정리·삭제 단계를 건너뛰는 코드는 **조용히 아무것도 안 한다**(정리 뒤에는 반대쪽 지표 — 여기선 `reaction_counts`·공감한 사람 목록 — 로 0인지 확인).
시험으로 실제 외부 서비스에 쓴 것은 **만든 번호를 응답에서 받아 적어 두고** 그 번호로 지운다.

## #137 셸이 마운트하자마자 부르는 **서버 액션** × loading.tsx 아래 redirect = Router가 React #310으로 죽고 **Next 기본 오류 화면** (2026-10-01)

**증상**: 운영(창 모드 끈 침산)에서 직원 화면에 간헐적으로 영어 기본 화면 **"This page couldn't load / Reload to try again, or go back."**
(Reload·Back 버튼). 우리 `global-error.tsx`(한글)도 `(shell)/error.tsx`도 안 뜨고, digest가 없다(= 클라 오류). Reload를 누르면 또 뜬다.
원장 관찰: "대시보드 권한이 꺼진 관리자뷰 사람" · "창 모드를 끈 뒤부터".

**원인(최소 앱으로 재현 — Next 16.2.6 프로덕션 빌드)**: 대시보드 권한이 없는 사람이 `/dashboard`를 **문서로** 연다(북마크·새로고침·로그인
`next`·관리자뷰 전환의 `window.location`).
1. `/dashboard`는 `loading.tsx`가 페이지를 Suspense로 감싸고, 권한 거부는 페이지 안(`loadOverview` → `requireAccess`)에서 났다 → 응답이 이미
   흐른 **뒤** redirect라 Next가 `<meta id="__next-page-redirect" http-equiv="refresh">`를 끼우고 스트림에 redirect 오류를 싣는다.
2. 화면이 붙자마자 사이드바 알림 벨이 **서버 액션**(`fetchMyNotifications`)을 보낸다 — 라우터 작업 큐에 들어간다.
3. 그 액션이 끝나기 전에 스트림의 redirect가 처리되면, meta가 있어서 `navigate-reducer`가 `completeHardNavigation` → `Router`가 렌더 중
   `throw unresolvedThenable` → **React #310**(`useActionQueue`의 `useOptimistic`) → 오류가 우리 global-error **바깥**(`AppRouter`의 최외곽 기본
   경계)으로 나가 Next 기본 화면. 곧이어 meta refresh가 `/menu`로 옮기지만, 운영의 무거운 셸에선 그 사이 화면이 남고 Reload는 같은
   `/dashboard`를 다시 연다(로그의 1.5초 간격 `GET /dashboard` 반복).

| 조건(문서 로드) | 기본 오류 화면 |
|---|---|
| 서버 액션 벨 + loading 아래 redirect | **약 23/100**(회차마다 0~44% — "간헐적") |
| 벨 없음 / 사이드바(프리페치)만 | 0/30 · 0/20 |
| 벨을 일반 `fetch`(GET 라우트)로 | 0/70 |
| 클라 이동(로고 클릭)으로 같은 튕김 | 0/18 |
| 게이트를 loading **앞**(레이아웃)으로 → 문서 요청이 HTTP 307 | 0/20 |

창 모드가 켜져 있을 땐 메뉴 화면이 전부 iframe(창 셸 = 벨 없음)에서 열리고 맨 위는 `/menu`에 머물러 경합이 안 났다 — 끄자 모든 문서 로드가
벨이 있는 맨 위 셸에서 일어났다(이 연결은 부분적으로만 증명).

**고침(2026-10-01)**: ① 셸에서 **저절로(마운트·이동·포커스·주기) 도는 조회는 서버 액션 금지** — 벨 목록은 GET `/api/notifications` + `fetch`
(인증·격리는 같은 `getMyNotifications`, `no-store`). ② `/dashboard` 권한 게이트를 `dashboard/layout.tsx`로(loading 앞 → 307).
③ "처음으로"(로고·바탕 보기·관리자뷰 전환·`/home`·루트 착지)는 권한을 본 홈(`ShellHomeProvider`·`roleHome(role, getUserPermMatrix())`).
가드 = [`shell-autocall-server-actions.test.ts`](<src/app/(shell)/shell-autocall-server-actions.test.ts>)(셸에서 닿는 서버 액션은 허용 목록뿐).

**교훈**: Next 기본 화면(`This page couldn't load`)이 **우리 global-error가 있는데도** 떴다면 앱 컴포넌트가 아니라 **라우터 자체**가 죽은 것이다 —
"하드 이동 + 진행 중인 라우터 작업(서버 액션)"을 먼저 의심할 것. ⚠️ loading.tsx 아래에서 redirect하는 페이지는 아직 여럿 있다(`/exams`·
`/attendance/seat`·`/dashboard/briefing`·`/lesson-reports?tab=video_homework` 등 10곳 + 각 페이지의 `requireAccess` 거부) — ①로 경합 원인은
사라졌지만, 새 권한 게이트는 가능하면 loading 앞(레이아웃)에 둘 것. ⚠️ 재현은 **문서 로드**로 할 것(클라 이동은 meta가 없어 안 터진다).

## #138 **DB 오류를 일반 문구로 삼키면 원인이 사라진다** — 화면엔 "저장에 실패했습니다", 로그엔 0줄 (2026-10-01)

**증상**: 반 이름 PL4→PL5 개명이 *"저장에 실패했습니다. 잠시 후 다시 시도해주세요."*로만 실패했다. 다시 눌러도 같았다. 원인은 23505
(`classes_tenant_name_subject_idx` — 종강·폐지된 반이 그 이름을 쥐고 있었다)였는데, 서버 액션이 **모든 DB 오류를 같은 문구로 바꾸고 로그도
안 남겨** 원장도 개발자도 이유를 알 길이 없었다. "잠시 후 다시 시도"는 거짓 안내였다(시간이 지나도 낫지 않는 오류).

**전수 검수**(548파일 · 1,070곳, [`docs/_audit/error-messages-2026-10-01.md`](_audit/error-messages-2026-10-01.md)): 쓰기 616곳 중 **563곳이 로그 없음**.
반대 방향의 실패도 많았다 — **영문 원문을 그대로 돌려주는 곳이 213곳**(`duplicate key value violates unique constraint …`가 토스트에).
그리고 "번역"한 곳에서도 **같은 코드, 다른 원인**이 틀린 이유를 말했다:
- 학생 저장이 **모든 23505**를 "같은 이름·학교·학년"으로 말했다 — 학생 표엔 유니크가 셋(자연키·출결번호·makeedu)이라 출결번호 중복에 이름 칸을 고치게 했다.
- 42501은 RLS 거부만이 아니다 — `users` 보호 트리거가 42501로 *"급여 항목은 원장만 바꿀 수 있습니다"* 같은 한글 이유를 RAISE한다.
- 23503은 방향에 따라 뜻이 반대다 — 지울 때 = "다른 기록이 쓰고 있다", 넣을 때 = "연결할 대상이 없다"(같은 제약 이름이 둘 다에 나온다).
- P0001은 반은 한글 문장(수납 배분 RPC), 반은 코드(`folder_cycle`·`ECS_BAD_TERM`)다.

**규칙**:
- 서버 액션의 `if (error)` 자리는 **`explainDbError(error, { scope, fallback, op })`**([`src/lib/supabase/db-error.ts`](../src/lib/supabase/db-error.ts)) —
  판정은 **오류 코드 + 제약 이름**(원문 따옴표 속 식별자)으로, 문구는 제약 표([`db-error-constraints.ts`](../src/lib/supabase/db-error-constraints.ts),
  운영 DB `pg_indexes`·`pg_constraint`에서 확인한 이름만) → 코드 기본 문구 → 모르면 **지금 쓰던 일반 문구(fallback)**. 로그는 scope와 함께 한 줄
  (입력 때문인 오류는 warn, 나머지는 error · details의 키 값·실패 행은 가린다 — 학생 이름·연락처가 들어간다).
- 지우기 동작은 `op: "delete"`를 넘긴다(23503의 뜻이 바뀐다). 폼 칸에 붙일 수 있는 이유는 `info.field`로 그 칸에(학생 이름·출결번호·직원 이메일).
- 이유를 보이기 이른 자리(조회 실패·학부모가 보는 공개 화면·부분 실패 안내)는 **`logDbError(error, scope)`로 로그만** — 문구는 그대로.
- 🔴 영문 원문(`error.message`)을 화면에 돌려주지 말 것. 새 유니크·CHECK·RESTRICT FK를 만들면 **제약 표에 한 줄**(없으면 코드 기본 문구로 떨어진다 — 단 CHECK는 이름 **규약**(`_len`·`_range_ordered` 등)으로 고르므로 규약과 정의가 다른 CHECK는 반드시 표에 직접 적을 것).
- ⚠️ NOT NULL(23502)·형식 오류(22P02 등)는 폼 검증을 지난 뒤라 대개 **코드 버그** — 사용자를 탓하는 문구 대신 지금 문구 + 에러 로그.
- ⚠️ 유니크가 여럿인 표에서 "23505 = 이 중복"이라고 한 문장으로 말하지 말 것 — 제약 이름으로 가른다.
- ⚠️ 쿼리 빌더를 변수에 담았다가 실행하는 자리(`const { error } = await del`)는 "`.from()` 결과를 받은 오류 변수" 검색에 안 잡힌다 — 전수 검수 땐 따로 볼 것.

## #139 Supabase CLI `migration new`의 **타임스탬프 이름**은 이 저장소 규약 밖이다 — 가드가 실패한다 (2026-10-02)

**증상**: `session-consumption-wiring.test.ts`의 *"검사 대상 = session_term_attendance를 마지막으로 정의한 마이그레이션"*이 `expected [ … ] to deeply equal []`로 실패한다. 회차 소비와 아무 상관 없는 마이그레이션을 추가했을 뿐인데 빨개진다.

**원인**: 그 가드는 "파일명 정렬 = 적용 순서"를 전제로 **마지막 정의**를 고른다. 전제가 깨지지 않게 `^\d{4}[a-z]?_` 밖의 이름이 하나라도 있으면 실패시킨다. `npx supabase migration new x`는 `20261002050926_x.sql`을 만든다 — 하루에 세 번(다른 세션 둘 + 시간표 연습실) 같은 이름이 들어왔다.

**규칙**:
- 🔴 **2026-10-27부터 시즌2** — 마이그레이션 파일은 **`s2_NNNN_설명.sql`**(0001부터 · 다음 빈 번호 · 빈틈·겹침 금지). 시즌1(아래 옛 규칙의 `NNNNa_` 568개)은 `supabase/migrations/s1_season1.sql` 하나로 합쳤다 — 원장 *"이전 001~458번대까지 sql을 전부 하나로 정리해서 뭉쳐놔. 번호가 너무 많이 올랐어. 다시 1번부터 시작할 수 있게"* · *"시즌2 sql 느낌으로 시작해 새로"*. 폴더에는 합본 · 시즌2 파일 · README만 둔다(가드 `src/lib/db/migrations-corpus.test.ts`). 합본은 **고치지 않는다**(지난 기록 — 바꿀 게 있으면 시즌2 파일로 다시 정의한다).
- 시즌1 SQL을 읽는 테스트·스크립트는 원래 이름으로 `readMigration("0349a_….sql")` · 적용 순서 전체는 `migrationFiles()`(`src/lib/db/migrations-corpus.mjs` — 합본 구역 머리줄 `--@@s1 <원래 이름>`). 문서 표기는 `supabase/migrations/s1_season1.sql#0349a_….sql`. 낱개 파일은 git 기록(합본 커밋 직전)에 그대로 있다.
- 🔴 합본 전에 갈라진 브랜치가 **옛 낱개 파일을 고쳤으면**(modify/delete 충돌) 그 변경을 합본 구역에 넣지 말고 **시즌2 파일**로 옮긴다. 새로 만든 `0459a_…`류는 다음 빈 `s2_` 번호로 바꾼다 — 단계별 방법과 부딪히는 브랜치 목록은 [`sql-season2.md`](sql-season2.md).
- (옛 규칙 — 시즌1) 마이그레이션 파일은 **`NNNNa_설명.sql`**(다음 빈 번호). CLI로 만들었으면 커밋 전에 이름을 바꾼다. 이 저장소는 CLI의 적용 기록 표를 쓰지 않아 이름과 DB는 무관하다(내용은 그대로).
- 번호는 main에 합치는 시점에 확정된다 — 다른 워크트리가 쓰는 번호를 `git worktree list`의 각 `supabase/migrations`에서 확인할 것.
- 🔴 이름을 바꿀 때 그 파일을 **경로로 읽는 곳**을 저장소 전체에서 찾는다. `src`·`docs`·`scripts`만 보면 `tests/integration/*.test.ts`를 놓친다(실제로 놓쳤다가 푸시 전에 잡았다).
- ⚠️ 번호가 뒤로 가도 되는지는 **같은 객체를 다시 정의하는 파일이 그 사이에 있는지**로 판단한다(있으면 "마지막 정의" 판정이 뒤집힌다).
- 📌 **2026-10-22 일괄 개명**: 10-07~10-22 여러 세션이 Supabase CLI로 넣은 타임스탬프 이름 **48개**(`20261007171329_mcs_atomic_goal_reset.sql` ~ `20261022201000_student_contribution_functions.sql`)를 **`0396a`~`0443a`로 개명**했다(원장 *"얼마 안 걸리면 지금해"*). 타임스탬프 이름이 원래 모든 `NNNNa_` 뒤로 정렬됐으므로 **이름 순서 그대로 번호를 매겨 정렬 순서(= `pnpm db:alphas` 적용 순서)는 개명 전과 같다**. 저장소 안 참조(경로·숫자만 적은 표기 58파일)도 함께 바꿨다. 운영 DB는 alpha 파일 이름을 남기지 않아 다시 적용할 일이 없다 — 예외로 `supabase_migrations.schema_migrations`에 `20261011170545`(laboratory_menus → `0408a`) 한 줄이 남아 있는데, 이 저장소는 `supabase db push`를 쓰지 않으므로 무해하다. 가드(`session-consumption-wiring.test.ts`)는 다시 "규약 밖 파일 0개"로 엄격하다 — **새 파일도 `NNNNa_`**(CLI로 만들었으면 다음 빈 번호로 바꿔서 커밋). 이 개명 전에 갈라진 브랜치가 옛 이름 파일을 고치면 git이 대개 개명을 따라가지만, 그 브랜치가 **새로 만든 타임스탬프 파일**은 가드에 걸린다.
- 📌 10-23에 또 2개(업체리스트)가 들어와 0448a·0449a로 개명(`20261022140000_inventory_vendors.sql` → `0448a_inventory_vendors.sql` · `20261023120000_inventory_vendors_private.sql` → `0449a_inventory_vendors_private.sql`).

## #140 `all: revert`는 **`hidden` 속성의 숨김까지 지운다** — 감춰 둔 요소가 화면에 나타난다 (2026-10-03)

**증상**: 시간표 편집기를 앱에 넣으려고 스타일을 `@scope (.timetable-workspace) { * { all: revert } … }`로 격리했더니, 통합뷰 왼쪽 아래에 **작은 파란 조각**이 떠 있었다.
끄는 동안에만 보여야 하는 이름표(`<div hidden class="roster-drag-ghost">`)였다. 코드는 `el.hidden = true`를 정확히 부르고 있었고 오류도 없다.

**원인**: 크로미움은 `hidden` 속성의 `display: none`을 브라우저 기본 스타일시트의 규칙이 아니라 **표현 힌트**(작성자 수준 · 명시도 0)로 건다. `revert`는 작성자 수준을
"없던 일"로 되돌리므로 그 힌트까지 함께 지워진다(`width`·`height`·`align` 같은 표현 속성도 같은 이유로 무시된다). `dialog:not([open])`의 숨김은 기본 스타일시트 규칙이라 멀쩡하다 —
그래서 "창은 잘 닫히는데 이름표만 보이는" 모양이 된다.

**규칙**:
- 한 구역을 `all: revert`(또는 `all: unset`/`initial`)로 초기화하면 **바로 아래에 `[hidden] { display: none !important; }`를 함께** 둔다.
- 왜 굳이 되돌리나: 앱의 초기화 스타일(Tailwind preflight — 버튼 테두리·제목 크기·여백을 0으로)에 기대지 않고 **브라우저 기본값에서 출발**해야, 로그인 없이 띄우는 시험용 화면과 앱 안에서 같은 모양이 나온다. preflight는 `@layer base`라 층이 없는 규칙이 명시도와 무관하게 이긴다.
- ⚠️ 되돌리는 선택자의 명시도는 0으로 둔다(`:where(:scope), *`). 올리면 그 구역 안의 평범한 규칙(`button { … }`)이 전부 진다.
- ⚠️ 판별은 눈이 아니라 **실브라우저 `getComputedStyle(el).display`** — 타입체크·단위 테스트·happy-dom은 못 잡는다([[#127]]과 같은 결).
- ⚠️ 앱의 층 없는 전역 규칙(`globals.css`의 스크롤바·줄바꿈 등)은 명시도가 0보다 커서 구역 안에도 그대로 들어온다 — 격리는 "preflight로부터"이지 "전역 규칙 전부로부터"가 아니다.


## #141 중첩 native button은 SSR 뒤 화면 밖에 달력 조각을 남길 수 있다 (2026-10-03)

ECS 월간 날짜 칸의 button 안에 미루기·당기기 button이 들어 있었다. HTML 파서가 바깥 버튼을 먼저 닫으면서 일부 날짜가 React의 라우트 경계와 셸 밖으로 빠져나갔다. 다음 화면으로 소프트 이동해도 그 노드가 남았다. 별도 셸과 Suspense 라우트 경계의 실제 브라우저에서 이동 뒤 14개 조작·문서 높이 1441px을 재현했고, 수정 뒤 0개·761px으로 확인했다.

- 버튼 안에 native button을 넣지 않는다. 현재 월간 칸은 기존 날짜 버튼을 유지하고 내부 조작을 `span role=button`으로 표현한다. 클릭 전파를 막고 Enter·Space 동작·초점 표시를 직접 제공한다.
- 키보드로 내부 조작을 눌러도 날짜 편집을 함께 열면 안 된다. 다른 키의 전파는 막지 않는다.
- 단순 클라이언트 렌더·언마운트 검사만으로는 파서 오류를 재현하지 못한다. SSR로 직접 진입 후 소프트 이동을 확인해야 한다.
- 화면낭독기까지 완전한 독립 조작을 보장하려면 장기적으로 날짜 칸과 내부 버튼을 형제 구조로 바꾸는 검토가 필요하다. 이번 합의는 기존 바깥 날짜 버튼을 유지한다.

## #142 설정 문서의 한 섹션을 **통째로 갈아끼우면** 먼저 한 저장이 되돌아간다 — 그리고 고치는 길에 함정이 셋 더 있다 (2026-10-06)

`tenant_settings.data.operations`는 쓰는 곳이 여럿이다(설정의 두 면 · 시간표의 강사 순서/통합뷰 그룹 · 예약 그룹 cron · 영어 시트 반영). 화면은 연 시점의 섹션 전체를 되돌려 보냈고 서버는 통째로 교체했다. 저장 액션의 `updated_at` 검사는 **액션이 읽은 뒤**의 변경만 보므로, 창을 열어 둔 사이의 다른 저장은 조용히 옛 값으로 덮였다(오류도 로그도 없다).

- **쓰는 곳이 둘 이상인 섹션은 "방금 읽은 값 위에 제 몫만"** — 요청은 무엇을 바꾸는지만 싣고, 적용은 저장이 읽은 값 위에서 한다(`operations-slice.ts`). 서버 안에서 "읽고 → 전체를 다시 보내는" 호출도 같은 문제다(읽기와 저장 사이가 비어 있다).
- 🔴 **문서 최상위에 새 키를 두지 말 것** — DB 쓰기 가드(0335a `guard_tenant_settings_write`)는 개별 설정만 위임받은 사람에게 "맡은 섹션 밖은 그대로일 것"을 요구한다. 최상위에 장부용 키(저장 순번 등)를 더하면 그 사람들의 저장이 **전부** 거절된다. 원장 계정으로는 재현되지 않는다(가드를 통과한다) — 모의 DB 테스트도 못 잡는다. 섹션 안에 둔다.
- 🔴 **순서를 시각으로 가리지 말 것** — "이 값이 내 저장보다 먼저 읽혔나"를 `updated_at`으로 비교하면, 서버마다 시계가 다르고 DB 안에서 직접 쓰는 곳(RPC)은 자기 `now()`를 써서 순서가 뒤집힌다. 값 안의 순번(정수)을 쓴다 — 순번을 모르는 쓰기는 그대로 둘 뿐 줄이지 않는다(`settings-stamp.ts`).
- 🔴 **화면에 내려오는 값은 도착한 순서 ≠ 읽힌 순서** — 저장이 도는 동안 다른 탐색이 화면 값을 다시 읽으면, 저장 전에 읽힌 값이 저장 뒤에 도착한다. 깨끗한 폼이 그 값을 받으면 방금 저장한 내용이 화면에서 사라지고 기준 값도 옛것이 된다. 저장 중에는 받지 않고, 내 확정 상태보다 먼저 읽힌 값은 버린다(`use-section-draft.ts`).
- ⚠️ 폼의 값·"어디서 출발했나"의 표식·미저장 가드의 기준은 **함께만** 움직인다 — 표식만 새것이 되면 옛 값이 저장 검사를 통과한다. 저장 성공은 **제출한 값**에 대해 확정한다(저장 도중 더 고친 것은 미저장으로 남는다).
- ⚠️ `deepMerge`는 기본값의 키만 순회한다 — 키가 열려 있는 값(부서별 직급 같은 record)은 기본값이 `{}`면 저장값이 읽을 때 전부 떨어진다(저장 토스트는 뜨고 새로 열면 비어 있다).

## #143 **모든 RLS가 지나는 함수**를 고칠 때 — 본문에 조건을 넣으면 모든 조회가 느려지고, `coalesce`를 쓰면 실행 계획이 달라진다 (2026-10-12)

운영 콘솔의 '원장 화면 열기'(0356a)에서 `auth_tenant_id()` · `auth_system_role()`에 "보기 헤더가 있으면 그 지점"을 더하려다 만난 것들. 정책 253개가 이 두 함수를 부른다.

- **PostgreSQL 17은 SQL 함수(SECURITY DEFINER · SET 절)를 문장마다 · 호출 자리마다 다시 준비한다** — 운영 DB에서 약 0.27ms, 그리고 **줄마다 계산되는 자리(순차 조회의 Filter)에서는 줄당 약 0.06ms**다(원생 1,019줄 순차 조회 = 함수만 63ms). 본문에 서브쿼리 하나를 더하면 호출당 +0.06ms · 줄당 +0.006ms가 전 지점에 붙는다. 🔑 내 PC(PostgreSQL 18)에서는 호출당 0.009ms라 **안 보인다** — 이런 함수의 비용은 운영 DB에서 임시 함수(`pg_temp`)로 재고 되돌릴 것.
- **고침 = 얇은 겉함수 + 속함수**: 겉함수는 SECURITY DEFINER도 SET 절도 없는 한 줄 식(`return case … end`)이라 **계획 단계에서 호출 자리에 펼쳐진다**(inline) → 실행 때 준비되는 함수가 늘지 않는다. 종전 본문은 속함수로 그대로 둔다. 🔴 겉함수에 SECURITY DEFINER나 SET 절을 붙이면 펼쳐지지 않는다(검증: `explain`에 겉함수 이름이 보이면 안 펼쳐진 것).
- 🔴 **"조건에 안 맞으면 null"로 만들지 말 것** — 처음엔 보기 헤더를 실었는데 살아 있는 보기가 아니면 지점 · 역할을 null로 돌려주려 했다("그 지점 아니면 아무것도"). 그러면 **모든 사용자**가 헤더 한 줄로 자기 역할 · 지점을 null로 만들 수 있게 된다 — plpgsql의 `if v_role not in ('master','admin') then raise …`는 null에서 거절하지 않고 지나간다. 조건에 안 맞으면 종전 값 그대로 두고, "정말 그 지점이 나오는가"는 앱이 DB에 물어 확인한다.
- 🔴 **펼쳐지는 식에 `coalesce`를 쓰지 말 것** — 계획기는 정책 식이 "행의 값을 흘릴 수 있는가"를 식의 모양으로 판정하는데(`contain_leaked_vars`), `coalesce`는 '모르는 모양 = 흘릴 수 있음'으로 떨어진다. 그러면 보안 수준이 더 높은 자리의 같은 식이 인덱스 조건으로 못 올라가 계획이 달라진다. `case`는 안전한 모양이다.
- **계획기가 보는 비용도 맞출 것** — 함수 하나(비용 100)가 식 여럿으로 펼쳐지면 비용 합이 달라져 경계에 있던 계획이 뒤집힐 수 있다. 속함수 `cost 96` + 나머지 넷 = 100으로 맞췄다. 검증은 **적용 전후 실행 계획을 통째로 견주는 것**(운영 DB · 한 트랜잭션 · 끝에 ROLLBACK — 표 143개 × 3 + `pg_stat_statements`의 실제 문장 260개를 `explain (generic_plan)`으로, 1,378건 동일).
- 🔴 **이런 함수를 되돌릴 때는 두 단계로** — 겉함수를 종전 본문으로 되돌리면서 속함수까지 한 번에 지우면, 그 순간 실행 중이던 문장(펼쳐 둔 속함수를 계속 부른다)이 `cache lookup failed for function`으로 실패한다. 겉함수만 먼저 되돌려 커밋하고, 지우는 것은 실행 중이던 문장이 다 끝난 뒤에.
- ⚠️ 그 비교는 **같은 트랜잭션 안에서 앞뒤로** 받을 것 — 몇 초 간격으로 따로 받으면 그 사이 줄이 늘어난 표의 예상 줄 수가 달라져 "함수 탓"으로 보인다(적용을 되돌린 뒤 한 번 더 받아 데이터 변동분을 가려낸다).
- ⚠️ **검증 코드도 실패하는 길을 돌려 볼 것** — plpgsql에서 `v_fail := v_fail || '글자'`는 글자를 배열로 읽으려다 `malformed array literal`로 죽는다(실패가 생겼을 때만 실행되는 줄이라 통과하는 시험에서는 안 드러난다 → `array_append`). 일부러 망가뜨린 SQL을 넣어 검증이 떨어지는지 확인했다.
- ⚠️ `auth.uid()`는 옛 설정 `request.jwt.claim.sub`를 **먼저** 본다 — 같은 접속에서 앞서 넣어 둔 값이 있으면 `request.jwt.claims`를 바꿔도 그 사람으로 판정된다(검증 스크립트는 시작할 때 비울 것).
- ⚠️ 하위 트랜잭션에서 `transaction_read_only`를 켰다가 예외로 빠져나오면 되돌아온다 — 읽기 전용에서만 통하는 길을 **같은 트랜잭션 안에서** 시험하고 흔적 없이 되돌릴 수 있다.
- 📌 곁가지(미해결 · 성능): 지점 조건이 **Filter**로 걸리는 계획이 실측 1,218건 중 342건이다. 그 자리의 함수는 줄마다 불린다(줄당 0.06ms). 정책을 `tenant_id = (select auth_tenant_id())`로 감싸면 한 번만 계산된다 — 별도 작업으로 볼 만하다([[#91]]과 같은 원리).

## #144 Electron 안에서 `*.asar` 파일을 **쓰면** "Invalid package"로 실패한다 — 연동 앱 PC 업데이트가 한 번도 안 됐다 (2026-10-15)

**증상**: 연동 PC 앱(AywaSync) 업데이트 카드에 *"압축을 풀지 못했습니다. 디스크 상태를 확인하고 다시 시도해 주세요."* · 1.0.4가 그랬고, 10-09의 1.0.1→1.0.2 실패(그땐 원인 미확정 · 설치 파일 덮어 설치로 넘어감)도 같은 원인이었다. 디스크와 묶음은 멀쩡했다.

**원인**: 업데이트는 Electron 주 프로세스에서 돈다. Electron은 `fs`를 고쳐 `*.asar` 경로를 **폴더(묶음)처럼** 다룬다 → 새 버전의 `resources/app.asar`를 `fs.createWriteStream`으로 열면 `Invalid package …\app.asar`(코드 없는 오류). 업데이트 코드는 이 오류를 이름 붙은 원인에 못 넣어 `extract_failed`(위 문구)로 냈다.

**왜 못 잡았나**: 압축 해제 테스트·배포 검수가 전부 **일반 node**로 돌았다(같은 묶음 · 같은 코드가 node에선 10,000개 다 풀리고 앱 실행기에선 67번째 `app.asar`에서 멈춘다). 테스트 묶음에 `resources/app.asar`가 있었는데도 node엔 asar 패치가 없어서 통과했다.

**고침**: [`apps/sync-agent/lib/update.cjs`](../apps/sync-agent/lib/update.cjs) 첫 줄 — Electron이면 `require('original-fs')`(asar 패치 없는 원래 `fs`) · 테스트도 같은 방식 · [`test/bundled-runtime.cjs`](../apps/sync-agent/test/bundled-runtime.cjs)가 `test/update.test.cjs`를 **포장된 실행기 안에서**(`ELECTRON_RUN_AS_NODE=1 AywaSyncRuntime.exe --test …`) 한 번 더 돌린다.

- 🔴 버그는 **설치된 쪽**에 있다 — 1.0.4 이하 PC는 고친 1.0.5도 PC 안 업데이트로 못 받는다. 설치 파일로 한 번 덮어 설치(실행기가 설치된 순번이 더 크면 그 버전을 쓴다 — `native/Bootstrap.cs`).
- ⚠️ 쓰기만이 아니다: 읽기·`rm -r`·`lstat`도 `.asar`를 묶음으로 본다. Electron 안에서 `.asar` 파일 자체를 다룰 땐 늘 `original-fs`.
- 🔑 진단: 앱 화면은 고정 문구만 남긴다 → 게시 묶음을 받아 **앱 실행기로** 같은 코드를 돌려 원문 오류를 볼 것(`ELECTRON_RUN_AS_NODE=1`).
- ⚠️ 곁가지: `app.setLoginItemSettings`가 쓰는 Run 값 이름은 `name`을 안 주면 **`electron.app.<실행 파일 제품 이름>`**(= `electron.app.AYWA 연동` · 개발 `electron.exe`로 띄우면 `electron.app.Electron`이라 개발 실행으로는 못 본다 — 포장 실행기 사본에 `resources/app` 프로브를 넣어 확인). 제거 스크립트가 엉뚱한 이름(`AYWA 연동`)을 지우고 있었다 → 실제 이름으로 · 덮어 설치(`${isUpdated}`) 땐 안 지운다. ⚠️ "덮어 설치하면 자동 실행이 지워진다"는 리뷰 가설은 이 실험으로 반증됐다(가설만으로 앱 시작 때 재등록을 넣었다가 되돌림 — 그건 작업 관리자의 '시작 앱 끔'을 매번 되살리는 부작용이 있다).

## #145 모델을 올리면 **예시대로 하던 것이 규칙대로**가 된다 — Haiku 4.5 → 5.5에서 "100%를 해 왔습니다"·"수학 2-4-3 비례식"·어미 섞기 (2026-10-16)

**증상**: 운영 모델을 Haiku 4.5에서 5.5로 올리기 전 운영 조건 그대로 돌렸더니, 5.5가 "지난 과제는 100%를 해 왔습니다", "수학 도수분포다각형과 상대도수를 배웠습니다"처럼 썼다(10건 중 8건). 진도의 단원 번호("2-4-3~2-4-5")도 5.5만 옮겼다. 120건에서는 한 글 안에서 합니다체·해요체를 섞은 글이 46%였다(4.5 운영 8% · 선생님 직접 작성 6%).

**원인**: 프롬프트에 규칙과 예시가 함께 있었다 — "퍼센트는 [입력]에 적힌 그대로" + 예시 "과제: 100%" → "다 해왔습니다", "'~했습니다'를 기본으로 하되 '~했어요'를 섞어도 됩니다". 4.5는 **예시**와 눈치를 따랐고 5.5는 **규칙**을 글자대로 따랐다(허용 문구는 적극적으로 썼다). 과목명·단원 번호는 [입력]에 그대로 있었고 4.5가 알아서 뺐을 뿐이다 — 지금까지의 "멀쩡한 발송"은 모델의 눈치였다.

**고침**: 지시를 늘리지 말고 **재료를 고친다** — 100%는 `homeworkFactValue`가 "빠짐없이 다 해 옴"으로 넘기고(멘트·추세 공용), 진도는 `progressForMent`가 단원 번호를, `progressFact`가 과목명을 떼고 넘긴다. 종결형은 `TONE_RULES`가 "한 글 안에서 한 가지"로 못박고 예시도 맞췄다.

- 🔑 모델 교체 시험은 **운영 프롬프트 그대로** 돌릴 것 — 첫 시험(9건)은 말투 지침·결 변형을 빼고 돌려 이 셋을 못 봤다. 비교 기준은 **운영 발송분**(같은 지표를 지난 30일 발송분에서 잰다).
- ⚠️ 시험 입력을 저장된 보고서에서 만들 땐 저장 형식과 운영 입력의 차이를 맞출 것 — 저장된 진도 칸은 카드용으로 과목 라벨을 붙여 저장한다("수학 2-6-4 …"). 그대로 넣었더니 '과목명 접두'가 67건 나왔는데 전부 시험 입력 탓이었다.
- ⚠️ 새 모델은 생각 토큰을 출력 상한에서 쓴다(Haiku 5.5 effort low 740~2,000) — 종전 상한(1,000)이면 절반이 답 전에 잘린다(바닥 = `OUTPUT_TOKEN_FLOOR` · 기다리는 멘트는 `WAITING_OUTPUT_TOKEN_FLOOR`, generate.ts `sentMaxTokens` — 2026-10-19 옛 `CLAUDE5_MIN_MAX_TOKENS` 4,096을 대신함).

## #146 Next 16은 **같은 경로에서 쿼리만 바뀌면 페이지(폼)를 새로 그리지 않는다** — 새 작성 화면이 옛 입력을 그대로 들고 뜬다 (2026-10-16)

**증상(설계 중 발견)**: 단일 화면에서 `/enrollment/new`(A 상담 입력 중)에서 `/enrollment/new?form=b`로 옮겨도 폼이 A의 입력 그대로다 — 클라 상태가 남는다.

**원인**: Next 16.2의 레이아웃 라우터는 자식 상태 키를 `createRouterCacheKey(segment, true)` — **쿼리를 뺀** 세그먼트로 만든다(`layout-router.js` `activeStateKey`). 페이지는 새 쿼리로 다시 그려지지만(서버 props는 새 값) React 입장에선 같은 자리라 `useState` 초기값·비제어 입력은 그대로다. 직전 화면을 숨겨 보존하는 장치(`MAX_BF_CACHE_ENTRIES`)는 cacheComponents가 꺼져 있으면 **1** — 다른 경로로 갔다 오면 새로 마운트된다(반대로 기대하지 말 것).

**고침**: 쿼리로 '다른 화면'을 가리키면 **페이지가 그 값으로 폼에 `key`**를 건다(`formInstanceKey` — 새 회의록·신규 콜&상담·원생상담). 같은 화면을 가리키는 쿼리(`resume`)는 키에 넣지 않는다(붙어 있는 폼이 다시 그려지면 입력이 날아간다).

## #147 외부 웹훅이 **N초 안에 답을 못 받으면 다시 보낸다** — 녹음 1건에 AI가 6~11번 돌았다 (2026-10-19)

**증상**: 화면·에러는 멀쩡한데 비용만 몇 배. `ai_usage_logs`에 같은 기능·**같은 입력 토큰 수**가 10~20초 간격으로 줄지어 있다(10/16 18:00 녹음 하나에 폼 추출 11번 · 분석 11번). 30일 중복률 = 콜&상담 분석 89% · 폼 88% · 회의록 82%(약 $8~10/월). 결과도 그때마다 덮어썼다.

**원인**: AssemblyAI는 웹훅이 **10초 안에 2xx**를 못 받으면 실패로 보고 10초 간격으로 **최대 10번** 다시 보낸다(공식 문서). 우리 웹훅은 전사 가져오기·AI 분석(1~3분)을 **끝낸 뒤에** 답했고, 중복 방지는 '완료' 상태만 봤다 — 녹음 행이 완료·상담이 '분석 중'이면 오히려 "분석 복구"로 읽어 처음부터 다시 돌렸다.

**고침**: 행을 찾자마자 `{ ok, accepted }`로 답하고 무거운 일은 `after()`(라우트 maxDuration 300초 안)로. '분석 중'이고 `updated_at`이 10분 안이면 재전송으로 보고 건너뛴다(`transcription-inflight.ts`). after 안에서 죽으면 그 행을 'failed'로(못 돌리면 하루 1회 `reconcile-transcriptions` cron이 30분 넘은 행을 돌린다). ⚠️ 곧바로 답하면 **재전송이 사라지므로 '재전송 = 복구'도 사라진다** — 함수 상한(300초)에 끊기면 catch도 못 돈다 → 일에 **270초 자체 기한**을 걸어 넘기면 실패로 돌린다.

**교훈**: 남이 부르는 엔드포인트는 **상대의 타임아웃·재시도 규칙**부터 확인할 것(대개 5~30초). 오래 걸리는 일은 받는 즉시 답하고 뒤에서. 🔑 "에러 없이 비용만 는다"면 로그에서 **같은 입력이 줄지어 있는지**를 먼저 본다.

## #148 두 시스템이 동명이인 알파벳을 **따로** 매기면 같은 학생이 셋이 된다 — 권민서A(에이와) · 권민서(메이크에듀) · 권민서B(동기화) (2026-10-20)
**증상**: 콜&상담 '메이크에듀 원생 전환' 표식이 실제 원생인 학생에게 안 섰다(권민서·김지유).
**경로**: ① 상담→수업 배정이 새 학생을 만들며 퇴원한 다른 권민서 때문에 `권민서A`로(에이와 규칙 = 퇴원생 포함) — 그런데 **상담 이름은 `권민서` 그대로** ② 역동기화가 상담 이름 `권민서`를 메이크에듀로 보냄 → 메이크에듀는 그 이름으로 원생 전환 ③ 원생 동기화의 매칭 티어가 전부 **이름이 글자까지 같을 것**을 요구해 `권민서` ≠ `권민서A`로 놓침 → `권민서B`(메이크에듀 번호 14122)를 새로 만듦 ④ 데이터 정리 '접미사만 다름'이 잡아 병합했는데 **병합이 `makeedu_id`를 남는 쪽으로 옮기지 않아** 연결이 퇴원한 빈 행에만 남음.
**고침**: 상담→학생 전환이 알파벳을 붙이면 상담 이름도 같이(메이크에듀로도 같은 이름이 간다) · 동기화 마지막 티어 = 알파벳 뗀 이름 + 전화(안 이어진 재원·휴원만 · 모호하면 안 붙임) · 병합이 메이크에듀 번호를 옮긴다(`planMakeeduCarry` — 둘 다 다르면 옮기지 않고 알림) · 데이터 정정(번호 이동·B 삭제·상담 이름 12건, 감사로그).
**교훈**: 외부 시스템과 **이름으로** 맞추는 동기화에 우리 쪽이 이름을 바꾸는 규칙(접미사)을 두면, 매칭 키에서 그 규칙을 **되돌려야** 한다. 🔑 병합처럼 "한쪽을 지우는" 동작은 **외부 키**(makeedu_id 등)도 옮길 대상인지 따로 볼 것 — 수강·출결만 옮기면 연결이 빈 행에 남는다.

## #149 `endsWith("등록")`은 **'미등록'도 잡는다** — 부정어가 접두로 붙는 값에 접미 판정을 먼저 두면 반대 뜻이 된다 (2026-10-22)
**증상**: 신규 콜&상담 통계에서 2025-12 등록 전환율 100%(48/48) · 2026-01 98%. 상세엔 '등록 상태: 미등록'인데 상태 칩은 '등록'.
**원인**: 옛 앱 이관 `mapConsultationOutcome`이 `t.includes("등록완료") || t.endsWith("등록")`을 `t === "미등록"`보다 **먼저** 봤다 — '미등록'.endsWith('등록') = true라 2026-07-01 이관 107건이 '등록'으로 들어갔다(뒤의 미등록 분기는 영영 안 탔다). 타입·테스트 없이 한 번 돈 스크립트라 아무도 못 봤다.
**고침**: 부정(`미등록`)을 먼저 · 이미 들어간 행은 실제 근거(수강 시작 · 캘린더 '첫수업')로 다시 판정해 근거 없는 60건만 미등록으로(`fix-enrollment-stats-from-calendar.cjs`).
**교훈**: 한국어 상태값은 부정이 **앞에** 붙는다(미등록·미납·미배정·비재원) — `endsWith`·`includes`로 긍정을 먼저 판정하면 부정이 삼켜진다. 부정 분기를 맨 위에. 🔑 비율이 100%·0%로 딱 떨어지는 달은 데이터를 의심할 것.

## #150 이름은 '받는 곳'인데 실제로는 **신분 증명**이었다 — `(수학)이름` 1인 보드 원아를 빼면 반 보드 발송이 막힌다 (2026-11-02)
- **증상(예정이던 것)**: 반별 발송으로 옮긴 지 한 달, 1인 보드로는 한 건도 안 나가서 원아 배정을 전부 해제했다(149명) → 다음 반 보드 동기화가 그 학생들을 'ClassNote 미가입·미배정(1인 보드 원아 0명)'으로 보류 → 0302a hold → **반 보드로 가는 발송이 막힌다.** 같은 날 새벽 05시 1인 보드 준비(`provisionDailyOnce`)는 빈 보드를 '가입했는데 빈 보드'로 보고 원아를 다시 넣고(학부모 앱 배정 알림 가능), 지운 보드는 다시 만든다.
- **원인**: 반 보드 동기화의 원아 판정 ①이 '그 학생 1인 보드에 배정된 원아만'(동명이인 방어). 1인 보드는 발송 경로에서 빠졌어도 **신분 증명 출처**로 남아 있었다. 배정 실행도 직전에 1인 보드를 다시 읽어 계획과 다르면 동기화 전체를 멈춘다.
- **고침**: 1인 보드가 없거나 비면 0302a에서 이미 '정상'으로 확인된 원아 중 **기록된 그 반 보드에 지금도 있는 원아**로 판정(가드 ②~⑥ 다시 · ④는 기록에서 다른 학생에게 확인된 원아인지도 · 확인 기록을 못 읽으면 그날 동기화를 건너뛴다 — 그대로 돌면 기록이 지워진다) · 1인 보드 재확인은 1인 보드에서 가져온 학생만 · 05시 준비는 확인된 학생을 뺀다(신입은 그대로).
- 🔑 **'이제 안 쓰는 것'을 지우기 전에 그걸 읽는 곳을 전부 찾을 것** — 발송 경로만 보면 0건이라 안전해 보인다. `(수학)`·`personalBoardName`·`personalBoardId`를 grep하면 판정·배정·해제·준비 네 곳이 나온다.
- ⚠️ 해제 뒤엔 보드 기준 글 목록(`reports/?cls=`)이 0건으로 나온다(원아가 없는 보드) — 옛 글은 원아 기준(`?child=`)으로 그대로 보인다. 보드 삭제 전 백업은 원아 기준으로.
