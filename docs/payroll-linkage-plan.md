# 급여 연계 (splits → 강사 정산) — 설계 확정 문서

> **2026-09-16 추가 결정:** EiE는 회차에 관계없이 확정한 월 수강료(기본 270,000원) × 0.911 × 배분율로 정산한다. `pricing_mode=monthly`인 분배 행은 확정액과 정산 기준액이 같으며, 출석·요일 비례 안분을 하지 않는다. 기존 회당 산식과 확정 기록은 보존한다. 구현·설정 경로는 [공통 단가·월 정액 결정](per-session-billing-plan.md)을 참고한다.

> 2026-07-17 원장 결정(AskUserQuestion 4/4). 로드맵 "쏙쏙 이전"의 최종 잔여 단계.
> ⚠️ **이 문서는 설계다. 구현·마이그레이션·`PAYROLL_ENABLED` 전환은 원장 별도 승인 후.** 그 전엔 이 문서만 진실.
> 배경: [`per-session-billing-plan.md`](per-session-billing-plan.md) 로드맵 2단계(b) splits 완료 → 그 확정치를 강사 급여에 연계.
> 근거 조사 = 4갈래 병렬 전수(aywa 급여 인프라·attendance 정산모델·splits 브릿지·프로덕션 데이터, 2026-07-17).

## ⚠️ 넘는 결정 3개 (이 단계가 크로스하는 기존 확정)

1. **급여 = 2026-07-07 원장이 비활성**(`PAYROLL_ENABLED=false`) — 그 결정을 넘는다. 단, 기존 급여는 **시간 기반**(월기본+시급×시간)이라 splits와 무관 → 이건 재활성이 아니라 **새 매출배분 모델 신설**이다.
2. **splits는 "기록·대사용"으로 출시**(급여 미연계 명시) — 이 단계가 그 경계를 넘는다.
3. **돈-결합 게이트 N6**: 돈 산식 변경은 골든마스터([`src/features/billing/golden/`](../src/features/billing/golden/golden.test.ts)) 통과가 머지 조건 — 급여 계산도 이 게이트 적용.

## 원장 결정 (2026-07-17)

| # | 결정 | 선택 | 함의 |
|---|---|---|---|
| A | 급여 모델 | **강사마다 다름(개별)** | `users.salary_type`(비율제/급여제/혼합) + `commission_rate` 신설. 인재원 = 친인척 고정급·파트타임 비율제 혼재라 개별이 현실적 |
| B | 지급 기준액 | **청구 기준 `confirmed_amount`** | 확정 회차×단가(학부모 청구값). 안정적·청구서 일치. `actual_amount`/diff는 **검토 신호로만 표시**(자동 조정 없음, N2) |
| C | 도입 방식 | **단계적 — v1 읽기전용 참고화면** | v1은 `payroll_records` 자동기록·`PAYROLL_ENABLED` 전환 **없음**. 원장이 숫자를 눈으로 검증하는 조회 화면부터 |
| D | 대상 범위 | **수업하는 모든 직원** | role 무관, 담당 반 있으면 대상. 겸직 admin/manager 포함(김민주 admin 54반 등). **`teacher_id` 귀속**(동명이인 김태건 2명 분리) |

**제 기본값(원장 미지정 → 안전값으로 확정, 뒤집기 가능):**
- **인센티브·성과급 티어 = v1 미이식**(수동 보너스/공제만). 블로그 인센티브·성과급 배율은 마케팅 계열이라 aywa 12메뉴 정체성 밖.
- **열람 = 원장(master) 전용**(현행 급여 페이지·PII 정책 일치. `hourly_rate`/급여는 AI 금지 PII).
- **재계산 = 확정 시 스냅샷 동결**. 지난달 출석 수정해도 지급된 급여 불변, **새 초안만** 뜬다(코드 전반 돈 규율 일치).
- **수수료(인재원 0.911) = v1 미도입**. 배분율(`commission_rate`)에 흡수(원장이 수수료 뺀 net %로 입력). 필요 시 Phase 2에서 `academyFee` 분리.

