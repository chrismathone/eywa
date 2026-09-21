# 도메인 이전 런북 — `eywa-alpha.vercel.app` → 새 도메인 (구매 뒤 그날 할 일)

원장 2026-09-18: *"아직 도메인 구매 준비중이므로 적용은 미룰 것. 대신 완벽하게 99.99%까지 구현해놓는 것. 구매만 하고 바로 쓰게."*
결정(같은 날, CLAUDE.md 결정 로그): **하나의 DB** · **URL에 지점 없음(C안)** — 그래서 도메인은 **하나**만 붙이면 되고
지점마다 서브도메인·와일드카드 DNS는 필요 없다. 코드는 전부 env로 켜지게 준비돼 있다(아래 "이미 준비된 것").

## ✅ 2026-09-21 실제로 한 것 — 도메인 `aywa.co.kr` / `www.aywa.co.kr`, 기준 주소 = **`https://www.aywa.co.kr`**
원장 *"우리 도메인은 aywa.co.kr / www.aywa.co.kr 로 결정되고 구매하고 적용되어있음"* · *"수업보고서로 발송되는 보고서 링크 주소도
새 도메인에 맞게. 이전건 괜찮고 앞으로 발송하는."* · *"기존 침산(cs)지점은 아무런 이상이 없어야함."*
- **원장이 이미 해 둔 것(1번)**: 두 도메인을 eywa 프로젝트에 붙임(네임서버는 등록업체 그대로, 레코드로 연결) + **Vercel 도메인 설정에서
  `eywa-alpha.vercel.app` → `https://www.aywa.co.kr` 307 전환**. 그래서 이미 나간 링크(`eywa-alpha…/r/…`)는 새 도메인으로 열린다(원장 확인).
  ⚠️ 이 전환은 Vercel 엣지 설정이라 **`/api/*`까지 넘긴다**(아래 2번의 "`/api` 제외" 코드 리다이렉트와 다르다) — 그래서
  외부가 옛 주소로 부르는 콜백은 새 주소로 옮겨야 한다(전사 웹훅은 `NEXT_PUBLIC_APP_URL`을 따라가므로 아래 env로 해결).
  🔴 `LEGACY_REDIRECT_HOSTS`는 **넣지 않았다** — 엣지가 먼저 전환하므로 코드 리다이렉트는 닿지 않는다(넣어도 무해하지만 쓸모없다).
- **기준 주소를 `www`로 잡은 이유** = 옛 별칭의 전환 대상이 `www`다. ⚠️ `aywa.co.kr`(www 없음)도 전환 없이 앱을 그대로 띄운다 —
  로그인 쿠키는 호스트 단위라 두 주소로 들어오면 **로그인이 따로** 논다. 원장이 Vercel Domains에서 `aywa.co.kr` → `www.aywa.co.kr`
  리다이렉트를 걸면 깔끔하다(원장 결정 · 코드 무관).
- **Vercel env(Production)**: `NEXT_PUBLIC_APP_URL=https://www.aywa.co.kr`(앱 안 공유 링크 표시·자산 QR·전사 콜백) +
  0번의 침산 고정 셋 `GOOGLE_CALENDAR_TENANT_ID`·`HR_ROSTER_TENANT_ID`·`PUBLIC_BRAND_TENANT_SLUG=cs`(학원 1개인 지금은 동작 불변).
- **ClassNote 보고서 링크**: 게시글 본문의 링크는 연동 PC `.env.local`의 `CLASSNOTE_SHARE_BASE`가 정한다 → 연동 PC에서
  **`scripts\_classnote\발송PC-새도메인.bat`** 더블클릭(= `set-share-domain.ps1`: 링크·스크린샷 주소 두 줄을 `www.aywa.co.kr`로 +
  `CLASSNOTE_TENANT_ID`·`MAKEEDU_TENANT_ID`를 없을 때만 침산으로 + 두 워커 재시작, 백업 남김·멱등). 코드 기본값도 같은 값
  (`share-bases.mjs` `CURRENT_SHARE_BASE` 단일 소스). 🔴 게시 전 중복 확인은 **같은 토큰의 옛·새 주소 글을 다 알아본다**
  (`shareUrlVariants`) — 재시작 순간 옛 주소로 올라간 건이 새 주소로 한 번 더 올라가지 않게. 회수도 두 주소를 다 대 본다.
