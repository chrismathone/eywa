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

## 3. 신규/빈 DB 셋업 순서

```bash
# 1) drizzle 번호본 전부 (0000 … 0024)
pnpm db:migrate

# 2) alpha 파일을 번호 순서대로 raw 실행 (아래 §5 목록 순서). 둘 중 하나:
#    (a) Supabase 대시보드 → SQL Editor에 파일 내용 붙여넣기, 또는
#    (b) node로 raw 실행 (파일 1개씩):
node --env-file=.env.local -e "const fs=require('fs');const sql=require('postgres')(process.env.DATABASE_URL,{ssl:'require',max:1});sql.unsafe(fs.readFileSync('supabase/migrations/0001a_rls_constraints_triggers.sql','utf8')).then(()=>{console.log('ok');return sql.end();}).catch(e=>{console.error(e.message);process.exit(1);});"

# 3) 시드(데모 테넌트)
pnpm db:seed
```

## 4. 현재 공유 DB 적용 상태 (검증: 2026-06-20)

공유 Supabase(데모 테넌트)에는 **번호본 0000~0027 + alpha `0001a`~`0040a` 전부 적용 완료**. 직접 조회로 확인:

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

새 alpha를 추가할 때: 다음 번호의 `000Na_*` 또는 `000Nb_*`로 만들고, 멱등 패턴을 지키고, **이 표에 추가**한다.
상세 흐름은 [`../../CLAUDE.md`](../../CLAUDE.md) "마이그레이션 & 시드 흐름" 참고.
