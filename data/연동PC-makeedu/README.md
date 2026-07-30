# 연동 PC makeedu 스크립트 zip — **여기가 유일한 보관 위치**

makeedu 동기화 스크립트를 연동 PC로 넘기는 zip은 **항상 이 폴더**에 만든다.
`data\발송PC-워커\`(ClassNote 워커)와 **같은 규칙**이다 — 만들 때마다 위치가 달라지면 지금 PC에 무엇이
들어가 있는지 대조할 수 없고, 롤백에 쓸 옛 zip이 어디 있는지도 남지 않는다(원장 지적 2026-07-29).
⚠️ 2026-07-30에 이 zip을 `D:\tmp`에 만들었다가 같은 지적을 다시 받았다 — **`D:\tmp`·바탕화면 금지.**

## 만드는 법

```powershell
powershell -ExecutionPolicy Bypass -File scripts\_makeedu\build-makeedu-zip.ps1
```

- 출력: `data\연동PC-makeedu\연동PC-makeedu-YYYY-MM-DD.zip` (같은 날 재빌드하면 `_HHmm`이 붙어 **덮어쓰지 않는다**)
- 담는 범위: `scripts\_makeedu` **폴더 전체**(`*.json` 제외). 스크립트가 `lib.cjs` 등을 공유하므로 **부분 전달 금지**.
- 🔴 스크랩 산출물(`.makeedu-tmp\*.json`)은 **실 PII**(보호자·원생 전화, 퇴원 사유)라 **zip에 담지 않는다**. 소스만.
- 압축 안 경로가 `scripts\_makeedu\…`라, 연동 PC의 **저장소 폴더에서 "여기에 압축 풀기"** 하면 제자리에 덮인다.

## 연동 PC 적용

1. zip을 저장소 폴더(`C:\eywa-sync-pc`)에서 "여기에 압축 풀기"(덮어쓰기)
2. 확인:
   ```
   cd /d C:\eywa-sync-pc
   node --env-file=C:\eywa-sync-pc\.env.local scripts\_makeedu\check-session.mjs --dry-run
   ```
   `✅ 정상` 이면 makeedu 접속 OK.

절차 상세는 [`scripts/_makeedu/연동PC-makeedu-적용-안내.md`](../../scripts/_makeedu/연동PC-makeedu-적용-안내.md).

## 알아둘 것

- **연동 PC(신뢰 IP)에서는 ID/PW 자동 로그인이 CAPTCHA 없이 통과한다**(2026-07-30 실측 `login ok → main.do`).
  그래서 `capture-session.cjs`(사람이 브라우저 로그인)는 그 PC에선 **불필요**하고, "세션 만료" 문제도 없다.
  감시할 것은 **로그인이 실패하게 되는 날**(비번 변경·CAPTCHA 도입·계정 잠금) → `check-session.mjs`가 벨로 알린다.
- ⚠️ `.env.local`은 **연동 PC의 `C:\eywa-sync-pc\.env.local`** 에 있다(개발 PC엔 `MAKEEDU_ID/PW`가 없다).

## 롤백

**이전 날짜 zip을 다시 푸는 것이 롤백**이다. 그래서 이 폴더의 옛 zip을 **지우지 않는다**.

## git

zip은 빌드 산출물이라 **커밋하지 않는다**(`.gitignore`). 이 README만 추적한다.
