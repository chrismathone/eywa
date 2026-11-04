# ClassNote 연동 (수업보고서 발송) — 구조 · 운영 · 트러블슈팅

> 수업보고서(lesson_reports)를 학부모 앱 **ClassNote**(클래스노트, 키즈노트/카카오 계열)로 발송하는
> 전체 파이프라인의 단일 참조 문서. 2026-07-10 멀티에이전트 코드 전수 분석 + 실브라우저(기관설정 포함)
> 탐사 + 실발송 E2E로 검증된 내용. 코드를 만지기 전 이 문서를 먼저 읽을 것.
>
> ⚠️ **영어는 이 문서의 1인 보드 레일을 쓰지 않는다.** 영어 배달은 **그룹 반 보드에 학생별 게시**로 확정됐고
> (`(영어)학생명` 1인 보드 229개는 게시 0·교사 0인 죽은 보드), 보고서 내용은 **ECS 파생**이다.
> 설계·착수 트리거·P0 목록 = [`english-report-plan.md`](english-report-plan.md). **영어 발송을 만지기 전 그 문서를 먼저 읽을 것.**
> **2026-10-29 구현**: 워커가 영어 보고서를 반 방으로 보낸다 — 연결 = s2_0006 `classnote_english_class_boards`(사람이 확인) ·
> 받는 원아 = 확정 원아(0185a) ∩ 지금 그 방 · 연결 없는 반은 아직 1인 보드([`english-class-route.mjs`](../scripts/_classnote/english-class-route.mjs) · 짝 제안 [`link-english-class-boards.mjs`](../scripts/_classnote/link-english-class-boards.mjs)).

---

## 수업보고서 화면의 클래스노트 묶음 (2026-10-06)

수업보고서의 **클래스노트** 상위 탭 안에 **발송 큐 · 반 구성 · 반 공지 · 직접 발송 · 회수 · 학부모 글·답글**을 모았다.
새 주소는 `/lesson-reports?tab=classnote&section=queue` 형식이다. 기존 `?tab=queue` 등 알림·즐겨찾기 주소도 같은 하위 화면을 연다.
읽기 전용 계정에는 앞의 세 조회 화면만 표시하며, 학부모 글·답글은 기존 답글 모드가 켜진 경우에만 표시한다.

학원 설정 → 기능 → **클래스노트**에서 기존 `classnote` 모듈을 끄면 이 묶음이 사라진다. 직접 주소는 작성률로 돌아가며,
관련 조회·서버 작업도 모듈 설정을 확인한다. 다시 켜면 기존 자료가 그대로 표시된다. 실제 발송 스위치와 답글의 끔·시험·전체 모드는 별도로 유지한다.
이 화면 변경은 이미 접수된 워커 작업을 취소하는 기능이 아니다. 회수 워커의 기존 긴급 처리 규칙도 바꾸지 않았다.
SQL 적용이나 발송 PC 교체는 필요 없다. [검수 기록과 화면 증거](_audit/classnote-group-video-popup-2026-10-06.md)를 참고한다.

## 1. 한눈에 보는 파이프라인

```
[강사 /onescreen "ClassNote 발송"]──┐        (5중 게이트: 스위치·과목·**결석**·too_old·동명이인)
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

## 1.5 발송 이력 — `lesson_report_send_events` (0392a · 2026-10-22)

원장 *"기록이 빠질 수 있는 곳은 보완해야겠네"*. 보고서 행에는 **마지막** 발송 상태·시각 한 벌만 남는다 — 재발송이 `classnote_sent_at`을 덮고,
첨부 변경(`CLASSNOTE_RESET`)·공유 링크 재발급·회수 뒤 재발송이 발송 표시를 null로 지우며, 활동 로그는 `classnote_*` 칸을 noise로 뺀다.
그래서 **발송 상태가 바뀔 때마다 DB 트리거가 한 줄**을 남기는 추가만 하는 표를 두었다.

- **무엇이**: `requested`(발송 요청 — 대기 중 다시 누른 것도) · `claimed`(연동 PC가 집음 = 캡처 직전) · `retry`(연동 PC 재시도) ·
  `sent`(게시 성공 — 발송 시각이 새로 찍힐 때만) · `failed` · `held`(too_old·name_conflict·blocked_shared) · `recall_requested` · `recalled` · `recall_failed` ·
  `cleared`(표시 지움 — **지워지기 직전**의 발송 시각·공유 토큰·내용) · `deleted`(발송 흔적이 있는 보고서 삭제). 회수 워커가 집는 순간(`recalling`)은 남기지 않는다.
  같은 자리를 도는 반복(비상 정지·시험 모드가 15초마다 집었다 놓는 것)은 처음 한 번만 남긴다 — 로그인 사용자가 하지 않았고, 집은 지 2분 안에 같은 사유로
  되돌린 retry · 10분 안에 같은 사본으로 다시 집은 claimed만. 멈춤 복구(오래 쥐고 있다 되돌림)·사람이 한 일은 늘 남긴다.
- **몇 번 나갔나** = `sent` 줄 + `sent_at`이 찍힌 `failed` 줄(게시 뒤 교차 확인 이상으로 실패 처리한 것). ⚠️ '일부 계정에만 게시'·'게시 응답 없음' 실패는
  나갔을 수도 있다(`sent_at` 없음 — `error` 문구로 가른다). 실패 줄은 행에 남은 옛 발송 시각을 물려받지 않는다.
- **사본(snapshot)**: 학부모 카드 칸(교재·진도·오늘 과제·일일/확인테스트·exam_info·지난 과제 수행률·수업 태도·멘트·학습 추세·첨부 목록·공유 토큰·
  영상 숙제 칸·담임 표기) + 학생 이름·학교·학년 + 반 이름 + 카드 표시 설정(`show*`·제목·수학 발송 경로). `sent`·`failed`는 **그 회차에 연동 PC가 집은 순간**의 사본
  (캡처 수 초~수 분 전 — 게시하는 동안 고친 내용은 섞이지 않는다. 한 번에 2건을 집어 둘째 건은 첫째 건 게시 뒤 캡처하므로 그 사이 고친 내용은 캡처엔 있고
  사본엔 없을 수 있다 · 집은 줄이 없으면 그 순간의 행), `cleared`·`deleted`는 지우기 직전. `snapshot_at` = 사본을 뜬 시각.
- **누가**: `actor_id` = 그 변화를 일으킨 로그인 사용자(연동 PC·관리 키 경로는 비어 있다) · `db_role` = 그 쓰기의 DB 역할(`eywa_sync_agent` = 연동 PC ·
  `authenticated` = 로그인 화면 · `service_role` = 관리 키 · 그 밖 = SQL 직접) · `sent`·`failed` 줄의 `requested_by` = 가장 최근 발송 요청자.
  ⚠️ 지점 직원은 지금도 PostgREST로 보고서 행의 발송 상태를 직접 고칠 수 있다(지점 격리 정책뿐) — 그런 줄은 `db_role = authenticated`로 가린다.
- **쓰는 곳 = 트리거뿐**(`lesson_report_send_private.capture`) — 상태를 바꾸는 길이 여럿(원스크린·관리자 재발송·직접 작성·멈춤 복구·연동 PC)이라 앱 한 곳에서
  쓰면 빠진다. 연동 앱(AywaSync)을 고칠 필요가 없다. 🔴 **기록이 실패해도 발송 상태 저장은 막지 않는다**(막으면 연동 PC가 게시 뒤 success를 못 써서 같은 글을
  다시 올린다) — 사본을 못 뜨면 사본 없이 한 줄(`note`에 사유), 그것도 못 하면 DB 경고. 빠진 줄은 0392b를 다시 돌려 메운다.
- **지울 수 없다**: 앱 역할 표·시퀀스 권한 0 · service_role 읽기만 · 행 보호 트리거가 수정·삭제 거절(지점째 지울 때만 통과). 보고서·학생·사용자 id에 외래키가 없어 그쪽이 지워져도
  남는다(학생 삭제의 연쇄로 지워진 보고서의 `deleted` 사본엔 학생 이름이 없다 — 앞선 줄에는 있다).
- **읽기 = 서버 전용**(정책 0개): 화면을 붙일 땐 앱이 사람을 확인한 뒤 관리 키로 `tenant_id`를 걸고 `report_id`로 `at, id` 순으로 읽는다(사용자 클라이언트로 읽으면 0행 — #104).
- **백필(0392b)**: 보고서 행에 남은 마지막 발송 시각(2026-10-22 드라이런 침산 17,695 — 그중 에듀트릭스 이관 12,697 · 데모 6), 2026-09-10부터의 발송 요청 감사로그(2,193줄), 트리거가 지움만
  남긴 옛 발송. 백필 줄의 사본은 **백필한 날의 내용**이다(note에 적음 · 카드 설정은 싣지 않음). 드라이런 = `scripts/_oneoff/lesson-report-send-events-backfill-dry-run.sql`.
- **아직 없는 것**: 실제로 게시한 ClassNote 보드 id(연동 PC가 행에 적지 않는다 — 보낼 반·반·보강 반 id만 남는다) · 학부모가 받은 **카드 이미지**(연동 PC가 캡처한
  JPEG를 Storage에 보관하려면 AywaSync 새 버전이 필요) · **첨부 파일 자체**(사본은 경로 목록뿐 — 첨부를 바꾸면 파일이 지워질 수 있다) · 게시 글의 영상 줄·발송용 작성자 이름 ·
  성적 추이 그래프·영어 동결본(JJ)(다른 표에서 그려진다).

## 2. 구성요소 파일 맵

| 층 | 파일 | 역할 |
|---|---|---|
| 강사 발송 | [features/onescreen/server/actions.ts](../src/features/onescreen/server/actions.ts) `saveAndQueueClassnote` | 저장+큐잉. 게이트 4종 통과분만 queued |
| 원장 관리 | [features/report-admin/server/actions.ts](../src/features/report-admin/server/actions.ts) `retryClassnote`/`resetStuckClassnote` | 재발송(날짜·과목 재검증)·멈춤복구(processing 10분+ → queued) |
| 큐 뷰 | [features/report-admin/server/queries.ts](../src/features/report-admin/server/queries.ts) `getClassnoteQueue` | 최근 3일 집계 + 주의목록 + 워커 온라인(3분 무응답=오프라인) |
| 순수 로직 | [features/report-admin/classnote-queue.ts](../src/features/report-admin/classnote-queue.ts) · [features/onescreen/classnote-guard.ts](../src/features/onescreen/classnote-guard.ts) | 멈춤 판정(10분)·too_old 가드(전 달 1일, KST)·과목 opt-in |
| 동명이인 | [features/onescreen/server/scope.ts](../src/features/onescreen/server/scope.ts) `hasClassnoteNameCollision` | 유효이름(classnote_name‖name) 중복 감지 → 자동 발송 차단 |
| **결석 게이트(#77, 2026-07-19)** | [features/onescreen/absence-gate.ts](../src/features/onescreen/absence-gate.ts)(순수·Vitest) + [server/absence-gate.ts](../src/features/onescreen/server/absence-gate.ts) | 그날 그 과목 유효 출결이 전부 absent/excused면 저장만·큐잉 차단(`status:"absent"`). 발송·재발송·콘솔·대량·unsent 재촉 이벤트 **6경로 공용**. 보강(makeup)은 제외, 조회 실패 fail-closed. ⚠️ 큐잉 시점 판정 — queued 재고 미소급(재발송 시도 시엔 회수) |
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
  → aywa `students.classnote_name` 오버라이드는 **실보드 접미사와 정확히 일치**시켜야 한다
  (예: "박서연C"). 0088a 문서의 "김서윤(중2)" 예시는 ClassNote 실관례와 다르니 따라 쓰지 말 것.
- 함수의 반 매칭 = **공백 제거 후 정확 일치**(타깃이 10자 초과일 때만 부분포함 허용) — 접미사가 다르면 못 찾는다.
- **신규생 보드 자동 생성은 발송 봇에는 없다** — 단 Edutrix repo에 **생성·배정 자동화 스크립트 3종이 실존**(아래
  "왜 학생 1명=반 1개인가" 절 참조). aywa 이식 시 신규생 보드 프로비저닝 자동화 가능.
- **발송 성공 ≠ 학부모 수신**: 학부모 미연결(미초대·미승인) 학생은 게시물을 못 본다.
  승인 완료 468 vs aywa 재원 ~527 = 커버리지 갭 존재.

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

### 반 생성·배정 자동화 — ✅ aywa 이식 완료 (2026-07-10, scripts/_classnote/)

Edutrix 원본(D:\edutrix\scripts\ 3종: create_classnote_classes / assign_student_to_individual_class /
assign_teacher_to_classnote)을 aywa DB 기준·Playwright·**dry-run 기본**으로 이식. 공용 헬퍼 =
[`classnote-admin-core.mjs`](../scripts/_classnote/classnote-admin-core.mjs)(로그인·호칭 다이얼로그·무한스크롤 수집).

| aywa 스크립트 | 역할 | 실행 |
|---|---|---|
| ~~`provision-classnote-boards.mjs` · `assign-classnote-students.mjs`~~ | 🔴 **지움(2026-11-04 · AywaSync 1.0.14)** — 1인 보드를 만들고 원아를 배정하던 수동 도구. 원장 *"앞으로 1인보드에 배정 시키지마 절대"* | — |
| (미이식) 강사 배정 | Edutrix `assign_teacher_to_classnote.js` — 강사 게시 알림용, 발송 필수 아님 | 필요 시 후속 |

- **판독=내부 API(2026-07-13 전환)**: 반 정보 관리 화면 무한스크롤 스크래핑은 비결정(수집 누락→기존 보드를
  "누락" 오판. 단 ClassNote가 중복 반명을 거부해 중복 생성은 안 됨 — 백스톱 실측). →
  `GET /api/v1/centers/{id}/classes`(전 보드+`approved_children` 배정 인원)·`/children`(가입 원아)로 교체.
  **읽기=API(결정적) / 쓰기=DOM(반 추가하기)** 구조. center id는 `/api/v1/me/info`.
- **파이프라인**: ①빈 반 생성(자동, 가입 전 가능) → ②학부모 초대(전화번호를 반에 초대 — **자동화 안 함**,
  외부 발신이라 수동) → ③가입·승인(학부모 액션, "[ALL] 회원가입 후 반배정 필요") → ④학생→개별반 배정(자동).
  🔴 2026-11-02~ 수학이 반별(class)이면 ①·④의 `(수학)이름` 1인 보드는 만들지도 배정하지도 않는다 — 학부모가 가입하면 원아 연결(0185a)이
  생기고 **반 보드 동기화가 그 원아를 수학 반 보드에 바로 넣는다**(§10.5-a · 낮에 가입하면 지금 동기화가 그 자리에서). 영어 `(영어)`는 그대로. → 🔴 **2026-11-04부터 영어도 ①·④를 하지 않는다**(원장 *"앞으로 1인보드에 배정 시키지마 절대"* · AywaSync 1.0.14) — ②의 학부모 초대도 **반 보드·반 방**으로 한다(1인 보드로 초대하지 않는다).
- **✅ 2026-07-13 수학 보드 34개 생성 완료**(원장 승인, 카나리 1→33 일괄, 실패 0, API 재조회 검증 —
  기존 보드·멤버·게시물 무변경, aywa DB 쓰기 0). 직후 전수 판정(재원 237명): **assigned 196 ·
  ready 7**(김서윤·도성훈·주준호·유호성·윤규원·최현성·박소령 — 가입돼 있어 `--apply`만 남음) ·
  **미가입(초대 필요) 33** · **매핑 대기 1**(`(수학)박서준C`→실보드 `박서준`, `classnote_name` 지정).
  ⚠️ `--apply`(생성·배정)는 실 ClassNote 변경 — 원장 승인 후 실행.
- 🔴 **1인 보드 준비 없앰(2026-11-04 · AywaSync 1.0.14)** — 원장 *"앞으로 1인보드에 배정 시키지마 절대"*. 05시 준비 · 지금 동기화의 신입 준비 · 수동 도구 둘을 모두 지웠다(`(수학)`·`(영어)` 1인 보드를 만들지도, 원아를 배정하지도 않는다 · 반 보드 적용도 1인 보드 꼴 이름은 건너뛴다 · 가드 [`no-personal-board-writes.test.mjs`](../scripts/_classnote/no-personal-board-writes.test.mjs)). 신입의 첫 배정 출처 = 원아 연결(0185a) → 수학 반 보드(자동 · 영어 반 방 배정은 ClassNote에서 사람이 한다 — aywa는 반 방에 원아를 넣지 않는다). 🔴 반 방이 연결 안 된 영어 반의 신입은 보낼 곳이 없다(발송이 막힌다 · 영어 개별 공지·교재요청서는 아직 반 방 경로가 없어 1인 보드가 없는 신입에게 못 보낸다 — 원장 결정 거리) — 그 반을 반 방에 연결할 것(11-04 기준 6반 27명 · 최근 7일 영어 발송 60건은 모두 연결된 반). 남아 있던 수학 1인 보드 원아 14명(16개)도 같은 날 해제(반 보드 ok + 원아 연결 확인 뒤 · 시험 보드만 남음).
- ~~**신규생 운영 = ✅ 일일 자동(2026-07-13)**~~(2026-11-04 없앰 — 바로 위 · 아래는 그 전 기록): 발송 데몬이 **매일 KST 05시 이후 1회**
  `provisionDailyOnce`(옛 `classnote-provision-core.mjs` — 지움) 실행 — 보드 없는 재원생(발송
  opt-in 과목) 보드 자동 생성 + 가입됐는데 보드 빈 학생 자동 배정. 동명이인(학생·원아)은 자동 보류(로그).
  --post 데몬에서만, 발송 스위치와 무관(인프라 준비). 마커=`CLASSNOTE_OUT/provision-last-run.txt`(멱등).
  🔴 **2026-11-02~ 수학 발송 경로가 반별(class)이면 수학은 하지 않는다**(`(수학)이름` 보드 생성·원아 배정 모두 — 원장 A안,
  1인 보드 원아 해제 · 12월 삭제. 원아 신분은 반 보드 동기화가 확인 기록 + 원아 연결로 판정 — §10.5-a). 영어 `(영어)`는 그대로.
  수동 실행판(위 두 스크립트)은 점검·복구용으로 유지.
- **학부모 가입만은 자동화 불가**(학생 엔티티가 학부모 연결로 생기는 ClassNote 구조 제약).
- **✅ 후속(2026-07-13)**: 배정도 내부 API로 전환 — `POST /api/v1/enrollments/ {child, belong_to_class}`
  (201 즉시 승인, 원아 ID 기반=동명이인 안전). 실배정 9건 완료(ready 6 + 주준호 부모계정 2 + 박서준C 자녀)
  → **배정 204 / 미가입 33 / 잔여 0**. ⚠️ 배정 해제(제거)는 REST 전부 405 — ClassNote UI에서만.
  ⚠️ **박서준 공유보드 잔여 이슈**: `(수학)박서준`에 두 가족(2014년생 초6 + 2011년생 중3)이 함께 연결돼
  있던 것을 발견(Edutrix 시절부터 상호 성적 노출). 중3 자녀는 신설 `(수학)박서준C`로 분리 배정 완료했으나
  **공유보드에서의 제거는 미실시**(과거 게시물 열람 단절 우려 — 원장 결정 대기, 제거는 UI 수동).

### 반 공지 — aywa 반에서 골라 학생별 보드로 일괄 게시 (✅ 2026-07-13 구현·E2E)

수업보고서 > **반 공지** 탭: 반(발송 opt-in 과목의 활성 반) 다중 선택 + 본문 → 각 재원생의 개별 보드로
같은 내용 게시. **반 구조는 aywa에 살고 ClassNote 1인 1반은 배달 레일**(Edutrix NoticeWriteModal 패턴 계승).

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

### 학부모 **새 글** → 담당 강사 aywa 인앱 알림 (✅ 2026-07-15 구현 · 인바운드 · 읽기 전용)

지금까지의 ClassNote 연동은 전부 **아웃바운드**(우리가 게시)였다. 이건 유일한 **인바운드** — 학부모가 보드에
올린 글을 감지해 그 학생 담당 강사의 aywa **알림 벨**에 띄운다. **ClassNote에 아무것도 쓰지 않는다**(구조상
학부모에게 나가는 경로 자체가 없음 = 오발송 리스크 0).

- **왜 필요한가(실측이 뒤집은 전제)**: ClassNote는 반 연결 교사에게 **자체 알림을 이미 보낸다** — "1인 보드엔
  교사가 없어 글이 묻힌다"는 가설은 **틀렸다**(수학 1인보드 292개 중 252개에 실제 수학 강사 연결됨).
  진짜 문제는 **강사별 편차**: 3주 표본에서 수학 학부모 글 8건 중 수진T(이수진) 담당은 **5/5 응답**,
  김윤하 담당은 **0/2 무응답**. 무응답 1건("감기때문에 하루 쉬겠습니다")은 보드에 **퇴직 강사(김화영)** 가
  연결돼 있었다. → 강사가 **매일 보는 화면(aywa)** 에 띄우는 게 답이고, **aywa 매핑이 ClassNote 보드 연결보다
  정확**하다(퇴직자 배제 + 현직 담당 전원). 이 기능을 "묻힌 글 구제"로 설명하지 말 것 — 정확히는 **"안 보는 강사에게도 도달"**.
- **매핑은 보드명 기준**(⚠️ child_name 쓰지 말 것): 피드 행의 `child_name`은 **학부모가 등록한 원아명**이라
  제멋대로다(실측: 보드 `(수학)박서연E`의 원아명이 그냥 "서연"). 보드명은 우리가 **aywa 유효이름**으로 만든 것이라
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
  **받는 사람(2026-09-30 원장 정정)** = 그 학생의 **현재 담당 선생님** — 오늘 다니는 보드 과목 반의 담임·오늘 유효한 교시 담당·오늘 위임
  ([`notify-recipients.mjs`](../scripts/_classnote/notify-recipients.mjs)). 가르친 적 있는 강사로 넓히지 않는다. 최종 수신자는 **다른 SQL로 재검증**
  ([`notify-recipients-db.mjs`](../scripts/_classnote/notify-recipients-db.mjs)) · 5명 초과면 담임만 · 계산 실패면 담임만 · 가드별 막은 건수는
  워커 결과 요약(`last_results.posts/comments`의 `g*`). 규칙·가드 8겹 = decisions/reports-ai.md.
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
  영어는 강사들이 ClassNote를 실제 양방향 채널로 쓰는 중(녹음 숙제 등)이라 중복 알림 우려 + aywa 상주 여부 불확실.
  확장은 `BOARD_GROUPS.english` 추가 한 줄.
- ~~**댓글은 범위 밖**~~ → **✅ 2026-07-16 구현**(아래 별 절). 당시 "비용 급증"이라 미뤘으나 실측해보니
  `num_comments`가 **피드 행에 이미 있어** 델타 감지에 추가 요청이 **0**이었다 — 판단이 틀렸다. 게다가 학부모
  연락의 **다수가 댓글**로 온다(댓글 12건/일 vs 새 글 4.2건/일). 안내문구 유도는 폐기.
- ⚠️⚠️ **공유 보드 게이트 필수 (2차 적대리뷰가 실증한 두 번째 오배달 경로, 2026-07-15)**: 동명이인 가드로는
  **원천적으로 못 잡는다** — 공유 보드는 ClassNote 쪽 멤버십 문제인데 aywa DB엔 보드 멤버십이 없다.
  실사례 `(수학)박서준`(초6+중3 두 가족 동거): aywa엔 "박서준"과 "박서준C"가 **다른 이름**이라 dup=1로 통과 →
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

### 학부모 **댓글** → 담당 강사 aywa 인앱 알림 (✅ 2026-07-16 구현 · 인바운드 · 읽기 전용)

위 "새 글" 알림의 자매 기능. **같은 워커·같은 보드 게이트·같은 알림 벨**을 쓰되 감지 방식만 다르다.
마이그 = **0111a**(`classnote_feed_state`에 `counts jsonb` 컬럼 추가). 순수 로직 =
[parent-comment-filter.mjs](../scripts/_classnote/parent-comment-filter.mjs)(Vitest 21). 폴러 =
[`pollParentCommentsOnce`](../scripts/_classnote/classnote-feed-core.mjs). 수동 1회 =
[`process-parent-comments.mjs`](../scripts/_classnote/process-parent-comments.mjs).

- **왜 뒤집었나(실측)**: "새 글"만으로는 학부모 연락의 소수만 잡힌다. ClassNote의 자연스러운 흐름이
  **"강사가 알림장 → 학부모가 댓글로 답"** 이라 **댓글이 12건/일 vs 새 글 4.2건/일**. 실제 내용도
  결석·보강일정·입금확인·강의실 문의 등 조치가 필요한 것들이다("준호가 7/19~8/8 영어캠프로 학원부재",
  "상담 요청 드립니다 전화주세요").
- **감지 = `num_comments` 스냅샷 대조**(워터마크 불가): 댓글은 전용 피드가 없다(실측 `centers/{c}/comments/`,
  `reports/comments/`, `feeds/` 전부 404, `activities/`는 200이나 **항상 빈 배열**). 유일한 신호가 **피드 행의
  `num_comments`가 늘어나는 것**이라 "글마다 댓글 몇 개였나"를 통째로 들고 있어야(0111a `counts` jsonb) 변화를
  짚는다. ⚠️ 델타 감지에 **추가 요청 0**(num_comments가 피드 행에 이미 있음) — 늘어난 글만 댓글 API를 연다(~12~24회/일).
- ⚠️ **API가 댓글을 id 내림차순(최신 먼저)으로 준다** — asc로 다시 정렬해 앞의 `knownCount`개를 건너뛴다.
  순서를 착각하면 "최신을 이미 아는 것"으로 오판해 새 댓글을 놓친다([`selectNewComments`](../scripts/_classnote/parent-comment-filter.mjs),
  회귀 테스트가 실제 내림차순 응답으로 고정). **강사 답글도 num_comments를 올리므로** `author.type==="parent"`로 거른다.
- ⚠️ **창은 깊어야 한다(직관 반대, 실측이 뒤집음)**: 학부모는 알림장에 *답*하는 게 아니라 **자기 아이 보드 맨 위에
  보이는 글에 그냥 말을 건다** → 지연이 "응답 속도"가 아니라 **"그 아이 알림장이 얼마나 뜸한가"** 다. 보고서가
  뜸한 보드일수록 **오래된 글에 급한 용건**이 달린다(가장 늦은 두 건 169.6h·209.9h가 둘 다 급건 = 결석·상담요청).
  수학 댓글 54건: 3일 93%·4일 96%. → **감시 창 10일**(`COMMENT_WINDOW_DAYS`). "늦게 달린 건 인사겠지"는 **틀린 가설**.
- **창 밖 글(30일까지)·방금 올라온 글 = 알림 목록 신호**(2026-10-02, [parent-comment-events.mjs](../scripts/_classnote/parent-comment-events.mjs)):
  위 "전용 피드가 없다"는 **글·댓글 주소**에 한한 얘기였다. 학원 계정의 **알림 목록** `GET /api/v1/me/notifications/?page_size=100`
  (다음 쪽 = `page=<next 토큰>`)에는 전 보드의 댓글 알림이 온다 — 줄 모양 `{id, created, code, summary, author_name, cls_id, child:{id,name}, object_id, count}`,
  `code` = `report_comment`(알림장 댓글, `object_id` = 글 번호) · `notice_comment`(공지사항 댓글, `object_id` = 공지 번호 · `cls_id`·`child` 없음) ·
  `report`(새 글, 전체의 ~90%) · `child_requested` · `notice`. 실측(이틀치 600줄): 전 종류 합쳐 하루 ~300줄.
  ⚠️ **글 하나에 댓글 알림은 한 줄**이다 — 새 댓글이 달리면 그 줄이 `count`를 올리고 **새 번호로 맨 위에** 선다(`summary`·`author_name`은 마지막 댓글 것).
  그래서 줄의 내용은 믿지 않고 **"그 글에 새 댓글이 있다"는 신호**로만 쓴 뒤 댓글 목록을 다시 연다. 알림 시각은 댓글 시각보다 십여 초 늦을 수 있다(실측 11~12초).
  ⚠️ 작성자 종류가 없다(`author_name` 글자뿐) — 학부모 여부는 댓글 목록의 `author.type`으로 본다. 학원 계정이 직접 단 댓글은 알림이 오지 않는다.
  글 하나 조회 = `GET /api/v1/reports/{id}/`(피드 행과 같은 칸 + `modified` = 마지막 댓글 시각). 공지 댓글 = `GET /api/v1/notices/{id}/comments/`(작성자 `author.id` = 학부모 계정).
- **주기 10분**(`COMMENT_POLL_INTERVAL_MS` — 원장이 명시 수용한 지연). 새 글(1분)보다 느린 이유 = 창 전체를 매번
  다시 읽어야 한다(워터마크로 일찍 못 멈춤). ⚠️ **백스톱(`COMMENT_MAX_PAGES=30`)은 창(10일)보다 넉넉히 커야**
  age 컷오프가 먼저 걸린다 — 방학 피크엔 최근 10일=1,913행=20페이지라, 20으로 잡으면 창과 겹쳐 매 폴 경고가 뜬다.
- **콜드 스타트 = 알림 0건**: 처음 보는 글은 댓글 수 **기준선만** 잡고 안 알린다(그 기존 댓글은 우리 켜기 전 것).
  전건 미확인(피드 수 ≠ 응답 수)·삭제로 수 감소도 **추측하지 않고** self-correcting(순수 모듈 주석·테스트 참조).
- **게이트 공유**: 공유보드·동명이인 매핑(§5.5) 판정을 새 글 폴러와 **같은 함수**(`loadGateInputs`+`gateBoard`)로
  탄다 — 한쪽만 취약해지는 구조를 원천 차단. 조회 실패 시 fail-closed(전건 보류·스냅샷 미갱신).
- **알림 = 벨 배지만**(중앙 팝업/OS 알림 **제외**, [important.ts](../src/features/notifications/important.ts)): 댓글은
  하루 ~12건에 **표본 절반이 "감사합니다 ⭐️" 류 인사**라 중앙 팝업하면 경보 피로 → 새 글 팝업까지 무시된다.
  벨은 본문이 그대로 보여 1초면 넘긴다. ⚠️ **소음도를 실제로 본 뒤 조정**(원장 결정 2026-07-16) — 지금은 전부
  벨에, 인사성 거르기는 나중에 필요하면. 타입 = `classnote_parent_comment`(벨 아이콘 `message`, 링크는 새 글과 동일).

### ClassNote 위생 — 교사 연결 실태 (2026-07-15 조사, 읽기 전용)

`GET /api/v1_2/centers/{c}/employments`(교사↔반 **848건 한 번에**, next 없음)로 전수 확인:
- **교사 0명인 수학 1인보드 40개** — 여기 올라온 학부모 글은 ClassNote 알림이 **아무에게도** 안 간다.
  단 그중 **재원생 36명은 위 aywa 알림이 구제**(보드 교사 연결과 무관하게 aywa 담당 강사에게 감). 나머지 4개는 테스트/잔재.
- **aywa 비활성(퇴직) 직원 11명이 보드 251건에 교사로 연결된 채 학부모 글을 계속 수신 중** —
  김화영(Alice) 58 · 이승아 41 · 권나현 39 · Gina(신명진) 23 · 강보경 23 · Ellen T 13 · Jenny T 13 · 곽민정 13 ·
  이수연(Hannah) 10 · 이희영 10 · 이지은 8. ⚠️ ClassNote 교사명↔aywa 직원은 **이름 추정 매칭**(ID 링크 없음) —
  해제 전 사람이 확인 필요.
- **aywa 기준 교사 배정 동기화 가능성**(원장 검토 지시): **추가는 API로 가능** —
  `POST /api/v1/employments/ {teacher, **class_in_charge**}`.
  🔴 **필드는 `class_in_charge`다**(2026-09-02 실측으로 정정). 여기 오래 적혀 있던 `belong_to_class`는
  학생 배정(`enrollments`)의 필드를 미검증으로 옮겨 적은 것이고 **HTTP 500**을 낸다:
  `{}`→400 `teacher_required` · `{teacher}`→**500** · `{teacher, belong_to_class}`→**500** ·
  `{teacher, class_in_charge}`→**201**(응답이 그대로 employments 행). 500은 본문이 비어 있어
  "서버 장애"로 오인하기 쉽다 — 필드 이름 문제다.
  ⚠️ 교사 프로필 화면(`/service/setting/teacher/{id}`)이 쓰는
  `POST /v1_2/teachers/{id}/employments {teacher, class_in_charge:[...]}`는 **배열을 통째로** 보내는 모양이라
  그 교사의 다른 보드를 지울 수 있다 — 한 건 추가에는 쓰지 말 것. **해제는 REST 불가** — `/api/v1/employments/{id}/`는 GET 200인데
  **DELETE만 405**, 교사 제거 라우트(`/api/v1/teachers/{id}/`·`/api/v1/centers/{c}/teachers/{id}/`)는 **부재**(404).
  = 학생 배정과 **정확히 같은 제약**(§3 "배정 해제는 UI에서만"). 해제 자동화는 DOM(Playwright)만 남는다.
  ⚠️ **선행 조건**: "aywa 기준"이 성립하려면 이름 추정이 아니라 **ID 매핑**이 필요 —
  `users.classnote_teacher_id`(센터 교사 24명, 1회 확정) 신설 후에야 안전하다.

### ✅ 실행 기록 — 테스트 보드 `(수학)학원이`에 **교사 전원 연결** (2026-09-02)

원장 지시: *"학원이는 배정 제외하고 classnote에 전부 배정해야돼 … 테스트 공지 등을 확인하기 위해서
classnote상에서 학원이를 모든 선생님에게 배정하라는 뜻이였음."* (전날 aywa 반 배정으로 잘못 읽었던 것을 정정 —
aywa 쪽 특례는 같은 날 전부 걷어냈다.)

- 스크립트 = [`assign-hakwoni-teachers.mjs`](../scripts/_classnote/assign-hakwoni-teachers.mjs)(드라이런 기본 ·
  `--canary` 1명 먼저 · 매 실행 뒤 재조회 검증) + 조사 [`survey-hakwoni-teachers.mjs`](../scripts/_classnote/survey-hakwoni-teachers.mjs)(GET only).
- 결과: 보드 `(수학)학원이`(id 1291581) 교사 **1명 → 18명**. 🔑 검증은 "붙었나"만 보지 않고 **각 교사의
  보드 수가 줄지 않았는지**까지 봤다(전원 정확히 +1 — 배열 교체형 API였다면 여기서 드러난다).
- ⚠️ 이름이 `.`인 계정(teacher 1763863, 가입 잔재)은 **일부러 제외**했다 — 사람이 아니라 테스트 대상이 아니다.
  → 2026-09-11 확인: 이 계정은 이제 이름이 **`Daniella`**다(사람이 들어와 이름을 채웠다). `(영어)학원이`에는 넣었고,
  `(수학)학원이`에는 아직 없다(필요하면 그때 한 명만 더한다).
- ~~`(영어)학원이` 보드는 **더 이상 없다**~~ → **2026-09-11 다시 만들었다**(아래 실행 기록).
- 🔴 **되돌리기는 ClassNote UI 수동뿐**이다(해제 REST 없음). 사람이 바뀌어도 이 보드는 그대로 두는 것이 기본.

### ✅ 실행 기록 — 영어 테스트 보드 `(영어)학원이`·`(영어)학원삼` 재생성 (2026-09-11)

사용자 지시: *"영어 학원이 학원삼 추가해줘"* — 영어 수업보고서를 ClassNote로 시험 발송할 자리. 수학 보드와 **같은 모양**으로 만들었다.

| 보드 | id | 원아(= `(수학)` 보드와 같게) | 교사 |
|---|---|---|---|
| `(영어)학원이` | 1315388 | 학원이(child 5268389) | **센터 교사 18명 전원**(Daniella 포함 — 위 결정 로그 "전원 연결") |
| `(영어)학원삼` | 1315389 | 학원삼(5287888) + 학원이(5268389) — 2계정 공유 보드 시험용 | 없음(`(수학)학원삼`도 0명) |

- 순서 = 반 생성(UI) → `POST /api/v1/enrollments/` 3건 → `POST /api/v1/employments/` 카나리 1명(Anna 8→9) → 나머지 17명.
  검증 = 교사마다 보드 수 **정확히 +1**(센터 전체 연결 990 → 1008, 전원 승인) · 두 보드 원아 재조회 일치.
- 🔑 **반 생성 API를 확인했다**(그동안 "생성만은 API 미확인이라 DOM"): UI의 '반 추가하기'가 실제로 보내는 요청은
  `POST https://kapi.classnote.com/v1/centers/{center}/classes` · 본문 `{"name":"(영어)학원이"}` → **201**
  `{id, name, approved_teachers, waiting_teachers, approved_children, waiting_children}`. 호스트가 **`kapi.`**(www 아님)다.
  아직 스크립트는 DOM 경로(`createBoard`) 그대로 — API로 옮기려면 인증 방식(쿠키/토큰)을 먼저 확인할 것.
