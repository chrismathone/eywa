# 수납(실제 결제 징수) 기능 계획

> 상태: **계획만 작성(미구현)**. 작성일 2026-06-19.
> 관련 메모리: `project_payment-collection-gyeoljeseonsaeng`. 관련 코드: `src/features/billing/*`.

학부모가 실제로 수강료를 결제하고, 그 **수납/미수납 상태가 각 테넌트(학원) 화면에 실시간 반영**되게
한다. 현재 `/billing`은 전부 **기록 추적 전용**(수기 입력)이라, "실제 결제 + 자동 상태 갱신"을 얹는 게 목표.

전제: **지금은 우리 학원 내부 단일 테넌트로만 사용. SaaS(여러 학원 판매) 가능성은 열어둠.**

---

## 1. 핵심 결론 (provider 선택)

| | 결제선생(페이민트, 카카오페이 자회사) | PortOne(포트원/아임포트) |
|---|---|---|
| API | REST 있음, **단 파트너 제휴 계약 후 키 발급**(셀프서브 아님) | **셀프서브**, 오늘 시작 가능 |
| 자금/규제 | **직승인** = 학원이 직접 카드가맹점, 카드사 직접정산(D+2~3), eywa 자금 미보유 → 전자금융업·PCI 회피 | PG가 가맹점에 정산, eywa 자금 미보유(단일 가맹 기준) |
| 멀티테넌트 온보딩 | **경량**(`/auth/mapping` 리다이렉트로 학원 가맹 심사 내장) | **무거움**(학원마다 PG 가맹계약 별도) |
| 알림톡 청구 | **네이티브**(결제선생이 직접 발송, 쌤포인트 ~55원/건) | eywa가 결제 URL을 기존 알림톡 배선으로 직접 발송 |
| 독립성/소유 | 일부 외부 귀속(경쟁 학원관리 프로그램도 사용) | **완전 eywa 소유**, PG 추상화 |
| 비용 | PG수수료 0, 카드수수료+발송비만 | PortOne 무료, PG 요율은 별도 |

**결정:**
- **Phase 0~1 (지금, 단일 학원 내부)** → **PortOne(+토스페이먼츠 채널)**. 가맹점이 1개라 "테넌트마다
  PG계약" 마찰이 **0**이고, 셀프서브라 즉시 시작, eywa가 완전히 소유. 빌링키로 월 원비 자동결제.
- **Phase 2 (SaaS 전환 시)** → 그때 **결제선생 파트너 vs PortOne 파트너정산**을 실제 신호 보고 재평가.
  멀티테넌트에선 학원마다 PG계약 마찰이 커져 **결제선생의 경량 가맹 온보딩이 유리**해짐(단 파트너 문이
  열려 있어야). 독립성을 우선하면 PortOne 파트너정산 유지.
- **그래서 지금 결정을 못 박지 않는다** — 아래 provider 어댑터로 둘 다 미래 옵션으로 열어둔다.

> ⚠️ 학원 특화 수납 SaaS(페이히어·에듀클릭·어나더클래스)는 공개 API가 없어 임베드 불가 + 기능중복
> 경쟁 관계 → 자체 구현 대안에서 제외.

---

## 2. 아키텍처 — provider 어댑터 + 단일 진입점

AI의 `generateJSON()`·설정의 `saveOwnerSection()`과 같은 **단일 진입점 + provider 라우팅** 패턴을 결제에도 적용.

```
src/features/billing/server/payment.ts        ← 단일 진입점
  requestPayment(invoiceId)  → 어댑터 → provider(청구 발송/결제 URL 생성)
  PROVIDERS = { portone, payssam }             ← AI_MODELS 레지스트리처럼 어댑터 교체

src/app/api/webhooks/[provider]/route.ts       ← 결제 콜백 수신
  webhook 수신 → provider 조회(verify) API로 재확인 → updateInvoicePayment(자동)
```

- **수납/미수납 화면은 provider 무관** — eywa가 **자기 `invoices` 테이블을 RLS로** 보여주는 것뿐
  (이미 구현됨, `getInvoicesForPeriod`/`getBillingSummary`, 각 테넌트는 자기 청구서만). provider는
  "이 청구서 결제됨" 콜백 하나만 담당.
- **실시간 반영 2층**:
  1. **DB 갱신** = webhook으로 수초 내 `status: unpaid→paid` (결제선생·PortOne 둘 다 webhook push 지원, 확인됨).
  2. **열려있는 화면 자동 갱신**(새로고침 없이) = **eywa가 Supabase Realtime 구독** 추가 시(선택, provider 무관).
- **보안**: webhook 페이로드를 그대로 믿지 말고 provider 조회 API로 금액·상태 재확인 후 paid 처리. 멱등 처리 필수.

---

