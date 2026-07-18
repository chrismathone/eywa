# ClassNote 발송 PC → 연동 PC(`학원동기화-PC`) 이관 안내

수업보고서(ClassNote) **발송 워처**를, 이미 상시 켜져 makeedu **동기화**를 돌리는 **연동 PC(`학원동기화-PC`)**
로 옮기는 절차입니다. 두 데몬을 한 상시 PC에 합쳐, 발송이 개발용 PC(꺼지면 오프라인)에 의존하지 않게 합니다.

> **왜 옮기나:** 발송 워처는 옛 PC `DESKTOP-JCN8NU9`(개발용)에만 등록돼 있었고, 그 PC가 꺼지면서
> 발송 큐가 멈췄습니다. 연동 워처는 이미 `학원동기화-PC`에서 정상 동작 중이라, 발송도 그리로 통합합니다.
> 두 워처는 각자 `os.hostname()`을 등록하는 **독립 데몬**이라 서로 다른 PC로 보였던 것뿐입니다.

---

## 0. 사전 요건 (연동 PC엔 대부분 이미 있음)

`학원동기화-PC`는 makeedu 동기화를 돌리므로 아래가 이미 갖춰져 있습니다:
- eywa 저장소 폴더(스크립트 위치) + `node_modules`(**playwright 포함** — ClassNote도 같은 playwright 사용)
- 저장소 루트 `.env.local`에 `DATABASE_URL`

즉 **추가로 할 일은 (1) 이 패키지 풀기 (2) `.env.local`에 ClassNote 항목 추가 (3) 지정 배치 더블클릭** 뿐입니다.

---

## 1. 이 패키지 풀기

이 zip을 연동 PC로 옮겨, **eywa 저장소 폴더**에서 **"여기에 압축 풀기"** 하세요.
그러면 `<저장소>\scripts\_classnote\` 안에 스크립트와 배치 파일이 채워집니다(기존 파일 덮어쓰기 = 최신화).

압축 후 `<저장소>\scripts\_classnote\` 에 다음이 보이면 정상:
- `발송PC-지정.bat` · `발송PC-상태확인.bat` · `발송PC-해제.bat`  ← 더블클릭용
- `setup-classnote-pc.ps1` · `run-classnote-worker.ps1` · `watch-classnote-queue.mjs` · `classnote-core.mjs` · `process-classnote-queue.mjs` · `send-window.mjs`

> ⚠️ 위는 확인용 표본일 뿐입니다 — zip은 반드시 **폴더 전체**를 풀어야 합니다(파일을 골라 복사하면
> 코어가 import하는 모듈(`board-safety.mjs`·`send-window.mjs` 등)이 빠져 워커가 기동 자체를 못 합니다).

---

## 2. `.env.local`에 ClassNote 항목 추가

연동 PC의 **저장소 루트 `.env.local`** 을 메모장으로 열어 아래를 추가합니다.
(`DATABASE_URL`은 이미 있으니 그대로 두세요.)

```
# ── ClassNote 발송 (실게시용) ──
CLASSNOTE_UPLOAD_ID=<ClassNote 로그인 아이디>
CLASSNOTE_UPLOAD_PW=<ClassNote 로그인 비밀번호>

# 오발송 방지(권장) — 인재원 테넌트. 현재 테넌트가 1개라 없어도 자동 해석되지만 명시 권장.
CLASSNOTE_TENANT_ID=becaa316-e636-42e9-9d09-08b133e0b094

# 보고서 스크린샷/공유 링크는 공개 /r 페이지를 캡처 — 연동 PC엔 로컬 앱이 없으므로
# 배포된 공개 주소로 지정(예시. 실제 운영 도메인으로).
CLASSNOTE_SCREENSHOT_BASE=https://eywa-alpha.vercel.app
CLASSNOTE_SHARE_BASE=https://eywa-alpha.vercel.app

