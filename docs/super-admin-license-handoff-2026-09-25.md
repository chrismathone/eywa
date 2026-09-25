# 슈퍼관리자 · 지점 라이선스 · 창 모드 — 인수인계 (2026-09-25)

오늘 한 세션에서 이어서 한 작업의 스냅샷이다. **코드는 전부 main에 반영·배포 완료**(origin/main `d8e8216c`, Vercel success).
남은 것은 **운영 DB 상태 두 가지**(아래 "열린 일")뿐이다.

## 반영된 커밋 (순서대로)

| 커밋 | 내용 |
|---|---|
| `8066e287` | 슈퍼관리자 화면 = 앱과 같은 디자인 체계 + 폰 레이아웃(상단 한 줄 바) + 영역 가드 테스트 |
| `b57fe450` | 슈퍼관리자 라이선스 스위치를 **실제로 배선**(회의 녹음·구글 시트·학생 좌석 수) + 계정 역할 드롭다운 잘림(포털로) |
| `31d284f9` | 지점(tenantId)을 모르는 AI 호출은 `generateJSON`이 거절 — 꺼진 지점에서 AI가 새던 빈틈 |
| `a342e6f0` · `5189c222` | (다른 세션) 창(iframe) 고도화 — 이 작업과 무관, 병합만 |
| `d8e8216c` | **창 모드(플로팅 창) 지점별 켜고 끄기** — 슈퍼관리자 학원 상세 스위치 |

결정 본문: [`decisions/tenant.md`](decisions/tenant.md)(지점 기능 라이선스) · [`decisions/shell.md`](decisions/shell.md)(창 모드) ·
[`decisions/design.md`](decisions/design.md)(슈퍼관리자 화면). 날짜별 요약은 [`changelog.md`](changelog.md) 2026-09-25 (1)~(4).

## 구조 요약 (코드를 다시 열 때의 지도)

- **판정 규칙** [`src/lib/license/rule.ts`](../src/lib/license/rule.ts): 행 없음 = 허용 · `is_active=false` 또는 만료 = 차단 ·
  조회 실패 = 허용(fail-open, [[#60]]와 같은 이유). 좌석 = `seatLimitOf`/`seatsExceeded`.
- **서버 게이트** `isFeatureLicensed(tenantId, feature)`(React `cache`, admin client) → 막히면 `licenseBlockReason`/`seatBlockReason` 문구.
- **스위치 목록 단일 소스** [`src/features/super-admin/labels.ts`](../src/features/super-admin/labels.ts) `TOGGLE_FEATURES`
  (`defaultOn`: ai_analysis·google_sheets·meeting_recording·window_mode = 켜짐, kakao_messaging = 꺼짐).
  🔴 **스위치를 하나 더하면 소비처도 함께** — [`license.test.ts`](../src/lib/license/license.test.ts)가 "키마다 소비처 ≥1"을 잠근다(write-only-orphan 방지).
- **AI**: `generateJSON({ meta: { tenantId, feature } })`에서 `tenantId`는 **타입상 필수 + 빈 값 런타임 거절**.
  지점을 진짜 모르는 웹훅은 `?? ""`로 넘겨 **거절되게** 둔 것(의도).
- **창 모드**: `(shell)/layout.tsx`가 `isFeatureLicensed(user.tenantId, "window_mode")`를 `WorkspaceEnabledProvider`로 내려준다.
  창을 **여는** 판정은 전부 [`useWindowMode()`](../src/components/workspace/use-window-mode.ts)(= 데스크톱 && 지점 켜짐).
  벨·사이드바 **모양**은 계속 `useIsDesktop`(창 모드를 꺼도 데스크톱 레이아웃은 그대로, 메뉴만 단일 창 이동).
  가드 [`window-mode.test.ts`](../src/components/workspace/window-mode.test.ts).
- 창 모드는 사실상 **관리자뷰에만** 의미가 있다 — 강사뷰(미니셸)는 원래 창이 없다.

## 침산(becaa316…) 영향

없음. 라이선스 행이 전부 켜짐이고, 행이 없는 기능은 규칙상 허용이라 **어제와 같은 동작**. 창 모드도 행이 없어 켜짐.

## 운영 검증 결과 (demo2 = `c22d8946-c4b9-4468-9049-c0f94fb5bc2b`)

- ✅ 운영 사이트에서 슈퍼관리자(st2000423)로 로그인 → demo2 상세의 **창 모드 스위치 클릭 → 꺼짐**.
  DB `tenant_licenses(window_mode).is_active=false` 저장 + 감사 로그 `toggle_license`(2026-09-25 10:12:52 UTC) 확인. **UI 경로는 실동작.**
- ⛔ demo2 **원장 화면에서 창이 안 열리는지**는 못 봤다 — demo2 유일 계정 `demo2-master@aywa.co.kr`이 `status='inactive'`
  (Supabase 인증상 banned)라 세션 생성이 `User is banned`로 거절.
  감사 로그: `set_user_active {active:false}` by st2000423 at **2026-09-24 20:54:16 UTC (= 09-25 05:54 KST)** —
  역할 드롭다운 잘림을 찍은 폰 캡처와 같은 시각이라 **오클릭 가능성**이 높다(원장 확인 전).

## 열린 일 (원장 결정 대기)

1. **demo2 원장 계정** — 다시 활성화할지(오클릭이었다면) 그대로 둘지. 🔴 일부러 끈 것일 수 있으니 **묻지 않고 켜지 말 것**.
2. **demo2 창 모드** — 지금 **꺼짐**(테스트로 끈 상태). 원래는 행이 없어 켜짐이었다. 확인이 끝나면 켜짐으로 되돌릴 것
   (슈퍼관리자 스위치로 — 켜면 `expires_at`도 비워진다).
3. 계정이 살아나면 남은 확인: 창 모드 **꺼짐**에서 메뉴 클릭 → iframe 0개·URL 이동 / **켜짐**에서 → 플로팅 창(iframe) 열림.
   스크립트는 세션 스크래치패드의 `demo2-check.mjs off|on`(슈퍼관리자 UI로 토글 → magiclink `verifyOtp`로 demo2 세션 → 메뉴 판 첫 항목 클릭 → iframe 수).
   ⚠️ 비밀번호를 바꾸지 않고 1회용 링크 토큰으로 세션을 만든다 — 스크립트에 계정 비밀번호를 커밋하지 말 것.
