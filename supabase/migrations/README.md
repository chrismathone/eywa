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

## 4. 현재 공유 DB 적용 상태 (검증: 2026-06-17)

공유 Supabase(데모 테넌트)에는 **번호본 0000~0025 + alpha 전부 적용 완료**. 직접 조회로 확인:

- `pg_trgm` 확장 **설치됨**, `0024a`의 trigram GIN 인덱스 **11개 전부 존재**
  (students 5 · classes 2 · student_consultations 1 · enrollment_consultations 3).
- `reenrollment_campaign_targets` 테이블 + RLS **활성**(`0024`/`0024b`).
- **`0025` `textbook_orders`·`expenses` 테이블 + `0025a` RLS 활성**(수납관리 책갈피 교재/지출 면).
  `relrowsecurity=true` 확인, 데모 데이터 적재(교재 350·지출 95, `scripts/_poc_migration/import-textbooks-expenses.cjs`).
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

새 alpha를 추가할 때: 다음 번호의 `000Na_*` 또는 `000Nb_*`로 만들고, 멱등 패턴을 지키고, **이 표에 추가**한다.
상세 흐름은 [`../../CLAUDE.md`](../../CLAUDE.md) "마이그레이션 & 시드 흐름" 참고.
