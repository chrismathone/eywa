# 도메인 이전 런북 — `eywa-alpha.vercel.app` → 새 도메인 (구매 뒤 그날 할 일)

원장 2026-09-18: *"아직 도메인 구매 준비중이므로 적용은 미룰 것. 대신 완벽하게 99.99%까지 구현해놓는 것. 구매만 하고 바로 쓰게."*
결정(같은 날, CLAUDE.md 결정 로그): **하나의 DB** · **URL에 지점 없음(C안)** — 그래서 도메인은 **하나**만 붙이면 되고
지점마다 서브도메인·와일드카드 DNS는 필요 없다. 코드는 전부 env로 켜지게 준비돼 있다(아래 "이미 준비된 것").

## 이미 준비된 것 (코드, 구매 전에 끝남)
- **옛 호스트 → 새 도메인 308**(경로·쿼리 보존, `/api/*` 제외) — [`src/lib/config/legacy-redirects.ts`](../src/lib/config/legacy-redirects.ts) → `next.config.ts redirects()`.
  env `LEGACY_REDIRECT_HOSTS`가 비면 0개라 지금은 아무 일도 없다.
- **기준 주소 단일 진입점** = `NEXT_PUBLIC_APP_URL`(전사 웹훅 콜백 `app-url.ts` · 자산 QR `inventory/qr.ts` · 공유 링크 표시
  `report-card.tsx`). 옛 `eywa-alpha` 조용한 폴백은 이미 제거돼 있다 — 값 하나만 바꾸면 전부 따라온다.
- **비로그인 화면의 브랜드**는 `getPublicBranding`(학원 1개면 자동, 2개+면 `PUBLIC_BRAND_TENANT_SLUG`) — 호스트를 안 본다.
- **자리 PIN**은 학원이 둘 이상이면 화면에서 지점을 고른다(호스트 무관).

## 구매한 날 — 순서대로 (예: 새 도메인 `eywa.kr`)
1. **Vercel → Project → Settings → Domains**에 `eywa.kr` 추가(+ 원하면 `www.eywa.kr`을 `eywa.kr`로 리다이렉트 설정).
   DNS는 Vercel이 알려 주는 A/CNAME을 도메인 등록업체에 넣는다. TLS는 자동.
   ⚠️ 와일드카드(`*.eywa.kr`)는 **넣지 않는다**(C안 — 지점은 URL에 없다).
2. **Vercel env(Production)** 바꾸기 — 🔴 값을 바꿔도 **돌고 있는 배포본은 안 바뀐다**(배포 시점 스냅샷). 바꾼 뒤 3번 재배포.
   - `NEXT_PUBLIC_APP_URL=https://eywa.kr`
   - `LEGACY_REDIRECT_HOSTS=eywa-alpha.vercel.app`
   - (지점이 둘 이상이면) `PUBLIC_BRAND_TENANT_SLUG=injaewon`
3. **재배포**(main에 빈 커밋을 올리거나 Vercel "Redeploy") → 배포 success 뒤 확인:
   - `https://eywa.kr/login` 로고·학원명 · `https://eywa-alpha.vercel.app/inventory/asset/MN-001` → `https://eywa.kr/inventory/asset/MN-001` 308
   - `https://eywa-alpha.vercel.app/api/webhooks/assemblyai`는 **308이 아니어야** 한다(옛 호스트에서 그대로 처리).
4. **Supabase → Authentication → URL Configuration**: Site URL = `https://eywa.kr`, Redirect URLs에 `https://eywa.kr/**` 추가
   (지금 로그인은 비밀번호뿐이라 OAuth 콜백은 없지만, 비밀번호 재설정 메일 링크가 Site URL을 쓴다).
5. **기기·사람 다시 잇기**(전부 호스트 단위라 저절로 안 넘어간다):
   - 직원: 새 주소로 다시 로그인(쿠키는 호스트 단위) · 북마크 교체.
   - **자리 PIN 태블릿**(랩실·JJ실): 새 주소 `/seat/lab`·`/seat/jj`를 열고 PIN 재입력(쿠키 재발급).
   - **키오스크**: 기기 토큰 쿠키가 호스트 단위 → 새 주소에서 **기기 다시 등록**(`kiosk_device_register` 감사로그로 확인).
   - **휴대폰 웹푸시**(셔틀 체크 계정): 구독이 오리진 단위 → 새 주소에서 '켜기' 다시(iOS는 홈 화면 앱을 **새 주소로 다시 추가**).
   - **연동 PC 워커**(`C:\eywa-sync-pc` — makeedu·ClassNote): DB 직결이라 host 무관하지만 **ClassNote 워커가 학부모 게시글에
     박는 `/r` 공유 링크와 캡처 주소는 env**다 — 그 PC의 `.env`에서 `CLASSNOTE_SHARE_BASE=https://eywa.kr` ·
     `CLASSNOTE_SCREENSHOT_BASE=https://eywa.kr` 둘 다 바꾼다(`scripts/_classnote/classnote-core.mjs:29-30` ·
     `classnote-inbox-store.mjs:91`가 읽는다. 안 바꾸면 새 게시글이 계속 옛 호스트 링크를 실어 학부모 클릭·캡처마다 308로 한 번 튕긴다).
     코드 기본값 `DEFAULT_SHARE_BASE`(`classnote-core.mjs:30`, 지금 `eywa-alpha`)도 새 주소로 고쳐 zip으로 이관
     (`docs/classnote-integration.md` env 표의 예시 값도 함께).
6. **문서 값 정리**: `docs/setup-and-ops.md`의 배포 표(alias `eywa-alpha.vercel.app`) · `.env.local.example`의 `NEXT_PUBLIC_APP_URL` 예시.
7. **옛 별칭은 지우지 않는다** — 붙여 둔 QR 라벨·이미 보낸 공유 링크가 그 호스트로 온다. 308이 새 도메인으로 보내 준다.

## 지점(테넌트)을 하나 더 만드는 날 (도메인과 별개)
1. super-admin → 학원 추가(slug는 영문 소문자 — **한 번 정하면 안 바꾼다**, 지금도 수정 폼에 slug가 없다).
2. Vercel env `PUBLIC_BRAND_TENANT_SLUG=injaewon`(로그인 화면·탭 제목의 회사 브랜드 = 대표 지점) + 재배포.
3. 자리 PIN 화면에 지점 선택이 뜨는지 · 새 지점 학원설정에서 `seatPins`를 정했는지 확인.
4. 직원은 **지점마다 계정 하나**(codex 권고 — `users.tenant_id`는 1:1, 옮길 때 값을 바꾸지 말 것).
5. 알려진 한계(원장 결정 필요): 자산 QR `/inventory/asset/<code>`는 자산ID가 **전 지점에서 유일할 때만** 열린다 —
   지점별 자산ID 접두를 달리하거나(`B-MN-001`) 새 라벨에 지점을 싣는다. · 인재원 API·오늘의수학·상담 내보내기는
   env(`IJW_TENANT_ID` 등)로 한 지점에만 묶여 있다 · `google-calendar-import` 크론도 한 지점만 돈다.