## v1 범위 (읽기전용 정산 참고)

### 데이터 모델 (설계 — 착수 시 마이그레이션)

```sql
-- users에 급여 정책 2필드 (강사별 개별)
alter table users
  add column salary_type text,                 -- 'commission'|'fixed'|'hybrid' | null(미설정)
  add column commission_rate numeric(5,2);      -- 배분율 % (commission/hybrid). null=미설정
-- 고정급/기본급은 기존 users.monthly_base 재사용(fixed=월급, hybrid=기본급).
-- ⚠️ salary_type CHECK 제약 + commission_rate 0~100 범위.
```
- **신규 테이블 없음**(v1). 정산 참고는 `invoice_teacher_splits`(0117a) + `users` 급여정책을 **순수함수로 조합해 화면에서만** 산출 → 저장 0(읽기전용). `payroll_records`는 v1에서 안 건드림.

### 순수 계산 엔진 (Vitest + 골든마스터)

```
computeTeacherSettlement(splitsRows[], comp) → 강사×기간 정산 참고
  where comp = { salaryType, commissionRate, monthlyBase }
```
- **비율제(commission)**: `산정급여 = round(Σ confirmed_amount × commission_rate/100)` — 담당 반 청구 총액의 %.
- **급여제(fixed)**: `산정급여 = monthlyBase` (splits와 무관, 매출 배분 0).
- **혼합(hybrid)**: `산정급여 = monthlyBase + round(Σ confirmed_amount × commission_rate/100)`.
- **미설정(salaryType=null)**: 산정 보류 — "급여 방식 미설정" 표시(0으로 지어내지 않음, N4).
- **동결 스냅샷 소비**: splits의 `teacher_id`·`teacher_name`·`confirmed_amount`를 읽음(저장 시점 담당 강사 — 퇴직·개명 후에도 그달 급여 불변).
- **미배정 가시화**: `teacher_id` 없는 splits 행은 "미배정" 그룹으로 표시(급여 대상 아님, 조용히 드랍 금지, N4).
- **R3 불변**: `confirmed_amount`와 `actual_amount`는 **절대 합산 금지**. 급여 기준은 confirmed 단일, actual은 diff 신호로만 병기.
- **반올림 규율**: 행 단위 계산 후 최종 정수 반올림(골든마스터 파일 픽스처로 고정).

### UI (읽기전용)

- **급여정책 입력**(master 전용): 직원 상세에 `salary_type` + `commission_rate`(+기존 `monthly_base`) 편집. `saveOwnerSection` 패턴 아닌 직원 편집 경로 확장, `canManageStaff` 게이트 + 급여 PII 노출 규율.
- **정산 참고 화면**(master 전용): 기간 선택 → 강사별 1행(담당 반 수·confirmed 총액·적용 배분율·**산정 급여**·actual 대비 diff 신호). `teacher_id` 그룹. 저장 버튼 없음(참고). 위치 후보 = `/staff` 하위 새 면 또는 `/billing` 정산 탭 확장(구현 시 결정).

### 불변 규칙 (attendance R1~R6 + 청구 N-rules 이식)

| # | 규칙 | 근거 |
|---|---|---|
| P1 | 지급 기준 = `confirmed_amount`만. actual/diff는 신호(자동 조정 없음) | 청구 N1·N2 |
| P2 | confirmed·actual **합산 절대 금지** | R3 / +60.5M 이중계상 사고 |
| P3 | 강사 귀속 = `teacher_id`(이름 그룹 금지) | 동명이인 김태건 2명 |
| P4 | 매칭 실패·미배정·미설정은 **가시화**(조용한 스킵/0 지어내기 금지) | R4·N4 / 실급여 0원 사고 |
| P5 | 급여 산식 변경 = **골든마스터 통과** 필수 | N6 / attendance R2 |
| P6 | 열람 = 원장 전용. 급여 필드 = PII(activity_log 마스킹) | 현행 급여·PII 정책 |

