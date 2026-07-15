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
                                            ▼  ⛔ **프리플라이트 보드 안전 게이트**(§5.5, board-safety.mjs)
                                               ClassNote 실보드 조회 → 공유 보드(2가족+)·보드 없음/중복이면
                                               `blocked_shared`로 보류(캡처·게시 안 함). 예외=원장 화이트리스트.
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
| **인바운드**(학부모 글) | [classnote-feed-core.mjs](../scripts/_classnote/classnote-feed-core.mjs) `pollParentPostsOnce` + 순수 [parent-post-filter.mjs](../scripts/_classnote/parent-post-filter.mjs) | 피드 폴링(읽기 전용)→학부모 새 글→담당 강사 `notifications`. 워터마크 0108a. **세션 유지 필수**(§3) |
| 워커 실행 | [scripts/_classnote/watch-classnote-queue.mjs](../scripts/_classnote/watch-classnote-queue.mjs)(데몬)·[process-classnote-queue.mjs](../scripts/_classnote/process-classnote-queue.mjs)(1회) | 데몬=15초 폴+heartbeat(`classnote_workers` upsert) |
| PC 운영 | [scripts/_classnote/setup-classnote-pc.ps1](../scripts/_classnote/setup-classnote-pc.ps1) + 발송PC-{지정,상태확인,해제,주소수정}.bat | 작업 스케줄러 등록(conhost --headless·10분 부활)·해제·env 오타 수정 |
| 이관 안내 | [scripts/_classnote/연동PC-이관-안내.md](../scripts/_classnote/연동PC-이관-안내.md) | zip 물리이관 절차(연동 PC는 git pull 아님) |
| 실게시 함수 | **`D:\edutrix\functions\index.js`** `exports.submitToClassNoteV2` | ⚠️ **repo 밖**. Firebase Functions v2 → Cloud Run `https://submittoclassnotev2-q4dmdhnkvq-uc.a.run.app` |
| 마이그 | 0082a(report 필드)·0083a(classnote 큐 컬럼+유니크)·0084a(classnote_workers)·0087a(attachments)·0088a(students.classnote_name)·0099a(classnote_notices)·**0108a(classnote_feed_state=인바운드 워터마크)** | ⚠️ 같은 번호의 활동로그 계열 마이그와 **번호 중복 공존**(병렬 세션 산물) |

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

### 학부모 **새 글** → 담당 강사 eywa 인앱 알림 (✅ 2026-07-15 구현 · 인바운드 · 읽기 전용)

지금까지의 ClassNote 연동은 전부 **아웃바운드**(우리가 게시)였다. 이건 유일한 **인바운드** — 학부모가 보드에
올린 글을 감지해 그 학생 담당 강사의 eywa **알림 벨**에 띄운다. **ClassNote에 아무것도 쓰지 않는다**(구조상
학부모에게 나가는 경로 자체가 없음 = 오발송 리스크 0).

- **왜 필요한가(실측이 뒤집은 전제)**: ClassNote는 반 연결 교사에게 **자체 알림을 이미 보낸다** — "1인 보드엔
  교사가 없어 글이 묻힌다"는 가설은 **틀렸다**(수학 1인보드 292개 중 252개에 실제 수학 강사 연결됨).
  진짜 문제는 **강사별 편차**: 3주 표본에서 수학 학부모 글 8건 중 수진T(이수진) 담당은 **5/5 응답**,
  김윤하 담당은 **0/2 무응답**. 무응답 1건("감기때문에 하루 쉬겠습니다")은 보드에 **퇴직 강사(김화영)** 가
  연결돼 있었다. → 강사가 **매일 보는 화면(eywa)** 에 띄우는 게 답이고, **eywa 매핑이 ClassNote 보드 연결보다
  정확**하다(퇴직자 배제 + 현직 담당 전원). 이 기능을 "묻힌 글 구제"로 설명하지 말 것 — 정확히는 **"안 보는 강사에게도 도달"**.
- **매핑은 보드명 기준**(⚠️ child_name 쓰지 말 것): 피드 행의 `child_name`은 **학부모가 등록한 원아명**이라
  제멋대로다(실측: 보드 `(수학)박서연E`의 원아명이 그냥 "서연"). 보드명은 우리가 **eywa 유효이름**으로 만든 것이라
  동명이인 접미사(A~G)까지 정확 — 1인 보드 구조가 애초에 그러라고 있다.
  **대상 집합**(누구에게 보드가 있나) = provision `expectedFor`와 동일 쿼리(재원 + 활성 수강). **매핑 233 / 보류 4.**
