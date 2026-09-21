# 인프라 비용 · 소진 예측 ("사이버 월세") — 설계 기록

> **상태: 보류 (2026-07-22).** 원장 판단 = "당장 급한 불은 아님". 설계·기반 코드까지 만들고 **의도적으로 멈춤**.
> 프로덕션 DDL 미적용 · main 미머지. 재개할 때 이 문서만 읽으면 재조사 없이 착수할 수 있도록 썼다.

---

## 1. 문제

aywa가 매달 쓰는 외부 서비스 비용(Vercel·Supabase·AI·전사 API)이 **어디에도 기록되지 않는다.** 두 가지가 문제:

1. **선불 키가 소진되면 예고 없이 기능이 죽는다.** 전사(AssemblyAI) 크레딧이 0이 되면 회의록·등록상담·재원생 상담 분석이 전부 멈춘다. 지금은 터지고 나서야 안다.
2. **후불 요금이 조용히 커진다.** Vercel은 자동결제라 멈추진 않지만, 대역폭이 튀면 그대로 청구된다.

원장 요구는 **"미리 파악해서 미리 충전"** — 즉 사후 집계가 아니라 **소진 예측**이 목적이다.

## 2. 왜 지금은 급하지 않은가 (실측 근거, 재조사 불요)

2026-06-22 ~ 07-22 30일 실측:

| 항목 | 실측 | 비고 |
|---|---|---|
| AI 토큰 (전 provider) | **월 $1 미만** | Anthropic ≈ $0.6. 관리 대상이 아니다 |
| 전사 오디오 | **25.79시간** | 회의 80,177초 + 등록상담 12,656초. 시간당 과금 = 실사용 변동비의 대부분 |
| Vercel | $20 고정 | 포함 크레딧 $20 중 $3.33 소진, on-demand $0 |
| Supabase / Firebase | 무료 구간 | |

AI 호출 내역(`ai_usage_logs`, 30일): daily_briefing 24회 · assistant_chat 18회 · classnote_ment 16회 · enrollment_form_extract 6회 · enrollment_analysis 6회. 사용 모델 4종 — `claude-sonnet-5`, `claude-haiku-4-5`, `solar-pro3`, `deepseek-v4-pro`.

**결론: 현재 총액이 작아서 급하지 않다.** 이 기능의 가치는 총액 집계가 아니라 **급증 포착**이다 — 녹음량이 늘거나 Vercel 대역폭이 튀는 시점을 미리 잡는 것. 그래서 아래 두 트리거 중 하나라도 걸리면 재개할 값어치가 있다:

- 녹음/전사 사용이 지금의 2~3배로 늘 때 (강사 수 증가, 상담 녹음 상시화)
- Vercel on-demand가 $0을 벗어날 때 (포함 크레딧 초과 = 실제 초과 과금 시작)
- 선불 키를 실제로 한 번 소진시켜서 기능이 멈췄을 때 (사후 대응이지만 가장 확실한 신호)

## 3. 핵심 설계 결정

### 3-1. 배치 = super-admin, 학원설정 아님

인프라 요금은 학원 데이터가 아니라 **aywa 플랫폼 운영비**다. `/owner`(학원설정)는 `tenant_settings`에 저장되는 테넌트 단위라, 여기 넣으면 멀티테넌트가 됐을 때 **다른 학원 원장이 우리 청구서를 보게 된다.**

실측: `super_admins` = `st2000423` 1명, `tenants` = 1개(injaewon). 즉 지금은 super-admin에 둬도 접근성 차이가 0이고, 멀티테넌트가 되는 순간 저절로 올바르게 격리된다. 이미 `(super-admin)/super-admin/` 라우트 그룹과 SaaS 대시보드가 있으니 그 옆에 붙이면 된다.

**새 테이블은 `tenant_id`를 갖지 않는다.** RLS는 켜되 **정책을 하나도 만들지 않는다** = `service_role`만 통과. 앱 접근은 `requireSuperAdmin()` 게이트를 지난 서버 코드가 admin client로 읽는다.

### 3-2. 축 = 선불 / 후불 분리

이게 이 기능의 뼈대다. 둘은 완전히 다른 문제다.

