# ClassNote 연동 (수업보고서 발송) — 구조 · 운영 · 트러블슈팅

> 수업보고서(lesson_reports)를 학부모 앱 **ClassNote**(클래스노트, 키즈노트/카카오 계열)로 발송하는
> 전체 파이프라인의 단일 참조 문서. 2026-07-10 멀티에이전트 코드 전수 분석 + 실브라우저(기관설정 포함)
> 탐사 + 실발송 E2E로 검증된 내용. 코드를 만지기 전 이 문서를 먼저 읽을 것.

---

## 1. 한눈에 보는 파이프라인

```
[강사 /onescreen "ClassNote 발송"]──┐        (4중 게이트: 스위치·과목·too_old·동명이인)
[원장 /lesson-reports 재발송·복구]──┴─▶ lesson_reports.classnote_status = 'queued'
                                            │
                                            ▼  (15초 폴 · FOR UPDATE SKIP LOCKED · BATCH 2)
                              [연동 PC(학원동기화-PC) 상주 데몬 watch-classnote-queue.mjs]
                                            │
                                            ▼  Playwright로 공개 /r/{share_token} 페이지의
                                               `.report-capture`(ParentReportCard 루트)를 JPEG 캡처
                                            │
                                            ▼  POST (loginId/PW + imageBase64 + shareUrl + className)
                              [Cloud Run: submitToClassNoteV2 — Puppeteer DOM 자동화]
                                            │   원본 소스 = D:\edutrix\functions\index.js (repo 밖!)
                                            ▼
                              [classnote.com 로그인 → /service/report/add → 보드 "(과목)학생명"
                               원아선택 → 이미지 업로드 + 본문에 shareUrl → "지금전송"]
                                            │
                                            ▼
                              [학부모 ClassNote 앱: 보고서 이미지 + /r 링크 수신]
```

- **웹(Vercel)은 큐잉만** 한다 — 서버리스에서 Playwright+ClassNote 로그인이 불가능하므로.
- ClassNote에는 공개 API가 없다. **모든 게시는 DOM 자동화**(Cloud Run 함수의 Puppeteer가 사람 흉내).
- 상태머신: `NULL → queued → processing → success | failed(3회 재시도 후) | too_old | name_conflict`.
  `revoked`·`dry_run`·`subject_off`는 DB 상태가 아니라 액션 반환/화면 파생 표시(3계층 어휘 주의).

## 2. 구성요소 파일 맵

| 층 | 파일 | 역할 |
|---|---|---|
| 강사 발송 | [features/onescreen/server/actions.ts](../src/features/onescreen/server/actions.ts) `saveAndQueueClassnote` | 저장+큐잉. 게이트 4종 통과분만 queued |
| 원장 관리 | [features/report-admin/server/actions.ts](../src/features/report-admin/server/actions.ts) `retryClassnote`/`resetStuckClassnote` | 재발송(날짜·과목 재검증)·멈춤복구(processing 10분+ → queued) |
| 큐 뷰 | [features/report-admin/server/queries.ts](../src/features/report-admin/server/queries.ts) `getClassnoteQueue` | 최근 3일 집계 + 주의목록 + 워커 온라인(3분 무응답=오프라인) |
| 순수 로직 | [features/report-admin/classnote-queue.ts](../src/features/report-admin/classnote-queue.ts) · [features/onescreen/classnote-guard.ts](../src/features/onescreen/classnote-guard.ts) | 멈춤 판정(10분)·too_old 가드(전 달 1일, KST)·과목 opt-in |
| 동명이인 | [features/onescreen/server/scope.ts](../src/features/onescreen/server/scope.ts) `hasClassnoteNameCollision` | 유효이름(classnote_name‖name) 중복 감지 → 자동 발송 차단 |
| 캡처 대상 | [features/onescreen/components/parent-report-card.tsx](../src/features/onescreen/components/parent-report-card.tsx) | 루트 class `report-capture` — **폭/클래스 변경 시 워커 셀렉터 동기 필수** |
| 공개 페이지 | [app/(share)/r/[token]/page.tsx](<../src/app/(share)/r/[token]/page.tsx>) | 학부모 열람 + `x-eywa-internal` 헤더면 조회로그 스킵 |
| 워커 코어 | [scripts/_classnote/classnote-core.mjs](../scripts/_classnote/classnote-core.mjs) | stale 복구→클레임→스크린샷→게시→재시도. one-shot/데몬 공용 |
| 워커 실행 | [scripts/_classnote/watch-classnote-queue.mjs](../scripts/_classnote/watch-classnote-queue.mjs)(데몬)·[process-classnote-queue.mjs](../scripts/_classnote/process-classnote-queue.mjs)(1회) | 데몬=15초 폴+heartbeat(`classnote_workers` upsert) |
| PC 운영 | [scripts/_classnote/setup-classnote-pc.ps1](../scripts/_classnote/setup-classnote-pc.ps1) + 발송PC-{지정,상태확인,해제,주소수정}.bat | 작업 스케줄러 등록(conhost --headless·10분 부활)·해제·env 오타 수정 |
| 이관 안내 | [scripts/_classnote/연동PC-이관-안내.md](../scripts/_classnote/연동PC-이관-안내.md) | zip 물리이관 절차(연동 PC는 git pull 아님) |
| 실게시 함수 | **`D:\edutrix\functions\index.js`** `exports.submitToClassNoteV2` | ⚠️ **repo 밖**. Firebase Functions v2 → Cloud Run `https://submittoclassnotev2-q4dmdhnkvq-uc.a.run.app` |
| 마이그 | 0082a(report 필드)·0083a(classnote 큐 컬럼+유니크)·0084a(classnote_workers)·0087a(attachments)·0088a(students.classnote_name) | ⚠️ 같은 번호의 활동로그 계열 마이그와 **번호 중복 공존**(병렬 세션 산물) |

