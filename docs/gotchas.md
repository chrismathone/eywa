# eywa — 구현 중 막혔던 점들 (#1~#74 함정 사전, Tier 1)

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
- **대안(안전한 기존 패턴)**: 부모를 **조건부 마운트(`{open && <Dialog/>}`)** 로 두면 닫힐 때 언마운트→`useActionState` 리셋이라 가드 없이도 안전(eywa
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
원인 = 미러 트리거 [`tg_sync_user_from_auth`](supabase/migrations/0001a_rls_constraints_triggers.sql)의 `on conflict do update set system_role = excluded.system_role`.
`excluded.system_role`은 `coalesce(app_metadata.system_role, 'viewer')`라, **GoTrue가 어떤 `updateUserById`(비번리셋·ban·이메일변경)에서든 `raw_app_meta_data`를 재기록**하며
`update of raw_app_meta_data` 트리거를 발동 → app_metadata에 role이 없거나 stale하면 `public.users` role을 **덮어써** teacher→viewer로 강등(2026-07-01 이수연/kelly에 실발생, 이후 8명 추가 확인).
`getCurrentUser`/`auth_tenant_id()`는 `public.users`를 읽어 평소엔 무해하나, **트리거가 write 시 stale app_metadata를 재전파**하는 게 함정.
- **하드닝**([`0075a`](supabase/migrations/0075a_mirror_trigger_role_hardening.sql), `create or replace`, dev=prod 적용): `v_role`(viewer 폴백)을 **`v_role_explicit`**(app_metadata에 role이 **명시적으로 있을 때만** non-null)로 분리.
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
시간표 기본뷰 헤더를 sticky-top으로 고정하니 스크롤 시 헤더에 본문(학생 이름)이 **비쳐 보였다**. 원인 = eywa `-soft` 색 토큰(`bg-blue-soft` 등)이 **12% 알파(반투명)**·`/50`은 6% → sticky 셀이 반투명이라 아래로 스크롤되는 본문이 그대로 비침(computed `rgba(31,107,168,0.12)`로 확인). 불투명한 `bg-bg-soft`(rgb, 알파 없음)·`bg-card`는 안 비친다.
- **수정**: 반투명 색을 셀에 직접 주지 말고 **불투명 base(`bg-card`) 셀 + 그 위에 반투명 색밴드를 얹는 자식 div**로 분리(색감 동일, 본문 비침 차단). 두 bg-color 클래스 스택(`bg-card bg-blue-soft`)은 Tailwind 출력 순서로 승자가 갈려 불안정 → 레이어(자식 div) 방식.
- **교훈**: **sticky/fixed로 스크롤 본문 위에 겹치는 셀은 배경이 불투명해야 한다.** eywa `-soft`(12%)·`/50` 토큰을 스크롤 컨테이너 안 sticky로 쓰면 비친다 → 불투명 base + 색 레이어. (겹치는 요소는 배경/차단을 명시 — body-portal 오버레이 `print:hidden` [[#68]]과 같은 결.)

### 75. localStorage를 lazy `useState` 초기값으로 읽으면 hydration 크래시(#418) — 페이지 전체 클릭 먹통 (2026-07-13)
직원 상세 '월간일정' 탭이 **프로덕션에서 열리지 않았다**(콘솔 `Minified React error #418` = "Text content did not match" hydration mismatch). 원인 = 뷰 선호(달력/목록)를 `useState(() => localStorage.getItem(...))`로 **첫 렌더에서 읽어**, 서버 HTML(항상 "grid")과 클라 첫 렌더가 어긋남 → React가 hydration 도중 죽으면서 **그 페이지의 모든 이벤트 핸들러가 안 붙어 클릭이 전부 먹통**(탭이 "안 들어가짐"). #51(dnd-kit SSR id)과 같은 계열 — SSR/CSR 첫 렌더 불일치.
- **수정**: `useSyncExternalStore(subscribe, () => localStorage값, () => "grid")` — **서버 스냅샷(3번째 인자)은 항상 "grid"**라 SSR HTML과 첫 클라 렌더가 일치하고, hydration 후 저장값으로 전환. localStorage 쓰기는 리스너로 리렌더 브로드캐스트.
- **교훈**: **`'use client'`라도 SSR로 HTML이 먼저 나가는 컴포넌트에서 localStorage/window/Date를 첫 렌더 값으로 쓰면 안 된다**(lazy useState 초기값 포함). 클라 전용 값은 `useSyncExternalStore`(서버 스냅샷 상수) 또는 mount 후 effect로. 증상이 "프로덕션에서 페이지 클릭 전부 무반응 + 콘솔 #418/#425"면 이 케이스. (dev에선 non-minified라 더 요란하고, 프로덕션 minified는 페이지만 죽어 진단이 어렵다.)

### 76. 외부 API 전건 스캔을 서버 컴포넌트 첫 페인트에서 await = 서버리스 타임아웃 → 화면 안 열림 (2026-07-13)
월간일정 미매핑 직원 진입 시, 이메일 자동매칭용으로 Notion 업무 DB **담당자를 전건 스캔**(4,000행+ = 순차 40+ 왕복)했는데, 이게 **서버 탭 컴포넌트가 첫 페인트에서 `await`** → Vercel 함수 타임아웃 → 탭이 안 열림([[#54]] silent 절단의 시간축 버전, B2/B7 위반). 실측: 3개월 한정 필터도 19페이지·65초.
- **수정**: ① 서버 첫 페인트는 **미매핑이면 즉시 반환**(Notion 호출 0) → 화면 먼저 뜸(B7). ② 무거운 담당자 스캔·자동매칭은 **클라가 화면 표시 후 서버 액션(`prepareNotionMapping`)으로 지연 호출**(effect+"확인 중…" 스켈레톤). ③ 스캔 자체도 **최신 마감순 정렬 + `maxPages` 상한(8p≈800행)**으로 bounded + `unstable_cache` 10분(B6). 활동 중 담당자는 최근 창에 반드시 등장하므로 커버리지 손실 없음.
- **교훈**: **외부 API(Notion/시트 등) 페이지네이션 전건 순회는 페이지 로드 경로에서 절대 await하지 말 것** — 사용자 트리거 액션으로 빼고, 스캔은 항상 `maxPages`로 bounded + 캐시. "전건 스캔"은 행 수만이 아니라 **왕복 수 × 지연**이 타임아웃을 만든다. (Supabase 전건은 [[#54]] `fetchAllPaged`; 외부 REST 전건은 이 규칙.)

---