- ⚠️ 영어 발송을 켤 때: 테스트 학생 `학원이`는 생일이 실제와 달라 **안전 가드 예외 등재**가 필요하고(아래 §안전 가드),
  `(영어)학원삼`은 2계정 보드라 **공유 보드 게이트에 걸리는 것이 정상**이다(그걸 시험하려고 만든 보드).

⚠️ v1_2 `employments`는 **DRF가 아니라 평배열**이다(실측 975건, 239KB) — `fetchAllDrf`로 읽으면 `.results`가
없어 **조용히 0건**이 된다(처음 조사에서 실제로 그렇게 오판했다). 교사 목록 `/api/v1_2/centers/{c}/teachers`는 DRF다.

### 수학 반별 발송의 '보낼 반' 규칙 (2026-09-30 원장)

ClassNote 모듈이 켜져 있고 보고서 설정 '수학 발송 경로'가 반별(또는 시범 강사)일 때만 적용된다. 판정 = `classRouteActive`.
모듈이 꺼진 학원은 아래가 전부 없다(예전 그대로).

- **보고서 반에 살아 있는 반 보드가 있으면 그 반으로 보낸다.** 살아 있다 = 0302a 연결이 있고 그 학생의 원아가 ok로 매칭돼 있다(`classBoardLiveForStudent`).
  - **특강**도 제 반 보드를 가진다. 매일 동기화가 특강 반 보드도 만든다(원장 *"특강도 그냥 클래스노트에 반을 만드는게 가장 베스트"*).
  - 학부모 보고서 제목은 `[특강] 수학 보고서`처럼 과목 보고서다(`report-title.ts`, 모든 학원 · 2026-10-16 — 설정 제목이 기본값이면 과목 이름, 과목을 모르면 `수업 보고서`).
- **종강 반**은 ClassNote 보드가 살아 있는 동안 연결을 지킨다(`closedClassesToKeep`). 보드가 지워지면 연결이 걷힌다.
- **보낼 반 보드가 없으면 '보낼 반'을 정한다.** 반 없는 보강이나 연결이 걷힌 종강 반이 여기에 해당하고, 값은 `lesson_reports.classnote_class_id`(0303a)에 적는다.
  - 원스크린: 메인 수업을 자동으로 고르고, 못 정하면 강사에게 고르게 한다.
  - 관리자 직접 작성: 학생·과목을 고른 뒤 '보낼 반' 목록이 뜬다(`getAdminSendClassOptions`).
  - 보고서에 **반이 있는데** 그 반 보드가 없으면(특강 반 보드가 아직 없음 등) 메인 수업을 자동으로 고르지 않고 **반 고르기**를 띄운다.
  - 🔴 **후보가 없으면 발송하지 않는다**(`no_class`, 원장 *"담당 반이 없으면 보고서 발송 불가능하게"*). 예전엔 1인 보드로 갔다.
  - 🔴 반 보드 확인이 실패하면(조회 오류) **발송하지 않는다**(fail-closed).
  - 관리자 일괄 경로(미발송 일괄 발송·재발송·멈춤 복구)는 한 함수(`blockedForNoSendClass`)를 지난다. '보낼 반'이 이미 적혀 있고 살아 있는 행만 보낸다. 멈춤 복구에서 막힌 행은 queued 대신 `failed`(한글 사유)로 내린다.
- 🔴 **'살아 있는 반 보드' 판정은 한 벌이다**: 연결(`classnote_class_boards`) + 그 학생의 원아 매칭 `ok`(`classnote_class_board_members`). 앱(`classBoardLiveForStudent`·보낼 반 후보)과 워커(`isClassRouteEligible(sql, tenant, classId, studentId)`)가 같다.
- 종강 반 연결 지키기는 조회 실패를 삼키지 않는다(`loadClosedLinked` throw · `loadLinkedBoards({ strict: true })`). 삼키면 동기화가 연결을 전부 지운다.
- **워커**(`pickRouteClass`)는 이렇게 고른다.
  1. 보고서 반에 연결이 있으면(종강·특강 포함) 그 반
  2. 없으면 '보낼 반'
  3. 둘 다 없으면 1인 보드. 전환 전에 대기에 올라간 행 같은 1회성 폴백이다.

## 4. Cloud Run 함수(submitToClassNoteV2) 요점 — 소스: D:\edutrix\functions\index.js

> 🔴 **2026-07-29 폐기 — 이 함수는 더 이상 발송 경로가 아니다.** 워커에서 Cloud Run 분기를 **코드로 제거**했고
> (`scripts/_classnote/classnote-core.mjs`), 게시는 워커 내장 내부 API 경로 하나뿐이다. env 스위치
> (`CLASSNOTE_PUBLISH_MODE`)도 함께 없앴다 — 폴백이 남아 있으면 env 한 줄이 빠지는 순간 이미 삭제된 함수를
> 호출해 **전 발송이 실패**하는데, 앱·DB와는 호환돼 그 전까지 화면상 아무 이상이 없다(적대 검증 P1).
> 아래 내용은 **역사·리버스엔지니어링 기록**으로만 읽을 것 — 보드/원아 매칭 규칙의 유래가 여기 있다.
>
> ⚠️ **연동 PC에 새 zip이 이관되기 전까지는 그 PC의 구워커가 아직 이 함수를 부른다.** 발송 콘솔 워커 카드의
> "구버전 워커(옛 서버로 게시)" 경고가 사라진 뒤에야 edutrix Firebase를 삭제할 수 있다
> (판정 = 하트비트 `caps.nativePublish`, `worker-results.ts`).

- 요청마다 **새 Puppeteer 브라우저**로 classnote.com/login 로그인(세션 재사용 없음). 호칭 다이얼로그(Manager) 처리.
- 학생모드 판정: `/^\((수학|영어)\)/.test(className)` — 이 prefix면 그 문자열 그대로 반명 검색.
- 같은 (날짜+이미지해시+강사+반+링크) 그룹은 원아선택 모달에서 **다중 반 선택 → 알림장 1건으로 동시 발송**.
- 이미지: base64 → 임시 jpg → `input[data-testid='media-attachment-add-input']`에 1장씩 업로드.
- shareUrl은 "마지막 visible textarea"(본문)에 타이핑. 전송 버튼은 텍스트 매칭('지금전송'·'전송' 등).
- 응답: `{success, results:[{success, studentName, errorType?, message?}], sessionId}`. 부분 실패도 200.
- ⚠️ **알려진 함정**: ① 전송 버튼을 못 찾아도 success로 기록하는 경로 존재(침묵 미발송 가능)
  ② 함수 타임아웃 900초 vs aywa 워커 fetch abort 120초 — abort가 서버 실행을 취소하지 못해
  타임아웃-재시도 시 **중복 게시 가능**(멱등 키 없음) ③ emotion 해시 셀렉터(css-*)는 ClassNote
  프론트 재배포 시 깨질 수 있음(정기 실발송 테스트로 감지).

## 5. env 변수 (워커, `node --env-file=.env.local`)

| 변수 | 용도 | 비고 |
|---|---|---|
| `DATABASE_URL` | 큐 직결(RLS 우회) | 필수. **tenant 격리 필터 필수**(코어가 강제) |
| `CLASSNOTE_UPLOAD_ID/PW` | ClassNote 로그인 | `--post` 시 필수. Cloud Run payload로 전달 |
| `CLASSNOTE_TENANT_ID` | 오발송 방지 | 테넌트 2개+면 필수(1개면 자동) |
| `CLASSNOTE_SCREENSHOT_BASE` | /r 캡처 도메인 | 연동 PC는 공개 도메인 필수(`https://www.aywa.co.kr`, 2026-09-21~) |
| `CLASSNOTE_SHARE_BASE` | 게시글 상단 /r 링크 도메인 | 오타 나면 **죽은 링크가 조용히 게시**되므로 주의. 회수 워커도 같은 값을 읽는다(2026-09-21 — 그전엔 코드 리터럴). 지금 값 `https://www.aywa.co.kr`(없으면 이 값 — `CURRENT_SHARE_BASE`) · 바꾸는 법 = `발송PC-새도메인.bat` |
| `CLASSNOTE_LEGACY_SHARE_BASES` | 회수가 대 볼 **옛** /r 주소(쉼표 구분) | 선택. 기본값에 `https://eywa-alpha.vercel.app` 포함 — 도메인을 옮겨도 이전 전 글을 회수할 수 있다(`share-bases.mjs`) |
| `CLASSNOTE_AUTHOR_NAME` | 작성자 이름이 빈 글의 작성자 표기 | 선택. 기본 `인재원 학원`. 워커는 PC(=지점)마다 하나라 다른 지점 워커는 그 지점 이름으로 |
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
그래서 한 보드에 다른 가족이 끼어 있으면 그 학생 보고서가 남의 집에 간다. **aywa DB엔 보드 멤버십이 없어**
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
- ⚠️⚠️ **판정 기준 = 계정 수가 아니라 "매핑이 맞는가"** (원장 결정 2026-07-15, 계정 수 게이트 폐기)
  · **근본 원인**: aywa는 동명이인을 `박서준`/`박서준C`처럼 **이름 뒤 알파벳**으로 구분하는데 **학부모는
  클래스노트 가입 시 알파벳을 안 붙인다**(그냥 "박서준"). 그래서 보드 `(수학)박서준` 하나가 초6·중3을 동시에
  가리키고, 학원이 반 초대를 넣을 때 헷갈리면 그대로 오발송(= 실제 사고).
  · **계정 수는 위험과 겹치지 않는다**(실측): 모호한 보드 39개가 **전부 계정 1개**라 "2+ 차단"은 위험을
  **한 건도** 못 잡았고, 같은 학생 다계정(영어·수학 따로 가입 / 학부모·학생 각자 가입) 4건만 오탐으로 막았다.
  계정이 1개여도 그게 **엉뚱한 집**이면 오발송이다(김서윤·김채은 실사례). **계정 수로 되돌리지 말 것.**
  · **판정**: [`boardNameAmbiguity`](../scripts/_classnote/board-safety.mjs)로 **모호한 이름일 때만**
  원아를 조회해([`evaluateBoardMapping`](../scripts/_classnote/board-safety.mjs)) **원아 생년월일 ↔ aywa 학년**
  대조(±1년). 비모호면 조회 0·검사 0. 실측: 학생보드 522개 중 모호 37개만 조회, ok 520.
  · **모호 = ① 같은 유효이름 2명+ (⚠️ **퇴원생 포함**) ② `이름+알파벳 한 글자`(A~G) 형제 존재.**
  ①의 퇴원 포함이 핵심 — 앱의 동명이인 게이트(`hasClassnoteNameCollision`)는 `status<>'withdrawn'`이라
  **퇴원하는 순간 풀리는데** 보드엔 그 퇴원 가족이 그대로 남는다(실측: 김서윤 07-10 퇴원 → 고2 김서윤 보드 무방비).
  ② `이윤` vs `이윤건`처럼 **여러 글자 차이는 다른 이름**이라 모호 아님(학부모가 "이윤건"으로 가입).
  · **aywa엔 생일이 없다**(807명 중 1명) → **학년에서 출생연도 역산**(`expectedBirthYear`, 2026학년도 초6=2014생).
  학년은 전원 있다. ±1년 허용(조기입학·유급·학부모 생일 오입력 흡수).
  · **예외 등재 = 사람 탈출구**(매핑이 안 맞아도 통과) — 없으면 확인해도 못 푸는 막다른 길이 된다.
  ⚠️ **테스트 학생 `학원이`는 등재 필요** — 테스트 계정이라 원아 생일이 실제와 달라 보류된다(`(수학)학원이`·`(영어)학원이`).
  · 발송·공지·인바운드 **3경로가 같은 판정**을 탄다.
- 연결 가족 0·1 → 통과(0은 누수 아님)
- 차단 직전 `fetchBoardChildren`로 **실시간 재확인**(TOCTOU: 원장이 방금 정리했을 수 있음) + 사유에 연결 가족 명시

**왜 자동 판별(전화 대조)을 안 하나** — `(수학)안은지`처럼 **학생 본인+학부모가 각자 가입한 정상 2계정**이 있고,
이를 leak과 구분할 유일한 권위 신호는 **연락처**인데 ClassNote API가 전화를 안 준다(`/api/v1/children/{id}`엔
`parent.name`만, 전화 없음). 전화는 **운영관리(ERP) 화면**에서만 보인다 → **사람이 확인 → 화이트리스트**가 정답.
🔭 **v2 후보**: `GET /api/v1_2/centers/{id}/erp-children/`(존재 확인됨, 200)에 보호자·연락처가 있는 것으로 보임 —
다만 `?belong_to_class=` 필터가 안 먹고(전건 571 반환) 전화 필드 경로 미확정. 확정되면 aywa `parent_phone`/
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
연락처·보호자 대조 → ① 같은 학생의 학부모/본인 계정이면 **수업보고서 > 보고서 설정 > '공유 보드 발송 예외'**에 보드명
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
   `assign-classnote-students.mjs`(§3 표) — dry-run 기본, 학부모 초대·가입만 자동화 불가. 🔴 2026-11-04 두 도구 모두 지움(1인 보드 배정 금지 · 1.0.14).