## 3. 데이터 모델 변경 (지금은 최소만)

`invoices`는 이미 상태 enum 보유: `unpaid · partial · paid · refunded · void`(schema.ts) + amount_total/paid/discount/due_date/paid_at. **추가 필요:**

- `invoices`: `payment_method`(card/transfer/...), `paid_at`(있음), `provider_payment_id`(provider 결제 식별자) 컬럼.
- **빌링키(정기결제)** 저장: `student_payment_methods`(tenant_id, student_id, provider, billing_key 토큰, 카드 표시정보) 신규 테이블 + RLS. (카드번호 비저장 — 토큰만.)
- **webhook 멱등/감사**: `payment_events`(provider, event_id, invoice_id, raw, processed_at) — 중복 콜백·재시도 방어.
- 전부 `tenant_id` + RLS. drizzle 번호본 금지(0027 이후 손수 alpha SQL — `000Na_*.sql`).
- ⏸️ **정산 테이블(`settlement_batches`/`settlement_transactions`)은 Phase 2(SaaS)로 연기** — 단일 테넌트엔 불필요.

---

## 4. 단계별 로드맵

### Phase 0 — 준비(provider 무관, 지금도 가능)
- `payment.ts` provider 인터페이스 + 어댑터 슬롯(portone 구현, payssam 비워둠).
- `invoices` 결제 컬럼 + `payment_events`/`student_payment_methods` 마이그(손수 alpha).
- webhook 라우트 스텁(`/api/webhooks/portone`).
- **수납/미수납 화면을 "메이크에듀급"으로 폴리시**(§5) — 결제 연동 없이 기존 invoices로 먼저 가능.

### Phase 1 — 실제 결제(우리 학원 내부)
- 우리 학원 사업자로 토스페이먼츠 가맹계약 + PortOne 연동.
- 빌링키 발급(최초 1회 본인인증) → 월 원비 자동결제(스케줄러로 매월 N일 청구).
- 결제 URL을 기존 알림톡 배선(`messaging/provider.ts`)으로 발송.
- webhook 실연동 → `updateInvoicePayment` 자동 → 수납/미수납 실시간.
- (선택) Supabase Realtime으로 화면 live 갱신.

### Phase 2 — SaaS 전환 시(여러 학원)
- "학원마다 PG계약" 마찰이 실제 문제로 부상 → **결제선생 파트너십 재평가**(경량 가맹 온보딩) vs
  **PortOne 파트너정산**(멀티테넌트 수수료·세금계산서·지급대행, 독립성 유지).
- `settlement_*` 테이블, 테넌트별 가맹 온보딩 플로우, 테넌트별 수수료율(`tenant_settings.billing` 확장).
- `tenant_licenses.payment_collection` 게이트.

---

## 5. "메이크에듀급" 수납 UX 갭 (provider 무관 — Phase 0에 우선 작업 가능)

eywa가 이미 가진 것: 상태 5단계, 월별 selector, 미수금 집계, 테넌트 RLS 격리, 검색/정렬.

추가로 필요(메이크에듀 기준):
1. **실시간 자동 갱신**(결제 즉시 paid) — webhook + 선택적 Supabase Realtime.
2. **미납 학생 한눈에 + 독촉(알림톡 재발송) 버튼**.
3. **수납률 대시보드**(이번 달 N% 수납, 미수금 ₩X).
4. **학생별/반별 누적 미수 추적**(이번 달뿐 아니라 밀린 달).
5. **영수증/현금영수증 자동 발행·발송**.

→ 현재 1·5 없음, 2·3·4 부분적. **메이크에듀의 어떤 화면을 기준으로 맞출지 확정 후** 갭만 채운다.

---

## 6. 확인 필요 (열린 질문 — 진행 전 해소)

- **결제선생 신규 파트너 개방 여부**(카카오페이 인수 후 정책 변화 가능) — 벤더 상담. ← Phase 2 최대 불확실성.
- 결제선생 파트너 단가/리셀 마진, 콜백 서명·재시도·멱등 정책 세부.
- PortOne 파트너정산 모듈 요금(Phase 2).
- 토스페이먼츠 정기결제(빌링키) 가맹 조건·심사 기간.
- eywa가 자금을 절대 보유하지 않는 구조 유지(전자금융업 등록 회피 전제).

---

## 7. 참고

- 결제선생 개발자센터: https://developers.payssam.kr · 이용가이드: https://guide.payssam.kr
- PortOne 빌링키 API: https://developers.portone.io/api/rest-v1/billingkey · 파트너정산: https://blog.portone.io/partner-settlement/
- 토스페이먼츠 정기결제: https://docs.tosspayments.com/guides/v2/billing/integration-api
- 카카오페이의 페이민트(결제선생) 인수: https://byline.network/2023/12/04-100/
