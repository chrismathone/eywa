# 학부모 계정 · 등하원 변경 — Supabase 스키마 정리 (2026-10-01)

학부모 계정 · 등하원 변경 기능으로 Supabase(Postgres)에 **새로 만들었거나 바꾼 것 전부**다.
로컬 DB(마이그레이션 4개 적용 상태)에서 직접 읽어 만들었다 — 문서와 실제 DB가 어긋나지 않게.

- SQL 원문(그대로 실행 가능한 정의): [`supabase-schema.sql`](supabase-schema.sql) — 참고용 스냅샷이다. **실제 적용은 마이그레이션 파일로** 한다.
- 본서버 마이그레이션(브랜치 `윤여원/학부모-등하원-시스템`): `0320a_parent_accounts` → `0321a_shuttle_ride_exception_history` →
  `0322a_shuttle_regular_ride_change` → `0323a_shuttle_history_acks` (로컬 번호는 0290a~0293a). 전부 손으로 적용하는 alpha 파일이고 앱 배포보다 먼저.
- 10/7 추가(학부모 알림 · [저장]): `0368a_parent_departure_acks` → `0368b_parent_notice_key` → `0368c_boarding_notify_parent`
  (로컬 0294a~0294c) — [10/7 정리](../parent-ride-summary-2026-10-07.md). 아래 표·§1-추가·§5에 반영했다.
- 10/15 추가(차량 GPS): `0374a_shuttle_vehicle_positions`(로컬 0295a) — [10/15 정리](../parent-ride-summary-2026-10-15.md). 아래 표·§2-추가2·§4·§5에 반영했다.
- Drizzle `schema.ts`엔 **하나도 없다** — 앱은 Supabase 클라이언트로 읽고 쓴다(RLS·트리거·함수는 drizzle이 표현 못 해 alpha로만 둔다).

## 한눈에

| 구분 | 이름 | 마이그레이션 | 하는 일 |
|---|---|---|---|
| 새 표 | `parent_accounts` | 0320a | 학부모 로그인 계정 |
| 새 표 | `parent_account_students` | 0320a | 학부모 ↔ 원생 연결 |
| 새 표 | `shuttle_ride_exception_history` | 0321a | '그날만 변경' 이력 장부(추가만) |
| 새 표 | `shuttle_rider_history` | 0322a | '매주 고정' 변경 이력 장부(추가만) |
| 새 표 | `shuttle_history_acks` | 0323a | 변경 내역 '확인' 표식 |
| 새 표 | `parent_departure_acks` | 0368a·0368b | 학부모 알림(출발·탑승·미탑승·하차) '확인' 표식 — 학부모 계정마다 |
| 바꾼 표 | `shuttle_boardings` | 0368c | 칸 `notify_parent` — [전송]=true · [저장]=false |
| 새 표 | `shuttle_vehicle_positions` | 0374a | 운행 중 차량 최신 위치(기사 폰 GPS) — 회차마다 한 줄 |
| 바꾼 표 | `shuttle_ride_exceptions`(0229a) | 0321a | 칸 3개 + 제약 2개 + 이력 트리거 |
| 새 함수 | `shuttle_ride_exception_label` · `tg_shuttle_ride_exception_history` · `tg_shuttle_ride_exception_history_append_only` · `cancel_shuttle_ride_exception` · `change_shuttle_regular_ride` | 0321a·0322a | 아래 §3 |
| 바꾼 함수 | `tg_sync_user_from_auth`(0075a) | 0320a | 학부모 로그인은 직원 표로 복사하지 않음 |

## 1. 새 표

