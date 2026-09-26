# 연결 앱(오늘의 수학) · 슈퍼관리자 학원 상세 탭 — 인수인계 (2026-09-26)

오늘 한 세션에서 이어서 한 작업의 스냅샷이다. **eywa 코드는 전부 main에 반영·배포 완료**(origin/main `117cf024`, Vercel success).
오늘의 수학 쪽도 운영 반영 완료(`f77c5dd5d`). 남은 것은 **원장 작업(비밀키·재배포·스위치)** 과 켠 뒤의 확인뿐이다(아래 "열린 일").

## 반영된 커밋 (순서대로)

| 커밋 | 내용 |
|---|---|
| `5a02ca22` | 슈퍼관리자 학원 상세를 **내부 탭**으로 — 계정 · 기능·라이선스 · 기본 정보(`?tab=`) |
| `a06cd465` | 연결 앱: 오늘의 수학 바로가기 + 지점 스위치 `todays_math`(**기본 꺼짐**) · 명단·진도 API도 같은 스위치 |
| `dadd16a2` | 자동 로그인 보내는 쪽(60초 HMAC 표) — 첫 판은 이메일 기준 |
| `5d2505df` | **잠금** — eywa 이메일은 본인 확인값이 아니다 → `EYWA_SSO_SECRET` 넣지 말 것 |
| `478ce6bd` | 다음 판: 표에 eywa 사용자 id(`sub`) 필수 · 학생은 출발 차단 |
| `117cf024` | 오늘의 수학은 **영어 선생님에게 안 보인다** + 강사뷰 '내 메뉴'에도 입구 |

결정 본문: [`decisions/tenant.md`](decisions/tenant.md)(연결 앱 — 스위치·SSO·과목 축) · [`decisions/design.md`](decisions/design.md)(학원 상세 탭).
날짜별 요약: [`changelog.md`](changelog.md) 2026-09-26 (1)~(5).

## 구조 요약 (코드를 다시 열 때의 지도)

- **앱 목록** [`src/features/connected-apps/apps.ts`](../src/features/connected-apps/apps.ts) `CONNECTED_APPS` — 일반 모듈(서버·클라 공용).
  `hiddenForOnlySubjects: ["english"]` + 순수 규칙 `connectedAppVisibleTo`(과목 없음 = 보임 · 전부 목록 안 = 감춤).
- **판정 입구 하나** [`server/visible.ts`](../src/features/connected-apps/server/visible.ts) `getMyConnectedApps()`(요청 캐시):
  ① `isFeatureOptedIn(tenantId, "todays_math")`(**행이 있어야 켜짐 · 조회 실패 = 꺼짐**) → ② 켜졌을 때만 `users.subjects` 조회
  → ③ 과목 때문에 빠진 앱이 있으면 `isCurrentUserSuperAdmin()`이면 통과. 조회 실패 = 감춤.
