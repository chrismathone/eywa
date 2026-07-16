# 청구=N회 (회당 단가 × 세션) — 설계 확정 문서

> 2026-07-13 원장 승인 설계. **구현 착수 조건 = `fix/billing-discount-status` 브랜치(수납 임포터 upsert 재작성 +
> 수납 표 라인 단위 재구성)가 main에 정리된 뒤.** 그 전에는 이 문서만 진실.
> 배경: D:\attendance "쏙쏙 이전" 로드맵 1단계 키스톤(2026-06-29 판정: 풀이식 NO-GO, 개념만 신축).
> 근거 조사 = 4갈래 병렬 전수(eywa 수납·계산기·attendance 개념·makeedu 동기화) + 교차 검증(2026-07-13).

## 원장 결정 (2026-07-13)

1. **N회 소스 = 자동 산출('계획 N') 프리필 + 사무실 수기 확정.** 확정된 값만 청구값으로 인정.
   (makeedu 수납 원본 27컬럼 전수 확인 — 구조화된 횟수 정보 없음. attendance는 강사 시트에서 얻었으나
   eywa엔 그 파이프라인이 없고 의존성 리스크로 비채택. 자동 산출값을 그대로 청구값으로 쓰는 것은
   attendance 불변규칙 위반 — "검증 분자를 자동 생성하면 검증이 항상 일치해 의미 소실".)
2. **착수 = 브랜치 정리 후.** billing UI(표·다이얼로그)와 임포터를 그 브랜치가 이미 뜯어놔서 병행 시 3-way 충돌.

## 저장 설계 — line_items 안은 금지, 별도 테이블

⚠️ **6/29 로드맵의 "invoices.line_items에 sessions/unitPrice" 저장은 폐기** (2026-07-13 교차 검증):
- `fix/billing-discount-status`가 임포터를 additive→**upsert(makeedu 우선, `line_items = excluded.line_items`)**로
  재작성 — 배포 시 line_items 커스텀 키는 현재 청구월에서 **하루 2회 전멸**.
- 재집계마다 라인 구성이 바뀌어 안정적 라인 identity 없음(description 문자열 매칭뿐).
- `invoices.id`는 upsert에서 보존 → **FK 참조는 안전** = 별도 테이블이 정답.

```sql
-- 신규 테이블(마이그레이션 번호는 착수 시점 최신 +1)
create table invoice_session_terms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,   -- + RLS tenant_isolation
  invoice_id uuid not null references invoices(id) on delete cascade,
  subject text not null,              -- 운영 enum key(설정 단일소스). 교재/차량비 등 비수업 항목 유입 금지
  class_id uuid not null references classes(id) on delete cascade, -- ⚠️반 단위 — 합산 금지(아래)
  planned_sessions int,               -- 자동 산출(계획 N): 스케줄×청구기간−공휴일. 프리필·참고 전용
  confirmed_sessions int,             -- 수기 확정 N — null=미확정. 청구값으로 인정되는 유일한 값
  unit_price numeric(12,0),           -- 회당 단가(tuition_catalog 프리필, 수기 수정 가능)
  amount numeric(12,0),               -- 확정 시 confirmed_sessions × unit_price 스냅샷
  confirmed_by uuid references users(id) on delete set null,
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, invoice_id, class_id)  -- ⚠️청구서×반 1행. 같은 과목 복수 반(중등+초등 수학 동시 수강)은
                                            -- 반마다 회당 단가가 달라 **절대 합산 금지**(2026-07-13 원장 지시)
);
```

- **`tuition_catalog`에 `pricing_mode` 판별 컬럼 추가**(`per_session` | `monthly` | `discount`) — 현재 `price`가
  "회당/월 단가 또는 할인액" 미구분이라 그대로 곱하면 attendance의 "월 수강료를 회당으로 곱한 200만원대" 사고 재발.
  판별 없이 `sessions × price` 곱셈 금지.

## 불변 규칙 (attendance 사고에서 이식 — 코드 주석·리뷰 게이트로 강제)

| # | 규칙 | 근거 사고 |
|---|---|---|
| N1 | **confirmed_sessions만 청구값.** planned_sessions는 프리필·계획 대비 지표 전용 | 검증 분자 자동 생성 = 검증 무의미 |
| N2 | **invoices.amount_total과 자동 일치화 금지.** Σ(session_terms.amount)와의 diff가 곧 검증 신호 — upsert 하에서 amount_total은 makeedu가 이김 | share-billing N:M 재분배 청구액 사고 |
| N3 | **교재·차량비 등 비수업 항목은 session_terms에 유입 금지.** 기존 invoices line kind='tuition'은 오염돼 있어(임포터 폴백) kind 필터로 분모 만들지 말 것 | "교재/차량비 절대 유입 금지" |
| N4 | 학생 매칭에 **"(퇴)/(휴)/(신)" suffix 정규화** + 매칭 실패는 조용한 스킵 금지(가시화) | "(퇴)" suffix 48행/20명 오정산 |
| N5 | 단가 프리필은 **분반명 기준**(학생 학년 아님) + pricing_mode='per_session'만 곱셈 허용 | 단가 그룹 오적용 |
| N6 | 돈-결합(정산 자동 반영) 전 **골든마스터**: 실데이터 회귀 케이스 3개+ 동시 통과 게이트 | attendance R2 |

## 구현 순서 (브랜치 정리 후)