- ⏳ 남은 것: 4번(Supabase Auth Site URL — 비밀번호 재설정 메일 링크) · 5번의 기기 다시 잇기(직원·태블릿·키오스크·폰 알림은
  원장이 전환을 건 순간부터 이미 새 주소로 넘어가 있다 = 한 번씩 다시 로그인/PIN/등록) · 6번 문서 값.

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
   - (지점이 둘 이상이면) `PUBLIC_BRAND_TENANT_SLUG=cs`(침산 — 옛 slug `injaewon`은 09-18에 개명됐다)
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
     박는 `/r` 공유 링크와 캡처 주소는 env**다 — 그 PC의 **`.env.local`**(워커·워처는 전부 `node --env-file=.env.local`로 뜬다 —
     `.env`는 아무도 안 읽는다)에서 `CLASSNOTE_SHARE_BASE=https://eywa.kr` ·
     `CLASSNOTE_SCREENSHOT_BASE=https://eywa.kr` 둘 다 바꾼다(`scripts/_classnote/classnote-core.mjs:29-30` ·
     `classnote-inbox-store.mjs:91`가 읽는다. 안 바꾸면 새 게시글이 계속 옛 호스트 링크를 실어 학부모 클릭·캡처마다 308로 한 번 튕긴다).
     바꾼 뒤 **`scripts/_classnote/setup-classnote-pc.ps1`을 다시 실행**한다(돌고 있는 데몬은 옛 env를 든 채라 — 스크립트가 옛 인스턴스를 내리고 새 env로 재시작).
     **회수는 옛 주소 글도 찾는다** — 회수 워커가 지금 주소 + 옛 주소(`CLASSNOTE_LEGACY_SHARE_BASES`, 기본값에 `eywa-alpha` 포함)를
     전부 대 보므로(`scripts/_classnote/share-bases.mjs`) 이전 전에 올린 글도 그대로 회수된다. 도메인을 **두 번째로** 옮길 때만 그 env에 직전 주소를 넣는다.
     코드 기본값 `DEFAULT_SHARE_BASE`(`classnote-core.mjs:30`, 지금 `eywa-alpha`)도 새 주소로 고쳐 zip으로 이관
     (`docs/classnote-integration.md` env 표의 예시 값도 함께).
6. **문서 값 정리**: `docs/setup-and-ops.md`의 배포 표(alias `eywa-alpha.vercel.app`) · `.env.local.example`의 `NEXT_PUBLIC_APP_URL` 예시.
7. **옛 별칭은 지우지 않는다** — 붙여 둔 QR 라벨·이미 보낸 공유 링크가 그 호스트로 온다. 308이 새 도메인으로 보내 준다.

## 지금 테넌트 = 침산(cs) — 원장 2026-09-18 *"전부 모두 침산(cs) 테넌트로. 현재 존재하는 모든것."*
- `tenants` 한 행: id `becaa316-e636-42e9-9d09-08b133e0b094` · slug **`cs`**(옛 `injaewon`, 09-18 개명) · name **인재원 침산** ·
  학원설정 `profile.name` 인재원 · `branchLabel` 침산. 지금 있는 모든 데이터(학생·반·직원·출결·수납·설정·스토리지)가 이 id다.
- **"첫 번째 테넌트"에 기대던 결합은 전부 fail-closed로 바꿨다** — 둘째 지점이 생겨도 침산 것이 남의 학원으로 새지 않게:
  ClassNote 워커(`CLASSNOTE_TENANT_ID`, 원래 fail-closed) · makeedu 워커(`MAKEEDU_TENANT_ID`, 09-18 fail-closed로) ·
  구글 캘린더 크론(`GOOGLE_CALENDAR_TENANT_ID`, 09-18 fail-closed로). 학원이 1개인 동안은 env 없이 그 하나로 돈다.
- 이미 id로 박혀 있는 것: Vercel `IJW_TENANT_ID`·`TODAYS_MATH_TENANT_ID`·`CONSULT_EXPORT_TENANT_ID`.