## Phase 2 — payroll_records 자동 초안 (설계 확정, 2026-07-17)

v1은 강사 정산을 **화면에서만** 산정(저장 0). Phase 2는 그 산정값을 **`payroll_records`에 급여 초안으로 물질화**하고,
사람이 **확정→지급**하는 흐름을 붙인다. 핵심은 **스냅샷 동결**: 초안은 재계산되지만 확정본은 불변(지난달 출석 수정이
이미 확정·지급된 급여를 조용히 바꾸지 못하게 — 코드 전반 돈 규율·attendance R2 사고 방지).

### 상태 3단계 (초안 → 확정 → 지급)

- **초안(draft)**: `locked_at IS NULL`. splits/급여정책이 바뀌면 **재생성 시 갱신**(확정본 불가침 upsert, `refreshPlannedTerms` 패턴). 화면 라이브 산정(v1)과 동일 숫자.
- **확정(locked)**: `locked_at` 설정. **동결** — 이후 splits/comp가 바뀌어도 숫자 불변. 화면은 확정본 + **드리프트 배지**(현재 산정과 다르면 "재확정 필요", splits 지문 비교). 재확정 = 새 스냅샷.
- **지급(paid)**: `paid_at` 설정(기존 `markPayrollPaid` 재사용). locked 이후에만 가능.

> ⚠️ 기존 파생 status(`paid_at`→paid / record존재→saved / 무record→draft)에 **locked 단계 추가**. saved=초안, locked=확정으로 재정의.

### 스키마 — payroll_records 확장(신규 테이블 없음)

```sql
-- 기존 payroll_records(월기본+시급 시간모델)에 매출배분 라인 추가 — 강사×기간 1행 유지(unique 그대로).
alter table payroll_records
  add column salary_type text,              -- 확정 시점 급여방식 스냅샷(commission/fixed/hybrid)
  add column commission_base_amount numeric(12,0), -- 배분 기준액 = Σ confirmed_amount(청구 기준, P1)
  add column commission_rate numeric(5,2),  -- 확정 시점 배분율 % 스냅샷
  add column commission_amount numeric(12,0),-- 배분액 = round(base × rate). fixed=0
  add column source_period text,            -- 배분이 읽은 splits 청구월(보통 = period)
  add column splits_fingerprint text,       -- 확정 시점 splits 지문(드리프트 감지)
  add column locked_at timestamptz,         -- 확정(동결) 시점. null=초안
  add column locked_by uuid references users(id) on delete set null;
-- total 재정의: base_amount + hourly_amount + commission_amount + bonus − deduction (commission은 가산·대체 아님).
```

- **⚠️ PII redact 필수**: `commission_base_amount`·`commission_rate`·`commission_amount`를 **activity_log 트리거 redact 목록에 추가**(신규 마이그). 0084a가 base/hourly/bonus/deduction/total은 redact하나 신규 3컬럼은 누출(급여=원장 전용, 0120a와 동일 이유). `salary_type`은 users용으로 0120a에 이미 있음(공용 blocklist라 payroll_records에도 적용됨).

### 순수 엔진 (Vitest + 골든마스터)

- `payrollTotal` **확장**: `base + hourly + commission + bonus − deduction`(현재 4항 → commission 5항째). 골든마스터에 commission 포함 케이스 추가.
- `buildPayrollDraft(settlement, existingRecord)`: v1 `computeTeacherSettlements` 결과 + 기존 수동필드(bonus/deduction/base/hourly) 병합 → 초안 payload. **확정(locked)본은 건드리지 않음**(불가침).
- 드리프트 = `splitsFingerprint`(v1 재사용) 비교. 확정본 지문 ≠ 현재 → "재확정 필요".

### 액션 (전부 master 전용 — 급여 PII)

