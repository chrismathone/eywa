# 학원 비서 — 원장 자연어 질의 챗봇 (설계 · 2026-11-06)

원장 2026-11-06 *"모든 db에 접근가능한 챗봇을 만들어서 원장이상급이 챗봇에게 자연어로 질문하면 ai가 피드백해주는 학원 비서 챗봇"* ·
*"그냥 대화로 출력하는것이 아닌 서식을 동원해서 깔끔하게 출력해주는, 차트나 이런 모든 활용할 수 있는 서식을 동원해 피드백"* ·
*"답변할때 형식적인 답변이 아닌 비서답게 어떻게 처리하면 좋겠다 같은 의견 제시도 같이"* · *"온톨로지 기반의 답변을 해주면 좋을듯"* ·
*"진짜 Ai 대화하는것처럼 어떤 db를 조회중이고 어떤 프로그레스중인지 단계가 표시되면 좋을듯"*.

> 🔴 **2026-09-03 결정을 원장이 직접 바꿨다.** 그날 *"대화형 비서 제거. 필요없음."*으로 옛 '매니저 팀에게 물어보기'(Solar · 도구 9종 · 운영실 카드)를 걷고
> '챗봇 영구 제외 · 재제안 금지'로 적었다(ops.md · dashboard.md). 이번 학원 비서는 **원장이 먼저 지시한 새 기능**이다 — 우리가 다시 제안한 것이 아니다.
> 옛것과 다른 점: 운영실 카드가 아니라 어디서나 여는 오버레이 · 그 지점 DB 전부(전용 역할 · 보기) · 보고서 블록(차트·표·KPI·비서 의견) · Claude 전용.

## 원장 결정 (11-06)

| 항목 | 결정 |
|---|---|
| 쓰는 사람 | 원장(`master`) + 슈퍼관리자. 강사뷰 · 운영 콘솔 '지점 보기' 중에는 막는다. |
| 읽는 범위 | *"원장 자료니까 db를 하나도 빠짐없이 해당 지점 db를 조회하고 답변할 수 있어야함"* → **그 지점 표 전부**(급여·인사·연락처·계좌 포함). 빼는 것은 **시스템 비밀값 칸**뿐(봇 토큰·기기/링크 토큰·푸시 키·해시·잠금 토큰 · 자리 PIN — 학원 자료가 아니라 열쇠). |
| 추론 강도 | *"적음(하이쿠)/보통(소넷)/강함(오퍼스) … 모델명은 숨기고"* → 대화창에서 고른다(Haiku 5.5 low · Sonnet 5.5 medium · Opus 5.5 high). |
| 화면 | *"어디서나 오버레이로 열 수 있게 다른 화면 위에"* — 위쪽 바 버튼 · 단축키 · 오버레이(전체 화면으로 키움). |
| 출력 | 보고서 블록 + **비서 의견**(할 일 · 근거 · 언제 · 누가) — 보고서마다 하나 꼭. |
| 진행 | 단계 타임라인(질문 이해 → 표 확인 → 조회문 작성 → 조회(어떤 표) → 결과 살펴보기 → 보고서) — 다시 열면 '과정 보기'. |

## 1. 흐름

`POST /api/assistant/ask`(NDJSON 흐름 — `protocol.ts`):
1. 문(`gate.ts`) → 지점 AI 라이선스(`requireAiLicense`) → 5분 넘은 '도는 중' 줄을 실패로 닫기 → 하루 100번 · 겹친 질문 막기(`store.admission`) → 대화·'도는 중' 줄 저장. 🔴 동시에 두 탭에서 물어도 사람당 '도는 질문'은 하나 — DB 고유 색인(`assistant_messages_one_running_idx`, 멈춤 누른 질문은 제외)이 막는다(앱 확인만으로는 경쟁 상태).
2. 비서 DB 연결(`executor.ts`) — 먼저 보기 갱신(바뀌었을 때만, service_role RPC).
3. AI 루프(`agent.ts`, 최대 14차례 · 조회 12번 · 150초 뒤 마무리 지시 + 그 뒤 조회·표 구조 요청은 실행하지 않음) — 도구 `describe_table` · `run_sql` · `render_report`. 표 구조 조회·SQL 검사기의 일시 오류는 그 도구만 실패로 돌려준다(질문 전체를 버리지 않는다).
   - 캐시 — 시스템 앞부분(도구 + 시스템) + 요청 최상위 `cache_control`(대화 기록 — 앞 차례 조회 결과가 차례마다 다시 가므로).
   - 진행 단계 `step` 이벤트 — 스트림의 `content_block_start`(도구 입력 쓰기 시작)에 단계를 열고, `inputJson`으로 들어오는 `purpose`를 바로 붙인다.
