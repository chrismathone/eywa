# 출결 강사 귀속 배선 감사 — "ECS에서 찍은 출결이 담임 출결로 잡힌다" (2026-08-18)

원장 제보: *"영어 강사 시트(ECS)에서 출결하면 **출결한 선생님의 출석부**에 출결되는 게 아니라
**담임 출결로 인정**되고 있는 것 같은데 배선 체크."*

> 결론 한 줄: **쓰기는 멀쩡했고, 결함은 읽기·스코프 층이었다.** 출석부의 강사 축이 `classes.teacher_id`
> (담임) **하나뿐**이라, 교시(시간표 슬롯) 담당으로 실제 수업을 한 강사에게는 그 반이 **아예 안 보였다**.
> 축을 순수함수 한 곳(`src/features/attendance/teacher-axis.ts`)으로 모으고 표시·스코프 소비처를 전부
> 거기에 배선했다. **돈(정산액·급여명세서)의 축은 담임 그대로 두었다** — 아래 §5에 이유와 남은 위험.

---

## 1. 축은 셋이다

| # | 축 | 뜻 | 채워지는 시점 |
|---|---|---|---|
| ① | `classes.teacher_id` | **반 담임**(반 전체의 대표 1명) | 반 생성·수정 |
| ② | `class_schedules.teacher_id` | **그 교시 담당**(요일×시각×유효기간 단위) | 시간표 편성 |
| ③ | `attendance_records.recorded_by` | **입력한 사람**(데스크가 대신 찍으면 데스크) | 출결 저장 |

`attendance_records`에는 "이 출결이 누구 수업이었나"를 담는 컬럼이 **없다**. 강사는 항상 밖에서 유도된다.

### 실측 — ③은 귀속이 아니다 (2026-08-01 이후, SELECT만)

| 입력자 | 역할 | 교시별 기록 | 담임 반 | 기록이 걸린 반 |
|---|---|---:|---:|---:|
| 김동후 | admin | 1,138행 | **0개** | 18개 |
| 정유진 | admin | 8행 | 2개 | 2개 |

→ 영어 출결은 사실상 한 사람이 대신 찍는다. `recorded_by`는 **정확히 로그인 사용자**가 들어가고 있고
(담임으로 덮이지 않는다), 그래서 **급여·집계 축으로 쓸 수 없다**.

### 실측 — ②와 ①은 자주 다르다

같은 1,146행을 (반·요일·시각·유효기간)으로 되짚으면:

| 갈래 | 행 수 | 반 |
|---|---:|---:|
| 교시 담당 = 담임 | 633 | 17 |
| 교시 담당 미지정(자리 LAB·JJ 포함) → 담임 폴백이 정답 | 315 | 18 |
| **교시 담당 ≠ 담임** | **198** | **10** |
| 매칭 실패(시간표에 없는 날) | 0 | – |
| 모호(같은 칸에 담당 둘) | 0 | – |

담임 ≠ 교시 담당 상위 예 (2026-08):

| 반 | 교시 | 화면에 잡히던 사람(담임) | 실제 교시 담당 | 행 |
|---|---|---|---|---:|
| 중고E_중1 의치대 | 17:20 | 정유진 | 이다교 | 28 |
| 중등E_초6 의치대 | 16:20 | 정유진 | 김태건 | 24 |
| 중등E_초6 의치대 | 17:20 | 정유진 | 이현이 | 24 |
| 중고E_중2 특별 | 19:20 | 전양원 | 이현이 | 13 |
| 중등E_초등 브릿지 D | 17:20 | 전양원 | KRISTINE DRIVER | 11 |

> 브리핑이 말한 *"같은 `(class_id, start_time)`에 teacher_id가 다른 행이 2~3개"*의 정체는
> **요일마다 담당이 다른 것**이었다. 예: `중등E_초6 의치대` 16:20 = 화 정유진 / 수 김태건 / 금 정유진.
> **요일 + 유효기간까지 넣으면 오늘 데이터에서 모호는 0건**이다(그래도 규칙은 아래 §4에 못박았다).

---

## 2. 배선 전수 — 어느 화면이 어느 축을 쓰나

### (a) 쓰기 — 문제 없음