### `parent_accounts` — 학부모 로그인 계정
| 칸 | 타입 | 비우기 | 기본값 | 메모 |
|---|---|---|---|---|
| `id` | uuid | ✗ | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | ✗ | | → `tenants(id)` 지우면 함께 삭제 |
| `auth_user_id` | uuid | ✗ | | → `auth.users(id)` 지우면 함께 삭제 · **유일**(로그인 1개 = 학부모 1명) |
| `login_email` | text | ✗ | | `(tenant_id, login_email)` **유일** |
| `display_name` | text | ✗ | | 화면 이름("김민준 어머님") |
| `phone` | text | ○ | | |
| `status` | text | ✗ | `'active'` | `active` · `inactive`만(CHECK) |
| `created_at` · `updated_at` | timestamptz | ✗ | `now()` | `updated_at`은 수정 때 트리거(`tg_set_updated_at`)가 갱신 |

- 인덱스: `(tenant_id, status, created_at)`
- **RLS 켜짐** — 읽기 = 같은 학원 + **원장·관리자(master·admin) 또는 super_admin**만. 쓰기 정책 없음 = **서버(service_role)만** 쓴다.

### `parent_account_students` — 학부모 ↔ 원생
| 칸 | 타입 | 비우기 | 기본값 | 메모 |
|---|---|---|---|---|
| `tenant_id` | uuid | ✗ | | → `tenants(id)` 함께 삭제 |
| `parent_account_id` | uuid | ✗ | | → `parent_accounts(id)` 함께 삭제 |
| `student_id` | uuid | ✗ | | → `students(id)` 함께 삭제 |
| `relationship` | text | ✗ | `'parent'` | "어머니" 등 |
| `is_primary` | boolean | ✗ | `true` | 대표 보호자 |
| `created_at` | timestamptz | ✗ | `now()` | |

- PK `(parent_account_id, student_id)` · 인덱스 `(tenant_id, student_id)`
- RLS: `parent_accounts`와 같다(원장·관리자·super_admin 읽기, 쓰기는 서버만).

### `shuttle_ride_exception_history` — '그날만 변경' 이력 장부
`shuttle_ride_exceptions`(그날 하루 '여기서 탐'·'타지 않기')가 생기고·바뀌고·취소될 때마다 **트리거가 한 줄** 쓴다.

| 칸 | 타입 | 비우기 | 메모 |
|---|---|---|---|
| `id` | uuid | ✗ | PK |
| `tenant_id` · `exception_id` · `on_date` · `student_id` | uuid · uuid · date · uuid | ✗ | 어느 변경의 줄인지 |
| `student_name` | text | ○ | 그때의 이름 스냅샷 |
| `kind` | text | ✗ | `skip`(타지 않기) · `add`(여기서 탐) |
| `io_kind` | text | ✗ | `in` · `out` |
| `op` | text | ✗ | `create` · `update` · `cancel`(CHECK) |
| `before_run_stop_id` · `after_run_stop_id` | uuid | ○ | 전/후 노선 칸 |
| `before_label` · `after_label` | text | ○ | 전/후 **글자 스냅샷**("1호차 1회차 · 침산초 후문") — 노선을 나중에 고쳐도 그때 자리가 남는다. null = 평소대로 |
| `memo` | text | ○ | 사유 |
| `actor_kind` | text | ✗ | `staff` · `parent` · `system` |
| `actor_id` · `actor_name` | uuid · text | ○ | 누가 |
| `created_at` | timestamptz | ✗ | `clock_timestamp()`(한 트랜잭션 안 여러 줄의 순서를 지킨다) |

- 인덱스: `(tenant_id, student_id, on_date)` · `(tenant_id, created_at desc)`
- **추가만** — `UPDATE`·`DELETE`는 트리거가 거절한다(service_role도). FK 없음(지워지는 중에 트리거가 쓰므로).
- RLS: 같은 학원이면 읽기(역할 구분 없음). 쓰기는 트리거만.