- ⚠️⚠️ **동명이인 우주는 "전 학생"이어야 한다 (F1 — 실제로 뚫렸던 구멍, 2026-07-15 적대리뷰가 프로덕션에서 실증)**:
  **재원생 안에서만** 동명을 판정하면, 퇴원한 동명 학생의 보드가 재원 동명 학생에게 **유일 매핑**된다.
  ClassNote 보드는 학생 수명주기보다 오래 살기 때문이다(원아 해제·보드 삭제 자동화 없음 — REST 405).
  실측: `(수학)김채은` 보드의 원아 생년월일은 **퇴원 김채은(중1)** 것인데 재원 김채은은 **고1로 딴 사람**이고
  담당 강사도 안 겹친다(김윤하·김은정 vs 노현진) → 퇴원 가족의 사적인 글이 엉뚱한 강사에게 갈 뻔했다.
  `(수학)김서윤`도 동일. 수학 재원 237명 중 **4건**(김서윤·김채은·김수아·이지호A) → 전부 보류로 전환.
  · 규칙 = [`countByEffectiveName`](../scripts/_classnote/parent-post-filter.mjs)(순수·Vitest)에 **status·과목 무필터
  전 학생**을 넘겨 이름별 **인원수**를 세고, 2명 이상이면 보류.
  · ⚠️ **`fetchUniverseNames`를 그대로 쓰면 안 잡힌다** — 거긴 `Set`이라 **완전히 같은 이름 2명이 1개로 접힌다**
  (그 함수는 "다른 이름끼리의 충돌"용 — 용도가 다르다). 반드시 센다.
  · ⚠️ 헤더·주석에 "provision과 완전히 같은 기준"이라고 쓰지 말 것 — provision은 `expectedFor` **위에**
  `fetchUniverseNames`+`planChildMatches` 층이 더 있다. 그 문구를 믿고 유일성 층을 빠뜨린 게 이 사고의 원인이다.
- **파이프라인**: 데몬 [watch-classnote-queue](../scripts/_classnote/watch-classnote-queue.mjs) 매 폴 →
  [`pollParentPostsOnce`](../scripts/_classnote/classnote-feed-core.mjs)(**1분 가드**) → 기관 피드 **요청 1개** →
  [순수 필터](../scripts/_classnote/parent-post-filter.mjs)(`selectNewParentPosts`/`buildNotificationText`, Vitest 16) →
  학생 → 활성 수학 담당 강사 → `notifications` insert **+ 워터마크 전진(같은 트랜잭션)**.
  수동 1회 = [`process-parent-posts.mjs`](../scripts/_classnote/process-parent-posts.mjs)(기본 점검모드, `--apply`로 실행).
- **워터마크 = 0108a `classnote_feed_state`**(tenant×scope 1행). ⚠️ 프로비저닝처럼 **파일 마커로 하면 안 된다** —
  프로비저닝은 diff 기반이라 마커가 유실돼도 멱등하지만, **알림은 누적**이라 워터마크가 날아가면 과거 글이
  통째로 재알림된다. 선례 = `0058a_makeedu_sync_state`.
- **안전장치**: ① **콜드 스타트 = 알림 0건**(현재 최대 id만 기록 — 과거 글 폭탄 방지, §8 사고의 내부 알림판)
  ② **age 가드 3일**(연동 PC가 꺼졌다 켜져도 밀린 과거 글로 벨 도배 안 됨) ③ `--post` 게이트(dry-run 데몬은 알림 안 만듦)
  ④ 동명이인 보드는 **알림 보류**(엉뚱한 강사에게 남의 집 얘기 금지). **발송 킬스위치(`classnoteSendEnabled`)는
  따르지 않는다** — 발송이 아니라 인바운드 감지(provision-core와 같은 논리).
- ⚠️ **세션 유지가 설계의 핵심**(2026-07-15 실측 함정): 다른 코어는 "할 일이 있을 때만" 로그인하지만 피드 폴러는
  **할 일이 없어도 1분마다** 돈다. 매번 `browser.newPage()`(= 새 컨텍스트 = 쿠키 없음) + `loginClassnote`이면
  **하루 1,440회 로그인** → 봇 계정 스로틀(조사 중 반복 로그인이 실제로 ~50% 실패했다). 그래서 로그인된 페이지를
  **모듈 스코프에 유지**하고 폴마다 **same-origin fetch 1번만**(내비게이션 0), 세션이 죽으면 1회 재로그인.
  **새 폴링형 인바운드를 만들면 반드시 이 패턴을 따를 것.**
