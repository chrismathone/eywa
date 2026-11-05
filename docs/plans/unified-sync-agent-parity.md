# 통합 연동 앱의 기존 기능 보존 기준

2026-10-08 기준. [상세 설계](./unified-sync-agent.md)의 전환 필수 조건이다. 아래는 **기존 소스에서 확인한 기능과 이관 기준**이다. 1.0.0은 기존 실행기 125개 소스를 재사용하며, 실제 묶음 일치 검사·회귀 검사·변경한 인증 경계의 검증은 [수용 검증 보고서](../_audit/sync-agent-acceptance-2026-10-08.md)에 기록했다. 실제 연동 PC와 외부 계정의 전체 인수 시험까지 완료했다는 뜻은 아니다.

기존 발송/수납/상담 로직을 기능이 적은 새 구현으로 대체하지 않는다. 외부 서비스 처리와 순수 판정 로직을 재사용하고, 설치·실행 제어·인증·DB 접근 경계를 분리한다. 기존 코드에 있는 보안 결함이나 명시적으로 폐기된 경로까지 보존한다는 의미는 아니다.

## 클래스노트

기준 실행기: [watch-classnote-queue.mjs](../../scripts/_classnote/watch-classnote-queue.mjs). 일반 폴링 15초, 성공한 배치가 꽉 차면 밀린 작업을 빠르게 이어 처리한다. 다음 항목을 모두 이관한다.

