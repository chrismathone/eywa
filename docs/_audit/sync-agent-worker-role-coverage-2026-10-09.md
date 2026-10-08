# 통합 연동 앱 역할 검수 — 2026-10-09

검수 대상은 실제 설치된 1.0.1과 수정된 1.0.2 / sequence 4다. 운영 확인과 격리된 회귀 검증을 구분한다. 일반 학생·학부모 발송, 회수, 답글·공감과 상담 전송을 시험 실행하지 않았다. 시험 학생 `학원이`의 실제 ClassNote 작업은 허용됐지만, 이번 검사에서는 발송하지 않았다.

## 역할별 확인

ClassNote의 실제 실행기 `watch-classnote-queue.mjs`가 기존 16개 단계를 같은 순서로 호출하는지 VM fixture로 확인했다. 실행 임대 상실과 종료 요청 때 다음 단계를 시작하지 않고 영상·첨부 마무리를 기다리는 것도 확인했다. 각 기능의 기존 회귀 테스트는 외부 통신이 차단된 전체 검사에 포함된다.

| 기존 역할 | 새 앱의 연결 및 검사 근거 | 실제 운영 확인 |
|---|---|---|
| 수업보고서 발송 | `processQueueOnce`, 기존 보고서/보드 경로 회귀 | 일반 대상 발송 미실행 |
| 개별 공지·첨부 | `processNoticesOnce`, `notice-attachments.test.mjs`, `notice-class-route.test.mjs` | 미실행 |
| 반 전체 공지 | `processClassNoticesOnce`, `classnote-class-notice-core.test.mjs`, `class-notice-guard.test.mjs` | 미실행 |
| 발송 회수 | `processRecallsOnce`, 기존 임대/보고서 경로 회귀 | 미실행 |
| 반 자동·수동 동기화 | `autoSyncTick`, `processSyncRequestOnce`, 기존 동기화 요청/반 보드 회귀 | 외부 명단 변경 미실행 |
| 학부모 답글·수정·삭제 | `processParentRepliesOnce`, `parent-reply-run.test.mjs`, `parent-reply-guard.test.mjs` | 미실행 |
| 학부모 공감·취소 | `processParentReactionsOnce`, `parent-reaction-run.test.mjs` | 미실행 |
| 신입 준비 | `provisionDailyOnce`, 기존 학생/보드 경로 회귀 | 외부 보드 변경 미실행 |
| 수학 반 보드·해제 | `syncMathClassBoardsDaily`, `class-board-*.test.mjs`, `math-class-boards-*.test.mjs` | 미실행 |
| 원아 ID 연결 | `syncChildMapOnce`, `child-map.test.mjs` | 미실행 |
| 학부모 글·댓글 수집·알림 | `pollParentPostsOnce`, `pollParentCommentsOnce`, 서버 원자적 feed 처리 및 기존 회귀 | 미실행 |
| 읽음 확인 | `pollReportReadsOnce`, `classnote-read-core.test.mjs` | 미실행 |
| 반 구성 스냅샷 | `snapshotBoardRosterOnce`, 기존 명단/보드 회귀 | 미실행 |
| 숙제영상 수집·압축·Drive 보관 | `kickVideoWorker`, `video-worker.test.mjs`, `video-drive*.test.mjs`, `video-oauth.test.mjs`, `video-compress.test.mjs` | 실제 Drive 업로드 미실행; 포함 ffmpeg의 실제 로컬 인코딩 통과 |
| 메이크에듀 수동 동기화 | 실제 watcher의 요청 claim → `sync-all` → 완료, `watch-sync-managed.test.ts` | 웹 요청 1건 처리 완료; 학생·반·예비상담·수납·교재·재원상담 6영역 성공 |
| 메이크에듀 정기 동기화 | 서버 최신 주기 단일 claim, 실제 watcher 순서 fixture | 자동 주기 2건 처리 완료; 같은 주기 재실행 없음 |
| 메이크에듀 접속 점검 | `check-session.mjs`, 실제 watcher 예약 처리 fixture | 운영 로그인 점검 완료 및 세션 갱신 기록 확인 |
| 메이크에듀 주간 상담 적재·전송 | `weekly-push.test.ts`, 실제 watcher enqueue → pending push 순서 및 종료 차단 검사 | 시험 전송 미실행; 기존 완료 62건 외 pending 없음 |
| PC 연결·임대·중지·업데이트 | 실제 서버 서비스 + 격리 PostgreSQL, 실제 Electron/네이티브 프로세스 검사 | 1.0.1 기기 등록·20초 heartbeat·설정 중지 확인; 1.0.2 적용 후 확인은 별도 |
| PC·웹 로그 | 실제 네이티브 자식 stdout/stderr 수집, KST 자정·UTF-8·파일 분리·자격증명 마스킹, 안전한 웹 코드 검사 | 웹 날짜·오류 필터 확인; PC 상세 로그는 새 버전 적용 후 생성 |

## 결과와 한계

- 전체 회귀: **271개 파일 / 4,033개 테스트 통과**, 실패·스킵·외부 통신 시도 0. 실제 ffmpeg 검사도 포함됐다.
- 별도 제어 DB 검사: **26개 통과**. 실제 gateway를 통해 반환 컬럼 없는 명령, 빈 배열과 JSON 객체의 저장 형태까지 검증했다.
- 데스크톱 단위/네이티브 검사: **36개 통과**. 브로커의 실제 ClassNote 임대 어댑터와 별도 네이티브 자식의 로그 수집/종료를 포함한다.
- 1.0.2 실제 패키지의 메뉴 제거, Alt 키, 창 닫기 후 유지, 버전별 업데이트 예약·취소·작업 대기·실패 시 자동 재적용 금지, 포함 Chromium·ffmpeg를 확인했다.
- 운영 DB의 워커 테이블 46개를 조회 가능한 역할로 검사하고 다른 지점 행이 보이지 않는 것을 확인했다. 제어 테이블 `sync_agent_settings`의 직접 접근 거부도 확인했다.
- 실제 쓰기 없이 현재 349개 태그 쿼리의 ID가 308개 등록 템플릿에 모두 포함되는지 확인했다. 동일한 템플릿 ID는 중복 집계하지 않는다.
- 실행 이력의 완료 누락은 운영자 제공 PC 로그로 확인한 정확한 3건만 복구했다. 업무 동기화를 다시 실행하지 않았다.
- ClassNote는 검수 중 OFF를 유지했다. 대기 중인 일반 발송 13건을 시험하려고 실행하지 않았다. 따라서 실제 ClassNote 계정 로그인, 학부모 게시판 발송과 Drive 권한 전체가 이번 검사로 운영 검증됐다고 주장하지 않는다.

회귀 근거: `work/unified-sync-agent-dryrun/2026-10-08T21-28-26.819Z/summary.json`. 개인정보·계정 값이 들어갈 수 있는 PC 원본 로그는 저장소에 커밋하지 않는다. 변경 이유·운영 복구·적용 순서는 [handoff](sync-agent-live-worker-handoff-2026-10-09.md)에 기록한다.