5. 좀비 queued(too_old 드리프트·revoked-while-queued)는 어떤 화면 주의 목록에도 안 잡힘.
6. ~~`retryClassnote`가 revoked_at 미확인~~ → **✅ 해소(2026-07-10 P0-1)**: 재발송 필터에 `revoked_at IS NULL` 포함.
7. 워커 minDate는 PC 로컬 시간, 앱 가드는 KST — 연동 PC가 KST라 현재 무해하나 기준 이원화.

## 8. 과거 사고 (재발 방지 근거)

- **2026-07-15 공유 보드 오발송(실측)**: `(수학)박서준` 보드에 **두 가족**(초6 2014생 + 중3 2011생)이 함께
  연결돼 있어 **초6 보고서가 중3 가족에게 계속 노출**되고 있었다. 중3은 2026-07-13에 전용 보드 `(수학)박서준C`를
  받았지만 **옛 공유 보드에서 제거가 안 돼** leak이 남아 있었음(원장이 07-15 수동 제거로 정지).
  전수 스캔 결과 학생모드 공유 보드가 8개(최성효T=퇴사 강사·학원삼=테스트 제외 시 실대상 5개)였다.
  → **프리플라이트 보드 안전 게이트(§5.5)의 존재 이유.** aywa DB엔 보드 멤버십이 없어 앱 가드로는 원천적으로
  못 잡는다(동명이인 가드도 통과 — aywa엔 박서준·박서준C가 **다른 이름**이라 충돌이 아니었음).
  ⚠️ **"2가족=오발송"은 항상 참이 아니다**: `(수학)안은지`는 학생 본인 계정과 학부모(김경희) 계정이 각각
  가입한 정상 케이스(두 전화가 aywa parent_phone·student_phone과 각각 일치, 학생이 자기 생일을 다르게 입력해
  생년월일도 달랐다). 그래서 게이트는 **차단 기본 + 원장 확인 화이트리스트** 구조이고, 자동 판별을 하지 않는다.
- **2026-05~06 (edutrix 시절)**: 과거 보고서 재발송 사고 — 1~4월 보고서 **3,500건이 학부모에게 오발송**.
  → too_old 가드(전 달 1일 이후만, [classnote-guard.ts](../src/features/onescreen/classnote-guard.ts))와
  기본 dry-run 스위치(`classnoteSendEnabled=false`)의 존재 이유. **이 가드들을 완화하지 말 것.**
- **2026-07-10**: 연동 PC env 도메인 수기 오타(§6). → 주소는 복사-붙여넣기 + `발송PC-주소수정.bat`.
- **2026-09-04 곽하윤 건 — 사유를 버려서 원인을 못 좁혔다**: 스샷 kage 업로드가 3회 재시도 전건 실패했는데
  DB에 남은 말은 `스샷 kage 업로드 실패` 한 줄뿐이라 ① 캡처가 비었는지 ② 작성폼 첨부 칸이 안 열렸는지
  ③ kage가 거부했는지(HTTP 몇) ④ 응답이 아예 없었는지를 **구분할 수 없었다**. 정황(같은 학생 과거 전건
  성공·그날 42건 중 1건만 실패·바로 옆 김채원도 1회 재시도 후 성공)으로 일시 장애까지만 좁히고 끝.
  → [`uploadToKageDetailed`](../scripts/_classnote/classnote-admin-core.mjs) + 순수
  [`kage-failure.mjs`](../scripts/_classnote/kage-failure.mjs)로 **네 갈래를 갈라 담는다**.
  🔴 사유 문장은 `humanizeClassnoteError`를 **사람 문장으로 통과**해야 한다 — 통과 못 하면 패턴표가
  덮어써서(`/이미지/`→"보고서 이미지 생성 실패", `찾지 못`→보드 안내) **엉뚱한 조치를 안내한다**.
  그래서 기술 원문은 `sanitizeKageDetail`로 신호(URL·스택·`Error:`·`net::`)를 걷고 40자로 자른다.
  ⚠️ 워커 코드라 **연동 PC에 zip을 새로 이관해야 반영된다**(git pull 아님 — §2 이관 안내).

## 9. Edutrix 병행 운영·컷오버 평결 (2026-07-10 적대 검증 — 4방향 코드검증 + 실보드 대조)

> 질문: "전환기에 Edutrix와 aywa가 같은 ClassNote로 같이 발송해도 이상 없나?"
> **판정: 조건부 가능.** ① 지금 상태(aywa dry-run OFF = Edutrix 단독 발송)는 이미 병행 중이며 **안전**.
> ② 인프라 병행(같은 Cloud Run 함수·같은 봇 계정 동시 호출)도 **안전** — concurrency=1 인스턴스 격리·
> 모듈 전역상태 0·큐 DB 분리(edutrix Supabase vs aywa Postgres)·각자 원자 클레임·sessionId 충돌 불가,
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
3. aywa `classnoteSubjects=['math']` → `classnoteSendEnabled` ON → 첫날 소량 표본 육안 확인.

### 전환기 운영 수칙 (코드가 못 막아주는 것들)
- **과목 단위 컷오버**: 한 과목의 작성+발송은 한 시스템에만. 이중 작성 시 aywa DB에 2행 영구 공존
  (nulls-distinct 유니크) → 진도 탭 이중 표시·주간 작성률 2배·**학부모 추이 그래프 같은 날짜 2점**.
- **학생 이름 변경 금지(전환 완료까지)**: Edutrix 쪽 cron이 aywa DB를 읽어 학생을 **이름으로만** 미러
  (eywaSyncAction/syncActions) — 개명 시 Edutrix에 유령 학생 신설 + 기존 매핑 단절(보고서 조용히 skip),
  동명이인은 Edutrix에서 1명으로 붕괴돼 남의 성적이 섞일 수 있음.
- **동명이인 오버라이드 이원화 주의(가장 위험한 조용한 실패)**: aywa `classnote_name`과 Edutrix
  `class_note_submission_name`을 대조하는 코드가 없음 — 오입력하면 동명이인 가드를 통과한 채
  **남의 집 학부모에게 성적이 감**(성공으로 기록). 지정 시 실보드명(A~G 접미사)과 사람이 대조.
- **원장 화면 해석**: 이관 행 '미요청' ≠ 미발송(Edutrix 발송 사실은 이관 안 됨 — 재발송 금지) ·
  Edutrix로 쓰는 강사의 당일 작성률 0%는 정상(이관은 새벽 03:30 단발 — 독촉 금지) · 열람 수는 aywa
  발송분만 집계(전환기 과소).
- **회수 반쪽**: aywa revoke는 aywa 링크만 차단 — Edutrix로도 나간 내용은 그쪽에서 별도 처리.
- **봇 계정 비번 회전** = Edutrix 코드(평문 하드코딩) + aywa 발송 PC env 두 곳 동시 갱신.

### 보드 준비 실사 (2026-07-10, 재원 512·발송과목 수강 382명·기대 보드 479 vs 실보드 612 대조)
| | 수학(첫 컷오버 대상) | 영어(확장 시) |
|---|---|---|
| 보드·학부모 연결 정상 → 즉시 발송 가능 | **~200명** | ~118명 |
| **보드 없음 → 수동 생성 필요** | **33명** | 67명 |
| 보드 있으나 학부모 미연결(발송해도 못 봄) | 6명 | 58명 |
| 이름 매핑(`classnote_name`) 지정 필요 | 1명(박서준C→실보드 박서준) | 2명(전주원→전주원A·이서은→이서은A) |

### Edutrix 은퇴 시 지뢰 (은퇴는 마지막에)
- aywa 실게시 함수(submitToClassNoteV2)가 **Edutrix 소유 Firebase 프로젝트의 Cloud Run** — 프로젝트/빌링
  삭제 시 aywa 발송 전면 즉사. 은퇴 정리 전에 **함수를 aywa 소유 프로젝트로 이전**(P2).
- Edutrix `/share` 링크는 만료 게이트가 없어 앱 제거 시 과거 게시물 링크 대량사(이미지 본문은 ClassNote에 박제).
- Edutrix 로컬 봇 경로엔 too_old 가드가 없음(가드는 cron 미등록 서버 경로에만) — 병행기 중 Edutrix에서 과거 보고서 재큐잉 조작 금지.

## 10. Edutrix 완전 종료(소등) 체크리스트 — ✅ **2026-07-29 실행 완료**

> 📄 **실행 결과·잔여물·교훈은 [edutrix-retirement.md](./edutrix-retirement.md) 단일 문서를 보라.**
> 아래는 그 계획 원문(경위 추적용).

> 원장 결정: "유지해야 하는 것들을 aywa로 다 이전해서 Edutrix를 완전히 꺼버린다. Vercel(공유 링크 주소)도
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
1. **강사 작성 aywa 전환 + Edutrix 발송 봇 종료**(봇 PC) → 며칠 안정화.
2. ~~full-import 마지막 실행~~ → **✅ 자동화됨(2026-07-10)**: `/api/cron/edutrix-sync`를 리치 필드 +
   윈도 내 **수정 전파**(diff 후 변경분만 UPDATE, 상한 300)로 승격 — full-import와 필드 동형이라 매일
   새벽 cron이 신규·수정분을 완결 상태로 유지(교란-복원 E2E 검증: updated:1 → 원본값 복원).
   소등 날 수동 작업 = **archive-edutrix.cjs 재실행 한 줄만**(원본 raw 최종 스냅샷).
3. **Edutrix Vercel 종료 — ✅ 2026-07-29 실행.** 앱·cron(학생 이름 미러 포함) 소멸. `/share` 옛 링크 사망 = 수용(원장 승인,
   이미지는 ClassNote 게시물에 박제). aywa 측 부수 정리: `/api/cron/edutrix-sync`가 원본 소실 후 500을
   내지 않는지 확인(Supabase가 살아있는 동안은 무해) — Supabase 소등과 함께 vercel.json에서 cron 제거.
4. **Edutrix Supabase 종료** — 이전·아카이브 완료로 의존 0.
   ✅ **aywa 측 코드 정리는 2026-07-29 선행 완료**(원본이 꺼져도 500이 안 나도록 **끄기 전에** 제거):
   `/api/cron/edutrix-sync` 라우트+vercel.json 크론 · `edutrix-map-queries/actions` · `edutrix-match` ·
   원장 콘솔 '미매핑' 탭 · `instrumentation.ts` 권장 env · `.env.local.example`.
   🔴 **남긴 것(고의)**: aywa DB 안의 `source='edutrix_import'`·`edutrix_report_id`·`edutrix_share_token`·
   `students.edutrix_student_id`와 이를 읽는 코드(이관 라벨·발송 차단 가드·**ClassNote 읽음 매칭**).
   전부 aywa DB만 읽으므로 원본 소등과 무관하다 — 지우면 옛 발송분의 읽음 추적이 끊긴다.
   남은 수동 작업 = Vercel의 `EDUTRIX_*` 3종 삭제(코드가 이미 안 읽으므로 언제 해도 무해).
5. **Edutrix Firebase(Cloud Run) — ✅ 2026-07-29 프로젝트 삭제 완료.** 아래는 그 경위(재발 방지용 기록).

   > **소등 실행 기록(2026-07-29)**: `ijw-calander`·`classreport-web` 두 GCP 프로젝트 **삭제**, edutrix Vercel **삭제**.
   > 삭제 직후 헬스체크 4종 통과(구글시트 200 · 첨부 PDF signed URL 200 · `/r` 200·GCS 참조 0 · 워커 발송 정상).
   > 🔴 **얻은 교훈 — 빌링을 끄면 백업도 못 뜬다**: ijw는 Spark 전환 시점부터 GCS 다운로드·Firestore 조회가
   > 전부 `billing disabled`로 막혀, 삭제 전 마지막 백업을 뜨지 못했다(참조 파일은 이미 Supabase 이관 완료라
   > 운영 영향은 0, 미참조 고아 123개만 소실). **다음에 어떤 프로젝트든 내릴 땐 "백업 → 빌링 해제 → 삭제" 순서.**
   > 🔴 **Cloud Run 폴백 제거가 실제로 방화벽이 됐다**: Spark 전환 직후 `submitToClassNoteV2`가 500→503으로
   > 죽었는데, 같은 날 오전에 폴백을 코드에서 걷어낸 덕에 발송은 무중단이었다(제거 전이었다면 env 한 줄로 전멸).
   > 잔여물: `classreport-web` Firestore(1세대 보고서·랭킹)는 edutrix→aywa로 계승·아카이브돼 삭제 승인(원장,
   > 랭킹 데이터 불요). GCP 프로젝트 삭제는 **30일 유예**라 그 안에는 복구 가능.

   ✅ **옵션 B 완료(2026-07-29): 코드에서 Cloud Run 분기를 제거**했다.
   워커는 내부 API 경로 하나로만 게시하고 env 스위치(`CLASSNOTE_PUBLISH_MODE`)도 없앴다 — 폴백이 남아 있으면
   env 한 줄이 빠지는 순간 삭제된 함수를 불러 전 발송이 실패한다(적대 검증 P1).
   - 🔴 **삭제 전 필수 관문**: 연동 PC에 **새 zip 이관 완료**. 구워커는 코드가 바뀌어도 계속 Cloud Run을 부르고,
     앱·DB와 호환돼 **화면상 정상으로 보인다**. 판정 = 발송 콘솔 워커 카드에 **"구버전 워커(옛 서버로 게시)"
     경고가 사라졌는지**(하트비트 `caps.nativePublish`). 경고가 남아 있는 동안 Firebase를 지우면 발송 전멸.
   - 옛 옵션 A(함수를 aywa 소유 GCP로 재배포)는 폐기 — 이중 관리만 남는다.
6. 소등 후 잔여물: `edutrix_archive`(영구 보험) · lesson_reports 풀 이력(운영) · `D:\edutrix` 로컬 소스
   (함수 원본 — 옵션 B 완료 전까지 보관 필수).

## 10.5 수학 반 보드(반별 발송) — 2026-09-29

> **한 줄 규칙: 반 보드 안에서는 원아를 이름으로 고르지 않는다.** 저장된 매칭(0302a)의 원아에게만 1:1로 보낸다.