| ID | 기존 기능 | 근거 파일 (`scripts/_classnote/`) | 보존할 결과와 제한 |
|---|---|---|---|
| CN01 | 수업보고서 발송 | `classnote-core.mjs`, `report-video-line.mjs` | 공유 링크·보고서 스크린샷·숙제 제출 링크, 실제 게시 결과. 내부 캡처를 학부모 열람으로 집계하지 않는다. |
| CN02 | 발송 대상과 보드 선택 | `board-safety.mjs`, `homonym-phone-gate.mjs`, `classnote-class-route.mjs`, `class-route-decide.mjs` | 과목·수강·유효이름·동명이인·공유 보드·원아 확인, 수학 1인/반 보드 경로, 교차 노출 감지 시 정지. |
| CN03 | 발송 시간과 재시도 | `classnote-core.mjs`, `send-window.mjs` | 기존 큐·발송 허용 시간·오래된 보고서 제한·예외·재시도 상한·부분 성공·외부 중복 대조. 새 앱 설치로 대기 전체를 즉시 발송하지 않는다. |
| CN04 | 학생별 공지 | `classnote-notice-core.mjs`, `notice-class-route.mjs`, `notice-attachments.mjs` | 대상별 개인화 본문, 공통/개별 이미지, 첨부 누락 시 발송 차단, 공유 보드 개인정보 보호, 대상별 결과. |
| CN05 | 학생별 공지 수정·회수 | `classnote-notice-core.mjs` | `edit_requested`와 `revoke_requested` 모두 처리. 기존 글 ID와 대상 대조, 남의 글 변경 금지. 발송 OFF에서도 정정/회수 가능한 기존 의미 유지. |
| CN06 | 반 단체 공지 | `classnote-class-notice-core.mjs`, `class-notice-guard.mjs` | 반마다 공지 1건, 현재 반 구성 검증, 반 하나만 지정, 이미지 전부 준비, 게시 후 실물 확인, 반별 부분 성공. |
| CN07 | 보고서 회수 | `classnote-recall-core.mjs`, `share-bases.mjs` | 과거/현재 공유 주소와 토큰으로 정확한 글만 회수. 오래된 글 회수 가능. 발송 OFF와 독립, 확인 불가를 삭제 완료로 처리하지 않음. |
| CN08 | 신규생 보드 생성·배정 — 🔴 **없앰(2026-11-04 · 1.0.14 · 1인 보드 배정 금지)** | ~~`classnote-provision-core.mjs`~~(지움) | 05시 KST 이후 하루 1회. 재원·수강·발송 대상 조건, 동명이인 보류. 발송 OFF 중 준비 가능한 기존 의미 유지. |
| CN09 | 반 보드 일일 동기화 | `math-class-boards-sync.mjs` 및 load/plan/apply 모듈 | 새 반·개명·학생/강사 배정과 안전한 해제. 기존 연결 없는 지점에 임의 도입하지 않음. 1인 보드 해제/보드 삭제로 확대하지 않음. |
| CN10 | 변경 감지 자동 동기화 | `classnote-auto-sync.mjs`, `auto-sync-load.mjs`, `auto-sync-plan.mjs` | 1분 대조, 변경분만 기존 요청 큐 사용. `on/observe/off` 의미와 자동 해제 별도 스위치 유지. |
| CN11 | 지금 반 보드 동기화 | `classnote-sync-request.mjs`, `sync-request-plan.mjs` | 버튼 요청 선점·변경분 처리·반 15개 상한(신입 1인 보드 준비 20건 상한은 2026-11-04 없앰)·남은 항목 결과. 수동 처리가 일일 완료 표식을 덮지 않음. |
| CN12 | 원아 ID와 학생 연결 | `classnote-childmap-core.mjs`, `child-map.mjs` | 영어 그룹반·여러 원아 계정→한 학생 지원, 유일성 검증. 보호자 전화는 대조에만 사용. 현재 간격은 20시간 가드이며 05시 일일 작업과 다름. |
| CN13 | 학부모 새 글 수집 | `classnote-feed-core.mjs`, `parent-post-filter.mjs` | 1분 주기·워터마크·초기 기준선·오래된 연락 알림 제한, 현직 담당자 알림과 중복 방지. |
| CN14 | 학부모 댓글 수집 | `classnote-feed-core.mjs`, `parent-comment-events.mjs`, `parent-comment-filter.mjs` | 10분 주기, 댓글 수 비교와 ClassNote 알림 신호 경로 모두 유지. 감시창 밖 댓글·동일 시각 댓글·일부 조회 실패를 누락하지 않음. |
| CN15 | 연락 원문·첨부·분류 요청 | `classnote-inbox-store.mjs`, `cross-subject-teachers.mjs`, `repair-attachment-messages.mjs` | 원문·사진만 있는 연락·관련 과목 담당·첨부 원문 복구. AI 분류는 서버에 요청하며 PC에 AI 비밀키를 배포하지 않음. |
| CN16 | 답글 작성·수정·삭제 | `classnote-parent-reply-core.mjs`, `parent-reply-run.mjs`, `parent-reply-api.mjs` | 끔/시험/전체 모드·발송 스위치·대상 재검증·본문 변경·응답 유실 대조. 학부모 댓글이나 외부에서 수정한 댓글을 삭제하지 않음. |
| CN17 | 공감 추가·해제 | `classnote-parent-reaction-core.mjs`, `parent-reaction-run.mjs` | 답글과 같은 모드·대상 가드, 이미 처리한 공감 중복 없음, 다른 사람의 공감 해제 없음. |
| CN18 | 읽음 확인·영어 작성률 적재 | `classnote-read-core.mjs`, `english-posts-filter.mjs` | 30분마다 최근 14일 재조회. 같은 피드의 영어 작성 기록을 보존하며 적재 실패가 읽음 갱신을 막지 않음. 실제 발송 OFF에서도 기존 수신 확인 기능 유지. |
| CN19 | 반 보드 구성 스냅샷 | `classnote-roster-core.mjs` | 05시 KST 이후 하루 1회, 웹 대조용 현재 구성·보류 사유 유지. |
| CN20 | 운영 상태와 복구 | 실행기, `worker-issue-filter.mjs`, `log-rotation.mjs` | 브라우저/DB 재연결, 업무별 마지막 결과·오류·실게시 여부·지원 기능·영상 상태. 단순 heartbeat를 업무 성공으로 표시하지 않음. |

함수 헤더의 과거 설명보다 현재 조건 분기를 우선 확인한다. 예를 들어 개별 공지 코어의 옛 헤더와 달리 현재 `processNoticesOnce`는 신규 게시만 `sendOk`로 제한하고 수정·회수는 별도 처리한다. 이를 통합 토글 하나로 묶으면 회귀다.

## Google Drive 숙제 영상

기준 진입점: [video-worker.mjs](../../scripts/_classnote/video-worker.mjs). 클래스노트 내에 포함하되, 발송 루프와 동시에 처리되는 진행 작업을 통합 실행기가 추적해야 한다.

