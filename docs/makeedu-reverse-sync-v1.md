# 역동기화 v1 — QR 접수 상담 → makeedu 예비상담 수동 푸시

> 2026-07-02 구현·실 E2E 검증. 배경 검토는 [makeedu-reverse-sync-feasibility.md](makeedu-reverse-sync-feasibility.md)
> (전면 자동 양방향 = 비권장, 이 좁은 opt-in 경로만 채택).

## 무엇을 해결하나

학부모가 eywa QR 공개접수로 제출한 신규 상담(`enrollment_consultations.from_public_intake`)은 **eywa가
원본**이라 makeedu에 없다. 지금까지는 사무실이 makeedu에 손으로 재입력해야 했다 → 이걸 버튼 한 번으로.

**자동이 아니다.** 사무실(원장)이 후보를 눈으로 검토하고 골라서 보낸다. makeedu는 여전히 정본이고,
푸시는 **새로 추가만** 하며 기존 makeedu 데이터를 절대 수정하지 않는다.

## 아키텍처 (정방향 릴레이 인프라 재사용)

```
[어디서든: 프로덕션 웹/폰]                         [동기화 PC (신뢰 IP, makeedu 사용 PC)]
원장: 학원설정 › 연동 › "makeedu로 상담 보내기"
  └ enqueueConsultationPush(ids)  ──insert──▶  makeedu_push_requests (pending)
     (master 게이트, Vercel에서 실행 가능)              │
                                                        ▼ 15초 폴링
                                          watch-sync-requests.cjs (상주 워처,
                                          작업 스케줄러 eywa-makeedu-sync-watcher)
                                                        │ pending > 0
                                                        ▼
                                          push-consultations.cjs --apply
                                            ① pending 전부 claim (running)
                                            ② makeedu 로그인(.env.local 크리덴셜)
                                            ③ /counsel/counselList_regist.do?callpage=res
                                               폼 채움 → makeedu 자신의 ajaxSubmit
                                               (counselList_regist_InsProc.do) 호출
                                            ④ 응답 "OK" → resList에서 counselSeq 회수
                                            ⑤ eywa: makeedu_pushed_at=now(),
                                               makeedu_id=counselSeq / 요청 done 마감
```

- 버튼은 **어디서든**(Vercel 프로덕션·폰) 동작 — DB에 요청만 남기므로.
- 실제 makeedu 쓰기는 **동기화 PC 1대**가 담당(makeedu가 신뢰 IP만 허용 — 데이터센터 IP는 CAPTCHA 차단).
- PC가 꺼져 있으면 pending으로 대기 → 켜지면 워처가 따라잡는다.

## 데이터 모델 (`0071a`)

| 객체 | 용도 |
|---|---|
| `makeedu_push_requests` | 푸시 큐. `consultation_id` FK(cascade)·`status`(pending→running→done/error/skipped)·`makeedu_counsel_seq`·`error`·요청자/시각. RLS: 테넌트 read만, write는 service_role(액션)·직접연결(워처) |
| `enrollment_consultations.makeedu_pushed_at` | **멱등 플래그** — 성공 시 now(). 이게 있으면 후보 제외 + 재푸시 차단 |

## 중복·재푸시 방지 (4겹)

1. **후보 쿼리**(`getUnpushedIntakeConsultations`): `from_public_intake && makeedu_id IS NULL && makeedu_pushed_at IS NULL && outcome≠enrolled`만 노출.
2. **액션 검증**(`enqueueConsultationPush`): 같은 조건으로 서버 재검증 + 이미 pending/running인 상담은 큐잉 제외(연타 무해).
3. **writer 재검사**: 실행 시점에 `pushed_at`(이미 전송) / `outcome=enrolled`(큐잉~실행 사이 등록됨)면 skipped 마감 — PC 꺼짐으로 지연된 요청의 레이스까지 커버.
4. **읽기 동기화와 체계 일치**: makeedu가 부여한 counselSeq를 `makeedu_id`에 저장하는데, 읽기 임포터(import-prospects)도 같은 counselSeq를 키로 쓰므로 다음 동기화가 푸시된 건을 **"이미 연결됨"으로 스킵** → eywa에 역수입 중복이 생기지 않는다(라이브 검증).