§3 "반(다인) 구조로 돌아가면 안 되는 이유"는 **화면 흉내(DOM) 봇 시절** 얘기다 — 2026-07-29부터 게시는 내부 API
`POST /api/v1_2/reports/ {cls, child, enrollment}`로 원아를 지목하는 1:1 게시라, 다인 반에서도 그 집에만 간다
(테스트반 #1317083에 학원이만 게시 → 학원삼·사·오·육 알림장 0건으로 확인).

| 구성 | 파일 | 역할 |
|---|---|---|
| 계획(순수) | [`class-board-plan.mjs`](../scripts/_classnote/class-board-plan.mjs) | 가드 ①원아 출처(앞에서부터 하나 — 1인 보드 원아 → 0302a에서 이미 확인된 원아 중 **기록된 그 반 보드에 지금도 있는 원아** → 확인 기록이 아예 없으면 **원아 연결(0185a)** · 2026-11-02 1인 보드 배정 해제 대비 · 상세 §10.5-a · ④는 기록에서 지금 대상 반의 다른 학생에게 확인된 원아인지도 본다 · 🔴 잘못 붙은 원아를 떼려면 그 학생의 **기록된 반 보드 전부**에서 떼고 **원아 연결도 고친다**(한 곳에라도 남으면 다시 붙는다)) ②보호자 전화(운영관리 carer1 ↔ aywa 4칸) ③생년 ±1 ④역방향 유일성 ⑤같은 반 기본이름 겹침 = 보류 ⑥이름 연속성(형제 계정 — 원아 연결 출처는 명부 이름·프로필 이름 둘 다). 전부 AND, 모르면 보류 |
| 생성·배정 | [`provision-math-class-boards.mjs`](../scripts/_classnote/provision-math-class-boards.mjs) | 드라이런 기본 · `--apply --only --limit` · 반마다 원아 정확히 대조 · 끝에 1인 보드 무변경 확인 · `--sync-db` = 0302a 기록 |
| 담임 연결 | [`provision-math-class-teachers.mjs`](../scripts/_classnote/provision-math-class-teachers.mjs) | 확인된 대응표만(`TEACHER_MAP` — 김은정=셀린·이수진=수진T) · 선생님별 연결 수 +N 검증 |
| 대상 반 | [`math-class-boards-load.mjs`](../scripts/_classnote/math-class-boards-load.mjs) | 활성 수학 · **보고서 발송 반만**(미발송 JJ 자리 반 제외 — 2026-11-04 되돌림 · 11-03에 잠깐 넣었던 'JJ 맞춤'을 거뒀다 · §10.5-b) · **특강 포함**(2026-09-30) · **종강(closed_at) 제외**(종강 반 6개를 만들었다 지운 사고 — 이미 연결된 종강 반은 보드가 살아 있는 동안 연결 유지) |
| 발송 경로 | [`class-route-decide.mjs`](../scripts/_classnote/class-route-decide.mjs)(순수) + [`classnote-class-route.mjs`](../scripts/_classnote/classnote-class-route.mjs) | 보고서 설정 `classnoteMathRoute` personal/class/pilot · 반별 = 저장 원아 → ClassNote 재확인 → 게시 → 같은 반 다른 원아 교차 확인(새면 **비상 정지**) |
| 매일 동기화 | [`math-class-boards-sync.mjs`](../scripts/_classnote/math-class-boards-sync.mjs) + [`math-class-boards-apply.mjs`](../scripts/_classnote/math-class-boards-apply.mjs) | 워커 KST 05시 이후 하루 1회(연결표가 빈 지점은 안 돈다) · 연결표 **번호 기준**(이름 바뀌면 PATCH) · 새 반·신입 배정·담임·0302a 갱신 · 이상하면 멈추고 기록 안 함 · 회차마다 **동기화 보고서**(0329a — 변동·실패·보류 + 이유, 해제 대상)를 남긴다 → 앱 '동기화 보고서 다운로드' |
| C.N 라벨 | [`classnote-match.ts`](../src/features/onescreen/classnote-match.ts) · [`cn-badge.tsx`](../src/features/onescreen/components/cn-badge.tsx) | 원스크린 카드·표 모드. 초록 = 확인된 배정 |

- **API(실측)**: 반 생성 = DOM '반 추가하기'(또는 `POST kapi…/v1/centers/{c}/classes`) · 반 이름 변경 = `PATCH /api/v1/centers/{c}/classes/{id}/ {name}` → 200 (`/api/v1/classes/{id}/` PATCH·PUT은 405) ·
  반 삭제 = `DELETE /api/v1/classes/{id}/` → 204, **원아·선생님 0명일 때만**(선생님 있으면 400 `teacher_exists`) ·
  🔑 **원아·선생님 해제는 된다(2026-10-02 실측 — 그동안 "405라 화면에서 손으로"라고 적었던 것을 정정)**: 405였던 것은
  `/api/v1/enrollments/{id}/`·`/api/v1/employments/{id}/`의 **DELETE·PATCH**였고, ClassNote 화면이 실제로 부르는 주소는 따로 있다
  (화면 JS에서 찾음 — 원아 '소속 반 → 삭제' · 선생님 '담당 반 → 삭제'):
  원아 해제 = `POST https://kapi.classnote.com/v1/enrollments/{배정번호}/out`(본문 없음, 쿠키 인증) → **200** · 그 반에서만 빠지고 다른 반 배정은 그대로 ·
  다시 넣기 = 기존 `POST /api/v1/enrollments/ {child, belong_to_class}` → 201(배정번호는 새로 생긴다, 원아 번호는 그대로).
  선생님 해제 = `POST https://kapi.classnote.com/v1/employments/{연결번호}/out` → **200** · '담당 반'에서 사라진다(연결 줄은 `is_approved:false`로 남는다 —
  ClassNote 화면에서 지워도 같은 흔적이 남는다 · 승인 대기로 뜨지 않는다).
  실측 대상 = 테스트 학생 '학원이'(원아 5268389) × `[수학] 테스트반`(1317083): 내보냄 → 확인 → 다시 배정(반 8개 그대로) ·
  선생님 1763863 × 테스트반: 연결(201) → 해제(200) → '담당 반'에 없음. 배정번호는 `GET kapi…/v1_2/children/{원아}/enrollments`,
  연결번호는 `GET kapi…/v1_2/teachers/{선생님}/employments/`에서 읽는다.
  = **반 생성·이름 변경·삭제 + 원아·선생님 배정·해제가 전부 API로 된다** → ClassNote 화면에서 손으로 하던 정리를 자동화할 수 있다.
  ✅ **2026-10-02부터 반 보드 동기화가 자동으로 해제한다**(보드 삭제는 안 함 · 2026-11-03부터 영어 반 방·종강 반 보드·1인 보드까지 — §10.5-b): 그 반 수강이 끝난 것이 확인된 원아와
  지금 담당이 아닌 선생님. 이 반 학생의 원아일 수 있거나 누구 원아인지 모르는 원아는 보류해 해제 리스트(0329a)에 사유와 함께 남긴다.
  해제된 선생님 연결 줄은 `is_approved:false`로 남으므로 연결 여부는 살아 있는 줄만 본다. 상세 = `docs/decisions/reports-ai.md` '자동 해제'. ·
  반 단체 공지 = `POST https://kapi.classnote.com/v1_2/notices/ {classes_to:[반id…], title, content, is_comment_on, center, author_name, scheduled:""}` → 반마다 공지 1건. 🔴 `classes_to`가 비면 기관 전체일 수 있다 — 빈 목록·허용 밖 반이면 무조건 차단.
- **공지(원생 개별·교재요청서)도 수학은 반 보드 경로(2026-10-02)**: 큐 대상에 `classId`가 있으면 [`notice-class-route.mjs`](../scripts/_classnote/notice-class-route.mjs)가 수업보고서와 같은 함수(`isClassRouteEligible`·`resolveClassTargets`)로 대상을 확정해 그 반 보드의 그 원아에게 1:1로 올린다. 실패하면 그 대상만 실패 — 1인 보드 분기로 떨어지지 않는다. `classId`가 없는 대상(영어·옛 큐 행)은 기존 1인 보드 경로. 앱은 워커가 `caps.noticeClassRoute`를 알릴 때만 이 경로로 싣는다. 상세 = `docs/decisions/reports-ai.md` '수학 공지'.
- 🔴 **`"보드가 곧 매핑"` 폴백(`acceptBoardMembers`)은 반 보드 경로에서 절대 타지 않는다** — 생년만 보므로 같은 학년 반이면 전원이 통과한다(`sendReportViaApi targets`).
- 🔴 회수(`classnote-recall-core.mjs`)는 1인 보드 **와** 반 보드를 함께 훑는다 — 한쪽만 보면 '이미 없습니다'로 거짓 성공.
- 반 정보 없는 보강 보고서 = A안(0303a `classnote_class_id`) — `saveAndQueueClassnote`가 메인 수업(보낸 보고서 최다 → 출결 최다)을 정해 적고, 못 정하면 `needs_class`로 멈춰 원스크린이 고르게 한다. 그 칸이 빈 행(관리자 재발송 등)은 워커가 기존 1인 보드로 보낸다.
- 학부모 **새 글·댓글 벨 알림**: 반 보드 글은 `보드번호(cls)|원아id` → 학생(0302a ok)으로 확정한다(`loadClassBoardChildMap` · [`class-board-keys.mjs`](../scripts/_classnote/class-board-keys.mjs)). 보드명 키는 번호 없는 글의 폴백뿐(2026-09-30 — 반 이름이 바뀐 날 보드명 키는 짝을 못 찾아 알림이 조용히 버려졌다). 조회 실패는 throw(워터마크 안 전진). 🔴 1인 보드 게이트(`gateBoard`)를 반 보드에 태우지 말 것(보드 = 한 학생 전제).
- 🔴 반 단체 공지 API `POST /api/v1_2/notices/`(www로도 됨)는 `classes_to`가 **필수가 아니다**(빈 요청 검증 응답에 없음) — 빠지면 기관 전체 공지일 수 있다. 발송 코드는 비었거나 허용 밖 반이면 무조건 차단.
- 반 단체 공지 레일 = 0304a `classnote_class_notices`(쓰기 서버만) → [`classnote-class-notice-core.mjs`](../scripts/_classnote/classnote-class-notice-core.mjs): 보드 번호 재조회(0302a) · 보드 원아 ⊆ 그 반 재원생 ok 원아(반을 옮긴 학생이 남아 있으면 보류 — 해제는 손으로) · 요청은 [`class-notice-guard.mjs`](../scripts/_classnote/class-notice-guard.mjs)로만 조립 · 중복 게시 생략 · 게시 후 `is_center_notice` 확인. 원생 개별 공지(0099a)는 그대로.
- **반 단체 공지 이미지(2026-10-03)**: 공지 API가 `attached_images`를 받는다 — 모양은 알림장과 같다(`{access_key, original_file_name, file_size, width, height}`). 올리는 길은 알림장 작성폼(`/service/report/add`)의 이미지 입력(`media-attachment-add-input`)뿐이다(공지 작성 화면에는 처음부터 떠 있는 파일 입력이 없다) — 거기서 받은 키를 공지에 실어도 붙는다(테스트반 실측: 2장 게시 → 공지 단건·목록의 `attached_images` 2장 → `DELETE /api/v1_2/notices/{id}/` 204로 정리). 큐 행에는 `targets[].attachments`로 실리고(새 칸 없음), 워커가 내부 라우트 `class-notice-attachments/[noticeId]`에서 서명 주소·서명 전 장수(`expected`)·서명 실패 이름(`missing`)을 받는다. 순서 = 보드 원아 대조 → 중복 확인 → **이미지 올리기** → 게시 → 붙은 장수 확인. 하나라도 못 올리면 그 반엔 게시하지 않는다. 워커 지원 표식 = `caps.classNoticeImages`(앱은 최근 7일 안에 보인 연동 PC가 전부 이 값을 알릴 때만 이미지를 받는다).
  - 준비기 = `createClassNoticeImagePreparer`: 내려받기는 공지당 한 번 · 올리기는 반마다 새로(작성폼을 새로 열고 한 번 다시 해 본다) · 실패하면 남은 반은 시도하지 않고 같은 사유로 보류. 2026-10-03 테스트반 실측: 같은 페이지에서 이미지 공지를 연달아 2건 올려도 각 2장이 붙는다(건당 5~6초).
  - 중복 확인 = 기관 공지 최근 **100건**(`page_size=100`이 받아들여진다 — 실측) 안에서 같은 반·제목·내용. 글만인 공지는 "이미 올라가 있음(성공)". **이미지 공지는 이 큐 행이 올린 공지일 때만** 성공으로 넘긴다 — 워커가 반마다 `results`에 진행 기록을 남기고(상태는 `processing` 그대로), 다시 집을 때 `c.results`에서 `ok && images === 장수`인 공지 번호를 뽑아 대조한다. 그 밖(글만 먼저 보냄 · 이미지를 바꿔 다시 보냄 · 올린 직후 기록 전에 죽음)은 보류(실측: 글만 올린 뒤 같은 글 + 이미지 → 보류 · 같은 글·이미지를 새 행으로 다시 → 보류 · 진행 기록이 있는 행 → 이미 올라가 있음).
  - ⚠️ 한계: 창이 기관 전체 최근 100건이라 대상 반이 100에 가까운 공지가 도중에 죽으면 앞쪽 반이 창 밖으로 밀릴 수 있다(지금 반 수에서는 해당 없음). 이미지 공지는 반마다 새로 올리므로 성공 경로도 건당 5~6초 + 장수만큼 걸린다 — 그동안 같은 루프의 다른 발송이 기다린다(10장 × 20개 반이면 분 단위).
  - 게시 응답 본문에 번호·`attached_images`가 오면 사후 확인의 둘째 근거로 쓴다(목록에서 못 찾았거나 목록에 이미지 칸이 없을 때).

### 10.5-a (수학) 1인 보드 정리 — 원아 신분 · 05시 준비 · 일정 (2026-11-02, 원장 A안)

원장 2026-11-02 *"원아배정 전체 해제"* · *"지금은 배정해제하고 12월에 전체 삭제"* — `(수학)이름` 1인 보드 원아를 해제했다(1차 149명 · 2차 66명 등 · 16명은 이 수리가 PC에 올라간 뒤 해제).
1인 보드는 발송 경로에서 빠졌어도 반 보드 원아의 **신분 증명 출처**였다([gotchas #150](gotchas.md)). 같은 날 1차 수리(확인 기록 출처)에 이어
남은 구멍 둘 — 확인 기록(0302a)도 반 기록이라 **보류가 한 번만 나도 지워지고**(보류 줄은 원아 번호가 없다) · 05시 준비가 신입에게 1인 보드를
계속 만든다 — 을 A안으로 막았다.

- **원아 신분 출처**(앞에서부터 하나만 — [`class-board-plan.mjs`](../scripts/_classnote/class-board-plan.mjs) ①):
  1. 그 학생의 `(수학)이름` 1인 보드 원아(남은 1인 보드) — source `personal`
  2. 반 보드 확인 기록(0302a ok) 중 **기록된 그 반 보드에 지금도 있는 원아** — `verified`. 기록은 있는데 그 보드에 없으면 '확인 필요' 보류 — ⚠️ **그 회차만**(보류 줄엔 원아 번호가 없어 다음 회차엔 3번 원아 연결로 같은 원아를 다시 붙인다 · 아래 '영구히 떼려면')
  3. **원아 연결**(0185a `classnote_child_links` — 운영관리 명부의 이름·생년·보호자 전화로 만든 원아 → 학생, 하루 한 번 `syncChildMapOnce`) — `link`, **확인 기록이 아예 없는 학생만**. 신입의 첫 배정과 확인 기록이 보류·휴원·반 사이 공백으로 지워진 학생이 이 길로 신분을 되찾는다. 반 보드에 아직 없어도 된다.
  - 가드는 셋 다 같다: 명부에 있음 · 보호자 전화 **일치**(carer1~N 중 하나 — 2026-11-04 전엔 carer1만 · 모름 = 보류 · 한계: carer2 이후에 다른 집 번호를 잘못 넣으면 그 번호로도 맞는다 — 이름·생년 가드가 남는다 · 원아 연결(childmap)은 아직 carer1~3만 읽는다) · 생년 ±1(명부·프로필 중 하나 — 원장 2026-09-29, 관리자 화면에서 고친 생년이 프로필과 따로 산다) · 이름 연속성 · 역방향(다른 학생 1인 보드 · 다른 학생 확인 기록 · 계획 안 두 학생 — 단 원아 연결 출처이면서 자기 가드에 이미 걸린 학생은 '계획 안 두 학생'에서 세지 않는다: 형제에게 잘못 붙은 연결 하나가 확인 기록으로 받던 형제까지 막지 않게) · 원아 2명 상한.
    🔴 원아 연결 출처는 **명부 이름과 학부모 프로필 이름 둘 다** 학생과 이어져야 한다 — 형제는 보호자 전화가 같고 생년도 가까워 ②③을 통과하고, 명부 이름은 연결을 만든 바로 그 입력이라 혼자서는 못 잡는다. 2026-11-02 실측 3건(박세하↔박세인 · 윤현소/윤정인)은 명부 이름이 형제 이름이었다(프로필 이름은 본인). 프로필 = 이번에 읽은 보드의 원아 이름, 보드에 없으면(신입 · 일부 반만 보는 지금 동기화) 원아 상세 `GET /api/v1/children/{id}`(`loadLinkProfiles`) — **못 읽으면 보류**(명부 이름 하나로 첫 배정하지 않는다 — 배정 알림·반 공지 노출은 되돌릴 수 없다). 명부 이름이 비어도 보류.
    · 명부(운영관리 활성 원아)에 **없는** 연결 원아는 판정에서 뺀다 — 퇴원 때 명부에서 내린 옛 계정이라 배정할 수 없고, 남기면 재등록 학생이 옛 번호 때문에 영구 보류된다. 남은 연결이 없으면 '가입 대기'.
    · ⚠️ 연결로 처음 넣은 원아는 그 회차에 0302a ok로 적혀 다음부터는 2번(확인 기록)으로 판정된다 — 그 뒤 원아 연결을 고쳐도 확인 기록 학생은 그대로 받는다(같은 보호자 전화 가족 안의 일 · 2026-11-02 운영 DB 충돌 0건). 확인 기록 출처에도 '연결이 다른 학생을 가리키면 보류'를 걸지는 후속 과제.
  - 배정 직전 재확인: 1인 보드 출처 = 1인 보드를 다시 읽는다 · 원아 연결 출처 = **원아 연결표를 다시 읽어** 계획한 원아가 이제 이 학생에게 연결돼 있지 않으면 동기화를 멈춘다(사람이 그 사이 연결을 고쳤을 수 있다 · 새 연결이 하나 더 생긴 것만으로는 멈추지 않는다 — 다음 동기화가 가드와 함께 본다 — [`math-class-boards-apply.mjs`](../scripts/_classnote/math-class-boards-apply.mjs)) · 확인 기록 출처 = 이미 그 반 보드에 있어 다시 읽을 출처가 없다.
  - 원아 연결을 못 읽으면 확인 기록과 같은 규칙 — 그날 동기화를 건너뛴다(정기·지금·자동 = `syncMathClassBoards`, 수동 = `provision-math-class-boards.mjs`).
  - **보류 사유 셋**: 원아 연결도 없음 = `ClassNote 미가입 — 이 학생으로 확인된 원아가 아직 없음`(가입 대기 — 앱 `send-class.ts` `JOIN_HOLD_REASON`·지금 동기화 `JOIN_WAIT`가 'ClassNote 미가입' 머리로 가린다. 옛 문장 '1인 보드 없음' · 'ClassNote 미가입·미배정(1인 보드 원아 0명)'도 계속 알아본다 — 앱·연동 PC 어느 쪽이 먼저 배포돼도 된다) · 연결은 있는데 가드에 걸림 = 가드 사유(관리자 확인) · 기록은 있는데 그 보드에 없음 = '반 보드에서 확인된 원아가 지금 그 반 보드에 없음 — 확인 필요'(관리자 확인).
  - 🔴 잘못 붙은 원아를 **영구히** 떼려면 반 보드에서 떼는 것만으로는 부족하다 — '확인 필요' 보류가 한 번 기록되면 확인 기록이 지워지고, 다음 동기화부터는 원아 연결로 판정해 같은 원아를 다시 붙인다(배정 알림도 다시 간다). **원아 연결(0185a)도 함께 고친다**(형제에게 잘못 붙은 연결은 맞는 학생에게 다시 잇는다 — `linked_by='manual'`, 원아 연결 갱신은 이미 붙은 연결을 바꾸지 않는다). ⚠️ 앱에는 연결을 고치는 화면이 없다 — 지금은 운영자(DB) 몫. 보류 줄에 뗀 원아 번호를 남겨 '사람이 풀 때까지 보류'로 만드는 수리는 후속 과제(0302a 보류 줄의 원아 번호를 읽는 곳 — 반 공지·학부모 글 귀속·회수·과목 교차 — 를 함께 봐야 한다).
  - 원아 연결은 하루 한 번 만들고(20시간 주기), **새벽 정기 동기화 바로 앞에서 한 번 더 새로 만든다**(데몬 [`watch-classnote-queue.mjs`](../scripts/_classnote/watch-classnote-queue.mjs) 3-0 · 판정 = `classBoardSyncDueToday`) — 전날까지 가입한 학부모의 원아는 그 새벽 동기화가 배정한다(1인 보드 시절의 '05시 준비 → 같은 새벽 배정'과 같은 시점). 갱신이 실패하면 어제까지의 연결로 그대로 돈다(하루 한 번만 — 정기 동기화가 실패해 차례가 계속 참이어도 폴마다 로그인하지 않는다). **낮에 막 가입한 원아** = 지금 동기화(선생님 발송이 '가입 대기'로 막혀 생기는 자동 요청 — 학생 지목 · '지금 동기화' 버튼의 전체 실행 — 최근 14일 등록인데 연결 없는 학생)가 신입 준비 후보가 있으면 반 보드 동기화 **앞에서** 원아 연결을 새로 만든다(`childMapRefreshDue` · 4분에 한 번 — 앱 재요청 쿨다운 5분보다 짧게 · 실패해도 기존 연결로 계속 · 결과는 동기화 보고서 줄과 결과값 `childLinks`). 1분 자동 동기화는 학생을 싣지 않아 이 갱신을 하지 않는다 → 같은 실행에서 배정(1.0.10까지 1인 보드 준비가 하던 '당일 배정'을 잇는다).
- ~~**05시 1인 보드 준비**~~(옛 `classnote-provision-core.mjs` `dropRetiredMathTargets` — 🔴 2026-11-04 모듈째 지움 · 1.0.14 · 아래는 그 전 기록) = 수학 발송 경로가 반별(class)이면 수학 `(수학)이름` 보드를 **만들지도 원아를 배정하지도 않는다**(판정 `mathPersonalProvisionOff` — 경로를 못 읽으면 그날 수학만 건너뜀 · 기존(personal)·일부 반별(pilot)이면 종전대로). 영어 `(영어)`는 그대로 · 남은 1인 보드는 읽지도 쓰지도 않는다.
- **실데이터 드라이런**(2026-11-02, DB 조회 + ClassNote GET만 · 대상 수학 반 학생 186명 · 원아 연결 있는 학생 185명(1개 176 · 2개 9) · 연결 원아가 명부에 없는 경우 0):
  (a) 지금 상태 — 보류 2 → 1(손민우 — 원아 연결 없음) · **김재윤A는 원아 연결로 새로 배정**(초등M 개별 BS2G 1건 — 반영 뒤 첫 동기화의 실제 ClassNote 쓰기) · 나머지 그대로 ·
  (b) 남은 1인 보드 원아(대상 학생 중 11명)를 뗀 상태 — (a)와 같다(11명은 확인 기록으로) ·
  (c) 확인 기록까지 모두 지운 상태 — 182명이 원아 연결로 통과(대부분 이미 그 반 보드에 있는 원아) · 보류 4(손민우 + 명부 이름이 형제와 뒤바뀐 박세하·박세인·윤현소) · 새 배정 7(김재윤A + 연결이 2개인 학생의 두 번째 계정 6건 — 박세욱 2 · 이채아 · 윤정원 · 이준혁 · 김이현).
- **일정**(원장 승인 2026-11-02):
  - 기한 = 12월 (수학) 1인 보드 삭제 **전 필수**. 실무 마감 = **11/20 무렵까지 AywaSync 1.0.11이 연동 PC에 올라가는 것**(삭제 전 1~2주 관찰).
  - 순서 = 구현 → 실데이터 드라이런(조회만) → 적대적 리뷰 → 원장 확인 → 수업이 끝난 저녁에 main 반영 + AywaSync 1.0.11 → 다음 날 05시 정기 동기화 결과 확인 → 2~3일 이상 없으면 남은 1인 보드 유지 16명 해제 → 11월 말까지 관찰 → 12월 초 원아별 게시글(`?child=`) 백업 뒤 보드 삭제.
  - 이번 주에 하는 이유 = 이미 해제한 학생 중 27명은 동명 원아·동명 학생이라 05시 준비가 신분을 되살리지 못한다. 반 보드 확인 기록(0302a)이 휴원·반 사이 공백·보류로 한 번 지워지면 손으로 다시 배정할 때까지 그 학생의 보고서가 막힌다 — 원아 연결이 그 구멍을 막는다.

### 10.5-b 자동 해제 범위 확장 · ~~JJ 자리 반 맞춤~~ (2026-11-03 · JJ 맞춤은 11-04 되돌림)

원장 2026-11-03 *"수강종료(즉, 남은 과목이 1개라도 있거나 일부 반을 종료하는경우)는 즉시즉시"* — 자동 해제가 운영 중 수학 반 보드에서만 돌아 ClassNote에 잔류가 남았다(같은 날 읽기 전용 점검: 종강 수학 반 보드 11명 · 연결 없는 JJ 반 보드 8건 · 영어 반 방 반 이동·퇴원 12건 · 1인 보드 5건).

- **같은 판정 한 벌**(`planChildReleases` ①~⑤ — 새 가드를 만들지 않았다) + **같은 회차 상한 40**(반 보드가 먼저). 넓힌 대상은 **매일 정기 동기화(전체)에서만** — '지금 동기화'는 그 반 보드만 보는 규약 그대로(수강 종료는 종료일 다음 날부터 '끝난 기록'이라 그날 새벽이 가장 이른 정리 시점).
  - **영어 반 방**(s2_0006) — 원아만(선생님 연결은 범위 밖). 명단 밖 = 방 원아 − 그 반에 열린 수강이 있는 학생에게 연결(0185a)된 원아(나머지는 판정이 ①로 다시 본다).
    🔴 이 표는 board_id가 유니크가 아니다 — **한 방이 에이와 반 둘 이상에 이어져 있으면(폐지·종강 반 줄 포함) 통째로 둔다**(`이 반 방이 에이와 반 N개에 이어져 있어 자동 해제하지 않습니다`). 반마다 따로 계획하면 A→B로 옮긴 학생이 A 계획에서 해제돼 B반이 쓰는 방을 잃는다(리뷰 F2 · 지금 0건). 같은 번호가 수학 반 보드 표(0302a)에도 있으면 영어 방·종강 반 보드·운영 중 수학 반 보드 셋 다 둔다(`holdSharedBoards` · 지금 0건).
  - **종강 반 보드** — 종강일 + 7일(늦은 보고서 발송 기한 '오늘 포함 7일'이 지난 다음 날)부터. 선생님 = 원아가 다 정리된 보드만, 대응표의 아는 선생님 전부. 해제 리스트는 그 반 0302a 행에. 보드·지난 글·종강 반 연결 지키기는 그대로.
  - 🔑 **④(한꺼번에 많음) = 최근 7일 안에 끝난 수강만 센다**(원장 2026-11-03 *"실제 반으로 동기화시켜야되는데, 실제 반과 일치하지 않으면 이동해야지"*): 해제 후보 중 그 반(1인 보드는 그 과목) 수강 종료일이 오늘 − 7일 이후인 원아만 개수·비율에 넣고, 걸리면 **그 원아들만** 보류한다. **비율의 분모 = 지금 다니는 학생의 원아 수(보드 원아 − 명단 밖 원아) + 최근 해제 대상 수**(리뷰 A3 — 보드 전체로 나누면 묵은 잔류가 분모를 키워, 보드 30 = 묵은 10 + 오늘 사고 12 + 다니는 8에서 12/30이 통과했다. 지금은 12/20으로 보류). 1인 보드 해제는 회차 상한이 따로 10명(전체 40과 별도). ⚠️ **남는 틈**: 종료일을 **지난 날짜로 소급** 입력한 사고는 '최근'으로 안 잡혀 ④가 못 막는다 — 해제는 수강을 되살리면 다음 동기화가 다시 배정하고(되돌릴 수 있다), 퇴소는 ④-b 마지막 배정 가드가 막는다. ④가 잡으려는 것은 '오늘 누가 반 전체 수강을 잘못 끝낸' 사고라, 오래전에 끝난 수강(JJ2M의 지난 학생 6명 — 10/18 종료)은 굳은 사실로 보고 낸다. 종료일을 모르면 최근으로 센다. **종강 반 보드도 이 규칙 하나로 합쳤다** — 종강 7일 뒤에 정리하므로 그 반 수강은 이미 7일 넘게 끝나 있다(예전 '종강 보드는 ④ 대신 열린 수강 0건' 규칙은 없앴다 · 열린 수강이 남은 학생의 원아는 ①이 하나씩 보류한다).
  - **1인 보드** `(수학)이름`·`(영어)이름` — 그 이름의 학생 누구라도 그 과목에 열린 수강(휴원·시작 전 포함)이 있으면 안 본다 · 그 밖은 그 과목 수강이 끝난 기록이 있을 때. 후보는 운영관리 명부의 소속 보드(`fetchAdmissions` `boards`)로 모은다(1인 보드 수백 개를 따로 읽지 않는다). 테스트 보드 제외(`PERSONAL_RELEASE_SKIP_NAMES` + `is_test`). 보드 삭제 안 함.
  - 🔴 **휴원 학생의 원아는 어디서도 자동 해제하지 않는다**(③-b · 학생 상태 on_hold) — 휴원 9명 중 8명이 열린 수강 0건이었다(수강 종료일을 넣고 휴원). 운영 중 수학 반 보드에도 같이 걸린다. ① 대조 상대에도 **그 반(1인 보드는 그 과목)에 끝난 기록이 있는 휴원 학생**을 넣는다(리뷰 A4 — 원아 연결이 형제에게 잘못 붙은 경우 휴원생 원아가 '명단 밖'으로 빠진다 · 사유는 '휴원 중입니다').
  - 2026-11-03 리뷰로 더한 가드(A1·A2·A5~A8):
    - 🔴 **실행부 실시간 가드는 우리 센터 줄만 센다**(A1) — `kapi …/v1_2/children/{원아}/enrollments`는 **다른 학원 배정까지** 준다(`center_id`·`center_name` 칸 · 실측 413명 중 22명 29줄 · `is_approved: null` 2줄은 모두 남의 학원). 우리 배정 1 + 남의 배정 1인 원아 3명이 '배정 2개'로 보여 우리 마지막 배정을 뗄 뻔했다. '남는 배정'·해제 뒤 0·'다른 배정이 함께 사라짐'·떼는 줄 고르기 전부 `center_id === 우리 센터 && is_approved === true && !removed_child && !date_left` 줄만(`center_id` 칸이 없으면 안 셈).
    - 계획 가드(`guardLastEnrollment`)의 남는 배정도 **승인된 것만**(A2 — 명부 `boards` = `is_approved === true` · null·칸 없음은 안 셈). 명부의 배정 칸이 배열이 아니면 `boards`·`boardNames`를 null로 두어 '모름'으로 보류한다(B3).
    - 1인 보드 ①은 연결된 학생만이 아니라 **그 과목 열린 수강생 전체**와 이름·보호자 전화를 대조한다(A5 — 한 사람이 기록 둘로 갈린 경우 #148). 보호자 전화는 명부의 carer 전화 전부.
    - 영어 반 방은 주인이 **방 연결이 없는 다른 영어 반**에 열린 수강이 있으면 보류(A6 — 실제로 같이 쓰는 그룹 방이 한 반에만 연결된 경우).
    - 실행부에서 **안 내보낸 원아가 보드에서 사라지면** 멈춤 표식(`haltRelease`)까지 세운다(A7 — 회차만 멈추면 1분 자동 동기화가 곧 이어 간다 · 내보낸 원아가 그대로인 stuck은 지금처럼 회차만).
    - `(영어)…`·`(수학)…`로 시작해도 수학 반 보드 표·영어 반 방 표에 있는 번호는 1인 보드 계획에서 뺀다(A8).
    - 학생이 없어 일부러 안 만든 JJ 반은 보고서에 '실패'가 아니라 '보류' 안내로 적는다(C1 — 실패 수·버튼 숫자·감사로그 '실패 N건'에 안 든다). 11-04 되돌림 뒤에는 미발송 JJ 반이 대상 밖이라 쓰이지 않는다.
  - 🔴🔴 **마지막 배정은 떼지 않는다**(④-b — 모든 종류 · 운영 중 수학 반 보드 포함): ClassNote는 원아의 마지막 반 배정을 빼면 그 원아를 **자동 퇴소**시킨다(11-02 해제로 배정 0이 된 2명이 그날 퇴소 · 되돌리는 API 없음 — §11). 운영관리 명부의 승인된 소속 배정([ALL]·그룹 보드·1인 보드 포함)을 세어 이번 회차 해제를 모두 합친 뒤 0개면 하나를 남긴다 — **가장 최근에 끝난 반**(그 원아의 최근 글이 있는 곳이라 45일 뒤 퇴원처리까지 학부모가 보는 자리로 맞다) → 같으면 반 보드(1인 보드는 12월에 지운다) → 같으면 계획 순서 뒤 · 명부를 모르거나 명부와 어긋나면 보류. 실행부도 해제 직전 실시간 배정으로 다시 막고(그 건만 실패), 해제 뒤 남은 배정 0이면 자동 해제를 멈춤 표식으로 세운다. 전 과목 퇴원생은 45일 뒤 퇴원처리(§11)로 정리한다.
- 🔴 **2026-11-04 되돌림** — 원장 *"JJ 미발송반은 클래스노트 반배정도 할 필요없음"*: 대상 반 조각(`targetClassWhere`)·종강 연결 지키기(`loadClosedLinked`)에 미발송 조건(`not c.report_optout`)을 다시 넣었다(연동 PC 1.0.13부터). 미발송 반은 연결·배정·해제·담임 연결 대상이 아니고, 남은 옛 연결은 정기 동기화가 걷는다. 🔑 그래서 ClassNote 쪽 미발송 JJ 보드에 남은 지난 원아를 떼는 자동 경로가 없다 — 명부 퇴원처리(§11)는 남은 배정이 전체방·본인 1인 보드뿐일 때만 내리므로 그 원아는 '반 배정이 남아 있음'으로 보류된다(퇴원처리를 켜는 날 사람이 ClassNote에서 정리). 원스크린 C.N 아이콘 대상과 같은 조건 — 가드 `src/features/onescreen/classnote-target-guard.test.ts`. 아래 11-03 문단은 기록으로 남긴다.
- ~~**JJ 자리 반**(`classes.report_optout`) — 대상 반 조각(`targetClassWhere`)에서 미발송 조건을 뺐다~~(자동 동기화·지금 동기화도 같은 조각). 보고서 발송은 그대로 막힌다(앱 `liveBoardClassIds`·`isSendCandidateClass` · 워커 `isClassRouteEligible` + `resolveClassTargets` 연결 조회에 `not report_optout`). **새 보드는 지금 다니는 학생이 1명 이상일 때만 만든다**(원장 2026-11-03 *"반에 학생이 있다면 배정해야함. 없으면 굳이 만들필요 없음."* · 학생 0명 = 보류 `OPTOUT_NO_CREATE_REASON` — 그런 반은 지금·자동 동기화가 '새 반'으로 고르지 않는다 · `classDiffReasons`). 같은 이름 보드에 **그 반의 지난 학생**만 남아 있으면 채택(`formerFamilyOf` — 해제 판정 ①②③ 통과)하고 그 원아는 자동 해제가 정리한다(④에 걸리면 해제 리스트). 영상 담임 경로는 JJ 보드를 게시 반으로 잇지 않는다(JJ 제외 규칙 유지) · 원스크린 C.N 라벨은 대상 반 기록만 쓴다(JJ 기록이 '다른 반 보드' 물음표로 새지 않게) · 종강 반 연결 지키기(`loadClosedLinked`)도 JJ 포함 · 반 단체 공지는 '미발송 = 수업보고서만'(notice-actions.ts) 규칙대로 연결된 JJ 반도 고를 수 있게 된다. ~~❓ 원장 확인 대기~~ → ✅ **해당 없음(2026-11-04 — 미발송 JJ 반은 다시 연결하지 않는다)**. 옛 질문: 연결된 JJ 보드는 보고서만 안 보내고 나머지는 다른 반 보드와 같다 — 학부모 글 벨(학생을 정하면 그 학생의 지금 수학 담당 · 못 정하면 JJ 반 담당) · 답글 · 공감 · 반 단체 공지 대상이 새로 생긴다(지금까지 JJ 보드 학부모 글은 아무에게도 안 갔다) · 개별 공지는 JJ를 계속 뺀다(decisions/reports-ai.md).
- 끄기: 코드 스위치는 넓힌 대상만 `CLASSNOTE_BOARD_AUTO_RELEASE_EXTRA=off` · 전부 `CLASSNOTE_BOARD_AUTO_RELEASE=off`지만 🔴 **PC에서 스위치를 바꿀 길이 지금은 없다** — 연동 앱 화면은 ID/PW만 저장하고 워커 env는 그 저장소 값(허용 목록 `CREDENTIAL_KEYS`)뿐이라 `CLASSNOTE_BOARD_AUTO_RELEASE`·`CLASSNOTE_BOARD_AUTO_RELEASE_EXTRA`·`CLASSNOTE_OFFBOARD`를 PC에서 넣을 수 없다. **즉시 멈춤 = 멈춤 표식 파일**: 연동 PC 상태 폴더 `%LOCALAPPDATA%\AYWA\Sync\tenants\{지점 id}\state\classnote\`에 만든다(해제 = `class-board-release-halt.txt` — 이것 하나로 명부 퇴원처리도 쉰다 · 퇴원처리만 = `classnote-offboard-halt.txt` · 내용 = 사유 · 지우면 다음 회차부터 재개). **되돌리기 = 옛 코드를 새 순번으로 다시 게시**한다 — 업데이트는 순번 앞으로만 가고 PC에서 내릴 길이 없으며 릴리스를 거둬도 깔린 PC는 내려가지 않는다(옛 커밋의 워커로 `package.json` 버전과 `EYWA_AGENT_SEQUENCE`를 올려 release → publish-release → register-release · apps/sync-agent/README). ⚠️ 옛 폴더 가져오기(`copyLegacyState`)는 덮어쓰지 않지만(force:false) 옛 폴더의 `class-board-release-halt.txt`·옛 진행 표식이 새 상태 폴더에 **더해져** 뜻밖에 멈추거나 건너뛸 수 있다 — 가져온 뒤 상태 폴더의 표식 파일을 확인한다. 미리 보기 = [`plan-class-board-release.mjs`](../scripts/_classnote/plan-class-board-release.mjs)(JJ 연결·배정 계획 — 11-04 되돌림 뒤엔 늘 빈 목록 + 종류별 해제·보류 · `--json`). 조회를 못 하면 넓힌 대상만 건너뛰고 반 보드 해제는 한다.
- **알려진 한계**: 종료일을 **지난 날짜로 거슬러 넣은 일괄 종료**는 ④(최근 7일)를 지나간다 — `enrollments`에 고친 시각(updated_at)이 없어 '오늘 넣은 종료'를 가릴 수 없다. 대신 회차 상한(전체 40 · 1인 보드 10) · ④-b 마지막 배정 가드(퇴소 방지)가 피해를 묶고, 해제는 되돌릴 수 있다 — 사람이 종료일을 바로잡으면 다음 동기화의 배정 쪽이 다시 넣는다.
- 파일: 대상 만들기 [`class-board-release-targets.mjs`](../scripts/_classnote/class-board-release-targets.mjs)(순수) · 조회 묶음 [`class-board-release-extra.mjs`](../scripts/_classnote/class-board-release-extra.mjs) · 판정 [`class-board-release.mjs`](../scripts/_classnote/class-board-release.mjs). 보고서 줄 반 이름 머리 = `영어 반 방 · ` · `종강 반 보드 · ` · `1인 보드 · ` · 감사로그 `metadata.boardKind`.
- 실데이터 드라이런(2026-11-03 저녁 · 리뷰 반영 뒤 최종, DB select + ClassNote GET만): 원아 해제 28(반 보드 8 = JJ2M 지난 학생 6 + JJ3L·JJ1K 각 1 · 영어 반 방 8 · 종강 반 보드 6 · 1인 보드 6 — 같은 날 17시 퇴원보고서로 수강이 끝난 김소은·김태린·김덕현·손라임이 새로 올랐다 · JJ2M 6명은 지금 다니는 JJ2I 보드에 이미 있다) · 보류 9(휴원 3 · 이 반 학생 원아일 수 있음 1 · **방 연결 없는 다른 영어 반에 다님 3**(A6 — 강민준·정찬혁 → 중등E_초등 브릿지 E · 박서준C → 고등E_중3 최상위) · **과목 수강생 전체와 보호자 전화 같음 1**(A5 — 이지아A ↔ 수학 이연아) · **마지막 배정 1 = 박예서 `(영어)박예서` — 전 과목 퇴원생**, 45일 뒤 퇴원처리 몫) · 담임 해제 4(종강 반 보드) · JJ 반 20개 = 연결 15(지난 학생 남은 보드 채택 3) · **새 보드 4**(JJPS 4명 · JJ2A 9명 · JJ2G 3명 · JJ1A 8명 — 원아 26 · 주말 내신 특강은 학생 0이라 안 만듦) · 기존 보드 새 배정 2(박세욱 → JJ1I · 이영준 → JJ2L) · 종강 7일 대기 2개(11/06부터). 독립 대조: 해제 28건 중 그 반(과목)에 열린 수강이 있거나 휴원인 주인 후보가 걸린 건 0 · 해제 뒤 배정 0이 되는 원아 0명.
- 연동 앱(AywaSync): 새·바꾼 조회가 질의 목록(`query-catalog.json`)에 실렸다 — **웹 먼저 배포** 뒤 연동 PC 새 버전.

### 10.6 반 이름 변경 대비 — 개명 감사(2026-09-30)

원장 *"클래스노트 발송중에 에이와가 반이름이 바뀌어서 동기화 전이면? 모든 가능성에 대비"* → 적대 감사 후 전부 수리.
발송은 원래도 **번호**(`class_id`→`board_id`)로 가서 개명 자체로 남의 집에 가는 길은 없었다. 구멍은 **동기화가 이름 충돌을 만나면 연결을 지우던 설계**에서 이어졌다.

| # | 구멍 | 고침 |
|---|---|---|
| G1 | 연결된 반의 새 이름이 다른 보드와 겹치면 연결·멤버를 지웠다(→ 다음 날 이름으로 엉뚱한 보드 채택·보드 중복) | 연결은 **지킨다**(`renameBlocked`, 번호로 계속 발송) — 이름만 안 바꾸고 로그 |
| G7 | 공백만 바꾼 개명("중3 A"→"중3A")이 **자기 보드**와 '공백만 다름'으로 걸려 영구 보류 | 충돌 판정에서 연결된 자기 보드 제외 |
| G2 | 연결 없는 반이 같은 이름 보드를 **원아 확인 없이** 채택(폐지 반 옛 보드·사람이 만든 보드·`(수학)이름` 모양) | 채택 전 그 보드 원아 ⊆ 이 반 가족 확인, 아니면 보류 · `(…)`·`[ALL]` 모양은 반 보드로 안 씀(`reservedBoardName`) · 앱도 그런 반 이름을 저장 거부(`reservedClassNameReason` — 반 수정·예약 적용 cron·엑셀·레벨 변경) |
| G3 | 게시 전·실패 후 중복 확인이 **보드까지** 맞춰야 일치 — 그 사이 경로가 바뀌면 같은 집에 한 번 더 | 중복 확인은 원아 + 공유 링크(옛·새 주소)만(`findChildReportId` `cls:null`) |
| G4 | 학부모 글·댓글 벨이 `보드명|원아` 키 — 개명 당일 조용히 버려짐, 조회 실패도 삼킴 | 보드 번호 키 + 실패 throw(워터마크 안 전진) |
| G8 | 반 하나의 생성·개명 검증 실패가 **동기화 전체**를 매일 멈춤 | 그 반만 보류하고 나머지·기록은 계속 · 새 보드는 응답 성공 + 이름(공백만 무시) 일치 + 예약 모양 아님일 때만 번호로 연결, 아니면 그 반 보류(확인 안 된 보드에 원아를 넣지 않는다) · 예약 적용 cron이 규칙 때문에 건너뛴 반 이름은 감사로그(`skipped`)·표식(`skippedNames`)에 이유와 함께 |
| G9 | 동기화의 연결표 조회가 실패를 빈 지도로 삼킴 → 이름으로 후퇴 | `loadLinkedBoards` 기본값 strict |
| G5 | 1인 보드 레일의 동명이인 방어가 생년뿐(같은 학년 동명이인 통과) | 모호한 이름이면 보호자 전화도 대조 — **확실히 다를 때만** 보류(`homonym-phone-gate.mjs`, 모르면 종전대로 · 안은지·박세욱 2계정은 통과 · '발송 보류 예외' 등재 보드는 건너뜀 = 사람 판단이 최종) |
| G6 | PC 두 대가 같은 지점을 돌면 게시 중인 행을 되살려 중복 게시 가능(stale 10분 = 게시 상한 10분) | 하트비트 표를 임대로 — 실게시 PC는 지점당 한 대(먼저 시작한 PC, **DB 시계로** 180초 무응답이면 이어받음, 하트비트는 폴과 따로 30초마다 갱신 · 같은 PC 두 번째 창은 잠금 파일 `worker.lock`, `worker-lease.mjs`) · stale·멈춤복구 15분 + **게시 직전 처리 시각 갱신**(되살아난 행이면 게시 생략) |

### 10.7 지금 반 보드 동기화 버튼 — 2026-09-30 (0313a)

원장 *"지금 반 보드 동기화 버튼을 만들자. 보고서 설정 말고도 실제로 필요한 곳에 모두 만들고, 한번 누르면 다른곳에서 누르지 못하도록 중복 발동 방지작업"* ·
*"너무 과부하 일어나지 않게 필요한것만 동기화하게"*.

| 구성 | 파일 | 역할 |
|---|---|---|
| 요청 표 | `supabase/migrations/s1_season1.sql#0313a_classnote_sync_requests.sql` | 지점당 살아 있는 요청(대기·실행 중) **하나** — 부분 유니크. 쓰기 = 서버 액션(admin)·워커만. 학생 계정 읽기 금지 |
| 앱 판정(순수) | [`classnote-sync.ts`](../src/features/report-admin/classnote-sync.ts) | 범위 합치기 · 멈춤(대기 30분·실행 20분) · 쿨다운 5분 · 버튼 상태 · 연동 PC 준비(살아 있음 + `postMode` + `caps.syncRequests`) |
| 서버 액션 | [`classnote-sync-actions.ts`](../src/features/report-admin/server/classnote-sync-actions.ts) | `requestClassnoteBoardSync` · `getClassnoteSyncStatus` — 모듈·권한·열람 전용 게이트, 23505 = 합류 |
| 버튼 | [`classnote-sync-now-button.tsx`](../src/features/report-admin/components/classnote-sync-now-button.tsx) | 대기·실행 중 10초 폴링 · 누르는 즉시 잠금 · 실패 사유 한글(원문은 툴팁) |
| 워커 | [`classnote-sync-request.mjs`](../scripts/_classnote/classnote-sync-request.mjs) + [`sync-request-plan.mjs`](../scripts/_classnote/sync-request-plan.mjs)(순수) | 원자적 집기(`skip locked` + `status='pending'`) · 바뀐 반 고르기 · 신입 1인 보드 준비 → 그 반만 반 보드 동기화 |

- **무엇을 동기화하나(과부하 방지)**: aywa DB만 보고(ClassNote 조회 0회) 0302a 기록과 달라진 반만 고른다 — ① 누른 자리가 지목한 반·학생 ② 연결 없는 새 반 ③ 이름이 바뀐 반 ④ 기록에 없는 학생(신입·반 이동) ⑤ '배정 전' 보류 ⑥ 반을 떠난 학생이 기록에 남음 ⑦ 최근 14일 등록 학생의 가입 대기 보류. **상한 15개**(우선순위 순, 남은 수는 결과에). 신입 1인 보드 준비는 최근 14일 등록 + 원아 연결(0185a) 없는 학생만, **보드 생성+배정 20건 상한**(수학이 반별이면 수학은 건너뛴다 — §10.5-a). 달라진 게 없으면 **ClassNote에 로그인조차 하지 않는다**("변경 없음").
- **하지 않는 일**: 원아 매핑(0184a)·반 구성 스냅샷(0142a)은 반 보드 동기화의 입력이 아니라 수동 실행에서 뺐다(새벽 그대로). **담임 변경**은 aywa에 바뀐 시각이 없어 차이로 못 잡는다 — 그 반을 지목하면(scope) 함께 된다, 아니면 새벽.
- **요청 수(ClassNote)**: 반 하나(학생 10명) ≈ 로그인 + 보드 목록(~6쪽) + 운영관리 명부 1 + 원아 조회 ~11 × 2(적용 전·후) + 배정 확인 ~20 + 담임 1 ≈ **60건 안팎**. 새벽 전체 동기화는 대상 반 전부의 1인 보드·반 보드를 두 번 읽어 **~900건 이상**. 변경 없음 = **0건**.
- `loadPlan`은 이제 **계획의 반에 연결된 보드만** 원아를 읽는다(예전엔 연결된 전 반 보드를 읽었다 — 계획이 쓰지 않는 값이라 새벽 결과는 같다).
- 🔴 **일부 반만 본 실행은 0302a를 그 반들만 다시 적는다**(`writeClassBoardSnapshot` `scoped`). 계획 밖 반 = "이번에 안 본 반"이지 "대상에서 빠진 반"이 아니다 — 끝의 정리를 돌리면 한 번에 다른 모든 반 연결이 지워진다. 종강 반 연결 지키기도 전체 실행의 몫이다.
- 🔴 **새벽 정기 동기화의 '오늘 함' 표식은 건드리지 않는다**(옛 `provisionDailyOnce` force = 표식 없음 — 2026-11-04 지움). 한 폴 루프라 수동·새벽이 동시에 돌 수 없다(차례로).
- **중복 발동 방지**: DB 부분 유니크(어느 화면·어느 사람이 눌러도 하나) → 다른 곳 버튼은 '요청됨 · 연동 PC 대기 중'/'동기화 중…'으로 잠김. 대기 중에 또 누르면 범위만 합친다(`merge_count` 낙관적 잠금). 끝난 뒤 **5분 쿨다운은 서버가 강제**(화면 잠금은 우회된다).
- **멈춤**: 대기 30분(연동 PC 꺼짐)·실행 20분(멈춤) = 실패로 내리고(앱이 누를 때 · 워커가 폴마다) 곧바로 다시 받는다(쿨다운 없음). 워커가 실행 중 재시작되면 그 PC 이름의 실행 중 요청을 실패로 내린다.
- **실행 중에 또 누르면**: 워커는 집을 때 범위를 이미 읽었으므로 합류분은 `next_scope`에 적고, 워커가 끝내는 **같은 트랜잭션**에서 그 범위로 새 대기 요청을 만든다(쿨다운 없이 이어서 돈다). 멈춘 실행 중 요청의 `next_scope`는 앱이 새 요청에 싣는다. 🔴 버리면 합류한 반이 쿨다운·새벽까지 밀린다(2026-09-30 적대 리뷰).
- **신입 1인 보드 준비**: 대상 계산(aywa DB)이 ClassNote 로그인보다 **먼저** — 범위 안에 발송 과목 학생이 없으면 로그인하지 않는다.
- **받지 않는 경우**: 모듈 꺼짐(버튼 없음) · 0313a 전(버튼 없음, 워커는 10분마다 표를 다시 확인) · 반 보드를 한 번도 안 쓴 지점(버튼 없음) · 실게시(`--post`) 새 워커가 살아 있지 않음(버튼은 보이되 잠기고 사유). dry-run 워커는 집지 않는다.
- **권한**: 보고서 쓰기(원장·관리자·매니저) + **강사**(원스크린 '보낼 반' 고르기에서 필요가 생긴다 — 요청은 새벽과 같은 가드·상한·쿨다운이라 안전). '다른 강사 뷰'(열람 전용)는 막는다.
- **자리 4곳**: 보고서 설정 '수학 발송 경로'(반별·시범일 때) · 발송 관리 'ClassNote 발송 큐' 관리 버튼 줄 · 반 단체 공지(새 반은 연결 뒤에야 목록에 뜬다) · 원스크린 '보낼 반' 고르기 창. 원스크린의 '보낼 반이 없어 발송할 수 없습니다' 알림(토스트)·원스크린 C.N 아이콘(툴팁)·관리자 직접 작성 '보낼 반' 칸에는 **아직 없다**(같은 날 보강 경로 작업이 그 파일들을 고치는 중이라 병합 뒤에 붙인다). 다만 2026-10-03부터 **정규 보고서가 반 보드 배정 전이라 막히면 버튼 없이도 그 자리에서 요청이 나간다**(같은 요청 함수 · `source: "send_blocked"` — 까닭이 '배정 중'·'새 반'·'가입 대기 보류'일 때만 — 그 밖의 보류·반을 떠난 학생은 요청하지 않는다. 상세 [`decisions/reports-ai.md`](decisions/reports-ai.md)).
- **감사로그**: `classnote_board_sync_request`(누른 사람 — 합류 포함) · `classnote_board_sync_run`(연동 PC 직접 insert, 실행자 `system:classnote-sync-now` — 반·배정·보류·남은 반 수, 실패 사유).
- ⚠️ **워커 zip 교체 필요** — 옛 워커엔 `caps.syncRequests`가 없어 앱이 요청을 받지 않는다(버튼이 '연동 PC가 꺼져 있거나 옛 버전' 사유로 잠김).


### 10.7-a 반 보드 자동 동기화 — 2026-10-03 (SQL 없음)

버튼을 누르지 않아도 aywa의 반 이름·학생 배정·담임 변화가 그 반만 ClassNote에 반영된다. 워커가 **요청 한 줄을 스스로 넣는 것**이 전부이고, 그 뒤는 10.7과 같은 길이다.

| 층 | 파일 | 하는 일 |
|---|---|---|
| 조회 | [`auto-sync-load.mjs`](../scripts/_classnote/auto-sync-load.mjs) | aywa DB만(한 번의 왕복) — 대상 수학 반·지금 학생 id·담임 id·반 보드 연결·그 반들의 지난 동기화 기록. 학생 전체·전화·사유 글은 읽지 않는다 |
| 판정 | [`auto-sync-plan.mjs`](../scripts/_classnote/auto-sync-plan.mjs) | 달라진 반(`detectAutoChanges`) → 완충·간격·되풀이 방지(`planAutoSync`) → 끝난 결과 반영(`settleAutoRequest`). 순수 |
| 실행 | [`classnote-auto-sync.mjs`](../scripts/_classnote/classnote-auto-sync.mjs) | 1분에 한 번 대조 → `classnote_sync_requests`에 `{classIds, auto:true}` 한 줄(`on conflict do nothing`) + 감사로그 |
| 워커 루프 | `watch-classnote-queue.mjs` 2-c-0 | 요청 처리(2-c) **바로 앞** — 넣은 요청을 같은 폴이 집는다. `caps.autoBoardSync`(실게시 PC에서 켜져 있을 때만 참 — 앱의 버튼 설명 문구가 읽는다) |

- 흐름 예(낮): 13:00 학생을 새 반에 배정 → 13:01 워커가 차이를 봄 → 13:11(넣는 쪽은 10분 그대로) 요청 → 같은 폴에 그 반만 동기화 → 보고서·감사로그('자동 동기화'). 반 이름·담임 변경은 2분 뒤. 넣는 쪽은 계속 바뀌는 동안에는 나가지 않는다(마지막으로 바뀐 뒤 10분) — 개명·담임·반을 떠난 학생만 계속 바뀌어도 30분이면 그때 상태로 간다. 반 이동의 **옛 반 해제는 다음 날**이다(옛 수강의 종료일이 그날이라 '끝난 수강'이 되는 것은 다음 날 — 새벽 정기 동기화가 한다).
- 밤(23:00~06:00)에는 돌지 않는다 — 자정에 날짜가 바뀌며 생기는 차이(예약된 수강 시작·종료)와 예약 작업(퇴원 00:05 · 반 이름·담임 00:30 · 종강 00:35)의 결과는 지금까지처럼 새벽 5시 정기 동기화가 한 번에 맞춘다(전체 반 + 가입 대기 재확인 + 신입 준비).
- 시간(2026-10-03 실측): 대조 = 왕복 약 28ms(DB 실행 2ms 안쪽) · 달라진 반 5개의 계획 읽기 = 로그인 3초 + 5초. 동기화가 도는 동안 같은 루프의 발송은 그만큼 기다린다(지금 동기화 버튼과 같다 — 한 번에 반 15개까지, 요청 사이 5분).
- 실패: 자동 요청이 실패로 끝나면 5 → 15 → 60분 간격으로 다시 한다. 같은 상태로 세 번 실패하거나, 끝났는데도 두 번 안 풀리면 상태가 바뀔 때까지 두고 로그에 한 줄 남긴다(`더 시도하지 않는 반 N개`). 담임 변경은 따로 센다 — 학생·이름 쪽이 멈춘 반이라도 그 뒤 바뀐 담임은 한 번 보낸다. ⚠️ 한 요청에 묶인 반은 실패도 함께 센다(한 보드 때문에 세 번 실패하면 같이 묶인 반도 그 상태로는 멈춘다 — 새벽 정기 동기화가 맞춘다).
- 버튼 설명: 요청을 받는 연동 PC가 전부 `caps.autoBoardSync`를 내걸 때만 "낮 동안 달라진 반을 스스로 맞춘다"고 적는다. 연동 PC를 바꾸기 전·`off`·`observe`인 지점은 예전 설명 그대로다.
- 연동 PC 설정: `CLASSNOTE_BOARD_AUTO_SYNC=off`(끔) · `observe`(무엇을 요청하려는지 로그에만). 기본은 켜짐.
- 로그 머리 = `[auto-sync]`. 같은 대기 사유는 바뀔 때만 한 번 적는다.

### 10.8 학부모 글·댓글에 답글 — 2026-09-30 (0317a) · 2026-10-01 학원 설정 모드(끔·시험·전체)

원장 *"이전 1인 반에서 작동하는 기능을 반 기준으로 바꿔도 작동하게"* — 1인 보드 시절엔 보드에 연결된 강사가 ClassNote 앱에서 직접 답글을 달았다.
반 보드엔 담임 한 명만 연결되므로, aywa에서 쓰고 **연동 PC 워커가 봇 계정으로 그 글에 댓글**을 올린다(게시·수정·삭제).

| 구성 | 파일 | 역할 |
|---|---|---|
| 표 | `supabase/migrations/s1_season1.sql#0317a_classnote_parent_replies.sql` | 답글 1행 = 요청·상태·ClassNote 댓글 번호·원문 보존(`edit_history`). 쓰기 = 서버 액션·워커만. 재클릭 = `client_key` 유니크 · 같은 글·같은 본문(살아 있는 것) = 부분 유니크(23505로 받음, [[#113]]) |
| 설정 | 수업보고서 > 보고서 설정 > 발송 탭 '학부모 글 답글·공감'([`classnote-reply-mode-field.tsx`](../src/app/(shell)/owner/_components/classnote-reply-mode-field.tsx)) | `report.classnoteParentReplyMode` = 끔(기본)·시험·전체. 저장 = `saveOwnerSection`. 읽기 = 앱 [`classnoteReplyMode`](../src/features/owner/classnote-gate.ts)(모듈이 꺼지면 끔) · 워커 `loadReplyMode`(DB 직결, 폴마다) |
| 앱 판정(순수) | [`reply-policy.ts`](../src/features/classnote-reply/reply-policy.ts) · [`reply-eligibility-rule.ts`](../src/features/classnote-reply/reply-eligibility-rule.ts) · [`notification-match.ts`](../src/features/classnote-reply/notification-match.ts) | 모드별 대상 · 전체 모드 사전 확인 · 본문 1,000자 · 게시 명의 · 상태 라벨 · 연동 PC 준비(`caps.parentReply`) · 자격 · 벨 알림 → 원문 행 |
| 서버 액션 | [`reply-actions.ts`](../src/features/classnote-reply/server/reply-actions.ts) (+ 첫 문 [`reply-gate`](../src/features/classnote-reply/server/reply-gate.ts) · `reply-permission`·`reply-change`·`reply-data`·`reply-eligibility`) | 입력 = 메시지 행 id + 본문 + 재클릭 키. 글·원아·보드는 0184a 행으로 다시 찾는다 |
| 화면 | 벨 알림 행 '답글 쓰기' → [`parent-reply-dialog.tsx`](../src/features/classnote-reply/components/parent-reply-dialog.tsx) · 수업보고서 '학부모 글·답글' 면 | 원문 · 답글 상태(10초 갱신) · 미리보기(학부모가 볼 이름표+본문) · 확인 창 · 보내는 동안 잠금 · 실패 사유 한글(원문은 툴팁) · 수정·삭제 |
| 워커 | [`classnote-parent-reply-core.mjs`](../scripts/_classnote/classnote-parent-reply-core.mjs)(큐·DB) + [`parent-reply-run.mjs`](../scripts/_classnote/parent-reply-run.mjs)(**ClassNote 쓰기는 여기서만**) + 순수 [`parent-reply-guard.mjs`](../scripts/_classnote/parent-reply-guard.mjs) + [`parent-reply-api.mjs`](../scripts/_classnote/parent-reply-api.mjs) | 한 폴 한 건 · `skip locked` · 멈춤 15분 복구 · 감사로그 `classnote_parent_reply_run`(실행자 `system:classnote-parent-reply`) |
| 1회 실행 | [`process-parent-replies.mjs`](../scripts/_classnote/process-parent-replies.mjs) `--id <답글> [--check \| --post]` | 개발 PC 시험·수동 복구. **하트비트를 쓰지 않는다**(실게시 임대를 가로채지 않게) |

- **게시 명의** = `<반 이름> <강사 호칭>`(원장 결정 — 본문 서명 없음). 반 보드 = 보드 이름(= aywa 반 이름) — 단 **반 보드로 확인된 것만**(0302a 연결 · 시험 단계 테스트 보드). 확인 안 된 보드 이름은 학생 이름일 수 있어 싣지 않는다. 호칭이 비면 요청을 받지 않는다(반 이름만 남은 명의 금지). 1인 보드 `(수학)학생명`은 학생 이름이라 쓰지 않고
  그 학생이 **오늘 다니는** 그 과목 반(내가 맡은 반 우선 — 벨 수신자와 같은 수강 판정, 미래 시작 반 제외) → 모르면 과목 라벨("수학 수진T"). 호칭 = 발송용 이름(0217a) > 표시 이름(보고서 작성자명과 같은 규약). 60자 상한.
- **자격** = 원장·관리자·매니저 ∪ **학부모 글 벨 수신자와 같은 판정**(원장 2026-09-30 정정: 현재 담당만) — 워커 순수 함수
  `planNotifyRecipients`·`classWideRecipients`·`finalizeRecipients`([notify-recipients.mjs](../scripts/_classnote/notify-recipients.mjs))를 앱이 **그대로** 부른다
  ([`reply-eligibility-rule.ts`](../src/features/classnote-reply/reply-eligibility-rule.ts)는 행 → 입력 변환뿐). 수정·삭제 = 작성자 본인 또는 관리자급. 관리자급엔 보호된 계정(`isCurrentUserSuperAdmin`)이 자동 포함된다(decisions/staff.md).
- **게이트 순서(서버)**: 로그인·학생 아님 → 모드(학원 설정 — ClassNote 모듈이 꺼지면 끔. **끔이면 '사용할 수 없는 기능입니다'** = 모듈 꺼진 학원과 같은 답) → 발송 스위치 → '다른 강사 뷰'(열람 전용) → 자격 → 전체 모드의 대상 확정 → 연동 PC(살아 있음 + 실게시 + `caps.parentReply`) → 본문·쿨다운 20초 → 감사로그.
  모든 서버 액션(답글·공감)의 첫 줄이 [`replyGate`](../src/features/classnote-reply/server/reply-gate.ts)다(가드 `reply-mode-wiring.test.ts`가 새 액션이 그 문을 빼먹으면 잡는다).
- **워커 안전장치**: ① `--post` + 모듈 + 발송 스위치 ② 모드 가드 — 모드는 **폴마다 DB에서 다시 읽는다**(끔이면 아무것도 집지 않는다 — 큐 보존·로그 없음). 행이 허락 밖이면 **ClassNote에 접속(로그인)조차 하지 않는다** ③ 쓰기 직전 원글을 다시 읽어 보드·원아 대조 + (시험) 테스트 보드 원아가 전부 `학원*` / (전체) 아래 확정 연결 규칙
  ④ 게시 직전 댓글을 다시 읽어 **같은 본문의 봇 댓글이 있으면 올리지 않고 성공** ⑤ 게시 뒤 다시 읽어 확인 — 같은 글자가 없으면 **쓰기 전엔 없던 봇 댓글** 중 응답이 준 번호(또는 공백만 다른 것)를 찾는다.
  응답이 불확실하고(5xx·끊김) 새 댓글도 없을 때만 재시도(3회) — 다시 못 읽으면 쓰지 않는다 ⑥ 수정·삭제는 번호가 같고 학부모 것이 아니며 **내용이 aywa 기록과 같은** 댓글만(누가 ClassNote에서 고쳤으면 손대지 않는다).
- 🔴 **쓰기 직전 마지막 문 = 허가증**(적대 리뷰 2026-09-30 · 2026-10-01 강화): `evaluateReplyTarget`이 **발급한 그 객체**(보드·원아·**글 번호**·모드·근거)를 쓰기 함수
  `writeComment`·`deleteComment`·`writeReaction`·`deleteReaction`이 인자로 받아 요청 직전에 `assertReplyWritePermit(permit, 글, 모드)`로 다시 본다 — 손으로 만든 객체·복사본은 값이 맞아도
  통과하지 못한다(발급 목록 WeakSet · 고칠 수 없게 동결). 🔴 **모드는 쓰기 직전에 DB에서 한 번 더 읽는다**(`recheckMode`) — 대상을 확인한 뒤 끔·시험으로 내렸으면 쓰지 않고
  요청은 대기로 남긴다(다시 켜면 이어서 간다, 24시간 상한은 그대로). 모드를 정하는 자리는 코어 `loadReplyMode` 하나다(환경변수·실행 인자·코드 상수 없음 — 가드 테스트가 잠근다).
  쓰기 함수를 부르는 파일은 `parent-reply-run.mjs`(댓글)·`parent-reaction-run.mjs`(공감) 둘(가드 테스트 [`parent-reply-run.test.mjs`](../scripts/_classnote/parent-reply-run.test.mjs)가 가짜 ClassNote로 쓰기 경로 전체를 돌리고, 호출 파일·export 목록·뒷문 없음을 잠근다).
- 🔴 **2xx 뒤 "같은 글자를 못 찾았다 → 다시 게시" 금지**: ClassNote가 본문을 다듬어 저장하면 글자 대조가 빗나가 같은 답글이 세 번 나간다. 2xx + 응답의 댓글 번호면 만들어진 것으로 적는다.
  반대로 "새로 생긴 봇 댓글이 하나뿐이니 그것"으로 넓히지도 않는다(그 사이 사람이 직접 단 댓글을 내 것으로 적으면 답글은 안 나갔는데 '게시됨'이 된다) — 번호나 글자라는 증거가 있을 때만.
- **묵은 요청**: 새 답글은 요청한 지 **24시간**이 넘으면 올리지 않는다(발송 스위치를 며칠 내렸다 올리거나 연동 PC가 오래 꺼져 있던 뒤 뒤늦게 나가는 것 방지). '이미 올라가 있나' 확인 **뒤**에 건다 — 수정·삭제엔 걸지 않는다.
- **같은 본문 유니크와 수정**: 수정이 끝나면 aywa 본문이 바뀌어 유니크에 걸릴 수 있다 → 앱은 다른 답글의 본문·**수정 대기 본문**과 겹치면 받지 않고, 워커는 ClassNote에 접속하기 전에 한 번 더 본다.
  그래도 기록 단계에서 걸리면(사이에 같은 본문이 들어옴) 던지지 않고 '게시됨 + 사유'로 끝낸다(안 그러면 15분마다 같은 자리에서 멈춘다).
- **같은 재클릭 키 + 다른 본문**: 응답이 끊긴 뒤 글을 고쳐 다시 보내면 서버는 "앞서 보낸 답글이 이미 접수됐다"고 알린다("이미 요청"으로 성공 처리하면 화면은 고친 글이 나간 줄 안다). 작성기의 키는 **본문에 묶인다**(본문이 바뀌면 새 키). 실패·시간 초과 뒤엔 창이 목록을 다시 읽는다.
- **API**: 작성 `POST /api/v1_1/reports/{글}/comments/`(없으면 `kapi…/v1_1/reports/{글}/comments`) · 수정 `PATCH …/v1/reports/{글}/comments/{댓글}` · 삭제 `DELETE` 같은 경로 · 목록 `GET /api/v1/reports/{글}/comments/`.
  같은 출처가 404·405·리다이렉트일 때만 kapi로 넘긴다(그 밖은 이미 만들어졌을 수 있다). 리다이렉트는 따라가지 않는다(POST→GET 오판 방지).
- 🔴 **모드 = 학원 설정 세 단계(2026-10-01)** — `report.classnoteParentReplyMode`. 값은 **셋뿐**(그 밖·빈 값·옛 `pilot`은 끔으로 읽는다).
  · **끔(off, 기본)** = 없는 기능. 벨 버튼·수업보고서 '학부모 글·답글' 면(주소를 직접 쳐도 첫 면으로)·서버 액션(모듈 꺼진 학원과 같은 답)·워커(집지 않음·로그 없음) 전부.
  · **시험(test)** = 보드 `[수학] 테스트반`(#1317083)·`(수학)학원이`(#1291581) **그리고** 원아 5268389의 글만(침산 ClassNote 센터의 번호다 — 다른 지점엔 통과할 글이 없다).
  · **전체(on)** = 아래 조건을 **전부** 통과한 글만. 하나라도 모르면 거절 + 한글 사유(행의 `error`). 시험 보드는 전체에서도 시험 규칙으로 통과한다.
  앱과 워커가 같은 값을 본다: 앱은 `getTenantSettings` → `classnoteReplyMode`, 워커는 `loadReplyMode`(postgres 직결 — 발송 스위치와 같은 방식이라 저장 즉시 반영). 워커는 못 읽으면 끔.
- 🔴 **전체(on) 모드 대상 확인**(워커 `evaluateReplyTarget` — 쓰기마다 매번): ① 행이 학부모 메시지(0184a)에 묶여 있고 그 메시지의 글·댓글·원아가 행과 같다(메시지는 **이 지점 것**으로 읽는다)
  ② 글을 다시 읽어 HTTP 200 · 글의 원아 = 행의 원아 · 보드 번호가 행과 같다(행이 비어 있으면 글에서 읽은 값으로 채운다 — 앱은 시험 보드 밖의 보드 번호를 모른다)
  ③ 보드가 aywa가 아는 보드 — (a) 0302a에 **그 보드 번호로 하나** 연결된 반 보드, 또는 (b) 1인 보드 `(수학|영어)이름`이고 그 원아의 확정 연결(0185a)이 있으며
  **보드 이름 = 그 학생의 보드 이름**(ClassNote용 이름 > 이름 — 발송 워커 `boardClassName`과 같은 규칙. 이름으로 학생을 **찾지** 않는다, 확정 연결을 되짚어 볼 뿐)
  ④ 그 원아가 그 보드의 지금 원아 목록에 있다(`fetchBoardChildren`) ⑤ 행의 학생 = 확정 연결이 가리키는 학생(반 보드 = 0302a 원아 매칭 `ok` 한 줄 + 0185a가 있으면 그것도 같은 학생 · 1인 보드 = 0185a)
  ⑥ 시험 보드는 통과. 확정 연결 조회(`loadReplyFacts`)가 실패하면 쓰지 않고 다시 시도한다(3회 뒤 실패). 앱은 요청을 받기 전에 같은 조건을 미리 본다
  ([`replyPlaceConfirmed`](../src/features/classnote-reply/reply-policy.ts) · `confirmedStudentOf` — 받아 놓고 실패로 끝나지 않게, 패리티 테스트가 앱·워커 규칙을 대조).
  ⚠️ **실데이터(2026-10-01, 최근 14일 글 30개 읽기 전용 드라이런)**: 통과 11(1인 보드 10 · 반 보드 1) / 거절 19 = `[EIE] …` 보드 10 · 접두 없는 보드 6(0302a 연결 없음 — 영어 그룹반으로 보인다) ·
  1인 보드인데 보드 이름이 확정 연결 학생의 이름과 전혀 다른 글 3. → **영어 그룹반 글에는 전체 모드에서도 답글·공감이 안 된다**(0302a가 수학 반 보드만 담는다). 넓히려면 영어 그룹 보드↔반 연결 기록이 먼저다.
  최근 30일 1인 보드 글 144건 가운데 이름 일치 136 · 전혀 다른 이름 4 · 원아 링크 없음 4.
- **버튼 노출**: 시험 = 학원이 글 · 전체 = **aywa가 아는 보드**(0302a에 하나로 연결된 반 보드 · 1인 보드 모양 — `replyBoardKnown`)의 글만. 영어 그룹반처럼 어차피 받지 않는 글엔 "눌러도 안 되는 버튼"을 세우지 않는다.
  벨: 관리자급은 그 보드 확인만(학생 확정 여부는 창에서 사유로), 강사는 알림마다 `decideReplyPermission`(**자격 + 대상 확정**까지 — 같은 조회는 한 번만(memo), 메시지 30개 상한).
  면('학부모 글·답글')도 같은 보드 확인. 자격 판정 자체는 그대로다(벨 수신자와 같은 규칙).
- **SQL 전·옛 워커**: 표가 없으면 버튼·면의 답글 칸이 없다([[#95]]). 🔴 표 유무를 `head: true`(HEAD)로 묻지 말 것 — 표가 없을 때의 빈 본문 404를 postgrest-js가 **error 없는 204**로 바꿔 "표 있음"으로 읽힌다([`replyTableReady`](../src/features/classnote-reply/server/reply-data.ts)는 한 줄을 GET한다).
  발송 스위치가 꺼져 있으면 벨의 '답글 쓰기' 버튼도 세우지 않는다(면은 남는다 — 대기 중 답글을 취소할 자리). 옛 워커(caps 없음)면 앱이 요청을 받지 않는다. 개발 서버에서만 `CLASSNOTE_REPLY_DEV_WORKER=1`로 연동 PC 확인을 건너뛴다(프로덕션 빌드는 읽지 않음 · 모드·자격·가드는 건너뛰지 않는다).
- ⚠️ **옛 워커 zip**(2026-09-30 판 — 모드가 코드 상수 `test`, 설정을 모른다): 앱이 요청을 **받지 않는다**. 답글 요청은 하트비트에 `caps.parentReply` **와** `caps.parentReplySettings`(설정 모드를 읽는 판)가
  둘 다 있어야 받고, 공감은 `caps.parentReaction`. 🔴 살아 있는 실게시 PC가 여럿이면 **전부** 새 판이어야 한다(`workerReadyForReplies` — 실게시는 지점당 한 대(먼저 시작한 PC)만 돌아,
  옛 판이 담당이면 새 판이 대기 중이어도 아무도 집지 않는다). 옛 워커가 집어도 실제 학부모 글은 접속 없이 실패시키므로 쓰기는 안전하다. → **새 zip을 연동 PC에 적용해야 기능이 켜진다.**
- 🔴 **'대기'·'실패'는 "ClassNote에 아직 없다"는 뜻이 아닐 수 있다**(적대 리뷰 2026-10-01) — 게시 요청이 나갔는데 응답이 끊기고 다시 읽기도 실패하면 행은 대기(다시 시도)로 돌아온다. 그래서:
  ① 앱은 **연동 PC가 한 번 이상 시도한(`retry_count > 0`) 대기 답글**의 수정·취소를 받지 않는다(그 사이 aywa 본문만 고치면 워커가 고친 본문을 못 찾아 한 번 더 올린다 — 조건부 쓰기에도 `retry_count = 0`).
  ② 워커는 요청이 나간 적 있는 행(쓰기 뒤 결과 모름 · 쓰는 중 브라우저가 죽음 — 게시 직전에 세우는 `progress.sent`로 예외 경로도 잡는다 · 게시하다 멈춰 멈춤 복구로 돌아옴)에
  **전용 사유**("ClassNote에 올라갔는지 확인하지 못했습니다")를 남기고(로그인 실패 같은 '안 보낸 실패'와 글자가 다르다), 그 행이 실패로 끝나면(재시도 소진이든 가드 거절이든)
  **"올라갔는지 알 수 없습니다 — ClassNote에서 확인하세요"**로 적는다. 댓글 목록을 읽어 없음을 확인하면 표식을 내린다. 앱의 수정·취소 금지는 `retry_count > 0` **또는 연동 PC가 한 번이라도 집은 행**(`worker_host`)이다(멈춤 복구 포함).
  ③ 그렇게 끝난 같은 글의 답글은 다음에 그 글을 처리할 때 댓글 목록에서 **되찾는다**(`recoverLostReplies` — 같은 본문이고 게시 명의가 **적혀 있고 같은** 봇 댓글이 있으면 게시됨으로 되돌려
  aywa에서 수정·삭제할 수 있게. 명의 칸이 없는 댓글(사람이 직접 쓴 것)은 되찾지 않는다. 감사로그 `kind: recovered`).
  같은 본문으로 다시 보낸 답글은 그 댓글을 '이미 있음'으로 받는다(새로 올리지 않는다). ⚠️ 쓰기 전 단계 실패(로그인·원글 읽기)도 재시도 횟수에 든다 — 빼면 ClassNote가 죽은 동안 15초마다 로그인을 시도한다.
- ✅ 글자 없이 첨부만 있는 학부모 글·댓글(영상·사진 숙제)도 답글·공감 대상이다(2026-10-01) — 워커가 대체 원문 `[영상] (내용 없이 첨부만)`(벨 알림 본문과 같은 글자)으로 0184a에 저장하되 **분류는 끝난 것으로**(`classified_at` + `category='none'`) 찍어 AI 분류·출결 알림에 안 걸린다. 새 댓글 알림은 링크에 `?comment=<댓글 번호>`가 실려 번호로 정확히 짝짓고, 번호 없는 옛 알림만 본문으로 짝짓는다(알림보다 뒤에 쓴 댓글은 후보에서 뺀다 · 같은 글에 같은 표시의 첨부만 댓글이 둘이면 모호 — 답글은 무해, 공감은 숨김). `?comment=` 링크는 ClassNote가 그 글을 그대로 연다(2026-10-01 학원이 글 실측 — 200·본문 그대로). 이 기능 **전에** 온 글은 워커가 다시 안 읽으므로 `scripts/_classnote/backfill-attach-only-messages.mjs`(드라이런 기본, `--apply`는 원장 승인 뒤)로 채운다. 학원이는 재원생이 아니라 **벨 알림이 생기지 않는다** — 시험은 '학부모 글·답글' 면에서.
- 사진 = 보관하지 않고 **ClassNote 사진 주소**를 쓴다(2026-10-01 실측: 피드 `attached_images[]` 항목에 `original·large·small` 주소, 전부 업로드 CDN `up-kids-kage.kakao.com`, 서명·만료 쿼리 0개 · 무로그인 GET 206 · `Cache-Control: max-age=315360000` = 만료 없는 주소). 워커가 `small`·`large`·크기만 서버 전용 표 `classnote_parent_message_attachments`(0326a)에 저장하고(원문 표는 직원 전원이 읽어 칸으로 두지 않았다), 앱은 영상과 **같은 열람 게이트**(students 메뉴 + `getStudentById`) 뒤에서만 주소를 내려 `<img referrerPolicy="no-referrer">`로 띄운다. 호스트는 kakao.com·kakaocdn.net만 받는다.

### 10.9 학부모 글·댓글에 공감 — 2026-10-01 (0319a)

원장 *"댓글 공감 누르기 버튼도 가능하면 기능 배선"* — 답글과 같은 길: aywa에서 누르면 요청 행이 생기고 연동 PC 워커가 봇 계정으로 그 글(학부모 새 글) 또는 그 댓글(학부모 댓글)에 공감을 누르거나 푼다.
모드·자격·대상 확인·쓰기 허가증은 **답글과 같은 것**이다(따로 만든 가드가 없다).

| 구성 | 파일 | 역할 |
|---|---|---|
| 표 | `supabase/migrations/s1_season1.sql#0319a_classnote_parent_reactions.sql` | **학부모 메시지 하나에 공감 하나**(지점 단위 일반 유니크 — 부분 유니크 아님, [[#113]]). 풀었거나 못 눌렀으면 **같은 행을 다시 쓴다**. 쓰기 = 서버 액션·워커만 |
| 앱 판정(순수) | [`reaction-policy.ts`](../src/features/classnote-reply/reaction-policy.ts) | 종류 6 + 한글 라벨 · 상태 라벨 · 누를 수 있나/풀 수 있나 |
| 서버 액션 | [`reaction-actions.ts`](../src/features/classnote-reply/server/reaction-actions.ts) (+ `reaction-data`) | 입력 = 메시지 행 id(+ 종류). 첫 문 `replyGate` → `decideReplyPermission`(답글과 같은 자격·명의) → 연동 PC(`caps.parentReaction`) → 조건부 쓰기 → 감사로그 |
| 화면 | [`reaction-control.tsx`](../src/features/classnote-reply/components/reaction-control.tsx) — 벨 알림 행('답글 쓰기' 옆, 종류는 그 아래 줄) · '학부모 글·답글' 면 · 답글 창 | '공감' → 종류 여섯(좋아요·감사해요·확인했어요·기쁨·놀람·슬픔) → 요청. 눌려 있으면 `확인했어요 · 공감함`(누른 사람·관리자급은 눌러서 푼다). 처리 중 잠금 + 10초 갱신 |
| 워커 | [`classnote-parent-reaction-core.mjs`](../scripts/_classnote/classnote-parent-reaction-core.mjs)(큐·DB) + [`parent-reaction-run.mjs`](../scripts/_classnote/parent-reaction-run.mjs)(**공감 쓰기는 여기서만**) + 순수 [`parent-reaction-guard.mjs`](../scripts/_classnote/parent-reaction-guard.mjs) | 데몬 2-e · 한 폴 한 건 · `skip locked` · 멈춤 15분 복구 · 감사로그 `classnote_parent_reaction_run`(실행자 `system:classnote-parent-reaction`) |
| 1회 실행 | [`process-parent-reactions.mjs`](../scripts/_classnote/process-parent-reactions.mjs) `--id <공감 행> [--post]` | 개발 PC 시험·수동 복구(하트비트를 쓰지 않는다) |

- **API(2026-10-01 번들 조사 + 학원이 글 실측)**: 글 `POST /api/v1_2/reports/{글}/reactions/` · 댓글 `POST /api/v1/reports/{글}/comments/{댓글}/reactions/` — 본문 `{reaction_type, author_name}` → 201 `{id, reaction_type, author_name, created}`.
  풀기 `DELETE …/reactions/{공감 번호}/` → 204(없는 번호 404). 종류 `GET /api/v1_2/reactions/types/`. 공감한 사람 `GET …/reactions/users/`.
- 🔑 **ClassNote에는 보낸 명의(`author_name`)가 '공감한 사람'으로 보인다**(봇 계정 이름이 아니다 · 사진 없음). 그리고 공감은 **(계정·명의·종류)당 하나**다 — 같은 명의·같은 종류를 다시 보내면
  **같은 번호가 돌아온다**(멱등, 수는 그대로). 명의가 다르면 같은 봇 계정이어도 **새 공감**이 생긴다(실측: 다른 명의로 `like` 2개). 같은 명의로 다른 종류도 따로 눌린다.
  → 강사 여럿이 각자 명의로 누르는 것도 ClassNote는 받는다. aywa는 **메시지당 하나**만 둔다(먼저 누른 사람의 명의 — 학부모 폰에 공감 알림이 여러 번 가지 않게). 넓히려면 0319a 유니크를 (메시지, 누른 사람)으로 바꾸면 된다(원장 결정 사항).
- 🔴 **`my_reactions`는 그 명의로 읽어야 나온다**(`?author_name=` — 안 붙이면 늘 빈 배열, [[#136]]). 워커는 누르기 전에 그 명의의 공감을 읽어 이미 있으면 쓰지 않고, 풀 때는 **그 명의의 공감 목록에 그 번호가 있을 때만** 지운다(남이 누른 공감을 풀지 않는다).
- **누르기**: 댓글 공감이면 그 댓글이 아직 있고 학부모가 쓴 것이어야 한다(전체 모드) · ClassNote 종류 목록에 그 종류가 아직 있어야 한다 · 요청한 지 24시간이 넘으면 누르지 않는다.
  그 명의로 **다른 종류**가 눌려 있으면 그것부터 풀고 누른다(메시지당 하나 — 그 명의의 공감 목록에 있는 것만 푼다).
- **풀기**: 풀었다는 응답(204·404)을 받아도 **다시 읽어 사라졌을 때만** 풀림으로 적는다(남아 있으면 다시 시도).
- 🔴 **'확인 필요'(`unconfirmed`)**: 누르기 요청이 나갔는데 결과를 확정하지 못하면(응답 끊김 + 다시 읽기 실패 · 쓰는 중 브라우저가 죽음 · 누르다 멈춰 멈춤 복구로 돌아옴) 워커가 이 표식을 세운다.
  표식이 선 행은 앱이 **취소하지 않고, 다른 명의·종류로 덮어쓰지도 않는다**(덮어쓰면 ClassNote에 눌려 있을 수 있는 공감을 aywa가 잊어 풀 길이 없고, 다른 명의로 하나 더 눌린다).
  다시 누르면 그 행을 **확인만** 시킨다(요청 시각은 그대로 · 지금 고른 종류는 싣지 않는다 · 화면엔 안내문) — 워커는 그 명의로 읽어 눌려 있으면 성공, 없으면 **누르지 않고** 표식을 내려 실패로 끝낸다
  ("눌리지 않은 것을 확인했습니다 — 다시 눌러 주세요"). 그 뒤 다시 누르면 새 요청이다. (재리뷰 2026-10-01 — 확인이 옛 요청을 뒤늦게 누르던 길을 막았다.)
- **벨에서의 모호한 댓글**: 같은 글에 같은 문구의 학부모 댓글이 둘이면(알림은 본문으로 댓글을 찾는다) 벨에는 공감 버튼을 세우지 않고, 그 알림에서 연 답글 창에도 서버가 공감 상태를 싣지 않는다
  (`getParentReplyContext(…, { noReaction })`) — 공감은 댓글 단위라 엉뚱한 댓글에 눌린다. 면에서는 댓글마다 줄이 따로라 그대로 누른다.
- **명의** = 답글 게시 명의와 같은 규칙(`<반 이름> <강사 호칭>`). **자격** = 답글과 같다. 풀기 = 누른 사람 본인 또는 관리자급.
- **SQL 전·옛 워커**: 표가 없거나(0319a 전) `caps.parentReaction`을 아는 실게시 PC가 없으면 공감 버튼이 **없다**(답글은 그대로 돈다). 표 유무는 한 줄을 GET해서 확인한다(HEAD 금지, [[#95]]).
  워커는 표가 없으면 10분마다 다시 확인하며 조용히 쉰다.
- **끝-끝 확인 범위(2026-10-01)**: ClassNote API는 학원이 글 #1457933394 / 댓글 #793757838에서 실제로 누르고 풀어 확인했고(뒤에 공감 0개로 정리), 큐·DB는 내장 Postgres(PGlite)에 0319a를 적용해 가짜 ClassNote로 돌렸다.
  🔴 **운영 DB에 0319a를 적용한 뒤 워커 경로의 실제 끝-끝(앱 버튼 → 연동 PC → ClassNote)은 아직 안 돌렸다** — 설정을 '시험'으로 두고 학원이 글에서 한 번 눌러 볼 것.

## 11. 퇴원처리 안전 판정 — aywa 퇴원생을 ClassNote에서 내리기 (Phase 0: 판정+스캔만, 2026-07-30 · ✅ Phase 2: 전 과목 퇴원 45일 뒤 자동, 2026-11-03)

> **한 줄 규칙: aywa 퇴원생을 ClassNote 명부에서 내리는 건 실질 비가역이다. "누구를 내려도 되는가"를
> 순수 함수로 못박고 실데이터로 재원생 오탐 0을 증명하기 전엔 쓰기 경로를 만들지 않는다.**

### 왜 필요한가 (2026-07-30 실측)
- ClassNote 활성 명부 471명 중 **101명이 aywa 퇴원생** · 학생모드 보드 526개 중 고아 147(퇴원 82·가족 연결 잔존 40).
- **실해는 오발송이 아니다**(발송 게이트 3중이 막는다). ① 퇴원 가족이 붙은 보드가 §5.5 인바운드 게이트를
  fail-closed로 물려 **진짜 학부모 글·댓글 알림까지 보류** ② 퇴원 학부모가 명부·`[ALL] 전체방`에 남아 학원 공지 계속 수신.

### 🔴 이 작업이 비가역인 이유 (발송과 정반대 방향)
발송은 "남의 집에 보내는 것"이 사고지만, 퇴원처리는 **"다니는 집을 끊는 것"** 이 사고다. ClassNote ERP
퇴원처리를 하면 원아가 센터 명부에서 빠지고(실측: 처리된 87명 중 명부 잔존 2명 = 2%), 되돌리려면
**학부모 재초대 + 재가입**이 필요한데 그건 자동화 불가 구간이다. 그래서 모든 가드가 **모르면 제외**(fail-closed)다 —
안 내리면 현상 유지(무해), 잘못 내리면 복구 불가. ⚠️ **§5.5와 달리 예외 화이트리스트를 두지 않는다** —
발송은 "못 보내면 손해"라 사람 탈출구가 필요하지만, 퇴원처리는 안 해도 손해가 없어 탈출구가 곧 사고 경로다.

### 🔴 마지막 배정 해제 = 자동 퇴소 · 퇴소 API 실측 (2026-11-03)
- **원아의 마지막 반 배정을 빼면(`POST kapi…/v1/enrollments/{배정}/out`으로 승인된 배정이 0개가 되면) ClassNote가 그 원아를 센터에서 자동 '퇴소'시킨다.**
  실측 근거(GET 정황): 11-02 aywa 해제로 남은 배정이 0이 된 원아 **2명이 그날 퇴소** · 다른 배정이나 `[ALL] 인재원 전체방`이 남은 **69명은 재원 그대로**.
  → 반 보드 자동 해제(§10.5 · §10.5-b)는 **마지막 배정을 떼지 않는다**(판정 ④-b `guardLastEnrollment` — 운영관리 명부의 승인된 소속 배정을
  [ALL]·그룹 보드·1인 보드까지 다 세고, 한 회차에 같은 원아를 여러 보드에서 떼면 합산해 마지막 하나는 남긴다 · 명부를 모르면 보류 ·
  실행부가 해제 직전 실시간 배정으로 한 번 더 막고, 해제 뒤 남은 배정 0을 보면 자동 해제를 멈춤 표식으로 세운다). 보류 사유 =
  `마지막 반이라 떼면 ClassNote에서 퇴소됩니다 — 전 과목 퇴원 45일 뒤 퇴원처리로 정리합니다`. 원장 규칙: **명부 퇴원(퇴소)은 전 과목 퇴원 + 45일 뒤에만**.
- **퇴소 API**(원장 승인 아래 테스트 원아 '학원일' #5287887로 실측, 근거 파일 `D:\tmp\classnote-offboard-probe-2026-11-03\offboard-probe-hakwonil.json`):
  `POST https://kapi.classnote.com/v1/centers/96575/enrollments/out` 본문 `{"children":[원아번호]}`(쿠키 + `X-CSRFToken`, `content-type: application/json`) → **200 빈 본문**.
  결과 — 원아 목록·재원 명부(`admissioninfos`)에서 빠짐(414 → 413) · 퇴소 명부(`admissioninfos?name=&page=1&page_size=1000&year_left=2026&tz=Asia/Seoul`)에
  `out_date` = 그날(KST) · 배정 3개([ALL] 포함) 전부 빠짐 · **센터 계정의 그 원아 글(`reports/?child=`) 48 → 0건** · `/api/v1/children/{id}`는 200(학부모 연결 유지).
  🔴 **이미 퇴소된 원아로 다시 보내도 200** — 응답으로 성공을 가를 수 없다(명부를 다시 읽어 판정). **되돌리는 API 없음**(학부모 재초대뿐 · 새 `child.id`가 생길 수 있다).
- 원장 결정(2026-11-03): 학원이 그 원아의 옛 글을 못 보게 돼도 **전 과목 퇴원 45일 뒤 자동 퇴원처리**를 한다 — 단 처리 직전 그 원아의 글 목록을 백업한다(✅ 구현 — 바로 아래 Phase 2).

### ✅ Phase 2 구현 — 전 과목 퇴원 45일 뒤 자동 명부 퇴원처리 (2026-11-03)
원장 *"남은 수강과목이 1개도 없는 경우에는 45일 뒤 자동으로 퇴원처리"*. 판정 [`classnote-offboard-plan.mjs`](../scripts/_classnote/classnote-offboard-plan.mjs)(순수) · 흐름 [`classnote-offboard.mjs`](../scripts/_classnote/classnote-offboard.mjs) · ClassNote 읽기·쓰기와 백업 올리기 [`classnote-offboard-io.mjs`](../scripts/_classnote/classnote-offboard-io.mjs) · 드라이런 [`plan-classnote-offboard.mjs`](../scripts/_classnote/plan-classnote-offboard.mjs)(쓰기 0 · `--json`).
- 🔴 **스위치 기본 = 꺼짐(관찰 모드)** — `CLASSNOTE_OFFBOARD=on`(true·1·yes)일 때만 실제로 내린다(리뷰 B1). 연동 앱 화면은 ID/PW만 저장해 원장이 PC에서 끌 방법이 없어서, 켜는 쪽을 명시로 했다. 꺼져 있으면 05시 정기 동기화가 판정 + 글·댓글 확인(⑦ · GET만)까지 돌리고, 보고서 '보류'에 **상한 없이 전원**의 `퇴원처리 예정(자동 퇴원처리 꺼짐): 이름 — 퇴원 N일 · 글 N건` 줄 — 켰을 때 첫날 처리될 앞 N명(묶음 경계 규칙 그대로)에는 ` · 켜면 첫날` — 과 요약 한 줄(`퇴원처리 예정 N명 — 켜면 첫날 M명 …`), 회차 요약 `offboardPlanned`를 남긴다(쓰기 0 · 감사로그 일일 요약에 '명부 퇴원처리 예정 N명'). 관찰은 아무것도 안 바꾸므로 상한을 걸면 매일 같은 앞 10명만 보였다(리뷰 R1). 퇴원처리 멈춤 표식이 남아 있으면 관찰 모드도 '켜도 퇴원처리하지 않습니다(사유)' 한 줄을 남기고 '켜면 첫날'을 붙이지 않는다(켜도 0명 · 3차 리뷰 G2 · 이때는 상세·댓글 GET도 안 한다). 관찰 명단 = 켰을 때의 결과 — '켜면 첫날' 몫은 켰을 때와 같은 확인(학부모 정보 · 댓글 · R7)을 하고 그 밖은 글 목록(⑦)까지만 본다(2차 리뷰 F5 — 대상 전원의 글·댓글을 매일 다 받으면 05시 동기화를 붙든다 · 첫날 몫 안에서 보류되면 실행처럼 다음 묶음이 첫날 몫으로 들어온다). 미리 보기: `plan-classnote-offboard.mjs --observe`(같은 줄을 그대로 출력). 스위치 세 개(`CLASSNOTE_OFFBOARD`·`CLASSNOTE_OFFBOARD_DAILY_LIMIT`·`CLASSNOTE_BOARD_AUTO_RELEASE_EXTRA`)는 연동 앱 허용 목록(`apps/sync-agent/lib/supervisor.cjs` CREDENTIAL_KEYS)에 넣었다.
  - **켜는 절차**: ① 웹 배포(내부 백업 라우트 + 카탈로그) → ② 연동 앱 새 버전 배포(이 워커) → ③ 며칠 동안 보고서의 '퇴원처리 예정' 명단을 원장이 확인 → ④ 원장 승인 뒤 **다음 연동 앱 버전에서 `offboardEnabled`의 기본값을 켜짐으로 바꾼다**(PC별 값으로 켜지 않는다 — 화면이 없다). 🔴 **전제 조건: 기본값을 켜짐으로 바꾸기 전에 연동 앱 화면에 끄기 토글을 먼저 만든다** — 지금은 PC에서 스위치를 바꿀 길이 없어, 켠 뒤 즉시 멈추는 길이 멈춤 표식 파일뿐이다(되돌리기는 새 순번 재게시 · 아래). 🔴 **PC에서 스위치를 바꿀 길이 지금은 없다** — 연동 앱 화면은 ID/PW만 저장하고 워커 env는 그 저장소 값(허용 목록 `CREDENTIAL_KEYS`)뿐이라 `CLASSNOTE_BOARD_AUTO_RELEASE`·`CLASSNOTE_BOARD_AUTO_RELEASE_EXTRA`·`CLASSNOTE_OFFBOARD`를 PC에서 넣을 수 없다. **즉시 멈춤 = 멈춤 표식 파일**: 연동 PC 상태 폴더 `%LOCALAPPDATA%\AYWA\Sync\tenants\{지점 id}\state\classnote\`에 만든다(해제 = `class-board-release-halt.txt` — 이것 하나로 명부 퇴원처리도 쉰다 · 퇴원처리만 = `classnote-offboard-halt.txt` · 내용 = 사유 · 지우면 다음 회차부터 재개). **되돌리기 = 옛 코드를 새 순번으로 다시 게시**한다 — 업데이트는 순번 앞으로만 가고 PC에서 내릴 길이 없으며 릴리스를 거둬도 깔린 PC는 내려가지 않는다(옛 커밋의 워커로 `package.json` 버전과 `EYWA_AGENT_SEQUENCE`를 올려 release → publish-release → register-release · apps/sync-agent/README). ⚠️ 옛 폴더 가져오기(`copyLegacyState`)는 덮어쓰지 않지만(force:false) 옛 폴더의 `class-board-release-halt.txt`·옛 진행 표식이 새 상태 폴더에 **더해져** 뜻밖에 멈추거나 건너뛸 수 있다 — 가져온 뒤 상태 폴더의 표식 파일을 확인한다.
- **언제**: 매일 정기 동기화(05시) 안에서 반 보드 동기화가 **끝까지 간 회차에만**(`syncMathClassBoardsDaily` — 반 보드를 쓰는 지점만). **반 보드 자동 해제의 멈춤 표식이 남아 있거나**(해제 스위치와 무관하게 표식 파일을 직접 본다) 이 회차 해제가 멈췄으면 쉰다(`offboardSkipForRun(r, releaseHaltReason())` · 리뷰 O4/B4 · Vitest 배선 가드). 하루 상한 기본 10명(`CLASSNOTE_OFFBOARD_DAILY_LIMIT` — 켰을 때만 건다) · 멈춤 표식 `classnote-offboard-halt.txt`(파일을 못 쓰면 이 프로세스의 메모리가 대신 막는다 — 읽을 때 파일 사유 || 메모리 사유 · 그 사유엔 '표식 파일을 쓰지 못해 연동 앱을 다시 시작해야 풀립니다' · 파일이 있는데 못 읽으면 멈춤으로 본다 · 보고서의 시각은 KST · `halt-marker.mjs` · 해제 멈춤 표식도 같은 도우미 · R3 · F2~F4).
- **출결·수업보고서를 읽을 수 있어야 한다**(R9): 퇴원 뒤 활동 가드(B10)는 연동 PC 역할이 `attendance_records`를 읽어야 돈다 — 운영 실측(2026-11-03) 이 역할에 권한·정책이 없어 게이트웨이에서 42501이었다(직결 드라이런은 통과해 안 보였다) → **`s2_0021_sync_agent_attendance_read.sql`**(grant + 정책 둘 다 · ✅ 운영 적용 2026-11-03 · 웹·AywaSync 배포 전에 적용했다). 워커도 한 겹 더 막는다 — 그 지점의 가장 최근 출결·수업보고서(오늘 KST까지만 — 미래 날짜 줄은 안 센다 · F8)가 권한 오류(42501)이거나 없거나(정책 빠져 0행) 14일보다 오래됐으면 그날 퇴원처리(관찰 포함)를 하지 않고 보고서에 `출결 기록을 읽지 못해 오늘은 명부 퇴원처리를 하지 않았습니다(…)` 한 줄(실패가 아니라 보류 — 매일 실패 수가 쌓이지 않게 · `activityUnreadable`).
- **회차 건전성**(B3): 명부에서 전체방 배정이 보이는 원아 수와 전체방 보드의 원아 수가 10% 넘게 다르면 그날은 하지 않는다(보고서 줄). 명부의 배정 칸이 배열이 아니거나 **안 떠난 줄 중 보드 번호(`belong_to_class`)가 없는 줄이 하나라도 있으면**(칸 이름이 바뀐 경우 · R6) `boards`·`boardNames`·`allBoards`를 null로 두어 '모름'으로 제외한다(빈 목록으로 두면 가드가 조용히 꺼진다 · 해제 쪽은 null이면 마지막 배정 가드가 보류).
- **대상**(전부 AND · 모르면 제외): 원아 → 학생이 원아 연결(0185a) 또는 0302a ok로 **한 명**에게만 이어짐(이어진 것이 없는 원아는 절대 대상 아님) · 그 학생 = 퇴원 · 테스트·보호 이름·중복 병합 아님 · 모든 과목에 열린/시작 전 수강 0건 · **기준일 = max(퇴원일, 마지막 수강 종료일) + 45일 ≤ 오늘** · 그리고 아래 제외에 하나도 안 걸림.
  - **퇴원하지 않은 학생**(재원·휴원·예비원생·상담 전부 — 실례 퇴원 이승민 ↔ 예비원생 이승민A)의 원아일 수 있으면 제외: 이름이 이어짐(반 보드 해제 ①과 같은 함수 — 원아 이름 두 벌(명부·원아 목록) × 학생 이름 두 벌(에이와·ClassNote)) · 그 학생의 1인 보드 · **보호자 전화가 같음(형제)**. 그 원아가 퇴원하지 않은 학생에게도 이어져 있으면 함께 이어진 퇴원생의 다른 원아 계정도 둔다(B6).
  - 퇴원 뒤 돈 흔적(퇴원 다음 달 이후 청구 · 퇴원일 뒤 납부 · 취소 청구 제외) · **퇴원일 뒤 출결·수업보고서**(B10 — 수강 행 없이 자리·보강으로 다닌 경우).
  - 명부의 보호자 전화(carer 전화 전부 · B7)가 **하나도 없으면** 제외(형제 대조 불가) · 그 학생 전화와 확실히 다르면 제외.
  - **원아 명부 이름 ≠ 학생 이름**(공백·끝 알파벳만 뗀 같은 이름 · **양쪽 다 끝 알파벳이 있으면 알파벳까지 같아야** — B11 · 학생 쪽 알파벳은 학생 이름 두 벌 **전부**에서 모은다(학생 '이지아A' + ClassNote 이름 '이지아'로 명부 '이지아B'가 새지 않게 · R2) · 실례 한민호 ↔ 원아 '한도현' · 학부모가 원아 목록 이름을 '채민 공주💋'처럼 바꿀 수 있어 명부 이름이 기준).
  - **남은 배정이 전체방·본인 1인 보드 `(과목)본인이름`만이 아님** — 여기서 세는 배정은 **안 떠난 것 전부(승인 대기 포함 · B5)**. 반 보드·영어 반 방·그룹 보드·남의 1인 보드가 남아 있으면 `반 배정이 남아 있습니다(○○) — 해제가 먼저입니다`(누가 그 원아를 쓰고 있을 수 있다). 해제 쪽 '남는 배정'(마지막 배정 가드)은 반대로 승인된 것만 센다 — 둘 다 '모르면 손대지 않는' 쪽으로 센 것이다.
  - **한 학생의 원아 계정 중 하나라도 보류되면 그 학생 원아는 모두 둔다**(한 집을 반만 내리지 않는다 — 하루 상한도 한 집을 가르지 않는다).
  - 실행 직전(ClassNote): 최근 45일 안에 그 원아 글이 있으면 제외 · 글 목록·댓글을 끝까지 못 받거나 학부모(재초대 대상) 정보를 못 읽으면 제외.
  · **전체방 판정 근거**: ClassNote 보드 목록·상세에는 보드 종류 값이 없다(2026-11-03 GET 실측 — 칸 = id·name·선생님·원아 수뿐). 그래서 이름만 믿지 않고 넷을 모두 본다 — 이름이 `[ALL]`로 시작 · 그 센터에 그런 보드가 하나뿐 · 에이와 반(수학 반 보드·영어 반 방)에 안 이어짐 · 재원 명부 원아의 절반 이상이 들어 있음(침산: `[ALL] 인재원 전체방` #1200521 · 413명 중 345명). 하나라도 아니면 전체방이 없는 것으로 보고 아무도 내리지 않는다(`centerWideRoomIds`).
  · 7/30 `evaluateOffboardCandidate`에서 **안 가져온 것** — 1인 보드 봉쇄·공유 보드·보드 인원 정합(1인 보드 시대의 '보드 = 학생' 전제 · 퇴소는 원아 번호를 지목하고, 남이 같이 끊기는지는 실행 뒤 명부로 본다 · 대신 '전체방·본인 1인 보드 말고는 배정 없음'을 요구한다 — 남의 개인 보드도 여기서 막힌다) · 생년 대조(원아 연결이 이미 전화·이름·생년으로 만든 연결) · 시스템 일괄 퇴원일(기준일이 max라 장부 날짜는 기준일을 늦출 뿐) · ERP 이름 대조(원아 번호로 지목).
- **순서(원아 묶음마다)**: 글 목록(`reports/?child=` · page_size 100 + 커서, **child 필터를 매번 다시 붙이고** 받은 글이 전부 그 원아인지 확인 — 2026-11-03 실측: 361·148건 원아로 단일 요청과 id 집합 일치 · 새는 글 0) → 원아 상세(학부모 id·이름·아이디) → (켜졌을 때만) 댓글(`GET /api/v1/reports/{글}/comments/?page_size=100` · DRF `next`로 이어받기 · 댓글이 있다고 적힌 글마다 끝까지 받아야 한다) → **백업 올리기 + 올라갔는지 다시 물음**(비공개 버킷 `classnote-backups/{지점}/offboard/{날짜}/{원아}.json` · 내부 라우트 [`api/internal/classnote-offboard-backup`](../src/app/api/internal/classnote-offboard-backup/route.ts)가 서명된 주소를 준다 · 새 SQL 없음 · 묶음을 다 올린 뒤에야 내린다 · 하나라도 실패하면 그 집은 하나도 안 내린다) → **요청 직전에 '시도' 목록에 넣고** 퇴소 요청(한 원아씩 `{"children":[원아]}`) → **명부를 2초 간격으로 최대 5번 다시 읽어**(캐시 없이 · 반영 지연을 '처리 안 됨'으로 오판하지 않게) 그 원아만 빠졌고 퇴소 명부에 있는지 본다.
  - 다른 원아가 함께 사라지면 → 멈춤 표식 · **요청·확인 단계의 모든 예외도 멈춤**(요청이 먹었는지 모르는 채로 다음 원아로 가지 않는다 · B2).
  - 요청 응답이 **200인데** 재원 명부에 그대로면 멈춤(실측과 다르게 움직였다 · R4) — 200이 아니면(일시 오류) 그 원아만 오늘 실패('확인 실패' 감사로그)로 두고 **다음 묶음**으로 간다 — 같은 묶음(한 집)의 남은 계정은 요청하지 않고 실패로 남긴다(한 집을 반만 내리지 않게 · 3차 리뷰 G1) · 맨 앞 원아가 뒤 원아 전원을 막지 않게 · 같은 회차에 이 꼴이 2명 연속이면(묶음을 건너서 센다 · 건너뛴 계정은 안 셈) 그날 그만 · 멈춤 표식 없음 · F6). 재원 명부에서는 빠졌는데 퇴소 명부에 없으면 멈춤(퇴소가 아닌 다른 동작일 수 있다 · R5). 둘 다 감사로그는 '확인 실패'. 퇴소 명부는 **끝까지** 읽는다(봉투의 `next` 주소를 그대로 따라감 — 쪽 번호를 직접 만들지 않는다 · F9 · 배열 응답이 1,000건으로 꽉 차면 모름 → 멈춤 · 2026-11-03 실측: 봉투 · 169건).
  - 한 집 중 일부만 내리고 멈추면 보고서에 `한 집 중 일부만 처리: 이름 — 원아 계정 N개 중 M개만 퇴원처리했습니다`(B12).
  - 판정에 쓰는 GET은 전부 `cache: "no-store"`(B9 — 명부·원아 목록·보드 목록·원아 상세·글·댓글·퇴소 명부).
- **기록**: 동기화 보고서 '변동된 것' `명부 퇴원처리 · 퇴원처리: 이름 — 퇴원 N일 · 글 M건 백업` / '보류' 사유·예정 / '실패' · 회차 요약 `offboarded`·`offboardPlanned` · 감사로그는 **요청한 원아마다 결과와 무관하게**: 성공 = `classnote_offboard`('ClassNote 명부 퇴원처리(연동 PC)'), 그 밖 = `classnote_offboard_unconfirmed`('ClassNote 명부 퇴원처리 요청(확인 실패 · 연동 PC)' · 사유 문장) · 백업 위치는 메타데이터에만. 🔴 보고서 줄·감사로그 사유(`why`)·멈춤 사유는 **한국어 요약만**(R10 — 통신 오류 같은 영문 원문은 연동 PC 로그와 감사로그 메타데이터의 `raw` 칸 — 화면이 안 쓰는 칸 — 으로만).
- 🔴 백업 본문(버전 2) = 원아(번호·이름·생년) · 학부모(번호·이름·아이디 — 재초대 대상, **아이디가 숫자·전화 꼴이면 뺀다**) · 그때 소속 반(우리 센터 줄만) · 글 전부(번호·작성일·작성자·반·본문·읽음·**댓글 본문**(작성자 이름·종류·작성일·본문 — 아이디 없음)). **첨부는 주소·이름·크기 메타만 — 원본 파일은 받지 않는다**(접근 키 없음 · ClassNote가 지운 뒤에는 그 주소로 못 받을 수 있다). 보호자 전화·주소·병력은 싣지 않는다.
- **드라이런(2026-11-03 저녁 · 리뷰 반영 뒤 최종, DB select + ClassNote GET만)**: 스위치 꺼짐(기본) · 회차 건전성 정상 · 대상 **32건(31명 — 황지민B 두 계정)** · 제외 26건(24명 — 첫 사유별: 퇴원하지 않은 학생과 보호자 전화 같음 8 · 같은 이름 7(이승민↔예비원생 이승민A · 김현준A↔김현준B · 박시후A↔박시후 · 이수빈A↔이수빈 · 이채은A↔이채은 · 이지아↔김지아 · 이지나↔권지나) · **퇴원일 뒤 출결·수업보고서 6**(임호진·윤채이·임시연·이준희 + 전화 같음과 겹치는 이유나·이정원) · 돈 흔적 2(이채민 두 계정) · 전화 다름 1(조서현) · 이름 다름 1(한도현↔한민호, 반 배정도 남음) · 같은 학생 다른 계정 보류 1(박예서) · 겹침 포함하면 전화 같음 10) · 보호자 전화 없음 0 · 45일 전 13(같은 날 퇴원보고서로 퇴원한 3명 포함) · 학생과 안 이어진 원아 7. 대상 32건은 전부 전체방만 남았다. 점검의 '45일 지난 퇴원생 55명'은 학생 수이고 원아 계정으로는 58건 — 32 + 26과 정확히 같다(차이 0). 첫날(켜졌다면) 오래된 순 10명 = 이태규 368일 · 홍유담 · 황준현 · 이규림 · 최교빈 · 이은우 · 윤연수 · 이나현 · 조승우 · 이나연.
  · 같은 이름 판정은 반 보드 해제 ①과 같은 함수(`childNameConsistent` — 이름만 같아도 잇는다, '지나' ⊂ '권지나')라 끝 알파벳만 뗀 '같은 이름'보다 넓다 — 퇴소는 되돌릴 수 없어 넓은 쪽을 쓴다(이지나↔권지나가 그 차이). 원아 명부 이름 = 학생 이름 대조는 좁은 쪽(`sameName`)이다.

### 조사로 확정된 API 제약 (계획을 여러 번 바꾼 사실)
- ERP 명부(`GET /api/v1_2/centers/{c}/erp-children/`) 행 필드 = `id·in_date·out_date·child_name·basic_info` **전부**.
  상세 엔드포인트 **404**, 사진 access_key로 원아 매칭 **0/64** → **이 엔드포인트만으로는 원아 연결 키가 없다.**
  그래서 대상 지목은 반드시 **`child.id`**(가입 원아)로 하고, `erp-children`은 **제외 방향으로만** 쓴다(`out_date` 있으면
  "이미 처리됨"이 아니라 **상태 모순 = 사람이 확인**으로 읽는다 — 같은 아이인지 단정 불가).
- ERP 활성 명부에 같은 `child_name` **2행+ 21건**.

#### ✅ 정정 (2026-07-30, 원장 제보로 재조사) — 연락처·연결 키는 **있다**
> 위에서 "연결 키 없음 · 연락처 필드 API에 없음"이라고 적었던 것은 **틀렸다.** `erp-children`에 없었을 뿐,
> **운영관리 화면이 쓰는 다른 엔드포인트에 다 있다.** 원장 제보: *"classnote에도 운영관리 접근시 학생 전화번호를
> 확인할 수 있으므로 추가 가드방어장치가 가능할듯"* → 화면 네트워크를 추적해 찾았다.

**`GET /api/v1_2/centers/{c}/admissioninfos?name=&page_size=2000`** (class_id 없이 전건, 실측 **472행 = 활성 명부 전원**):
| 필드 | 값 | 쓰임 |
|---|---|---|
| **`child_id`** | 472/472 | 🔴 **ERP 행 ↔ 원아(child) 결정적 연결 키** — "없다"고 썼던 그것 |
| **`basic_info.carer1_phone`** | 472/472 | 🔴 **보호자 연락처** — 신원 대조 최상위 증거 |
| `basic_info.child_date_birth` · `parent_name` | 전원 | 생년·보호자명 |
| `enrollments[]` (`belong_to_class`·`class_name`·`date_left`) | 전원 | 보드 소속·이탈일 |
| `in_date`·`out_date`·`class_alias` | 전원 | 재원 기간·학원 닉네임 |

🔴 **개인정보 경고**: 이 응답엔 **알레르기·병력·응급병원·주소**까지 함께 실린다. 전화는 **대조에만** 쓰고
값을 로그·DB·화면에 남기지 말 것(일치/불일치만 보고). **AI 프롬프트에 절대 넣지 말 것**(CLAUDE.md 전송 금지 필드 원칙).

**전화 대조의 실효**: aywa 전화 보유 **807/812**(퇴원생 400/403), makeedu 연결(`students.makeedu_id`) **757/812**
(퇴원생 384/403, 전화+makeedu 둘 다 **382**) → 원장이 말한 **"메이크에듀–aywa–클래스노트 3단 일치"** 가 대상
모집단의 95%에서 성립한다(aywa가 허브: makeedu는 `makeedu_id`, ClassNote는 전화로 물린다).
실측 효과: 이름만으로는 모호했던 보드가 **66건 → 14건**으로 줄었다(전화가 52건을 확정).
⚠️ makeedu엔 aywa보다 더 많은 퇴원생이 있으므로(원장 지적) **aywa 우주만으로 "동명이인 없음"을 단정하지 말 것** —
그 위험도 전화 대조가 덮는다(전화가 맞으면 그 집이 맞다).
- `children`(가입 원아) 471행은 **전원 생년 有** + `parent{id,name,username}` → 신원 대조·복구 스냅샷의 축.

### 방어 구조 = board-safety.mjs의 자매 (같은 순수·Vitest·실데이터 적대 검증 패턴)
| 구성 | 파일 | 역할 |
|---|---|---|
| 이름 매칭 키(순수) | [`identity-keys.mjs`](../scripts/_classnote/identity-keys.mjs) | `childKeys`(admin-core에서 **이동** + 재수출) · `studentIdentityKeys`(A~G 접미사 base 승격) · `matchesIdentity`(교집합, **부분일치 금지**) |
| 판정(순수) | [`offboard-safety.mjs`](../scripts/_classnote/offboard-safety.mjs) | `evaluateOffboardCandidate(facts)` → `{action, primaryCode, matchedCodes[], notEvaluatedCodes[], factsComplete, snapshot}` |
| 스캔(READ-ONLY) | [`scan-offboard-candidates.mjs`](../scripts/_classnote/scan-offboard-candidates.mjs) | 사실 수집(2-pass) + 독립 SQL 검증 + exit code. 4블록(원아 판정·보드 감사·ERP 품질·유예 효과)을 **단위 섞지 않고** 분리 출력 |

### 신원 = `child.id` 지목 + 증거 4겹 (연락처 대조 비채택)
- **I2 생년↔학년 ±1**(`expectedBirthYear` 재사용, 김서윤·김채은 잔존 가족 형태를 잡는다).
- **I3 정방향 카디널리티**: 이 원아에 매칭된 aywa 학생 **행 수 == 1**(퇴원 포함 전 학생 우주, **이름 매칭만으로** 센다).
- **I4 역방향 카디널리티**: 그 학생에 매칭된 원아 **행 수 == 1**. I3·I4가 **접미사 양방향**(`박서준`·`박서준C`가
  둘 다 원아 "박서준"의 후보 → 카디널리티 2 → 제외)과 **같은 학년 동명이인**(생년으로 안 갈림)을 함께 잡는다.
  ⚠️ `boardNameAmbiguity`는 역방향(`박서준C→박서준`)을 통과시켜 **못 쓴다**(board-safety.mjs:73, 프로브 확인).
- **I5 보드 소속 봉쇄**: 그 원아의 소속 보드가 전부 `(과목)유효이름` **1인 보드**(자기 것) ∪ `[ALL]`·그룹반 안.
  ⚠️ 판정은 **보드 ID로** 하고 그룹반(`[EIE]…`)은 foreign이 아니다(이름 파싱으로 세면 정상 학생 64건 오차단 실측).
  ⚠️ `ownedBoardNames`는 **활성 수강과 무관하게** 유효이름으로만 만든다(provision 기대집합을 쓰면 퇴원생은 0개라 전부 foreign).

### ⚠️⚠️ 원장 결정 (2026-07-30, 불변)
1. **한 과목이라도 살아 있으면 ClassNote에 남긴다** — `activeSubjects`는 **발송 opt-in이 아니라 전 과목**.
   수학 발송은 꺼져도 영어를 다니면 명부에서 내리면 안 된다(내리면 그 과목 보드까지 끊긴다). `enrolled`로 제외.
2. **유예 45일** — 실측: 그 과목을 끊었다가 다시 등록한 사례 31건(수학 11·영어 20)이 **전부 30일 내**, 31일↑ 0건 + 마진 15일.
3. **자동화 대상 = 완전 퇴원만.** 과목 이탈(재원 + 다른 과목 계속)은 구조적 제외 — 보드 감사 통계로만 표시.

### 판정 코드 (우선순위 순, action: exclude > hold > offboard)
`enrolled`(재원·전과목 수강 有) > `no_eywa_match` > `ambiguous_forward/reverse` > `identity_unknown` >
`erp_link_unknown` > `foreign_board` > `shared_board` > `input_inconsistent` > `members_unknown` >
`board_scan_failed` > `snapshot_incomplete` > `grace`(hold) > `recent_activity`(hold) > `ok`(offboard).
- **2-pass 계약**: 1-pass(값싼 사실 전건) → exclude 아닌 전부(**hold 포함**)만 원아 상세 조회 후 재평가.
  hold도 2-pass를 통과시키는 이유 = 뒤에서 `foreign_board`가 드러나면 exclude가 hold를 이겨야 하므로
  (hold에서 끊으면 위험이 hold 뒤에 숨는다). 미평가 가드는 `notEvaluatedCodes`·`factsComplete=false`로 **드러낸다**.
- **최근 활동(hold)**: 발송(`lesson_reports.student_id`)·재등록(`enrollments.start_date`)은 신뢰 키.
  인바운드 알림은 `notifications`에 `student_id`가 없어(§ notifications 스키마) **이름 부분일치뿐 = 약한 신호** →
  **hold 방향 전용**(과대매칭 무해, 비용=정리 지연). "안전하다"의 근거로는 절대 안 쓴다.

### 실데이터 적대 검증 (2026-07-30, read-only)
`node --env-file=.env.local scripts/_classnote/scan-offboard-candidates.mjs` — 명부 471명 → **후보 20 · 보류 53(전부 grace) · 제외 398.**
- **독립 검증(스캐너 판정과 별도 SQL): 후보 ∩ (재원 OR 활성수강 보유) = 0 ✅.** 위반 시 exit 1.
- 후보 20명 오프라인 재대조: 20행·위반 0·퇴원 경과 121~272일·활성수강 합계 0·최근30일 보고서 0.
- 유예 효과: 유예 0일이면 53명 → 45일 적용 후 20명(7월 대량 퇴원분이 유예에 걸림, 계산 정상).
- 보드 감사(별개 단위): 퇴원 보드 80 · 과목이탈 62 · aywa 미매칭 4 · 공유 6 · 인원 미확인 0.
- 검증 게이트: typecheck0 · lint0 · test 185(board-safety 35 무회귀 + identity-keys 16 + offboard-safety 새 케이스).

### 반(보드) 정리 후보 스캔 — [`scan-board-cleanup.mjs`](../scripts/_classnote/scan-board-cleanup.mjs) (READ-ONLY, 2026-07-30)
"aywa 기준으로 ClassNote에서 반삭제가 필요한 학생 정리"(원장 지시)의 산출물. 삭제·해제는 **사람이 UI에서**
한다(원아 해제·교사 해제·반 삭제 모두 REST 405/부재). 분류 = **가족 수 · 교사 연결 · 게시물 수** 3축:
`[A]` 가족0·교사0·**게시물0** = 잃을 게 없음 · `[B]` 게시물 1+ = 보존 권고(추억보기 원본) ·
`[C]` 가족 1+ = 원아를 먼저 내려야 삭제 자체가 불가 · `[D]` 교사만 남음 · `[E]` 손대지 말 것(미매칭·판정불가).

### ⚠️⚠️ 두 작업의 자격이 다르다 (원장 지시 2026-07-30, 불변)

원장 원문: *"두 과목 이상을 수강하다가 한 과목을 퇴원한 경우 반 삭제 및 반 배정해제하고 퇴원처리는 하면 안 됨.
여전히 다른 수업에는 배정되어 있어야 하기 때문."*

| 작업 | 단위 | 자격 | 유예 |
|---|---|---|---|
| **A. 반 삭제 + 배정 해제** | 보드(과목별) | **그 과목**을 그만뒀으면 가능(전과목/일부 무관) | ClassNote **무게시 45일** |
| **B. 명부 퇴원처리** | 학생 | **전과목 퇴원만** | 무게시 45일 **+ aywa 퇴원 후 45일** |

- **B에만 aywa 퇴원 유예를 요구하는 이유**: 게시물 없는 빈 보드를 지우는 건 20일차라도 무해하다(재등록하면
  프로비저닝이 다시 만든다). 그러나 **명부에서 내리는 건 비가역**이고(복구 = 학부모 재초대+재가입) 실측 재등록
  31건이 **전부 30일 내**였다. ⚠️ 이 조건을 빼면 **2026-07-10 대량 퇴원분(20일차) 37건이 그대로 퇴원처리 대상으로
  뜬다**(실제로 그렇게 나와서 잡았다 — `alsoOffboard`가 `action==="release"` + 전과목 + 유예 3조건을 모두 본다).
- **원장 결정**: 게시물이 45일 이상 안 올라온 보드는 **반 삭제도 수용**(추억보기 상실 감수). 단 아래 가드는 유지 —
  그건 추억이 아니라 **"엉뚱한 학생을 건드리는"** 다른 위험이다: 공유보드(가족 2+) · 동명이인 · aywa 미매칭 · 전화 불일치.

🔴 **실측 결과(2026-07-30, 전화 대조 적용)**: 학생모드 526 판정 →
**정리 가능 81** = `[A+B] 1`(전과목 퇴원·유예 경과) + `[A만] 80`(일부 과목 퇴원 43 + 전과목이나 유예 미경과 37) ·
**보류 53**(교사 연결 30 · 최근 게시물 23) · **제외 392**(수강중 371 · 동명이인 14 · 미매칭 4 · **전화 불일치 3**).
⚠️ `[A만]`의 37건은 2026-08-24경 유예가 차면 `[A+B]`로 올라온다.

⚠️ **우선순위는 "정상, 대상 아님"을 먼저 보고한다**(`subject_active` 1순위). 이걸 뒤에 두면 활발히 수강 중인
학생 **33건이 "전화 불일치"로 헤드라인**이 잡혀 원장이 엉뚱한 걸 확인하게 된다(실측·수정 완료). Op B의 `enrolled`와 같은 원칙.

⚠️⚠️ **이 엔드포인트의 두 함정 — 둘 다 실제로 잘못된 목록을 만들었다:**
1. 🔴 **`GET /api/v1_2/centers/{c}/reports/`의 `count`는 항상 1인 상수다.** `page_size=1`·`100`·무지정 전부 `count:1`이고
   **존재하지 않는 `cls`에도 `count:1`** 이다. 그걸 믿고 세면 **모든 보드가 "게시물 1건"** 이 되어(첫 실행에서 69개 보드가
   전부 1건으로 나왔다) `[A]`가 0개·`[B]`가 69개로 **완전히 뒤집힌 목록**이 만들어진다. 진짜 수는 `results.length`.
2. 🔴 **`next` 커서로 페이지를 이어받으면 `cls` 필터가 풀린다.** 실측: 6건인 보드를 `page_size=2`로 커서 추적하면
   11페이지·20건이 나오고 id 집합이 불일치했다(남의 보드 글이 섞임). → **단일 요청**만 하고 `next`가 있으면
   "100건 이상"으로만 보고한다(삭제 판정엔 0인지 아닌지가 핵심).
- ⚠️ 보드명 매칭에 `childIdentityKeys`를 쓰지 말 것 — 그건 **학부모가 지은 원아 표시명용**(라틴·괄호 제거)이라
  `(수학)박서준C`의 접미사를 벗겨 정상 보드를 통째로 '동명이인'으로 만든다(실측 정상 380→329 과소). 보드 base는 **정확 일치**로 조회.
- 두 스캔의 '정상' 수가 356 vs 380으로 달라 보이는 건 모순이 아니다 — 이 스캔만 **동명이인 38개를 따로 뺀다**
  (356+38 = 380+3+11 계산이 맞물린다). 단위를 섞어 비교하지 말 것.

### ✅ 실행 기록 — 보드 60건 삭제 완료 (2026-07-30, 원장 승인 하 단계 실행)

원장 승인: *"정말 두번 세번 네번까지 생각했을때 보드 삭제해도 이상없다면 보드삭제 몇개씩 해보고 이상없다면 계속 나머지까지."*

**재검토에서 확정된 결정적 사실**: release 81건이 **전부 게시물 0건**이었다 → **추억보기로 잃는 것이 0**.
게시물이 유일한 비가역 손실인데(보드는 프로비저닝이 재생성 가능, aywa는 보드 id를 저장하지 않아 고아 참조도 없다)
그게 0이면 보드 삭제는 **실질 가역**이다. 그래서 1군(게시물0·가족0·교사0) 60건만 실행 대상으로 잡았다.

| 단계 | 결과 |
|---|---|
| dry-run | 60건 전부 실행 직전 재확인(가족 0·게시물 0) 통과 · 21건은 가족 연결로 자동 보류 |
| 카나리 3건 | ✅ 성공 — 보드 654→651, **나머지 57건 그대로**(엉뚱한 삭제 0) |
| 나머지 57건 | ✅ 성공 0 실패 |
| **최종** | 전체 보드 **654→594** · 학생모드 **526→466** (정확히 60) |

**독립 검증(삭제 후)**: 삭제한 60건 중 **그 과목 수강 중인 학생의 보드 0건** · 재원생의 기대 보드 중 **우리가 지운 것 0건**.
⚠️ "수강 중인데 보드 없음 75건"이 보이지만 **전부 우리와 무관한 기존 상태**다(미가입 33명 + 영어는 1인보드가 아니라 그룹반 배달).

- **삭제 경로 = `DELETE /api/v1/classes/{id}/` (200번대)** — ID 지목이라 DOM 오클릭 위험이 없다. 실행기
  [`delete-classnote-boards.mjs`](../scripts/_classnote/delete-classnote-boards.mjs)는 **dry-run 기본**, `--apply --limit=N`,
  건별 **실행 직전 재확인(TOCTOU)** + **사후 목록 재조회 검증**. 판정은 스캔과 **같은 `evaluateBoardRelease`**를 쓴다.
- **남은 21건 = 가족 1+** → ClassNote가 삭제를 거부한다(학생 있으면 삭제 불가). 배정 해제는 REST 405라 **UI 수작업** 선행 필요.

### 다음 단계 (범위 밖 · 별도 승인)
- 🔴 **write Phase 선결 관문**: ERP 행을 결정적으로 지목할 수 없다(이름뿐). Phase 1 probe는 "쓰기가 되는가"보다
  **"`child.id`로 지목되는 퇴원 경로가 있는가"** 를 먼저 확인해야 한다(학원이 테스트 계정). 그 뒤에야 ERP 연동·
  `no_action`(이미 처리됨) 판정을 도입한다.
- ~~**Phase 2**: 큐 + 원장 승인 UI + 사전 스냅샷 저장 + 처리 후 재조회 검증 + `audit_logs` + `selectExecutionBatch`(킬스위치·상한·카나리·TOCTOU).~~ → ✅ 2026-11-03 구현(원장 결정 — 승인 UI 대신 '45일 + 가드 + 직전 백업 + 하루 상한 + 재조회 + 멈춤 표식' · 위 'Phase 2 구현').

### ✅ "퇴원 학부모가 과거 알림장을 못 본다"는 우려 = 해소 (2026-07-30, 원장 제보 + 공식 문서 확인)

원장 제보: *"과거 알림장 볼 수 있더라고. 클래스노트 자체에 지난 추억 보기가 있어."* → 사실 확인됨.
ClassNote는 키즈노트 계열이고(푸터 "Kids Note, Inc."), 키즈노트 공식 안내가 **퇴소·졸업 후에도 학부모가
로그인하면 그때까지의 알림장·앨범을 `추억보기`로 계속 열람**한다고 명시한다
([졸업 후 열람](https://www.with-kidsnote.com/guide/tip_parents_4) · [퇴소 후 열람](https://www.with-kidsnote.com/guide/parents/graduation1)).
기관설정 > 메뉴 관리의 모듈 12종에 '추억'이 없는 것과도 일치한다 — **기관 모듈이 아니라 학부모 앱 기능**이다.

→ **Phase 2의 마지막 원장 결정 항목이 닫혔다.** 남은 관문은 위 write-path probe 하나뿐이다.
→ 이 사실은 **보드 삭제 비채택**(§11 비목표)이 옳았다는 근거이기도 하다. 우리가 하려는 건 **ERP 퇴원처리**(=퇴소)이고,
   그건 공식 문서가 말하는 "열람이 유지되는" 바로 그 경로다.

⚠️⚠️ **단서 2개 — 이걸 어기면 추억보기가 실제로 깨진다(공식 문서 명문):**
1. **회원 탈퇴는 다르다.** 학부모가 키즈노트 **계정을 탈퇴**하면 자료를 못 본다. 우리 작업은 기관 퇴원처리일 뿐
   학부모 계정을 건드리지 않는다 — 앞으로도 **학부모 계정 삭제·탈퇴를 자동화 대상에 넣지 말 것.**
2. 🔴 **퇴원 전후로 게시물(알림장)을 삭제하지 말 것.** 공식 안내가 *"원에서 퇴소 전 게시물을 삭제하지 않도록"* 이라고
   못박는다 — 추억보기는 **그 게시물 원본을 읽기** 때문이다. 우리에겐 실제로 동작하는 삭제 경로가 있다
   (§ 반 공지 회수 `DELETE /api/v1_2/reports/{id}/` → 204). **"옛 보고서 정리" 같은 명목의 대량 삭제 금지** —
   퇴원처리는 명부에서 내리는 것이고 게시물은 남겨두는 것이 학부모의 추억을 보존하는 조건이다.