| ID | 기존 기능 | 근거 파일 (`scripts/_classnote/`) | 보존할 결과와 제한 |
|---|---|---|---|
| VD01 | 새 글·댓글 영상 큐 적재 | `video-inbox.mjs`, `classnote-feed-core.mjs` | 학부모 영상 선별, 원글/댓글 식별·중복 방지·지점 귀속. |
| VD02 | 과거 영상 순환 수집 | `video-history.mjs`, `video-feed-pages.mjs` | DB 커서·부분 페이지·진행 세대 유지. 한 바퀴 뒤 7일 후 재조회하여 오래된 글의 새 댓글 회수. |
| VD03 | 원본 다운로드 | `video-download.mjs`, `video-source.mjs` | 허용된 영상 출처·실제 파일 검증·원본 해시·크기와 재시도용 상태 유지. |
| VD04 | 학생·반·담임·숙제 연결 | `video-teacher-route.mjs`, `video-report-link.mjs`, `video-filename.mjs` | 보고서 댓글은 해당 보고서 숙제로 연결. 판단 불가는 확인 대상으로 보존. 이미 선택된 담임 폴더를 재시도 때 바꾸지 않음. |
| VD05 | 계정·폴더 선택 | `video-drive-settings.mjs`, `video-drive-token.mjs`, `video-drive-auth.mjs` | 지점 소유 확인, 계정별 토큰, 기존 계정/레거시 폴더. 설정 변경으로 과거 파일을 이동하거나 진행 작업을 새 계정으로 돌리지 않음. |
| VD06 | 담임 폴더 생성·공유 식별 | `video-drive-folders.mjs`, `video-folder-registry.mjs` | 동명/동시 생성 시 지점·기관·담임 기준 등록부. 다른 지점의 폴더를 재사용하지 않음. |
| VD07 | 압축과 원본 보존 | `video-compress.mjs`, `video-ffmpeg.mjs` | 기존 압축 설정·규격, 세로 회전·재생 길이·오디오 보존. HDR/절감 부족/도구 없음/실패 시 기존 원본 업로드 경로 유지. |
| VD08 | 업로드 재개·중복 방지 | `video-drive.mjs`, `video-state.mjs`, `video-folder-registry.mjs` | 재개 URL·파일 ID·원본/전송 해시·확정 폴더 보존. 완료 응답 유실을 새 영상 생성으로 바꾸지 않음. |
| VD09 | 저장 공간 관리 | `video-drive-quota.mjs`, `video-job-pick.mjs` | 계정별 공간 기준, 선점 전 중지, 한 계정 문제로 다른 계정의 이미 고정된 작업까지 막지 않음. |
| VD10 | 업로드 완료·실패·정리 | `video-worker.mjs` | 작업 잠금 토큰 일치 시만 DB 완료, 실패 후 재시도 상태 유지. 완료 확인 전에 원본/재개 파일 삭제 없음. |
| VD11 | 사람이 Drive에 올린 영상 수집 | `video-manual-scan.mjs`, `video-manual-name.mjs` | 10분 간격, 파일명/담임 폴더 기반 학생 연결·중복/모호함 확인 목록. 파일 이동·이름 변경·삭제 반영. 이 경로가 Drive 파일 자체를 수정하지 않음. |
| VD12 | 웹 제출·재생·장부 연결 | `src/features/video-submit/`, `src/features/video-homework/` | 기존 웹 업로드·폴더 검증·Google 연결·학생별 재생/장부 경로 유지. 서버 기능을 EXE 안으로 옮겨야 한다는 의미는 아님. |

`kickVideoWorker()`뿐 아니라 `kickAttachmentRepair()`도 백그라운드 처리를 시작한다. 메인 폴이 끝났다는 이유만으로 유휴라고 판정하면 안 된다. 업데이트/정상 종료 전에 모든 진행 작업과 자식 프로세스를 추적하고, 영상의 압축·업로드·이력 수집·직접 제출 훑기 및 첨부 원문 복구가 안전한 종료 지점에 도달했는지 확인한다.

## makeedu

기준 진입점: [watch-sync-requests.cjs](../../scripts/_makeedu/watch-sync-requests.cjs), [sync-all.cjs](../../scripts/_makeedu/sync-all.cjs), [check-session.mjs](../../scripts/_makeedu/check-session.mjs), [setup-sync-pc.ps1](../../scripts/_makeedu/setup-sync-pc.ps1).