- **범위 = 수학 1인보드**(원장 결정 2026-07-15). 학부모 글 89건/3주 중 수학은 8건뿐이고 **89%가 영어/그룹반**이지만,
  영어는 강사들이 ClassNote를 실제 양방향 채널로 쓰는 중(녹음 숙제 등)이라 중복 알림 우려 + eywa 상주 여부 불확실.
  확장은 `BOARD_GROUPS.english` 추가 한 줄.
- **댓글은 범위 밖**(구조적 한계): 학부모가 기존 알림장에 **댓글**로 답하면 새 report id가 안 생겨 워터마크로
  못 잡는다(잡으려면 리포트별 `num_comments` 델타 추적 필요 — 비용 급증). 3주 표본에서 댓글 달린 글 311/3000.
  → **학부모 안내문구로 "새 글로 남겨주세요" 유도**(원장 결정).
- ⚠️⚠️ **공유 보드 게이트 필수 (2차 적대리뷰가 실증한 두 번째 오배달 경로, 2026-07-15)**: 동명이인 가드로는
  **원천적으로 못 잡는다** — 공유 보드는 ClassNote 쪽 멤버십 문제인데 eywa DB엔 보드 멤버십이 없다.
  실사례 `(수학)박서준`(초6+중3 두 가족 동거): eywa엔 "박서준"과 "박서준C"가 **다른 이름**이라 dup=1로 통과 →
  중3 가족 글이 초6 담당(이유정)에게, 진짜 담당(이성우·박민엽)에겐 0건. → 발송 워커와 **같은 순수 판정**
  [`evaluateBoardSafety`](../scripts/_classnote/board-safety.mjs)를 인바운드도 태운다(§5.5와 동일 게이트).
  실측: 수학 292개 중 **공유 보드 6개**(안은지·이재용·이재희·주준호·최성효T(6가족)·학원삼) 전부 차단 확인.
  보드 조회는 잡힌 글이 있을 때만(3주 8건이라 사실상 공짜), **조회 실패 시 fail-closed**(전건 보류·워터마크 미전진).
- ⚠️ **따라잡기는 페이지 수가 아니라 시간으로 끊는다**: "피드 ~140건/일" 추정이 **틀렸다**(실측 바쁜 날 **249~270건/일**).
  옛 500행 상한은 age 가드(3일) 안의 글을 조용히 건너뛰었다(2일 전 글이 **565번째 행**). →
  [`pageOlderThanAgeGuard`](../scripts/_classnote/parent-post-filter.mjs)로 **age 컷오프에서 중단**,
  `MAX_PAGES=10`은 백스톱으로만. 밀도는 시기마다 변하므로 **행 수로 범위를 정하지 말 것.**
- ⚠️ **동시 러너 방어**: 워터마크 읽기는 트랜잭션 밖(피드 조회가 네트워크라 락을 오래 못 쥔다) → 커밋 트랜잭션에서
  `for update`로 **다시 확인**하고, 값이 바뀌었으면 다른 러너가 처리한 것이므로 **insert 생략**(notifications엔
  유니크 제약이 없어 중복이 그대로 벨에 쌓인다). 저장은 `greatest`로 **단조증가만**(역행 = 재알림).
- **알림 링크 = ClassNote 글 주소**(원장 결정 2026-07-15): [`classnotePostUrl`](../scripts/_classnote/parent-post-filter.mjs)
  = `/service/report/{id}`(실측 확정. `/service/report/detail/{id}`는 404). 벨이 **절대 URL이면 확인 팝업**
  ("해당 글로 이동하시겠습니까?") 후 새 탭(`noopener`)으로 연다 — `router.push`는 앱 내부 경로 전용이라 외부 URL엔 안 통한다.
  ⚠️ **SPA라 어떤 경로든 HTTP 200** — URL 형식 검증은 상태코드가 아니라 **렌더된 내용**으로(1.2초만 기다려 오판한 전례).
  ⚠️ ClassNote 교사 계정이 없는 강사(예: **박민엽** — 교사 24명 명단에 없음)는 로그인 화면을 본다. 그래서
  **본문에 글 전문을 계속 싣는다**(링크는 보조, 정보 전달은 본문 책임).

### ClassNote 위생 — 교사 연결 실태 (2026-07-15 조사, 읽기 전용)

`GET /api/v1_2/centers/{c}/employments`(교사↔반 **848건 한 번에**, next 없음)로 전수 확인:
- **교사 0명인 수학 1인보드 40개** — 여기 올라온 학부모 글은 ClassNote 알림이 **아무에게도** 안 간다.
  단 그중 **재원생 36명은 위 eywa 알림이 구제**(보드 교사 연결과 무관하게 eywa 담당 강사에게 감). 나머지 4개는 테스트/잔재.