4. 답 저장(보고서 · 조회 · 단계 · 사용량) · 감사 `assistant_ask` · 사용량 장부(`recordUsage`, feature `academy_assistant`, 키 그룹 `ASSISTANT` — 끝까지 못 받은 차례의 토큰도 적는다(⚠️ 그 차례는 message_start 시점 값이라 출력 토큰이 거의 0 — 알려진 한계) · 사람이 누른 멈춤은 실패로 적지 않는다 · 고정 기한은 늘 실패로). 저장이 실패하면 표·차트 자료를 뺀 보고서로 한 번 더 저장하고, 그래도 안 되면 상태만 '실패'로 닫고(`markFailed`) 화면에도 실패로 보낸다(보인 답과 저장본이 어긋나지 않게 · 감사 outcome도 실제 저장 결과).
- 🔴 화면 연결이 끊겨도 끝까지 돌고 저장한다(`after`). 멈춤 = 사람이 누른 '멈춤'(`cancel_requested_at`, 2초마다 확인) 또는 **고정 기한 250초**(`ASSISTANT_HARD_DEADLINE_MS` — 라우트 기한 300초에 함수가 죽으면 저장·감사·사용량이 통째로 빠지므로 스스로 끊고 실패로 저장).
- 멈춤 순서 — 화면은 서버에 **알림이 끝난 뒤** 흐름을 끊는다(그 사이 '멈추는 중…' — 바로 다시 물어도 '앞 질문을 만드는 중'에 걸리지 않게). 번호(`started`)로 보내고, 실패하면(세션 만료·500·망) `POST /api/assistant/messages/current/stop`('지금 도는 내 질문' — 사람당 하나)으로 한 번 더 · `keepalive`. 번호를 받기 전에 누르면 기다렸다가 번호가 오자마자 알리고, 15초가 지나도 안 오면 `current`로. 멈춘 질문은 마무리 중이어도 바로 다시 물을 수 있다.
- 다시 읽기 — 저장본이 '도는 중'이면 3초마다 `GET /api/assistant/threads/[id]?status=1`(도는지만)으로 묻고, 끝났으면 대화 전체를 한 번 읽는다(최대 5분 — 매번 표·차트 자료를 받지 않게).

## 2. DB 안전장치 — 막는 것은 DB 권한이다(프롬프트가 아니라)

SQL = `supabase/migrations/s2_0031_academy_assistant.sql`(번호는 병합 때 확정) · 되돌리기 = `scripts/_oneoff/revert-s2_0031-academy-assistant.sql`.

- **로그인 역할 `aywa_assistant`** — `LOGIN NOINHERIT`, 어떤 역할의 구성원도 아니다(`set role`로 올라갈 곳이 없다) · 쓰기 함수·쓰기 권한 0 · 8초 · 연결 4개(조회는 앱이 늘 읽기 전용 거래로 연다 — 역할 기본값으로 걸지 않는다: 마이그레이션의 읽기 전용 설정은 지점 보기 가드가 막는다). 🔴 그래도 모든 역할은 PUBLIC의 구성원이다(적대 리뷰 1번) — 그래서 아래 'PUBLIC 실행권 회수'와 사후 확인을 둔다. env `ASSISTANT_DATABASE_URL`(거래 방식 풀러 6543 · 비밀번호는 저장소 밖).
- **보기 `assistant.<표>`** — `refresh_views()`가 public의 지점 칸 있는 표마다 만든다(소유자 postgres · `security_barrier` · `where tenant_id = (select bound_tenant())` — initplan이라 한 번만 계산). 지점 칸 없는 셋은 부모로(`consultation_ai_analysis` · `notice_popup_translations` · `tenants` 내 줄). 나머지 지점 칸 없는 표(슈퍼관리자 · 연동 PC 배포 등)는 학원 자료가 아니라 없다.
  - 비밀 칸 = 이름 패턴(`token|secret|password|passwd|p256dh|api_key|signature`, `_hash`, `auth`) + 명시 목록(`push_subscriptions.endpoint`) · 가림 = `tenant_settings.data`의 `operations.seatPins` · 제외 표 = 비서 대화 · 옛 대화형 비서 대화 · 운영 콘솔 보기 기록.
  - 🔴 **빠짐없이** = 질문마다 `assistant_refresh_views_if_stale()` — public 표·칸(타입)·정책 표의 지문이 바뀌었으면 다시 만든다(새 표 · 새 칸이 다음 질문부터 보인다).