| ID | 기존 기능 | 근거 파일 (`scripts/_makeedu/`) | 보존할 결과와 제한 |
|---|---|---|---|
| ME01 | 정기·수동·누적 요청 처리 | 실행기, `run-local-sync.ps1`, `sync-all.cjs` | 기존 PC의 06시/18시 예약, 수동 요청 15초 감시·병합, 요청자·실행 출처·도메인별 결과. 새 예약은 KST로 명시하며 기존 PC 시간대도 이관 전에 대조. |
| ME02 | 목록 수집 | `scrape.cjs`, `extract-table.cjs` | 학생·반·예비상담·수납과 퇴원 목록. 로그인/저장 세션·여러 청구월·행수/합계/환불 검증. |
| ME03 | 학생 동기화 | `import-students-list.cjs`, `lib.cjs` | 기존 학생 값 보존, 자연키·원생번호·동명이인 판정. 순번을 고유번호로 쓰지 않음. |
| ME04 | 반 연결 | `import-classes.cjs` | 기존 반에 일치하는 makeedu ID만 보충. makeedu에만 있는 반을 새로 만들거나 기존 시간표·담임·색상을 덮지 않음. |
| ME05 | 예비상담 | `import-prospects.cjs` | 기존 신규 적재 범위·기본 90일 컷오프·이미 있는 기록 보존. 상세 내용 조회 경로는 별도로 유지. |
| ME06 | 수납·환불·미수 반영 | `import-invoices.cjs`, `invoice-stale.cjs`, `invoice-student-matcher.cjs` | 원생/월 집계·할인/적립/환불·합계 대조·0행/절단 차단·부재/퇴원 판정·대량 무효 차단. 돈 관련 쓰기 규칙을 단순 insert-only로 바꾸지 않음. |
| ME07 | 교재 등록·납부 자동 체크 | `mirror-textbook-checks.cjs` | 라인 생성=등록, 금액상 완납=납부. 수동 해제 존중·라인 중복 소비 금지·자동 해제 없음. 수납 검증 실패 시 함께 중지. |
| ME08 | 재원생 상담 증분 | `sync-consultations-incremental.cjs`, 상담 판정 모듈 | 최근 창·상담번호·학생/상담자/반 매칭, 기존 내용 보존·백필·신규 상한·상세 조회 시간 제한. |
| ME09 | 상담 수동 역동기화 | `push-consultations.cjs`, `lib.cjs` | 웹의 보내기 요청·대상 판정·기존 성공 표식·외부 제출 결과와 요청자 기록. |
| ME10 | 주간 역동기화 | `weekly-push.cjs` | 일요일 06시 KST, 놓친 버킷 이어받기, 주당 최대 50건, 0건이어도 버킷 소비, 왕복·진행 중·이미 보낸 상담 제외. |
| ME11 | 접속 점검·알림 | `check-session.mjs`, `run-health-check.ps1` | 08:30, 저장 세션 우선·필요 시 로그인 1회·같은 날 중복 알림 방지·네트워크 판정 불가와 인증 실패 구분. |
| ME12 | 이력·오류·복구 | 실행기, `sync-all.cjs`, `lib.cjs` | `running/ok/partial/error/skipped`, 도메인별 결과·원인·현재 동기화 상태, 한 도메인 실패 후 나머지 계속. |

현재 `check-session.mjs`는 `CLASSNOTE_TENANT_ID`를 쓰고 makeedu 라이브러리는 `MAKEEDU_TENANT_ID`를 쓴다. 통합 앱은 기기 등록에서 확인한 동일 지점을 모든 실행/알림 경로에 전달해야 한다. 두 설정이 다르면 추측해 실행하지 않는다.

## 수동 관리 도구와 실행 환경

자동 워커에 연결되지 않은 수동 기능도 누락 목록에서 지워버리지 않는다. 기존 진입점을 조사해 대응 관리 동작/정식 대체 경로를 지정하고, 작업별 검증 전에는 완료 처리하지 않는다.

| 범위 | 기존 도구 | 이관 기준 |
|---|---|---|
| 1회 실행·복구 | `process-classnote-*`, `process-parent-*`, `sync-child-map`, `sync-classnote-reads`, `backfill-attach-only-messages` | 같은 큐/코어·권한·중복 방지 안에서 관리자 진단/복구 기능으로 제공. 별도 스크립트가 잠금을 우회하지 않음. |
| 보드 준비·대조 | `provision-*`, `assign-*`, `scan-*`, `survey-*`, `plan-class-board-release` | 현재 관리 기능의 대상 대조·미리보기·상한 보존. 자동 처리와 수동 적용 의미 구분. |
| 영상 설정·점검 | `check-video-*`, `download-classnote-video`, `video-oauth-*`, `setup-video-drive*` | 연결/용량/압축/재연결을 앱·웹에서 수행. 기존 Google 연결을 초기화하지 않음. |
| 오래된 수납 재대조 | `reconcile-invoices.cjs`, `reconcile-plan.cjs` | 기존 대상 한정·월별 수집·신뢰 가능한 4회 부재 기준 보존. 저장소 기본 스케줄러에서 자동 등록된 것으로 단정하지 않음. |
| 상세·초기 가져오기 | `sync-prospects`, `apply-prospect-outcome`, `import-students`, `import-enrollments`, `import-consultations-excel`, `import-catalog`, `import-shuttle` 등 | 기존 수동 처리의 입력·미리보기·보존 규칙 유지. 이관을 이유로 모두 정기 실행에 넣지 않음. 실제 운영 PC의 추가 예약도 목록 대조. |
| 정리/일회성 이전 | `delete-classnote-boards`, `wipe-tenant-data`, `replace-invoices-from-excel`, `import-schedules-from-ijw` 등 | 운영 자동 작업에서 호출하지 않음. 존재한다는 이유로 설치/업데이트 후 재실행하지 않음. 원본 저장소의 관리 이력과 명시적 실행 경계 유지. |
| 설치·필수 프로그램 | 기존 PS1/BAT, Node·Playwright 브라우저·FFmpeg/FFprobe, 수동 Excel 도구 의존성 | 최종 설치 파일만으로 실제 필요한 의존성이 준비되는지 깨끗한 Windows에서 검증. 개발 PC의 PATH·node_modules·브라우저 캐시에 우연히 의존하지 않음. |