- **eywa 비활성(퇴직) 직원 11명이 보드 251건에 교사로 연결된 채 학부모 글을 계속 수신 중** —
  김화영(Alice) 58 · 이승아 41 · 권나현 39 · Gina(신명진) 23 · 강보경 23 · Ellen T 13 · Jenny T 13 · 곽민정 13 ·
  이수연(Hannah) 10 · 이희영 10 · 이지은 8. ⚠️ ClassNote 교사명↔eywa 직원은 **이름 추정 매칭**(ID 링크 없음) —
  해제 전 사람이 확인 필요.
- **eywa 기준 교사 배정 동기화 가능성**(원장 검토 지시): **추가는 API로 가능** —
  `POST /api/v1/employments/ {teacher, belong_to_class}`(빈 본문 → 400 `teacher_required`로 확인. 학생 배정
  `POST /api/v1/enrollments/`와 동일 패턴). **해제는 REST 불가** — `/api/v1/employments/{id}/`는 GET 200인데
  **DELETE만 405**, 교사 제거 라우트(`/api/v1/teachers/{id}/`·`/api/v1/centers/{c}/teachers/{id}/`)는 **부재**(404).
  = 학생 배정과 **정확히 같은 제약**(§3 "배정 해제는 UI에서만"). 해제 자동화는 DOM(Playwright)만 남는다.
  ⚠️ **선행 조건**: "eywa 기준"이 성립하려면 이름 추정이 아니라 **ID 매핑**이 필요 —
  `users.classnote_teacher_id`(센터 교사 24명, 1회 확정) 신설 후에야 안전하다.

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

## 5.5 프리플라이트 보드 안전 게이트 — 오발송 사전 차단 (2026-07-15 신설) ⚠️ 완화 금지

> **한 줄 규칙: ClassNote 실보드를 조회해 "이 보드에 이 학생 가족만 있는가"를 확인하기 전엔 절대 게시하지 않는다.**

**왜 필요한가**: ClassNote는 공개 API·고유 학생 ID가 없어 **보드명(`(과목)학생명`) 이름 매칭**으로 게시한다.
그래서 한 보드에 다른 가족이 끼어 있으면 그 학생 보고서가 남의 집에 간다. **eywa DB엔 보드 멤버십이 없어**
앱 게이트(동명이인·과목·too_old)로는 원천적으로 못 잡는다 — ClassNote를 조회할 수 있는 **워커가 유일한 차단 지점**.
(실사고 = §8 2026-07-15 박서준.)

| 구성 | 파일 | 역할 |
|---|---|---|
| **순수 판정** | [`scripts/_classnote/board-safety.mjs`](../scripts/_classnote/board-safety.mjs) | `evaluateBoardSafety({className, boards, occupants, allowlist})` → `{ok, code, reason}`. **의존성 0**(playwright import 금지 — 테스트가 끌어오면 안 됨). Vitest = `board-safety.test.mjs` |
| 발송 워커 | [`classnote-core.mjs`](../scripts/_classnote/classnote-core.mjs) `processQueueOnce` | 폴마다 1회 로그인+`fetchBoards` 캐시 → 건별 게이트(캡처 **전**) → 차단 시 `blocked_shared` |
| 반 공지 워커 | [`classnote-notice-core.mjs`](../scripts/_classnote/classnote-notice-core.mjs) `processTarget` | **같은 함수** 사용(경로 분기 방지). 공통·개인화 **둘 다** 게이트 |
| 예외 목록 | 학원설정 `report.classnoteSharedBoardAllowlist` | 워커가 `getClassnoteBoardAllowlist(sql, tenant)`로 raw SQL 직독 |
| 상시 감시 | [`scan-shared-boards.mjs`](../scripts/_classnote/scan-shared-boards.mjs) | **read-only** 전수 스캔 — 차단 대상 보드 + 연결 가족 표시 |

**판정 규칙**(`evaluateBoardSafety`):
- 보드 없음 → `no_board` 차단 · 이름 같은 보드 2+ → `dup_board` 차단
- 연결 가족(`approved_children`) **2+ 이면 차단**(`shared`) — **단 화이트리스트 등재 보드는 통과**
- 연결 가족 0·1 → 통과(0은 누수 아님)
- 차단 직전 `fetchBoardChildren`로 **실시간 재확인**(TOCTOU: 원장이 방금 정리했을 수 있음) + 사유에 연결 가족 명시