- **지점 묶기 = DB가 서명한 증표**(적대 리뷰 2번 반영 — 처음 설계는 같은 역할이 bind를 부르는 방식이라 읽기 전용 한 겹에 달려 있었다):
  - 앱 서버가 서버 키로 `public.assistant_issue_binding(지점)`(service_role만 실행) → 증표 `<지점>.<만료 epoch>.<HMAC-SHA256>`(5분 · 서명 키는 `assistant_private.signing_key` — 누구에게도 권한 없음).
  - 조회 한 번 = `begin read only` → `set_config('assistant.binding', 증표, true)`(매개변수 — 다른 세션의 질의문에 안 보인다) · 8초 · search_path → `bound_tenant()`가 이 지점인지 확인(아니면 멈춤 — '0명'으로 답하지 않게) → EXPLAIN VERBOSE → 세이브포인트 안 조회 → `pg_advisory_unlock_all()` → rollback.
  - 비서 역할은 쓰기 함수가 하나도 없고 증표를 만들 수 없다 — set_config로 다른 값을 넣어도 서명이 안 맞아 null → 모든 보기 0행.
- **PUBLIC 실행권 회수**(적대 리뷰 1번) — 운영 확인 2026-11-06: PUBLIC이 실행할 수 있는 public 보안 정의자 함수 25개(트리거 14 · 일반 11 — `auth_*` · `is_super_admin` · `operator_view_tenant`), 모두 anon·authenticated·service_role·postgres에 명시 실행권이 따로 있다. → 트리거가 아닌 11개만 PUBLIC 실행권을 회수한다(명시 실행권 그대로 — 앱·로그인 사용자 영향 없음 · 되돌리기가 기록대로 되살린다). 사후 확인: 비서 역할이 부를 수 있는 보안 정의자 함수 = `bound_tenant()` 하나. ⚠️ `net.*`(pg_net)은 Supabase가 관리해 손대지 않는다 — 요청 함수는 큐 insert라 읽기 전용이 막고, `worker_restart` 같은 것은 앱 검사 + 실행 계획 검사가 막는다.
- **앱 검사(두 번째 겹, `sql-gate.ts`)** — `libpg-query@17`(실제 Postgres 17 파서) · 허용한 노드만 통과: 문장 하나 · SELECT만 · 표 = assistant 보기 또는 CTE(🔴 `pg_` 이름 무조건 거절 — 스키마를 안 붙여도 pg_catalog가 먼저 찾힌다) · 함수 허용 목록(`set_config`·`current_setting`·`pg_sleep`·`repeat`·`lpad`·`format` 등 없음) · 형변환 허용 타입만 · 재귀 CTE·TABLESAMPLE·FOR UPDATE·SELECT INTO 거절 · `generate_series`는 상수 날짜 범위 + 하루 이상 간격만.
- **실행 계획 검사(세 번째 겹, `planProblem`)** — EXPLAIN VERBOSE에 나타난 함수를 다시 본다(앱 검사와 따로 · 플래너가 실제로 해석한 것): pg_catalog·`bound_tenant` 밖의 스키마 함수 거절 · 위험 함수(`set_config` · advisory lock · `pg_terminate_backend` · `query_to_xml` · `pg_sleep` …) 거절.
- **보내는 방식** — AI 조회는 확장 질의 방식(`simple: false`)만 — 인자 없는 `unsafe()`는 단순 질의라 여러 문장이 한 번에 실행될 수 있다(적대 리뷰 2번) · 감싼 SQL도 다시 파싱해 한 문장인지 본다.
- **자원** — 8초 · EXPLAIN 총비용 500만 넘으면 안 돌림(운영 실측: 월별 집계 100 · 6개월 출결 2천 · 활동 기록 전체 1만 · 원생×출결 교차 조인 40만) · 2,000행 저장(AI에는 200행 · 셀 1,000자 · 결과 2만 자) · 질문당 연결 하나 · 역할 연결 4개.
- **시간대** — 조회 거래마다 `TimeZone = Asia/Seoul`(`set_config … true`) — `::date`·`date_trunc`·`::timestamp`가 한국 날짜·벽시계로 묶인다.
- **결과 칸** — 결과 칸 이름이 겹치면(`select s.name, c.name`) 돌려보내 별칭을 붙이게 한다(행 객체에 값이 하나만 남아 다른 칸 값이 보이므로). 시각은 시간대를 붙인 ISO(`2026-11-06T14:30:00+09:00`) — 시간대 없는 글자는 브라우저가 현지 시각으로 읽는다.
- 로컬 시험(PGlite, 운영 표 구조 284개 그대로) 64건 — 사람당 '도는 질문' 하나(고유 색인 · 멈춤 제외) 포함: 지점 격리 · 증표 없으면 0행 · 위조(지점·만료 바꾸기)·만료·조회 중 바꾸기 0행 · 증표 발급/서명 키/쓰기/쓰기 전환/role 변경/public 직접/정책 표/회수된 보안 정의자 거절 · PUBLIC 회수 뒤 로그인 사용자 실행 그대로 · 비밀 칸·PIN · 온톨로지 규칙(병합·장부 정리·시스템 일괄·유효 출결·명단/수업 대상) · 새 칸·새 표 자동 갱신 · 로그인 사용자 권한 0 · 두 번 적용 · 되돌리기 → 다시 적용.

