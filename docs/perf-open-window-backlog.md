# 새 창(iframe) 반응속도 — 적용 현황 + 보류 백로그

> 메뉴=플로팅 창=same-origin iframe이라 새 창을 열면 **풀 라우트(셸 레이아웃 + 페이지 쿼리)가 매번 새로 렌더**된다.
> "새 창 열기(클릭→콘텐츠)" 및 멀티윈도우 복원 반응속도를 줄이는 레버를 계층별로 측정한 결과(2026-07-01, 멀티에이전트 분석).
> **이 문서는 "나중에 요청 시 바로 실행"하기 위한 실행 카드** — 각 항목에 트리거·파일·방법·효과·위험을 적어둠.
>
> ▶ **사용법(트리거)**: 사용자가 코드명(BL3 등) 없이 **"속도 개선 / 새 창 더 빠르게 / 반응속도 더 줄여줘"** 같은 말을 하면 —
> 아래 "보류 백로그"에서 **효과 큰 순으로 다음 레버**(현재 우선순위: **BL3** iframe LRU — BL4·dashboard loading·QW4는 적용됨)를 골라 제안하고, 동의 시 실행한다.
> "비권장" 항목은 제안하지 않는다.

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

## ⏸️ 보류 — 요청 시 바로 실행 (효과 큰 순)

### BL3 — 닫은 창 hidden 보존 / iframe LRU 풀  ⭐효과 큼·노력 큼
- **트리거**: "닫았다 다시 여는 창 빠르게" / "iframe 풀"
- **현재**: `close()`가 iframe째 파괴 → 같은 메뉴 재오픈 시 셸 layout 재실행 + 풀 하이드레이션을 콜드로 다시.
- **방법**: 닫기를 `display:none` 보존(또는 detached iframe LRU 2~3개)으로. 재오픈=즉시 표시 + `reloadWindow` nonce로 콘텐츠만 갱신(기존 인프라 재사용). [window-store.ts](../src/components/workspace/window-store.ts) close 경로 + [floating-window/route-window].
- **효과**: 재오픈 즉시화(흔한 패턴). **위험(중)**: hidden iframe N개 = 메모리/백그라운드 타이머 누적 → **LRU 상한·메모리 가드 필수**. stale 콘텐츠(다른 창 저장 후 재오픈) → reloadWindow/router.refresh 연계(#55). 멀티윈도우 N배 비용(B6)과 트레이드오프.
- **권장**: 측정 선행(재오픈 빈도) 또는 보수적으로 핵심 1~2개(대시보드·시간표)만 hidden 프리마운트.
- ⚠️ BL4와 보완(첫 오픈=BL4, 재오픈=BL3).

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

## 🚫 비권장 (효과 0 / 위험만)

- **WindowLink에 `router.prefetch(href)`** — iframe은 별도 document라 부모 router cache 미공유 → **코드만 늘고 효과 0.**
- **next.config `experimental.staleTimes`** — 데스크톱 새 창(iframe)엔 무효 + stale 노출 위험.
- **getTenantSettings / proxy.ts / 임베드 popup 스킵 재최적화** — 이미 적용(B6 unstable_cache·미들웨어 쿠키체크·임베드 early-return). 손대면 회귀만.
- **window-store persist/rehydrate, 드래그 중 iframe 숨김, 신규 포커스창 즉시 src** — 이미 최적([[#65]]·#10 회귀 위험).
- **recharts/exceljs/qrcode/dnd-kit 추가 next/dynamic** — 잔존 위반 0(전부 dynamic 또는 server-only). dnd-kit을 timetable에서 dynamic화하면 편집 진입만 늦어 역효과.

## 측정 메모
- getCurrentUser는 **server-only** → 인증 호출은 서버→Supabase라 **브라우저 Network 탭에 안 잡힘**. 체감 측정은 Network 탭 **`Doc` 타입**(iframe `?embed=1` 문서 로드)의 **TTFB(Waiting for server response)** 로. 멀티윈도우 복원에서 가장 큼.
