# 급여 연계 (splits → 강사 정산) — 설계 확정 문서

> 2026-07-17 원장 결정(AskUserQuestion 4/4). 로드맵 "쏙쏙 이전"의 최종 잔여 단계.
> ⚠️ **이 문서는 설계다. 구현·마이그레이션·`PAYROLL_ENABLED` 전환은 원장 별도 승인 후.** 그 전엔 이 문서만 진실.
> 배경: [`per-session-billing-plan.md`](per-session-billing-plan.md) 로드맵 2단계(b) splits 완료 → 그 확정치를 강사 급여에 연계.
> 근거 조사 = 4갈래 병렬 전수(eywa 급여 인프라·attendance 정산모델·splits 브릿지·프로덕션 데이터, 2026-07-17).

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
- **인센티브·성과급 티어 = v1 미이식**(수동 보너스/공제만). 블로그 인센티브·성과급 배율은 마케팅 계열이라 eywa 12메뉴 정체성 밖.
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

## Phase 2+ (별도 승인 시)

- **payroll_records 자동 초안 + 스냅샷 동결**: 회차 확정 시 급여 초안 생성. `payroll_records`에 `commission_base_amount`·`commission_rate`·`commission_amount`·`pay_basis` 컬럼 + splits 기간 링크 신설. 확정본 불변, 재계산은 초안만.
- **`PAYROLL_ENABLED` 전환 / 기존 시간모델 통합**: 시급·월기본 모델과 매출배분 모델을 hybrid로 합류.
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