### `shuttle_rider_history` — '매주 고정' 변경 이력 장부
| 칸 | 타입 | 비우기 | 메모 |
|---|---|---|---|
| `id` | uuid | ✗ | PK |
| `tenant_id` · `student_id` | uuid | ✗ | |
| `student_name` | text | ○ | 스냅샷 |
| `io_kind` · `weekday` | text | ✗ | 방향 · 요일(`mon`~`fri`) |
| `before_run_stop_id` · `after_run_stop_id` | uuid | ○ | |
| `before_label` · `after_label` | text | ○ | 글자 스냅샷. null = 그 요일 배정이 없었다 |
| `reason` | text | ○ | 사유 |
| `actor_kind` · `actor_id` · `actor_name` | text · uuid · text | `actor_kind`만 ✗ | 누가 |
| `created_at` | timestamptz | ✗ | `clock_timestamp()` |

- 인덱스: `(tenant_id, student_id, created_at desc)`
- **추가만**(위 장부와 같은 막는 함수) · RLS 같은 학원 읽기 · 쓰기는 `change_shuttle_regular_ride()`만.

### `shuttle_history_acks` — 변경 내역 '확인' 표식
관리자 '학부모 등하원' 화면에서 [확인]을 누른 장부 줄을 **화면에서만** 내린다. 장부 두 표는 추가만 되는 표라 손대지 않고 표식을 따로 쌓는다.

| 칸 | 타입 | 비우기 | 기본값 | 메모 |
|---|---|---|---|---|
| `id` | uuid | ✗ | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | ✗ | | |
| `history_kind` | text | ✗ | | `ride`(그날 장부) · `regular`(고정 장부) — CHECK |
| `history_id` | uuid | ✗ | | 확인한 장부 줄 id |
| `acked_by` · `acked_by_name` | uuid · text | ○ | | 누가 확인했나 |
| `acked_at` | timestamptz | ✗ | `now()` | |

- **유일 `(tenant_id, history_kind, history_id)`** — 앱이 이 축으로 upsert한다(그래서 부분 유니크 아님). 학원 공용 확인.
- RLS: 같은 학원 읽기 · 쓰기는 서버만.

### `parent_departure_acks` — 학부모 알림 '확인' 표식 (0368a · 0368b)
학부모 화면 위쪽 알림 줄의 [확인]. 알림 자체는 저장하지 않고 운행·탑승 기록에서 도출하고, 여기엔 **확인했다**는 사실만 쌓는다.

| 칸 | 타입 | 비우기 | 기본값 | 메모 |
|---|---|---|---|---|
| `id` | uuid | ✗ | `gen_random_uuid()` | PK |
| `tenant_id` | uuid | ✗ | | |
| `parent_account_id` | uuid → `parent_accounts(id)` **지우면 같이 삭제** | ✗ | | 확인은 학부모 계정마다(엄마가 확인해도 아빠 화면엔 남는다) |
| `ran_on` | date | ✗ | | 그날 |
| `run_id` | uuid | ✗ | | 회차 |
| `notice_key` | text | ✗ | `'depart'` | 0368b — `depart` · `board:<학생 id>` · `miss:<학생 id>` · `drop:<학생 id>` |
| `acked_at` | timestamptz | ✗ | `now()` | |

- **유일 `(tenant_id, parent_account_id, ran_on, run_id, notice_key)`** — upsert 축(부분 유니크 아님).
- RLS 켬 · **정책 없음** — 학부모 세션은 원래 아무 표도 못 읽는다. 서버(service_role)만 읽고 쓴다.

## 2. 바꾼 표 — `shuttle_ride_exceptions`(0229a)

| 더한 것 | 정의 | 왜 |
|---|---|---|
| 칸 `actor_kind` | text NOT NULL DEFAULT `'staff'` · CHECK `staff`·`parent`·`system` | 학부모가 바꾼 줄도 생긴다 — 기존 줄은 기본값으로 '직원' |
| 칸 `actor_name` | text | 화면·장부에 남길 이름 |
| 칸 `parent_account_id` | uuid → `parent_accounts(id)` **지우면 비움**(SET NULL) | 학부모 계정을 지워도 변경 줄은 남는다 |
| 트리거 `tg_shuttle_ride_exception_history` | AFTER INSERT · UPDATE · DELETE, 줄마다 | 이력 장부에 한 줄 |