## 3. DB 지도 · 온톨로지

- `catalog/tables-a.ts`·`tables-b.ts` — 표마다 `label`(진행 단계 칩) · `ko`(한 줄) · `notes`(상태 값 뜻 · 소프트 삭제 · 금액 단위 · 날짜 칸) · `columns`. 표 목록 + `ko`는 시스템 프롬프트(캐시), 나머지는 `describe_table`.
- **온톨로지**(`catalog/ontology.ts` — 학생 중심 온톨로지 결정 2026-10-22를 비서의 읽는 틀로): 개체(원생·보호자·형제·반·강사·과목·학원) · 기간 있는 관계(수강 · 담임 = 지금 값 · 교시 담당 · 임시 위임 — 🔴 배정은 실제 수업 증거가 아니다, 실제 = `taught_by`) · 사실(발생일·근거) · **근거 세 층**(기록 / 규칙 판정 / AI 해석 — 섞지 않는다) · 세는 규칙.
- **온톨로지 보기 `onto_*`** — 앱 판정 함수와 같은 뜻을 칸으로: `onto_students`(counted · is_merged · exit_kind real/bookkeeping/system_bulk/scheduled · status_label) · `onto_enrollments`(active_today · 과목) · `onto_attendance`(정정된 옛 줄 제외) · `onto_class_teachers`(담임·교시 담당·위임). 🔴 규칙을 바꾸면 SQL §6 · `ontology.ts` · 앱 판정(`isMergedStudent` · `isBookkeepingOnlyExit` · `isSystemBulkWithdrawal`)을 함께.

## 4. 보고서 블록(`report.ts`)

`summary` · `kpi` · `chart`(bar·stacked_bar·line·area·pie) · `table` · `callout` · `list` · **`advice`(비서 의견 — 꼭 하나)**.
🔴 차트·표의 숫자는 조회 결과를 가리킨다(`query` = q1·q2…) — 화면은 서버가 보관한 실제 결과로 그린다. KPI `ref`는 서버가 그 칸 값으로 맞춘다. 글자로만 그린다(링크·이미지·마크다운 없음 — DB 안의 글이 지시처럼 읽혀 바깥 주소를 부르지 않게).

## 5. 저장 · 감사

`assistant_threads` · `assistant_messages`(report · queries(SQL 포함) · steps · usage · cancel_requested_at) — 정책 0 · 서버 키로 읽고 쓰되 지점·본인을 늘 함께 거른다.
- **크기 상한**(`store.compactReport` — 흘려보내는 답과 저장본이 같다) — 셀 2천 자(서러게이트 쌍을 가르지 않는다 — 반쪽 글자는 jsonb가 거절) · 보고서 한 편 JSON 40만 자(넘으면 가장 큰 자료부터 행을 반씩 줄이고 '일부만') · SQL 2만 자. 대화를 다시 읽을 때(`threadDetail`)는 메시지 최근 100개 · 보고서 글(제목·블록)은 전부 · 표·차트 자료는 최근 답 8편 · 합쳐 250만 자까지(오래된 답은 '대화가 길어 이 자료는 생략' 안내). 지난 차례를 AI에 이을 때는 조회 번호를 빼고 SQL만 준다(새 차례도 q1부터 센다). 감사 `assistant_ask`(질문 앞 80자 · 강도 · 조회 수 · 토큰) · `assistant_thread_delete` — 슬랙으로는 내보내지 않는다(질문 글에 원생 이름·금액이 들 수 있다).

## 6. 운영 적용 순서

SQL → **원장 승인** → 운영 적용(SQL 편집기 또는 직결) → `alter role aywa_assistant password …`(저장소 밖) → Vercel env `ASSISTANT_DATABASE_URL`(+ 원하면 `ANTHROPIC_API_KEY_ASSISTANT`) → 앱 배포 → 원장 계정으로 질문 한 번(지점 격리 · 진행 단계 · 보고서 확인).

## 7. 다음(2단계)

답을 운영실 카드로 고정 · 엑셀/PDF 내보내기 · 아침 자동 브리핑 · 서버 거절 대체(`fallbacks` — SDK 0.98에 타입이 없어 지금은 거절 시 한국어 안내).
