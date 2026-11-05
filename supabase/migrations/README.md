# Supabase 마이그레이션 — 적용 방식·순서·현재 상태

## 🔴 2026-10-27 SQL 시즌2 — 시즌1은 합본 하나 · 새 파일은 `s2_0001`부터

원장 *"이전 001~458번대까지 sql을 전부 하나로 정리해서 뭉쳐놔. 번호가 너무 많이 올랐어. 다시 1번부터 시작할 수 있게"* · *"시즌2 sql 느낌으로 시작해 새로"*.

- **시즌1** = drizzle 번호본 `0000`~`0027` + alpha `0001a`~`0458a`, 낱개 568개 → **`s1_season1.sql`** 하나(새 DB에 적용하던 순서 그대로 — drizzle 저널 순서 → 이름순). 구역마다 머리줄 `--@@s1 <원래 파일 이름>`. 운영 DB에는 모두 적용돼 있다. 🔴 **고치지 않는다**(지난 기록). 낱개 파일과 drizzle `meta/`(저널·스냅샷)는 지웠다 — git 기록(합본 커밋 직전)에 그대로 있다. 합본 본문은 지문(sha256)으로 고정돼 있다.
- 🔴 **시즌2 전에 갈라진 작업을 합치는 세션은 [`docs/sql-season2.md`](../../docs/sql-season2.md)부터** — 부딪히는 브랜치 목록 · 옛 이름 바꾸기 · 옛 낱개를 고친 충돌 푸는 법.
- **시즌2** = **`s2_NNNN_설명.sql`**(0001부터 · 다음 빈 번호 · 빈틈·겹침 금지). 폴더에는 합본 · 시즌2 파일 · 이 README만 둔다 — 가드 `src/lib/db/migrations-corpus.test.ts`.
- 읽기 — 테스트·스크립트는 원래 이름으로 `readMigration("0349a_….sql")`, 적용 순서 전체는 `migrationFiles()`([`src/lib/db/migrations-corpus.mjs`](../../src/lib/db/migrations-corpus.mjs)). 문서의 옛 경로는 `s1_season1.sql#0349a_….sql`로 바꿨다. 아래 기록의 번호(0447a 등) = 합본의 그 구역.
- 새 DB = `pnpm db:alphas` — 시즌1 구역을 하나씩 → 시즌2 파일. 🔴 **빈 DB 전용**(`public.tenants`가 있으면 멈춘다). `pnpm db:migrate`는 안내만 하고 멈춘다. 운영 DB는 새 시즌2 파일 하나만 원장 승인 뒤 적용한다.
- 🔴 폴더에 규칙 밖 `.sql`(옛 `NNNNa_` · CLI 타임스탬프)이 섞이면 `migrationFiles()`가 던진다 — 그 SQL을 쓰는 가드·`db:alphas`가 모두 시끄럽게 실패한다(조용히 빠뜨리지 않게).
- 마지막 시즌1 파일 `0458a_makeup_reservation_checked.sql`(보강 진행 여부 확인) — ✅ 운영 적용 2026-10-27(칸 2 · 지난 이행 예약 3건 확인으로 채움).

## 2026-11-03 퇴원보고서: 원장 승인 없앰 · 관리자 승인 생략(보고서마다) · 데스크 환불 단계 · 표시용 칸 무시 대조 (s2_0025 · ⏳ 미적용)