⚠️ makeedu 자체의 중복 경고(dupChk confirm)는 ajaxSubmit 직접 호출로 우회된다 — 위 eywa측 가드가 그 역할을 대신한다.

### enrolled(학원 등록 완료) 가드의 의미

`outcome=enrolled` = **학원에 등록했다**(eywa 사실)이지 makeedu 등록 여부가 아니다. 등록된 학생은 예비원생
단계를 지났으므로 makeedu **예비상담**으로 보내면 "다니는 학생이 신규 문의로 뜨는" 군더더기가 된다(허다언
케이스 실측 — 그는 makeedu 원생목록에 이미 있었음). 그래서 3중 제외. makeedu 원생/예비 목록 **어디에도
없는** enrolled는 '원생등록'(`/member/student/list_regist.do`) 푸시가 맞는 경로 = **v2 후보(미구현)** —
원생은 수납·출결이 걸리는 레코드라 별도 정찰·실시간 중복확인 설계가 필요하고, 수업(반) 배정은 자동화
불가(eywa 반↔makeedu lessonCode 연결이 거의 없음)라 기본 정보만 등록하는 스코프가 될 것.

## makeedu 폼 매핑 (정찰로 확정, dry-run 실검증)

| makeedu 필드 | 값 | 비고 |
|---|---|---|
| `preStudName` / `preSchoolName` | 학생명 / 학교 | |
| `preGrade` | 학년 코드 | 초1=11…초6=16, 중1=21…중3=23, 고1=31…고3=33, 유치원=01, 미매핑=99(일반) |
| `prePName` / `prePHpNo` | 보호자명 / 연락처 | **전화 = `000-0000-0000` 하이픈**(lib.normPhone: 11자리 3-4-4, 10자리 3-3-4. makeedu 폼 JS는 공백만 제거해 하이픈 보존) |
| `prePKind` | 관계 | 모=M / 부=F / 기타=E |
| `preHpNo` | 원생 연락처 | 하이픈 동일 |
| `counselYmd` | 상담일 | consultation_date ?? received_date ?? 접수일 |
| `title` | **`[eywa 온라인 접수]` 고정** | 학생명은 목록 원생명 컬럼에 이미 노출 |
| `contents`/`contentsText` | 메타(경로·과목·셔틀·주소·형제·진로) + 상담내용(parent_request) | HTML/plain 이중 기록(makeedu 폼 구조) |
| `counselType` | N(신규 예비원생) | 폼 기본값 유지 |

## 운영 런북

- **사용**: 학원설정 › 연동 면 상단 "makeedu로 상담 보내기" 카드(후보 있을 때만 표시, master 전용).
  체크 → 전송 → 1~2분 뒤 makeedu 예비원생 목록에 등장, eywa 목록에선 사라짐.
- **전송 실패 시**: 카드에 "전송 실패" 배지 — 원인 확인 후 **다시 선택해 재전송 가능**(error 상태는 잠기지 않음).
- **PC 요건**: 기존 makeedu 사용 PC(신뢰 IP) 1대에 상주 워처(`eywa-makeedu-sync-watcher`, 로그온 자동시작).
  실행 PC는 **1대만 권장** — 여러 대가 각자 makeedu에 로그인하면 봇 탐지/재인증 위험.