## 지점(테넌트)을 하나 더 만드는 날 (도메인과 별개)
0. **먼저 침산을 env로 못박는다**(안 하면 위 셋이 "학원 2개"를 보고 멈춘다 — 멈추는 게 맞지만 그날 발송·동기화가 선다):
   - 연동 PC(`C:\eywa-sync-pc`) **`.env.local`**(`.env`가 아니다 — 워커·워처 전부 `--env-file=.env.local`):
     `CLASSNOTE_TENANT_ID=becaa316-e636-42e9-9d09-08b133e0b094` · `MAKEEDU_TENANT_ID=becaa316-e636-42e9-9d09-08b133e0b094`
     → **`setup-classnote-pc.ps1`·`setup-sync-pc.ps1` 재실행**(돌고 있는 데몬·워처는 옛 env를 든 채 — 스크립트가 옛 인스턴스를 내리고 새 env로 재시작. ClassNote 워처는 테넌트를 연결당 한 번만 푼다)
     ⚠️ **이걸 빼먹은 채 둘째 지점을 만들면**: makeedu 워처가 제 지점을 못 정해 **아무 요청도 안 집는다** → 웹의 '지금 동기화'는 계속 '대기'로 보이고
     버튼이 잠긴 채 풀리지 않는다(화면엔 오류가 안 뜬다). 단서는 그 PC의 워처 로그 `⛔ 이 워처의 지점을 정하지 못해…`(10분에 한 번)뿐이다.
   - Vercel env: `GOOGLE_CALENDAR_TENANT_ID=becaa316-e636-42e9-9d09-08b133e0b094` · `HR_ROSTER_TENANT_ID=becaa316-e636-42e9-9d09-08b133e0b094`
     (직원명부 구글시트는 침산 것 — 안 넣으면 지점이 둘이 되는 순간 **어느 지점 이력서도 시트에 안 들어간다**) · `PUBLIC_BRAND_TENANT_SLUG=cs` → 재배포
   - **AI 사용량 빈칸 채우기를 한 번 더**: `node --env-file=<.env.local> scripts/_oneoff/backfill-ai-usage-tenant.mjs` (드라이런) → `--apply`.
     🔴 **반드시 둘째 지점을 만들기 전에** — 지점이 둘이 되면 빈칸 행이 어느 지점 호출이었는지 되짚을 단서가 없어 스크립트가 멈춘다
     (09-21에 2,794행을 채웠지만, 호출부 배선이 main에 들어가기 전까지 빈칸은 다시 쌓인다).
1. super-admin → 학원 추가(slug는 영문 소문자 2~40자, 지점 약어 — **한 번 정하면 안 바꾼다**, 지금도 수정 폼에 slug가 없다).
2. (0번에서 이미) `PUBLIC_BRAND_TENANT_SLUG=cs` = 로그인 화면·탭 제목의 회사 브랜드는 침산 것.
3. 자리 PIN 화면에 지점 선택이 뜨는지 확인 · 새 지점 자리 비밀번호는 **기본 0000**으로 바로 열린다(원장 2026-09-22) — 지점장에게 학원설정 → 운영 → "자리 출석부 비밀번호"에서 바꾸라고 안내.
3-1. **새 지점이 ClassNote·makeedu를 안 쓰는 경우**(원장 2026-09-21 *"다른 지점은 카톡으로 링크를 보낼 수도"*): 아무것도 안 해도 된다 —
   새 지점은 ClassNote 발송이 꺼진 채 태어나고(`classnoteSendEnabled=false`), 원스크린은 "저장 + 링크 복사"로 돈다(그 링크를 카톡으로 보낸다).
   워커 PC도 필요 없다(워커는 제 지점 큐만 집고, 앱은 연동 PC가 없는 지점의 makeedu 요청을 큐에 넣지 않는다).
   ⚠️ 알려진 한계: 카톡으로 보낸 보고서엔 "보냈다" 기록이 없어 사무실 미발송 목록에 남는다(기록 컬럼 신설 = 원장 결정 · CLAUDE.md 결정 로그).
   새 지점도 ClassNote를 **쓴다면**: 그 지점용 워커 PC(또는 폴더)를 따로 — `.env.local`에 `CLASSNOTE_TENANT_ID`·`CLASSNOTE_UPLOAD_ID/PW`·
   `CLASSNOTE_AUTHOR_NAME`(작성자명 폴백)·`CLASSNOTE_OUT`(로컬 마커·로그 폴더 — 한 PC에 두 워커면 반드시 갈라야 한다)을 그 지점 값으로.
4. 직원은 **지점마다 계정 하나**(codex 권고 — `users.tenant_id`는 1:1, 옮길 때 값을 바꾸지 말 것).
5. 알려진 한계(원장 결정 필요): 자산 QR `/inventory/asset/<code>`는 자산ID가 **전 지점에서 유일할 때만** 열린다 —
   지점별 자산ID 접두를 달리하거나(`B-MN-001`) 새 라벨에 지점을 싣는다. · 인재원 API·오늘의수학·상담 내보내기는
   env(`IJW_TENANT_ID` 등)로 한 지점에만 묶여 있다 · `google-calendar-import` 크론도 한 지점만 돈다.