⚠️ 기존 칸·제약은 안 건드렸다. 취소(줄 삭제)는 `cancel_shuttle_ride_exception()`으로 해야 장부에 "누가 취소했는지"가 남는다(직접 지우면 '자동 정리'로 남는다).

### 2-추가. 바꾼 표 — `shuttle_boardings` (0368c)

| 더한 것 | 정의 | 왜 |
|---|---|---|
| 칸 `notify_parent` | boolean NOT NULL DEFAULT `true` | 셔틀 [전송]=true(학부모 알림) · 등원 [저장]=false(기록만). 기존 줄은 기본값으로 알림 대상 |

### 2-추가2. 새 표 — `shuttle_vehicle_positions` (0374a) — 차량 최신 위치

운행 중(`shuttle_trips` 출발~종료) 기사 폰 브라우저가 보낸 GPS. **회차마다 최신 한 줄만**(upsert) — 지나온 자취(이력)는 두지 않는다.

| 칸 | 형 | null | 기본값 | 뜻 |
|---|---|---|---|---|
| `id` | uuid | ✗ | `gen_random_uuid()` | |
| `tenant_id` | uuid | ✗ | | 학원(`tenants` cascade) |
| `ran_on` | date | ✗ | | 운행 날짜(KST) |
| `run_id` | uuid | ✗ | | 회차(`shuttle_runs` cascade) |
| `lat` · `lng` | double precision | ✗ | | 범위 check(-90~90 · -180~180) |
| `accuracy_m` · `heading` · `speed_mps` | double precision | ✓ | | 폰이 알려 준 오차(m) · 방향(북=0°) · 속도(m/s) |
| `measured_at` | timestamptz | ✓ | | 폰이 잡은 시각(기기 시계) |
| `received_at` | timestamptz | ✗ | `now()` | 서버가 받은 시각 — 화면의 "N초 전" 기준 |
| `sent_by` | uuid | ✓ | | 보낸 직원(`users` set null) |