# (선택) 스크린샷 시 /r 조회수 로깅을 건너뛰는 내부 헤더. 없으면 조회수만 1 늘 뿐 발송엔 무관.
# CLASSNOTE_INTERNAL_SECRET=<앱과 동일한 내부 시크릿>
```

> ⚠️ 주소 두 줄은 **복사-붙여넣기**로 넣으세요. 2026-07-10 실발송 테스트에서 수기 입력 오타
> (`eywa-alpha-vercel.app` — 점 대신 하이픈)로 스크린샷 단계가 `ERR_NAME_NOT_RESOLVED`로
> 전멸(3회 재시도 후 failed)한 실사례가 있습니다. 이미 오타가 났다면 **`발송PC-주소수정.bat`**
> 더블클릭 한 번으로 백업→치환→데몬 재시작→자가검사까지 자동 수행됩니다.

> ⚠️ `CLASSNOTE_UPLOAD_ID/PW`(ClassNote 계정)는 현재 저장소 `.env.local`에 **없습니다** — 실게시하려면
> ClassNote 발송용 계정 정보를 여기서 채워야 합니다. 없으면 dry-run(게시 안 함)까지만 동작합니다.

---

## 3. 설치 (연동 PC에서, 더블클릭)

1. **`발송PC-상태확인.bat`** 더블클릭 → 지금은 `(미등록)`으로 나와야 정상.
2. **`발송PC-지정.bat`** 더블클릭 → 작업 스케줄러 등록 + 데몬 시작 + **dry-run 자가검사**가 자동 실행됩니다.
   - "dry-run 파이프라인 검사" 가 통과하면 완료. (DB 연결·테넌트 해석·Playwright 스크린샷·payload 조립 확인)
   - 실패하면 마지막 안내대로 `.env.local`(특히 `CLASSNOTE_SCREENSHOT_BASE`)·playwright를 점검 후 다시 지정.
3. 지정되면 이 PC가 켜져 있는 한 **queued 보고서를 자동 게시**합니다(로그온 상주 + 10분마다 자동 부활).

## 4. 옛 발송 PC(`DESKTOP-JCN8NU9`) 정리

옛 PC에서 **`발송PC-해제.bat`** 을 한 번 실행하세요(작업 해제 + 데몬 종료).
지금은 이미 `(미등록)` 상태라 생략해도 되지만, **두 PC 동시 데몬은 금지**(ClassNote 이중 로그인)이므로 권장합니다.

---

## 5. 실게시 스위치 (중요)

발송 워처가 켜져 있어도, **실제 전송**은 앱의 안전 스위치가 켜져 있어야 나갑니다:
- **학원 설정 → 보고서 → "ClassNote 실제 발송" 켜기** (기본 OFF = dry-run).
- OFF인 동안엔 "재발송"을 눌러도 실제 전송·큐잉되지 않습니다(옛 보고서 대량 오발송 방지).

## 6. 확인

- eywa **수업보고서** 화면의 **"발송 PC"** 표시가 `학원동기화-PC` **온라인**으로 바뀌는지 확인.
- 연동 면의 **"동기화 담당 PC"** 와 같은 PC 이름이면, 발송·동기화가 한 상시 PC로 통합된 것입니다.

---

## 문제 해결

| 증상 | 확인 |
|---|---|
| `발송PC-지정` 이 "playwright 없음"으로 중단 | 저장소 루트에서 `pnpm install` 후 재실행 |
| dry-run 이 스크린샷에서 실패 | `CLASSNOTE_SCREENSHOT_BASE`가 실제 공개 도메인인지 (로컬 3113 아님) |
| 발송이 `ERR_NAME_NOT_RESOLVED`로 실패 | 주소 오타(예: `eywa-alpha-vercel.app`) — **`발송PC-주소수정.bat`** 더블클릭 |
| "테넌트 N개 — CLASSNOTE_TENANT_ID 필요" | `.env.local`에 `CLASSNOTE_TENANT_ID=becaa316-…` 추가 |
| 화면에 여전히 옛 PC가 발송 PC로 뜸 | 옛 PC에서 `발송PC-해제.bat` 실행(중복 데몬 방지) |
| 데몬이 자꾸 죽음/창이 뜸 | 콘솔 창을 닫지 말 것 — 작업 스케줄러가 `conhost --headless`로 창 없이 상주 |