| 지점 | 파일 | 축 |
|---|---|---|
| ECS 시트 출결 | `features/class-sheets/components/sheet-client.tsx` `setAttendance` → `setAttendanceCell` | ③ `recorded_by = user.id` (+ `slot_start`) |
| 출석부 격자·원스크린·당일 출결 | `features/attendance/server/actions.ts` (`setAttendanceCell`/`Bulk`/`Range`) | 같음 |
| 키오스크·자리 | `kiosk/server/checkin.ts`(`recorded_by=null`) · `seat/server/actions.ts` | 같음 |
| 쓰기 권한 게이트 | `live/server/write-policy.ts` `userTaughtClassSet` | ① ∪ 위임 ∪ ② — **이미 옳음** |

→ **가설 확인**: 쓰기는 담임으로 덮이지 않는다.

### (b) 읽기·스코프 — 여기가 결함이었다

| 지점 | 파일 | 고치기 전 | 고친 뒤 |
|---|---|---|---|
| 월간 출석부 반 목록·강사 스코프 | `attendance/server/queries.ts` `getMonthlyAttendanceMatrix` | **① 만** (`.eq("teacher_id", tId)`) | ① ∪ ②(그 달 유효) |
| 강사 드롭다운 선택지 | `app/(shell)/attendance/page.tsx` | ① 만 | ① ∪ ② |
| 강사 전체 보기 반 묶음 | 같음 `teacherClasses` | ① 만 | ① ∪ ② + 반 머리행에 「교시 담당」 표식 |
| 요약 허브 강사 카드 | 같음 `buildHubTeachers` | ① 만 | ① ∪ ② |
| 당일 출결 보드 스코프 | `live/server/queries.ts` | ① ∪ 위임 ∪ ② — 이미 옳음 | 유지 |
| 당일 출결 슬롯 귀속 | `live/server/load.ts:303` | 규칙은 옳으나 **인라인 복제** | `taughtByForSlot`(축 모듈) 호출 |
| ECS 접근·랜딩 | `class-sheets/server/access.ts` | ① ∪ ② ∪ 위임 — 이미 옳음 | 유지 |
| 원스크린(강사 홈) 로스터 | `onescreen/server/roster.ts` | ① ∪ 위임 | **유지**(§6 남은 갭) |
| 대시보드 미기록 신호 | `dashboard/server/action-signals.ts` `recordedByClass` | 축 아님(학생 기록 유무) | 해당 없음 |

### (c) 돈

| 지점 | 파일 | 축 |
|---|---|---|
| 출석부 하단 정산액·청구/납입 열 | `attendance/server/teacher-money.ts` → `payroll/server/tier-rows.ts` | **① 담임** (`classIds` = 담임 반) |
| 급여명세서 | `payroll/server/payslip-queries.ts` | **① 담임** (`.eq("teacher_id", …).eq("is_active", true)`) |
| 강사 정산(splits) | `payroll/server/settlement-queries.ts` | `invoice_teacher_splits.teacher_id`(반 담당 스냅샷) |

---

## 3. 실데이터로 본 효과 (SELECT 시뮬레이션, 2026-08 기준)

「출석부 강사 축에 보이는 활성 반 수」 — 고치기 전(담임) → 후(담임 ∪ 그 달 교시 담당):

| 강사 | 전 | 후 |
|---|---:|---:|
| **Florence Park** (system_role=teacher) | **0** | **5** |
| 이현이 | 3 | 13 |
| KRISTINE DRIVER | 3 | 11 |
| 김태건 | 4 | 8 |
| 육소희 | 4 | 8 |
| 이다교 | 4 | 7 |
| 정유진 | 2 | 5 |
| 전양원 · 유형숙 | 7 | 8 |
| 김윤하 9·김은정 8·이성우 10·이수진 10·남정화 9·김주현 4·정은지 6·추민아 6·허은진 8 | 그대로 | 그대로 |

🔴 **Florence Park는 출석부가 통째로 비어 있었다**(담임 반 0개·교시 담당 5반). 강사 드롭다운에
**이름조차 없었다**.

🔴 **담임이 없는 활성 반 5개**는 어떤 강사의 출석부에도 안 잡혔다. 그중 `중등E_초5 의치대`는 8월에만
**출결 12건**이 실제로 있다(이현이·전양원·정유진이 교시 담당). 이제 그 세 사람에게 보인다.

✅ **수학은 완전 불변**: 8월에 유효한 수학 슬롯 237개 중 234개가 담당 미지정이라 담임 폴백이 그대로다.
나머지 3개(`고등M 개별 BS4F` 화·금 19:15, 담임 이성우 / 교시 담당 유형숙, 08-04 종료)만 유형숙 화면에
추가된다 — 실제로 그가 맡던 교시다.

