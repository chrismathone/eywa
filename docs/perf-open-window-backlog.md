# 새 창(iframe) 반응속도 — 적용 현황 + 보류 백로그

> 메뉴=플로팅 창=same-origin iframe이라 새 창을 열면 **풀 라우트(셸 레이아웃 + 페이지 쿼리)가 매번 새로 렌더**된다.
> "새 창 열기(클릭→콘텐츠)" 및 멀티윈도우 복원 반응속도를 줄이는 레버를 계층별로 측정한 결과(2026-07-01, 멀티에이전트 분석).
> **이 문서는 "나중에 요청 시 바로 실행"하기 위한 실행 카드** — 각 항목에 트리거·파일·방법·효과·위험을 적어둠.
>
> ▶ **사용법(트리거)**: 사용자가 코드명(BL3 등) 없이 **"속도 개선 / 새 창 더 빠르게 / 반응속도 더 줄여줘"** 같은 말을 하면 —
> 아래 "보류 백로그"에서 **효과 큰 순으로 다음 레버**를 골라 제안하고, 동의 시 실행한다. "비권장" 항목은 제안하지 않는다.
> **현재 상태(2026-07-13): BL1·BL3·BL4·dashboard/lesson-reports loading·QW4 = 적용 완료.** 남은 **코드** 레버는
> 효과 제한적(loading.tsx 잔여 후보·BL2). **체감을 더 줄이려면 코드가 아니라 인프라** — 새로고침(⟳)은 iframe 강제
> 재요청이라 코드 캐시로 못 줄이고 순수 TTFB(=Supabase 쿼리 실행·Vercel 콜드)만 남는다. Vercel 함수는 이미
> `vercel.json regions:["icn1"]`로 DB(ap-northeast-2 서울)와 co-location됨 → 남은 최대 레버 = **Supabase Pro 전용 컴퓨트**
> (Free의 공유 컴퓨트+유휴 자동정지 제거). 상세는 아래 T1 아래 "인프라 메모".

## ✅ 이미 적용됨 (2026-07-01, main)

- **BL1 — 인증 로컬 JWT 검증** ([src/lib/auth/current-user.ts](../src/lib/auth/current-user.ts), 커밋 145a33e):
  `supabase.auth.getUser()`(GoTrue 네트워크 왕복) → `getClaims()`(로컬 WebCrypto 검증). 새 창·네비마다 들던 인증 왕복 제거(멀티윈도우 N배).
  tenant_id·role은 여전히 `public.users` SELECT(authoritative). getClaims 에러 시에만 getUser 폴백(파국 방지).
  **전제 충족 확인됨**: 프로젝트 JWT 서명키 = **ECC (P-256) 비대칭** (Dashboard › Auth › JWT Keys, 2026-06경 HS256→ECC 전환). → 효과 실효 중.
  ⚠️ 트레이드오프: 강제 로그아웃/ban이 access token 만료까지 지연(아래 T1로 완화 가능).
- **QW1 — 등록상담 QR 첫 페인트 분리** ([intake-qr-section.tsx](<../src/app/(shell)/enrollment/_components/intake-qr-section.tsx>)):
  토큰 조회+QR SVG 생성을 Suspense 자식으로 분리(QR은 버튼 클릭 시에만 보임). qrcode는 서버 전용 유지.

## ✅ 추가 적용 (2026-07-10)

- **BL4 — 메뉴 hover document 프리워밍** ([prefetch-embed.ts](../src/components/workspace/prefetch-embed.ts)):
  사이드바 RailItem + WindowLink hover → 120ms 디바운스 후 `<link rel="prefetch" as="document">` 1회.
  자주 쓰는 메뉴 루트 allowlist · URL당 1회 · 데스크톱은 `?embed=1`(iframe과 동일 키). leave 시 스케줄 취소.
- **dashboard `loading.tsx`** + **lesson-reports `loading.tsx`**(별 커밋): 무거운 첫 fetch·필터 드문 라우트 B7.
- **QW4 출석 중복** — 코드상 이미 해소: `classId=null`이면 classes만, 반 선택 시에만 매트릭스 재조회(별도 리팩터 불요).

## ✅ 추가 적용 (2026-07-13)