## 3. ClassNote 서비스 자체 구조 (2026-07-10 실브라우저 검증, center 96575)

### 사이트 맵
- `classnote.com/login` — 로그인(자동화 계정 = env `CLASSNOTE_UPLOAD_ID`, 관리자 "인재원 프리미엄관")
- `/service/report` — 알림장 목록(카드/목록, 필터, 미수신 표시) + 예약발송함 + 임시보관함(`/drafts`)
- `/service/report/add` — 알림장 작성: 날짜 → **원아 선택 모달**(반 아코디언·"반 전체"·선택완료) → 내용
  textarea("1:1로 전달됩니다") → 취소/임시저장/**지금전송**(+예약전송). 담당교사에게도 알림.
- `/service/report/addManyFirst → addManySecond` — 여러명 보내기 2단계 위저드(bulkText 분기가 사용)
- `/service/setting/*` — **기관설정(관리자 메뉴)**: 아래 표
- 상단 탭: 클래스노트 / 원비 결제 / 운영관리(ERP `/service/erp/centers/96575/child-manage`)
- 내부 REST `classnote.com/api/v1/…`(me/info · centers/{id} · activities · DRF 페이지네이션) **실재** —
  현 자동화는 전부 DOM이지만 장기적으로 API 직접 호출 승격 후보(셀렉터 깨짐 리스크 제거).

### 기관설정(/service/setting) 구조
| 섹션 | 메뉴 | 내용(2026-07-10 실측) |
|---|---|---|
| 멤버 관리 및 초대 | 관리자 관리 | 12명 전원 동일 권한. "인재원 프리미엄관" = 자동화 봇 계정 |
| | 교사 관리 | 24명(수학 강사 + Anna·Jane T·셀린 등 영어 강사 혼재). 반 연결 교사는 게시 알림 수신 |
| | 학생 관리 | 학부모 연결 **승인 완료 468 · 대기 0 · 초대 중 3**. 휴대전화번호를 반에 초대하는 방식 |
| 교육기관 관리 | 반 정보 관리 | 보드 목록 + **"반 추가하기"(수동 생성)**. 학생·교사 있으면 삭제 불가 |
| 클래스노트 설정 | 메뉴 관리 · 기능 설정 | 모듈 12종 온오프(알림장·공지·앨범·출석부·셔틀버스…) · 알림장 댓글 ON·시간표시 ON·교육프로그램 OFF |

### 보드(반) 체계 — 전수 조사 결과 (~495개)
| 유형 | 예 | 규모 | 비고 |
|---|---|---|---|
| 수학 학생모드 | `(수학)강민준` | ~256 | 학생 1명=반 1개. 우리 발송 대상 |
| **영어 학생모드** | `(영어)강민승` | **~229** | **실존 확인** — 코드 주석 "영어 보드 미확인" 해소. `(영어)학원이`도 있음 |
| 영어 그룹반 | `[EIE] Let's Speak 2b (화목금 14:20~16:20)` | ~10 | 시간표가 이름에 포함. 학생모드와 병존 |
| 전체 브로드캐스트 | `[ALL] 인재원 전체방` | 1 (학생 439) | 전체 공지용 활용 가능 |

- **동명이인 관례 = A~G 접미사**: `(수학)박서연C`·`(수학)박서연E`·`(수학)김민서G`.
  → eywa `students.classnote_name` 오버라이드는 **실보드 접미사와 정확히 일치**시켜야 한다
  (예: "박서연C"). 0088a 문서의 "김서윤(중2)" 예시는 ClassNote 실관례와 다르니 따라 쓰지 말 것.
- 함수의 반 매칭 = **공백 제거 후 정확 일치**(타깃이 10자 초과일 때만 부분포함 허용) — 접미사가 다르면 못 찾는다.
- **신규생 보드 자동 생성은 발송 봇에는 없다** — 단 Edutrix repo에 **생성·배정 자동화 스크립트 3종이 실존**(아래
  "왜 학생 1명=반 1개인가" 절 참조). eywa 이식 시 신규생 보드 프로비저닝 자동화 가능.
- **발송 성공 ≠ 학부모 수신**: 학부모 미연결(미초대·미승인) 학생은 게시물을 못 본다.
  승인 완료 468 vs eywa 재원 ~527 = 커버리지 갭 존재.

### 왜 학생 1명 = 반 1개인가 — Edutrix 소스 전수 조사 결론 (2026-07-10, 3방향 병렬 감사)

**한 줄 답: ClassNote에 API가 없어 순수 DOM 봇인데, "반 안에서 특정 원아를 이름으로 고르는" 자동화가
반복적으로 깨져서(오클릭·동명이인 오발송), 보드명 자체를 학생의 결정적 주소 키로 만든 것.**

- **원래는 일반 반 구조였다**: 초기엔 실제 반 이름(`Gina_화_1교시`) → 강사 단위 보드(`[CLASS REPORT] 담임명`)에
  학생을 **이름 텍스트 퍼지 매칭**으로 골라 발송(`fuction/submitToClassNote_v2.js:381-441`, Python 봇 이식).
- **그 방식의 실패 누적**: 짧은 이름 오매칭 사고('민주' 사례 — index.js:2155 주석, 부분매칭을 10자 가드로 봉인),
  동명이인 오발송 위험, `isExactMatchNeeded` 플래그·`class_note_submission_name` 오버라이드 컬럼·
  '김은정→정은' 하드코딩 예외(utils/classNoteUtils.ts) 등 땜질 누적. 원아선택 모달에 **1,703명이 한 리스트**로
  나열되는 규모라 개별 선택의 신뢰성 확보 실패.
- **2026-04-22~24 의도적 전환**(커밋 fb128ef→640732c 타임라인): 학생 1명=반 1개(`(수학)김태희A`)로 만들면
  봇은 "보드명 공백제거 완전일치 → **'반 전체' 클릭**"만으로 그 학생 1명이 확정 선택된다(개별 원아 매칭 코드가
  기본 이미지 발송 흐름엔 아예 없음 — `report-class-accordion[N]-all-class` 클릭뿐). 동명이인은 DB 학생명
  접미사(A~G)가 보드명에 그대로 실려 유일성 보장. 개발자 명문: "우리 '학생당 1인반' 구조"(classnote-bot-notice.ts),
  커밋 746ffe2 "ClassNote 측은 학생을 '(수학)학원이' 형태의 1인 반으로 등록". 에러 타입도 `해당학생없음`
  (반을 못 찾음=그 학생이 없음)으로 반=학생 동일시가 각인. 부수효과: 학원 반이동·담임 변경에도 ClassNote
  재배정 불필요(디커플), 수학/영어 채널 분리(과목별 보드 2개).
- **반(다인) 구조로 돌아가면 안 되는 이유**: 봇의 유일하게 견고한 어포던스가 '반 전체' 클릭인데, 다인 반에서
  반 전체 클릭 = 전원 오발송. 개별 원아 선택(student picker)은 bulkText 모드에만 있고 그마저 "1명 클래스:
  child가 1개뿐이면 그것이 정답" 주석으로 1인반을 정상 전제한다.

### 반 생성·배정 자동화 — ✅ eywa 이식 완료 (2026-07-10, scripts/_classnote/)

Edutrix 원본(D:\edutrix\scripts\ 3종: create_classnote_classes / assign_student_to_individual_class /
assign_teacher_to_classnote)을 eywa DB 기준·Playwright·**dry-run 기본**으로 이식. 공용 헬퍼 =
[`classnote-admin-core.mjs`](../scripts/_classnote/classnote-admin-core.mjs)(로그인·호칭 다이얼로그·무한스크롤 수집).

| eywa 스크립트 | 역할 | 실행 |
|---|---|---|
| [`provision-classnote-boards.mjs`](../scripts/_classnote/provision-classnote-boards.mjs) | eywa 재원생(발송과목 활성 수강) 기대 보드 vs 실보드 diff → **누락 보드만 생성**. 동명이인(유효이름 중복)은 생성 보류, `--exclude=이름`으로 매핑 케이스 제외 | `node --env-file=.env.local scripts/_classnote/provision-classnote-boards.mjs [--subject=math\|english\|all] [--apply] [--limit=N] [--exclude=이름,…]` |
| [`assign-classnote-students.mjs`](../scripts/_classnote/assign-classnote-students.mjs) | 전수 판정(assigned/ready/not_signed_up/board_missing) + `--apply`로 ready만 배정. **학부모 초대 필요 명단 자동 산출** | 위와 동일 패턴. ⚠️ `--apply` 배정 DOM 흐름은 아직 실전 미검증(ready 발생 시 1건으로 검증) |
| (미이식) 강사 배정 | Edutrix `assign_teacher_to_classnote.js` — 강사 게시 알림용, 발송 필수 아님 | 필요 시 후속 |

- **판독=내부 API(2026-07-13 전환)**: 반 정보 관리 화면 무한스크롤 스크래핑은 비결정(수집 누락→기존 보드를
  "누락" 오판. 단 ClassNote가 중복 반명을 거부해 중복 생성은 안 됨 — 백스톱 실측). →
  `GET /api/v1/centers/{id}/classes`(전 보드+`approved_children` 배정 인원)·`/children`(가입 원아)로 교체.
  **읽기=API(결정적) / 쓰기=DOM(반 추가하기)** 구조. center id는 `/api/v1/me/info`.
- **파이프라인**: ①빈 반 생성(자동, 가입 전 가능) → ②학부모 초대(전화번호를 반에 초대 — **자동화 안 함**,
  외부 발신이라 수동) → ③가입·승인(학부모 액션, "[ALL] 회원가입 후 반배정 필요") → ④학생→개별반 배정(자동).
- **✅ 2026-07-13 수학 보드 34개 생성 완료**(원장 승인, 카나리 1→33 일괄, 실패 0, API 재조회 검증 —
  기존 보드·멤버·게시물 무변경, eywa DB 쓰기 0). 직후 전수 판정(재원 237명): **assigned 196 ·
  ready 7**(김서윤·도성훈·주준호·유호성·윤규원·최현성·박소령 — 가입돼 있어 `--apply`만 남음) ·
  **미가입(초대 필요) 33** · **매핑 대기 1**(`(수학)박서준C`→실보드 `박서준`, `classnote_name` 지정).
  ⚠️ `--apply`(생성·배정)는 실 ClassNote 변경 — 원장 승인 후 실행.
- **신규생 운영 = ✅ 일일 자동(2026-07-13)**: 발송 데몬이 **매일 KST 05시 이후 1회**
  [provisionDailyOnce](../scripts/_classnote/classnote-provision-core.mjs) 실행 — 보드 없는 재원생(발송
  opt-in 과목) 보드 자동 생성 + 가입됐는데 보드 빈 학생 자동 배정. 동명이인(학생·원아)은 자동 보류(로그).
  --post 데몬에서만, 발송 스위치와 무관(인프라 준비). 마커=`CLASSNOTE_OUT/provision-last-run.txt`(멱등).
  수동 실행판(위 두 스크립트)은 점검·복구용으로 유지.
- **학부모 가입만은 자동화 불가**(학생 엔티티가 학부모 연결로 생기는 ClassNote 구조 제약).
- **✅ 후속(2026-07-13)**: 배정도 내부 API로 전환 — `POST /api/v1/enrollments/ {child, belong_to_class}`
  (201 즉시 승인, 원아 ID 기반=동명이인 안전). 실배정 9건 완료(ready 6 + 주준호 부모계정 2 + 박서준C 자녀)
  → **배정 204 / 미가입 33 / 잔여 0**. ⚠️ 배정 해제(제거)는 REST 전부 405 — ClassNote UI에서만.
  ⚠️ **박서준 공유보드 잔여 이슈**: `(수학)박서준`에 두 가족(2014년생 초6 + 2011년생 중3)이 함께 연결돼
  있던 것을 발견(Edutrix 시절부터 상호 성적 노출). 중3 자녀는 신설 `(수학)박서준C`로 분리 배정 완료했으나
  **공유보드에서의 제거는 미실시**(과거 게시물 열람 단절 우려 — 원장 결정 대기, 제거는 UI 수동).

### 반 공지 — eywa 반에서 골라 학생별 보드로 일괄 게시 (✅ 2026-07-13 구현·E2E)

수업보고서 > **반 공지** 탭: 반(발송 opt-in 과목의 활성 반) 다중 선택 + 본문 → 각 재원생의 개별 보드로
같은 내용 게시. **반 구조는 eywa에 살고 ClassNote 1인 1반은 배달 레일**(Edutrix NoticeWriteModal 패턴 계승).

- **게시 = 내부 API 직접 호출**(Cloud Run·Puppeteer 마법사 불필요): `POST /api/v1_2/reports/
  {cls, child, enrollment, content, date_written, author_name, tz}` → 201. **회수 = `DELETE /api/v1_2/reports/{id}/`**
  → 204(학원이로 실검증). enrollment id는 원아 상세(`/api/v1/children/{id}`)의 배정 레코드에서.
- **파이프라인**: [notice-face.tsx](<../src/app/(shell)/lesson-reports/_components/notice-face.tsx>) →
  [sendClassNotice](../src/features/report-admin/server/notice-actions.ts)(게이트: lesson_reports 쓰기 +
  `classnoteSendEnabled` dry-run + 과목 opt-in + 동명이인 제외 — [resolveNoticeTargets](../src/features/report-admin/notice-targets.ts)
  순수·Vitest 6) → `classnote_notices` 큐(0099a) → 연동 PC 데몬 [watch-classnote-queue.mjs](../scripts/_classnote/watch-classnote-queue.mjs)가
  매 폴 [processNoticesOnce](../scripts/_classnote/classnote-notice-core.mjs) 호출(--post + 킬스위치 이중 게이트,
  타깃별 실패 분리 기록 = partial). 수동 1회 처리 = `process-classnote-notices.mjs`.
- **테스트 경로**: 탭의 "테스트 발송(학원이)" 버튼 = 학원이 보드로만(실 학부모 무관, Edutrix 관리자 테스트 반 패턴).
- **E2E(2026-07-13)**: dry-run 게이트 → 스위치 ON → 테스트 발송 큐 적재 → 로컬 프로세서 --post →
  `(수학)학원이` 실게시(작성자 "인재원 학원") → API 확인 → 삭제 204 → 큐 행 정리 → 스위치 OFF 원복. 전 구간 통과.
- ⚠️ **연동 PC 재전달 필요**: `D:\tmp\eywa-발송PC-반공지-20260713.zip`(경로보존 + [반공지-적용-안내.md](../scripts/_classnote/반공지-적용-안내.md)).
  적용 전까지 공지는 큐에 대기(무해).
- v2 후보: 이미지 첨부(업로드 CDN 경로 미조사) · 반 안 학생 개별 해제 · 게시 회수 버튼(DELETE API 확보됨).

## 4. Cloud Run 함수(submitToClassNoteV2) 요점 — 소스: D:\edutrix\functions\index.js

- 요청마다 **새 Puppeteer 브라우저**로 classnote.com/login 로그인(세션 재사용 없음). 호칭 다이얼로그(Manager) 처리.
- 학생모드 판정: `/^\((수학|영어)\)/.test(className)` — 이 prefix면 그 문자열 그대로 반명 검색.
- 같은 (날짜+이미지해시+강사+반+링크) 그룹은 원아선택 모달에서 **다중 반 선택 → 알림장 1건으로 동시 발송**.
- 이미지: base64 → 임시 jpg → `input[data-testid='media-attachment-add-input']`에 1장씩 업로드.
- shareUrl은 "마지막 visible textarea"(본문)에 타이핑. 전송 버튼은 텍스트 매칭('지금전송'·'전송' 등).
- 응답: `{success, results:[{success, studentName, errorType?, message?}], sessionId}`. 부분 실패도 200.
- ⚠️ **알려진 함정**: ① 전송 버튼을 못 찾아도 success로 기록하는 경로 존재(침묵 미발송 가능)
  ② 함수 타임아웃 900초 vs eywa 워커 fetch abort 120초 — abort가 서버 실행을 취소하지 못해
  타임아웃-재시도 시 **중복 게시 가능**(멱등 키 없음) ③ emotion 해시 셀렉터(css-*)는 ClassNote
  프론트 재배포 시 깨질 수 있음(정기 실발송 테스트로 감지).

## 5. env 변수 (워커, `node --env-file=.env.local`)

| 변수 | 용도 | 비고 |
|---|---|---|
| `DATABASE_URL` | 큐 직결(RLS 우회) | 필수. **tenant 격리 필터 필수**(코어가 강제) |
| `CLASSNOTE_UPLOAD_ID/PW` | ClassNote 로그인 | `--post` 시 필수. Cloud Run payload로 전달 |
| `CLASSNOTE_TENANT_ID` | 오발송 방지 | 테넌트 2개+면 필수(1개면 자동) |
| `CLASSNOTE_SCREENSHOT_BASE` | /r 캡처 도메인 | 연동 PC는 공개 도메인 필수(`https://eywa-alpha.vercel.app`) |
| `CLASSNOTE_SHARE_BASE` | 게시글 상단 /r 링크 도메인 | 오타 나면 **죽은 링크가 조용히 게시**되므로 주의 |
| `CLASSNOTE_INTERNAL_SECRET` | 워커 캡처를 조회수에서 제외 | 앱(Vercel)과 동일값 페어링 필요. 미설정=조회수 +1뿐 |

실발송 조건(신규 큐잉 기준) = 앱 스위치 `report.classnoteSendEnabled` ON × 워커 `--post`
(run-classnote-worker.ps1에 하드코딩) × `CLASSNOTE_UPLOAD_ID/PW`. 발송 과목은
`report.classnoteSubjects` **opt-in**(빈 목록 = 전부 차단, 현 운영 수학만) — 단 opt-in해도
**발송 가능 화이트리스트**(`CLASSNOTE_SENDABLE_SUBJECTS` = math·subject_1·english) 밖 과목과
subject NULL(이관·레거시)은 게이트가 거부한다(2026-07-10 P0-2·P0-3).

⚠️ **스위치의 한계(구조 구멍)**: `classnoteSendEnabled` OFF는 **신규 큐 진입 2곳만** 막는다.
이미 queued인 재고와 `resetStuckClassnote`(멈춤복구)는 스위치를 안 보고 워커가 그대로 실게시한다.
긴급 전면 정지 = 연동 PC에서 `발송PC-해제.bat`(물리 접근 필요). 단일 킬스위치 부재는 개선 후보.

## 6. 실발송 E2E 검증 이력 + 테스트 방법

- **테스트 전용 학생 = `학원이`**(students `6219e442-…`, status=withdrawn, 칠성초 중2).
  ClassNote에 `(수학)학원이`·`(영어)학원이` 보드 실존. **실발송 테스트는 반드시 이 학생으로.**
- 2026-07-08: onescreen_test 보고서로 실게시 **success**(개발 PC에서, 커밋 71b0863 "실게시 검증됨").
- 2026-07-10: 연동 PC 이관 후 첫 실발송 E2E → **연동 PC env 오타 적발**:
  `CLASSNOTE_SCREENSHOT_BASE=https://eywa-alpha-vercel.app`(점 대신 하이픈) →
  `page.goto ERR_NAME_NOT_RESOLVED` → 3회 재시도 후 failed. 워커 클레임(5초)·자격증명·재시도
  정책은 전부 정상 동작 확인. 수정 = `발송PC-주소수정.bat`(백업→치환→재시작→자가검사).
- 테스트 절차(재현): 학원이 lesson_report 행을 `classnote_status='queued'`로 갱신(전역 스위치는
  OFF 유지 = 다른 경로 안 열림) → 워커가 15초 내 클레임 → status 전이 관찰(`queued→processing→…`)
  → ClassNote 알림장 목록에서 게시물 확인. 날짜는 오늘로(전 달 1일 이전이면 워커가 안 잡음).

## 7. 남은 리스크 · 개선 후보 (우선순위 순)

1. **긴급 정지 단일 지점 부재** — 스위치 OFF가 queued 재고·멈춤복구를 못 막음(§5). 워커가 매 폴마다
   DB 설정을 읽어 post 여부를 판단하게 하면 해소.
2. **중복 게시 창** — 워커 120s abort vs 함수 900s + 멱등 키 없음(§4). reportId 기반 dedupe를 함수에 추가하거나 워커 타임아웃을 함수와 맞출 것.
3. **침묵 미발송** — 전송 버튼 못 찾아도 success(§4). 함수 수정 필요(edutrix repo).
4. ~~신규생 보드 자동 생성 없음~~ → **✅ 해소(2026-07-10)**: `provision-classnote-boards.mjs` +
   `assign-classnote-students.mjs`(§3 표) — dry-run 기본, 학부모 초대·가입만 자동화 불가.
5. 좀비 queued(too_old 드리프트·revoked-while-queued)는 어떤 화면 주의 목록에도 안 잡힘.
6. ~~`retryClassnote`가 revoked_at 미확인~~ → **✅ 해소(2026-07-10 P0-1)**: 재발송 필터에 `revoked_at IS NULL` 포함.
7. 워커 minDate는 PC 로컬 시간, 앱 가드는 KST — 연동 PC가 KST라 현재 무해하나 기준 이원화.

## 8. 과거 사고 (재발 방지 근거)

- **2026-05~06 (edutrix 시절)**: 과거 보고서 재발송 사고 — 1~4월 보고서 **3,500건이 학부모에게 오발송**.
  → too_old 가드(전 달 1일 이후만, [classnote-guard.ts](../src/features/onescreen/classnote-guard.ts))와
  기본 dry-run 스위치(`classnoteSendEnabled=false`)의 존재 이유. **이 가드들을 완화하지 말 것.**
- **2026-07-10**: 연동 PC env 도메인 수기 오타(§6). → 주소는 복사-붙여넣기 + `발송PC-주소수정.bat`.

## 9. Edutrix 병행 운영·컷오버 평결 (2026-07-10 적대 검증 — 4방향 코드검증 + 실보드 대조)

> 질문: "전환기에 Edutrix와 eywa가 같은 ClassNote로 같이 발송해도 이상 없나?"
> **판정: 조건부 가능.** ① 지금 상태(eywa dry-run OFF = Edutrix 단독 발송)는 이미 병행 중이며 **안전**.
> ② 인프라 병행(같은 Cloud Run 함수·같은 봇 계정 동시 호출)도 **안전** — concurrency=1 인스턴스 격리·
> 모듈 전역상태 0·큐 DB 분리(edutrix Supabase vs eywa Postgres)·각자 원자 클레임·sessionId 충돌 불가,
> Edutrix 스스로 같은 계정 봇 2개를 상시 동시운영해 온 실전 근거. ③ 그러나 **"같은 보고서가 학부모에게
> 두 번 안 간다"는 보장은 코드에 0줄** — 크로스시스템 중복확인·발송 멱등키 없음. 방어는 오직 운영 수칙.

### 전환(스위치 ON) 필수 순서
1. ~~**P0 코드픽스 3건 배포**~~ → **✅ 구현 완료(2026-07-10)**: ⓐ `retryClassnote` 방어필터 — 발송 이력 있는
   행만(`classnote_status IS NOT NULL`) + 이관(`source='edutrix_import'`) 제외 + 취소(`revoked_at`) 제외
   ([report-admin/server/actions.ts](../src/features/report-admin/server/actions.ts) — 실DB 검증: 이관 3행 배제·failed 1행만 통과)
   ⓑ 발송 게이트 subject NULL/빈값 거부 + ⓒ **발송 가능 과목 화이트리스트** `CLASSNOTE_SENDABLE_SUBJECTS`
   (math·subject_1→수학 보드, english→영어 보드 — [classnote-guard.ts](../src/features/onescreen/classnote-guard.ts), Vitest 10)
   + 워커 `subjectLabel`도 동일 화이트리스트(매핑 없는 과목 = 즉시 failed + 명확 에러, boardClassName throw)
   + 원장 발송 과목 칩을 화이트리스트 과목만 노출(report-section.tsx).
   ⚠️ **워커 파일(classnote-core.mjs)은 연동 PC 자기 복사본으로 실행** — 코드 배포와 별개로 zip 재전달 필요
   (주소수정 zip에 동봉, 앱 측 게이트 ⓐⓑ는 Vercel 배포만으로 유효).
2. **Edutrix 쪽 수학 발송 중지** — 발송은 Vercel cron이 아니라 **로컬 상주 봇**(classnote-bot-student.ts, 30초 폴)이 담당. 봇 PC에서 봇 종료(process-ai cron이 큐를 계속 채우므로 재가동 금지).
3. eywa `classnoteSubjects=['math']` → `classnoteSendEnabled` ON → 첫날 소량 표본 육안 확인.

### 전환기 운영 수칙 (코드가 못 막아주는 것들)
- **과목 단위 컷오버**: 한 과목의 작성+발송은 한 시스템에만. 이중 작성 시 eywa DB에 2행 영구 공존
  (nulls-distinct 유니크) → 진도 탭 이중 표시·주간 작성률 2배·**학부모 추이 그래프 같은 날짜 2점**.
- **학생 이름 변경 금지(전환 완료까지)**: Edutrix 쪽 cron이 eywa DB를 읽어 학생을 **이름으로만** 미러
  (eywaSyncAction/syncActions) — 개명 시 Edutrix에 유령 학생 신설 + 기존 매핑 단절(보고서 조용히 skip),
  동명이인은 Edutrix에서 1명으로 붕괴돼 남의 성적이 섞일 수 있음.
- **동명이인 오버라이드 이원화 주의(가장 위험한 조용한 실패)**: eywa `classnote_name`과 Edutrix
  `class_note_submission_name`을 대조하는 코드가 없음 — 오입력하면 동명이인 가드를 통과한 채
  **남의 집 학부모에게 성적이 감**(성공으로 기록). 지정 시 실보드명(A~G 접미사)과 사람이 대조.
- **원장 화면 해석**: 이관 행 '미요청' ≠ 미발송(Edutrix 발송 사실은 이관 안 됨 — 재발송 금지) ·
  Edutrix로 쓰는 강사의 당일 작성률 0%는 정상(이관은 새벽 03:30 단발 — 독촉 금지) · 열람 수는 eywa
  발송분만 집계(전환기 과소).
- **회수 반쪽**: eywa revoke는 eywa 링크만 차단 — Edutrix로도 나간 내용은 그쪽에서 별도 처리.
- **봇 계정 비번 회전** = Edutrix 코드(평문 하드코딩) + eywa 발송 PC env 두 곳 동시 갱신.

### 보드 준비 실사 (2026-07-10, 재원 512·발송과목 수강 382명·기대 보드 479 vs 실보드 612 대조)
| | 수학(첫 컷오버 대상) | 영어(확장 시) |
|---|---|---|
| 보드·학부모 연결 정상 → 즉시 발송 가능 | **~200명** | ~118명 |
| **보드 없음 → 수동 생성 필요** | **33명** | 67명 |
| 보드 있으나 학부모 미연결(발송해도 못 봄) | 6명 | 58명 |
| 이름 매핑(`classnote_name`) 지정 필요 | 1명(박서준C→실보드 박서준) | 2명(전주원→전주원A·이서은→이서은A) |

### Edutrix 은퇴 시 지뢰 (은퇴는 마지막에)
- eywa 실게시 함수(submitToClassNoteV2)가 **Edutrix 소유 Firebase 프로젝트의 Cloud Run** — 프로젝트/빌링
  삭제 시 eywa 발송 전면 즉사. 은퇴 정리 전에 **함수를 eywa 소유 프로젝트로 이전**(P2).
- Edutrix `/share` 링크는 만료 게이트가 없어 앱 제거 시 과거 게시물 링크 대량사(이미지 본문은 ClassNote에 박제).
- Edutrix 로컬 봇 경로엔 too_old 가드가 없음(가드는 cron 미등록 서버 경로에만) — 병행기 중 Edutrix에서 과거 보고서 재큐잉 조작 금지.

## 10. Edutrix 완전 종료(소등) 체크리스트 — 데이터 이전 완료 (2026-07-10)

> 원장 결정: "유지해야 하는 것들을 eywa로 다 이전해서 Edutrix를 완전히 꺼버린다. Vercel(공유 링크 주소)도
> 종료 — 발송 이미지가 ClassNote에 박제돼 있으므로 옛 링크 사망은 수용."

### ✅ 데이터 이전 — 완료 (스크립트 = [scripts/_edutrix_retire/](../scripts/_edutrix_retire/))
- **운영 반영** `full-import-reports.cjs`: lesson_reports **풀 이력 16,694행**(기존 3,456 리치필드 보강 +
  13,238 신규, UUID 매핑 299명 = 원본의 98.9%). 필드: 교재명 15,998·**AI 학부모 멘트(notice→notes) 10,493**·
  태도 5,098·보강 142 + **발송 사실 11,881건**(sent_at→classnote_status='success' — "미발송" 오인 근본 해소).
  멱등(edutrix_report_id 유니크) — **최종 소등 직전 한 번 더 실행**해 마지막 며칠분 흡수.
- **아카이브** `archive-edutrix.cjs` → `edutrix_archive`(0095a, service_role 전용) + 로컬
  `data/edutrix-archive/*.jsonl`: 9테이블 **23,339행 raw 무손실**(reports 16,877 전량 — 미매핑 189 포함,
  en_reports 23, 로스터·강사 프로필, 발송 로그 4,145, 열람 이력 1,058). 자격증명(`classnote_login_pw`·
  `profile_token`)은 제거 후 적재.
- 검증: 중복 edutrix_report_id 0 · 김준영 66건(구 12) · /r 실렌더에서 과거 빈칸이던 '학부모 전달 내용'에
  Edutrix 발송 멘트 복원 확인 · 추이 그래프(최근 10건 limit)·진도 탭(12건 limit) 무회귀 · 학원이 테스트 행 불변.

### 소등 순서 (의존 역순 — 위부터)
1. **강사 작성 eywa 전환 + Edutrix 발송 봇 종료**(봇 PC) → 며칠 안정화.
2. ~~full-import 마지막 실행~~ → **✅ 자동화됨(2026-07-10)**: `/api/cron/edutrix-sync`를 리치 필드 +
   윈도 내 **수정 전파**(diff 후 변경분만 UPDATE, 상한 300)로 승격 — full-import와 필드 동형이라 매일
   새벽 cron이 신규·수정분을 완결 상태로 유지(교란-복원 E2E 검증: updated:1 → 원본값 복원).
   소등 날 수동 작업 = **archive-edutrix.cjs 재실행 한 줄만**(원본 raw 최종 스냅샷).
3. **Edutrix Vercel 종료** — 앱·cron(학생 이름 미러 포함) 소멸. `/share` 옛 링크 사망 = 수용(원장 승인,
   이미지는 ClassNote 게시물에 박제). eywa 측 부수 정리: `/api/cron/edutrix-sync`가 원본 소실 후 500을
   내지 않는지 확인(Supabase가 살아있는 동안은 무해) — Supabase 소등과 함께 vercel.json에서 cron 제거.
4. **Edutrix Supabase 종료** — 이전·아카이브 완료로 의존 0. eywa .env.local의 `EDUTRIX_*` 키와
   `vercel.json` edutrix-sync cron, `instrumentation.ts` 권장 env를 같이 정리.
5. **Edutrix Firebase(Cloud Run)** — ⚠️ **마지막까지 유지.** eywa 발송의 실게시 엔진. 끄려면 선행 필요:
   - 권장 **옵션 B: 워커에 게시 로직 내장** — 연동 PC 워커가 이미 Playwright를 돌리므로 submitToClassNoteV2의
     DOM 자동화(로그인→원아선택→업로드→전송)를 classnote-core.mjs에 포팅하면 GCP 의존이 통째로 사라짐
     (가정용 IP라 봇 차단 리스크도 낮음). 그 후 Firebase 삭제 가능.
   - 옵션 A: 함수를 eywa 소유 GCP/Firebase로 재배포(소스 `D:\edutrix\functions\index.js` — noticeAdd.js
     부재 주의). 인프라 이중 관리가 남아 B보다 열위.
6. 소등 후 잔여물: `edutrix_archive`(영구 보험) · lesson_reports 풀 이력(운영) · `D:\edutrix` 로컬 소스
   (함수 원본 — 옵션 B 완료 전까지 보관 필수).