---

## 4. 고친 방식 — 축 단일 소스

`src/features/attendance/teacher-axis.ts` (순수 · Vitest 23) — DB 의존 0, 조회는
`server/teacher-axis-queries.ts`가 맡는다.

**`resolveTaughtBy` = 출결 한 건의 귀속**

1. 그 **날짜에 유효한**(`valid_from ≤ 날짜 ≤ valid_to`) 슬롯 중 **요일**(+교시 지정 시 시각) 일치분을 고른다.
2. 후보 0개 → **담임**(시간표에 없는 날 = 보강이 여기로 온다).
3. 후보가 전부 **자리(LAB·JJ)** → **`seat`(null)**. 🔴 담임으로 폴백하지 않는다 — 담임이 하지 않은 수업이
   담임 시수로 잡힌다(0208a가 자리 출결을 정산 분모에서 뺀 것과 같은 이유).
4. 자리를 뺀 후보의 담당이 **유일** → 그 사람(`slot`).
5. 담당이 **서로 다름** → **`ambiguous`(null)**. 🔴 한쪽을 임의로 고르지 않는다 — 남의 수업이 그 사람
   급여·출석부에 붙는다. (오늘 데이터에서 0건이지만 규칙으로 잠갔다.)
6. 후보는 있는데 담당이 전부 미지정 → **담임**.

**`classTeacherIdsInRange` = 가시성(스코프)** — 귀속과 **일부러 다르다**. 귀속은 한 건에 한 사람이라
모호하면 비워야 하지만, "누구 출석부에 이 반이 보여야 하나"는 **한 사람이라도 가르치면 보여야** 한다.
그래서 담임 ∪ (기간에 겹치는) 교시 담당 **합집합**이다.

**`taughtByForSlot`** — 이미 (요일·날짜·교시)로 좁혀진 단건판. 당일 출결 보드가 인라인으로 갖고 있던
`special ? slot.teacher_id : (slot.teacher_id ?? klass.teacher_id)`를 이걸로 바꿨다(동작 동일, 규칙 1벌).

가드: `teacher-axis-single-source.test.ts` — 소비처가 축 모듈을 import하는지, 인라인 폴백/SQL 담임 필터가
되살아나지 않는지, **돈 경로는 축 모듈을 안 거치는지**(의도적 예외)를 구조 스캔으로 잠근다.

### 스키마를 안 건드린 이유

`attendance_records.taught_by` 컬럼을 새로 두는 안을 검토했고 **채택하지 않았다**:

- **유도로 충분하다.** `class_schedules`는 2026-08-04 결정으로 **행 분할(이력 보존)** 이라 지난 날짜의
  담당이 그대로 살아 있다. 실측 커버리지(2026-07-03~): 영어 교시별 1,702행 중 **매칭 실패 0 · 모호 0**,
  1,246행이 유일 담당·456행이 담당 미지정(담임/자리 폴백).