**왜 자동 판별(전화 대조)을 안 하나** — `(수학)안은지`처럼 **학생 본인+학부모가 각자 가입한 정상 2계정**이 있고,
이를 leak과 구분할 유일한 권위 신호는 **연락처**인데 ClassNote API가 전화를 안 준다(`/api/v1/children/{id}`엔
`parent.name`만, 전화 없음). 전화는 **운영관리(ERP) 화면**에서만 보인다 → **사람이 확인 → 화이트리스트**가 정답.
🔭 **v2 후보**: `GET /api/v1_2/centers/{id}/erp-children/`(존재 확인됨, 200)에 보호자·연락처가 있는 것으로 보임 —
다만 `?belong_to_class=` 필터가 안 먹고(전건 571 반환) 전화 필드 경로 미확정. 확정되면 eywa `parent_phone`/
`student_phone`과 자동 대조해 "같은 학생 다계정"을 **자동 허용**하고 화이트리스트를 최소화할 수 있다.

**fail-closed**: 로그인·보드 조회 실패로 **검증을 못 하면 보내지 않는다** — 클레임분을 즉시 `queued`로 되돌리고
그 주기를 건너뛴다(다음 폴 재시도). 킬스위치와 같은 원칙("모르면 안 보냄"). dry-run(`post=false`)은 게이트도 skip.

**`blocked_shared` 상태**(plain text 컬럼 — **마이그레이션 불필요**): 보고서 저장·`/r` 링크는 정상, ClassNote
자동 게시만 보류. 라벨 단일 소스 = [`classnoteBadge`](../src/features/onescreen/components/report-card.tsx)
("공유 보드 — 자동 발송 차단"). 큐 집계·주의목록 = [`classnote-queue.ts`](../src/features/report-admin/classnote-queue.ts)
(`blockedShared` + `needsAttention` true). **재발송 불가**(보드 정리/예외 등재가 선행돼야 무의미하지 않음) →
주의목록에서 체크박스 비활성. 사유(연결 가족 포함 한글)는 `classnote_error`에 저장돼 **그대로** 표시
(`humanizeClassnoteError` 태우면 일반 문구로 뭉개짐 — 큐 카드가 status로 분기).

**원장 조치 흐름**: 주의목록/스캔에서 차단 보드 확인 → **클래스노트 운영관리 > 학생관리**에서 그 보드 골라
연락처·보호자 대조 → ① 같은 학생의 학부모/본인 계정이면 **학원설정 > 보고서 > '공유 보드 발송 예외'**에 보드명
등재 → 자동 발송 재개. ② 남의 가족이면 **클래스노트 UI에서 연결 제거**(API는 405라 UI 전용) 후 재발송.

⚠️ **새 발송 경로를 만들면 이 게이트를 반드시 태울 것.** 보드명으로 게시하는 모든 경로가 대상이다.
⚠️ **화이트리스트는 안전 우회 장치** — 잘못 등재하면 실제로 남의 가족에게 발송된다(폼에 경고 문구 있음).

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

- **2026-07-15 공유 보드 오발송(실측)**: `(수학)박서준` 보드에 **두 가족**(초6 2014생 + 중3 2011생)이 함께
  연결돼 있어 **초6 보고서가 중3 가족에게 계속 노출**되고 있었다. 중3은 2026-07-13에 전용 보드 `(수학)박서준C`를
  받았지만 **옛 공유 보드에서 제거가 안 돼** leak이 남아 있었음(원장이 07-15 수동 제거로 정지).
  전수 스캔 결과 학생모드 공유 보드가 8개(최성효T=퇴사 강사·학원삼=테스트 제외 시 실대상 5개)였다.
  → **프리플라이트 보드 안전 게이트(§5.5)의 존재 이유.** eywa DB엔 보드 멤버십이 없어 앱 가드로는 원천적으로
  못 잡는다(동명이인 가드도 통과 — eywa엔 박서준·박서준C가 **다른 이름**이라 충돌이 아니었음).
  ⚠️ **"2가족=오발송"은 항상 참이 아니다**: `(수학)안은지`는 학생 본인 계정과 학부모(김경희) 계정이 각각
  가입한 정상 케이스(두 전화가 eywa parent_phone·student_phone과 각각 일치, 학생이 자기 생일을 다르게 입력해
  생년월일도 달랐다). 그래서 게이트는 **차단 기본 + 원장 확인 화이트리스트** 구조이고, 자동 판별을 하지 않는다.
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