- 유니크 `shuttle_vehicle_positions_day_run_uniq (tenant_id, ran_on, run_id)` — 이 축으로 upsert(부분 인덱스 아님, [[#113]]).
- 서버는 **오늘 출발했고 종료 전인 회차**에만 받고, 오차 300m 넘는 값은 버린다. 화면은 종료된 회차의 위치를 그리지 않는다.

## 3. 함수

| 함수 | 인자 → 반환 | 권한 · 보안 | 하는 일 |
|---|---|---|---|
| `shuttle_ride_exception_label` | `(p_kind text, p_run_stop_id uuid)` → text | invoker · 누구나 실행 | "1호차 1회차 · 침산초 후문" / "이날 안 탐" 글자 만들기 |
| `tg_shuttle_ride_exception_history` | 트리거 | **definer** | 변경 줄의 전/후를 장부에 쓴다 |
| `tg_shuttle_ride_exception_history_append_only` | 트리거 | invoker | 장부 두 표의 수정·삭제를 거절 |
| `cancel_shuttle_ride_exception` | `(p_tenant_id, p_id, p_actor_kind, p_actor_id, p_actor_name)` → boolean | **definer · service_role만** | 변경 줄을 지우면서 취소한 사람을 장부에 넘긴다 |
| `change_shuttle_regular_ride` | `(p_tenant_id, p_student_id, p_io_kind, p_weekday day_of_week, p_run_stop_id, p_reason, p_actor_kind, p_actor_id, p_actor_name)` → text(`same`·`changed`) | **definer · service_role만** | 한 트랜잭션으로 그 요일 하나만 옮기고(빼기 → 새 칸에 더하기) 이력을 남긴다 |
| `tg_sync_user_from_auth` **(다시 정의)** | 트리거 — `auth.users` INSERT·UPDATE | definer | 0075a와 같은 로직 + `app_metadata.account_type = 'parent'`인 로그인은 **직원 표(users)로 복사하지 않는다** |

🔴 `tg_sync_user_from_auth`는 모든 로그인 계정이 지나는 **공용 함수**다. 본서버엔 0075a 뒤로 이 함수를 바꾼 마이그레이션이 없음을 확인했다(2026-09-30). 앞으로 이 함수를 고치는 사람은 **parent 갈래를 꼭 유지**해야 한다 — 빠지면 학부모가 직원 목록·권한에 섞인다.

## 4. 누가 무엇을 할 수 있나

| 표 | 읽기(로그인한 사람, RLS) | 쓰기 |
|---|---|---|
| `parent_accounts` · `parent_account_students` | 같은 학원의 원장·관리자·super_admin | 서버만(학부모 계정 발급·삭제 화면) |
| `shuttle_ride_exception_history` · `shuttle_rider_history` | 같은 학원 누구나(역할 구분 없음) | 트리거 · `change_shuttle_regular_ride()`만, 수정·삭제 불가 |
| `shuttle_history_acks` | 같은 학원 누구나 | 서버만([확인] 버튼 — 등하원 기록 권한자) |
| `shuttle_ride_exceptions`의 새 칸 | 기존 정책 그대로 | 기존 그대로 + 학부모 저장은 서버가 대신 쓴다 |
| `shuttle_vehicle_positions` | 같은 학원 누구나(직원) | 서버만 — 등하원 기록 권한자(셔틀 담당·사무실·총괄)가 운행 중 회차에. 학부모 화면은 서버가 **우리 아이 회차만** 골라 준다 |

- 학부모 세션은 RLS로 **아무 표도 직접 못 읽고 못 쓴다** — 학부모 화면은 서버가 연결된 아이·날짜·자리를 다시 확인한 뒤 service_role로 읽고 쓴다.
- ⚠️ 장부·확인 표 읽기는 역할을 가리지 않는다(같은 학원이면 강사·뷰어도 API로 읽을 수 있다). 화면은 직원 전용 화면에서만 보여 준다. 더 좁히려면 정책에 역할 조건을 더하면 된다.

## 5. 되돌리기 (역순)

```sql
-- 0374a
drop table if exists public.shuttle_vehicle_positions;
-- 0368c
alter table public.shuttle_boardings drop column if exists notify_parent;
-- 0368b · 0368a
drop table if exists public.parent_departure_acks;
-- 0323a
drop table if exists public.shuttle_history_acks;
-- 0322a
drop function if exists public.change_shuttle_regular_ride(uuid, uuid, text, public.day_of_week, uuid, text, text, uuid, text);
drop table if exists public.shuttle_rider_history;
-- 0321a (마이그레이션 머리 주석의 되돌리기 + 막는 함수 drop 한 줄 — 머리 주석엔 그 한 줄이 빠져 있다)
drop trigger if exists tg_shuttle_ride_exception_history on public.shuttle_ride_exceptions;
drop function if exists public.tg_shuttle_ride_exception_history();
drop function if exists public.cancel_shuttle_ride_exception(uuid, uuid, text, uuid, text);
drop function if exists public.shuttle_ride_exception_label(text, uuid);
drop table if exists public.shuttle_ride_exception_history;
drop function if exists public.tg_shuttle_ride_exception_history_append_only();
alter table public.shuttle_ride_exceptions drop column if exists actor_kind, drop column if exists actor_name, drop column if exists parent_account_id;
-- 0320a
drop table if exists public.parent_account_students;
drop table if exists public.parent_accounts;
-- tg_sync_user_from_auth는 0075a 파일의 정의를 다시 실행해 되돌린다
```