- **소비처** — 🔴 전부 위 함수 하나를 본다(화면만 감추면 주소로 들어온다 [[#77]]):
  `(shell)/layout.tsx`(풀셸 `AppSidebar` '연결 앱' 구역 · `MobileTopNav` 격자 끝 · 강사 미니셸 `TeacherMenu` '연결 앱') ·
  출발 라우트 [`api/connected-apps/todays-math/launch`](../src/app/api/connected-apps/todays-math/launch/route.ts).
  '다른 강사 뷰'·학생 미니셸에는 세우지 않는다. 메뉴 판·검색 팰릿·메뉴 구성 편집기에도 **넣지 않는다**(aywa 안 화면 축).
- **출발 라우트 순서**: 비로그인 → `/login` · 이 사람에게 안 서면 → `/home` · secret 없음/짧음 또는 학생 → 표 없이 `todays-math.vercel.app`
  · 그 외 → `/api/sso/eywa?token=`(`no-store` · `no-referrer`).
- **표** [`sso.ts`](../src/features/connected-apps/sso.ts): `v1.<base64url(JSON)>.<base64url(HMAC-SHA256(secret, "v1."+payload))>` · 60초 ·
  payload `{iss:"aywa", aud:"todays-math", sub(= users.id, 신원), email(표시용·소문자), name, tenantId, iat, exp, jti}` · secret 32자 미만이면 안 씀.
- **명단·진도 API** `api/integrations/todays-math/{roster,progress}` — 같은 스위치(끈 지점 = 503 `disabled for tenant`).
  ⚠️ 아직 env **`TODAYS_MATH_TENANT_ID` 한 지점**만 준다.
- **학원 상세 탭** `super-admin/tenants/[id]/_tabs.tsx` — 라이선스 조회는 `tab=license`일 때만.
- **가드**: [`apps.test.ts`](../src/features/connected-apps/apps.test.ts)(과목 규칙 + 입구 배선 + 총괄 통과) ·
  [`sso.test.ts`](../src/features/connected-apps/sso.test.ts) · [`license.test.ts`](../src/lib/license/license.test.ts)(`todays_math` 소비처 = `visible.ts` + API 둘) ·
  [`window-mode.test.ts`](../src/components/workspace/window-mode.test.ts)(셸 `Promise.all` 모양).

## 오늘의 수학 쪽 (다른 저장소 `C:/creative/testautocreator`)

🔴 **여기서 직접 고치지 말 것**(원장 지시) — Orca에 켜진 그 저장소의 main 세션에 신호를 보낸다.
- 이력: `b8af2e605`(받는 쪽 1판) → `e686c6a4e`(이메일 표 **항상 거절**로 잠금) → **`f77c5dd5d`(2판 운영, Vercel success 22:17)**.
- 2판 흐름: `sub`가 연결된 계정 → 바로 로그인 / 없으면 연결 대기 쿠키(10분, 서명) + 현재 세션 끊고 `/login` → 비밀번호 로그인 →
  `/account/eywa-link` 확인 화면에서 **[연결]을 눌러야만** 연결(양방향 유일, DB `user.eywa_user_id uuid UNIQUE` · `eywa_linked_at`) · 이메일 조회 없음 ·
  해제 `DELETE /api/account/eywa-link`(본인) · `DELETE /api/admin/users/[id]/eywa-link`(최고관리자). eywa 권고 3가지 모두 반영.
- 실측(2026-09-26): secret 없이 `/api/sso/eywa`(가짜 표·표 없음) → 둘 다 **303 `/login`**(안전하게 거절).
- **신호 보내는 법**: `orca worktree ps --json` → `orca terminal list --worktree "<그 저장소 워크트리 id>" --json`으로 핸들 →
  `orca terminal send --terminal <handle> --text "..." --enter --wait-submit 10 --json`.
  ⚠️ 핸들은 런타임마다 바뀐다 · 긴 글은 `accepted:false` → **파일로 쓰고 경로만** 보낸다 · 그 세션에 선택 대화상자가 떠 있으면 입력이 안 먹는다(답한 뒤 재전송).

## 운영 상태 (2026-09-26 실측)

- `EYWA_SSO_SECRET`: **두 Vercel 모두 없음** → 링크는 표 없이 오늘의 수학 첫 화면으로 간다(평소 로그인).
- 침산 `todays_math`: **꺼짐** — 원장이 직접 끔(16:54 KST, 감사 로그 `toggle_license`). 🔴 원장 없이 켜지 말 것.
- demo2 `window_mode`: **꺼짐** — 원장이 직접 끔(16:54 KST). demo2 원장 계정은 `active`(원장이 비밀번호 재설정 16:54 KST).
- Vercel 커넥터: 'Chris'(`injaewon`) 팀으로만 연결되어 있고 프로젝트 0개. eywa(`bigshols-projects`)·todays-math(`bigshoul-project`)는 **403** · 이 PC의 Vercel CLI 미로그인
  → 환경변수는 원장이 대시보드에서 넣는다(비밀키가 대화 기록에 안 남는 쪽이기도 하다).

## 켜는 순서 (원장)

1. 비밀키 생성: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`(43자).
2. `bigshols-projects` → eywa, `bigshoul-project` → todays-math — 둘 다 Production `EYWA_SSO_SECRET`에 **같은 값**.
3. 🔴 **두 프로젝트 모두 Redeploy** — Vercel은 환경변수를 배포 때 읽는다(한쪽만 하면 표가 늘 거절 → 로그인 화면).
4. 슈퍼관리자 → 침산 → 기능·라이선스 → '오늘의 수학 연결' 켜기.

## 열린 일

1. **원장 작업** — 위 켜는 순서 1~4.
2. **켠 뒤 운영 확인**: 원장 계정 → '연결 앱 → 오늘의 수학' → 오늘의 수학 `/login`(연결 대기) → 비밀번호 → `/account/eywa-link` [연결]
   → 다시 눌러 **바로 로그인**되는지. 영어 선생님 계정은 링크 없음 + 출발 주소를 쳐도 `/home`인지(⚠️ 영어 선생님 계정 로그인 정보가 없어
   이 부분은 테스트로만 확인됨). 스크립트 틀 = 세션 스크래치패드 `tm-launch2.mjs`(비밀번호를 커밋하지 말 것).
3. **원장 확인 대기(`117cf024`)**: ① 과학만 맡은 직원(마수호)에게는 보인다 — "영어만 제외"로 해석함 ② 강사뷰 '내 메뉴' 입구는 요청 밖에서 더한 것
   (전에는 수학 강사에게 입구가 아예 없었다) — 되돌릴지.
4. 명단·진도 API의 지점별 키 — 두 번째 지점이 실제로 쓸 때(`TODAYS_MATH_TENANT_ID` 단일 env 탈피).

## 09-25 인수인계의 열린 일 → 해소

[`super-admin-license-handoff-2026-09-25.md`](super-admin-license-handoff-2026-09-25.md)의 1~3: 원장이 demo2 원장 계정을 다시 켰고,
창 모드 확인을 마쳤다 — **꺼짐 = iframe 0개 · 켜짐 = iframe 1개(플로팅 창)**. 켜짐으로 되돌렸다가, 이후 원장이 직접 다시 껐다(위 운영 상태).
