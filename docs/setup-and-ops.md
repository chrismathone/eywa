# aywa — 셋업 · 운영 · 데이터 (Tier 1)

> CLAUDE.md에서 분리된 **Tier 1 참조 문서**. 기술스택·폴더구조·마이그레이션·git 협업·검증 게이트·데모 계정·남은 작업. 셋업/배포/이관 때 참조.

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
| 배포 | Vercel (`bigshols-projects/eywa`, 도메인 `www.aywa.co.kr`(기준)·`aywa.co.kr` — 옛 alias `eywa-alpha.vercel.app`은 www로 307 전환, 2026-09-21) |

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
supabase/migrations/            # 2026-10-27 SQL 시즌2 — 이 셋만 둔다(가드 src/lib/db/migrations-corpus.test.ts)
├─ s1_season1.sql               # 시즌1 합본(drizzle 0000~0027 + alpha 0001a~0458a, 568구역 · 고치지 않음 · 지문 고정)
├─ s2_0001_*.sql, s2_0002_* ... # 시즌2 — 새 SQL(다음 빈 번호 · RLS·제약·트리거 포함 · 멱등)
└─ README.md                    # 적용 기록
```

---


## 마이그레이션 & 시드 흐름

> 적용 방식·순서·alpha 파일 목록·**현재 적용 상태(검증 2026-06-16: 번호본 0000~0024 + alpha 전부 적용,
> trgm 색인 11개·RLS 미적용 테이블 0개 확인)**는 [`supabase/migrations/README.md`](supabase/migrations/README.md).
> ⚠️ **2026-06-18 이후 alpha 추가**(드리즐 스냅샷은 `0027_big_swordsman`에 멈춤 — 신규는 전부 손수 alpha, `db:generate` 금지):
> `0027b` 학생메모핀 · `0027d~f` 직원phone/조퇴/학생프로필 · `0027g/h` 시간표포트 RLS·이전 · **`0028a` 시험(exams) ·
> `0029a` 카카오메시징 · `0030a` 교재카탈로그 · `0031a` 운영감사로그 · `0032a` 레벨테스트 · **`0039a` 대시보드 집계 RPC ·
> `0040a` 상담통계 집계 RPC · **`0041a` 시간표 슬롯 라벨**(`class_schedules.slot_teacher_label/slot_room_label` — 영어 통합뷰
> 미니그리드용, ijw slotTeachers/slotRooms 백필)**(전부 dev DB 적용·RLS 격리·security invoker + `auth_tenant_id()` 이중격리).
> (시즌1 기록) drizzle 번호본은 `db:migrate`가 자동, RLS/트리거/확장/GIN trigram 색인 등 `000Na_*` **alpha는 손수** 적용
> (신규 DB 셋업 시 누락 주의).

> 🔴 **2026-10-27 SQL 시즌2** — 시즌1(drizzle 번호본 0000~0027 + alpha 0001a~0458a, 568개)은 `supabase/migrations/s1_season1.sql`
> 하나로 합쳤다(구역 머리줄 `--@@s1 <원래 이름>` · 고치지 않는다). 새 SQL은 **`supabase/migrations/s2_NNNN_설명.sql`**(0001부터).
> drizzle 저널·스냅샷은 지웠다(git 기록에만) — `db:generate`는 이제 스키마 **전체**를 `supabase/drizzle-out/`(커밋 안 함)에 처음부터 만든다.
> 참고용으로만 보고 필요한 문장만 시즌2 파일로 옮긴다.

1. **스키마 수정** — `src/lib/db/schema.ts`(참고용 — 진짜 정의는 SQL)
2. **시즌2 파일 작성** — `supabase/migrations/s2_NNNN_설명.sql`(다음 빈 번호 · RLS·제약·트리거 포함 · 멱등으로)
3. **새 DB 셋업** — `pnpm db:alphas` 하나로 시즌1 구역 → 시즌2 파일 순서대로 적용(구역마다 따로 · already exists는 건너뜀 · 🔴 빈 DB 전용 — `public.tenants`가 있으면 멈춘다 · `pnpm db:migrate`는 안내만)
4. **운영 DB** — 시즌2 파일 **그 하나만** 원장 승인 뒤 적용(`db:alphas`를 운영에 돌리지 않는다 — 시즌1 데이터 보정까지 다시 돈다)

> ⚠️ 옛 6단계 `pnpm db:seed`(`scripts/seed.ts`)는 **2026-09-19 영구 제거**했다 — 테넌트 데이터를 전부 지우고 다시 넣는
> 구조인데 데모 테넌트가 운영 테넌트 `injaewon`으로 승격돼(2026-07-01) 운영 DB를 날릴 수 있었다. 되살리지 말 것.

## Git 협업 규칙 (⚠️ 여러 세션이 병렬로 작업함)

### ⚠️⚠️ aywa는 이제 실제 가동 중 — main 직접 커밋·push 금지, dev 검증 후 반영 (2026-07-01, 사용자 지시)
**aywa가 실운영 중이므로 변경을 main에 바로 커밋·push하지 않는다.** 반드시 **dev(로컬/워크트리)에서 검증을 끝낸
뒤에만** main에 반영한다. 흐름:
1. **작업·검증은 브랜치/워크트리에서** — 기능 구현 후 게이트(typecheck/lint/test/build) + 실동작(dev 서버·브라우저) 검증까지 완료.
2. **main 반영은 명시적 승인 후에만** — 사용자가 "반영/머지/push해라"라고 확인하기 전까지 **main으로 커밋·push하지 않는다.**
   (프로덕션이 main을 따라가므로, 미검증 변경이 main에 들어가면 곧 실서비스에 나간다.)
3. 급하더라도 **검증 없이 main push 금지** — 검증하지 못하는 이유가 있으면 그 사실을 먼저 알리고 승인을 받는다.

> **한 줄 규칙: main = 프로덕션. dev에서 검증 끝나고 사용자 승인이 있을 때만 main에 반영한다. 곧바로 main 커밋·push 금지.**

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
- **둘 다 마이그레이션** → 같은 Supabase(운영 DB)에 동시 적용
- **둘 다 push** → non-fast-forward 도돌이표 (위 Git 협업 규칙)

### 병렬이 안전·유용한 경우
- **파일이 안 겹치는 독립 작업** (예: `/billing` ∥ `/meetings`). 단 공유 파일(`globals.css`·`schema.ts`·`navigation.ts`·`permissions.ts`)은 한쪽만 건드릴 것.
- **읽기·탐색 ∥ 코딩** — 한 세션은 쓰기를 안 함.
- **긴 작업(빌드·마이그레이션·긴 AI 호출) 돌려두고** 다른 작업 진행.
- **다른 repo/프로젝트** — 공유 상태 없으니 무조건 안전.

### 진짜 병렬 코딩은 worktree로 격리
```bash
git worktree add ../aywa-billing -b feat/billing   # 별도 디렉터리 + 별도 브랜치
PORT=3101 pnpm dev                                  # dev 서버는 포트 분리 (3100과 다르게)
```
세션마다 자기 worktree(= 자기 `.next`·자기 파일)를 열면 파일·빌드 충돌이 원천 차단되고, 끝나면 브랜치를 merge.
⚠️ **단 Supabase DB·Vercel 프로젝트는 worktree로도 안 갈라진다** — DB 변경(seed/migrate)은 격리해도 동시 금지.

### 오히려 한 세션 안에서가 나은 병렬
"조사하면서 구현"류는 새 세션보다 **서브에이전트(Agent)**(여러 곳 동시 탐색, 결과가 한 맥락으로 복귀) + **백그라운드 실행**이 안전하고 맥락이 안 흩어진다.

**한 줄 규칙: 읽기·탐색은 마음껏 병렬. 쓰기(편집·dev·DB·push)는 "격리됐는가?"를 먼저 확인 — 아니면 한 세션으로.**

## 검증 게이트 (commit 전)

```bash
pnpm verify      # 기본 — 바뀐 파일과 그 영향만(보통 1분 안팎 · 많이 쓰이는 파일을 바꾸면 전체 tsc로 올라가 몇 분)
```

**기본은 `pnpm verify` 하나**(2026-11-09, `scripts/verify-changed.mjs` · `verify-deps.mjs` · `verify-baseline.mjs` · `verify-vitest.config.mts`). AGENTS.md "검증 범위 원칙"대로 바뀐 파일과 그 영향만 본다.
- 린트 = 바뀐 JS/TS · 타입 = 바뀐 TS + 그 import + **역의존**(바뀌거나 지우거나 옮긴 TS 파일을 import하는 쪽, 재수출을 한 단계 더 — 60개를 넘으면 전체 tsc로 올린다). 지금 main의 타입 오류 11건(수정 계획 P0-3)이 import 경로에 걸리면 '그 밖' 실패로 나온다.
- 테스트 = `vitest related` + 바뀐 파일 이름을 글자로 적은 테스트(SQL·CSS·JSON 포함) + **폴더 전체를 훑는 가드**(늘)
- **기준선 비교** — main에는 이미 빨간 테스트가 있다(2026-11-09 실측 9건, 수정 계획 P0-3b). 실패한 파일만 혼자 다시 돌려(흔들림 제거), 기준 커밋의 사본(내장 디스크 임시 폴더 · **사본 자신의** vitest 설정과 `@` 별칭)에서도 **스택을 뺀 메시지 전체가 같게** 실패하면 "기존 실패"로 따로 보이고 나머지만 막는다. 값을 줄여 쓰지 않는 설정으로 돌리므로 위반 목록이 메시지에 그대로 들어간다 — 개수가 늘거나, 개수가 같아도 내용이 바뀌면 새 실패다.
  - 한계: 메시지가 값을 담지 않는 단언(`expected false to be true`)은 같은 테스트 안의 새 원인을 기존 실패와 구별하지 못한다. 그런 테스트가 기존 실패 목록에 있으면 그 기능을 만질 때 직접 확인할 것.
- 외장 SSD(exFAT)의 `._*` 메타 파일은 실행 전에 지운다(테스트·가드가 소스로 읽어 거짓 실패를 낸다).
- 기준은 `origin/main`과의 merge-base(`pnpm verify <기준>`), 결과 한 줄은 `.verify/log.txt`에 커밋 sha와 함께 남는다.
⚠️ 지금은 이게 **유일한 게이트**다 — CI(`.github/workflows/ci.yml`)는 2026-10-21부터 꺼져 있고(GitHub 결제), 켜져 있어도 배포를 막지 않는다
(`next.config.ts` `ignoreBuildErrors` · `main` 브랜치 보호 없음 · Vercel은 push마다 배포).

전체 검사는 **공통 타입·공용 기반·빌드 설정을 바꿨을 때만**:

```bash
pnpm verify --all-types   # 전체 tsc(힙 12GB — 기본 6GB `pnpm typecheck`는 지금 메모리 부족으로 죽을 수 있다)
pnpm test                 # vitest 전체
pnpm build                # next build (Turbopack)
```

Vercel은 push 후 자동 빌드.
마지막 커밋·푸시 전 적대적 리뷰는 이 게이트와 별도 필수 — `CLAUDE.md` 작업 선호.

## 데모 로그인 계정 (현재 상태)

> 🔴 **비밀번호는 문서에 적지 않는다**(보안 감사 2026-09-29 — 이 표에 평문으로 있던 비밀번호는 git 기록에 남아 있으니 **전부 바꿀 것**). 비밀번호는 원장이 따로 보관한다.

| 이메일 | 역할 | 용도 |
|---|---|---|
| chrismathone@gmail.com | master (지점장) | 인재원 지점장. super_admin 아님. **원장용 투어** (12메뉴) |
| st2000423@gmail.com | master + super_admin | SaaS 총괄 (전체 지점 관리) |
| teacher@ijw-demo.com | teacher (박지훈) | **강사용 투어** — 선생님 원스크린. 옛 seed가 만든 계정 |
| student@ijw-demo.com | student (김서연) | **학생용 투어** — 내 학습 현황 + 데일리 리포트. 옛 seed가 만든 계정 |

두 master 모두 ijw-demo academy master지만 **super_admin은 st2000423만**. `display_name`은 김수진 / 석태선.
데모 강사/학생 계정은 옛 `scripts/seed.ts`(2026-09-19 제거)가 만들었다 — 이제 되살리는 스크립트는 없다. 계정이
필요하면 새로 만들고, 시드를 되살리지 말 것. `student`는 `system_role` enum의 SQL 마이그레이션에 없어 옛 시드가
`ALTER TYPE … ADD VALUE IF NOT EXISTS 'student'`로 넣어 왔다(빈 DB 셋업 시 수동 — `supabase/migrations/README.md` §3).
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
    (필요 시 시드). 급여 월별표는 활성직원 39명 중 급여설정 1명뿐이라 거의 0원 — 데모용 급여설정 시드 필요. (⚠️ 운영 테넌트라 시드 스크립트로 채우지 말 것 — `db:seed`는 2026-09-19 제거.)
13. **P2 브라우저 실검증** — 시험 일괄입력·계산기·단가표·감사로그·레벨테스트는 **로직 레벨만 검증**(타입/테스트/빌드 그린).
    Chrome MCP 재연결 후 웨일에서 실거동 일괄 검증 필요(역할별 메뉴 노출 포함). [[reference_browser-verification-env]]
14. **ijw 갭 P3(미착수)** — 상담 녹음 AI / QR 공개접수 / 시간표 시뮬레이션 / 엑셀 라운드트립(import) / 지출 결재 +
    급여 정책엔진(과정별 단가·강사 override). 무겁고 데모 임팩트는 P2 < — 우선순위 재점검 후 진행.
15. **drizzle 스냅샷 reconciliation** — `0027b`~`0040a`(P2 테이블 + 설정/계산기/권한 + 집계 RPC)는 전부 **손수 alpha**
    (`db:generate` 금지, #P0-6 드리프트). 0027 시리즈(kiosk·timetable·messaging) 전부 main 안착 후 드리즐 스냅샷
    정식 재산출을 **별도 과제**로. 현재 적용 상태·alpha 전체 목록은 [`supabase/migrations/README.md`](supabase/migrations/README.md) §4·§5(검증 2026-06-20).
16. **시간표 P1(인라인 검색·강사 시간표 색상)** — 병렬 timetable 세션 소관. 이 세션 검토 시점엔 미반영(시간표가 과목×교시
    그리드로 재설계되어 방향이 다름). 그 세션 병합 후 실제 구현 여부 재확인.