| | 선불 (prepaid) | 후불 (postpaid) |
|---|---|---|
| 벤더 | DeepSeek · AssemblyAI · Upstage · Gemini | Vercel · Supabase · Anthropic · Firebase |
| 소진되면 | **서비스가 멈춘다** (전사 실패 = 회의록·상담분석 정지) | 안 멈춤 (자동결제) |
| 필요한 지표 | **"며칠 남았나"** | 예산 대비 소진율 |
| 대응 | 미리 충전 | 요금 폭탄 감시 |

**주의**: 제일 큰 항목인 Vercel $20은 후불이라 충전 대상이 아니다. 실제로 멈출 수 있는 건 전사·AI 쪽이다. 화면은 두 섹션으로 나눈다.

### 3-3. 잔액은 하이브리드 (API + 수동 기록)

잔액 API가 있는 건 **DeepSeek 하나뿐**이다. 그래서 기본 경로는 **"충전 기록 수동 입력 → aywa가 실사용을 차감"**:

```
잔액 = (가장 최근 observed 금액) + (그 이후 topup 합) − (그 이후 실사용 소비)
       observed가 없으면 (전체 topup 합) − (첫 topup 이후 소비)
```

`observed`(실측 잔액 앵커)가 핵심이다 — 콘솔에서 실제 잔액을 가끔 한 번 넣어주면, 그 시점에서 추정 오차(단가 미입력·집계 누락)가 **리셋된다.** 자기교정 구조라 오차가 누적되지 않는다. 잔액 API가 없는 벤더까지 전부 커버되는 게 이 방식의 장점.

소비량은 저장하지 않는다 — **이미 DB에 있다**:
- 토큰: `ai_usage_logs`(0113a) — provider·model·feature·input/output 토큰
- 전사: `meeting_minutes` / `consultation_recordings` / `student_consultations`의 `audio_duration_sec`

### 3-4. 계산 불변식 3가지 (⚠️ 되돌리지 말 것)

1. **단가 미입력 = `null`, 0원이 아니다.** 확인 못 한 벤더 단가를 0으로 치면 화면이 "월 $0"이라는 **거짓 안심**을 준다. `null`로 올려 UI가 "단가 미입력"으로 표시하고 합계에서 제외한다. 반쪽 단가(입력만 있고 출력 없음)도 `null` — 절반만 센 금액이 더 위험하다.
2. **소진 예측은 보수적으로.** 최근 7일 평균과 30일 평균 중 **소비가 큰 쪽**(= 잔여일수가 짧은 쪽)을 쓴다. 방학·시험기간에 녹음이 몰려서, 30일 평균만 보면 소진일을 늦게 잡아 **충전할 시간을 놓친다.**
3. **임계는 금액이 아니라 잔여일수.** "$5 남음"은 행동을 못 만들고 "6일 뒤 소진"은 만든다. 기본 14/7/3일 (해외 결제 리드타임 감안). 넘어선 임계 중 **가장 촉박한 하나만** 고른다 → 단조 에스컬레이션이라 dedup이 성립한다.
   - ⚠️ **bucket에 날짜·앵커일을 섞지 말 것** — 매일 새 bucket이 되어 무한 재알림이 된다 (Phase 3 이벤트 알림과 동일한 함정, `docs/` 이벤트 알림 규칙 참조).
   - 충전해서 임계를 벗어나면 해당 벤더의 alert 행을 지워 재무장한다(앱 책임).

## 4. 데이터 모델

> 아래 DDL은 작성·검토 완료 상태다. **프로덕션 미적용.**
>
> ⚠️ **번호를 반드시 다시 딸 것.** 브랜치 파일명은 `0134a_infra_costs.sql`인데, 보류하는 사이 다른 세션이
> **`0134a`를 수납 회차 이월(carryover)로 선점**했다(origin/main `2ab445fd`). 재개할 때 그 시점 최신 번호로
> 리네임해야 `pnpm db:alphas`(사전순 적용)가 깨지지 않는다. 내용은 그대로 쓰면 된다.

### `infra_vendors` — 벤더 마스터
```
key text pk                    -- 'vercel' | 'anthropic' | 'deepseek' | 'assemblyai' …
label text not null            -- 화면 표기(한글). raw key 노출 금지 규칙 대응
billing_mode text not null     -- 'prepaid' | 'postpaid'  ← 이 기능의 축
monthly_fixed_usd numeric      -- 고정 구독료(Vercel $20). 종량제만이면 null
alert_days int[] default '{14,7,3}'
console_url text               -- 충전/청구 화면 바로가기
active boolean, sort_order int, memo text, created_at timestamptz
```