- **동기화 PC 지정(원커맨드)** — 웹 버튼은 PC에 작업을 설치할 수 없으므로(브라우저 샌드박스·Vercel 원격),
  지정할 PC에서 **한 번 실행**한다. 관리자 권한 불필요.
  - 지정: `powershell -File scripts\_makeedu\setup-sync-pc.ps1` — 사전요건 확인 → 작업 2개 등록
    (`eywa-makeedu-sync` 06/18시 · `eywa-makeedu-sync-watcher` 로그온 상주) → 워처 시작 → **makeedu
    로그인(신뢰 IP) 테스트**([check-login.cjs](../scripts/_makeedu/check-login.cjs))까지 자동.
  - 상태: `... setup-sync-pc.ps1 -Status` / 로그인만: `-Test` / 해제(옛 PC): `-Remove`.
  - **옮길 때**: 옛 PC `-Remove` → 새 PC 실행. **두 PC 동시 워처 금지**(makeedu 이중 로그인).
  - ⚠️ 이 `.ps1`은 **UTF-8 BOM**으로 저장돼야 PS5.1이 한글·기호를 정확히 파싱한다(무BOM이면 파싱 깨짐).
    편집 후 BOM 유지 필요(다른 무BOM 래퍼와 달리 이 파일은 박스문자·기호가 많아 BOM 필수).
- **담당 PC 상태(웹)**: 연동 면에 "동기화 담당 PC" 카드 — 워처가 매 폴(15초)마다 hostname·last_seen을
  `makeedu_sync_workers`(0073a)에 심장박동으로 기록 → 온라인(60초 이내)/오프라인·마지막 활동 시각 표시.
  2대 이상 온라인이면 경고(한 대 권장). 워처 없으면 지정 안내(setup-sync-pc.ps1).
- **로그**: `D:\tmp\makeedu\watch-requests.log` (워처 + writer 출력 append).
- **수동 CLI**(동기화 PC):
  - dry-run(제출 없이 폼 값만 확인): `node --env-file=.env.local scripts/_makeedu/push-consultations.cjs --ids=<uuid>`
  - 큐 처리(실제 제출): `node --env-file=.env.local scripts/_makeedu/push-consultations.cjs --apply`
- **크리덴셜**: `.env.local`의 `MAKEEDU_ID`/`MAKEEDU_PW`(2026-07-03부터 전용 계정 `cseywa`).
  ⚠️ **크리덴셜 변경 시 워처 재시작 필수** — 상주 프로세스가 시작 시점 env를 물고 있고, 자식의
  `--env-file`은 이미 있는 env를 **덮지 않는다**(Node 규칙). `Stop-ScheduledTask` → `Start-ScheduledTask "eywa-makeedu-sync-watcher"`.

## 검증 기록 (2026-07-02)

- **정찰(읽기 전용)**: 등록 폼 853필드 덤프 → 실제 입력 폼 `form`(20필드)·제출 함수(`ajaxSubmit`→`_InsProc.do`, 응답 "OK")·학년/관계 코드표 확정. CSRF 토큰 없음.
- **dry-run**: 허다언 상담으로 폼 전 필드 채움·되읽기 — 학년 14(초4)·관계 M(모)·전화 하이픈·counselType=N 확인, 제출 안 함.
- **실 E2E**: 김승후(실제 QR 문의, makeedu 원생/예비 어디에도 없음 사전 확인) 큐잉 → 워처 감지 → makeedu 실제 등록 **counselSeq 5231** → resList 노출·상세 본문 확인 → eywa `makeedu_id=5231`·`pushed_at` 세팅 → 후보 목록에서 소멸.
- **중복 0**: 이후 읽기 동기화가 김승후를 "이미 연결됨"으로 스킵(eywa 역수입 중복 없음), 재푸시는 3겹 가드에 전부 차단.

## 한계 / v2 후보

- **대상 = QR 공개접수 상담만**(v1). 재원생 상담(student_consultations) 확장은 동일 패턴 가능(별도 결정).
- **enrolled → 원생등록 푸시**(위 참조) — v2 후보, 미구현.
- **makeedu 폼 변경에 취약** — UI 자동화의 태생적 한계. 실패 시 error로 남고 로그로 원인 확인.
- 직원(실장 등) 트리거 노출은 미구현(카드가 owner 연동 면 = master 전용).
- 이 기능은 **전환기 다리** — makeedu 은퇴 시 함께 은퇴한다.