- `generatePayrollDrafts(period)`: 그 기간 산정된 강사 전원의 초안을 **upsert**(확정본 불가침, 미확정만 갱신). 미설정·미배정·회차 미확정 강사는 초안 생성 안 함(가시화). 멱등.
- `lockPayroll(userId, period)`: 초안 → 확정(locked_at·locked_by·splits_fingerprint 스냅샷).
- `unlockPayroll` / `markPayrollPaid`(기존): 확정 해제(지급 전만) / 지급.
- ⚠️ 확정·지급본은 auto-generate가 **덮지 않음**(스냅샷 불변). 드리프트는 배지로만.

### 배치(placement) — ⚠️ 결정 필요 (원장)

Phase 2 급여 초안 생성·확정·지급 UI를 **어디에** 둘지는 원장 결정:
- **(A, 권장) 수납관리 「강사 정산」 화면 확장**: v1 그 자리에서 초안 생성·확정·지급. **`PAYROLL_ENABLED` 계속 false**(옛 시간모델 `/staff/payroll` 잠든 채 유지 — 비활성은 원장 결정이었음). 급여 흐름 한 곳·원장 전용.
- **(B) 직원관리 `/staff/payroll` 재활성**: `PAYROLL_ENABLED=true`로 켜고 그 페이지에 commission 컬럼 추가. 급여의 자연스러운 집. 단 옛 시간모델 UI 부활 + 그 페이지 commission 미표시 보강 필요.
- payroll_records는 **통합 1행**이라 어느 쪽이든 데이터는 공유 — 나중에 (B)로 가도 데이터 이관 불필요.

### 불변 규칙 추가

| # | 규칙 | 근거 |
|---|---|---|
| P7 | 초안은 재계산, **확정·지급본은 동결**(스냅샷). 확정 후 출석/splits 변경은 드리프트 신호일 뿐 자동 변경 없음 | 코드 전반 돈 규율·R2 |
| P8 | `total = base + hourly + commission + bonus − deduction` — commission은 **가산**(기존 항 대체 금지) | 시간모델·배분모델 공존 |
| P9 | 신규 commission 컬럼 3종 **activity_log redact 필수** | 급여 PII(0120a·0084a 계열) |

## Phase 3+ (더 뒤, 별도 승인)

- **강사 셀프 열람** `/my-payroll`(본인 것만, 엄격 스코프).
- **수수료·인센티브·티어**: `academyFee` 분리, 성과급, 과목×학년 티어 배율(인재원 패리티, 수요 낮아 보류).

## ⚠️ 운영 선결 조건 (원장 인지 필수)

1. **회차 확정이 실사용돼야 급여가 뜬다.** 2026-07 session_terms 707건 **전부 미확정**(confirmed=0) → 오늘 `confirmed_amount`=₩0. **원장이 수납관리 "회차 확정"을 실제로 쓰기 시작해야** 정산 참고에 숫자가 나온다. (이게 confirmed 기준의 최대 선결 과제.)
2. **급여정책 입력이 백지.** 강사 48명 중 급여 설정 0명. v1 배포 후 **강사별 salary_type·배분율을 원장이 입력**해야 산정된다.
3. 참고 규모(2026-07 시뮬): 담당 반 청구 시뮬 풀 ~₩120M, 배분율 50% 가정 시 강사 급여 풀 ~₩60~80M/월. 강사당 반 ≤60행(페이징 무관), 전 강사 단일 과목(과목별 배분율 불요).

## 착수 순서 (승인 후)

1. 마이그레이션: `users.salary_type` + `commission_rate` (+ CHECK).
2. 순수엔진 `computeTeacherSettlement` + Vitest + **골든마스터 케이스 추가**(수학 JJ2B·영어 특별S 확장: 비율제/급여제/혼합 각 산정값 동결).
3. 급여정책 입력 UI(직원 상세, master).
4. 정산 참고 화면(읽기전용, teacher_id 그룹, 미배정·미설정 가시화).
5. 검증: golden 통과 + DB 없는 순수 검증 + 실데이터 참고화면 눈검증(원장이 회차 확정 몇 건 넣고 대조).
6. 원장 확인 후 Phase 2(payroll_records 연계) 별도 착수.
