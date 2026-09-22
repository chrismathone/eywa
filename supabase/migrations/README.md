# Supabase 마이그레이션 — 적용 방식·순서·현재 상태

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

모든 alpha 파일은 재실행 안전하게 작성: `create extension if not exists`, `create or replace function`,
`create index if not exists`, `drop policy if exists … create policy`, `drop trigger if exists … create trigger`.
→ 이미 적용된 DB에 다시 돌려도 에러 없이 no-op. (그래도 **번호 순서대로** 돌릴 것 — 뒤 파일이 앞 객체에 의존.)

## 2-1. 🔴 번호는 **겹치면 안 된다** — 같은 번호를 두 작업이 쓰면 "이거 돌렸나"를 아무도 못 센다

새 alpha 파일의 번호 = **지금 폴더의 최대 번호 + 1**(`ls supabase/migrations | sort | tail -3`으로 확인하고 짓는다).
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
# 1) drizzle 번호본 전부 (0000 … 0024)
pnpm db:migrate

# 2) alpha 파일(000Na_*) 전부를 사전순으로 멱등 적용 — 한 방. (재실행 안전: 이미 적용=skip)
pnpm db:alphas
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

새 alpha를 추가할 때: 다음 번호의 `000Na_*` 또는 `000Nb_*`로 만들고, 멱등 패턴을 지키고, **이 표에 추가**한다.
상세 흐름은 [`../../CLAUDE.md`](../../CLAUDE.md) "마이그레이션 & 시드 흐름" 참고.