### `infra_balance_marks` — 충전/실측 잔액
```
id uuid pk
vendor_key text → infra_vendors
kind text        -- 'topup'(충전액) | 'observed'(그 시점 실측 잔액 = 차감 앵커)
amount_usd numeric not null check (>= 0)
marked_at timestamptz
source text      -- 'manual' | 'api'
memo text
```

### `infra_prices` — 단가 이력
```
id uuid pk
vendor_key text → infra_vendors
unit_kind text   -- 'token'(input/output per MTok) | 'audio_hour' | 'flat'
model text       -- null = 그 벤더의 폴백 단가. 모델 전용 행이 있으면 우선
input_per_mtok / output_per_mtok / unit_price_usd numeric
effective_from date  -- 이력 보존: 과거 달을 다시 계산해도 그때 단가로 나온다
unique (vendor_key, unit_kind, model, effective_from)
```

### `infra_alert_events` — 알림 dedup (플랫폼 스코프)
```
id uuid pk
vendor_key text → infra_vendors
event_type text  -- 'runway' | 'budget'
bucket text      -- 상태 전이 표현. 'runway:7' / 'budget:75'  ← 날짜 금지
seeded boolean   -- true = 콜드스타트 무발송 시드
unique (vendor_key, event_type, bucket)
```
기존 `notification_events`(0118a)는 `tenant_id NOT NULL`이라 **재사용 불가** — 인프라는 테넌트 사건이 아니다. 불변식(bucket=전이 표현 / 콜드스타트 시드 / `upsert(ignoreDuplicates).select()`로 신규분만 발송)만 복제한다.

### 집계 RPC 2개

`.select()` 전건 fetch는 PostgREST 1000행에서 silent 절단되므로(성능 규칙 B2) group-by RPC로 만든다. 둘 다 `security invoker` + `service_role`만 execute.

- **`infra_ai_usage_daily(p_from date, p_to date)`** → `(day, provider, model, feature, calls, input_tokens, output_tokens)`
  `ai_usage_logs`에서 KST 일자 기준 group by. `ok = true`만(실패 호출은 과금 안 됨).
- **`infra_audio_usage_daily(p_from date, p_to date)`** → `(day, source, items, seconds)`
  `meeting_minutes` + `consultation_recordings` + `student_consultations`를 union. `audio_duration_sec is not null`만(= 전사 완료 = 과금된 건).

✅ **두 RPC 본문 모두 실 스키마에 읽기 전용으로 실행해 동작 확인함** (AI 15행/4모델, 오디오 25.79시간).

## 5. 벤더별 조회 가능성 (2026-07-22 조사 결과)

| 벤더 | 잔액 | 비용 | 확인도 |
|---|---|---|---|
| **DeepSeek** | ✅ `GET https://api.deepseek.com/user/balance` → `total_balance` / `granted_balance` / `topped_up_balance` / `is_available`. 일반 API 키로 동작 | — | 확인됨 |
| **Anthropic** | ❌ 잔액 엔드포인트 없음 | ✅ Usage & Cost Admin API (`/v1/organizations/usage_report/messages`, cost report). **`sk-ant-admin…` 전용 관리자 키 필요.** 4시간마다 갱신, 최대 30일간 값이 정정됨 | 확인됨 |
| **Vercel** | — | ⚠️ 예산 웹훅이 사실상 유일한 경로 | 확인됨 |
| **Gemini** | ❌ 선불 잔액은 AI Studio 화면에서만. 프로그램 조회는 Cloud Billing/BigQuery export 경유 | | 확인됨 |
| **Supabase** | ⚠️ Management API(PAT)는 있으나 조직 사용량/지출 엔드포인트 경로 **미확정** | | **미확인 — 구현 시 실호출로 확인 필요** |
| **Upstage** | ❓ | | **미조사** |
| **AssemblyAI** | ❓ | | **미조사 (단가도 미확인)** |

### Vercel 예산 웹훅 (자동결제 감시)

Vercel은 후불 자동결제라 예산 도달을 이메일로만 알린다. 웹훅으로 받으면 aywa 안에서 처리할 수 있다.