기존 `WORKER_CAPS`의 19개 항목도 계약이다: `autoBoardSync`, `classNoticeImages`, `noticeClassRoute`, `noticeAttachments`, `nativePublish`, `reportRecall`, `kageFailReasons`, `mathClassRoute`, `classWideNotice`, `classBoardSync`, `syncRequests`, `homeworkVideoArchive`, `homeworkVideoTenantFolders`, `homeworkVideoTenantAccounts`, `homeworkVideoReportLink`, `parentReply`, `parentReplySettings`, `parentReaction`, `attachmentMessageRepair`. 구현/설정이 받쳐주지 않는 기능을 일괄 `true`로 광고하지 않는다. 기존 웹이 쓰는 지원 기능·실게시 여부·온라인 판정을 전환 기간에도 호환해야 한다.

## 이관할 상태와 전환 금지 조건

- 발송/공지/회수/답글/공감/수동 동기화/역동기화 큐, 부분 결과, 외부 글 ID, 재시도·불확실 표식은 새 큐로 초기화하지 않는다.
- 워터마크·댓글 수 기준선·원아 연결·반 보드 연결·일일 완료 표식·주간 버킷·과거 영상 커서를 보존한다. 실행 파일 폴더를 교체하면서 함께 지우지 않는다.
- 영상 원본·압축 판단/결과·재개 상태·확정 root/connection/teacher·파일/폴더 등록부를 보존한다. 저장 폴더 설정과 이미 보관된 파일을 그대로 유지한다.
- 기존 업무 스위치·발송 시간·보낼 반·답글 모드·자동 보드 동기화/해제·압축·용량 기준·로그 설정을 값과 의미 모두 유지한다. 신규 설치 기본값으로 덮지 않는다.
- 기존 클래스노트 로그 기본값은 30일·파일 회전 20MiB다. 새 공통 진단 로그의 정책과 구 업무 로그 이관을 구분하고 기존 이력을 즉시 삭제하지 않는다.
- 기기 등록/서버 API로 인증 경계가 바뀌어도, 새 버전 설치 자체가 과거 보고서 재발송·영상 재수집 처음부터·주간 상담 재전송의 원인이 되지 않아야 한다.

**한 항목이라도 새 실행 경로에서 누락되거나, 실제 입력/결과를 대조하지 못하면 기존 워커를 제거하지 않는다.** 기존 코드의 단위 테스트 통과는 새 EXE의 동등성·기기 등록·업데이트 복구 시험을 대신하지 못한다.

## 가상 테스트

`node scripts/_sync-agent/dryrun.cjs`는 워커와 관련 웹 테스트를 찾아 실행한다. 운영용 `.env`를 넘기지 않고 Node 외부 통신을 차단하며, 차단 장치 자체를 먼저 점검한다. 실제 워커 `--post/--apply`나 운영 dry-run 명령은 실행하지 않는다. 기존 워커의 dry-run에도 큐 선점·복구·heartbeat 등 DB 쓰기가 있으므로 무변경 시험으로 간주할 수 없다.

실행별 선택 파일·원본 워커 해시·Vitest 결과·네트워크 시도·실패/건너뜀을 `work/unified-sync-agent-dryrun/`에 남긴다. 이 도구는 신뢰된 저장소 테스트용 Node 통신 차단이며 임의 네이티브 실행 파일을 격리하는 OS 샌드박스는 아니다. 새 EXE 수용 검증의 상태는 별도로 남긴다.
