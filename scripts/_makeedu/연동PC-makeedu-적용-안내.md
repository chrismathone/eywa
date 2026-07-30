# 연동 PC — makeedu 스크립트 갱신 안내 (2026-07-30)

> ClassNote 워커 zip 이관과 **같은 방식**입니다. 연동 PC(`C:\eywa-sync-pc`)는 git이 아니라 **파일 사본**이라,
> 아래 파일들을 덮어써야 새 기능이 돕니다.

## 무엇이 바뀌나

| 파일 | 변화 |
|---|---|
| `scripts/_makeedu/scrape.cjs` | **퇴원생 목록 추가** — `--list=withdrawn` (`/member/student/stopList.do`, 실측 4,427행) |
| `scripts/_makeedu/compare-withdrawal-dates.mjs` | **신규** — makeedu 퇴원일 ↔ eywa `withdrawn_at` 이중 대조(기본 dry-run) |
| `scripts/_makeedu/check-session.mjs` | **신규** — makeedu 접속 헬스체크 → 실패 시 **eywa 벨 알림**(하루 1회 권장) |

## 🔴 이번에 확인된 사실 (설계가 바뀐 근거)

**연동 PC(신뢰 IP)에서는 ID/PW 자동 로그인이 CAPTCHA 없이 통과한다** — 실측 `login ok → main.do`.
CAPTCHA는 **낯선 IP·헤드리스**에서만 걸린다. 그래서:

- **세션 캡처(`capture-session.cjs`)는 이 PC에선 필요 없다** — 매 실행마다 로그인하면 된다.
- 따라서 감시할 것은 "세션 만료"가 아니라 **"로그인 자체가 실패하는 날"**(비밀번호 변경·CAPTCHA 도입·계정 잠금)이다.
  그날 동기화가 **조용히** 멈추므로 `check-session.mjs`가 원장 벨에 알린다.
- ⚠️ 로그인 실패 시 **재시도하지 않는다**(반복 실패 = 계정 잠금).

## 적용 절차

1. 이 3개 파일을 `C:\eywa-sync-pc\scripts\_makeedu\` 에 덮어쓴다(폴더 전체 복사 권장 — 부분 복사는 버전이 섞인다).
2. 동작 확인:
   ```
   cd /d C:\eywa-sync-pc
   node --env-file=C:\eywa-sync-pc\.env.local scripts\_makeedu\scrape.cjs --list=withdrawn
   node --env-file=C:\eywa-sync-pc\.env.local scripts\_makeedu\check-session.mjs --dry-run
   ```
   · 첫 명령 → `.makeedu-tmp\withdrawn.json` 저장(행 수·headers 출력)
   · 둘째 명령 → `✅ 정상` 이면 접속 OK(알림 안 보냄)
3. 퇴원일 대조(**먼저 dry-run**):
   ```
   node --env-file=C:\eywa-sync-pc\.env.local scripts\_makeedu\compare-withdrawal-dates.mjs
   ```
   · ① 채우기 대상 · ② 기존 날짜와 불일치 · ③ 미매칭 이 각각 몇 건인지 보고만 한다.
   · 결과를 확인한 뒤에만 `--apply` (실행 시 **undo JSON**을 같은 폴더에 남긴다).

## 스케줄 등록(권장)

접속 헬스체크는 하루 1회면 충분하다. 작업 스케줄러에 등록:

```
schtasks /create /tn "eywa-makeedu-health" /tr "cmd /c cd /d C:\eywa-sync-pc && node --env-file=C:\eywa-sync-pc\.env.local scripts\_makeedu\check-session.mjs" /sc daily /st 08:30
```

⚠️ **콜드스타트 규칙**: 처음 실행에서 실패를 만나면 **알리지 않고 시드만** 한다(과거 상태로 벨이 폭탄이 되는 것을 막는 기존 규칙). 그다음 실패부터 알림이 온다.

## 주의

- `compare-withdrawal-dates.mjs`는 **날짜만** 고친다. `status`·퇴원 사유는 건드리지 않는다.
- 매칭 우선순위 = **원생번호 → 전화 → 이름**(양쪽 모두 유일할 때만). 형제가 같은 번호를 쓰면 그 번호는 **버린다**(뒤바꾸면 최악).
- `withdrawn.json`에는 **보호자·원생 전화번호와 퇴원 사유**가 들어 있다(실 PII). `.makeedu-tmp`는 gitignore 대상이며, 외부로 보내지 말 것. **AI 프롬프트에 넣지 말 것.**
