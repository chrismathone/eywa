# Auth 세션 지속 정책 — "자동 로그인(절대 로그아웃 안 함)"

> ⚠️ 이 정책은 **레포 코드가 아니라 Supabase의 서버측 Auth 설정**에 있다(Dashboard 또는 Management API).
> 코드(미들웨어 세션 갱신·400일 지속 쿠키)는 이미 정상이라, 세션 수명은 이 설정이 최종 결정한다.
> - 프로젝트 ref: `ylqviwxedsdikuslmwxf`
> - 변경 수단: Supabase Dashboard → **Authentication → Sessions**, 또는 Management API(아래 명령).

---

## 현재 정책 (2026-07-09 적용) — 학원 **내부 단일 운영** 전제

원장 제보: "밤새 자리 비우고 오면 로그아웃된다"(프로덕션). 관리 API로 실측한 결과 **Time-box·비활성
타임아웃은 원래 꺼져 있었고**(원인 아님), 진짜 원인은 **refresh 토큰 회전 재사용 감지**였다.

**메커니즘**: eywa는 메뉴마다 same-origin iframe이라 창을 여러 개 열면 각 iframe의 브라우저
Supabase 클라이언트가 **같은 refresh 토큰으로 거의 동시에 갱신**을 시도한다(특히 노트북 절전 후 깨어날 때
타이머가 한꺼번에 발화). 회전이 켜져 있고 재사용 유예가 10초뿐이라, 유예를 넘긴 iframe이 "이미 쓴 토큰"을
제출 → Supabase가 **탈취 의심으로 세션 전체를 폐기** → 로그아웃. (쿠키는 400일로 멀쩡한데 토큰만 무효화됨.)

**결정: refresh 토큰 회전을 끈다** → 경합에 의한 세션 폐기 자체가 사라진다.

| 설정 | 값 | 비고 |
|---|---|---|
| `refresh_token_rotation_enabled` | **false** | ⬅️ **끔** (회전 경합 폐기 제거 = 이번 수정) |
| `security_refresh_token_reuse_interval` | 10 | 회전이 꺼져 무의미(잔존값) |
| `sessions_timebox` | 0 | 최대 세션 길이 무제한 |
| `sessions_inactivity_timeout` | 0 | 비활성 자동 로그아웃 없음 |
| `jwt_exp` | 3600 | access 토큰 1h — 미들웨어([proxy.ts](../src/lib/supabase/proxy.ts))가 자동 갱신 |

이 조합 + `@supabase/ssr`의 **400일 지속 쿠키**(라이브러리 기본, set 시 maxAge 강제) + 미들웨어 세션 갱신이
맞물려 **"자동 로그인 = 사실상 무기한 유지"**(수동 로그아웃 또는 400일 쿠키 만료 전까지)가 성립한다.

⚠️ **트레이드오프(내부 운영이라 수용)**: 회전을 끄면 탈취된 refresh 토큰이 회전 기반으로 자동
무효화되지 않는다(계속 유효). **원장 개인 기기의 내부 운영툴**이라 리스크가 낮아 이 트레이드오프를 택함.

---

## 🔁 학원 **외부(공개/멀티고객 SaaS)**로 갈 때 — 되돌리기

외부 고객에게 열면 위 트레이드오프(회전 없음 = 탈취 토큰 무기한)가 부적절해진다. **회전을 다시 켜고
세션 정책을 조인다.** 단, 회전을 켜면 위 멀티 iframe 경합이 재발하므로 **재사용 유예를 크게** 줘서 완화한다.

권장 외부 정책(예시):
- `refresh_token_rotation_enabled = true` (회전 복원 = 탈취 감지 부활)
- `security_refresh_token_reuse_interval = 60~120` (멀티창/절전 경합 흡수 — 10초는 너무 짧음)
- `sessions_inactivity_timeout` = 정책에 맞게(예: 2주=1209600) 검토
- (선택) `sessions_timebox`, `sessions_single_per_user` 검토

### 명령 (Management API)

Management API는 **Personal Access Token(PAT)** 이 필요하다. PAT는 이번 작업 후 폐기했으므로,
전환 시 **새로 발급**한다: https://supabase.com/dashboard/account/tokens → Generate → `.env.local`에
`SUPABASE_ACCESS_TOKEN=sbp_...` 임시 추가 → 작업 후 다시 **Revoke**(계정 전체 권한이라 상주 보관 비권장).

```bash
# 현재 값 읽기
TOKEN=$(grep '^SUPABASE_ACCESS_TOKEN=' .env.local | cut -d= -f2-)
REF=ylqviwxedsdikuslmwxf
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.supabase.com/v1/projects/$REF/config/auth" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);for(const k of["refresh_token_rotation_enabled","security_refresh_token_reuse_interval","sessions_timebox","sessions_inactivity_timeout","jwt_exp"])console.log(k,"=",j[k]);})'

# 외부 전환(되돌리기): 회전 켜고 유예 90초로 완화
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"refresh_token_rotation_enabled": true, "security_refresh_token_reuse_interval": 90}' \
  "https://api.supabase.com/v1/projects/$REF/config/auth"
```

또는 **Dashboard → Authentication → Sessions**에서 GUI로 동일 조정.

---

## 참고

- 이 변경은 **기존 세션을 폐기하지 않는다** — 앞으로의 갱신 동작만 바꾼다(적용 시 즉시 로그아웃 없음).
- 앱은 이 PAT를 런타임에 쓰지 않는다(앱 = anon 키 + `SUPABASE_SERVICE_ROLE_KEY`). PAT는 **설정 변경 전용**.
- (선택) 향후 UI에 **"자동 로그인" 토글**(공용 PC용 opt-out=세션 쿠키)을 얹을 수 있으나, 회전을 끈 지금은
  기본 동작이 이미 무기한 유지라 **필수 아님**. 얹는다면 브라우저 클라 `cookieOptions`로 세션 쿠키화 필요
  (`@supabase/ssr`가 set 시 maxAge를 400일로 강제하므로 라이브러리 우회 필요 — 구현 비용 대비 효용 낮음).
- 관련 코드 함정: [[#10]] 로그인 루프 · [[#72]] anon 키 개행 오염 · 미들웨어 세션 갱신([proxy.ts](../src/lib/supabase/proxy.ts)).