- 발화 시점: spend amount의 **50% / 75% / 100%** 도달 시 + 결제 주기 종료 시
- 페이로드: `{budgetAmount, currentSpend, teamId, thresholdPercent}` / `{teamId, type: "endOfBillingCycle"}`
- 검증: `x-vercel-signature` 헤더 = 본문의 **HMAC-SHA1**(웹훅 저장 시 발급되는 secret). 상수시간 비교 권장 (`assemblyai` 웹훅 라우트의 `secretMatches` 선례)
- 체크는 몇 분 간격이라 실제 초과 시점보다 늦게 트리거될 수 있음

⚠️ **스코프 한계**: 이 웹훅은 **on-demand 예산(초과 과금)에 대해서만** 동작한다. Pro 시트에 포함된 크레딧 $20 소진 경고는 **오지 않는다** — 그건 Vercel 이메일/웹 알림뿐이다. 즉 웹훅 50%가 울린다는 건 이미 크레딧을 다 태우고 초과 과금 $15를 쓴 시점이다.

⚠️ **On-Demand Budget은 하드캡이 아니다.** Pro 플랜은 100% 도달해도 배포가 자동 중단되지 않는다. 진짜 상한을 원하면 Vercel 설정에서 **Pause Production Deployments**를 켜야 하는데, 그러면 상한 도달 시 사이트가 오프라인이 된다(학원 운영 중 서비스 중단). 현재는 꺼져 있고, 이 트레이드오프는 원장 판단 사항.

## 6. 남은 작업 (재개 시 착수 순서)

1. **프로덕션 DDL 적용** — 신규 테이블 4개 + 읽기 전용 함수 2개. 기존 테이블 무접촉(additive). 승인 필요.
2. **`/super-admin/costs` 화면** — 선불/후불 두 섹션. 선불은 잔여일수·소진예정일 중심, 후불은 예산 소진율. 단가 미입력 벤더는 "단가 미입력" 배지. 차트를 넣는다면 `next/dynamic` 지연로드(성능 규칙 B5).
3. **Vercel 예산 웹훅 수신 라우트** — `x-vercel-signature` HMAC-SHA1 검증.
4. **cron 잔여일수 감지** — `vercel.json`에 이미 4개 도는 중, 하나 추가.
5. **알림 배달** — `notifications` 테이블도 `tenant_id NOT NULL`이라, super_admin 계정이 소속된 학원 셸의 벨로 보낸다(super_admin id → `users` 행 조회). 기존 `notifyUsers()` 재사용.

### 재개 전에 원장이 채워야 할 것

**단가.** Anthropic 3종(Sonnet 5 도입가 $2/$10 — 2026-08-31까지, Haiku 4.5 $1/$5, Opus 4.8 $5/$25)만 확인해서 시드했다. **DeepSeek · AssemblyAI · Upstage 단가는 의도적으로 비워뒀다** — 확인 못 한 값을 넣으면 화면이 그럴듯한 거짓 숫자를 말한다.

특히 **AssemblyAI 시간당 단가**가 가장 중요하다. 25.8시간/30일이 실사용 변동비의 대부분이라, 이 값이 들어와야 "월 얼마 쓰는지"가 처음으로 진짜 숫자가 된다.

## 7. 보안 주의

**Anthropic Admin 키(`sk-ant-admin…`)와 Supabase PAT는 조직 전체 권한**을 가진 자격증명이다. aywa DB에 넣지 말고 Vercel 환경변수로만 두고, 가능한 provider는 읽기 전용 스코프를 쓸 것. DeepSeek 잔액 조회는 일반 키로 되니 그건 문제없다.

## 8. 코드 위치

기반 코드는 로컬 브랜치 **`feat/infra-cost-dashboard`** (커밋 `450937a4`, `origin/main` `6e3a6fab` 기준)에 있다. **main 미머지 · 미푸시.**

- `supabase/migrations/0134a_infra_costs.sql` — 위 4장 DDL + RPC 2개 + 벤더/단가 시드
  (⚠️ `0134a`는 그 뒤 수납 회차 이월이 선점 — 재개 시 리네임 필수, 4장 경고 참조)
- `src/features/infra-costs/calc.ts` — 순수 계산(단가 해석 / 토큰·오디오 비용 / 잔액 추정 / 소진일 / 임계 판정)
- `src/features/infra-costs/calc.test.ts` — Vitest **30/30 통과**
- `vitest.config.ts` — 커버리지 게이트에 `infra-costs/calc.ts` 등록(돈 계산 = 테스트 강제 규칙)

브랜치가 사라져도 이 문서만으로 재구성 가능하도록 DDL과 불변식을 본문에 인라인해 뒀다.