1. 마이그레이션: `invoice_session_terms` + RLS + `tuition_catalog.pricing_mode`.
2. 계획 N 산출 서버 함수 — 기존 순수 엔진 **재사용**: `countSessions`/`estimateTuition`
   ([tuition-calc.ts](../src/features/billing/tuition-calc.ts), Vitest 있음). enrollments+class_schedules+설정 공휴일 입력.
3. 수납 표/다이얼로그에 "회차" 열 + 확정 UI(계획 N 프리필 → 수정 → 확정 버튼, confirmed_by/at 기록) —
   ⚠️ 브랜치의 라인 단위 표 재구성 **위에** 작업(중복 개편 금지).
4. ~~견적→청구 전환(saved-quotes-list "청구서로 전환")이 현재 합계 숫자만 넘겨 견적의 sessions/perSession 구조가
   소실됨 → 전환 시 session_terms 생성으로 구조 보존.~~ **→ 불요 보류(2026-07-14 원장 판단).**
   ① injaewon은 청구서를 **MakeEdu 동기화**로 받으므로 eywa 안에서 견적→청구서를 만들 일 자체가 없음 = 실익 0.
   ② 견적(`tuition_quotes`)은 **신입생 상담용**이라 코스가 자유텍스트 반이름 + 느슨한 `category`만 갖고
   `class_id`/`subject` FK가 없는데, `invoice_session_terms`는 **`class_id` NOT NULL · `subject` NOT NULL**(0102a)
   요구 → "전환 시 즉시 session_terms 생성"은 **데이터 모델상 성립 안 함**. "eywa 안에서 직접 청구하는 테넌트"가
   생기면 그때 **매핑 후 생성**(코스→실제 반+과목 매핑 단계) 또는 **참고 보존**(line_items 메타)으로 재설계 — 그 전엔 만들지 말 것.
5. (로드맵 2단계 연결) 시수 검증 read-only 탭 — 아래 섹션.

## 시수 검증(a) — read-only 탭 설계 (로드맵 2단계, 이 키스톤의 직접 소비자)

- **위치**: `/billing` FaceTabs 새 면 "시수 검증" (수납 다면 선례). **쓰기 0** — 화면 전체가 조회 전용.
- **대조 쌍(검증 짝 확정)**: 행 = `invoice_session_terms`(학생×반×청구월 — 반 단위라 출석 대조가 더 정확).
  · 분자(청구값) = `confirmed_sessions` — **확정값만**(N1). 미확정(null) 행은 "미확정" 뱃지 + 계획 N 회색 참고 표시(검증 대상 아님).
  · 분모(실제) = `attendance_records` count(그 학생, 그 `class_id`, 청구월) — 출석 인정 상태 = present·late·early_leave·makeup(수업 소비), absent 제외.
  ⚠️ 이 대조 짝이 가능한 건 session_terms가 과목·반 차원을 구조화했기 때문 — attendance가 수납명 문자열 파싱
  ("초등M 초4 BS1J 화금")으로 풀다 사고 8건의 근원이 된 지대를 **원천 제거**.
- **표시**: 확정 N vs 실출석 diff(색상: 일치=녹색·부족=주황·초과=적색) + 반·담임·단가. diff는 신호일 뿐 —
  **어느 쪽도 자동 수정하지 않는다**(N2 확장: 검증 화면에 "일치시키기" 류 버튼 금지).
- **한계 명시(v1)**: 청구월=달력월 근사(attendance의 기간 ranges 모델 미도입 — 월중 등록/퇴원은 diff에 자연 노출되며
  note로 설명). 분리등원은 enrollment 단일이라 반 단위 카운트에 포함.
- **게이트**: 여기까지가 (a). **(b) 금액차 산출·강사 분배(splits)는 골든마스터 테스트(N6) 통과 전 착수 금지** — 불변.
  → **✅ 게이트 통과·(b) 구현 완료(2026-07-16)**: 골든마스터 = [`src/features/billing/golden/`](../src/features/billing/golden/golden.test.ts)
  (실데이터 동결 픽스처 4계열 — 반 라인 매칭·계획 N·시수 검증/분배·수납 지표 401행). splits = `invoice_teacher_splits`(0116a,
  기간 단위 전량 교체 스냅샷·기록 전용·invoices 불변 N2) + [`computeSplitRows`](../src/features/billing/session-terms/splits.ts)
  + 시수 검증 면 스냅샷 패널(드리프트 표시). ⚠️ **이후 돈 산식을 바꾸는 모든 변경은 골든마스터 통과가 머지 조건**(attendance R2·R6 이식).

## 소비처/공존 체크 (구현 시 필수 확인)

- `normalizeInvoiceLineItems`([queries.ts](../src/features/billing/server/queries.ts))는 미지 키를 무경고 드랍 —
  line_items를 건드리지 않는 이 설계에선 무관하나, line_items 확장 유혹이 다시 생기면 이 함정부터 기억할 것.
- makeedu 동기화와의 공존: 별도 테이블 + invoice_id FK라 upsert 무영향. 단 `replace-invoices-from-excel.cjs`
  전기간 재실행 시 invoices 행이 삭제→재생성되면 FK cascade로 session_terms가 같이 죽는지 확인(재생성이면 id가
  바뀜) — **정리 스크립트는 DELETE+INSERT가 아니라 UPDATE 경로여야 함**(착수 시 검증 항목).
- line_items 이중 인코딩(JSON 문자열) 행 잔존 — 새 파서는 흡수 필수(activity.ts:156 선례).
- 임포터 3-way 드리프트(프로덕션 PC 구버전 {name,amount} / main / 브랜치): 브랜치 정리에 **동기화 PC zip
  물리 재이관**(git pull 아님)까지 포함돼야 기준 코드 확정.