- **과거 행은 백필할 근거가 없다**([[#93]] — 모르면 null이 정직하다). 컬럼을 만들어도 옛 행은 결국 유도로
  읽어야 하므로 유도 경로는 **없앨 수 없고 추가만** 된다.
- **매일 쓰는 경로에 새 컬럼을 넣지 않는다**([[#95]]). 앱이 SQL보다 먼저 배포되면 출결 저장·출석부 조회가
  통째로 죽는다. 이번 변경은 **마이그레이션 0** 이라 배포 순서 제약이 없다.

> 다시 검토할 신호: 보강·임시 대강이 잦아져 "시간표에 없는 날"의 귀속이 실제로 갈리기 시작하면
> 그때 `taught_by`(nullable·백필 없음·읽기 폴백)를 얹는다.

---

## 5. 🔴 돈 — 지금은 안 틀렸지만, 축이 다르다

**금액·정산액·급여명세서는 담임 축 그대로 두었다.** 근거:

- 티어 정산(0199a)은 `enrollments.salary_tier`가 있어야 도는데, **티어가 지정된 반은 수학 프리랜서 4인
  (김윤하·김은정·이수진·이성우)뿐**이다. 영어는 티어 지정 0건 → `collectTierRows`가 `null`을 돌려
  정산액이 `unwired`로 접힌다. **즉 오늘 영어 쪽 금액이 잘못 나가고 있지는 않다.**
- 그 4인의 수학 반은 8월 유효 슬롯 234/237이 담당 미지정이라 **담임 = 유일한 정답**이다. 축을 바꿔도
  숫자가 같다(= 지금 바꿀 이득이 0인데, 골든마스터·시트 대조 4인은 위험에 노출된다).
- 기존 결정이 명시적이다: `teaching-scope-single-source.test.ts` 주석 *"돈은 담임을 따라간다"*,
  `payslip-queries.ts` *"출석부 정산액이 쓰는 것과 같은 반 집합이라야 금액이 일치한다"*.

**그래서 대신 한 일**: 표시 축이 넓어진 만큼 금액이 **덜 담긴다**는 사실을 화면에 밝힌다 —
출석부 합계 줄에 `금액·정산액은 담임 반 N개 기준 — 교시 담당 M개 반은 빠져 있습니다`(원장 전용 금액
보기에서만). 조용히 다른 집합을 합산하지 않는다.

### ⚠️ 남은 위험(원장 결정 필요)

영어를 시수·티어 기반 급여로 돌리는 순간, **8월 기준 198행(198시수)** 이 교시를 실제로 맡은 강사가 아니라
담임에게 붙는다. 그때 필요한 것은 이 감사의 범위 밖이다:

- `tier-rows.ts`의 시수 집계를 **반 축 → 교시 축**으로 바꾸기(`attendance_records.slot_start` × 교시 담당).
- `invoice_teacher_splits`를 교시 단위로 확장.
- 둘 다 `src/features/billing/golden/` 골든마스터가 게이트다 — **숫자가 왜 달라지는지 설명이 먼저**.

---

## 6. 남은 갭(이번에 손대지 않음)

1. **월간 격자는 학생×날짜라 교시별로 못 가른다.** 교시 담당 강사에게도 그 반의 **모든 교시**가 한 칸에
   합산돼 보인다(0196a `slots`는 하루 2교시 이상인 칸의 줄무늬·툴팁에만 쓰인다). 반 머리행의 「교시 담당」
   표식이 그 사실을 밝힌다. 칸을 교시로 쪼개려면 격자 모델 자체를 바꿔야 한다.
2. **원스크린(강사 홈) 로스터는 여전히 담임 ∪ 위임**이다. 영어 전담 강사는 규칙상 ECS로 착지하므로
   (`teacher-home-rule.ts`) 지금은 증상이 없지만, **겸업(영어+수학) 강사**의 영어 교시 반은 원스크린에
   안 뜬다. 원스크린은 "보고서 마감" 화면이고 매일 도는 핫패스라 별건으로 둔다.
3. **요약 허브의 '오늘 현황'은 반 단위**라, 교시 담당이 여럿인 반은 그 사람들에게 각각 한 번씩 세어진다
   (반을 교시로 쪼개 세면 담임 화면의 종전 숫자가 흔들린다 — 여기서는 "내가 오늘 볼 반"이 맞다).

---

## 부록 — 재현 쿼리 (읽기 전용)

```sql
-- 교시별 출결의 실제 담당 vs 담임 (요일·유효기간까지 반영)
with ar as (
  select ar.id, ar.class_id, ar.session_date, ar.slot_start,
         c.class_name, c.teacher_id as homeroom,
         (array['mon','tue','wed','thu','fri','sat','sun'])
           [extract(isodow from ar.session_date)::int]::day_of_week as dow
  from attendance_records ar join classes c on c.id = ar.class_id
  where ar.slot_start is not null and ar.session_date >= '2026-08-01'
), m as (
  select ar.*, array_remove(array_agg(distinct cs.teacher_id), null) as slot_teachers
  from ar left join class_schedules cs
    on cs.class_id = ar.class_id and cs.day_of_week = ar.dow and cs.start_time = ar.slot_start
   and cs.valid_from <= ar.session_date and (cs.valid_to is null or cs.valid_to >= ar.session_date)
  group by ar.id, ar.class_id, ar.session_date, ar.slot_start, ar.class_name, ar.homeroom, ar.dow
)
select class_name, to_char(slot_start,'HH24:MI') as 교시,
       h.display_name as 담임, s.display_name as 교시담당, count(*) as 행
from m left join users h on h.id = homeroom left join users s on s.id = slot_teachers[1]
where cardinality(slot_teachers) = 1 and slot_teachers[1] <> homeroom
group by 1,2,3,4 order by 5 desc;
```