- **BL3 — 닫은 창 warm-iframe 보존 / LRU 풀** ([window-store.ts](../src/components/workspace/window-store.ts) `cached`/`CACHE_MAX`):
  `close()`가 라우트 창을 **파괴 대신** `minimized:true`+`order`에서 제거로 두고 `cached` LRU(상한 2)에 보존 →
  같은 메뉴 재오픈 시 **재렌더·재하이드레이션 없이 즉시** 표시(닫기 직전 화면·드릴인 위치 유지, minimize 인프라 상속).
  캔버스가 `Object.values(windows)`를 렌더하고 스위처·스냅·점 UI는 `order`/`!minimized` 기준이라 **컴포넌트 변경 0**.
  상한 초과분은 실제 파괴(메모리·realtime WS·타이머 가드). 학생 요약·복제본(#n)·생성폼(autoClose)·더티 창은 비캐시(완전 파괴).
  cached는 영속 제외(partialize)라 다음 세션 유령 부활 없음. Vitest 5개(warm 보존·재오픈 un-cache·비캐시 파괴·LRU evict·LRU 갱신).
  **트레이드오프**: 재오픈은 "닫을 때 그 내용"(자동 새로고침 안 함 = 즉시성) → stale하면 타이틀바 ⟳. 숨은 iframe 최대 +2(=minimize 동급, 상한 가드).
  ⚠️ BL4와 보완(첫 오픈=BL4 hover 프리워밍, 재오픈=BL3 warm).

## ⏸️ 보류 — 요청 시 바로 실행 (효과 큰 순)

### loading.tsx 추가 (남은 후보)  효과 중(제한적)
- **적용됨**: timetable · dashboard · lesson-reports.
- **보류**: attendance(반 선택 후만 무거움·필터 많음) / enrollment — 필터 플래시 트레이드오프.
- ⚠️ RouteWindow 클라 스켈레톤이 이미 있어 "빈 화면 제거"보다 서버 셸 TTFB 체감 목적.

### QW2 — QueryProvider를 top-frame 전용으로  효과 낮음
- **트리거**: "QueryProvider iframe에서 빼기"
- **현재**: 루트 [app-providers.tsx](../src/lib/providers/app-providers.tsx)의 QueryProvider가 **모든 iframe**에 마운트. 소비처는 command-palette·window-content(둘 다 최상위 프레임 전용).
- **방법**: QueryProvider를 (shell) full-shell 분기로만 이동(TooltipProvider·Toaster는 임베드에서도 쓰이니 루트 유지).
- ⚠️ **효과 사실상 0**(QueryClient 인스턴스화 비용 미미, react-query 청크는 HTTP 캐시 공유) + 교차파일 위험 → **권장 안 함**. 정리 차원이면 가능.

### BL2 — 임베드 iframe에서 표시용 users SELECT 생략  효과 소·위험 중
- **트리거**: "임베드 users SELECT 생략"
- **방법**: getCurrentUser를 2단계로 — 게이트용 경량(claims) + 표시용(displayName/jobTitle)은 비임베드 경로에서만. 임베드 분기(layout.tsx:36-47)는 사이드바를 안 그려 표시필드 미사용.
- ⚠️ **위험**: app_metadata(JWT) 기반 신뢰 시 role/tenant 드리프트(토큰 refresh 전까지 stale). 본문에서 displayName 쓰는 페이지 있으면 임베드 빈값 회귀 → 적용 전 `grep displayName/jobTitle` 필수. **무회귀 우선이라 현재 보류.**

### T1 — access token 만료 단축 (코드 아님, Dashboard)  보안 완화
- **트리거**: "토큰 만료 단축"
- **방법**: Supabase Dashboard › Authentication › Sessions(JWT expiry) 기본 3600초 → 15~30분. BL1 로컬검증의 "강제 로그아웃 지연" 창을 단축.
- ⚠️ 학원 앱 특성상 1시간도 보통 무방 → 필수 아님.

### 인프라 메모 — ⚠️ 2026-07-29 전면 정정(아래 옛 예측은 **틀렸다**)
옛 판본은 "남은 최대 레버 = Supabase Pro($25) 전용 컴퓨트"라고 적었다. 원장이 실제로 Supabase·Vercel을
유료로 올렸고 **체감이 0**이었다. 75에이전트 감사 + 실측으로 규명한 결과 **다섯 군데가 틀렸다**:

| 옛 서술 | 검증 결과 |
|---|---|
| "Pro = **전용 컴퓨트**" | **거짓.** Free도 이미 dedicated Postgres instance다. Pro가 바꾸는 건 크기이고 **dedicated CPU는 Large(~$110/mo)부터**. Micro·Small·Medium 전부 `2-core (shared)` |
| "**풀 상향**" | **거짓.** 실측 `max_connections=60` = Nano/Micro 동일값. 1도 안 늘었다 |
| "무중단(일시정지 제거)" | 사실이나 **무관.** 발동 기준이 *7일* 저활동인데 cron 4개 + 워커 폴링이 매일 넘긴다. 지연이 아니라 가용성 항목 |
| "공유 컴퓨트라 **쿼리 실행 느림**" | **거짓 전제.** 실행 **0.27ms**, 캐시 히트 **99.9994%**, 44일 CPU 듀티 **0.28%**. DB 165MB가 shared_buffers에 전량 상주 |
| "→ 새 창·새로고침 둘 다 개선" | **거짓.** 문서상 `Compute sizes are not auto-upgraded` — 결제만으론 안 올라간다. `pg_postmaster_start_time` uptime **44일** = 유료 전환 후에도 **리사이즈 0회** |
| (:76) "Fluid Compute 콜드스타트 감소"를 Pro 이득으로 | **거짓.** Fluid는 Hobby에도 있고 기본 ON이었다(Hobby 시절 청구서에 Fluid 과금 항목 존재). Pro 증분 0 |

**실제 지배항 = 뷰어 PC의 클라 JS 실행이다.** 통제 실험: CPU를 4배 스로틀하니 창 열기가
**405ms → 746ms**로 배증하는 동안 **서버 TTFB는 9.2~10.2ms로 불변**이었다. 창=독립 iframe document=
새 JS 렐름이라 창마다 모듈 실행 + 하이드레이션이 처음부터 다시 돈다(first-load JS 중앙값 1.20MB,
공유 baseline만 0.72MB). 네트워크는 이미 공짜다 — 청크 19개 전부 `transferSize=0`(HTTP 캐시 히트).

- **리전 co-location = 이미 최적**: `regions:["icn1"]` ↔ DB `ap-northeast-2`. 응답 헤더도 `icn1::icn1::` 확인.
  ⚠️ 이건 **Hobby 때부터** 적용돼 있었다(Hobby도 단일 리전 지정 가능) — Pro 이득이 아니다.
- **남은 유일한 유료 레버 = Vercel Function CPU → Performance(4GB/2vCPU)**: Hobby·Pro 기본값은 둘 다
  Standard(2GB/1vCPU)이고 Pro만 상향을 **선택**할 수 있다. `vercel.json`으로는 설정 불가 —
  Settings → Functions → Advanced → Function CPU + 재배포. ⚠️ 창 열기 TTFB가 10~23ms라 **체감폭은
  제한적일 것으로 추정(미측정)**.
- **Supabase 컴퓨트 승급은 성능 레버가 아니라 과금 위생**: Nano로 남아 있으면 Micro 요금을 내며 Nano를
  쓰는 중이다(승급 추가비용 0, 다운타임 <2분). 성능 기대는 ~0.
- ❌ **풀러 포트 5432→6543 금지**: 앱은 Postgres 커넥션을 **하나도 안 연다**(`@/lib/db` import 0건, 전부
  PostgREST/HTTPS). 5432를 쓰는 건 ClassNote 워커·마이그레이션이고 장수명 데몬엔 세션 모드가 맞다.
  ❌ `DATABASE_URL` 삭제 금지 — `instrumentation.ts`가 부팅 hard-fail로 존재를 검증한다.
- **localStorage 데이터 캐시 = 여전히 비권장**(공유 PC PII 잔존). "재오픈 즉시화"는 BL3가 더 빠르고 안전.

## 🚫 비권장 (효과 0 / 위험만)

- **WindowLink에 `router.prefetch(href)`** — iframe은 별도 document라 부모 router cache 미공유 → **코드만 늘고 효과 0.**
- **next.config `experimental.staleTimes`** — 데스크톱 새 창(iframe)엔 무효 + stale 노출 위험.
- **getTenantSettings / proxy.ts / 임베드 popup 스킵 재최적화** — 이미 적용(B6 unstable_cache·미들웨어 쿠키체크·임베드 early-return). 손대면 회귀만.
- **window-store persist/rehydrate, 드래그 중 iframe 숨김, 신규 포커스창 즉시 src** — 이미 최적([[#65]]·#10 회귀 위험).
- **recharts/exceljs/qrcode/dnd-kit 추가 next/dynamic** — 잔존 위반 0(전부 dynamic 또는 server-only). dnd-kit을 timetable에서 dynamic화하면 편집 진입만 늦어 역효과.

## 측정 메모
- getCurrentUser는 **server-only** → 인증 호출은 서버→Supabase라 **브라우저 Network 탭에 안 잡힘**. 체감 측정은 Network 탭 **`Doc` 타입**(iframe `?embed=1` 문서 로드)의 **TTFB(Waiting for server response)** 로. 멀티윈도우 복원에서 가장 큼.
- ⚠️ **TTFB만 보지 말 것(2026-07-29 정정).** 옛 판본이 "체감 측정 = Doc TTFB"라고 못박은 탓에 실제 지배항
  (창당 클라 실행 400~750ms)을 **한 번도 재지 않았고**, 그래서 병목이 서버로 보였고 남은 레버가 인프라
  티어로 보였다. **반드시 함께 잴 것**: DevTools Performance로 iframe 로드 구간의 **Scripting/총 시간**,
  그리고 **CPU 4x 스로틀 대조**(총 시간은 늘고 TTFB는 그대로면 병목은 클라다).