`s2_0025_withdrawal_report_desk_refund.sql` — 원장 2026-11-03(머리 주석에 원문). ① 대조 열쇠 `withdrawal_report_compare_key`(표시용 칸·고정 이력 뺌) — 제출 트리거·처리 함수·`_v1` ② 데스크 환불 연결 표 `withdrawal_report_refunds`(정책 0 · service_role select/insert) + `attach_withdrawal_report_refund`(화면이 본 상태 대조) · `withdrawal_report_refund_pending` · 취소 때 `withdrawal_report_refunds_on_cancel`(데스크 할 일 취소 · '환불 진행 전 확인' 알림) ③ 작성 요청: 원장 받지 않음 · 새 화면은 `reportManagerIds`(보고서마다 승인 관리자 · 빈 목록 = 작성 강사가 관리자급일 때만) · 옛 화면은 종전 길 · 묶음 `manager_ids_check` 삭제 · 보고서 `manager_id` NOT NULL 해제 ④ 처리 함수: 승인 관리자 = 보고서 목록 · 관리자 0명 제출 = 승인 · 데스크 환불 대기면 묶음 대기 · `apply`는 환불 대기면 그대로 돌려줌 · 새 동작 `release` · 취소 때 데스크 처리 ⑤ `release_withdrawal_report_refunds`(skip locked) ⑥ `staff_tasks_private.withdrawal_sync_report` 관리자 차례 = 보고서 목록 먼저(한 줄). 함수 4개는 운영 정의(2026-11-03) 지문이 맞을 때만 바꾼다(다르면 멈춤). 🔴 **앱보다 먼저**(#95) — 지금 앱과 함께 돌아도 된다(`managerIds`만 보내는 요청은 종전 길 · 원장 선택은 무시). 번호: 같은 날 main에 0018~0021(업무 요청 · 업무 비서 · 업무 요청 유일 조건 · 연동 PC 출결 읽기)이 먼저 들어가 0022(작업 중 이름 0020). 시험 = PGlite에 운영 덤프 정의를 올려 시나리오 51개 + 되돌리기·다시 적용(release 동시 실행은 PGlite가 연결 하나라 재현 못 함 — skip locked + 잡은 뒤 재확인). 적용 뒤 새 앱 배포 → 진행 중 김다예 묶음 전환 스크립트(`--apply --app-deployed` · 작성 요청 상태일 때만). 되돌리기 = `scripts/_oneoff/revert-s2_0025-withdrawal-report-desk-refund.sql`(앱 먼저 · 생략·보고서별 관리자·데스크 대기·환불 끝난 처리 전 묶음이 진행 중이면 멈춤 · 연결 표는 남김).

## 2026-11-05 직원 역할 '아르바이트'(parttime) (s2_0024 · ✅ 운영 적용 2026-11-05 14:47 · CLI(원장 *"db는 승인할테니 cli로 해"*) · 🔴 병합 때 번호가 바뀌면 이 줄도 · 본문 글자는 적용한 그대로)

`s2_0024_parttime_role.sql` — 원장 *"권한 하나 더 추가해줘 열람보다 낮은 등급 '아르바이트'"*. ① 열거형 `public.system_role`에 `'parttime'`을 `'student'` 앞에 넣는다. ② `auth_menu_access`(0170a 정의 그대로)의 DEFAULTS 네 줄에 `"parttime":"none"`만 더한다(판정은 같다 — 표에 없는 역할도 'none' · 표가 `permissions.ts` 미러라 칸을 맞춤 · 가드 `src/lib/permissions-sql-mirror.test.ts`). 🔴 **웹 배포 전에** 적용한다(웹이 'parttime'을 저장하려면 열거형에 값이 있어야 한다). 적용 = 파일의 문장 3개(begin/commit 뺌)를 글자 그대로 감싼 do 블록(CLI) · 적용 전 운영 함수 정의 = 파일에서 parttime 4칸 뺀 것(공백 무시 일치) · 적용 후: `enum_range` = `{master,admin,manager,teacher,counselor,accountant,viewer,parttime,student}` · 함수 = 파일 그대로(소유자 postgres · 실행 권한 그대로) · 실제 계정 claims 흉내(되돌리는 거래)로 원장 = 네 메뉴 full · 열람 = 네 메뉴 none(전과 같음). 되돌리기 = 없음(열거형 값은 지울 수 없다 · 쓰는 계정이 없으면 아무 판정에도 걸리지 않는다).

## 2026-11-04 원생 보호자2 칸 (s2_0022 · ✅ 운영 적용 2026-11-04 15:05 · CLI(원장 승인) · 적용 때 임시 번호 s2_0024 → 합치며 s2_0022 · 본문·칸 설명 글자는 적용한 그대로)

`s2_0022_student_guardian2.sql` — 원장 *"메이크에듀가 아니라 에이와"* · *"여기서해서 올려 그냥"*(원생 수정 화면 '보호자 연락처'에 보호자를 한 명 더). 계기: 전유솔은 ClassNote 보호자1이 어머니 번호인데 에이와엔 아버지 번호만 있어 반 보드 자동 배정이 '보호자 전화 불일치'로 막혔다. `public.students`에 nullable text 칸 셋(`parent2_name` · `parent2_phone` · `parent2_relation`)만 더한다 — 기본값·제약·색인 없음(기존 줄 null 그대로 · 표를 다시 쓰지 않는다). 권한은 표 단위라 로그인 사용자·연동 PC 역할 모두 그대로 읽힌다 · 활동 로그 트리거는 칸을 일반으로 비교해 바뀐 값을 남긴다. 매일 쓰는 표라 트랜잭션 안 `set local lock_timeout = '3s'`. 🔴 **웹 배포 전에** 적용한다([[#95]] — 웹이 원생 상세·수정·목록 검색·형제·중복 후보에서 이 칸을 읽는다. 없으면 그 화면이 400으로 죽는다). 순서 = 이 SQL → 웹(질의 목록 포함) → AywaSync(ClassNote 워커가 원아 전화 대조에 `parent2_phone`을 더한 판). 콜&상담 자동 연결(`eywa_cs_match_rule` · `trg_link_consultation_on_student`)은 이 칸을 보지 않는다(따로 진행 중인 SQL 작업). 적용 확인(읽기만): `select count(*) from information_schema.columns where table_schema='public' and table_name='students' and column_name in ('parent2_name','parent2_phone','parent2_relation');` → `3`. 되돌리기 = `scripts/_oneoff/revert-s2_0022-student-guardian2.sql`(웹·AywaSync를 먼저 되돌린 뒤 · 적힌 값이 함께 사라진다). 적용 = 이 파일의 문장 6개를 글자 그대로 감싼 do 블록(CLI) · 적용 후 확인: `parent2_*` 칸 3개(text · nullable · 기본값 없음 · 설명 있음) · 원생 1,028행 · 보호자2 값 0행 · `eywa_sync_agent`·`authenticated` 둘 다 읽기 권한 있음.

## 2026-11-03 연동 PC가 출결을 읽기 — ClassNote 명부 퇴원처리 가드 (s2_0021 · ✅ 운영 적용 2026-11-03 — 권한 true · 정책 2 · 연동 PC 역할로 자기 지점만 읽힘)

`s2_0021_sync_agent_attendance_read.sql` — 명부 퇴원처리(전 과목 퇴원 45일 뒤 퇴소)가 '퇴원일 뒤 출결이 있으면 내리지 않는다'를 보는데(`scripts/_classnote/classnote-offboard.mjs` loadOffboardFacts), `attendance_records`는 `eywa_sync_agent`의 읽기 권한·정책이 없다(운영 실측 2026-11-03: select 권한 false · 이 역할 정책 0개 → 게이트웨이에서 42501). 자기 지점 줄 읽기만 연다(s2_0006·s2_0008과 같은 모양 · grant + 정책 둘 다 — 정책을 빼면 에러 없이 0행). 매일 쓰는 표라 `lock_timeout 3s`. 🔴 **웹·AywaSync(퇴원처리 워커) 배포 전에** 적용한다 — 없으면 워커가 퇴원처리를 보류로 건너뛰지만(보고서 '보류' 한 줄 · 워커는 지점의 가장 최근 출결이 없거나 14일보다 오래돼도 건너뛴다), 그 질의 실패를 게이트웨이가 `sync_agent_events`에 job_failed(error)로 매일 남겨 연동 화면에 오류가 뜬다. 트랜잭션 안 `set local lock_timeout`. 적용 확인(읽기만): `select has_table_privilege('eywa_sync_agent','public.attendance_records','select') as can_select, (select count(*) from pg_policies where schemaname='public' and tablename='attendance_records' and policyname in ('sync_agent_allow','sync_agent_tenant_boundary')) as policies;` → `true · 2`. 되돌리기 = 파일 머리 주석의 세 줄(drop policy 둘 + revoke).

## 2026-11-03 업무 요청 근거 학생: 담당 미정 줄의 유일 조건 풀기 (s2_0020 · ✅ 운영 적용 2026-11-04 — 제약 = `UNIQUE (request_id, target_type, target_id, assignee_id)` · 그때 연결 0줄 · 앱은 이 SQL 없이도 돈다)

`s2_0020_work_request_links_nulls_distinct.sql` — 커밋 전 적대적 리뷰(2026-11-03)가 찾은 것. `work_request_links_uniq`가 `nulls not distinct`라 한 학생을 맡은 두 담당자를 둘 다 지우면 두 번째 직원 삭제가 23505로 실패한다(`assignee_id`가 `on delete set null`). 제약을 일반 유일 조건으로 다시 만든다(담당 미정 줄끼리는 겹쳐도 된다 · 담당자가 있는 줄의 중복은 그대로 막는다). 이 기능 전용 표 하나만 바꾼다.

## 2026-11-02 업무 비서: AI 정리 기록 · 마지막 후보 (s2_0019 · ✅ 운영 적용 2026-11-02 — 옛 이름 `s2_0018`로 적용됨 · main 병합 때 번호만 밀었다 · 파일 안 표기와 표 설명도 그때 그대로 · 다시 돌리지 않는다)

`s2_0019_dashboard_secretary_notes.sql` — 원장 *"ai가 비서가되어줘서 알려주면 좋을듯"* · *"새벽 1시에 한번, 오후 1시에 한번 … 언제 돌렸는지 시간도 남겨"*. **새 표 둘만**(`dashboard_secretary_notes` = AI 정리 · 실행 종류 `run_kind` button/schedule · 숫자 기준 `basis_at` / `dashboard_secretary_inputs` = 사람마다 마지막 후보 한 줄). 기존 표 · 함수 · 트리거 · 알림은 건드리지 않는다. RLS 켜고 정책 0 · 로그인 사용자 · 공개 키 권한 없음(서버 키만). 같은 날 두 번에 나눠 적용(정리 표 → 실행 종류 · 기준 시각 칸과 후보 표를 더함 · 더할 때 정리 0건) — 지금 파일이 최종 모양이다. 적용 후 확인: 두 표 RLS · 정책 0 · 공개 키 `401 42501` · 서버 키 `200` · 되돌리는 거래 안에서 넣기 · 덮어쓰기 · 크기 제한(23514) · 모르는 실행 종류(23514) · 남은 행 0. 표가 없으면 앱은 'AI로 정리' 버튼 없이 자동 정리만 보인다(#95).

## 2026-11-02 업무 요청: 요청 → 담당자 보고 → 관리자 검토 → 마감 (s2_0018 · ✅ 운영 적용 2026-11-02 — 옛 이름 `s2_0017`로 적용됨(내용 한도 20,000은 11-03 따로 적용) · main 병합 때 번호만 밀었다 · 파일 안 표기와 표 설명도 그때 그대로 · 다시 돌리지 않는다)

`s2_0018_work_requests.sql` — 원장 *"그렇게 추천방식으로 해보자"* · *"기존 2.0은 아무 이상 없도록 별도로 적용"*(3.0 AX를 2.0에 녹이는 2단계). **새 표 넷(`work_requests` · `work_request_assignees` · `work_request_links` · `work_request_events`)과 새 함수 둘(`work_request_create` · `work_request_act`)만** 더한다 — 기존 표·함수·트리거·알림·슬랙·할 일은 건드리지 않는다. RLS 켬 · 정책 0개 · 로그인 사용자·비로그인 권한 회수 · 서버 키만. 같은 날 고침(원장 *"담당에 담당 학생이 배정되는것처럼"*): 학생 연결에 맡은 담당자 칸(`assignee_id` · 같은 학생을 두 담당자가 맡을 수 있다 · 담당 미정 = null) · 만들기 함수가 `p_links jsonb`([{student, assignee}])를 받는다 — 빈 표라 운영 DB에서 연결 표를 다시 만들고 함수를 바꿔 이 파일과 같게 맞췄다(바꾸기 전 업무 요청 0건). 적용 후 확인: 네 표 모두 RLS·정책 0 · authenticated/anon 읽기 없음 · 함수 실행은 service_role만 · 되돌리는 거래 안에서 흐름 한 바퀴(막히는 동작 8가지 포함) 뒤 남은 행 0. 앱은 표가 없으면 업무 흐름 구역을 그리지 않는다(#95). 같은 날 저녁 고침(원장 *"담임에게 전달할 내용이 너무 두서없이 … 노션처럼 약간의 서식"*): 내용을 서식 글(전자결재와 같은 편집기 HTML)로 담으며 `work_requests.body` 한도를 4,000 → 20,000자로 올렸다(`work_requests_body_check` 다시 만듦 · 그때 요청 0건) — 이 파일이 최종 모양이다.

## 2026-11-02 퇴원보고서: 상세사유 제출 기준 200자 → 100자 (s2_0015 · ✅ 운영 적용 2026-11-02)

`s2_0015_withdrawal_detail_min_100.sql` — 원장 *"퇴원보고서 상세사유 100자 이상으로"*. 전이 함수 두 개(묶음 · `_v1`)의 글자 수 검사와 거절 문구만 치환한다. 🔴 앱 배포 전에 적용(반대면 그 사이 100~199자 제출이 200자 문구로 거절된다). 되돌리기 = `scripts/_oneoff/revert-s2_0015-withdrawal-detail-min-100.sql`.

## 2026-10-30 퇴원보고서: superadmin 승인자 차단 · 원장 바로 승인 알림 · 수학(심화) 기록 정리 (s2_0013 · ✅ 운영 적용 2026-10-30)

`s2_0013_withdrawal_superadmin_block_and_director_notice.sql` — 원장 *"진짜 원장이 원장에 있어야함"* · *"수학(심화)는 없애 … 전부 수학이야"*. 작성 요청 함수 두 개가 super_admin을 승인자로 받지 않고, 원장 칸이 비고 승인자가 전부 원장이면 제출 알림이 '원장 승인 요청'이 된다. 처리(apply) 재검사는 그대로 — 운영 계정의 '바로 처리'가 멈추지 않게. `invoice_session_terms.subject` subject_1 → math 12행(전부 미확정 · 반은 이미 math · 이전 값은 파일 머리말 참고). 되돌리기 = `scripts/_oneoff/revert-s2_0013-withdrawal-superadmin-block.sql`.

## 2026-11-02 시간표 배치의 강의실 = 등록된 강의실만 (s2_0017 · ✅ 운영 적용 2026-11-02)

`s2_0017_class_schedules_room_canonical.sql` — 원장 *"영어 강의실이 자꾸 301 302 이렇게 되는데, 그런 강의실 없잖아 우린 다 본원이 붙는데"* · *"애초에 저런 강의실 입력할 수 있는곳을 찾아서 다 막아"*. `class_schedules`에 BEFORE INSERT/UPDATE OF(`slot_room_label`, `classroom_id`) 트리거 하나 — 연결이 있으면 라벨 = 그 강의실 이름 · 연결 없이 라벨만이면 등록 강의실(보관 제외)에 이름 그대로 또는 '건물+호수' 하나로 잇는다 · 못 맞추면 지금·앞으로 유효한 줄은 거절(끝난 줄은 통과 · LAB·JJ는 라벨을 비우고 통과 · 대소문자 무시) + `classrooms` AFTER UPDATE OF name 트리거(강의실 이름을 바꾸면 연결된 배치 라벨도). 기존 줄은 바꾸지 않는다(같은 날 명령줄로 침산 영어 555줄 연결 — `D:\tmp\room-link-2026-11-02\backup.json`). 시험 = 임시 표(강의실·배치 사본)에 같은 함수 본문으로 10사례 + 이름 바꾸기 동기화(되돌림) · 적용 전 전 지점 "연결 없음 + 맞는 강의실 없는 라벨 + 지금 유효" 0줄 확인. 되돌리기 = 파일 머리 주석의 drop 두 줄. ⚠️ 번호: AX 작업 가지의 `s2_0017_work_requests`·`s2_0018_dashboard_secretary_notes`(운영 적용됨 · main 미반영)와 겹친다 — 규칙(`docs/sql-season2.md` §D)대로 나중에 합치는 쪽이 번호를 민다. → ✅ 11-03 AX 가지를 main에 합치며 `s2_0018_work_requests`·`s2_0019_dashboard_secretary_notes`로 밀었다(이 파일 위쪽 '업무 요청'·'업무 비서' 항목).

## 2026-10-29 숙제 영상 업로드 실패 알림: 반 담임에게만 (s2_0012 · 적용 2026-10-29)

`s2_0012_homework_video_fail_notify_teacher_only.sql` — 원장 *"내 학생 내 반 이런거 있잖아. 나와 관련있는 알림만."* `record_homework_video_upload_event`의 수신자 조건 한 줄 — 할 일 담당과 같은 순서 — 반 담임 → 업로드 경로의 강사 → 둘 다 없을 때만 원장·관리자(종전: 담임 + 원장·관리자 전원). 운영 함수 본문에서 그 줄 1건 확인 뒤 치환. 되돌리기 = `scripts/_oneoff/revert-s2_0012-homework-video-fail-notify-teacher-only.sql`.

## 2026-10-29 환불 처리 할 일: 퇴원보고서 원장 환불 승인 → 데스크 담당자의 내 할 일 (s2_0011 · 적용 2026-10-29)

`s2_0011_refund_desk_task.sql` — 원장 *"데스크 담당자를 지정할 수 있게 하면 될듯. 그럼 알림이 자연스럽게 가겠지. 내 할일에 추가되서"*. ① `public.refund_desk_task_open`(service_role만) — 환불 요청서 하나 = 할 일 하나(kind `refund_process`) ② `academy_documents` 트리거 — 요청서에 환불완료일자가 처음 들어가면 처리됨, 지우면 취소. 앱은 SQL 전에도 돈다(할 일만 건너뜀 · 알림은 감). 되돌리기 = `scripts/_oneoff/revert-s2_0011-refund-desk-task.sql`.

## 2026-10-29 오늘수학 스냅샷: 만들 때 만료분 지우기 (s2_0010 · 적용 2026-10-29)

`s2_0010_tm_sync_prune_expired_snapshots.sql` — DB 메모리 부족 정지(10-29) 조사: `tm_sync_private.pages` 360MB(만료 스냅샷 312개가 지우는 곳 없이 쌓임). 손 정리(만료 1시간 지난 289개 삭제 + VACUUM FULL)로 29MB. 재발 방지로 `tm_sync_create_snapshot`의 insert 앞에 그 연결의 만료 1시간 지난 스냅샷 삭제 한 줄(페이지는 cascade · 대상 줄 1건 확인 뒤 치환). 함께 cron 주기를 1분 → 30분(vercel.json · 원장 "30분정도로 여유있게") — 즉시 wake는 그대로. 되돌리기 = `scripts/_oneoff/revert-s2_0010-tm-sync-prune-expired-snapshots.sql`.

## 2026-10-29 퇴원보고서 요청 취소: 원장도 (s2_0009 · ✅ 운영 적용 2026-10-29 · CLI — 두 함수 새 조건 있음·옛 조건 없음 확인)

`s2_0009_withdrawal_cancel_by_director.sql` — 원장 *"김덕현 기준으로 요청 취소가 왜 안되는지"*. 앱은 원장(master · 강사 화면 아님)에게 '요청 취소'를 주는데 DB 전이 함수 둘이 요청자 본인만 받아 거절했다. 두 함수의 취소 조건 한 줄만 '요청자 **또는** 그 지점 활성 master'로 치환(운영 함수 본문에서 그 줄이 정확히 1건인지 확인한 뒤 · 0369a 방식). 적용 전 확인: 두 함수 모두 대상 줄 1건. 되돌리기 = `scripts/_oneoff/revert-s2_0009-withdrawal-cancel-by-director.sql`.

## 2026-10-29 연동 PC가 '따로 낸 영상 숙제'를 읽기 (s2_0008 · ✅ 운영 적용 2026-10-29 · CLI)

`s2_0008_sync_agent_read_extra_video_homework.sql` — 원장 *"따로 낸 영상 숙제도 반 지정된 반으로 귀속"*. 반미정 영상의 반을 숙제로 정하는 워커 질의(`video-teacher-route.mjs` loadHomeworkClassIds)가 `video_homework_extra_issues`를 읽는다. 이 표는 서버 전용이라 `eywa_sync_agent`의 읽기 권한·정책이 없었다. 자기 지점 줄 읽기만 연다(s2_0006과 같은 모양 · 앱 사용자 권한 그대로). **AywaSync 1.0.9 게시 전에** 적용한다(1.0.8은 이 표를 읽지 않는다). 적용 확인: 연동 PC 역할 select만(insert·update 없음) · 정책 sync_agent_allow·sync_agent_tenant_boundary · authenticated는 그대로 막힘. 되돌리기 = `scripts/_oneoff/revert-s2_0008-sync-agent-read-extra-video-homework.sql`.

## 2026-10-29 월간 계획서 제목을 그 달만 고치기 (s2_0007 · ✅ 운영 적용 2026-10-29 · CLI)

`s2_0007_month_plan_title.sql` — 원장 *"수업명을 그냥 커스텀 수정할 수 있게"*(그 달만 · 비우면 수업명을 따른다). `class_month_plan_cells_kind_ck`에 `'title'`을 더한다(꼬리말 0240a와 같은 길 — 새 표 없음 · 라벨월 1일 행). 앱은 미적용이어도 읽기는 그대로(행이 없으니 수업명) · 저장만 거절. 적용 확인: 제약에 title · 기존 칸 927 그대로. 되돌리기 = `scripts/_oneoff/revert-s2_0007-month-plan-title.sql`(title 행을 지운 뒤 옛 CHECK).

## 2026-10-28 미룸·당김 표식 출처: 시간표 이동이 비운 회차는 원래 계획에도 반영 (s2_0005 · ✅ 운영 적용 2026-10-28)

`s2_0005_lesson_shift_origin.sql` — 원장 *"작업해"*(3차 적대 리뷰 4번: 반 블록 옮기기가 비는 회차에 쓴 칸 미룸 표식이 '원래 계획' 기준 화면 — 달력 판정 칩 · 비교 모달 · 현황 — 엔 반영되지 않아 그 회차가 '미작성', 뒤 칸이 책 끝까지 '1차수 늦음'으로 잡혔다). `class_lesson_shifts.origin text not null default 'manual'` + check(`manual` · `timetable_move`). 반 옮기기가 쓰는 표식만 `timetable_move` → `month-plan.ts`가 원래 계획에도 그 칸을 건너뛴다(kind는 그대로 skip — 일정·릴레이·토글 무변). 앱은 칸이 없어도 돈다(읽기·쓰기 모두 칸 없이 다시 시도) — 적용 순서 무관. 지난 데이터 채움 없음(반 옮기기 운영 저장 0건). 되돌리기 = `scripts/_oneoff/revert-s2_0005-lesson-shift-origin.sql`.

## 2026-10-28 영상 업로드 확인: 숙제 없이 올리다 멈춘 파일을 숙제를 골라 다시 올려도 처리 · 문구에 숙제 날짜 (s2_0004 · ✅ 운영 적용 2026-10-28)

`s2_0004_video_upload_check_any_retry.sql` — 원장 *"이거 체크했는데도 내 할 일이 안사라진다고 하는데 체크해봐"*(이준형 10/26 — 숙제 없이 올리다 멈춘 뒤 같은 영상을 10-22 숙제로 다시 올려 들어왔는데 할 일이 열린 채). · *"몇일자 숙제인지 더 명확하게 설명해줄것"*. ① `staff_tasks_private.video_upload_settle`의 숙제 없는 갈래(회차 `반|u:업로드`)가 그 뒤의 숙제 없는 업로드에 더해 **멈춘 시도와 같은 파일(크기 ±1%)을 숙제를 골라 다시 올린 업로드**도 센다 — 숙제를 고른 업로드를 모두 세면 숙제 뒤 추가 영상의 할 일이 다음 숙제 업로드에 닫혀서(리뷰). 숙제를 고른 시도의 판정은 그대로. ② 문구 함수 `video_upload_detail` — "10월 19일(월) 숙제 영상을 올리다 멈췄습니다" / "어느 숙제인지 고르지 않고 올린 영상(10월 26일 19:28)이 멈췄습니다", 이 종류 기존 할 일 10건의 문구도 다시 쓴다(detail만). ③ 영상이 진단 알림보다 먼저 들어와 할 일이 열자마자 닫히면 실패 알림이 읽지 않은 채 남던 것 — `tg_video_upload_task`가 이을 때 닫힌 할 일이면 읽음도 찍고, 남은 9개를 한 번 읽음으로(닫힘 트리거와 같은 규칙). 본문 = 운영 함수(= 0379a, 공백 정규화 md5 일치)에서 몇 줄. 끝에 열린 숙제 없는 할 일을 한 번 맞춘다(드라이런: 열린 1건 닫힘 · 처리된 1건 그대로) · staff_tasks_private 함수 권한 끝맺음. 앱과 순서 무관. 되돌리기 = `scripts/_oneoff/revert-s2_0004-video-upload-check-any-retry.sql`(닫힌 할 일은 다시 안 열림 · 바뀐 문구는 그대로).

## 2026-10-23 미배정 영상 할 일 = 붙일 빈 숙제가 있을 때만 · 끝난 할 일의 알림은 읽음 · 오래 안 읽은 알림은 보관함 (0447a · ✅ 운영 적용 2026-10-23 · CLI do 블록 — 함수 넷 본문 = 파일 · 옛 4인자 함수 없음 · 읽음 100 · 보관 4,996 · 되돌리는 거래 시험: 이어진 할 일 하나 닫음 = 안 읽음 그대로 · 모두 닫음 = 읽음)

`0447a_unassigned_video_fillable_and_notification_cleanup.sql` — 원장 *"숙제가 없는데도 미배정 영상이 남아있으면 그건 알림 오류"*(이영준 10/15 '숙제 없이 올린' 둘째 영상) · *"해결되지 않은 알림은 계속 남아있나?"* → *"고쳐"*. ① `staff_task_sync_unassigned_videos`에 `p_moot`(붙일 빈 숙제가 없는 미배정 영상 — 앱 `fillableCells`)를 더해 그 열린 할 일을 '취소'(`no_open_homework`)로 닫는다(옛 4인자 함수는 지운다 — 같은 이름 두 벌이면 PostgREST가 못 고른다 · 옛 앱의 4인자 호출은 기본값으로 돈다). ② `notify_unassigned_homework_videos` 묶음 건수에서 할 일이 이미 닫힌 영상을 뺀다(이번에 넘어온 영상은 센다). ③ 할 일이 열림 → 닫힘이 되면 그 할 일을 알린 알림을 읽음으로(트리거 — 연결된 다른 할 일이 열려 있으면 그대로). ④ `archive_stale_notifications(일수)` — 안 읽은 채 30일 넘은 알림을 보관함으로(열린 할 일이 붙은 알림은 그대로 · 매일 정리 cron이 부른다). ⑤ 한 번 맞춤(드라이런 10-23: 읽음 100 · 보관 4,995). 본문 1)·2)는 운영 함수 = 0379a·0411a 정의임을 확인하고 복사했다. **앱보다 먼저**(#95). 되돌리기는 파일 머리 주석.

## 2026-10-23 학생 온톨로지 읽기 확장 (0445a · 0446a — 운영 적용 · Supabase CLI)

`0445a_student_ontology_summaries.sql`은 요청자별 Claude 발췌 요약·지점별 일일 호출 횟수 표와 서버 전용 예약 함수를 추가한다. `0446a_student_ontology_current_scope.sql`은 현재 수강·담당 관계의 읽기 전용 집계 함수다. 기존 업무 자료 변경·백필은 없다. 파일별 트랜잭션과 권한 설정을 함께 적용한다. 미적용 시 학생 상세의 원본 연결은 계속 동작하고 AI 영역은 숨기며, 상위 현재 연결 보기는 준비 상태를 표시한다. 승인 대상 해시·검증·되돌리기는 [구현 기록](../../docs/features/student-ontology-expansion.md#적용-대상과-최종-통과-조건)에 있다. 되돌리기는 이전 앱으로 복귀하고 생성 경로를 닫는 방식이며 새 표의 자료는 보존한다.

원장 승인 후 CLI 2.121.0 `db query --db-url … --file …`로 두 파일만 적용했다. CLI의 단일 prepared statement 제약 때문에 파일의 바깥 BEGIN/COMMIT을 단일 DO 거래로 감쌌으며, DDL·SET LOCAL·권한 본문은 그대로다. 운영 함수 세 개의 본문 일치, RLS·ACL 16항목, 현재 집계 331명/93반/17강사/2과목 대사 통과. 한도·토큰·지점 가드는 되돌리는 시험 거래로 확인했다.

## 2026-10-23 활동 로그가 보기 설정을 안 남긴다 (0444a · ✅ 운영 적용 2026-10-23 · CLI — 운영 본문 = 파일 · 되돌리는 거래 시험: 보기 설정만 바꿈 0줄 · 메모 바꿈 1줄)

`0444a_activity_log_skip_ui_prefs.sql`은 `log_activity()`를 0306a 정의 그대로 다시 만들고 noise 배열 끝에 `'ui_prefs'`만 더한다(운영 함수 = 0306a 정의임을 주석·공백 빼고 비교해 확인). 보기 설정(정렬·필터·글씨·메뉴 방문 수)만 바뀐 `users` 수정은 줄을 안 남기고, 생성·삭제 사본에서도 그 칸을 뺀다. 실측(30일): 활동 로그 61,460행 · 45.8MB 중 4,561행 · 6.0MB(13%)가 이 줄이었다. 이미 쌓인 줄은 지우지 않는다(앱이 '화면 보기 설정'으로 읽는다). 앱 배포와 순서 무관 — 같은 날 앱이 학습 추세 미발송에 감사로그(`onescreen_trend_optout`)를 따로 남긴다. 되돌리기 = 0306a의 '1) 활동 로그' 정의를 다시 적용.

## 2026-10-22 시간표 칸 메모 (0395a · ✅ 운영 적용 2026-10-22 — 처음엔 0394a로 적었다가 퇴원보고서 0394a와 겹쳐 개명)

`0395a_timetable_cell_memos.sql`은 `timetable_cell_memos`(지점 × 과목 × 날짜 × 강사 열쇠 × 칸 시작 분 한 줄 · 본문 · 상자 크기 · version · 만든/고친 사람·시각, 일반 유니크 `timetable_cell_memos_cell_key`)를 만든다. 정책 0개 = 의도(서버 키만 — 화면 문은 앱 `memoSheetAccess`). 기존 표는 건드리지 않는다. 앱 배포와 순서 무관 — 표가 없으면 영어 강사뷰에 메모 표식·우클릭 메뉴가 안 뜨고 시간표는 그대로다(GET `/api/timetable/cell-memos`가 `unavailable`). 적용 뒤 확인: 표·유니크·RLS 켜짐·정책 0개 · 공개 키로 읽으면 42501. 되돌리기 = `scripts/_oneoff/revert-0395a-timetable-cell-memos.sql`(표째 지운다 — 메모가 사라진다).

## 2026-10-22 수업보고서 발송 이력 (0392a → 드라이런 → 0392b · ✅ 운영 적용 2026-10-22 · CLI)

`0392a_lesson_report_send_events.sql`은 발송 이력 표 `lesson_report_send_events`(추가만 · 정책 0개 = 서버 전용 · 앱 역할 권한 0 · service_role 읽기만)와 `lesson_reports` 트리거 셋(발송 상태·발송 시각이 바뀔 때와 대기 중 재요청 · 처음부터 발송 상태로 들어온 줄 · 발송 흔적이 있는 보고서 삭제)을 `create or replace trigger`로 단다(읽기를 막지 않는 잠금 · lock_timeout 5초). 이력 줄의 수정·삭제는 행 보호 트리거가 거절한다(지점째 지울 때의 외래키 연쇄만 통과). 기록이 실패해도 발송 상태 저장은 막지 않는다(사본 없이 한 줄 → 그것도 안 되면 DB 경고). 앱과 무관 — 앱은 이 표를 읽지도 쓰지도 않는다. 다시 돌려도 같다. 적용 뒤 `scripts/_oneoff/lesson-report-send-events-backfill-dry-run.sql`(읽기 전용) → `0392b_lesson_report_send_events_backfill.sql`(보고서 행에 남은 발송 · 2026-09-10부터의 발송 요청 감사로그 · 지움 기록만 남은 옛 발송, 멱등 — 빠진 기록을 메우려고 다시 돌려도 된다). 되돌리기 = `scripts/_oneoff/revert-0392a-lesson-report-send-events.sql`(기록만 멈춘다 · 표는 남긴다). 시험 = `supabase/tests/lesson_report_send_events.sql`. 적용 결과: 트리거 4 · 정책 0 · 공개 키 42501 · 백필 발송 17,701(사본 전부) · 요청 2,193 · 다시 돌린 드라이런 0줄.

## 2026-10-22 콜&상담 후속 조치 할 일 (✅ 운영 적용 2026-10-22 · CLI)

`0441a_enrollment_followup_tasks.sql`은 할 일 종류 `enrollment_followup`을 더한다 — 신규 콜&상담에서 '다음 상담'으로 잡은 날이 되면 상담자(재직 중이 아니면 원장 전원)에게 열고, 등록·미등록으로 정하면 처리됨 · 날짜를 옮기거나 지우면 취소 · 상담 삭제는 취소. 열기·닫기 = `enrollment_consultations` 트리거(상태·후속 조치일·상담자) + 30분 맞춤 `staff_tasks_sync`에 한 종류(0380a 본문 + 이 종류). 도입일(2026-10-22) 이후 날짜만. 앱보다 먼저든 나중이든 된다(앱은 새 칸을 읽지 않는다 — 적용 전엔 알림만 가고 할 일 연결이 빈다). 적용 뒤 확인: `select public.staff_tasks_sync('<지점>', array['enrollment_followup'])`가 오류 없이 `{opened, closed}`를 돌려준다 · 트리거 존재.

## 2026-10-22 보강 예약 결석난 반 (✅ 운영 적용 2026-10-22 · CLI)

`0440a_makeup_reservation_absence_class.sql`은 `makeup_reservations.absence_class_id`(→ classes, on delete cascade, 빈 값 허용)를 더한다 — 예약이 기록할 반을 고르면 `class_id` = 기록할 반, 이 칸 = 결석난 반(다를 때만). 빈 값 = 같은 반이라 기존 10행·지금 앱은 그대로다(**앱보다 먼저** — 예약 단건·이행 조회는 칸이 없어도 칸 없이 다시 읽는다 · 시간표 마스터 보호 연결 SQL은 이 칸을 읽는다). 적용 뒤 확인: 칸·외래키 존재 · 기존 행 값 없음.

## 2026-10-22 보강 예약 보고서 발송 방식 (✅ 운영 적용 2026-10-22 · CLI)

`0438a_makeup_reservation_report_mode.sql`은 `makeup_reservations.report_mode`(merge·separate·null, 제약 `makeup_reservations_report_mode_chk`)를 더한다 — 보강 예약 창이 '+ 보강 학생 추가'와 같은 합침/분리를 남긴다. 빈 값 허용 칸만 더해 기존 행·지금 앱은 그대로다(**앱보다 먼저** — 원스크린 조회는 칸이 없어도 칸 없이 다시 읽는다). 적용 뒤 확인: 칸·제약 존재 · 잘못된 값 23514(되돌리는 거래) · 기존 10행 값 없음.

## 2026-10-22 시간표 연습본 지점 공유 (✅ 운영 적용 2026-10-22)

`0439a_timetable_lab_shared_drafts.sql`은 시간표 편집기 이용 권한이 있는 같은 지점 계정에 기존·신규 저장본 읽기를 허용한다. 저장자는 계속 로그인 계정으로 고정되며, 다른 지점 접근·작성자 위조·기존 저장본 수정과 삭제는 허용하지 않는다. 저장자 이름은 기존 `created_by`의 사용자 정보에서 조회한다. `node --env-file=.env.local scripts/timetable-lab-db.mjs --test`로 공유 읽기·작성자 조회·지점 격리 등 34개 검증을 통과했다(시험 자료는 전부 롤백). `--apply`는 기존 표를 보존하고 공유 정책·조회 인덱스만 적용한다.

## 2026-10-20 업무 처리 확인 4~5단계 (0378a · 0379a · 0380a — 순서대로 · ✅ 운영 적용 2026-10-20 · CLI)

0378a = 공통 보강(종류별 맞춤 · `open_task` 바꿈 · 연결표) + 진도 이상 · 결석 확인. 0379a = 영상 업로드 확인 · 미배정 영상 · 미발송(보고서 트리거 넓힘). 0380a = 전자결재 차례 · 퇴원보고서 · 도움말 + 알림 연결 트리거. 셋 다 다시 돌려도 같다. **앱보다 먼저**(앱이 부르는 함수 `staff_task_open_absences` · `staff_task_sync_unassigned_videos` · `staff_task_sync_unsent`와 연결표 — 없으면 앱은 오류를 남기고 할 일 연결 없이 그대로 돈다). `staff_tasks_sync`는 인자가 둘로 바뀐다(`p_kinds` 기본 전부). 되돌리기 = 각 파일 머리 주석.

## 2026-10-20 업무 처리 확인 (0377a · ✅ 운영 적용 2026-10-20 · CLI)

`0377a_staff_tasks.sql`은 할 일 표 셋(정책 0개 = 서버 전용)·`notifications.task_id`·보고서/상담 트리거·`staff_tasks_sync`·`staff_task_counts`를 만들고 `notify_report_send_failed`를 같은 본문 + 할 일 연결로 바꾼다(할 일이 실패해도 알림은 나간다). 다시 돌려도 같다. **앱보다 먼저** — 벨은 `task_id`를 따로 읽어 칸이 없어도 목록은 뜬다. 되돌리기 = 트리거 둘·함수·표·칸 제거 + 알림 함수를 0306a 본문으로.

## 2026-10-19 원생 형제 짝 (0376a · ✅ 운영 적용 2026-10-19 · 트리거·권한 확인)

`0376a_student_siblings.sql`은 `student_siblings`(짝 한 줄 `student_a < student_b` · `linked` = 사람이 형제로 지정 true / 자동 판정을 끈 짝 false)를 만든다. 자동 판정(학부모 휴대폰 같음 · 학부모 이름 같고 연락처가 부딪히지 않음)은 앱이 볼 때마다 계산해 저장하지 않는다. 정책 0개 = 의도(서버 키만 — 문은 앱의 원생 열람·관리 권한). 같은 학원 원생끼리만(트리거). 기존 표는 건드리지 않는다. 앱 배포와 순서 무관 — 표가 없으면 학생 상세 프로필엔 자동 판정 형제만 보이고 학생 수정 화면의 형제 칸이 안 뜬다(저장도 형제를 건드리지 않는다).

## 2026-10-19 시간표 메모 시트 (0374a · ✅ 운영 적용 2026-10-19 · 침산 원본 넣음 version 1)

`0374a_timetable_memo_sheets.sql`은 `timetable_memo_sheets`(지점 × 과목 한 장 · 엑셀 판 내용 · version)를 만든다. 정책 0개 = 의도(서버 키만 — 화면 문은 앱 `memoSheetAccess`). 기존 표는 건드리지 않는다. 앱 배포와 순서 무관 — 표가 없으면 영어 통합뷰 오른쪽 시트 판에 "불러오지 못했습니다" 안내만 뜨고 시간표는 그대로다. 적용 뒤 침산 원본(구글 시트 '퇴원생 명단')은 `ENV_FILE=.env.local npx tsx scripts/_oneoff/seed-chimsan-memo-sheet.mts`(미리 보기) → `--apply`로 넣는다(이미 판이 있으면 `--force` 없이는 안 덮는다).

## 2026-10-17 오늘 수학 결과 만점 칸 (0372a · 운영 적용 완료)

`0372a_todays_math_result_max_score.sql`은 `todays_math_test_results.max_score`(시험지 만점 · nullable)를 더하고 반영 함수를 교체한다(0371a 본문 + 만점 · 범위 밖 만점은 null). 같은 날 운영 DB에 CLI로 적용 — 그 전에 운영 DB 트랜잭션 안에서 표본 반영 후 롤백으로 확인. 성적관리 월말평가 '채우기'가 만점이 같을 때만 쓰는 값이다.

## 2026-10-17 오늘 수학 채점 결과 보관 (0371a · 운영 적용 완료)

`0371a_todays_math_test_results.sql`은 `todays_math_test_results`(오늘 수학 시험 × 학생의 마지막 채점)·`todays_math_result_days`(날짜별 반영 지문) 표와 서버 전용 함수 `todays_math_apply_result_day`(그날 행을 한 거래로 갈아끼움)를 만든다. 정책 0개 = 의도(서버 키만). 2026-10-17 운영 DB에 CLI로 적용 — 그 전에 같은 SQL을 운영 DB 트랜잭션 안에서 실행·표본 반영(결시 점수 제거 · 없는 학생 건너뜀 · 날짜 불일치 거절 · 빈 날 비우기 · service_role 실행)·롤백으로 확인했다. 앱(`/api/cron/todays-math-results`)은 표가 없으면 "준비 전"으로 건너뛴다.

## 2026-10-16 자동작성 원문 보관 (0370a)

`0370a_ment_ai_drafts.sql`은 `ment_ai_drafts` 표(보고서당 한 줄 · 서버 전용 · 정책 0개 = 의도)를 만든다. 선생님이 자동작성 글을 고쳐 저장하면 원스크린 저장이 응답 뒤에 그 자동작성 원문을 남기고, 주간 말투 프로파일 빌드가 원문 ↔ 최종을 견줘 '늘 고치는 것'을 지침에 싣는다. 앱 배포와 순서 무관 — 표가 없으면 기록·조회 모두 조용히 건너뛴다. 소급 없음(적용한 날부터 쌓인다).

## 2026-10-15 퇴원보고서 처리 = 수강 줄에도 상세사유 메모 (0369a)

`0369a_withdrawal_report_end_memo.sql`은 퇴원보고서 전이 함수 두 개(`transition_withdrawal_report`·`_v1`)가 수강 줄을 닫는 한 줄에 `withdrawal_memo`(보고서 상세사유 글)를 더한다(본문은 그대로 · 그 줄 글자만 · 바꿀 줄이 정확히 하나가 아니면 중단 · 이미 바뀌었으면 건너뜀 · 소유자·권한·security invoker 그대로). 함께 수강 보호 트리거(`student_status_private.guard_enrollment`, 0427a)의 '날짜 수정' 갈래에서 세부·메모 거절에 `and not student_status_private.allowed()`를 붙인다 — 종료일이 잡힌 수강을 같은 사유로 다시 종료하며 메모를 바꾸면 원장도 막혔다(원생 상태 변경 권한이 있으면 통과 · 날짜만 고칠 수 있는 사람은 그대로 막힘). 앱 배포와 순서 무관. 빈 DB 순서 의존은 아래 0367a와 같다(타임스탬프 파일들을 다 깐 뒤 다시 돌린다).

## 2026-10-15 퇴원·수강 종료 사유 2단계 (0367a)

`0367a_withdrawal_reason_details.sql`은 `enrollments.withdrawal_detail`·`withdrawal_memo` 두 칸(nullable · 기본값 없음)을 더하고, 퇴원보고서 전이 함수 두 개(`transition_withdrawal_report`·`_v1`)의 사유 목록에 새 대분류 다섯을 더한다(본문은 그대로 · 목록 글자만 · 이미 바뀌었으면 건너뛰고, 바꿀 목록이 없으면 중단). **앱보다 먼저** 적용한다 — 부분 종료 저장과 수강 종료 되돌리기가 새 칸을 쓴다. 적용 뒤 앱 배포 → `node --env-file=.env.local scripts/_oneoff/withdrawal-reason-details-backfill.mjs`(미리 보기) → `--apply`.

⚠️ 빈 DB에 파일 이름 순서로 처음부터 깔면(`pnpm db:alphas`) 이 파일이 퇴원보고서 함수를 만드는 `0415a`보다 먼저 돌아 함수를 못 찾고 통째로 멈춘다(칸도 안 생긴다 — `0366a`도 같은 순서 의존). 빈 DB에서는 타임스탬프 파일들을 다 깐 뒤 이 파일을 다시 돌린다. 이미 운영 중인 DB에 손으로 적용하는 데는 상관없다. (2026-10-27 시즌2: `pnpm db:alphas`가 첫 바퀴에서 실패한 구역을 끝에서 한 번 더 돌려 이 순서 의존을 스스로 맞춘다 — 빈 DB 확인 때문에 두 번째 실행은 멈춘다.)

## 2026-10-13 실험실 퇴원보고서

`0415a_withdrawal_reports.sql`은 보고서·처리 이력·서비스 전용 상태 전이 RPC·실험실 메뉴 배치를 추가한다. 기존 원생·수강 표를 변경하지 않는다. `0416a_withdrawal_report_reasons.sql`은 병행 추가된 질병·권고퇴원 사유를 반영한다. `0417a_withdrawal_report_request_recovery.sql`은 요청자와 지정 원장이 퇴직해 고착된 요청을 현재 원장이 취소할 수 있게 한다. 지정자만 순서대로 승인하는 규칙은 유지한다.

대상 프로젝트를 확인하는 `node --env-file=.env.local scripts/withdrawal-reports-db.mjs --apply` → `--upgrade` → `--test`로 이 기능만 적용·검증한다. 테스트의 가상 지점·학생·수강·알림은 전부 롤백된다. 앱은 적용 전에도 기존 퇴원관리·예약 작업을 유지한다. 일반 브라우저 역할에는 새 표의 읽기·쓰기와 RPC 실행을 부여하지 않는다. 보고서 승인 뒤 실제 퇴원일이 된 예약은 기존 `apply-due-withdrawals` 작업이 처리한다.

## 2026-10-04 오늘의수학 v2 원본 SQL (운영 적용 완료)

`0337a_todays_math_sync_v2.sql`은 원본 제어·권한 세대·트랜잭션 outbox·동결 스냅샷·일회 SSO 코드와 서비스 역할 전용 RPC를 추가한다. Supabase CLI 2.81.3이 만든 `20261003083350_todays_math_sync_v2.sql`을 아래 alpha 규칙의 다음 번호로 옮겼다. 기존 업무 컬럼은 변경하지 않으며 최초 binding은 shadow, 구성 RPC는 기본 미리보기이다. 실제 PostgreSQL 17 격리 검증 및 운영 적용을 완료했다. 인터페이스·적용 전 조건·검증은 [원본 SQL 보고서](../../docs/todays-math-sync-source-sql-report.md), 현재 상태는 [운영 적용 기록](../../docs/todays-math-sync-production-2026-10-03.md)을 참조한다.

`0339a_todays_math_student_phone_tail.sql`은 학생 연락처 끝 4자리·연락처 변경 알림과 정확한 함수 지문 12개 검사를 추가한다. CLI 생성 이름 `20261004060214_todays_math_student_phone_tail.sql`로 2026-10-04 운영 적용한 뒤 기존 alpha 번호 규칙으로 이름만 옮겼다. 파일명 변경 때문에 운영 SQL을 다시 실행할 필요는 없다.

연락처 변경이 적용된 운영 DB에 `0337a`를 단독 재실행하거나 `pnpm db:alphas`로 전 파일을 다시 적용하지 않는다. `0337a`가 이전의 함수 개수·export·학생 트리거를 복원하면 후속 파일 실행 전 건강 검사가 실패하고 접근 중단 및 기록 공백 판정이 발생할 수 있다. 신규 빈 DB의 전체 설치와 이미 운영 중인 DB의 대상 migration 적용을 구분한다. `0337a`만 다시 실행하는 것은 롤백이 아니다.

## 2026-10-04 숙제영상 지점별 Google 계정

새 계정 연결 코드의 배포를 확인한 뒤, `0338a_homework_video_drive_tenant_config.sql`과 `0340a_homework_video_drive_accounts.sql` → `0341a_homework_video_drive_account_credentials.sql` → `0342a_homework_video_drive_account_routes.sql`을 **한 트랜잭션으로** 적용한다. 파일 안의 `begin`·`commit`을 바깥 트랜잭션으로 합치고 마지막에 PostgREST 스키마를 갱신한다. `0338a`만 따로 적용하거나 후속 정의가 있는 환경에 단독 재실행하지 않는다. 이미 `0338a`가 적용된 환경은 새 세 파일을 한 트랜잭션으로 적용한다. 지점 계정의 저장 폴더를 켜기 전에 발송 PC에 새 워커 전체 ZIP을 적용하고 온라인 상태를 확인한다. 오늘의수학 `0339a`는 이 묶음과 별개다.

기존 영상과 Drive 파일은 옮기지 않는다. 기존 루트는 연결 번호 없이 유지하고, 새 루트는 지점과 Google 연결 번호를 함께 고정한다. 계정을 바꾸거나 연결을 해제해도 이미 시작한 작업의 이전 계정 자격은 유지한다. 갱신 토큰은 Vault, 웹 클라이언트 비밀은 Vercel 환경변수에만 둔다. 계정 표와 RPC는 서비스 역할만 접근하며 일반 API 역할에는 노출하지 않는다.

`scripts/check-homework-video-drive-accounts.cjs`는 대상 DB에서 이 묶음의 재실행, 권한, 연결 버전, 다른 지점 접근 거부, 이전 업로드 완료 및 실제 워커 SQL의 작업 임대 보호를 검증한 뒤 전부 되돌린다. 실제 Google 로그인과 영상 이동은 하지 않는다. 운영 적용은 코드 배포 확인 뒤에 수행하며, 각 지점의 Google 로그인은 연동 화면에서 별도로 마친다.

## 2026-10-14 수학 내신 → 중간·기말 (0363a)

`0363a_student_grades_math_no_school.sql`은 수학 성적의 '내신' 칸 저장을 막는 제약이다. **단독으로 돌리지 않는다** — 수학 내신 행이 남아 있으면 실패한다. 새 앱 배포를 확인한 뒤 `node --env-file=.env.local scripts/_oneoff/math-school-to-midterm.mjs`(미리 돌려 보기) → `--apply`가 한 트랜잭션에서 내신 → 2026년 2학기 중간고사 이관 · 감사로그 · 이 제약을 함께 적용한다. 0289a를 되돌리는 쪽이다. ✅ 2026-10-14 운영 적용(49건 이관 · 제약 확인).

## 2026-09-23 수학 내신 통합

`0289a_math_school_grade_alias.sql`은 공유 DB에 적용했다. 기존 수학 `midterm` 1건이 `school`로 이동했고, 충돌 0건·점수/만점/시험일 변경 0건을 확인했다.

> 📌 아래 1~3절은 **시즌1(낱개 시절) 기록**이다 — 2026-10-27부터는 맨 위 '시즌2' 절을 따른다(낱개·`meta/_journal.json`은 합본으로 들어가며 지웠다).

이 폴더의 SQL은 **두 갈래**다. 한쪽은 자동, 한쪽은 **손수 적용**이므로 신규 DB 셋업 시 누락 주의.

## 1. 두 갈래

| 종류 | 파일 | 적용 | 추적 |
|---|---|---|---|
| **drizzle 번호본** | `000N_*.sql` (예: `0024_slimy_zombie.sql`) | `pnpm db:migrate`가 **자동** | `meta/_journal.json` |
| **alpha(손수)** | `000Na_*.sql` · `000Nb_*.sql` (예: `0001a_…`, `0024a_search_trgm`) | **수동** raw SQL 실행 | 추적 없음 |

**왜 alpha가 따로 있나**: drizzle은 테이블/컬럼/FK/enum/인덱스(btree)까지만 생성한다. **RLS 정책·트리거·
SECURITY DEFINER 함수·확장(extension)·GiST EXCLUDE·generated 컬럼·GIN trigram 인덱스·Storage RLS**는
drizzle이 표현 못 하므로 손으로 작성해 `000Na_*` 파일로 둔다. `pnpm db:migrate`는 **번호본만** 적용하고
alpha는 건드리지 않는다 → alpha는 사람이 직접 돌려야 한다.

> ⚠️ `db:push`(`drizzle-kit push`)는 alpha의 객체(RLS/트리거 등)를 모르고 drift로 **삭제 제안**할 수 있다. 쓰지 말 것. 항상 `db:generate` → `db:migrate` + alpha 수동.

## 2. 멱등성 — 재실행 안전

alpha 파일은 멱등 구문으로 작성: `create extension if not exists`, `create or replace function`,
`create index if not exists`, `drop policy if exists … create policy`, `drop trigger if exists … create trigger`.
→ 같은 파일의 재실행은 지원하되, 이전 버전 파일이 후속 정의를 덮어쓸 수 있으므로 전체 재적용을 무조건 안전하다고 판단하지 않는다. 특히 위의 `0337a`/`0339a` 운영 적용 규칙을 따른다.

## 2-1. 🔴 번호는 **겹치면 안 된다** — 같은 번호를 두 작업이 쓰면 "이거 돌렸나"를 아무도 못 센다

🔴 **시즌2(2026-10-27~)**: 새 파일 = `s2_NNNN_설명.sql`, NNNN = **지금 시즌2 최대 번호 + 1**(`ls supabase/migrations | grep '^s2_' | tail -3`) — 빈틈·겹침은 가드가 막는다.
(시즌1 옛 규칙) 새 alpha 파일의 번호 = **지금 폴더의 최대 번호 + 1**(`ls supabase/migrations | sort | tail -3`으로 확인하고 짓는다).
접미사 `a`·`b`·`c`는 **같은 작업의 연속 단계**를 뜻한다(예: `0271a` 칸 추가 → `0271b` 그 칸 후속). 다른 작업에 붙이지 말 것.

⚠️ 세션 여럿이 같은 날 병렬로 만들면 같은 번호를 각자 고른다 — **머지 전에 `ls`로 겹치는지 한 번 본다.**

### 2026-09-18 정리 — 겹친 번호 둘(`0270a`·`0271a`)에 걸린 파일 셋을 옮겼다(내용·적용 상태 불변, **파일 이름만**)

| 옛 이름 | 새 이름 | 당시 DB |
|---|---|---|
| `0270a_math_learning_goals.sql` | **`0269b_math_learning_goals.sql`** | 적용됨 |
| `0271a_math_learning_track_goals.sql` | **`0269c_math_learning_track_goals.sql`** | 적용됨 |
| `0271a_leave_adjustment_used_range.sql` | **`0270b_leave_adjustment_used_range.sql`** | **미적용**(이 이름으로 돌리면 된다) |

`0270a`(연차 사용일)·`0271a`/`0271b`(LAB \*LAB 표식)·`0272a`·`0273a`(수학 진도 후속)는 **이름 그대로**다.
🔑 math 두 개를 `0269b`·`0269c`로 **앞으로** 옮긴 것은 순서 때문이다 — `0272a`·`0273a`가 그 표를 고치므로 뒤로 밀면 순서가 뒤집힌다.
이미 적용한 DB는 **다시 돌릴 필요가 없다**(이름만 바뀌었다).

### 옛 겹침 24개는 **일부러 그대로 둔다**(2026-09-18 확인)

`0081a`~`0088a`(8) · `0111a` · `0113a` · `0116a` · `0117a`(파일 3개) · `0118a` · `0134a` · `0147a`~`0149a`(3) · `0152a` ·
`0209a` · `0210a` · `0212a` · `0224a` · `0227a` · `0266a` — 번호 하나에 파일이 둘(또는 셋)씩 있다.
전부 DB에 적용된 것들이고(가장 최근 `0266a` 둘도 확인), 이 번호들은 CLAUDE.md·docs·코드 주석에 **번호로** 530번 넘게 인용돼 있어 이름을 옮기면 그 인용이 전부 틀린 곳을 가리킨다.

- `pnpm db:alphas`는 파일 이름을 기록하지 않고 **사전순으로 전부 다시 돌린다**(멱등) — 겹친 번호 안에서는 이름 뒷부분 사전순으로 돈다.
- 이 번호들을 글로 가리킬 땐 **파일 이름까지** 적는다(`0209a`만 쓰면 자리 담당인지 ECS 복사인지 모른다).
- 🔴 **새 겹침을 만들지 말 것** — 위 2-1 규칙(최대 번호 + 1)을 지키면 이 목록은 더 늘지 않는다.

## 3. 신규/빈 DB 셋업 순서

```bash
# 1) 시즌1 합본 구역(drizzle 0000~0027 → alpha 0001a~0458a) → 시즌2 파일 — 한 방. 🔴 빈 DB에서만 돈다(public.tenants가 있으면 멈춘다)
pnpm db:alphas
#    (pnpm db:migrate는 2026-10-27부터 안내만 하고 멈춘다 — 운영 DB에 시즌1 전체가 다시 도는 사고를 막으려고)
#    (대안) 개별 파일만: Supabase 대시보드 → SQL Editor에 파일 내용 붙여넣기.

# 3) system_role enum에 'student' 추가 — 아래 ⚠️ 참고
#    ALTER TYPE system_role ADD VALUE IF NOT EXISTS 'student';
```

- ⚠️ **데모 시드(`pnpm db:seed`·`scripts/seed.ts`)는 2026-09-19 영구 제거됐다** — 테넌트 데이터를 먼저 지우는 구조인데
  데모 테넌트가 운영 테넌트 `injaewon`으로 승격돼(2026-07-01) 운영 DB를 지울 수 있었다. 되살리지 말 것.
- ⚠️ `system_role`의 `'student'` 값은 **SQL 마이그레이션에 없다**(`0000`의 enum은 7개, drizzle 스냅샷에만 있다) —
  그동안 옛 `seed.ts`가 `ADD VALUE IF NOT EXISTS`로 넣어 왔다. 운영 DB엔 이미 있고, **빈 DB를 새로 만들 때만** 위 3)을 한 번 실행한다.

## 4. 현재 공유 DB 적용 상태 (검증: 2026-06-25, +makeedu 0057a·0058a·종강 0059a 적용 2026-06-29)

공유 Supabase(데모 테넌트)에는 **번호본 0000~0027 + alpha `0001a`~`0060a` 전부 적용 완료**. `pnpm db:alphas`로
전 alpha를 멱등 일괄 적용·재실행 수렴 확인(`0019a`는 dropped `scenarios` 가드로 no-op). `0057a`(makeedu 외부키 5컬럼+부분유니크)·
`0058a`(`makeedu_sync_state`+RLS)·`0059a`(`classes.closed_at` 종강일)는 2026-06-29 dev 적용. `0060a`(`notice_popups`+RLS, 공지 팝업)는
2026-06-30 dev 적용. 직접 조회로도 확인:

- `pg_trgm` 확장 **설치됨**, `0024a`의 trigram GIN 인덱스 **11개 전부 존재**
  (students 5 · classes 2 · student_consultations 1 · enrollment_consultations 3).
- `reenrollment_campaign_targets` 테이블 + RLS **활성**(`0024`/`0024b`).
- **`0025` `textbook_orders`·`expenses` 테이블 + `0025a` RLS 활성**(수납관리 책갈피 교재/지출 면).
  `relrowsecurity=true` 확인, 데모 데이터 적재(교재 350·지출 95, `scripts/_poc_migration/import-textbooks-expenses.cjs`).
- **ijw 갭 P2 신규 테이블 적용·RLS 격리**(2026-06-18): `exams`(`0028a`) · `textbook_catalog`(`0030a`, 카탈로그 146종 이식) ·
  `audit_logs`(`0031a`) · `level_tests`(`0032a`) + 카카오 메시징(`0029a`) + P1 컬럼들(`0027b~f`). DB smoke 통과.
- **학원 설정·계산기·권한 + 집계 RPC 적용**(검증 2026-06-20, 객체 직접 조회): `tenant_settings`(`0033a`) ·
  `tuition_catalog`(`0034a`) · `tuition_quotes`(`0037a`) 테이블 존재 + `tenant_settings` master 전용 쓰기 트리거
  `tg_guard_tenant_settings_master_only`(`0038a`) 존재. **집계 RPC 4종 존재**: `dashboard_top_outstanding`·
  `dashboard_absence_risk`(`0039a` 대시보드) · `consultation_category_counts`·`consultation_monthly_trend`(`0040a` 상담통계).
  전부 `security invoker` + `auth_tenant_id()` 필터(RLS 이중격리). 테넌트 테이블 RLS-off=0개 재확인.
- ⚠️ **drizzle 스냅샷은 `0027_big_swordsman`에 멈춤** — `0027b` 이후 전부 손수 alpha. `db:generate` 금지(드리프트 #P0-6),
  스냅샷 정식 재산출은 별도 reconciliation 과제.
- public 스키마의 테넌트 테이블 중 **RLS 미적용 = 0개** → alpha RLS 누락 없음.

> 검증 쿼리(읽기 전용): `select extname from pg_extension where extname='pg_trgm';` /
> `select indexname from pg_indexes where indexname like 'ix_trgm_%';` /
> `select relname from pg_class where relkind='r' and relrowsecurity=false and relnamespace='public'::regnamespace;`

## 5. alpha 파일 목록 (번호 순 = 적용 순)

| 파일 | 내용 |
|---|---|
| `0001a_rls_constraints_triggers` | 확장(uuid-ossp·btree_gist) · `auth_tenant_id()` · `updated_at` 트리거 · students name_normalized generated · enrollments daterange GiST EXCLUDE · auth→public.users 동기 · **모든 테넌트 테이블 RLS + tenant_isolation** |
| `0001b_rls_for_schedules` | schedules RLS |
| `0002a_rls_for_consultations` | 상담 RLS |
| `0003a_rls_for_consultations_meetings` | 상담/회의 RLS |
| `0004a_rls_for_invoices` | 청구 RLS |
| `0007a_storage_rls_for_meeting_recordings` | 회의록 녹음 Storage RLS |
| `0009a_storage_rls_for_consultation_recordings` | 상담 녹음 Storage RLS |
| `0015a_rls_for_student_grades_memos` | 성적/메모 RLS |
| `0017a_rls_for_payroll_leaves` | 급여/휴가 RLS |
| `0018a_rls_for_integrations` | 연동 RLS |
| `0019a_rls_for_scenarios` | 시나리오 RLS |
| `0021a_super_admins_rls` | super_admins RLS |
| `0022a_super_admin_audit_rls` | super-admin 감사 RLS |
| `0023a_rls_for_tenant_licenses` | 테넌트 라이선스 RLS |
| `0024a_search_trgm` | **pg_trgm + GIN trigram 인덱스 11개**(커맨드 팰릿 데이터 검색 #18) |
| `0024b_rls_for_reenrollment` | `reenrollment_campaign_targets` RLS + updated_at 트리거(재등록 캠페인 #6) |
| `0025a_rls_for_textbook_orders_expenses` | `textbook_orders`·`expenses` RLS(수납관리 책갈피 교재/지출 면) |
| `0026a_users_privilege_guard` | `users.system_role`/`tenant_id` 직접 변경 차단 트리거(self-escalation 방어 #S2 — service_role admin 경로는 통과) |
| `0027a_kiosk_attendance` | 키오스크 출결 테이블 + RLS(병렬 kiosk 세션) |
| `0027b_student_memo_pin` | 학생 메모 `pinned`·`updated_at` 컬럼(P0-6 메모 수정·고정) |
| `0027c_kiosk_device_info` | 키오스크 디바이스 정보(병렬 kiosk 세션) |
| `0027d_staff_phone` | 직원 전화번호 컬럼(P1) |
| `0027e_attendance_early_leave` | 출석 `early_leave` enum 값(P1 조퇴) |
| `0027f_student_profile` | 학생 프로필 확장(english_name·gender·birth_date·address·email, P1) |
| `0027g_rls_for_timetable_port` | 시간표 포트 RLS(병렬 timetable 세션) |
| `0027h_move_enrollments_batch` | enrollments 일괄 이동(병렬 timetable 세션) |
| `0028a_exams` | **`exams` 테이블 + RLS + `student_grades.exam_id` 부분유니크**(P2-1 시험 모듈) |
| `0029a_kakao_messaging` | 카카오 알림톡 메시징 스키마 + RLS(PR#1, 0027d 충돌로 0029a로 이동) |
| `0030a_textbook_catalog` | **`textbook_catalog` 단가표 테이블 + RLS**(P2-5, ijw 146종 이식) |
| `0031a_audit_logs` | **`audit_logs` 운영 감사로그 + RLS 격리 + index**(P2-6, 테넌트 스코프) |
| `0032a_level_tests` | **`level_tests` 레벨테스트 + RLS**(P2-7, subscores jsonb) |
| `0033a_tenant_settings` | `tenant_settings` 학원 설정 jsonb + RLS(역할/권한 Phase 4) |
| `0034a_tuition_catalog` | **`tuition_catalog` 수강료 단가표 + RLS**(과목 단가/기타/할인 통합, 수강료 계산기 설정 이식, ijw 43과목+기타4+할인3 이식) |
| `0037a_tuition_quotes` | **`tuition_quotes` 수강료 견적(신입생 상담) + RLS**(계산기 "청구서로 저장"=재원생 invoices 아닌 견적, courses·extras·discounts jsonb) |
| `0038a_tenant_settings_master_guard` | **`tenant_settings` 쓰기 master 전용 트리거**(권한 override self-escalation DB레벨 차단 — 0026a 패턴. service_role/직접연결 통과) |
| `0039a_dashboard_agg_rpc` | **대시보드 집계 RPC 2종**(`dashboard_top_outstanding`·`dashboard_absence_risk`) — 미수상위·결석위험을 전건 fetch+JS 집계 대신 DB group-by로. `security invoker`+`auth_tenant_id()` 이중격리(반응속도 최적화, #54) |
| `0040a_consultation_stats_rpc` | **상담통계 집계 RPC 2종**(`consultation_category_counts`·`consultation_monthly_trend`) — `/consultations/stats` 카테고리·월별추세를 DB group-by로(student_consultations 1340행이 ~1000행 silent 절단되던 #54 해소). `security invoker`+`auth_tenant_id()` 이중격리 |
| `0041a_class_schedule_slot_labels` | **`class_schedules.slot_teacher_label`·`slot_room_label`**(셀 단위 강사/강의실 표시 라벨) — 영어 통합뷰 미니그리드가 (요일,교시)마다 다른 강사·"LAB"·"LAB실"을 그리도록. 영문닉네임은 users FK로 못 풀어 문자열 보존. ijw `slotTeachers`/`slotRooms` 백필(`scripts/_poc_migration/backfill-english-slots.cjs`) |
| `0043a`~`0047a` | (표 미세분 — CLAUDE.md 진행상황 참조) 성적 목표/코멘트(`0043a`) · 강사 인수인계(`0044a`) · 학생상담 오디오/AI(`0045a`) · 등록상담 전체폼 컬럼+`subject_details`(`0046a`) · `intake_tokens` 학부모 QR 공개접수(`0047a`) |
| `0048a_intake_rate_limit` | **`intake_attempts`(ip_hash·ok·시각, RLS) — 공개접수 시도 기반 다층 레이트리밋 단일소스**(per-IP/per-tenant/per-token 슬라이딩 1h + time-trap + env-gated Turnstile 백스톱). 원본 IP 미저장(sha256 해시). 봇/스팸 하드닝 |
| `0049a_lesson_reports` | **`lesson_reports`(student_id·report_date·progress·exam_info·homework_score·teacher_name, RLS) — 수업 진도/보고서**. ijw 시간표 학생 hover의 "[진도]" 줄. ijw Edutrix Supabase reports를 학생 이름 매칭으로 이식(`scripts/_poc_migration/import-lesson-reports.cjs`). |
| `0050a_meeting_speaker_staff` | **`meeting_minutes.speaker_staff`(jsonb) — 회의 화자(A/B)↔직원(users) 연결**. 화자 편집기가 직원 드롭다운으로 매핑(`ai_speaker_roles` 표시라벨과 분리 저장). 업무연계 기반. |
| `0051a_textbook_status_audit` | **`textbook_orders.registered_at`·`status_by_name`·`status_at` — 교재 3체크(등록/주문/납부) 타임스탬프 + 마지막 변경자**(ijw식 독립 체크). |
| `0052a_meeting_report_edit` | **`meeting_minutes.ai_report_edited_by`·`ai_report_edited_at` — 회의 AI 보고서 섹션 인라인 수정자·시각**(인쇄/공유 전 staff 교정). |
| `0053a_consultation_report_edit` | **`consultation_ai_analysis.report_edited_by`·`report_edited_at` — 등록상담 AI 분석 인라인 수정자·시각**(동결 print_payload.audioReport를 명시 교정 허용). |
| `0054a_user_colors` | **`users.bg_color`·`text_color` — 강사 퍼스널 색**(ijw `staff.bgColor/textColor` 패리티). 시간표 익스포터(엑셀/시트) + 통합뷰 셀·담임 강사색 소비. |
| `0055a_users_english_name` | **`users.english_name` — 강사 영문닉네임**(ijw `staff.englishName`). 영어 시간표 슬롯 라벨이 영문닉네임이라 한글 `display_name`로 매칭 불가 → 통합뷰 셀에서 라벨→강사색 해결용. |
| `0056a_move_enrollments_effective_date` | **`move_enrollments_batch`에 `p_effective_date` 추가**(옛 1-인자판 drop). 시간표 주간 이동 Phase B — 미래 주에서 드래그 시 그 주에 반이동 예약(옛 enrollment end_date=적용일 / 새 enrollment start_date=적용일). SECURITY INVOKER·per-move 서브트랜잭션은 0027h 동일. |
| `0057a_makeedu_sync` | **makeedu 동기화 외부키 5컬럼**(`students.makeedu_id`·`classes.makeedu_lesson_id`·`enrollment_consultations.makeedu_id`·`student_consultations.makeedu_id`·`textbook_catalog.makeedu_id`, 전부 nullable) + 부분 유니크 `(tenant_id, col) WHERE col IS NOT NULL` 5개. makeedu 고유No↔eywa 행 매칭키. invoices=자연키(tenant,student,period)·enrollments=자연키(student,class) 재사용이라 컬럼 없음. ⚠️ `students.makeedu_id`는 ijw `student_code`와 분리. |
| `0058a_makeedu_sync_state` | **`makeedu_sync_state`(tenant_id·domain → synced_at·row_count·status·error, PK(tenant,domain)) + RLS select(`tenant_id=auth_tenant_id()`)** — 도메인별 마지막 동기화 시각 단일소스. 임포터가 성공 시 `recordSync`로 기록 → `MakeeduSyncBadge`("동기화 N분 전")가 화면 헤더에 표시. |
| `0059a_class_closed_at` | **`classes.closed_at` date(nullable)** — 종강(운영 종료일). 폐지(`is_active=false`, 전체 숨김)와 별개로, 종강 반은 `is_active=true`를 유지하고 타임머신에서 `closed_at` 이전 주엔 표시(수강이력)·이후 주·현재엔 숨김. 시간표 쿼리(`fetchSlots`/`getTodaySchedule`/엑셀)가 `closed_at` + `valid_from≤주끝` 필터. |
| `0077a_absorb_subject_rpc` | **`absorb_subject_key(p_from, p_to)` RPC** — 과목 흡수(운영 과목 삭제) 시 `users.subjects[]` 치환·순서보존 dedupe + 과목 키 jsonb 2곳(`enrollment_consultations.subject_details`·`onescreen_daily_sessions.subject_progress`) 개명(양쪽 객체면 to-우선 얕은 병합)을 DB에서 원자 실행. `security invoker`+`auth_tenant_id()` 이중격리(0039a/0040a 패턴). 클라 read-then-overwrite 루프의 동시저장 유실·행당 왕복 타임아웃 제거. 의미 정의=`src/features/owner/subject-absorb.ts`(Vitest). |
| `0060a_notice_popups` | **`notice_popups` 공지 팝업 테이블 + RLS 격리 + index** — 셸 진입 시 창처럼 뜨는 배너형 공지("팝업광고" 패턴). title·body·image_url·link_url/label·audience(announcement_audience 재사용)·width·position·priority·is_active·starts_at/ends_at·author_id. announcements(대시보드 카드)와 별개. 표시 dismiss("7일/다시 보지 않기")는 DB 아닌 브라우저 localStorage(기기 단위). 표시 조회=`getActivePopups`(tenantId별 unstable_cache), 작성=owner "팝업 공지" 면. |
| `0081a_lesson_reports_share_token` | **`lesson_reports.share_token` uuid(not null default gen_random_uuid) + 전역 유니크 인덱스** — 학부모 공개 보고서 링크(`/r/[token]`) 기반(Edutrix 발송 시스템 이식 P0). 공개 페이지가 service_role로 token→단건 조회(RLS 우회, 전역 유니크 토큰이 테넌트 해석 = (intake) 패턴). 기존 행 default 백필. 강사 원스크린 "카톡용/문자용 저장"이 이 링크 생성. |
| `0082a_lesson_reports_report_fields` | **`lesson_reports.daily_test`·`check_test`·`attitude`(nullable text)** — 학부모 보고서에서 일일테스트/확인테스트/수업태도를 분리 표시(기존 `exam_info` 합본 → 3단계). nullable 추가라 락 없음. 기존 행 null → `/r`가 `exam_info` 폴백. |
| `0083a_lesson_reports_classnote` | **`lesson_reports` ClassNote 발송 큐 + 과목별 dedup**(Edutrix 발송 이식 P3): `subject`(과목별 1행) + 전체 유니크 `(tenant,student,report_date,subject)`(nulls distinct라 레거시 null 자동 제외 · Supabase upsert 타겟 가능) + 상태머신 `classnote_status`(NULL=미요청/queued/processing/success/failed/too_old)·`classnote_error`·`classnote_queued_at`·`classnote_processing_at`·`classnote_sent_at`·`classnote_retry_count`(NOT NULL DEFAULT 0=상수라 락 없음) + queued 폴링용 부분 인덱스 `(tenant,classnote_queued_at,id) WHERE status='queued'`. 로컬 워커가 폴링→스크린샷→Firebase 함수 게시. too_old 가드는 앱단. |
| `0084a_classnote_workers` | **`classnote_workers`(tenant_id·hostname·started_at·last_seen, PK(tenant,hostname)) + RLS select** — ClassNote 발송 데몬(`watch-classnote-queue.mjs`) 심장박동. 상주 데몬이 매 폴(15초) 자기 hostname·last_seen upsert → 웹에서 "발송 PC 온라인/오프라인" 표시(P3 Stage 4 상주화). `0073a_makeedu_sync_workers` 구조 복제하되 별도 테이블(한 PC 두 워커 동시 상주 시 hostname PK 충돌 방지). write는 직접연결(DATABASE_URL)·service_role만. |
| `0085a_lesson_reports_share_revoke` | **`lesson_reports.revoked_at`·`revoked_by`**(nullable) — 학부모 공개 보고서 링크(`/r/[token]`) 취소(revoke, 열람 차단) 메타(P2a). nullable 추가라 rewrite 없음(짧은 메타락). 만료(보고서일+90일)는 `report_date` 파생이라 컬럼 없음(`src/features/onescreen/share-expiry.ts`). `/r`가 `revoked_at` 있으면 취소화면. |
| `0086a_share_link_views` | **`share_link_views`(tenant_id·lesson_report_id·ip_hash·user_agent·viewed_at, PK id) + RLS select** — 학부모 공개 보고서 조회 로그(P2a). 공개 `/r` 페이지가 열람 시 service_role(admin)로 1행 insert(RLS bypass — write 정책 없음, 0058a/0084a 패턴), 강사 카드에 "N회 열람" 배지. `ip_hash=sha256(ip+':'+tenant_id)` 원본 IP 미저장(0048a). 워커 스크린샷은 `x-eywa-internal` secret 헤더로 로깅 제외. |
| `0088a_students_classnote_name` | **`students.classnote_name text`**(nullable) — ClassNote 보드명 오버라이드(동명이인 구분, P3 오발송 방지 옵션2). 지정 시 워커 보드명·동명이인 감지가 `(classnote_name \|\| name)` 유효이름 사용 → 동명이인을 `김서윤(중2)` 등으로 구분해 발송 허용. 비우면 name(기본 불변). nullable이라 rewrite 없음. |
| `0087a_lesson_reports_attachments` | **`lesson_reports.attachments jsonb not null default '[]'`** — 수업 보고서 학생 사진 첨부(P2b). `[{path,name,size}]`, `report-attachments` 버킷(private, admin signed URL 양방향이라 storage RLS 불요 — document/branding 방식). `/r`·ClassNote 스샷에 `<img>` 렌더. 상수 default라 rewrite 없음(0035b `expenses.receipt_urls` 미러). 강사가 **저장된 보고서에만** 첨부(유령 row 방지), 첨부 변경 시 classnote_status 리셋. |

| `0095a_edutrix_archive` | **`edutrix_archive`(source_table·source_id·row jsonb, unique(source_table,source_id)) + RLS 정책 0(=service_role 전용)** — Edutrix 은퇴 보험: 원본 Supabase 9테이블 23,339행 raw 스냅샷(reports 16,877·submission_logs 4,145·share_link_views 1,058·en_* 등). 적재 스크립트 `scripts/_edutrix_retire/archive-edutrix.cjs`(멱등 upsert, 자격증명 필드 `classnote_login_pw`·`profile_token` 제거). 운영 반영(lesson_reports 풀 이력)은 `full-import-reports.cjs` 별도. |

| `0100a_users_notion_user_id` | **`users.notion_user_id text`(nullable) + 부분 유니크 `(tenant_id, notion_user_id) where notion_user_id is not null`** — 직원 상세 '월간일정' 탭(근무일정 대체)이 이 값으로 Notion 업무 DB(담당자=이 사용자)를 마감일 기준 조회. makeedu_id(0057a)/edutrix_student_id(0094a) 외부키 패턴. nullable 추가라 rewrite 없음. 토큰은 env(`NOTION_TOKEN`), DB id도 env(`NOTION_TASKS_DATABASE_ID`) — 매핑만 이 컬럼. (병렬 세션이 0098a=시트락·0099a=반공지 선점 → 0100a로.) |
| `0110a_dashboard_absence_effective` | **`dashboard_absence_risk` 유효 출결 정정 반영** — append-only `attendance_records`를 학생·반·수업일별 최신 `recorded_at` 1행으로 dedupe한 뒤 최근 14일 결석을 집계. `security invoker` + `auth_tenant_id()` 이중격리 유지. |

| `0111a_expenses_amount_decimal` | **`expenses.amount` numeric(12,0)→(12,2)** — 달러·유로 등 소수 통화 지출($10.60) 지원. 통화별 소수 자릿수는 코드 단일 소스(`src/features/billing/currencies.ts` `decimals`: KRW/JPY=0, USD/EUR/CNY/GBP=2)가 관리하고 DB는 최대 2자리 저장. 기존 값 전부 정수라 scale 확대는 무손실·값 재작성 없음. `do $$` 가드로 scale=0일 때만 실행(멱등). 라인 총액·합계 반올림은 `roundMoney(amount, currency)` 단일 지점. |

| `0113a_ai_usage_logs` | **AI 호출 usage 계측 테이블** — `generateJSON` 1회 = 1행(feature·provider·model·key_name·input/output_tokens·ok·error). write=서버(service_role)만(insert 정책 없음, 0074a 선례), read=테넌트 select 정책(0108a 선례). tenant_id nullable(컨텍스트 미상 호출은 null). 기록은 best-effort — 실패해도 AI 호출을 안 막는다. |

| `0114a_daily_briefings` | **운영실 일일 AI 브리핑** — ① `daily_briefings`(tenant×date 유니크=upsert 멱등, payload jsonb=결정론 다이제스트·narrative=가드 통과 LLM 서술·processing_status·notified_at 알림 1회 게이트). ⚠️ RLS 켜되 **정책 0개**(select도 없음) — payload가 master 관점 전신호라 서버(admin)가 canManageStaff 게이트 후에만 읽는다(#77). ② 세션용 RPC의 p_tenant 변형 2종(`dashboard_unassigned_enrolled_admin`·`dashboard_absence_risk_admin`) — auth_tenant_id()가 service_role에서 **에러 없이 0행**이 되는 silent 오보 방지. execute는 service_role만. |

| `0116a_daily_briefings_team_report` | **브리핑 v2 "학원 매니저 팀" 보고 컬럼** — `team_report` jsonb `{headline, managers:[{area: 수업\|학생\|상담\|수납\|운영, report}]}`(validateTeamReport 가드 통과분만). 기존 `narrative`(v1 단문)는 하위호환 표시용 잔존, 새 행은 team_report만 기록. payload는 계속 결정론 전용(위험 학생 스포트라이트 포함). (⚠️ 아래와 동번호 — 0111a 선례처럼 병렬 세션 충돌, 사전순 적용이라 둘 다 안전.) |

| `0116a_onescreen_student_order` | **`onescreen_student_order`(tenant·teacher·class PK, student_ids uuid[]) + tenant RLS** — 원스크린 학생 표시 순서(강사×반 개인 설정, edutrix '순서변경' 패리티). roster가 반 그룹 내부만 재배열(`student-order.ts` 순수함수). teacher own-스코프는 앱 레이어(`order-actions.ts`: teacher_id=`effectiveTeacherId` 서버 파생 + 담당 반 소유·수강생 소속 검증 — 0112a 철학). (병렬 세션이 0114a=일일 브리핑·0115a=출석 시수 선점 → 0116a로 개명.) |

| `0117a_assistant_conversations` | ⚠️ **기능 폐지(2026-09-03, 원장 "대화형 비서 제거. 필요없음.") — 표는 남기고 코드만 제거**(과거 대화 보존, drop은 원장 결정 사항). 이하 원래 설명: **운영실 AI 비서 대화 저장**(Phase 2 — 대화형 비서 도입 승인 2026-07-16) — 대화 1건=1행, `messages` jsonb는 표시용 텍스트 턴만(툴 원시 블록·조회 스냅샷 미저장 → 권한 변화에 안전). RLS = (tenant, 본인) own-row 전권 — 실행·저장 전부 사용자 세션(RLS·권한 자동 상속), service_role 불사용. |

| `0117a_invoice_teacher_splits` | **강사별 시수 분배 저장(수납, 골든마스터 게이트 뒤)** — 병렬 세션 splits 마이그레이션(0116a→0117a 리네임). 상세는 해당 세션 changelog. |

| `0117a_onescreen_prior_reports_rpc` | **`onescreen_prior_reports(p_student_ids uuid[], p_before date)` RPC** — 원스크린 로스터가 (학생×과목)별 대상 날짜 직전 최신 lesson_reports 1건씩만 DISTINCT ON으로 반환. 옛 코드는 담당 학생 전체 이력을 무페이징 select(B2 위반) → PostgREST 1000행 silent 절단으로 이전 회차 참고행·'가져오기'·prevScore·교재 승계가 오래된 학생부터 누락됐다(당일 행은 roster가 eq(date) 별도 조회). `security invoker`+`auth_tenant_id()` 이중격리(0039a/0040a 패턴). ⚠️ 0117a 3중복(assistant·splits·prior_reports) — 접미사 달라 db:alphas 사전순 적용, 전부 멱등이라 공존 안전(0111a·0116a 선례). |

| `0118a_notification_events` | **이벤트 알림 dedup 원장**(Phase 3 이벤트 감지형 능동 알림) — 한 행 = "이 이벤트 1회 처리(발송/시드)". unique(tenant_id, event_type, subject_key, bucket)가 재발송 차단(bucket=결석 마일스톤 '3'/'5'/'10' · 후속조치 '날짜:due/overdue'). seeded=true=콜드스타트 무발송 시드(벨 폭탄 방지, 0108a 철학). write=서버(service_role)만(정책 없음), read=테넌트 select. 앱 표면 없음(부기용 — 알림은 기존 벨). |

| `0118a_onescreen_session_teacher_axis` | **`onescreen_daily_sessions` 유니크 (tenant,student,date)→(tenant,updated_by,student,date)** — 같은 학생을 같은 날 가르치는 두 강사가 서로의 '작업중' 세션(subject_progress·점수·태도)을 통째 덮어쓰던 문제. updated_by(=저장한 강사) 재사용(신규 컬럼 없이), 강사별 1행. `saveOnescreenSession` onConflict·roster 조회(`updated_by=본인`)도 함께. `do $$` 가드로 옛 제약 드롭(멱등). 기존 행 무손실(옛 유니크가 (tenant,student,date) 유일 보장). ⚠️ 0118a 2중복(notification·session_teacher) — 접미사 달라 공존 안전. |

| `0121a_top_outstanding_admin` | **`dashboard_top_outstanding`의 cron(service_role) 변형**(`dashboard_top_outstanding_admin(p_limit, p_tenant)`) — 미수 임계 이벤트(Phase 3)가 학생별 총 미수를 세션 없이 읽도록. 로직 0101a와 동일(행 레벨 greatest(0,…), unpaid/partial). auth_tenant_id()→p_tenant, execute는 service_role만. |

| `0122a_lesson_reports_classnote_read` | **ClassNote 학부모 읽음 동기화**(A안 2단계) — `lesson_reports.classnote_read_at`(피드 `read_by_parent.date_read`) + `edutrix_share_token`(매칭 키: ClassNote 본문 `edutrix.vercel.app/share/{uuid}` = edutrix `reports.share_token`. eywa가 갖던 `edutrix_report_id`와 **다른 값**이라 신설). 부분 인덱스 2종(토큰 조인·미읽음 후보). 쓰기는 연동 PC 워커, 앱은 읽기만. |

| `0123a_classnote_workers_last_results` | **워커 폴러별 마지막 결과 동봉** — `classnote_workers.last_results jsonb`(하트비트에 `{queue|notice|provision|posts|comments|reads: {at, 숫자요약|error}}` 동봉). 하트비트는 살아도 특정 폴러만 조용히 실패하는 걸 앱(발송 큐 카드)에서 감지. 이력 아님(최신 상태만 — 이력은 연동 PC watch.log). 쓰기=워커 직결, 읽기=기존 tenant_read. |

| `0152a_onescreen_prior_reports_recent_progress` | **`onescreen_prior_reports`에 `recent_progress text[]` 추가** — 같은 단위(반\|과목)의 최근 진도 5건(최신순). 시험을 치는 날(월말평가·모의고사·내신대비·시험대비)은 진도칸에 상태 라벨만 저장돼 **다음 회차의 '이전 진도'가 시험으로 덮이던** 문제(원장 2026-07-28 *"그 날은 진도가 중단되는 날"*)를 해소. 어느 것이 시험 회차인지는 **앱이 판정**한다(`progress-status.ts` `carryProgress`) — 🔴 상태 라벨 목록을 SQL에 복제하지 않기 위해서(두 곳에 살면 한쪽만 고쳐져 조용히 어긋난다). 직전 회차 자체(참고행·교재 승계·prevScore)는 **불변** — 그건 실제 회차가 사실이다. `security invoker`+`auth_tenant_id()` 이중격리는 lateral 안에서도 유지. 롤백 = 0135a 재실행(앱은 컬럼이 없으면 기존 동작으로 폴백). 실측: 학생 120명 69ms. |

| `0153a_test_student_flag_notify_skip` | **테스트 학생 플래그 + 발송 실패 알림 제외** — `students.is_test boolean not null default false`(상수 default라 재작성 없음) + 2026-07-28 기준 테스트 계정 7명 백필. `notify_report_send_failed`(0143a) 맨 앞에 가드 한 줄 추가 — 테스트 학생이면 알림 없이 종료. 배경: 학부모가 없는 테스트 학생(학원이)의 실패가 담당 강사에게 매번 벨로 가서 **진짜 실패까지 무시되게** 만들었다(원장 2026-07-28). 🔴 이름 패턴(`학원%`)을 트리거에 넣지 않는다 — 실학생이 걸리면 진짜 실패가 조용히 사라진다. 플래그는 앞으로 집계·발송 큐에서도 재사용. 검증: 롤백 트랜잭션에서 학원이 0건·김수련 1건. |

| `0157a_class_sheets` | **English Class Sheet(ECS) — 반별 주간 수업계획서/출석부** — `class_sheet_plan_lines`(계획 줄: 앵커=실날짜+slot_start, 행 식별=id, 위치 UNIQUE는 skill_area **제외**+**DEFERRABLE**·이동 RPC 재번호용) · `class_sheet_goals`(담임/부담임 월간·주간 목표, period_start CHECK 월1일/월요일) · `class_sheet_student_marks`(교시 포함 키 — 하루 2교시 독립) · `class_sheet_memos`(위치키 CHECK — 내장 날짜 주 범위 검증). 🔒 4테이블 **RLS 정책 0 + PUBLIC/anon/authenticated revoke** = service_role 전용(0114a보다 넓게 — 역할 게이트는 앱 `requireEcsClassAccess`). classes/students `(tenant_id,id)` unique + **복합 FK**(교차 테넌트 참조 봉쇄). RPC 5종(`ecs_create/move/delete_plan_line`·`ecs_copy_week`·`ecs_mark_present_if_absent`) — 슬롯 advisory **xact** 락(정렬 획득), copy=의미행 있는 대상 교시 skip·placeholder 재번호·스케줄 밖 unmapped·주간 goals fill-empty, 출석=기록 없을 때만 present 생성(비파괴). ⚠️ DEFERRABLE UNIQUE는 ON CONFLICT 대상 불가 → insert는 전부 WHERE NOT EXISTS. '의미 있는 행' 정의는 TS `isMeaningfulPlanLine`과 동치 유지(Vitest 게이트). |

| `0161a_document_categories_and_links` | **서식 저장소 분류를 학원장이 관리 + 외부 링크 문서** — ① `academy_documents.category`를 enum(`academy_document_category`) → **text**로 완화하고 분류를 테넌트 테이블 `document_categories`(key/label/sort_order/is_system, `(tenant_id,key)` unique)로 이관. 기존 6개는 **같은 키로 시드**돼 기존 행 무손실. 새 테넌트는 `tenants` after-insert 트리거(`seed_document_categories`)가 시드. ⚠️ enum 타입 자체는 **드롭 안 함**(롤백 경로 보존). ② `link_url` 컬럼 + `kind` CHECK에 `'link'` 추가 — 구글드라이브 등 외부 문서를 사본 없이 등록. ③ 폴더 카운트 group-by RPC `document_category_counts()`(security invoker + `auth_tenant_id()`, 분류가 동적이라 head-count N+1 회피). RLS는 tenant_isolation만(부모 `academy_documents`와 동일 — 역할 게이트를 여기만 걸면 앞뒤가 안 맞고 0158a가 경고한 override 락아웃 위험). |

| `0266a_textbooks` | **교재목록(수업 교재 마스터)** — `textbooks`(구분·교재이름·페이지/시간·차수 수·표지) · `textbook_lessons`(차수 한 칸 = 진도·과제, `(tenant,textbook,lesson_no)` **일반** 유니크라 upsert 가능 [[#113]]) · `class_textbook_plans`(반 배정: 축 `class`/`jj` · 단위 `period`/`day` · 시작일·시작 차수). 🔴 수납관리 `textbook_catalog`(교재 단가표, makeedu 동기화되는 **금액** 표)와 **합치지 않는다** — 계획 줄의 교재 문자열이 372종이라 부으면 교재신청·계산기 picker가 오염된다. 🔴 `class_sheet_plan_lines`에 교재 FK를 심지 않는다(그 표는 실제 기록이고 자유 텍스트가 정본). RPC `ecs_apply_textbook_lessons(…, p_targets jsonb)` = 앱(`buildLessonSchedule`)이 정한 (날짜,교시)에 **빈 칸만** 채운다(`ecs_copy_slot` 규약, 덮어쓰기 없음). 줄 고르기 = 같은 교재명 → 같은 구분의 빈 줄 → 새 줄(≤20, pos_uq가 DEFERRABLE이라 ON CONFLICT 불가 → max+1). 읽기=테넌트 select 정책 / 쓰기=service_role. 앱 게이트 둘: 교재 편집=`canWriteTenant("textbooks")` · 배정·기입=`requireEcsClassAccess(write)`. ⚠️ 표가 없어도 화면은 살고 ECS 시트는 그대로 돈다([[#95]]). |

| `0268a_class_textbook_plan_slots` | **반 교재 배정에 고른 교시 목록** — `class_textbook_plans.slot_starts text[]`(`"HH:MM"`). 0266a는 교시를 **축**(정규/JJ)으로 뭉뚱그렸는데 사람이 고르는 건 **시각**이고(원장 2026-09-16 *"16시 수업 클릭 17시 수업 클릭"*), 같은 반 같은 시각이라도 자리·수업이 섞여 축으론 "이 두 칸만"을 표현할 수 없었다. 값이 있으면 그 시각만 차수를 태운다. 🔴 `slot_axis`는 **안 지운다**(옛 배정·적용 전 코드가 그걸로 읽는다 — expand/contract). 🔴 시각은 `time[]`이 아니라 **`text[]`** — 앱·RPC·화면이 내내 `"HH:MM"` 5자로 슬롯을 가리킨다(`time`이면 PostgREST가 `16:20:00`을 줘 한 글자 차이로 어긋난다). CHECK는 **개수만**(1~12, `coalesce(array_length…,0)` — 안 감싸면 빈 배열이 NULL 비교로 통과한다); 형식은 쓰기 경로가 하나뿐이라(쓰기 정책 0개) 앱이 지킨다. ⚠️ 적용 전에도 조회는 **폴백**으로 살고(그 배정은 옛 축), 교시를 고른 **저장만** 한글로 거절한다 — 조용히 축으로 떨어뜨리면 고르지도 않은 교시에 차수가 깔린다([[#95]]). |

| `0269b_math_learning_goals` | **수학 시트 전체 목표** — 학생·반별 학습 과정, 시작·완료 블록, 목표 기간, 교재. 월·주·일 목표는 반 시간표·휴강일·수강 기간·분리 등원 요일로 계산한다. 실제 진도는 기존 `lesson_reports`를 읽는다. 기존 월 목표는 보존한다. 테넌트 복합 FK, RLS 정책 0개 + 직접 읽기/쓰기 revoke, service_role 전용, 앱 `requireMcsClassAccess` 게이트. 테이블이 없는 환경은 저장을 막고 기존 기록을 표시한다. 2026-09-17 연결 DB 적용 및 권한 검증 완료. |

| `0269c_math_learning_track_goals` | **정규 24블록·수요일 복습 4블록 계획** — 학생·반·수업 구분·시작 월별로 저장해 두 목표와 월별 이력을 분리한다. 정규 3개월·24블록, 보조 한 달·4블록을 DB CHECK로 검증한다. 새 정규 계획이 있는 기간에는 0269b보다 우선하며 기존 표는 보존한다. 테넌트 복합 FK, RLS + 직접 읽기/쓰기 revoke, service_role 전용. 2026-09-17 연결 DB 적용. |
| `0273a_math_learning_twelve_blocks` | **정규 한 학기 12블록·월 4블록** — 새 계획의 저장을 허용하면서 이전 24블록 행과도 호환되는 CHECK로 변경한다. 앱은 이전 목표를 조회·확장할 때 블록 단위를 환산하고 단원·완료일·수정 버전을 보존한다. 기존 데이터 변경 없음. 2026-09-18 연결 DB 적용 및 신·구 계획/잘못된 기간 검증 완료. |
| `0271a_class_schedules_lab_separate` | **LAB 교시 '따로 수업(*LAB)' 표식** — `class_schedules.lab_separate boolean not null default false`. 원장 2026-09-17 *"랩실 옆에 토글키를 두고 토글하게 되면 LAB -> *LAB 밑줄 + 이탤릭체"*(따로 수업듣는 학생 분리). 🔴 라벨을 `*LAB`으로 바꾸지 않고 칸을 새로 둔 이유: LAB 판정(`specialSlotLabel`) 소비처가 시수(돈)·출결·자리 출석부·가져오기·SQL까지 수십 곳이라 라벨을 바꾸면 LAB이 '사람'이 된다. 🔴 LAB 전용 CHECK는 **안 건다**(가져오기 RPC가 라벨만 바꾸는 경로에서 제약에 걸려 가져오기 전체가 실패한다 — 앱이 LAB일 때만 읽는다). ⚠️ 1단계는 **표시만**(명단·출결·시수는 안 본다). ⚠️ 앱은 기존 `class_schedules` 조회에 이 칸을 **끼우지 않고** 켜진 행 id만 따로 fail-soft로 읽는다(`loadLabSeparateIds`) — 적용 전에도 시간표·반 수정이 산다([[#95]]). |
| `0271b_lab_separate_nullable_and_enrollment_flag` | **0271a 후속** — ① `class_schedules.lab_separate` **not null 해제**: 옛 영어 시간표 가져오기 되돌리기(`rollback_english_structure`)가 `jsonb_populate_record`로 칸 없던 스냅샷을 되살리면 NULL이 들어가 되돌리기 전체가 실패한다(적대적 리뷰 2026-09-17). 앱은 `.eq(true)`로만 읽고 쓸 땐 늘 명시하므로 NULL = 꺼짐. ② `enrollments.lab_separate boolean default false`(**nullable**, 같은 이유) — EiE 반 학생 줄 '*LAB 교시 배정'(원장 2026-09-17: 켠 학생은 LAB실 출석부의 *LAB 교시에만, 즉시 적용). ③ `notify pgrst, 'reload schema'`. |
| `0309a_protect_super_admin_accounts` | **보호 계정 = super_admins 명단** — 원장 2026-09-30 *"다음에 이런 일이 있어도 변경 안되게 강력 가드. 꼭 물어봐야하는걸로"*. 명단 계정의 `users.system_role`·`status`·`tenant_id` 변경·삭제, `auth.users`의 app_metadata system_role·tenant_id 변경·로그인 차단·삭제, `super_admins` 행 수정·삭제, `super_admins`·`users` 통째 비우기(TRUNCATE, 문장 트리거)를 트리거가 막는다. 예외 문구는 중립(지점에 총괄 정체 비노출). **값이 실제로 바뀔 때만** 막아 미러 트리거(0075a)·로그인 갱신은 통과. 우회 = 한 트랜잭션 안 `set local app.allow_protected_change = 'on'`(원장 승인 후 SQL 편집기). 앱 문은 `src/lib/auth/protected-accounts.ts`. 앱 배포와 독립. |
| `0312a_protect_super_admin_accounts_hardening` | **0309a 보강(원장 2026-09-30 *"2,3중이상으로 해도 되니까"*)** — ① auth.users 트리거가 소프트 삭제(`deleted_at`)·auth `role` 변경도 막는다(운영 DB 되돌림 실측에서 소프트 삭제만 통과했다) ② 권한 층: super_admins의 update·delete·truncate와 users의 truncate를 API 역할(anon·authenticated·service_role)에서 회수 — 트리거가 꺼져도 API 키로는 명단을 못 건드린다(INSERT·SELECT 유지) ③ `protected_guard_triggers()`(service_role 전용) — 매일 점검 크론이 가드 트리거 5개의 존재·활성을 본다. 앱은 미적용이어도 돈다(트리거 확인만 빠짐). |
| `0316a_attendance_taught_by` | **출결 칸의 대신 보강 귀속 강사** — `attendance_records.taught_by uuid null`(users FK, on delete set null) + 부분 인덱스(`taught_by is not null`). 원장 2026-09-30 결정: 위임 없이 남의 반 학생을 대신 보강하면 보고서·출석부 반은 학생의 원래 반(B반), 그 칸의 시수는 보강한 강사(A) 몫. 보강 보고서 저장 훅이 보강한 강사가 그 반을 담당하지 않을 때만 적는다(나머지는 NULL = 종전 축). 판정 단일 소스 `teacher-axis.ts`(`ownsAttendanceSlot` `taughtBy` · `resolveRecordTaughtBy`). ⚠️ 앱은 칸이 없어도 돈다([[#95]] — probe 뒤 따로 읽고, 쓰기는 칸이 없으면 귀속만 뺀다). 원스크린 로스터 select엔 넣지 않는다. |
| `0318a_student_consultation_class` | **원생상담 ↔ 반 매핑 + 상담 통계 RPC**(원장 2026-09-30 *"상담자와 매핑되는 반으로 알아서 스마트하게. 없으면 미매핑. 관리자도 미매핑."* · *"우측에 상담 통계 고도화"*) — ① `student_consultations.class_id`(FK 이름 `student_consultations_class_id_fkey`, on delete set null — 임베드는 이 이름을 명시, [[#94]]) + `class_source`(auto·manual·null, CHECK). 🔑 출처 칸이 따로 있는 이유 = 사람이 고른 '미매핑'과 아직 판정 안 한 옛 행이 둘 다 null이라, 없으면 자동 판정이 사람 선택을 덮는다. ② `consultation_class_candidates(학생[], 날짜[])` = 그날 수강 반 + 가르치는 사람(담임 ∪ 그날 교시 담당) — 판정 규칙은 `scripts/_makeedu/consultation-class.cjs` 한 벌, 워커는 같은 조건의 SQL을 직접 돈다(가드 테스트가 두 SQL을 대조). ③ `consultation_stats(...)` jsonb = 목록 필터 그대로의 합계·월/주 12버킷·6축 분해(상위 12 + 작은 추이) ④ `consultation_gap_students(...)` = 30·60·90일+ 상담 공백 재원생(운영실과 같은 '실시간 재원생' — 아직 시작 안 한 수강만 가진 학생 제외). 🔑 후보 RPC는 집합 반환이라 앱이 120쌍씩 나눠 부른다(PostgREST 1,000행 절단 방지). 전부 security invoker + `auth_tenant_id()`, anon 실행 회수. 🔴 앱은 미적용이어도 돈다([[#95]] — 반 열·반 칸이 숨고 패널은 건수 카드만). 기존 1,903건은 **백필 드라이런만**(`scripts/_oneoff/backfill-consultation-classes.mjs`, `--apply`는 빈 칸만+감사로그 — 원장 승인 후). |

| `0340a_homework_video_drive_accounts` | 지점별 Google 계정 소유 등록, 연결·OAuth 시도 표, 기존 루트·설정의 연결 FK. RLS 및 서비스 역할 전용 권한. |
| `0341a_homework_video_drive_account_credentials` | Vault 갱신 토큰 저장, 동일 계정 재연결 버전 갱신, 지점·루트·연결이 일치하는 자격 조회 RPC. 웹 클라이언트 비밀은 저장하지 않는다. |
| `0342a_homework_video_drive_account_routes` | 연결 번호를 포함한 폴더 저장, 시작한 영상의 지점·루트·계정 변경 금지, 이전 저장 RPC 차단. 위의 원자 적용 순서를 따른다. |
| `0357a_teacher_portfolio_months` | **직원 포트폴리오 월간 점수**(원장 2026-10-12 *"모든 점수는 말일 마감하고 1일부터 새점수"*) — 강사 × 월 한 행(`payload` jsonb에 점수와 근거). RLS 켬 + 정책 없음(service_role 전용 — 전 강사 점수·담당 매출이 실린다). 마감한 행(`closed_at`)은 트리거가 UPDATE를 막는다. 새 표 하나라 기존 화면 무영향, 앱은 표가 없어도 돈다. |
| `0359a_teacher_evaluation_settings` | **강사평가 설정**(원장 2026-10-13 *"'이것까지 커스터마이징 가능해?' 할 정도로"* · *"만점이 100점이 아니여도 됨"*) — `teacher_evaluation_settings`(지점마다 설정 한 줄 · 지표 켜고 끄기·만점·점수 규칙·자료 없을 때) + `teacher_evaluation_entries`(원장이 만든 지표의 월 입력). 두 표 모두 RLS 켬 + 정책 없음(service_role 전용). `teacher_portfolio_months`의 총점 0~100 · 항목 수 0~8 제약을 풀고 `raws`(설정 미리보기용 원래 수치)를 더한다. 앱은 이 SQL 전에도 돈다(기본 설정으로 계산 · raws 없이 저장). |
| `0360a_teacher_evaluation_presets` | **강사평가 구성 저장·불러오기**(원장 2026-10-13 *"폼 저장? 불러오기?"*) — `teacher_evaluation_presets`(지점 × 이름 유일 · 구성 jsonb ≤256KB · 지점당 20개는 앱이 막는다). RLS 켬 + 정책 없음(service_role 전용). 불러오기는 화면에 얹을 뿐이고 점수를 매기는 설정은 [저장]으로만 바뀐다. 앱은 이 SQL 전에도 돈다(목록 빈 칸 · 저장만 준비 안내). ✅ 2026-10-13 운영 적용(CLI). |
| `0362a_consultation_referrer` | **콜&상담 '소개한 사람'**(강사평가 원장 결정 7 · 원생 소개) — `enrollment_consultations`에 `referrer_student_id`·`referrer_staff_id`(둘 중 하나만 — 체크 `ec_referrer_one_chk`)·`referrer_name`(QR 글) + 같은 학원 사람만 트리거(`enforce_consultation_referrer_tenant`, security definer) + 부분 인덱스. 앱은 이 SQL 전에도 돈다(소개 칸 숨김 · 강사평가 소개 0건 · QR은 이름만 빼고 접수). 원래 0361a였으나 교재 0361a와 겹쳐 0362a로(병합 때). ⏳ 운영 적용 전. |
| `0320a_parent_accounts` | **학부모 로그인 계정**(윤여원 2026-09-28~30) — `parent_accounts`(auth.users 1:1 · 학원별 로그인 이메일 유일) · `parent_account_students`(학부모↔원생). RLS = 같은 학원의 master·admin·super_admin만 읽기, 쓰기는 service_role. ⚠️ **공용 `tg_sync_user_from_auth()`(0075a)를 다시 정의**한다 — 로직은 0075a와 같고 `app_metadata.account_type = 'parent'` 로그인은 `users`(직원 표)로 복사하지 않는 갈래 하나만 더했다. 🔴 이 함수를 고치는 뒤 마이그레이션은 **parent 갈래를 유지**할 것. |
| `0321a_shuttle_ride_exception_history` | **셔틀 '그날만 변경' 이력 장부** — `shuttle_ride_exceptions`(0229a)에 `actor_kind`(staff·parent·system)·`actor_name`·`parent_account_id` + 장부 `shuttle_ride_exception_history`(생성·변경·취소마다 트리거가 한 줄, 전/후 자리 글자 스냅샷). 🔴 **추가만** — 수정·삭제는 service_role도 트리거가 거절. 자리 글자 `shuttle_ride_exception_label()`, 취소는 `cancel_shuttle_ride_exception()`로만(행위자를 장부에 넘긴다). 장부엔 FK 없음(cascade 중 트리거가 쓰므로). 0320a 필요. |
| `0322a_shuttle_regular_ride_change` | **셔틀 매주 고정(요일) 시간 변경** — `change_shuttle_regular_ride()`가 한 트랜잭션으로 그 요일 하나만 옮기고(빼기 → 새 칸에 더하기) 이력 `shuttle_rider_history`(요일·전/후·사유·행위자, 추가만)를 남긴다. 반환 `same`·`changed`. 날짜 하루짜리 변경이 걸린 날은 그 변경이 여전히 이긴다. 0321a 필요. |
| `0323a_shuttle_history_acks` | **변경 내역 '확인' 표식** — 관리자 '학부모 등하원' 화면에서 [확인]한 장부 줄(0321a·0322a)을 **화면에서만** 내린다(장부는 추가만이라 표식을 따로 쌓는다). 유일 `(tenant_id, history_kind, history_id)` — upsert 축이라 부분 유니크 아님([[#113]]). 학원 공용 · 누가·언제 확인했는지 남음. 없어도 앱은 산다(아무것도 안 숨김). |
| `0390a_homework_video_reviews` | **영상 설명 AI 참고 메모** — 영상마다 분석 줄 하나(stage: extract → transcribe → judge(밤 배치) → verify → done) · 앱 사용자 정책 0개(서버 전용 · 연동 앱 워커 역할만 자기 지점 줄) · 비공개 버킷 `homework-video-review`(mp3·jpg 50MB). ⚠️ 새 DB는 이름순이라 `0401a_sync_agent_data_boundary` 앞에 돌아 워커 권한을 건너뛴다 — 그 뒤 이 파일을 한 번 더 실행할 것(멱등). |
| `0391a_ai_usage_cache_tokens` | **AI 사용량에 프롬프트 캐시 토큰 두 칸**(`cache_read_tokens`·`cache_write_tokens`) — Anthropic의 `input_tokens`는 캐시에서 읽은 토큰을 뺀 값이라 캐시를 켠 기능(영상 설명 AI 참고 메모 밤 배치)의 비용이 이 칸 없이는 실제보다 적게 보인다. 앱은 값이 0보다 클 때만 쓴다(열 없는 DB에서도 다른 기록은 그대로). |
| `0392a_lesson_report_send_events` | **수업보고서 발송 이력** — 발송 상태가 바뀔 때마다 트리거가 `lesson_report_send_events`에 한 줄(요청·집음·재시도·발송·실패·보류·회수·표시 지움·삭제 + 학부모 카드 칸 사본). 추가만 · 서버 전용 · 보고서가 지워져도 남는다(외래키 없음). 앱 배포와 독립. |
| `0392b_lesson_report_send_events_backfill` | **발송 이력 백필**(0392a 다음, 드라이런 먼저) — 보고서 행의 마지막 발송 시각 · 발송 요청 감사로그 · 지움 기록만 남은 옛 발송. 멱등. |
| `0445a_student_ontology_summaries` | **운영 적용 2026-10-23 · CLI** — 요청자별 발췌 요약·지점별 일일 사용량. RLS·서버 전용 접근, 지점 일치 검증과 원자 호출 예약 확인. |
| `0447a_unassigned_video_fillable_and_notification_cleanup` | **✅ 운영 적용 2026-10-23 · CLI** — **미배정 영상 할 일 = 붙일 빈 숙제가 있을 때만**(`p_moot` → 취소 `no_open_homework`) · 묶음 알림 건수에서 닫힌 할 일 영상 빼기 · 할 일이 끝난 알림은 읽음(트리거) · 30일 넘게 안 읽은 알림은 보관함(`archive_stale_notifications`) · 한 번 맞춤. 앱보다 먼저. |
| `0446a_student_ontology_current_scope` | **운영 적용 2026-10-23 · CLI** — 현재 수강·담당 연결 집계와 20명 서버 페이지. 원본 학생 범위·지점 조건·서버 전용 권한 확인, 331명 원본 대사. |

새 alpha를 추가할 때: 다음 번호의 `000Na_*` 또는 `000Nb_*`로 만들고, 멱등 패턴을 지키고, **이 표에 추가**한다.
상세 흐름은 [`../../CLAUDE.md`](../../CLAUDE.md) "마이그레이션 & 시드 흐름" 참고.
