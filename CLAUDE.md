@AGENTS.md

# aywa 프로젝트 가이드

이 프로젝트는 [D:\ijw-calander](D:\ijw-calander)(인재원 학원관리 SaaS)의 경량 재작성판입니다. 자세한 설계 결정은 [`C:\Users\user\.claude\plans\curried-popping-finch.md`](C:\Users\user\.claude\plans\curried-popping-finch.md)에 있습니다.

---

## 메뉴 12개

오늘 / 시간표 · 출석부 · 수업목록 / 학생목록 · 등록상담 · 학생상담 · 퇴원관리 / 직원관리 · 수납관리 · 회의록 / 도움말

기존 ijw-calander의 43개 탭 중 마케팅, 셔틀관리, 자료실, 역할관리, 매출분석, 지출관리, 시간표배포, 알림센터, 학부모포털 등은 의도적으로 제외했습니다.

---

## 작업 원칙

- **반응속도(UI/UX)가 1순위**. 학원장/강사는 매일 수십 번 이 화면을 본다. 느리면 끝. 무거운 작업(특히 AI 호출, 큰 쿼리)은 가시적 progressive 렌더링 또는 백그라운드로 빼고, 보이는 데이터는 가능한 한 캐시·streaming·partial 렌더링으로 즉시 보여줄 것.
- **한 파일 200줄, 한 컴포넌트 props 10개 이하** — 기존 코드는 3,113줄 단일 컴포넌트, props 80개로 무너졌습니다.
- **Server Component 우선**. 클라이언트 컴포넌트는 상호작용이 필요할 때만.
- **모든 DB 테이블에 `tenant_id` + RLS**. 멀티테넌트 누수는 한 정책 빠지면 전사 노출 — pgTAP 테스트로 강제.
- **출석/급여/수강료 등 계산 함수**는 순수 함수로 분리해서 Vitest 단위테스트 강제(coverage 게이트 70%+).
- **AI 호출은 캐싱 + 명시적 트리거**: 재분석은 명시 버튼이 있을 때만. 페이지 로드만으로 절대 새 호출 안 함. 마지막 결과는 DB에 보존되며, "갱신" 버튼을 다시 누르기 전까지 그대로 표시.
- **UI에 표시하는 모델은 "친화적 라벨"로 노출** (2026-07-16 반전 — 과거엔 '노출 금지, 생성 시점만'이었으나, 모델을 번갈아 쓰게 되면서 "어떤 모델로 분석됐는지"가 직원에게 유용해짐). 단 원시 id(`deepseek-v4-pro-2026-07-16`)는 노이즈라 [`modelDisplayLabel`](src/lib/ai/model-label.ts)로 짧게 매핑("DeepSeek v4-pro"·"Claude Sonnet 5"), 알 수 없는 모델은 미표시(raw 코드 노출 금지). 전사 분석 3화면(등록상담·회의록·재원생 상담)이 '펼치기' 옆에 이 라벨을 단다.

## 성능/병목 방지 — 절대 규칙 (반응속도 1순위, ⚠️ 새 쿼리·라우트·차트 추가 시 필수 점검)

**반응속도가 1순위**라 병목은 기능 버그와 동급으로 취급한다. 아래는 실제로 터졌던 병목을 재발 방지 규칙으로
못박은 것 — **새 코드는 맨 아래 체크리스트를 통과해야 "완료"**다. (공용 헬퍼: [`src/lib/supabase/batch.ts`](src/lib/supabase/batch.ts),
[`src/lib/http/content-disposition.ts`](src/lib/http/content-disposition.ts). 배경: 구현 막힌 점 [[#53]]·[[#54]].)

### B1. 비ASCII(한글)를 HTTP 헤더 값에 **직접 넣지 말 것** — 한글 파일명 = 500 (2026-06-26 실측)
HTTP 헤더 값은 ByteString(Latin-1, ≤255)이라 한글(예 '수'=49688)을 그대로 넣으면 응답 생성 단계에서
`TypeError: Cannot convert argument to a ByteString` → 라우트 **500** → "버튼 무반응"(엑셀 시간표/학생/수납 4라우트 전멸했었음).
- **규칙**: 파일명 등 비ASCII가 들어가는 헤더는 **[`attachmentFilename()`](src/lib/http/content-disposition.ts)**(RFC 5987: ASCII 폴백 `filename` + UTF-8 `filename*`) 경유. 어떤 헤더에도 한글 직접 금지.

### B2. "세거나·집계하려고 전건 fetch" 금지 — PostgREST 1000행 **silent 절단** ([[#54]])
필터/페이징 없는 `.select()`로 전건을 받아 JS에서 count·SUM·group·distinct·id whitelist를 만들면 **에러 없이 1000행에서 잘린다**.
2026-06-26 실측: `getAvailablePeriods`가 invoices 1606행을 무페이징 select → 절단 → 수납 월칩에서 **2026-03 누락**(실데이터 버그).
- **규칙**: 결과를 **세거나·집계·distinct·whitelist로 쓰는 쿼리는 bare unbounded select 금지.**
  · 단순 카운트 = `.select("*", { count: "exact", head: true })` (행을 안 받음)
  · 합계·그룹 = **group-by RPC**(security invoker + `auth_tenant_id()` 이중격리, 0039a/0040a 패턴)
  · 전건이 꼭 필요 = **`fetchAllPaged`**(`.range` 페이지네이션, 1000 초과 전건)
- 🔴 **청크로 나눴다고 끝난 게 아니다 — 청크 *안에서* 또 잘린다**(2026-09-07, 원장 제보 *"이 반은 왜 스케줄이 안나와?"*):
  수업목록이 `fetchInChunks`로 100반씩 `class_schedules`를 읽었는데 이 표는 이력을 함께 담아([[#88]]) 한 청크가
  **1,042행** → 1,000행 침묵 절단 → 꼬리에 걸린 반은 요일 칸이 `—`(반 상세엔 멀쩡히 떴다). **id 목록 × 행이 많은 표는
  `fetchAllPagedInChunks`**(청크 × 페이징 + `.order("id")`). ⚠️ 청크 크기 축소는 임시방편(이력 표는 계속 자란다).
  ⚠️ **RLS가 붙으면 잘리는 꼬리가 달라져 사람마다 다른 반이 사라진다** — service_role 프로브로 "정상"을 확인하지 말 것.
- **점검**: `features/*/server/queries.ts`에서 `.select(...)` 뒤 `.reduce/.filter/.length/Map/Set`로 집계하는 곳에 `count`/`fetchAllPaged`/RPC가 있는지.

### B3. 대량 `.in()`은 **`fetchInChunks`** — HTTP 414 + error 삼킴 ([[#53]])
수십~수백 id를 단일 `.in(col, ids)`에 넣으면 URL이 414로 실패하고, `data ?? []`로 받으면 그 error를 삼켜 **조용히 오작동**한다.
- **규칙**: id가 수십+ 가능하면 **`fetchInChunks`**(100개 청크 분할). raw `.in(거대배열)` 금지. `?? []`로 error 삼키기 금지(헬퍼는 throw).

### B4. 서로 **독립인 await는 `Promise.all`** — 직렬 워터폴 금지
앞 결과를 뒤가 쓰지 않는데 `await`가 순차로 줄지어 있으면 라운드트립이 합산된다.
- **규칙**: 독립 조회는 `Promise.all`(또는 `parallel`). 진짜 의존만 await 체인.

### B5. 무거운 클라 라이브러리는 **`next/dynamic` 지연로드** (2026-06-26: recharts ~367KB)
recharts·exceljs·html2canvas·qrcode 등 큰 라이브러리를 client 컴포넌트에 **정적 import**하면 페이지 첫 페인트를 블로킹한다.
- **규칙**: 차트=리프를 **`next/dynamic(() => import("./X-impl"), { ssr:false, loading: 스켈레톤 })` 래퍼 + `*-impl.tsx` 분리**(차트가 보일 때만 로드, 소비처 import 불변). 무거운 처리(엑셀 빌드 등)는 서버 액션/라우트에서 `await import()`. **새 차트는 처음부터 이 패턴**(레퍼런스: 콜&상담 통계 `enrollment/_components/stats-trend-impl.tsx` · 원생 통계·퇴원관리 `trend-chart-impl.tsx`).

### B6. 멀티윈도우 비용 — 테넌트 read-mostly는 **캐시**, 복원 창은 **stagger**
aywa는 메뉴=플로팅 창=same-origin iframe이라 **창마다 셸 레이아웃이 재실행**된다(창 N개 = 인증·설정 쿼리 N배).
- **규칙 ①(캐시)**: 테넌트 단위 read-mostly 데이터(학원 설정 등)는 **tenantId별 `unstable_cache`**로 cross-request 공유
  (`getTenantSettings` `loadTenantSettingsRaw` 참조 — 캐시 안엔 쿠키 없이 admin client + 신뢰 tenantId 키). 무효화는 **server action에서
  `updateTag(tag)`**(read-your-writes, 즉시) + `revalidatePath`. ⚠️ **Next16: `revalidateTag`는 2-arg(`tag,profile`)로 변경** → 즉시 반영은 `updateTag(tag)`.
- **규칙 ②(stagger)**: 창 복원 시 iframe `src`를 **한꺼번에 마운트하지 말 것** — 포커스 창만 즉시, 나머지는 z순서 stagger(`route-window.tsx` `activated` 참조).

### B7. 무거운 쿼리로 **첫 페인트를 막지 말 것** — `loading.tsx`/Suspense 스트리밍
페이지가 무거운 쿼리를 `await`해 첫 페인트가 늦으면(특히 창=iframe으로 열 때 빈 화면) route **`loading.tsx`**(또는 Suspense)로 스켈레톤을 즉시 스트리밍.
- ⚠️ 트레이드오프: searchParam 네비(필터 전환)에도 스켈레톤이 뜬다 — 무플래시가 필요한 자주-필터링 화면은 **필터를 클라(fetch-once+JS)로** 옮기는 게 정석.

### ⚠️ 새 코드 체크리스트 (쿼리/라우트/차트 추가 시 PR 전 필수)
1. [ ] 헤더에 비ASCII 직접 안 넣음(`attachmentFilename`). **(B1)**
2. [ ] 카운트/집계/distinct/whitelist 쿼리에 `count:exact head:true` / RPC / `fetchAllPaged` 사용(무페이징 select 아님). **(B2)**
3. [ ] 대량 `.in()`은 `fetchInChunks`, error 안 삼킴. **(B3)**
4. [ ] 독립 await는 `Promise.all`. **(B4)**
5. [ ] 무거운 클라 라이브러리는 `next/dynamic`. **(B5)**
6. [ ] 창마다 도는 테넌트 데이터는 캐시 / 복원 창 stagger. **(B6)**
7. [ ] 새 페이지가 무거우면 `loading.tsx`. **(B7)**

> **한 줄 규칙: 세거나·집계하려고 수백 행을 JS로 끌어오지 말 것(count/RPC/fetchAllPaged). 큰 `.in()`은 청크. 비ASCII는 헤더에 직접 넣지 말 것. 무거운 클라 라이브러리·쿼리는 지연(`next/dynamic`·`loading.tsx`). 창마다 도는 테넌트 데이터는 캐시.**

## AI 모델 정책

**모든 AI(JSON) 호출은 단일 진입점 `src/lib/ai/generate.ts`의 `generateJSON()`을 거친다.**

TypeSafe Jev의 제한된 선택지 판정도 `generateJSON({ mode: "decision", state, questions, meta })`를 사용한다.
문장 생성 provider/폴백에는 넣지 않는다. `TYPESAFE_API_KEY_<그룹>` → `TYPESAFE_API_KEY` 순서이며,
현재 `parent_attendance_jev_shadow`는 수동 비교 전용이다. 지점 allowlist가 없으면 꺼져 있고 분류 변경·발송은 하지 않는다.
직접 `getAnthropic`/`getDeepseek`를 부르지 말 것 — provider 라우팅·파싱·폴백이 한 곳에 모여 있다.
**예외 하나 = 학원 비서**(원장 2026-11-06 · [`agent.ts`](src/features/assistant/server/agent.ts)) — 도구를 여러 번 부르는 루프라 Claude 스트림을 직접 쓴다.
대신 같은 관문을 손으로 다 지난다: 라이선스 `requireAiLicense` · 사용량 `recordUsage`(feature `academy_assistant` · 키 그룹 `ASSISTANT`) · 사실 원칙 `withFactGuard`(시스템 프롬프트 맨 앞 · 가드 `prompt.test.ts`). Claude 전용(다른 회사로 바꾸지 않는다).

- **⚠️ 사실 원칙은 모든 AI 호출에 예외 없이 붙는다 (원장 지시 2026-07-23, 불변)**: *"'팩트' '환각금지'
  '사실만 작성' '창작 금지' '추측 금지'도 항상 거쳐야 해."* → [`FACT_GUARD`](src/lib/ai/fact-guard.ts)가
  `generateJSON()` 안에서 **모든 프롬프트 앞에 자동 부착**(멱등). generateJSON을 안 거치는 자체 루프를
  새로 만들면 시스템 프롬프트에 같은 상수를 직접 이을 것 — 옛 대화형 비서(`runAssistantLoop`)는 2026-09-03 제거됐고,
  **지금 자체 루프는 학원 비서 하나**다(2026-11-06 · `buildSystemPrompt`가 `withFactGuard`로 잇는다). 나머지 AI 호출은 전부 `generateJSON()`.
  🔴 **호출부 프롬프트 본문에만 적지 말 것** — 본문은 원장이 화면에서 편집 가능(`ai_prompt_overrides`)이라
  편집 한 번에 가드가 사라진다. 지울 수 없는 자리(코드)에 둬야 "항상"이 성립한다. 문구 완화·삭제 금지
  (Vitest가 5개 원칙 단어를 잠근다). 항목별 세부 규칙은 호출부가 계속 담당 — 여기는 최소 공통 바닥.

- **외부 AI 전송 금지 필드(불변, 2026-07-16 명문화)**: 주민번호·계좌/카드번호·급여(`users.hourly_rate/monthly_base`·`payroll_records`)·
  이력서 `academy_documents.form_data`(restricted)·환불요청서 계좌 — **어떤 AI 프롬프트에도 넣지 않는다**(전송 전례 0,
  restricted RLS+재인증으로 잠근 대상). 학생 이름·학교·상담 내용 수준은 기존 관행상 전송 허용선.
  - **승인된 예외(원장 2026-08-03)**: **직원 계약서 스캔 PDF의 Claude 비전 전사(OCR)** — 종이 계약서 자동 인식을 위해
    스캔 이미지 전송을 원장이 명시 승인(질문·답변 로그 있음). 단 ① 전송은 전사 1회뿐, ② 이후 추출 프롬프트에 싣는
    텍스트는 [`maskResidentRegNo`](src/features/staff/contract/contract-extract.ts)로 **주민번호 뒤 7자리 항상 마스킹**(글자 PDF
    경로 포함), ③ `generateJSON({ document })`는 Anthropic 한정(폴백 없음 — 다른 provider로 첨부가 새는 것 방지).
    다른 스캔/이미지 전송을 새로 열 땐 이 예외를 근거로 확장하지 말고 다시 물을 것.
  - **승인된 예외(원장 2026-10-20)**: **학생 숙제 설명 영상의 화면(공책·교재 사진) Claude 판정** — 영상 설명 AI 참고 메모 한 기능에만
    (`generateJSON({ images })` Anthropic 전용 · 지점 스위치 `video_review` · 화면에 나가는 것은 분석 결과뿐). 이 승인도 다른 이미지 전송의 근거가 아니다.
- **usage 계측(0113a `ai_usage_logs`) + 지점 라이선스**: 모든 AI 호출부는 `generateJSON({ …, meta: { feature: "<호출부 식별자>", tenantId } })`를
  넘긴다 — 🔴 **`tenantId`는 필수**(2026-09-25, 타입 + 런타임 거절). 지점을 모르면 라이선스(ai_analysis)를 판정할 수 없어 꺼진 지점에서도
  AI가 새므로, 비어 있으면 `generateJSON`이 호출 전에 거절한다([`decisions/tenant.md`](docs/decisions/tenant.md) 지점 기능 라이선스). 사용량 기록 자체는 best-effort.

provider/모델 레지스트리는 `src/lib/ai/models.ts`의 `AI_MODELS`(티어×provider) + `resolveModel()`:

| Tier | Anthropic | DeepSeek | 용도 |
|---|---|---|---|
| `fast` | **`claude-haiku-5-5`**(2026-10-16 4.5→5.5 · 1/10 값 · temperature 미전송·effort low는 `generate.ts` `isClaude5Model`이 흡수) | `deepseek-flash`(V4.1 · 옛 이름 `deepseek-v4-flash`는 2026-10-19 교체 — 딥시크가 은퇴로 적음) | **학부모 멘트** `classnote_ment` + **학부모 글 만족도 판정** `parent_satisfaction`(강사평가 · 문구로 애매한 글만 · Claude Haiku 5.5 먼저 2026-10-26 — 그 전 10-13~ DeepSeek flash 먼저). 🔴 deepseek 폴백은 **v4-flash**(원장 2026-08-28 *"haiku -> 폴백 deepseek v4 flash"*) — v4-pro를 걸었더니 자동작성 한 번에 **86초**(추론 6,505토큰)라 폴백이 또 다른 장애가 됐다. flash는 7.3초. **되돌리지 말 것**(같은 날 *"flash 말고 v4 pro"*를 실측 보고 뒤집은 것). |
| `balanced` | **`claude-sonnet-5-5`**(2026-10-19 5→5.5 · 같은 값) | `deepseek-v4-pro`(폴백) | 경량 호출 기본값 + **전사 분석**(재원생 상담 분석 · 콜&상담 분석·폼 자동입력·회의록은 아래 고정) · 상담 준비 브리프 · 결석 문자 판별 · 출결 요약 · 공지 번역 — 전부 Claude 먼저(2026-10-26). |
| `reasoning` | `claude-opus-4-7` | — | **금지** (명시 요청 시만). reasoning은 Anthropic 고정. |

- **AI 회사는 둘 = Claude · DeepSeek.** 🔴 Upstage(Solar)는 뺐다(원장 2026-10-19 *"솔라는 빼버려. 두개면 충분"* — 품질 A/B 탈락으로 맨 뒤 예비였고 그날 키도 잔액 정지). 클라이언트·사다리·모델 칸 전부 지웠다 — 되살리지 말 것. 옛 기록의 `solar-pro3` 라벨만 남긴다.
- **폴백 사다리 = anthropic → deepseek** ([`FALLBACK_LADDER`](src/lib/ai/models.ts), 원장 2026-08-28). 한 provider가 **인증·한도·잔액 소진**으로 막히면 다른 쪽으로 넘어간다 — 🔴 **크레딧 소진은 400이라 예전엔 사다리를 안 탔다**([[#118]]: 2026-08-27 멘트 AI가 이틀간 전건 실패). ⚠️ 새 provider 오류 모양(402·`insufficient_quota` 등)을 만나면 `isCreditExhaustedError`에 추가할 것.
- **응답 길이 상한 바닥 = 64,000**(Claude 5 계열·DeepSeek) — [`OUTPUT_TOKEN_FLOOR`](src/lib/ai/generate.ts)(원장 2026-10-19 *"응답 길이 한도도 팍팍 늘려"*). 호출부 값이 작아도 이 값으로 보낸다(쓴 만큼만 과금 · Claude는 상한이 분당 출력 한도에 안 든다 · 생각 토큰도 상한에 들어 작으면 답 전에 잘린다). 사람이 화면에서 기다리는 기능(멘트·원생 AI 케어 — `waitsForAnswer`)만 Claude 16,000 · DeepSeek 32,000(`WAITING_OUTPUT_TOKEN_FLOOR` — 끝없이 이어지는 응답에 몇 분씩 기다리지 않게 · 옛 바닥보다 낮은 곳은 없다). 🔴 [`anthropic.ts`](src/lib/ai/anthropic.ts)의 `timeout`을 지우지 말 것 — 없으면 SDK가 상한 21,333 넘는 비스트리밍 요청을 "스트리밍 필요"로 던진다.
- **전역 기본 provider = Anthropic Claude Sonnet 5.5** (`AI_PROVIDER=anthropic`, 2026-07-13~ · 2026-10-19 5→5.5) — 품질 A/B에서 Solar가
  상담 분석의 warnings를 통째로 놓치고 잡담(주식 등)을 섞어 전환. 코드 기본값(env 미설정·옛 값 `upstage`)도 Claude다(2026-10-19 Solar 제거 뒤).
  DeepSeek을 기본으로 = `AI_PROVIDER=deepseek`.
- 🔴 **AI 1순위 = Claude · DeepSeek은 폴백만**(원장 2026-10-26 *"딥시크로 바꾼거 다 클로드로 전환"* · *"전사 분석은 전부 sonnet 5.5로 돌리고, 간단하고 빠르게
  작성해야하는 수업보고서 멘트는 haiku 5.5로"* · *"폴백으로 딥시크 남겨놔"* — Anthropic API 크레딧 지원). **전사 분석**(콜&상담 분석·폼 자동입력·회의록 =
  [`FEATURE_MODELS`](src/lib/ai/model-pins.ts) Sonnet 5.5 고정 · 재원생 상담 분석) · 상담 준비 브리프 · 결석 문자 판별 · 출결 요약 · 공지 번역 = **Sonnet 5.5**(추론 강도는 호출부가 안 정해 모델 기본 high) ·
  학부모 멘트 = **Haiku 5.5**(effort low) · 만족도 판정 = Haiku 5.5(기본 medium). 가드 [`claude-first.test.ts`](src/lib/ai/claude-first.test.ts) — 기능 코드가 DeepSeek을 먼저 고르면 실패.
  저장 전 후처리([`analysis-normalize`](src/features/enrollment/analysis-normalize.ts) · [회의록](src/features/meetings/analysis-normalize.ts) · [`form-normalize`](src/features/enrollment/form-normalize.ts))는 그대로 둔다(폴백 결과도 같은 모양).
  옛 결정(07-16 전사 분석 v4-pro · 10-19 V4.1 flash 블라인드 비교 수치)은 [`docs/decisions/reports-ai.md`](docs/decisions/reports-ai.md)에.
- **지점별 선택** = 운영 콘솔 학원 상세 **'AI 모델' 탭**(`tenant_ai_models`, 0375a) — 지점 선택 > 코드 기본 > 호출부 tier·provider
  (`featurePin`). 고른 회사가 막히면 평소 사다리로 넘어간다(고정한 모델 이름이 없으면 같은 회사 기본 모델로 한 번 더). 계약서 스캔 OCR은 고를 수 없다(Claude 전용 승인) · 멘트·원생 AI 케어(사람이 기다리는 기능)엔 느린 v4-pro를 고를 수 없다. 🔴 시험 안 한 기능을 코드 기본에 넣지 말 것.

### 녹음·회의 처리 (Solar 후보정 하네스 · 재처리 2종 · 회의 화자) → [`docs/decisions/ai-recording.md`](docs/decisions/ai-recording.md)
- 폼 자동입력 = `buildFormPatch` 후보정 하네스(grounding·echo·잡음 가드) — 새 "AI 추출→폼/DB 자동기입"도 이 가드를 통과한 값만.
- 회의 재처리 = 기둥 A '분석 다시 생성'(텍스트) / 기둥 B '전사부터 다시'(오디오, Supabase 서명 — Firebase 의존 0). 화자 = `ai_speaker_roles`(표시) + `speaker_staff`(직원 연결).
- DeepSeek = OpenAI 호환(JSON mode, 프롬프트에 "JSON" 필수) · 2026-10-26부터 **폴백 전용**(1순위는 Claude · Solar는 2026-10-19 뺐다).

### 키 분리 = 기능별 9그룹 (원장 2026-09-15 *"기능별로 키를 발급받아서 사용량 체크를 하려고"*)
**env 이름 = `<회사>_API_KEY_<그룹>`**(회사 = `ANTHROPIC`·`DEEPSEEK`). 그룹은 호출부 식별자(`meta.feature`)에서
[`FEATURE_KEY_GROUP`](src/lib/ai/models.ts)이 도출한다 — 🔴 **새 AI 호출부를 만들면 그 표에 한 줄**을 더할 것(가드
[`key-groups.test.ts`](src/lib/ai/key-groups.test.ts)가 빠진 것·죽은 것을 잡는다).

| 그룹 | 호출부(meta.feature) | 지금 1순위 |
|---|---|---|
| `MENT` | classnote_ment · english_ment · ment_prompt_preview · ment_style_profile · love_note_draft(사랑의 한마디 초안 버튼) · lesson_report_rating(평점 정기 처리 · 기본 꺼짐) | Claude(Haiku·Sonnet) |
| `MEETING` | meeting_analysis | Claude(Sonnet 5.5) |
| `ENROLLMENT` | enrollment_analysis · enrollment_form_extract · enrollment_prep_brief | Claude(Sonnet 5.5) |
| `CONSULTATIONS` | consultation_analysis · student_care · student_consultation_rating(원생상담 평점 — 배치 · 구독 CLI 백필, 2026-11-11) · student_flow_consultations · student_flow_timeline(원생 흐름 분석 — 상담 저장 뒤 합산 · 타임라인 밤 배치 · 연결 탐색 카드, 2026-11-03) | Claude(분석 Sonnet 5.5 · 케어 · 흐름 Sonnet 5.5) |
| `BRIEFING` | daily_briefing · dashboard_secretary(업무 비서 'AI로 정리' · 누를 때 + 예약 01:00 · 13:00 — 화면이 남긴 후보만) | Claude |
| `ATTENDANCE` | attendance_recap · parent_attendance_intent · parent_attendance_jev_shadow · parent_satisfaction | Claude(요약·결석 판별 Sonnet 5.5 · 만족도 Haiku 5.5) · TypeSafe(비교 전용) |
| `STUDENT_ONTOLOGY` | student_positive_signal · student_ontology_summary | 긍정 신호 밤 판정 / 명시 버튼의 최근 기록 발췌 요약 · Claude 전용 키 · fast/low · 다른 회사 폴백 없음 |
| `NOTICE` | notice_translate | Claude(Sonnet 5.5) |
| `STAFF` | staff_contract_pdf · staff_contract_pdf_ocr | Claude(OCR은 **Claude 전용**) |
| `VIDEO` | video_review_judge · video_review_verify | Claude(판정 Haiku · 확인 Sonnet · 밤 배치) |
| `ASSISTANT` | academy_assistant(학원 비서 — 원장 자연어 질의 · 자체 도구 루프라 `recordUsage`로 센다, 2026-11-06) | Claude 전용(강도 적음 Haiku · 보통 Sonnet · 강함 Opus 5.5) |

- **키 고르는 순서 = 그룹 키 → 옛 버킷 키(`_CONSULTATIONS`) → 기본 키**(`resolveKeyEnv`). 그룹 키가 아직 없어도
  기본 키로 돌아 **멈추는 기능이 없다**(키를 하나씩 넣는 동안의 안전장치).
- 🔴🔴 **기본 키 둘(`ANTHROPIC_API_KEY`·`DEEPSEEK_API_KEY`)은 절대 지우지 말 것**(`UPSTAGE_API_KEY`는 2026-10-19부터 안 쓴다) — 그룹 키를
  다 넣었어도 **표에 없는 기능·`meta`를 안 넘긴 새 호출부의 유일한 안전망**이다. 지우면 그 호출이 에러가 아니라
  **조용히 다음 회사로** 넘어가 모델과 품질이 바뀐다(환경변수를 정리할 때 "이제 그룹 키가 있으니 기본 키는 중복"으로
  읽히기 쉬운 자리라 못박는다).
- 🔴 **2026-09-15부터 Anthropic도 기본 키로 넘어간다** — 예전엔 `ANTHROPIC_API_KEY_CONSULTATIONS`가 없으면 Claude를
  통째로 건너뛰었는데(빌링 분리), 그 규칙이면 키가 아직 없는 기능이 **조용히 DeepSeek으로 바뀐다**(멘트 품질이 달라진다).
- **어느 키로 불렸는지는 `ai_usage_logs.key_name`**에 남는다(`ment`·`consultations`·`default`). 기본 키로 넘어간 호출은
  `default`로 찍히니 **빠진 키가 표에서 드러난다**. 기능별 토큰·비용은 이 표가 이미 기능 단위로 쌓고 있고, 키를 나누는 것은
  각 회사 콘솔에서도 기능별 청구액을 보기 위해서다.

---

## 데이터 모델 핵심 결정

- `enrollments`는 평면 테이블 + GiST EXCLUDE 제약 → 좀비 enrollment 클래스 자체가 사라짐
- 학생 자연키는 `(tenant_id, name_normalized, school, grade) WHERE status<>'withdrawn'` 부분 유니크 인덱스
- AI 분석 결과는 `print_payload jsonb` 스냅샷으로 동결 — 모델 변경에도 인쇄물 불변

---

## 학원 설정(`/owner`) — 설정은 "소비처까지" 배선해야 끝 (⚠️ write-only-orphan 금지)

**모든 학원(테넌트) 단위 설정은 단일 읽기/쓰기 경로를 거친다** — AI의 `generateJSON()`과 같은 단일 진입점
원칙. 기능 코드에서 `tenant_settings`를 직접 SELECT/UPDATE하지 말 것.

- **저장(쓰기)**: `saveOwnerSection`([`src/features/owner/server/actions.ts`](src/features/owner/server/actions.ts)) —
  master 게이트 → `SECTION_SCHEMAS`([`settings-types.ts`](src/features/owner/settings-types.ts)) Zod 검증 →
  `tenant_settings.data` jsonb에 **섹션 단위 머지 upsert**(다른 섹션 보존) → `audit_logs`(`owner_settings_update`)
  → `revalidatePath("/", "layout")` + `/owner`.
- **조회(읽기)**: `getTenantSettings()`([`src/features/owner/server/queries.ts`](src/features/owner/server/queries.ts),
  React `cache`) → `resolveSettings()`([`resolve.ts`](src/features/owner/resolve.ts))가 저장된 부분값을
  `DEFAULT_SETTINGS`([`defaults.ts`](src/features/owner/defaults.ts))에 deep-merge해 **항상 완전한 `TenantSettings`**
  반환(배열·원시는 교체, 객체는 재귀 병합). 비로그인/키오스크(service_role)는 `getTenantSettingsByTenantId(tenantId)`.
- **스키마 = 단일 소스**: `settings-types.ts`의 Zod에서 타입 추론. 섹션 4개(profile/operations/billing/notifications).

### ⚠️ 이 영역의 유일한 버그 패턴 = "저장은 되는데 아무도 안 읽음(write-only-orphan)"
쓰기·검증·머지·감사로그 인프라가 견고해 **저장 실패(broken-write)는 거의 안 난다.** 대신 스키마+폼에 필드만
추가하고 **소비처(consumer)를 안 만들어**, "저장됨 토스트는 뜨는데 화면/문서/메시지는 그대로"인 **거짓 약속**이
생긴다. 2026-06-19 전수 배선 감사: 편집 가능한 25개 필드 중 **11개만 정상 배선, 12개 orphan, 2개 미구현.**

**설정 필드 1개를 추가/변경할 때 5단계를 전부 끝내야 "완료"다:**
1. **스키마** — `settings-types.ts` 섹션 Zod에 필드 추가.
2. **기본값** — `defaults.ts`의 `DEFAULT_SETTINGS`에 같은 키 추가(없으면 deep-merge 폴백이 깨져 `undefined` 누출).
3. **폼** — 해당 `*-section.tsx`에 입력 추가(섹션 폼은 이미 `saveOwnerSection`에 배선됨).
4. **소비처(필수)** — 실제 기능 코드가 `getTenantSettings()`로 값을 읽어 **동작이 바뀌게** 한다.
   하드코딩 상수(`globals.css`의 `--primary`, `periods.ts`의 교시 enum 등)를 **설정값으로 대체**하는 게 핵심.
5. **검증** — 값을 바꿔 저장한 뒤 그 기능에서 실제로 반영되는지 확인. `grep "settings\.<section>\.<field>"`(또는
   해당 필드명)로 소비처가 **≥1곳** 나와야 한다. **안 나오면 그 필드는 UI에 노출하지 말 것**(거짓 약속 방지).

> **한 줄 규칙: 소비처(`getTenantSettings`로 읽어 동작이 바뀌는 코드)가 없는 설정은 만들지도, UI에 노출하지도 않는다.**

### ⚠️⚠️ 운영체계 enum 하드코딩 절대 금지 — "설정 무시"는 orphan보다 더 흔하고 심각하다 (2026-06-19)
위 orphan(저장됐는데 안 읽음)의 **역방향**이 코드 전반에 더 만연했다: **과목·학년·직급·교시 같은 운영 enum을
화면/필터/표시/선택지(consumer)에 코드로 하드코딩**해, **학원설정(`operations.*`)을 바꿔도 화면이 안 바뀌고
설정에 없는 값이 새어나오는** "설정 무시(settings-ignored)" 버그. 2026-06-19 전수감사(멀티에이전트)에서 **48건 중
20건 위반**(17개 파일) 적발 — 대표 증상: 학생목록·수업목록·성적관리 과목 드롭다운에 **설정에 없는 "예술(arts)"이
하드코딩으로 노출**(`SUBJECT_FILTERS`/`SUBJECT_META`). 전부 설정 기반으로 배선 완료.

**규칙(불변): 운영 enum의 라벨·색·옵션·선택지·엑셀출력 등 모든 소비처는 학원설정을 단일 소스로 읽는다. 하드코딩 금지.**
- **과목** = `buildSubjectMaps(settings.operations.subjects)`([`src/features/owner/subjects.ts`](src/features/owner/subjects.ts))의
  `.labelOf(key)`(한글 라벨)·`.colorOf(key)`(PillColor)·`.options`([{value,label}])·`.filters`([전체,...설정과목]).
  색 클래스는 같은 모듈의 `SUBJECT_SOFT`/`SUBJECT_SOLID`/`SUBJECT_BORDER`/`SUBJECT_ICON_BG`[colorOf(key)].
- **학년** = `settings.operations.gradeLevels`. **직급** = `settings.operations.jobTitles`. **교시** = `weekdayPeriods`/`weekendPeriods`.
- **읽는 법(컴포넌트 종류별)**:
  · **서버 컴포넌트/서버 모듈** = `getTenantSettings()` + `buildSubjectMaps(...)` **직접**.
  · **클라이언트(`'use client'`)** = **부모 prop 배선 없이** [`useSubjectMaps()`/`useGradeLevels()`](src/features/owner/operations-context.tsx)
    훅으로 읽는다. `(shell)/layout.tsx`가 3경로(embed창·미니셸·풀셸) children을 `OperationsProvider`로 감싸
    `settings.operations`를 주입하므로, 창(iframe) 안 컴포넌트까지 전부 커버된다. 클라에서 `getTenantSettings` 직접호출 금지.
- **금지 패턴(이름 불문)**: `SUBJECT_META`·`SUBJECT_LABEL`·`SUBJECT_COLOR`·`SUBJECT_OPTIONS`·`SUBJECT_FILTERS`·`GRADE_FILTERS`·
  `GRADES` 등 **과목/학년 라벨·색·선택지를 코드에 박은 상수**. 새로 만들지도, 남기지도 말 것. (단 [`subjects.ts`](src/features/owner/subjects.ts)의
  `LEGACY_LABELS`/`LEGACY_COLORS`는 **미등록 키 표시 폴백**이라 의도적 — 선택지(options/filters)엔 안 섞고 labelOf 폴백으로만.)
- **알려진 예외(KNOWN_EXCEPTION, 스키마 한계)**: ~~① 영어 교시 `ENGLISH_PERIODS`~~ → **✅ 해소(2026-07-06)**:
  `subjects[].weekdayPeriods`(과목별 평일 교시, 과목 운영 탭) 신설 — `weekdayTableFor(subject, config)`가 과목 전용 →
  english 내장 → 전역 순 폴백(`ENGLISH_PERIODS`는 무설정 폴백 상수로만 잔존). ② 레벨테스트 `SUBSCORE_KEYS`(과목별
  세부점수 차원) — operations 스키마 밖 도메인 메타, 스키마 확장 시 전환.
- **시스템 역할(`SystemRole`: master/teacher/accountant/student…)·요일·학생상태·시험유형은 운영 enum이 아니다**(코드 고정) — 이 규칙 대상 아님.

> **한 줄 규칙: 과목/학년/직급/교시 라벨·색·선택지를 코드에 적지 말 것. 서버는 `buildSubjectMaps(getTenantSettings)`, 클라는 `useSubjectMaps()`/`useGradeLevels()`.**

#### 과목 내부 키(`subjects[].key`)는 학원장이 손대지 않는다 — 자동 확정·불변 (2026-06-19)
운영 과목 편집기([list-editors.tsx](<src/app/(shell)/owner/_components/list-editors.tsx>) `SubjectListEditor`)에서 학원장은 **과목명(한글)+색만** 입력한다.
key(DB 식별자)는 **자동 확정**: 과목명 입력 후 blur 시 1회 — 흔한 이름이면 표준 키([`KNOWN_SUBJECT_KEYS`](src/features/owner/subjects.ts): 수학→math·영어→english…),
없으면 `subject_N` 폴백. 확정 후 라벨을 바꿔도 **key 불변**(바꾸면 기존 반·성적 데이터 연결이 끊김=orphan).
표준 키를 받으면 코드 특수동작(영어 10교시·math/english 세부점수)을 상속. **key를 다시 편집 가능한 input으로 되돌리지 말 것**(orphan footgun).
- **중복 방지**: 같은 과목명(라벨)·키는 편집기에서 빨간 경고 + 저장 시 `operationsSchema.superRefine`가 거부(이중 방어, settings-types.ts).
- **통일성 결정(2026-06-19)**: `수학(심화)`는 보편 과목이 아니라 학원 고유 과목으로 보고 표준키 `highmath`를 폐기 → `subject_1` 계열로 통일.
  사전(KNOWN_SUBJECT_KEYS)에서 수학(심화) 제거 + `defaults.ts`도 `subject_1` + 데모 데이터 마이그레이션 완료
  (`scripts/_poc_migration/migrate-highmath-to-subject1.cjs` — settings·classes 15·users.subjects[] 4행, ⚠️ users는 text[] 배열이라 array_replace).
  ~~앞으로 과목 키를 폐기·교체할 땐 이 6 테이블 + users.subjects[] + tenant_settings 전부 함께 마이그레이션~~ →
  **✅ 정석 경로 = 과목 운영 탭 "삭제 → 다른 과목에 흡수"(2026-07-06)**: [`absorbSubject`](src/features/owner/server/subject-actions.ts)가
  과목 키 저장 표면 **전수**(스칼라 9테이블: classes·enrollment_consultations·student_consultations·student_grades·exams·
  level_tests·grade_goals·grade_comments·textbook_catalog + `users.subjects[]` + jsonb 2곳: `subject_details`·`subject_progress`
  + `tenant_settings` 행 제거)를 이동. users/jsonb는 **0077a RPC `absorb_subject_key`**(원자 단일 문 — 동시저장 레이스·타임아웃 없음).
  ⚠️ **새 subject 컬럼/jsonb를 추가하면 subject-actions.ts의 SCALAR_TABLES(또는 RPC)에도 추가**(놓치면 raw 키 누출).

### 배선 현황·DB 미구현 목록 → [`docs/decisions/settings-wiring.md`](docs/decisions/settings-wiring.md)
- 🔴 설정 면(탭)을 더하거나 이름·묶음을 바꿀 땐 [`OWNER_FACES`](src/features/owner/tabs.ts) 한 곳만 — 화면 탭 · 사이드바 · 설정 메뉴 판이 파생한다(그 파일의 '설정 면 목록 = 한 곳 · 범주 5개').
- 🔴 운영 섹션(`operations`)을 저장하는 코드를 만지기 전 그 파일의 '운영 섹션 저장 계약'을 읽을 것 — 요청 형식 넷 · 통째 교체 금지 · 순번은 섹션 안([[#142]]).
- 설정 필드를 "동작 예시"로 인용하거나 새 설정을 추가할 땐 그 파일의 ✅/🚫 목록을 먼저 확인. 비로그인 화면의 학원 브랜드는 `getPublicBranding()`(세션 없는 `getTenantSettings()` 금지).

## 📂 상세 문서 (필요할 때만 Read — 포인터, `@import` 아님)

아래는 **경로 언급(포인터)** 이라 Claude가 그 영역을 만질 때만 Read한다 → 평소 토큰 0. **`@docs/...`(import)로 바꾸지 말 것** (import는 인라인 전개라 매 세션 로드 = 토큰 절약 0).

- **이미 내린 결정의 본문(🔴 재제안 금지 조항·근거)** → `docs/decisions/<영역>.md` (아래 결정 로그 인덱스에서 영역 파일을 고른다)
- 날짜별 구현 로그 / "뭘 이미 해봤나" → `docs/changelog.md`
- UI·화면·폼·컴포넌트 규칙 → `docs/design-conventions.md` (요약은 아래 "디자인 규칙 인덱스")
- 막혔을 때 / 함정 상세·재현·원인 → `docs/gotchas.md` (트리거는 아래 "막힌 점 인덱스")
- 셋업·마이그레이션·git 협업·검증 게이트·데모 계정·남은 작업 → `docs/setup-and-ops.md`
- 로그인 지속·세션 정책(자동 로그인 = 회전 끔) + **외부 SaaS 전환 시 되돌리기** → `docs/auth-session-policy.md`
- ClassNote 발송(수업보고서→학부모) 구조·운영·트러블슈팅 → `docs/classnote-integration.md` (⚠️ ClassNote를 만지기 전 필독 — 보드 명명 A~G 접미사·안전 가드·알려진 구멍·테스트 학생 '학원이')
- 인프라 비용·소진 예측("사이버 월세" — Vercel·Supabase·AI/전사 API) 설계 → `docs/infra-cost-runway-plan.md` (⚠️ **보류 중**, 미구현. 선불 키 소진·요금 급증이 실제로 문제되면 그때 재개)
- **도메인 구매한 날 할 일**(옛 호스트 308 켜기·env·Supabase Site URL·기기 재로그인) + 지점 하나 더 만드는 날 → [`docs/domain-cutover.md`](docs/domain-cutover.md) (코드는 전부 env로 켜지게 준비돼 있다 — 2026-09-18)
- 탭 아이콘을 새로 만들 때(어떤 이미지 생성 모델이든 같은 세트가 나오게) → [`docs/icon-generation.md`](docs/icon-generation.md) (화풍 규격·브리프 뼈대·후처리 파이프라인 [`scripts/_icons/`](scripts/_icons)·배선 4곳·실패 사례)
- **시간표 연습실**(다음 달 시간표를 여러 안으로 짜 보는 편집기 — 계획·검토·단계별 결과·남은 일) → [`docs/timetable-lab/README.md`](docs/timetable-lab/README.md) (앱 화면 = `/timetable/editor` · 편집기 본체 = `src/features/timetable-lab/editor` · 로그인 없이 띄우는 시험용 화면과 브라우저 시험 = `experiments/timetable-lab-p0`)
- 기타 심층 문서 → `docs/` (audit-log · ijw-feature-port · makeedu-reverse-sync-v1 · payment-collection-plan · perf-open-window-backlog 등)

> ⚠️ 새 기능·배선을 완성하면 그 요약을 `docs/changelog.md`에 한 줄 추가(진행 상황 로그). 새 함정을 만나면 `docs/gotchas.md`에 항목 추가 + 아래 인덱스에 트리거 한 줄. 새 UI 규칙은 `docs/design-conventions.md` + 디자인 인덱스.

## ✅ 이미 내린 결정 — 다시 제안·질문하지 말 것 (Decision Log)

이미 확정된 결정이다. **재제안·재질문 금지.** 바꿔야 할 새 근거가 생기면 "이건 이미 X로 정해졌는데, 이런 이유로 재검토할까요?"라고 **명시적으로** 물어라(조용히 뒤집지 말 것).

- **수업 나누기 = 수강이 아니라 별도 표(0351a `class_splits`) · 원래 반은 그대로** — 🔴 2026-10-06부터 꺼 둠([`CLASS_SPLIT_ENABLED`](src/features/class-splits/access.ts)) · 받는 반에 수강행을 만들지 말 것 · 본문 → [`timetable.md`](docs/decisions/timetable.md) '수업 나누기'

> 🔴 **아래는 제목만 있는 인덱스다. 그 영역을 만지기 전에 해당 `docs/decisions/*.md`를 반드시 Read** — 🔴 금지 조항·단일 소스 파일·실측 근거는 전부 그 파일에 있다. **새 결정은 해당 파일에 추가하고 여기엔 제목 한 줄만** 더한다(본문을 여기 쓰지 말 것 — CLAUDE.md가 비대해져 매 세션 토큰을 먹는다). `@docs/...` import로 바꾸지 말 것.

### 멀티테넌트·지점·브랜드·제품 이름 → [`docs/decisions/tenant.md`](docs/decisions/tenant.md)
- 운영 콘솔의 '원장 화면 열기' = 읽기 전용 지점 보기(0356a) · 로그인은 운영자 본인 그대로 · DB가 읽기 전용 요청에만 그 지점으로 답한다 · 🔴 판정은 `tenantViewState()` 한 곳
- 운영 콘솔 'AI 모델' = 지점·기능별 모델 선택(0375a) · 고르지 않으면 코드 기본 · 고른 회사가 막히면 평소 사다리 · 표가 없으면 기본값으로 돈다
- 지점 기능 라이선스 = 슈퍼관리자 카드가 실제로 막는다 · 행이 없으면 허용 · 켜진 지점(침산)은 그대로
- 실험실 메뉴 = 운영 콘솔 배정 표(`lab_menu_assignments`) 하나가 원본 · 코드에서 메뉴를 끼워 넣지 않는다 · 판정은 `isLaboratoryMenuAvailable` 한 곳
- 학원 설정 '연동' = 켜진 연동만 내부 탭 · 슬랙 규칙 = 한 줄 목록 · 역할별 기본 세팅 5종(원장·관리자·매니저·선생님·셔틀)
- 슬랙 연동 = 지점 스위치(기본 꺼짐) · 규칙(무엇을·어디로·어떻게·언제) · 같은 트랜잭션 인박스 + 아웃박스(created_at 커서 금지) · 이메일 일치는 후보일 뿐 · 급여·이력서 등은 발송 불가 · 잔디는 웹훅뿐이라 기각
- 연결 앱(오늘 수학) = 지점 스위치(기본 꺼짐) · 왼쪽 '연결 앱'의 보통 링크(새 탭) · 명단·진도 API도 같은 스위치 · 영어 선생님(담당 과목이 영어뿐)에겐 안 보인다 · 자동 로그인 = eywa 사용자 id(`sub`)로 처음 한 번 비밀번호 연결(이메일은 신원 아님)
- 연결 앱 권한 = 역할·권한 '연결 앱 권한' 표(역할별 표 아래 · 2026-11-05) · 오늘 수학 기본 강사 이상(원장·관리자·매니저·강사) · 새 연결 앱은 전부 꺼짐 · 판정은 본인 권한 표(링크·출발·로그인 코드 발급까지 · 꺼지면 오늘 수학 로그인 안내로) · 명단 동기화는 그대로
- 오늘 수학 사용 메뉴 = 오늘 수학 한 곳에 저장 · 에이와 원장 ↔ 오늘 수학 지점 원장이 같은 값 · 오늘 수학 최고관리자가 연 메뉴 안에서만 · 감사 기록 양쪽
- 학생 상세 '오늘 수학' 탭 = 지금 수학 재원생에게만(지난 수강·지난 반 없음) · 한국어 화면 문구의 제품 이름 표기 = 에이와(코드·도메인·영문 문구는 aywa 그대로)
- 이용 분석(슈퍼관리자만 봄·지점 비공개) = 활동 시간 기본 · 화면 시간 대조 · 권한(강사는 과목별)·지점 묶음만 · 사람별 표 없음 · 슈퍼관리자 계정은 안 셈 · 새 셸 첫 칸 라우트·새 크롬 층은 계측 배선도 함께
- 제품 이름 = aywa · 도메인 `www.aywa.co.kr` · 저장 키·외부 연동 이름은 eywa 그대로
- 멀티테넌트 = 하나의 Supabase DB(공유 DB + `tenant_id` + RLS) 유지 · 테넌트마다 프로젝트를 두지 않는다
- 멀티테넌트 URL = 지점을 URL에 넣지 않는다(C안) · 로그인 전 화면은 "회사 브랜드" 하나 · 지점을 알아야 하는 로그인 전 화면(자리 PIN)은 화면에서 지점을 고른다
- AI·워커도 지점(테넌트) 단위로 가른다 — 큐를 집는 쪽이 제 지점 것만 집는다
- 새 지점 = 일반판(방향 B) · 침산은 손대지 않는다 — 판정은 설정 행 하나
- 기능 스위치(모듈·라이선스)가 꺼지면 "있었는지조차 모르게" — 버튼·칸·배지·서버·워커 전부 · 꺼진 주소는 없는 주소와 똑같이 첫 화면으로
- 테넌트 `injaewon` = 프로덕션 실데이터

### 성적관리 → [`docs/decisions/grades.md`](docs/decisions/grades.md)
- 성적 원장 열 머리 = 정렬은 시험일·이름·점수·증감만 · 학교학년·반·담임·시험·시험정보는 엑셀식 값 필터(주소 규칙 `value-filter.ts` 한 곳) · 점수 칸 제목 '점수'(필터는 비율 그대로)
- 수학 시험 칸 = 중간·기말·월말평가(내신 한 칸 폐지 2026-10-14 · 옛 내신 49건은 2학기 중간으로 옮김 · DB가 수학 내신 저장을 막는다 0363a) · 시험정보 표기 `26-2-중간`
- 성적 추이 제목 = 데이터와 같은 강사 범위 판정 · 응시 학생은 선택 조건의 기록 보유 학생
- 성적관리 = 시험을 등록하지 않는다 · `년도 · 학기 · 과목 · 반 · 시험` 격자 하나
- 성적관리(`exams`) = 강사는 담임·부담임 반만, 부원장·관리자는 모든 반

### 출석부·보강·출결 귀속·자리 → [`docs/decisions/attendance.md`](docs/decisions/attendance.md)
- 강사 출결 쓰기 학생 자격 = 단건·일괄·범위 한 벌(`write-eligibility.ts`) · 기존 기록은 정정만(다른 교시 새 행 불가) · native·수업 나누기는 모든 경로에서 근거(2026-11-09)
- 강사 전체 보기 = 그 달 뒤에 담임이 된 반은 안 선다(표시만 · `teacherSheetClasses`) · 금액 이월 걸린 줄은 등록 차수 주황(표시 전용)
- 휴원일 출결 = 학원설정 목록 단일 판정 · 예정 분모 없음 · 실제 기록만 범위 내 조회 · 자리 PIN은 읽기 전용 미전송 · 원스크린은 안내 띠 + 일괄 출결만 확인(명단은 비우지 않는다) · ECS 오늘 보드 일괄 출석도 확인
- 출석률 = (출석 + 지각) ÷ 기록 칸 전부 · 보강은 출석이 아니다 · `attendedCount` 한 곳 · 정정 줄은 최신 하나만
- 보강 예약도 '+ 보강 학생 추가'처럼 합침/분리 · 기록할 반을 묻는다(정규 수업일만 · 옛 예약은 합침) · `class_id` = 기록할 반, 결석 칸은 `absenceClassOf` · 원스크린 세 곳에 '보강 예약' 표식 · 합침·표식은 세션 복원 뒤 · 원스크린 합치기↔나누기 = 같은 반 정규 줄만·시수 불변
- 보강 예약 = 별도 표(0264a), 출결 행이 아니다 · 교시는 학원설정 교시표에서만 · 이행은 보강일 출결 저장이 자동으로
- 보강 합침(정규+보강) = 기록 없음·출석·지각·조퇴 칸만 · 조퇴는 조퇴 그대로(출석으로 접지 않는다)
- 수업 / 자리(JJ실·랩실) 몫 = 시간표 기준 + 회차 확정 '자리 몫' 줄에서 숫자로 조정(19/5 → 20/4) · 반 전체 값 + 학생별 값 · 날짜를 고르지 않고 출결도 안 바꾼다(등록 차수 몫 = 실급여 상한만) · 칸을 넘기는 입구(날짜 고르기 · 칸 우클릭)는 전부 걷었다
- ~~JJ실 시수 넘기기 = 그 칸의 JJ실 기록을 한 선생님 몫으로(`taught_by`)~~ → 입구 없음(2026-10-07 저녁 · 읽는 쪽 코드만 남았다 — 되살리지 말 것)
- '합계 및 실급여 보여주기'는 달마다 따로 켠다 — 선생님 × 달 한 줄(0353a·0353b)
- '합계 및 실급여 보여주기' = 선생님별 스위치(0352a) · 켜면 관리자 화면과 그 선생님 본인 출석부 둘 다 · 누르는 사람의 보기 설정이 아니다
- 월별 출석부(관리자) 상단 = 툴바 한 줄 + 표 위 한 줄 · 실급여는 토글 · 실급여는 청구액을 넘지 않는다 · 제목행 가운데
- 월별 출석부 강사 보기 = 그 강사가 수업하는 날·교시만 · 빗금 없음
- 메모·사유 툴팁은 카드다 · 시간표 보강 박스는 병합을 쪼개지 않는다 · 빗금 칸은 "누가 찍었나"를 말한다
- 강사 보기 저장은 자리(JJ·랩실) 기록을 건드리지 않는다 · 운영실 '최근 결석' = 어제까지 7일(2026-10-20 · 옛 '어제 하루')
- 수학 출석 시수 = 그날 수업 길이로 자동 · 새 칸에만 · 숫자를 친 건 그대로
- 자리(랩실) 드래그 = 다른 시간으로만 · 그 반·그 학생의 다른 수업 시각은 막되 끄는 동안 보인다
- 자리(랩실·JJ실) 출석부의 결석 사유 = 마우스 오버로만, 공개 PIN엔 안 내려보낸다
- 보강은 "보강을 받는 반·날짜" 축에서만 추가한다 — 자리(LAB실·JJ실) 출석부는 출결 전용
- 보강 보고서 반 = 보강 출결 칸 반 = 발송 반(단일 소스 `makeup_class_id`) · 대신 보강은 학생의 원래 반 · 그 칸 시수는 보강한 강사 몫(`taught_by`)
- 발송 '성공' 보강 보고서의 칸은 출석 칸 지우기에서 지운다(급여 시수 · 보고서·보강 예약은 그대로 · 애매한 발송 상태는 막는다 · 2026-11-05)
- 출결의 강사 귀속 축 = [`teacher-axis.ts`](src/features/attendance/teacher-axis.ts) 단일 소스
- 강사 보기에서 친 그날 합계는 그 강사 교시에만 나눈다 — 몫 판정은 서버가 화면과 같은 함수로
- 출석부 메뉴 기본 착지 = 월별 출석부
- 기간 단위 = 세션(`operating_periods`) 단일 소스, 미정의는 달력월 폴백

### 시간표(드래그·가져오기·예약·담임·배치 이력) → [`docs/decisions/timetable.md`](docs/decisions/timetable.md)
- 시간표 배치의 강의실 = 등록된 강의실만(표에 문 s2_0017 · 연결이 있으면 라벨 = 그 이름 · 숫자만이면 하나로 맞을 때 잇고 못 맞추면 거절) · 반 수정에서 강의실을 바꾸면 라벨도 따라간다(2026-11-02)
- 종강 = 시간표 배치도 종강일로 닫는다(닫은 줄은 종강 기록에 · 재개강이 되살린다) · 시트 가져오기는 종강일이 지난 반을 없는 반으로 본다(2026-11-02 · LS4b "제거" 혼란)
- 시간표(개발중)(`/timetable-dev`) 제거(2026-10-23 · 편집기로 대체 · 계획 칸 표 `timetable_plan_slots`도 지움 0451a)
- 영어 강사뷰 칸 메모 = 날짜 칸마다 우클릭 메모(0395a) · 수업 칸은 정보 카드 오른쪽 2열 · 강사 열쇠 = users.id(이름 글자 아님) · 표 옆 레이어(격자 다시 안 그림) · 자동 저장 + version 비교 · 문 = `memoSheetAccess`
- 영어 시간표 오른쪽 '메모 시트' = 엑셀처럼 쓰는 자유 판(0374a) · 영어 통합뷰만 · 시간표 판 | 시트 판 화면 폭 하나씩(서로 밀지 않는다) · 자동 저장 + version 비교 · 문 = `memoSheetAccess`(강사 화면 없음 · 편집 = 시간표 '전체') · 침산만 구글 시트 '퇴원생 명단' 그대로, 다른 지점은 빈 판
- 수학 '시트에서 가져오기' = 시간표 격자 탭을 읽어 **새 반 만들기 + 학생 이동·추가·종료**를 적용일부터 반영 · 그 밖의 편집(기존 반의 시간·강사·강의실 · 반 이름 · 휴원)은 이유와 함께 알리기만 · 자리 번호가 아니라 머리 행·교시 라벨로 · 기준선은 시트의 내보내기 기록(DB 아님)
- 시간표 첫 과목 = 담당 과목 · 링크에는 과목을 항상 싣는다 · 담당 과목은 기본 선택에만(권한 아님)
- 시간표 연습실 = 운영과 분리된 개인 연습본(영어 먼저) · 충돌해도 놓고 이유 표시 · 학생 반 이동은 옮겨 간 반 전체 수업 · Supabase 저장 · 운영 반영 경로는 아직 없다
- 시간표 편집기 = 시간표 오른쪽 도구줄 버튼 → 자기 창(`/timetable/editor`) · 권한은 `canUseTimetableEditor` 한 곳(시간표·반 둘 다 관리) · 없던 것도 만든다(수업·반·회의·강사·학생) · 막는 것은 운영시간 밖과 잠근 수업뿐
- 시간표에는 인원 숫자가 없다(2026-09-28 삭제) · 셀의 신입·반이동·대기·퇴원 표시는 30일·60일 그대로 · 예외 = X 겹침
- 시간표 X = 마우스 옆 석 달 퇴원(수강종료 포함) · 🔴 줄은 퇴원관리와 같은 조회 · 담당은 강사평가 퇴원율이 낸 값(새로 판정 안 함) · 강사 탓 아닌 사유는 줄만 긋고 제외
- 반 블록 드래그 = 화면에 보이는 블록 통째로 · 학생·강사·강의실·같은 반 넷을 보고 갈 수 있는 칸만 칠한다
- 시간표 드래그는 화면을 다시 그리지 않는다 — 픽업이 곧 체감 성능
- 시간표는 '모드'가 없다 — 여는 것은 더블클릭, 옮기는 것은 그냥 드래그, 반영은 저장
- 시간표 '학생 명단 접기' = 계정 귀속 표시 설정, 접으면 행 높이도 함께 줄인다
- 시트가 사람을 직책으로 적는 칸은 가져올 때 닉네임으로 바꾼다
- 예약된 반 이름 변경(개명) 예고는 "예약된 때부터 그날까지 내내" 뜬다
- 담임 변경은 "시트가 바뀌는 날"부터 — 즉시 적용하지 말 것
- 영어 반 담임 = 한국인 강사 중 그 반에 가장 많이 들어가는 사람 · 원어민은 담임을 맡지 않는다
- 시간표 통합뷰 `*LAB` 임시 칸 = 교시 이동·고정 학생 때문의 표시 전용 칸 · 수업설정엔 안 쓴다
- 영어 반 프로그램 구분(EiE / 인재원 영어) = `classes.english_track` 단일 소스
- 지난 주 담임 = 기록으로 복원
- 시간표 배치 이력 = `class_schedules` 행 분할(덮어쓰기 금지)
- 시간표 가져오기 = 적용일을 고른다(과거 금지·상한 180일) + 충돌 확인 체크리스트를 통과해야 적용

### 강사 시트(ECS·MCS)·진도맵·교재 → [`docs/decisions/sheets.md`](docs/decisions/sheets.md)
- 수학 학습 진도맵(시안) = 숨은 기능 · 관리자(admin) 이상 + super_admin · 수학 전용 · 아직 샘플 데이터
- MCS 색 규칙은 한 벌 — 실제 진도(현재·도달·완료) = 파랑 · 목표 = 빨강 · 막대·진도 시계·범례·월별 타임라인·차시 점 전부
- 수업 회차 미룸·당김 = **실제 진도를 같은 요일·교시로 한 주씩 민다/당긴다**(미룸은 누른 칸을 복사해 둔다 · 토글 아님 · 원장 2026-10-15) — 원래 월간계획은 고정, 표식은 아직 안 가져온 칸의 일정용
- 영어 시트의 '월간계획'과 '실제'는 다른 물건이다 — 계획은 교재 배정에서 *계산*하고, 실제로 들어가는 길은 월간 화면의 [월간계획 전체 가져오기] 하나뿐(교시 한 칸 가져오기 폐기)
- 원래 월간계획 ↔ 실제 비교 = 교시 칸 [계획 비교] 모달 + 달력 판정 칩 + 월별·선생님별 [계획 대비 현황](`/ecs/plan-gap`) — 판정은 `plan-compare.ts` 한 벌
- 교재 배정은 교재목록이 아니라 영어 강사 시트(월간)에서 한다 — 교시를 골라 차수를 쭈루룩
- 교재목록 = 수업 교재 마스터(구분·교재이름·페이지/시간·차수) + 차수별 진도·과제 · 영어 시트에 차수대로 자동기입
- 수학 강사 시트(MCS) = 학생 × 수업일 · ECS를 복제하지 않고 축을 90도 돌린다
- MCS 학습 진도 레일(전체 목표) = 등록 이후 첫 기록이 닿은 차시부터
- 영어·수학 시트는 사이드바에서 `강사 시트` 한 줄로 묶고 하부탭으로 가른다
- EiE 월간 계획서(MP) = 미리 쓰는 계획, 주간 시트는 실제 · 월간이 둘을 대조한다
- EiE 월간 계획서 = `월 | 세션` 기간 축 · 기본 세션 · 계정 귀속
- ECS·MCS 강사 시트는 휴일을 알아본다 — 표시만, 입력은 그대로
- ECS 월간 뷰 = 달력 ↔ 진도표 두 보기 · 목표를 그 자리에서 고친다
- ECS 반 목록은 "그 주에 수업이 있는 반"만 세운다
- ECS 반 목록 = EiE / 인재원 영어 좌우 2단
- ECS 반 목록의 Shouting 구역 = EiE 전용 · 주 단위 · 폭 고정
- ECS 특이사항 = 좁은 기본 열 + 포커스 스티커 메모
- JJ 자리 출석부의 '진도'(수업계획) = 영어 시트와 같은 기록·같은 기계·같은 게이트

### 디자인·팔레트·툴바·아이콘 → [`docs/decisions/design.md`](docs/decisions/design.md)
- 페이지 헤더 = 한 줄(`eyebrow - 제목 - 설명`) · 오른쪽 끝 '화면 최대화' · 스켈레톤은 `PageHeaderSkeleton` 한 벌 · 3행으로 되돌리지 않는다 · eyebrow = 사이드바 그룹 이름 자동(손으로 적은 값은 폴백)
- 슈퍼관리자 화면 = 앱과 같은 디자인 체계 · 폰은 상단 한 줄 바 · 영역 가드
- 왼쪽 색 띠 금지 — 카드·타일·알림에 굵은 왼쪽 띠를 두르지 않는다
- 대규모 디자인 수정 v5 = "가장 작은 창에서 글자를 최대로" — 가독성 > 레이아웃·여백·장식
- 글자색은 한 값 `#121212`(rgb 18,18,18) · 컨트롤 세로 채움 70% · 탭 아이콘은 이미지 생성물
- 플레이스홀더만 연한 회색(`--text-placeholder` · 레이어 밖 `::placeholder` 한 곳 + 글자로 그리는 것은 `text-text-placeholder`) · 뭘 적을지 모르는 칸에만 둔다(라벨 되풀이·예시 이름 금지 — 칸 정리는 신규 콜&상담 폼만 끝냄)
- 탭 스티커의 범위 = 탭·내부 탭 + '표시 자리'(빅 스탯 지표 칩)
- 기간 네비는 `‹ 2026년 8월 ›` 한 덩어리 — [`PeriodNav`](src/components/period-nav.tsx) 단일 소스
- 툴바는 부품으로 쓴다 — 상수만 두면 새 탭이 모르고 제 클래스를 적는다
- 화면 상단 규약 3종(앱 전역, 원장 2026-09-01)
- 라이트 전용(Daylight)
- 앱 디자인 = "Injaewon Editorial" + 팔레트 v3 네이비 (2026-07-19 원장 확정).
- 팔레트 v4 "White Contrast" + 의미색 캐논 (원장 2026-08-18).
- 이름 앞 아바타/이니셜 배지 = 금지 (영구).

### 운영실(대시보드) → [`docs/decisions/dashboard.md`](docs/decisions/dashboard.md)
- 업무 요청 내용 = 서식 글(전자결재 `RichEditor` · `.rich-content`) · 미리 채움은 담당자별 · 그 몫만 · 저장 전 · 읽을 때 `sanitizeRichHtml` · 서식 포함 20,000자 · 받는 글은 선생님마다 자기 이름 제목 아래만(`recipient-body.ts` · 서버가 가름 · 미리보기 같은 함수)
- 업무 비서('확인할 일' 위 · s2_0019) = 같은 후보에서 자동 정리 · AI 정리(매일 01:00 · 13:00 예약 + 버튼 · 페이지 로드는 안 부름) · 단추는 후보가 정한다(AI는 ref로 순서 · 이유만) · 예약은 화면이 남긴 마지막 후보로(숫자 기준 시각을 적는다) · 사람 상세는 그 사람 몫만 · 대화형 비서 재도입 아님
- 운영실 = 새 대시보드(계기판) 하나(2026-11-10 · 옛 운영실 화면·'대시보드 전환'·`ui_prefs.dashboard.design` 삭제 — 되살리지 말 것) · 강의실 2D/3D 제거(11-02) · 실제 값 · 비율로 나눈 탭 값 없음 · 권한은 운영실과 같다 · 강사별 업무는 이 화면에만(`seePortfolio`)
- 운영실 카드 '상세' = 그 탭의 통계 화면(카드 몸통·팝업은 그대로) · 운영실에 보이는 지금 구성은 다시 싣지 않는다 · 정확히 셀 수 없는 과거(퇴원 기록 전 · 과목은 수강 종료 기록 전)는 그리지 않는다 · 과목 관리자는 자기 과목만 · 시범 = 원생 통계 `/students/stats`
- 원생 매일 기록(0381a `student_daily_stats`) = 학년·학교·휴원처럼 지금 값만 남는 것을 오늘부터 하루 한 줄(23:55 cron · 운영실 재원생 카드와 같은 계산 · 서버 전용 표) · 빠진 날은 추정으로 채우지 않는다
- 상단 '최근 결석' = 어제까지 7일 · 빠진 수업 단위(0221a와 한 벌) · 학생별 누적 많은 순 · 결석마다 그 수업을 가르친 선생님(teacher-axis · 입력자 아님) · ↗ 없음
- '강사별 업무 현황' 행 = 보고서 작성 · 발송 확인 · 학부모 미확인 · 출결 미입력 · 원생상담 · 영상 둘(줄마다 원래 카드·신호와 같은 판정) · 기능이 꺼지면 그 줄째 뺀다
- 과목 관리자 카드 = 과목별로 다시 센 값(`addSliced` · `slices.ts`) · 과목을 모르는 기록은 모두에게 · 두 과목은 양쪽에 · 수납은 청구 항목별(못 가른 금액은 '과목 모름') · 지출·행정만 학원 전체
- 위젯 목록은 역할마다 같다(과목 관리자도 전부 · 못 거르는 카드는 '(학원 전체)') · 위젯 검색 · 행 추가 = 캔버스 우클릭 · 동시 저장은 마지막이 이긴다(고친 배치만)
- 대시보드 관리 = 새 대시보드 칸 목록(2026-11-09 · 핵심 업무 · KPI 한눈에 보기 6칸/오늘 운영 · 추이·비교 · 비중·구성 · 오늘 운영 구역 · 크기 없음 · 옛 배치는 읽을 때 자동 옮김 · 역할 기본 새로) · 보기 전환 렉 = 차트 칸 일괄 측정·그리기(VizSlot)
- 역할별 운영실 배치 = 학원 설정 '대시보드 관리'(원장·총괄만) · 순서 + 크기(좌표 없음) · 원장 기본 = 지금 운영실 그대로 · 저장값 없는 역할은 기본을 따른다 · 배치 밖 영역은 서버가 조회 안 함 · 민감 6가지 = 카드 옵션
- '오늘 미작성 보고서' = 운영실·작성률 카드가 한 판정(`judgeTodayLessonReports`)
- 운영실 카드 표시 규칙 10종 · 취소된 일정은 목록에 취소선, 숫자·링크에선 뺀다
- 운영실 일정 카드의 학생 이름·콜&상담 링크 = 저장 없이 갱신마다 판정 · 모호하면 안 붙인다
- 운영실에서 '대화형 비서'·'실시간 운영'·'빠른 작업'을 걷어냈다 · '학원 펄스' → '학원생 증감'
- 학원 비서(원장 2026-11-06 직접 지시 — 9/3 '챗봇 영구 제외'를 바꿨다) = 원장·슈퍼관리자 · 그 지점 DB 전부(전용 역할 `aywa_assistant` · 비밀 칸만 뺌) · 비서 의견 필수 → [`docs/features/academy-assistant.md`](docs/features/academy-assistant.md)
- 상단 '강좌수' 칸(재원생 오른쪽 · 지금 듣는 반을 학생마다 모두 · 재원생 칸과 같은 조회·줄 판정) + '강좌수 추이' 카드(재원생 추이와 같은 원본·날짜·시작 달 · 오늘 점 = 칸) · 원생 통계 '강좌수 추이' · 9칸 흐름 배치는 3열 6 + 2열 3
- 상단 '금일 입테' → '전일 입테'(전일 = 어제 · 월요일엔 토·일 주말 전체 — `previousDayRange` 한 곳 · 일정은 어제부터 읽고 일정 카드는 `upcomingAdmissionsRows`로 오늘부터) · '전일 / 이달 신규' 팝업에 배정 반(과목 · 반 이름 · 칸반과 같은 필터)
- 운영실 상단 KPI = 9칸(재원생·강좌수·퇴원생·신규문의·전일 입테·
- "N건 있다"는 신호와 그 일을 하는 화면은 같은 게이트를 지난다
- 운영실에 '지출 결재 대기'는 없다
- '살펴볼 학생'은 사전 통보로 전부 설명되는 결석을 배제한다
- 운영실 '미작성 보고서'는 aywa에 보고서를 쓰는 과목만 센다 — 영어 제외
- 운영실 = "학원 매니저 팀" (2026-07-16 원장 방향)

### 원생·콜&상담·신규생·학교 표기 → [`docs/decisions/students.md`](docs/decisions/students.md)

- 원생상담 '상담 평점' = 보고서와 같은 잣대(기록의 정성·구체성) · 글자 수·자리표시로 점수 정하지 않는다 · 지금 있는 상담은 구독 CLI 일괄, 이후 배치 · 순위·평균·빨간 숫자 금지(2026-11-11)

- 연결 탐색 = 원장 시안(:3978) 구조(세 열 · 도넛/네트워크 계정 귀속 · 분석·판단은 오른쪽 아래 · 강의실 중심은 수업 전체 열람만 · 출처 표시·통합 메모는 시안 전용, 2026-11-05)
- 연결 탐색 네트워크 '개별 기록' = 연도 → 월 → 일자 묶음(처음엔 월까지 · 범위는 패널과 같게) · 같은 기록 한 번 · hover 날짜 연도까지(2026-11-06)
- 원생 흐름 분석 = 오늘 기준(90일 넘은 기록뿐이면 판단 보류 — 걱정은 '그때 판단'으로만 · 퇴원·휴원은 원생 상태 배지 · 예정 수강은 기록 아님 · 분석 뒤 상담은 '아직 반영 전'(없다는 단정 금지) · 판정 `flow-recency.ts` 한 곳, 2026-11-06)
- 학생 온톨로지·기여도 → [`student-ontology.md`](docs/decisions/student-ontology.md) · 설명회 신청·형제 인정과 최초 연결(2026-10-26, 기본 비활성) → [`student-parent-events.md`](docs/decisions/student-parent-events.md)
- 퇴원 상세 = 퇴원보고서(새 보고서·원본)·콜&상담 카드(카드마다 목적지 메뉴 권한 · 학생 id로 좁혀 읽기 · 실패는 카드만) · 작성 입구 없음 · 퇴원일 옆 '퇴원보고서 종료일'은 같은 사건 후보만(정보 · 퇴원일 안 고침 · `report-date-link.ts`) · 보고서 상세 → '퇴원 상세' 링크(2026-10-23)
- 퇴원월 = 수강료를 낸 마지막 달(2026-10-29 · 수업 순액 > 0 · 운영실·퇴원관리·퇴원생 시트 · 시간표 X·수강종료는 날짜 그대로 · `exit-month.ts` 한 벌)
- 퇴원은 퇴원보고서로만(2026-10-23 · 본문 = [`withdrawal-reports.md`](docs/decisions/withdrawal-reports.md)) · 🔴 직접 퇴원·새 퇴원 예약·마지막 반 수강 종료는 서버가 거절(`via-report.ts` 한 곳)
- 퇴원보고서를 거치지 않은 퇴원·새 퇴원 예약 = 막지 않고 경고(0454a · 원장 벨 + 감사로그) · 그 과목의 마지막 반 종료도 퇴원보고서로(2026-10-26 · `viaReportMessage` 한 곳)
- 신규 콜&상담 대시보드(`/enrollment/dashboard`) 제거(2026-10-23 · 09-28 이후 0회 · 통계는 '통계' 보기)
- 추세선의 등록 = 수업을 시작한 등록만(판정 한 벌 `coverage-rules.ts`) · 재원생 추이는 에이와 수강 기록이 갖춰진 달부터(0386a) · 원생 통계 '지난 기록' = 메이크에듀 + 에이와 청구 한 선(0384a·0385a)
- 추세선의 단체 장부 정리(수업 기록 있는 쪽) = 퇴원 칸에서 빼고 재원생은 청구가 살아 있는 달에만 · 퇴원 수·명단·카드는 그대로
- 원생 보호자2 = 수정 화면 '+ 보호자 추가'(s2_0022 · 2026-11-04) · 같은 사람 대조(형제·중복 후보·검색·브리프·ClassNote 워커)는 보호자 번호 둘 다 · 콜&상담 자동 연결·본인 확인(뒷 4자리)·오늘수학·엑셀 가져오기는 아직 보호자1만
- 원생 형제 = 학부모 휴대폰 같음 · 학부모 이름 같고 연락처가 안 부딪힘(자동 · 저장 안 함) + 수정 화면에서 지정·해제(0376a `student_siblings` · 바꾼 것만 저장) · 이름만 같고 휴대폰이 다르면 확인 후보로만 · 같은 이름은 형제 아님 · 프로필에 표시(`siblings.ts` 한 벌)
- 신규 콜&상담 '같은 학생' = `same-person.ts` 한 벌 · 🔴 반대 증거가 있거나 애매하면 안 잇는다 · 표시만(연결·병합 안 함)
- 신규 콜&상담 상세 = 빈 칸도 '—' · 상담자 기본값 = 추가하는 사람 · 🔴 기록 없는 옛 상담자는 비워 둔다 · 보기는 계정에 마지막 보기
- 퇴원·수강 종료 사유 = 대분류 14 · 세부 42(선택) · 기타는 메모 필수 · 사유를 받는 모든 곳이 한 부품(`ReasonFields` — 상태 전환 창·퇴원 상세·학생 폼·수강 종료 창·시간표 · 엑셀은 퇴원사유·퇴원메모 칸) · 세부는 그 대분류의 것만 살린다 · 강사평가 '뺄 사유'는 대분류로
- 퇴원관리 분석 = 한 카드 축 전환(과목·강사·학년·학교) · 강사 = 시간표 X와 같은 판정(`loadExitTeacherJudge`) · 강사는 건수만(% 없음) · 수업 기록 없는 장부 정리는 어디서도 안 보인다(`isBookkeepingOnlyExit`)
- 원생목록·수업목록 정렬 = 열 머리의 오름·내림 화살표(원생: 이름 · 학년 / 수업: 반 이름 · 담임 · 학생) · 정렬 드롭다운·등록일순 없음
- 리텐션 시작 전 학생 제외는 원생 목록과 동일 · 학생 개요 수납 조회·카드는 수납 권한과 동일
- 지난 수업의 '강사' = 종료일 당시 담임 이력 → 수강 기간의 마지막 보고서 → 강사 출결 · 못 살리면 `—` · 현재 담임으로 메우지 않는다
- 원생상담 반 = 상담사가 그날 가르치는 반이 하나일 때만(아니면 '—') · 사람이 고른 값이 이긴다 · 목록은 폭을 다 쓴다(최대 2단) + 위 한 줄 요약 띠 · 통계는 '통계 보기' 전용 화면(옆 패널 폐지, 2026-10-01)
- 퇴원관리 수치는 기간과 범위를 늘 적는다 · 위 카드는 올해 학원 전체 · 재원생 추이는 카드 뜻을 그날로 되감는다
- 끝난 특강은 수강종료·퇴원으로 세지 않는다 · 같은 과목 다른 반을 다니면 이탈 아님
- 퇴원일이 미래면 '퇴원 예약' — 당일 전까지 재원 · 그날 00:05 cron이 같은 종료 함수로 퇴원 처리 · 수강 종료일을 미리 박지 않는다
- 인원 카운트(신입·퇴원 등)는 달로 끊는다 = 이번 달 1일 ~ 오늘 · `withdrawalMonthWindow` 한 벌 · 운영실 상단 오늘 단위 카드는 예외
- 재원생 = '실시간' — 아직 시작 안 한 수강만 가진 학생은 안 센다 · 오늘 출결 카드는 '한 수업 = 한 블록' · 휴원도 과목을 고른다
- 신규생 관리 탭 = 신입 등록 후 90일 체크리스트 · 기준일이 둘이다
- 신규생 체크 ↔ 원생상담 = 반자동(상담 등록 화면에서 사람이 확정) · AI 판정 없음 · 손 체크가 이긴다
- 퇴원관리 = 퇴원 + 수강종료 한 목록(줄마다 라벨) · 기간 직접 지정 · 시간표 '퇴원'은 과목 단위라 뜻이 다르다(기준 카드로 밝힘)
- 등록 후 3개월 내 퇴원 = 등록일(`enrolled_at`)부터 30·60·90일(누적) · 퇴원만(수강종료 제외) · 판정 못 하는 퇴원은 세지 않는다 · 운영실 위젯은 이번 달 + 달마다 칸(`early-exit.ts` 한 벌)
- 메뉴에서 '학생'은 '원생'이라 부른다
- 신규 콜&상담 수정 = 이 사람이 바꾼 칸만 저장(연 때의 값 `editBase` ↔ 지금 · 과목 상담은 과목·칸 단위로 합침 · 안 건드린 후속 조치는 DB의 지금 상태 · 같은 칸은 나중 저장이 이긴다 · `consultation-changed.ts`)(2026-10-26)
- 신규 콜&상담 후속 조치 = 상담 끝난 건은 저장 때 필수(등록 · 미등록 · 다음 상담(날짜는 선택 — 10-26)) · 고르면 칸반이 따라 움직인다 · 다음 상담 하루 전·당일·지나면 알림 + 할 일 · 통계 '관리현황' 표(2026-10-22)
- 신규 콜&상담 반 배정 과목 판정 = 한 벌(`consult-subject.ts` — 칸반·상세·운영실 상담 진행·이달 신규 · 빈칸 = 전 과목 · 못 읽는 글자 = 배정 없음)(2026-10-23)
- 관리현황 = '재원'(원생목록 재원 판정 · 사람 단위) · 진행 중/장기 미결(상담일 60일 · '멈춤' 아님) · 완료율 카드는 내역만 · 후속 조치 '상담 완료' = 다음 상담일 선택(10-26 · 10-23 '필수'를 뒤집음) · 상담 마친 건 '상담 전' 불가 · 후속 조치 알림 콜드스타트 시드 없음(2026-10-23)
- 신규 콜&상담 통계 = 올해 증감은 작년 같은 기간과 · 빈 미래 달 없음 · 연도 2·3개년 묶음은 계정에 · 옛 이관 자료는 구글 캘린더·수강 기록 근거로만 보정(2026-10-22)
- 메뉴 이름 = '신규 콜&상담'(등록상담 → 콜&상담 09-11 → 신규 콜&상담 10-16) · 데이터·권한키·URL은 그대로 · 새 상담 창 = '신규 콜&상담 작성'
- 강사(teacher) = 학생 기록 열람 전용
- 학교 표기는 저장 시 강제 통일 — `~초등학교`→`~초`, `일중`→`대구일중`
- 등록상담 목록뷰(`?view=table`) = 칸반 카드의 내용을 옛 콜앤상담 시트 *모양*으로
- 등록상담 칸반 = 4칸
- 수강료 계산기 = 신입생 상담 견적 도구
- QR 등록상담 자동연결 = `student_id` 연결만, `outcome` 강제 안 함
- 콜&상담 '소개한 사람' = 원생·직원 하나를 골라 잇는다(0362a) · 글의 이름은 후보로만 · QR은 글로만 받는다 · 소개 칸은 기본 조회와 따로 읽는다(#95)

### 원스크린·수업보고서·ClassNote·AI·알림 → [`docs/decisions/reports-ai.md`](docs/decisions/reports-ai.md)
- EiE 보고서 두 종류(2026-11-05) = 일일 = 수학 보고서 표(항목 글 · 인재원 결과지 없음) · 월간 = 시트 'Monthly Evaluation Report' 모양(Monthly Test 점수를 글 속 한 줄로 동결 + Teacher's Comment = 특이사항) · 로스터가 영어 반 최근 Monthly Test를 따로 읽는다(실패 = 점수 줄만 빠짐)
- EiE 일일 보고서 단어 테스트(2026-11-06) = 일일 테스트 → '단어 테스트' · 재시험 표시 · 피드백 · 다음 범위 · EiE 로고 · 월간 = 그 달 일일 기록을 글 속 한 줄로 동결(EiE 반만 · 당일 줄 제외)
- 벨 정리(2026-11-02 · main 11-03) = 기한 초과 업무 요약은 최근 한 장만 받은함 · 배지에(그 한 장을 보관 · 삭제하면 가린 지난 요약도 보관) · 본문 줄이기(링크 없는 알림은 그대로) · 보관 · 삭제는 올렸을 때만 · 읽은 알림 구분선 · 알림 데이터는 그대로
- 수업보고서 평점(참고용, 0450a) = 기준 v6 원장 점수표(정성·구체성 1~5 · Haiku · 2026-10-26) · v4·v5·Sonnet 기각 · 🔴 화면은 AI를 부르지 않는다(정기 처리 cron만) · 쓰기 권한자만
- 수업보고서 목록 '수업일'(실제 수업일 지정) 버튼 제거(2026-10-23 · 도입 후 0건) · 읽는 코드·칸은 남김 · 되살리지 말 것
- 오늘 수학 월말평가 성적표 = 완성되면 PDF로 그 학생 수업보고서에 첨부(aywa 쪽 구현 0373a · 토글 `todaysMathReportPdf` · 오늘 수학 피드 켜기 대기) · 안 보낸 보고서에만(보낸 보고서에 붙이면 재발송) · 이미 보냈으면 점수 없이 나간 것으로 끝(따로 보내지도 알리지도 않음) · 못 붙이면 선생님에게 알림
- AI 멘트 탭 미리보기 = 운영 자동작성과 같은 재료·조립·모델·검사(조립은 `ment-assembly.ts` 한 곳) · 기본값과 같은 글은 사용자 지정으로 저장하지 않는다
- 학습 추세 = 시험은 그 반 기록만(7/23 정규·특강 가름을 시험 줄에서 좁힘) · 같은 만점 3회 이상만 · 한 번만 다른 결과는 흐름 아님 · 계획·원인·평가·내부 사정 문장은 싣지 않음 · 말투 바닥·항목 간 되풀이 금지는 코드가 붙인다
- 자동작성 모델 = Haiku 5.5(2026-10-16) · 학습 추세 = 코드가 정리한 날짜 없는 사실 문장 · 지난 보고서와 달라진 것만 · 🔴 숫자 없이 정도로만 · 나빠지는 흐름 금지 · 종결형 한 가지
- 원스크린 좁은 폭은 미리보기 버튼, 넓은 폭은 3열 · 개별 공지는 서버 대상 미리보기·발송 직전 재검증
- 숙제 영상 올리기 사이트 = 주소 하나(`/v`) · 휴대폰 뒷 4자리 + 이름 → 마감 전 영상 숙제 고르기 · 숙제당 영상 5개 · 숙제 없으면 지금 반 + 메모(하루 5개) · 올린 영상은 고른 숙제 칸에만
- `/v`로 올린 원본 = 발송 PC가 압축해 같은 Drive 파일에 새 버전으로 · DB 지문(md5·bytes)은 원본 그대로 · 담임이 직접 올린 파일은 대상 아님
- 보고서 글의 영상 줄 = 올리기 사이트 주소(`/v`) 한 줄(영상 과제 있음이면, 토글 없음) · 학생마다 링크는 만들지 않는다(학생 상세 '제출 링크 복사' 거둠) · 업로드는 ClassNote 또는 `/v`만
- ClassNote 반 보드 동기화 = 회차마다 보고서(변동·실패·보류 + 이유) · '동기화 보고서 다운로드'(강사 제외)
- 수학 공지 = 개별은 반 보드 원아에게 1:1(삼자 일치 · 🔴 1인 보드로 안 돌아감) · 반 공지는 ClassNote 공지사항 · 강사 원스크린 '개별 / 반' 토글
- ClassNote 자동 해제 = 수강이 끝난 것이 확인된 원아 · 지금 담당 아닌 선생님 · 모르면 보류 · 🔴 마지막 배정은 안 뗀다(떼면 ClassNote 자동 퇴소) · 보드 삭제 안 함(2026-11-03)
- ClassNote 명부 퇴원처리(퇴소) = 전 과목 퇴원 45일 뒤(2026-11-03) · 🔴 스위치 기본 꺼짐 = 관찰 모드 · 하루 10명 · 남은 배정이 전체방·본인 1인 보드뿐일 때만 · 백업 뒤 내림 · 이상하면 멈춤
- 학부모 글 답글·공감 = 학원 설정 세 단계(끔 기본·시험·전체) · 전체는 확정 연결이 전부 맞는 글만(영어 그룹반은 안 된다) · 공감은 메시지당 하나·누른 사람 명의
- 학부모 댓글은 30일 전 글까지(ClassNote 알림 목록 신호 · 감시 창을 늘리지 않는다) · 출결 연락으로 분류된 것은 다른 과목 지금 담당에게도(0331a, 인사 댓글은 안 간다)
- 학부모 글·댓글 벨 = 그 학생의 현재 담당 선생님(같은 과목 지금 반의 담임·교시 담당·오늘 위임) · 가르친 적 있는 강사로 넓히지 않는다 · 가드 8겹 · 학생을 못 정한 반 보드 글은 그 반 담당만
- 반 보드가 없어 막힌 보고서 = 까닭(배정 중·새 반·가입 대기·그 밖의 보류·반을 떠남)을 가려 말한다 · 동기화가 풀 수 있을 때만 그 자리에서 요청(버튼과 같은 함수 · 되읽어 확인) · 막는 것은 그대로
- 원스크린 ClassNote 반 매칭 아이콘 = 그림 셋 — 체크(이 반 보드에 배정) · 물음표(연결은 됐는데 반 배정이 지금 반과 다름 — 그날 안 다니는 반의 배정만 · 그림·원 배경 없는 '?' 글자) · 회색(연결 모름) · 새로고침 없이 갱신(보일 때 60초 · 버전 확인 GET) · 미발송 줄은 아이콘 없음(2026-11-04)
- 보고서 목록 '미발송' 칸 = 마우스 오버 이유 카드(있는 것만 · 기존 판정·문장 · 보호자 전화 값 없음 · 목록 뒤 GET으로 따로 읽음, 2026-11-04)
- ClassNote '지금 반 보드 동기화' = 요청만 남기고 연동 PC가 바뀐 반만 · 지점당 요청 하나 · 5분 쿨다운 · 버튼은 보고서 쓰기 권한이 있는 계정만(선생님은 발송이 막혔을 때의 자동 요청뿐 · 감사로그는 자동/수동을 가른다)
- 보고서 미발송(JJ) 반 = ClassNote 반 보드 대상 아님(2026-11-04 · 11-03 'JJ 맞춤' 되돌림 · 워커 조건 = 원스크린 아이콘 조건 · 보고서를 쓰는 JJ 반엔 미발송을 켜지 않는다)
- ClassNote 반 보드 자동 동기화 = 🔴 웹훅 아님 · 연동 PC가 1분마다 aywa DB만 대조해 달라진 반만 기존 요청으로 · 개명·새 반은 반 id로 가름 · 밤(23~06시)엔 쉰다
- 오늘 영상 과제 있음/없음 = 보고서 값(null=모름) · 다음 수업 검사는 '없음'일 때만 숨김 · 원스크린 '보강' 켜고 끄기 폐지(합침 취소만)
- 영상 숙제 마감 = 원스크린에서 7일(기본) · 다음 수업(저장 때 시간표로 날짜 고정 · 14일 안) · 일괄입력도 · 고른 마감이 사이트·미수행 판정(DB 함수 포함)·반려·카드·멘트의 기한 전부(`due.ts` 한 곳) · 주인 = 영상 과제와 같다 · 따로 낸 숙제는 7일
- 강사뷰 '영상 제출 현황'(`/onescreen/video-homework`, 뷰 게이트) = 내가 낸 영상 숙제만 · 체크도 내 칸만 · 🔴 판정은 전체로 먼저 하고 칸만 거른다 · 관리자 화면은 전부
- 보고서 글에 댓글로 올린 ClassNote 영상 = 그 보고서의 숙제 칸으로(반·수업일을 DB로 확인한 것만 · 영상 과제 있음 · 지금 다니는 반) · 새 글·다른 글의 영상은 종전대로 · 연동 PC가 전송 직전에 글의 보고서 주소를 읽는다(워커 zip 필요)
- 영상 제출 현황 회차 = 학생별 '영상 과제가 나간 수업' 순번 · 같은 숙제 = 한 줄 · 미확인 한 번 누르면 오늘로 완료 · 강사·반·학교는 검색창(10-19) · 🔴 장부 새로고침은 스크롤 유지(router.refresh 금지)
- 영상 숙제 취소 = 미확인·미수행만 · 보고서를 보낸 숙제도(그날 보고서 영상 과제 → 없음 · 남이 쓴 보고서는 따로 낸 표시만 · ClassNote로 나간 글은 그대로) · 칸 편집 창 '숙제 취소' + 따로 낸 숙제 우클릭 · DB 함수 한 거래 · 원스크린 초안이 되살리지 않는다(취소 기록 `cancels.ts`)
- 영어 ClassNote = 반 방 1:1 발송(s2_0006 `classnote_english_class_boards` · 사람이 확인한 연결만 · 원아 = 확정 원아 ∩ 그 방 · 방에 없으면 막는다 · 연결 없는 반은 1인 보드 · 수학 연결표에 넣지 않는다)
- 수업 시작 전·휴원(대기) = ClassNote 배정·발송 대상 아님(1인 보드로도 안 감) · 원아 신분 가드 한 벌(`child-identity.mjs`) · 원장 확인 연결(`linked_by='confirmed'`)은 입소 서류 대조만 뺀다 · 🔴 패치로 기존 발송이 막히면 안 된다(2026-11-05)
- 영어 개별 공지·교재요청서 = 영어 반 방 1:1(2026-11-04 · AywaSync 1.0.15 · 삼자 일치로 정한 반에 반 방이 있으면 · 없으면 이미 있는 1인 보드 · 발송 PC가 `caps.noticeEnglishRoom`을 알릴 때만)
- ClassNote 1인 보드(`(수학)`·`(영어)`)에 원아를 배정하지 않는다 — 🔴 준비·수동 도구 전부 없앰(원장 2026-11-04 · AywaSync 1.0.14 · 가드 `no-personal-board-writes.test.mjs`) · 수학 = 늘 반별
- 수학 ClassNote 반 보드 = 반별 1:1 발송 · 원아는 이름으로 고르지 않는다 · ~~1인 보드는 해제하지 않는다~~ → (수학) 1인 보드 원아 해제 · 12월 삭제 · 원아 신분 = 반 보드 확인 기록 + 원아 연결(2026-11-02) · 보강은 보강 추가한 반으로(보드 없으면 경고와 함께 고른다) · 시험은 학원* 계정만
- 반별 발송의 보강 = 보강 반으로만(고른 반 = 새 보강 반, 칸도 함께) · '반 없이' 금지 · 정규 반 보드가 없으면 막는다(다른 반으로 안 보냄)
- 강사별 멘트 말투 프로파일 = 0214a 코퍼스를 주 1회 접어 자동작성에 붙인다 · 표본은 직접 작성 + 자동작성 후 수정
- 영어 수업보고서 = 원스크린 영어 행 '템플릿 모드' · 인재원 학습 데이터 = pull API
- 발송 기한(오늘 포함 7일)이 지난 보고서도 원장이 지정한 건은 보낸다
- ClassNote 테스트 학생 '학원이'는 aywa에서 아무에게도 배정하지 않는다 — 배정은 ClassNote 쪽에서 전 강사에게
- AI provider 전역 기본 = Anthropic Claude Sonnet 5.5(2026-10-19 5→5.5) · 응답 길이 상한 바닥 64,000 · AI 회사는 Claude·DeepSeek 둘(Solar 제거)
- AI 1순위 = Claude · DeepSeek은 폴백만(2026-10-26 · Anthropic 크레딧) · 전사 분석(콜&상담 분석·폼 자동입력·회의록·재원생 상담)·브리프·결석 문자·출결 요약·번역 = Sonnet 5.5 · 멘트·만족도 = Haiku 5.5 · 가드 `claude-first.test.ts` · 지점별 모델 = 운영 콘솔 'AI 모델' 탭(0375a) · ~~10-19 V4.1 flash · 07-16 v4-pro~~
- 음성 전사 엔진 = AssemblyAI `universal-2` 유지
- 학부모 보고서 제목 = 과목 보고서('수학 보고서' · 설정 제목이 기본값일 때 · `reportTitleText` 한 곳)
- 수업보고서 테스트 표기 = "N문제 중 M개 맞음" 하나뿐
- 오늘 과제의 쪽수는 강제가 아니라 후보정
- 분석 화면에 AI 모델 라벨 노출
- 업무 처리 확인(할 일, 0377a~0380a) = 알림과 따로 남는 기록 · 🔴 처리는 원래 기록의 사실로(버튼 아님) · 트리거 + 30분 맞춤 · 벨 '내 할 일' · 30일 넘게 안 읽은 알림은 보관함(0447a)
- 영상 설명 AI 참고 메모(0390a) = 수학 숙제 영상을 밤 배치로 판정(Haiku) + 오류 주장만 확인(Sonnet) · 전사는 영상당 한 번 · 화면 이미지 Claude 전송은 이 기능만 승인 · 화면에는 분석 결과만 · 재생과 같은 권한 · 지점 스위치 기본 꺼짐
- 알림 경로는 둘이고 서로 다른 물건이다 (2026-08-07, 0188a).

### 수납·회차·정산·급여 → [`docs/decisions/billing.md`](docs/decisions/billing.md)
- 수납 통계 '지난 기록 — 수업료 수납' = 메이크에듀(2020~) + 에이와 청구 · 수업료만(교재·차량비 제외) · 실청구 없음(수납 순액만) · EiE는 2025-05부터 · 2025-03·04는 원자료 그대로 + 안내 · 과목 관리자 화면 없음
- 회차 확정 상단의 상태 필터 = '보기' 드롭다운 하나(다중 선택 · 미확정 · 미배분 · 몫 조정한 반 · 이월 재확인(2026-11-09 · 걸린 줄이 있을 때만)) · 여럿이면 모두에 해당하는 줄만 · 주소 `only=` · 엑셀도 같은 줄
- 시수 확정 뒤 배분 자동 재확정 = 사람이 그대로 다시 저장할 일만(혼자 받는 항목 · 이름이 맞는 빈 항목이 딱 하나인 새 반) · 나누는 항목·바뀐 청구 항목은 사람 몫 · 저장은 같은 DB 함수
- 프리랜서 명세서·강사 정산 면 수업료 = 그 강사 출석부의 실급여 합계(`computeSheetTuition`) · 그 밖은 티어 정산 그대로 · 화면 조립을 바꾸면 `teacher-sheet.ts`도 같이
- 실급여·프리랜서 명세서 '대상 학년' = 선생님마다 고른다(출석부 '비율 설정') · 기준은 학생 학년 · 학년 모르면 '빠진 줄'로 · 계정을 코드에 적지 않는다
- 급여명세서 출석부 별지 = 이름 옆 라벨 없음 · 신입·퇴원만 이름 칸 색(시간표와 같은 색·판정) · 반별·자리 인쇄는 라벨 그대로
- 배분은 금액이 안 바뀌면 그대로 둔다 — 수납명은 배분의 근거가 아니다(순서가 바뀐 것은 재확인) · 나누는 항목도 답이 하나면 자동 재확정(비례 분배는 안 함) · 번호 옮기기 트리거도 이름만 바뀐 줄을 따라간다(0354a)
- 수납 '강사 정산' 면 = 급여명세서 수업료와 같은 함수(`computeTeacherTuition`) · splits 산식은 화면에서 뺐다
- 🏁 D:\attendance "쏙쏙 이전" 이식 = 완결 (2026-07-17, main a9f5dab).
- 강사 정산 단가 = 회차 확정 단가 우선(수학 반) → 없으면 수강 티어
- 회차 확정 줄 = 월별 출석부 줄(그 달 학생×반 한 벌) · 회차 행이 없는 줄은 저장하는 순간에만 만든다
- 금액 이월이 실리면 받는 달 확정 시수를 자동으로 올린다 — 저장된 확정 시수 자체를 고친다 · 올리기만 하고 내리지는 않는다(`planCarrySessionSync`) · 시수에 반영된 받은 이월을 다시 넘기는 것은 이월 창(시수를 함께 낮춤 · 2026-11-09)
- 회차 확정 금액 이월(0278a) = 보내는 달 한 곳에 저장 · 실납은 `netAllocatedAmount` 한 벌 · 더 받은 몫 = 배분액 + 받은 이월 − 확정액(연쇄 이월 2026-11-09 · s2_0033)
- 수납 자유 배분(0279a) = 관리자 이상 · 합계 ≤ 수업 청구액 · 항목별 배분이 기본
- ⚠️ 돈 산식 변경 = 골든마스터 통과 필수 (2026-07-17, attendance R2·R6 이식).
- 급여명세서 열람 = 원장 역할 + 학원 설정에서 지정한 사람(코드 명단 없음 · 원장이 아닌 사람은 지정돼야 본다)

### 직원·권한·전자결재·연차 → [`docs/decisions/staff.md`](docs/decisions/staff.md)
- 학원 비서 권한 = 키 `assistant`(원장 전체·나머지 없음 · 전체·없음만) · 🔴 새 메뉴·단추는 제 권한 키(다른 메뉴 권한 빌리기·페이지 역할 비교 금지) · 셔틀 관리자 화면 = `shuttle_admin`(2026-11-09·11-10)
- 퇴사 = 권한을 **주는** 값만 학원 설정에서 빠진다 · 좁히는 값은 남긴다(판정 `userOverrideGrants` 한 곳) · 재입사해도 되살리지 않는다(2026-11-09·11-10)
- 역할 '아르바이트'(`parttime`, 2026-11-05) = 열람 아래 · 🔴 열람보다 넓게 두지 않는다 · 🔴 읽기 권한 화면 = 쓰기 단추 안 그림 + 입력칸 비활성(`write-lock.ts` · page.tsx에서 서버 게이트와 같은 함수)
- 직원 포트폴리오 = 직원 평가의 내부 탭 · 매월 1일 새 점수·말일 마감·마감 뒤 보충해도 그대로 · 🔴 점수 달의 재료 = 그 달 기록(매출 대비 급여만 지난달 값) · 지표·만점·규칙은 학원 설정 → 강사평가(0359a) · 원장 역할만
- 직원 편집 창구는 셋이고 내용이 안 겹친다 — 겹치는 칸은 이력서가 단일 소스
- super_admin은 새로 만드는 어떤 제한 명단·게이트도 자동 통과한다
- 예외: **개인 메뉴 차단**(`user-menu-blocks.ts`) — super_admin·원장도 따른다 · 🔴 원장 지시로만 줄을 더한다(현재 윤여원 직원관리, 2026-10-20)
- super_admin 계정의 역할·재직 상태·삭제는 앱에서 못 바꾼다 — 운영자 스크립트 + 원장 명시 승인만(반드시 먼저 묻기)
- 이승엽·박소선은 일반 지점 화면에서 **관리자**로 표시한다. 내부 super_admin 권한과 계정 보호는 유지한다(사용자 재확인 2026-10-14). 직원 목록·승인자 선택·역할 라벨도 `displayRoleFor`를 따른다. 퇴원보고서의 원장 후보로 표시하지 않는다. 표시 역할을 실제 권한·보호 판정에 사용하지 않는다.
- 퇴원보고서(2026-10-14 · 10-23 일반 메뉴) = 현재 수강 반 담임별 한 건 · 관리자 승인(+환불 요청 시 데스크 환불) · 🔴 원장 승인 단계 없음(2026-11-03 · s2_0025) · 모두 끝나면 한 트랜잭션에서 한 번 처리 → [`withdrawal-reports.md`](docs/decisions/withdrawal-reports.md)
- 퇴원율(2026-10-14) = 당시 담임 이력·교시 배정으로 담당 강사 모두 · 🔴 강사 탓이 아닌 사유(이사·졸업 등)는 모든 곳에서 퇴원율로 잡지 않는다(판정 한 벌 `reason-key.ts`) · 마감 월 불변
- 계약구분 '혼합' = 근로계약 + 강의용역계약 · 용역 몫 = 출석부 대상 학년(프리랜서처럼 실급여·명세서) · 근로 몫 = 근로 요일(강사평가 근태는 이 요일만) · 강사평가 급여 = 계약서 월급 + 실급여 · 프리랜서 판정은 `hasFreelancePart` 하나
- 전자결재 = 양식 중립 문서 껍데기 + 양식별 상세, 결재선은 순차
- 연차 조정 = 법정 부여 위에 얹는 행 · 자리는 직원관리 · 권한은 원장 역할 + 학원 설정에서 지정
- 연차 부여 = 입사일에서 계산, 저장하지 않는다
- 커스텀 권한그룹(makeedu식 면/탭 전면 매트릭스) = 비채택.
- 직원관리(/staff) 접근 = 원장(master) + 개인 예외 체제
- 역할·권한 면 = 표의 줄은 왼쪽 탭·내부 메뉴 차례(`permission-rows.ts` 한 곳) · 개인별 메뉴 권한은 원장이 화면에서 주고 거둔다 · 🔴 침산 개인 예외 스크립트 재실행 금지
- 사람을 지정하는 권한은 전부 역할·권한 면에서 — 코드에 계정 명단 없음(전자결재 · 급여명세서 열람 · 연차 조정 · 수업 나누기 · 업무 처리 현황 · 직원관리 과목 범위) · 새 '이 사람만' 기능은 `permissions.specialAccess`에 칸을 더한다 · 원장 역할은 지정 없이 전부 통과
- 새 권한의 기본값 = 원장 '전체' · 나머지 '없음' — 다른 역할에게는 원장이 역할·권한 면에서 연다(가드 `permissions.test.ts`)
- 과목 내부 키(`subjects[].key`) = 자동 확정·불변
- master 시스템역할 표시 라벨 = "원장"

### 셸·창·강사뷰·로그인 세션 → [`docs/decisions/shell.md`](docs/decisions/shell.md)
- 녹음 = 여러 개 켜 두고 소리는 하나(누른 녹음만 · 나머지 자동 일시정지 · 같은 대상은 하나) · '작성 화면 열기'는 입력하던 그대로(`recording-resume.ts`)
- 필터 10분 초기화 = 새로 열 때 10분 넘게 안 본 화면이면 행 필터만 기본값 · 🔴 열어 둔 화면은 그대로(입력 초안 보호) · 새 저장 필터는 `filter-reset/rules.ts`에 한 줄
- 탭 및 메뉴 구성 = 화면 하나에 메뉴 하나 · 화면 안 내부 탭은 메뉴에 따로 세우지 않는다(`INNER_TABS` · 예외 = 수납의 교재·지출 메뉴 버튼) · 선생님이 열 수 없는 메뉴를 세우지 않는다
- 화면 최대화 = 창 모드 꺼진 데스크톱 관리자 풀셸만 · 계정 귀속 한 키(`ui_prefs.shell.maximized`) · 머리글 오른쪽 끝 같은 파란 버튼 하나로 켜고 끈다(머리글 줄은 남는다 · 떠 있는 모서리 버튼 금지 · 머리글 없는 화면은 출구 줄) · 메뉴 이동·새로고침에도 유지
- 데스크톱 셸 경계 = 화면 폭 1240px(+마우스 — `any-pointer: fine`, 마우스·터치패드가 하나라도 · 브라우저가 '마우스 없음'이라 보고하는 터치 모니터 PC는 **실제 마우스 움직임**(`data-desk`, desk-detect.ts)) · 좁으면 모바일 셸 · 운영실 폭 차단 폐지 · 조건은 `desk:`(다섯 곳 한 값)
- 창 모드(플로팅 창) = 지점별 켜고 끄기 · 슈퍼관리자 학원 상세 · 기본 켜짐 · 창을 여는 판정은 `useWindowMode()`
- 화면 방식은 셋(창 모드 / 단일 화면(이전 화면 유지) / 단일 화면) · 방식·판이 바뀌면 그 브라우저의 창·유지 화면 전부 초기화 · 유지 5개 · 숨은 지 10분 넘으면 데이터만 새로고침 · 사용 없이 2시간 삭제 · 주소창 = 보이는 화면 · 저장은 `window_mode`+opt-in `window_keepalive`(SQL 0)
- 창 이동 규칙 — 메뉴·창 전수검사 나머지 7종
- 강사뷰 화면 언어(한국어/English) = `users.teacher_view_lang` + 개인 선택 · 스위치는 '내 메뉴' 하나
- 강사 = 원스크린 전용 미니셸
- 강사 홈은 과목으로 갈린다 — 영어 전담 = ECS, 그 외 = 원스크린
- 로그인 세션 = "절대 로그아웃 안 함"(자동 로그인).
- '다른 강사 뷰' = 열람 전용 + 강사는 모른다
- 겸직(관리자 계열 + 담당 반) 뷰 전환 = 강사뷰↔관리자뷰 토글

### 재고·셔틀·캘린더·연동·범위 → [`docs/decisions/ops.md`](docs/decisions/ops.md)
- 재고관리 탭 = 자산관리대장 시안의 시트 4개를 면 4개로 · 자산 1대 = 영구 행 1개
- 수업 평가(`/class-review`)에서 강사 직급 = 자기 평가 전용
- 의도적 비이식(영구 제외)
- 캘린더 탭 = aywa DB 단일 진실
- 구글 캘린더 → aywa = 푸시 알림(웹훅) + 증분 동기화 · 하루 2회 전체는 안전망(한 방향 그대로)
- 셔틀의 다음 축은 '실시간·관제·위치'다 — 법정 기록도 학부모 표면도 아니다
- 셔틀 탭 = aywa DB 단일 진실 · 정류장 마스터 + 시즌 축
- Excel/스프레드시트 = 내보내기·가져오기만.
- 미디어 저장 = Supabase Storage 단일 경로
- makeedu 동기화 = 집 신뢰 IP 로컬 실행

## 🗣️ 사용자 작업 선호 — 반복 교정 금지 (항상 적용)

- **지점과 슈퍼관리자 설정 분리 (원장 2026-10-02):** 지점 화면은 지점 관리만 담당한다. 슈퍼관리자 운영 설정은 `/admin`으로 진입하는 운영자 콘솔의 책임이며 지점에 관련 역할·배정·권한 예외·담당자 선택을 노출하지 않는다. 기존 운영자 설정은 일반 지점 설정 저장 시 보존하고, 지점 저장 경로에서는 추가·수정·삭제를 거절한다.

사용자가 이미 준 피드백이다. **같은 교정을 두 번 하게 만들지 말 것.**

- **main = 프로덕션 · 작업 격리 정책 (2026-07-15 원장 지시로 갱신 — 07-14 "main 직접"을 뒤집음):** **항상 격리 git 워크트리(origin/main 기반)에서 작업 → 검증 → 적대적 리뷰 → main에 병합/푸시.** ⚠️ **공유 작업트리(D:\eywa_refactoring)에 미커밋 편집을 두지 말 것** — 여러 세션·하네스(epitaxy 자동 stash)·codex 에이전트가 동시에 브랜치를 계속 전환/reset해서, 미커밋 편집이 auto-stash로 쓸려가거나 유실된다(2026-07-15 한 세션에서 2~3회 실측: billing 다계좌·시간표 hover 편집이 브랜치 전환에 사라짐). 격리 워크트리는 별도 디렉터리라 이 churn에 영향 없음.
  - **표준 절차:** `git fetch origin` → `git worktree add <리포 밖 scratch경로> -b fix/<name> origin/main`(중첩 worktree=eslint OOM 회피) → 편집 → 검증(node_modules **정션** 연결 후 typecheck(내 파일 에러만; 마케팅 `_img/*.webp`는 미추적 노이즈)·lint·가능하면 실행) → **적대적 리뷰**(결함 있으면 수리·재검증·재리뷰 · 마지막 커밋·푸시 전 필수, 2026-08-18) → 정션은 `cmd //c rmdir`(링크만)로 뗌([[#66]]류 rm -rf 정션 함정 금지) → **내 파일 경로만** 커밋(`git add -A`/`-a` 절대 금지, [[#62]]) → **⚠️ push 직전 최신 통합(원장 지시 2026-07-16): `git fetch origin` → origin/main이 진행했으면 `git merge origin/main`(병렬 작업 보존 위해 merge 우선 — 충돌은 내 파일만 해결, 남의 hunk 보존)** → (병합에서 손본 hunk가 있으면 그 부분 재리뷰) → `git push origin HEAD:main`(훅 우회 `# ALLOW_DANGER`는 **사용자 승인 시만**) → `git worktree remove --force` + 브랜치 삭제.
  - **⚠️ 커밋·푸시 전 항상 최신 git 확인 (원장 지시 2026-07-16):** 다른 사람/세션이 동시에 작업 중일 수 있으니 **반드시 `git fetch` 후 최신 origin/main을 pull/merge로 통합**한 뒤 반영한다. **병렬 작업을 절대 덮어쓰지(clobber) 말 것** — 진행했으면 merge(병렬 커밋 보존)로 통합, 충돌 시 내 파일만 해결하고 남의 변경은 그대로 둔다. force-push·非-FF clobber 금지.
  - **⚠️ 커밋 전 항상 적대적 리뷰 (원장 지시 2026-08-18 → 2026-08-31 강화: *"커밋 전에 항상 구현건에 대해 적대적 리뷰하고 버그 수정"*):** **모든 커밋** 전에 이번 구현을 공격하는 관점으로 반증하고, 나온 결함은 **그 자리에서 고친 뒤** 커밋한다(중간 WIP 커밋도 예외가 아니다 — 옛 규칙은 '마지막 커밋'만 걸었는데 그러면 결함이 여러 커밋을 지나 살아남는다). 순서 = 적대적 리뷰 → (결함 수리 + 재검증 + 재리뷰) → 커밋 → fetch/merge(바로 위 불릿) → (손본 hunk 재리뷰) → 푸시. 이 규칙은 fetch/merge·격리 절차를 대체하지 않는다. "일단 커밋하고 리뷰" 금지. 적대적 리뷰 = 문서·설정 포함 **이번 변경**을 공격하는 관점(회귀·권한·상태 레이스·집계 축 불일치·다른 표면과의 숫자 차이)으로 반증하고, 통과한 것만 반영한다. 자기 작업을 정당화하는 혼잣말은 리뷰가 아니다.
  - **⚠️ 적대적 검증은 지침이 명시한 지점에서만 (원장 지시 2026-08-19):** 위 규칙이 요구하는 검증(푸시 전 리뷰 · 수리 후 재리뷰 · 병합에서 손본 hunk 재리뷰)은 반드시 실시하되, **그 외 지점에서 적대적 검증을 임의로 추가하지 말 것**(원장: *"지침으로 적대적 검증하라고 하면 검증 실시할 것, 이외에 적대적 검증 금지"*). 리뷰 라운드를 늘리는 것은 시간·토큰 비용이다 — 필수 지점만 정확히.
  - 이미 공유 트리에 두었다가 stash로 쓸려간 작업은 `git checkout 'stash@{0}' -- <내 파일>`로 워크트리에 추출(다른 세션 WIP 섞인 stash는 **드롭 금지**, 내 파일만). 공유 트리에 남은 내 **고아 부분편집**은 diff로 순수 내 것 확인 후 `git checkout -- <내 파일>`로 정리.
  - **남의 워크트리/브랜치/stash는 건드리지 말 것.** 검증은 항상 유지, **대형·비가역·외부발신은 여전히 사용자 승인 후 반영.**
- **모든 뷰 세팅은 계정 귀속 (원장 2026-08-04 "당연하지만 항상")** — 단 **필터는 10분 넘게 안 본 화면이면 기본값**(원장 2026-10-15, [`filter-reset/rules.ts`](src/lib/filter-reset/rules.ts)): 정렬·필터·글씨 크기·표시 토글 등 화면 보기 상태는 localStorage가 아니라 **`users.ui_prefs.<화면>` DB**에 저장한다(다른 PC에서도 같은 상태로 열린다). localStorage는 **포트 포함 origin 단위**라 "로그인은 그대로인데 설정만 리셋"으로 위장한다([[#90]]). 서버가 목록을 좁혀 내려주는 필터는 저장 후 `router.refresh()`.
- **"제목/이름 변경" 요청 = 라벨 문자열만** 바꾼다. 데이터 바인딩·소스를 임의로 갈아끼우지 말 것(기존 행이 "—"로 증발함). 바꾸는 게 낫다 싶으면 **제안만**. 리네임 후 기존 행이 동일 렌더되는지 확인이 완료 조건.
- **병렬 세션 주의(#62)**: 공유 작업트리를 여러 세션이 동시 사용한다. 통째 `git add` 금지 → **내 파일 명시 경로만** 커밋. 큰 변경 후 `git fetch` + `HEAD..origin/main`으로 내 WIP가 물렸는지, 의존하는 신규 파일 누락은 없는지 점검.
- **운영 enum 하드코딩 금지**: 과목/학년/직급/교시 = 학원설정 단일 소스. 서버 `buildSubjectMaps(getTenantSettings)`, 클라 `useSubjectMaps()`/`useGradeLevels()`. `SUBJECT_META`/`LABEL`/`COLOR` 등 코드 상수 신설 금지.
- **UI에 raw 코드·기술 원문 노출 금지 (반복 지적, 2026-07-10 재발)**: 화면에 `withdrawn`·`math`·`page.goto: net::ERR…` 같은
  영문 enum/키/에러 원문을 그대로 내보내지 말 것. 상태=`studentStatusLabel`([status-labels.ts](src/features/students/status/status-labels.ts)),
  과목=`labelOf`, 에러=한글 요약+원문은 `title` 툴팁([classnote-error.ts](src/features/report-admin/classnote-error.ts) 선례).
  **새 표시 문자열이 DB 값·에러 객체에서 오면 한글 매핑을 거쳤는지 확인이 완료 조건.**
- **성능/병목 = 기능 버그 동급**: 새 쿼리·라우트·차트는 위 "성능/병목 절대 규칙(B1~B7)" 체크리스트 통과가 "완료" 조건.
- **중요 배선은 문서화**: 권한/설정 등 배선을 구현할 때마다 소비처·갭을 `docs/changelog.md`(또는 여기)에 기록.
- **2열 카드 높이 균형**: 한쪽이 짧아 빈 여백이 드러나면 `lg:items-stretch` + 짧은 카드 `flex flex-col` + 마지막 요소 `mt-auto`.
- **통계처럼 넓게 읽어야 하는 화면은 좁은 창에 억지로 보여주지 않는다**(원장 2026-10-21). 필요한 최소 너비를 요구하고, 미달이면 차트 대신 창을 넓히라는 안내를 표시한다. 원생 통계(`/students/stats`)는 가로 1,100px · 플로팅 창 최소 크기와 같은 기준 · 세로는 스크롤.
- **"속도 개선/새 창 빠르게/반응속도" 류 요청** → `docs/perf-open-window-backlog.md`의 효과순 레버로 제안·실행.

## ❓ 질문 정책 — 반복 질문 금지

- **묻기 전에 위 "이미 내린 결정" · "작업 선호"를 먼저 확인.** 거기 답이 있으면 **묻지 말고 따르라.**
- **코드 · git 히스토리 · 이 문서 · `docs/`에서 확인 가능한 사실은 조회로 해결**한다. 사용자에게 되묻지 말 것.
- **합리적 기본값이 있으면 그 값으로 진행**하고 한 줄로 알린다(승인 대기 X). 단 **비가역·외부 발신·main 반영**은 승인받는다.
- 정말 사용자만 정할 수 있는 것(방향 선택·범위·트레이드오프)만, 그것도 **모아서 한 번에** 물어라.
- 사용자가 새로 정해준 결정·선호는 **여기(결정 로그/작업 선호)에 적어** 다음부터 자동 적용 — 다시 묻지 않는다.

## 🧯 막힌 점 인덱스 (트리거만 — 상세는 `docs/gotchas.md`)

> 코드 짜기 전 이 목록을 훑고, 걸리는 항목이 있으면 `docs/gotchas.md`에서 그 번호를 열어라. (특히 규칙형 #53·#54·#58~#63·#67·#69·#71·#73·#74.)

- **#1** Next.js 16 — "middleware" 컨벤션 deprecation
- **#2** shadcn base-nova preset = base-ui 기반 (Radix 아님)
- **#3** Pretendard dynamic-subset이 SVG 텍스트를 못 감지
- **#4** SVG viewBox 비례 확대 = fontSize도 확대
- **#5** postgres-js batch insert의 컬럼 이름
- **#6** drizzle-kit이 .env.local 자동 로드 안 함
- **#7** Drizzle migration 번호 vs 손수 RLS SQL의 prefix 충돌
- **#8** Supabase 새 프로젝트는 IPv4 direct connection이 deprecated
- **#9** DB password를 Google OAuth secret과 혼동
- **#10** Server Action 로그인이 cookie 전파 안 되는 무한 redirect (가장 큰 버그)
- **#11** React Server Component에서 `Date.now()` 호출 lint 에러
- **#12** Lucide React 화살표 아이콘이 한글 자모로 오인됨
- **#13** trend window가 오늘 포함하면 0% drop
- **#14** 시드 변수 중복 선언 (`today`)
- **#15** Drizzle이 GiST EXCLUDE / 부분 인덱스 / generated column을 표현 못 함
- **#16** UI 자잘한 어색함들 (frontend-design swing 후)
- **#17** Vercel deployment queue / dev 서버 hang
- **#18** Server Component의 cookies() / RSC vs Server Action
- **#19** 시안 디자인 vs 실 운영 도구 갭
- **#20** 라운드 디자인 톤 조정
- **#21** (marketing) 라우트 그룹과 `/` 경로 충돌
- **#22** invoices delete 순서 (시드 재실행)
- **#23** dev 서버 background 출력 stdout flush 안 됨
- **#24** 시간표 컬럼 폭 (강사 × 다중 요일)
- **#25** React 19 `react-hooks/set-state-in-effect` 룰 — setState in useEffect 금지
- **#26** 모바일 nav `overflow-x-auto` 가로 스크롤바 + 어색한 wrap
- **#27** super_admin layer를 만들 때 깨질 가정 4가지
- **#28** `(super-admin)` 라우트 그룹 + `/super-admin/*` URL → 폴더가 두 번 중첩
- **#29** Server Component layout에서 active pathname 못 받음
- **#30** invoices 컬럼명 `amount` vs `amount_total`
- **#31** seed 가짜 강사가 auth.users에 없음 → auth admin API "User not found"
- **#32** seed wipe가 실제 gmail 계정(teacher로 강등된 st2000423)을 삭제 → 로그인 튕김
- **#33** Chrome MCP 좌표 클릭이 작은 토글의 form submit을 못 트리거
- **#34** 로그인 폼 autofill이 MCP 입력을 덮어씀
- **#35** server action 신규 추가 시 dev hot reload가 stale
- **#36** dev 서버가 build와 동시 실행 시 자주 죽음 + screenshot clip 에러
- **#37** Base UI Sheet/Dialog는 React state mount에 시간차 (~1.5–2.5s)
- **#38** Chrome MCP 전체 버튼 재검증 — `[BLOCKED: Cookie/query string data]`
- **#39** MCP 합성 ref-click이 앵커 내비·React onClick을 항상 트리거하진 않음 (#33 확장)
- **#40** `read_network_requests`가 base64 `data:image` 포함 시 토큰 한도 초과
- **#41** 커스텀 인라인 다이얼로그·아이콘 버튼 탐지
- **#42** 셀프투어 재검증에서 잡은 진짜 깨진 창문 — 상태 변경 메뉴가 항상 "재원으로 전환…"만
- **#43** Chrome MCP 로그인 — form_input이 React 상태 미동기 + 합성 submit 미발화 (#33/#34/#39 합본)
- **#44** Stage Manager 배경 교체 — `router.push` 직후 pathname 비동기 레이스
- **#45** 스냅/타일 "해제 시 원래 크기 복원" — applyLayout이 prevRect를 지웠음
- **#46** 드래그가 드롭 때만 clamp → 타이틀 가림 + 스냅 바 과민
- **#47** 창 애니메이션 — 지연 언마운트 + 모션 토글 + TS 클로저 narrowing 소실
- **#48** 커밋 분할 — 결합된 변경은 같은 커밋, 파일 단위로만 쪼갬
- **#49** 배경 탭 스트립이 선택할 때마다 재정렬 — 스택 순서 ≠ 활성 표시
- **#50** 창→배경 드래그 칩 ↔ 스냅 레이아웃 바 — 같은 상단을 두 어포던스가 다툼
- **#51** dnd-kit `DndContext`는 SSR에서 명시적 `id` 필수 (hydration 불일치)
- **#52** 합성 PointerEvent로 워크스페이스 드래그 테스트 — 캡처 메서드 둘 다 stub
- **#53** 대량 `.in("…id", ids)` = HTTP 414 + error 삼킴 (반복 안티패턴)
- **#54** PostgREST 기본 max-rows ≈ 1000 — 전건 fetch는 silent 절단
- **#55** 창(iframe) ⇄ 배경(메인 프레임)은 **별도 문서** — 저장이 자동 반영 안 됨
- **#56** 창 내비게이션 모델 — 루트에선 ← 숨김(닫기=X), 권한 리다이렉트는 루프 주의
- **#57** 너비 조절 사이드바 — 드래그 핸들 + 프리뷰 트랜지션 얼음 함정
- **#58** 권한 게이트는 tenant-aware 헬퍼만 — bare `canAccess`/`accessLevel` 직접호출 금지 (⚠️ 하면 안 됨)
- **#59** tenant_settings 직접 쓰기 금지 — owner 단일 진입점 + DB 트리거가 비-master를 막는다
- **#60** 권한 폴백은 fail-open 고정 — fail-closed로 바꾸지 말 것 (⚠️ 복구불능 락아웃)
- **#61** 클라가 import하는 공유 모듈에 `import "server-only"` 금지 — 런타임 상수 누출 빌드깨짐
- **#62** 병렬 세션 schema.ts/공유파일 충돌 — 통째 `git add` 금지, 내 hunk만 인덱스에 적용
- **#63** 내 커밋 단독 검증 = 격리 워크트리 typecheck (작업트리 전체는 남의 WIP로 깨질 수 있음)
- **#64** 같은 탭 다중 창(복제) + 크로스 창/탭 저장 경고 — 창 id 인스턴스 모델·BroadcastChannel·publish 타이밍
- **#65** 워크스페이스 창 rehydrate는 모듈 로드 시점 — effect에서 부르면 영속본이 파괴됨(새로고침 시 창 전멸)
- **#66** 테이블 셀 배경/음영은 td에 — 내부 고정 크기 자식에 주면 셀을 못 채운다 (출석부 주말 음영)
- **#67** 항상 마운트된 다이얼로그 + 가드 없는 useActionState 성공 부수효과 = 재오픈 즉시닫힘("클릭 무반응")
- **#68** 스포트라이트(앨범)모드 = 다중 창 타일 + 배경 딤 + 배경 카드를 앨범 안으로 (2026-06-30)
- **#69** 미저장 닫기 가드 — winId 경로추측 금지(iframe→부모 postMessage) + 컨트롤드-미러 폼은 커밋 후 읽기 + 워크스페이스 HMR은 stale
- **#70** 미러 트리거가 metadata-only 갱신에서 role을 stale app_metadata로 덮음 → 임포트 강사 조용한 강등 (2026-07-01)
- **#71** border-collapse 표의 sticky 행/열 테두리는 셀 border·box-shadow가 아니라 `::before`/`::after` 실선으로
- **#72** Realtime WS 무한 재연결(콘솔 폭주) = 배포 env의 anon 키 끝 개행이 apikey를 `%0A`로 오염 (2026-07-06)
- **#73** 새 Zod 스키마 필드가 저장 시 사라짐 = dev `.next`가 서버 모듈만 stale 컴파일(클라 fresh/서버 stale 분기) (2026-07-06)
- **#74** 반투명 `-soft` 토큰 셀을 sticky로 만들면 본문이 비친다 → 불투명 base + 색밴드 레이어 (2026-07-06)
- **#75** localStorage를 lazy `useState` 초기값으로 읽으면 hydration 크래시(#418) — 페이지 클릭 전부 먹통 (2026-07-13)
- **#76** 외부 API 전건 스캔을 서버 컴포넌트 첫 페인트에서 await = 타임아웃 → 화면 안 열림 (2026-07-13)
- **#77** "화면에서만 잠갔다" = 우회 폭 — 한 레코드의 모든 표면(목록·탐색기·서버액션)이 **공용 게이트 함수**를 통과해야 (⚠️ UI 조건은 게이트 아님)
- **#78** 초안 자동저장은 name 가진 칸을 **전부** 캡처 — 민감 폼은 `exclude` 필수(안 그러면 주민번호가 IDB에 평문) (⚠️ 새 민감 칸 = exclude도 갱신)
- **#79** `sr-only`=absolute라 positioned 부모 없으면 스크롤 컨테이너를 뚫고 나가 **창 안 스크롤바 2개** (⚠️ sr-only는 항상 positioned 부모 안에)
- **#80** Anthropic Claude 5 계열은 `temperature`가 deprecated(400) — 직접 호출에 넣지 말 것, generateJSON은 자가 재시도 (⚠️ 모델 교체 시 재발 주의)
- **#81** `"use client"` 모듈의 문자열 상수를 서버가 import = 런타임 undefined — 공유 상수는 일반 모듈로 (⚠️ 타입체크 통과하는 침묵 버그)
- **#83** React 19는 `<form action={서버액션}>`을 제출할 때마다 **자동 리셋** — 컨트롤드 입력이 "저장했는데 옛 값"으로 굳고, 재저장 시 직전 저장이 되돌아감 (⚠️ 제출 후에도 남는 폼은 `onSubmit`+직접 디스패치)

- **#84** "정렬 편향 × 상위 N 자르기" = 카테고리 통째 실종 — 상위 N 미리보기는 **카테고리별로** 자를 것(⚠️ Postgres 정렬은 로마자→한글, `localeCompare("ko")`는 정반대)
- **#85** 배포가 "초록색 success"인데 실제로는 안 나감 — `ignoreCommand`는 **tip 커밋 1개만** 본다. **머지하고 push하면 항상 skip**이었다(워크트리 정책과 충돌). ⚠️ 뭉쳐 push할 땐 docs 커밋을 tip에 두지 말 것 · 확인은 초록색이 아니라 `gh api …/status --jq '.statuses[].description'`
- **#86** 창 시스템 앱에서 `router.push`는 눈에 안 보인다 — 배경이 창에 덮여 있다 (⚠️ 알림/팰릿 등 최상위 프레임 이동은 WindowLink와 같은 경로로) + 본문이 N명인데 link가 1개면 그 link는 거짓말
- **#87** `overflow-x: scroll`은 넘치지 않아도 트랙을 예약 → **꽉 찬 thumb의 가짜 스크롤바**("스크롤이 없는데도 스크롤이 있네"). 넘침 판정은 브라우저에 맡기고(`auto`) 굵기·색만 손댈 것 (⚠️ 진단 = `offsetHeight-clientHeight`≠0인데 `scrollWidth-clientWidth`=0)
- **#88** `class_schedules`는 **운영 이력을 함께 담는다**(실측 1,068행 중 480행 만료) — 전 행을 그리면 끝난 교시가 현재로 보이고(반 상세 25줄 중 15줄) 미래 시작 교시도 현재로 샌다. 화면·AI·집계는 `summarizeSchedule`, 쿼리는 `liveValidTo` 절 (⚠️ 종강 반엔 걸지 말 것 — 요일이 통째로 사라진다)
- **#89** 상한 걸린 미리보기의 **배열 길이를 건수로** 쓰지 말 것(34명이 영원히 "30") · 창으로 좁힌 수치에서 창 떼기 금지 · `max_tokens` 절단이 JSON 오류로 위장 · ⚠️ 폴백 있는 기능은 실패율을 따로 계측
- **#90** 브라우저에 저장한 "사용자 설정"은 계정 설정이 아니다 — localStorage는 **포트 포함 origin 단위** · 사람을 따라다닐 값은 DB 계정 단위로 · 설정 토글은 **바꾸는 순간 저장**
- **#91** RLS 정책에 **컬럼을 안 쓰는 게이트 함수를 맨몸으로** 쓰면 행마다 호출된다 → **`(select f())`로 감쌀 것** · 판별은 `EXPLAIN`의 `Filter`(컬럼 비교 `Index Cond`는 그대로) · ⚠️ 성능은 authenticated 롤로 잴 것
- **#92** RLS를 한 테이블에 걸었다고 **그 계열이 다 잠긴 게 아니다** · ⚠️ **"의도적 제외"는 마이그레이션에 적어라** · ⚠️ 잠그기 전 `auth_menu_access` DEFAULTS 확인(fail-closed 락아웃)
- **#93** 이름이 비슷한 두 컬럼이 **다른 사실**일 수 있다 — `created_by`(작성자) ≠ `teacher_name`(소유자) · ⚠️ 소유 판정을 created_by로 바꾸지 말 것 · 백필 금지
- **#94** PostgREST 임베드에 **FK 이름을 안 적으면** 남의 컬럼 추가로 화면이 죽고 "총 0건"으로 위장 → `.select(` 임베드는 항상 `ident!<FK이름>(…)`(⚠️ 정렬 문자열엔 넣으면 400) · 가드 `postgrest-embed-hints.test.ts`
- **#95** 🔴🔴 **마이그레이션보다 앱을 먼저 배포하면 그 화면이 통째로 죽는다** — 모든 배포는 옛·새 스키마 둘 다에서(expand/contract) · 🔑 원스크린 로스터·시간표엔 새 컬럼 금지
- **#96** 지원 안 하는 모델을 요청 배열에 넣어도 **에러가 안 난다**(조용히 폴백) — 🔑 판별은 응답의 `speech_model_used` · AssemblyAI 상위 라인엔 한국어 없음 · 가드 `assemblyai-models.test.ts`
- **#97** 표를 **잡고 끌 수 있게** 만들면 더블클릭이 새어나간다 → 드래그-팬 영역의 여는 동작은 **우클릭** · 자동 폭은 행이 사라질 때마다 표를 민다 → `colgroup`+`table-fixed`
- **#98** `transform` 걸린 조상은 **`position:fixed` 자손의 좌표계를 갈아탄다**(DragOverlay가 엉뚱한 데) → 드래그·팝오버를 품는 컨테이너는 **flex 센터링** · zoom 래퍼는 DndContext 안쪽
- **#99** `aspect-ratio` 박스에 **높이를 주면 폭이 열을 넘어 옆 칸을 덮는다**(지문 = 창을 넓혀도 안 변함) → 비율 카드는 **`w-full`로 폭 확정** · 한 열로 접히는 창은 띠 높이 명시
- **#100** 단일 구간(`starts~ends`) 스키마에 **흩어진 날짜**를 넣으면 "오늘"이 사라진다 — 가장 이른 날 + 나머지는 detail · 🔴 후검증은 **알리기만**(판정을 당기지 말 것)
- **#101** 폰 알림이 안 오는 건 권한이 아니라 **API가 다른 것**(안드로이드 크롬 `new Notification()` 미지원 · iOS 홈 화면 추가는 필요조건일 뿐) · ⚠️ `sw.js`에 fetch 캐싱 금지
- **#104** RLS 정책이 **0개인 표**는 사용자 클라이언트로 읽으면 **에러 없이 0행** — 🔑 "성공인데 0행"이면 `pg_policies` 먼저 · ⚠️ admin으로 읽으면 `tenant_id` 필터 필수
- **#105** **조치가 필요한 목록**에 짧은 시간창을 걸면 고치기도 전에 사라진다 — 🔑 창은 **"언제까지 손 쓸 수 있나"**로 · 기한은 행에 남은 날로 · 판별은 상태 이름이 아니라 사유
- **#106** 시작시각이 같은 교시가 둘이면(EiE 4교시·IJW 1교시 16:20) 찍어둔 수업이 **다른 칸으로 옮겨 보인다** — 역매핑은 (시작,종료) 짝 먼저(`buildPeriodMatcher`) · 🔴 시작시각 폴백은 남길 것
- **#102** 서버 액션을 부른 **직후의 `router.push`는 삼켜진다**(목적지를 받아 놓고 멈춤) — 액션 뒤 이동은 **`window.location.assign`** · 타임아웃도 · ⚠️ 긴 액션을 `startTransition`으로 감싸면 모든 이동이 멈춘다
- **#103** 칸을 잠그면 **이동 경로와 뒷문**까지 — disabled는 Enter 이동을 끊고, 복사·일괄 적용이 잠긴 칸에 값을 넣는다 · 🔴 되돌릴 문(출결)은 같이 잠그지 말 것
- **#107** "권한 위에 있다"를 **override 폐기**로 구현하면 super_admin이 일반 직원보다 **덜** 본다 — 폐기가 아니라 `mergeMostPermissive` · 🔑 진단은 남아 있는 메뉴를 볼 것
- **#108** `window.location.origin`으로 만든 문자열을 **텍스트로 렌더하면** 하이드레이션이 깨진다(React #418) — 표시는 `NEXT_PUBLIC_APP_URL`, 복사는 클릭 시점 origin · 핸들러·effect 안은 안전([[#75]])
- **#109** RLS 정책 **둘이 서로의 표를 조회**하면 무한 재귀(42P17)로 그 표 전체가 500 — 교차 조회는 security definer 함수로 · 🔑 service_role로는 재현 안 됨(anon 키로 긁어 볼 것)
- **#110** 하단 고정 저장 바와 "스크롤 끝 여백"은 **같은 속성(main pb)을 반대로 요구** — ⚠️ 새 하단 고정 저장 바엔 반드시 `.sticky-save-bar` 클래스
- **#111** **인라인 `<a>`에 건 `truncate`는 아무 일도 안 한다** — 배지가 둘째 줄로 꺾여 그 행만 부푼다 · 고침 = flex 한 줄 · ⚠️ 밀도 높은 입력 표에선 `flex-wrap` 금지
- **#112** "대표 행 하나"를 **최신순**으로 집으면 교시 축에서 **엉뚱한 행**을 집는다 — 🔑 찾는 조건을 정렬로 흉내 내지 말 것(`status`로 좁히기) · 공용 모듈 + 가드
- **#113** **부분 유니크 인덱스는 `ON CONFLICT (컬럼)`로 추론이 안 된다** → supabase `upsert` 전건 42P10 · 그 축으로 upsert할 거면 `WHERE`를 붙이지 말 것
- **#114** 카드 테두리는 **그림자 링**이라 `overflow-y-auto` 컨테이너가 좌·우 세로선을 자른다 — 스크롤 컨테이너에 안쪽 여백(`px-1`)
- **#115** 같은 사실을 **FK와 텍스트 라벨 두 벌**로 들면 한쪽이 비는 날 표시가 갈린다(`본원 3층`/`3층`) — 라벨 폴백도 정본 이름으로(`canonicalRoomName`) · ⚠️ 애매하면 손대지 말 것
- **#116** 좁은 `table-fixed` 칸의 **`whitespace-nowrap` 라벨은 흘러넘친다** — 라벨만 `break-keep`(🔴 `truncate` 금지) · 🔴🔴 공유 클래스 상수를 쪼갤 땐 값을 하나도 빼지 말 것
- **#117** 한 배열에 **모양이 셋인 결과**를 담으면 `!x.ok`가 성공을 전건 실패로 뒤집는다(재발송 = 되돌릴 수 없다) — 판정은 [`noticeFailures`](src/features/report-admin/notice-failures.ts) 한 곳 · ⚠️ `revokeNotice`엔 스프레드 금지
- **#118** **크레딧 소진은 400이라 "폴백할 오류"로 안 잡힌다** — 판정은 상태코드+문구 둘 다(`isCreditExhaustedError`) · ⚠️ 폴백 산출물이 원본보다 적게 말하면 조용한 사실 손실 · 실패율 따로 계측([[#89]])
- **#119** **`"use server"` 파일은 async 함수만 export할 수 있다** — 동기 헬퍼에 export를 붙이면 **빌드만** 깨진다(typecheck·lint·테스트 전부 통과). 공유 동기 헬퍼는 서버 액션 파일 **밖** 일반 모듈로 (⚠️ `import "server-only"`는 붙이지 말 것 — [[#61]]) · 가드 `server-action-exports.test.ts`
- **#120** **유니크 인덱스에 `WHERE is_active`가 없으면 폐지된 반이 이름을 붙든다** — 개명 cron만 23505로 실패하고 재시도도 안 한다 · ⚠️ 제약 걸린 쓰기는 트랜잭션 안에서 실제로 실행해 볼 것
- **#121** 임계값·창(window)의 **이름을 화면 문구로** 쓰면 숫자는 맞는데 사실이 틀린다(새벽 2시에 오후 2시 수업을 "2시간 뒤") — 화면엔 기준이 만들어 낸 **실제 값**(시각·날짜)을 적을 것
- **#122** 시트가 **번호만** 적는 값(방 `602`)은 후보가 둘이면 목록 순서가 대신 고른다 — 원장이 **보관해 둔** 폐강의실에 배치가 붙었다(가져오기만 `archived_at`을 안 봄). 필터는 **후보를 고르는 곳**에만, id→이름 조회엔 걸지 말 것
- **#123** "어제까지 마감·오늘부터 새로"(`planSlotArchives`)가 **미래 예약과 만나면 그 사이 하루가 빈다** — 적용일 전날에 그 반을 수정하면 그날 수업이 화면에서 통째로 사라진다 (미해결)
- **#124** 구분자로 자른 **첫 조각만** 읽으면 한 칸에 값이 둘일 때 나머지가 조용히 사라진다 — 합반 셀(`A/ B/ 304`)의 둘째 반이 시간표에서 통째로 없어졌고 가져오기가 마감까지 했다
- **#125** 명단 쿼리의 `end_date.gte` 는 **답이 아니라 프리필터**다 — 반이동한 학생이 그 하루 양쪽 명단에 선다 · `is_transferred` select + `isEnrollmentEndedOn` 호출
- **#126** "이 반만 왜 다르지" = 일괄 정리 뒤 **정정이 일부에만** 들어갔다 — 사라진 배치는 스냅샷 id + 내용으로 되짚기 · 🔴🔴 배치 시각은 찍힌 출결의 앵커(시작시각 이동·수업 중 수정 금지)
- **#127** 선택자 목록 안의 **`:has(> …)`가 dev 산출 CSS에서 조용히 사라진다** — 판별은 서빙된 CSS에 선택자가 있는지 · 회피 = 감출 요소에 표식을 직접(`td[data-empty]`)
- **#128** `overflow-hidden` 카드 안에서 `absolute`로 띄운 겹판은 **카드 경계에서 잘린다**(DOM은 있는데 안 보임 = z-index 아니라 잘림) — 겹판만 **포털+fixed**로 꺼내고 스크롤 재계산·앵커 이탈 시 닫기·초점 이동까지 함께 (⚠️ 첫 프레임은 `visibility` 말고 `opacity`+`pointer-events-none`)
- **#129** **끌던 줄이 언마운트되면 dnd-kit `active.data`가 빈 객체가 된다**("출발 반을 알 수 없어") — 누르는 동안 무장 잠금(`holdArmedRow`) + 집는 순간 data 스냅샷
- **#130** 내보낸 걸 그대로 되읽었는데 **“전건 변경”** — export는 해석한 이름, import는 DB 원문과 비교 · 🔑 왕복하는 두 방향은 같은 정규화를 태울 것(`slotTeacherDisplay`)
- **#131** `display:none`인 iframe은 **preload한 폰트를 안 쓴다** — 최소화한 창이 문서를 통째로 로드하고 있었다 · 진단은 `document.fonts`의 `status:"unloaded"` · ⚠️ `preload:false`로 고치지 말 것
- **#132** 이름·학교·학년이 같다고 붙이는 자동 연결은 **동명이인을 합친다** — "유일 매칭"은 방어가 아니다 · 모순 증거(보호자 연락처 다름)면 붙이지 말 것(0258a) · 🔴 DB 트리거가 바꾸면 **트리거가 감사로그**
- **#133** 창 안 **소프트 이동이 주소에서 `embed=1`을 지우면** 다음 `router.refresh()`에 **창 안에 전체 셸**이 뜬다 — 이동 부품은 `withEmbed` · 안전망 `EmbedUrlKeeper`
- **#134** 창(iframe) 덮개를 `load`에서 걷으면 창 안 스트리밍이 **안 보인다** · iframe `visibilityState`는 **탭 기준**(`frame-visibility.ts`) · 서버 액션 `redirect()`는 303
- **#135** 더블클릭과 구분하려고 **첫 클릭을 보류**하면 모든 클릭이 그만큼 늦다 — 즉시 `router.push` + 낙관 표시, 더블클릭은 편집이 열릴 때 이동을 멈춘다
- **#136** ClassNote `my_reactions`는 **그 명의로 읽어야**(`?author_name=`) 나온다 — 안 붙이면 늘 빈 배열이라 풀기를 **조용히 건너뛴다** · ⚠️ 빈 "내 것" 목록은 없다는 증거가 아니다
- **#137** global-error가 있는데 **Next 기본 화면**("This page couldn't load")이 뜨면 라우터 자체가 죽은 것 — 🔴 셸에서 저절로 도는 조회는 **GET 라우트 + fetch**(서버 액션 금지)
- **#138** **DB 오류를 일반 문구로 삼키면 원인이 사라진다** — `if (error)` 자리는 **`explainDbError(error, { scope, fallback, op })`**, 이른 자리는 `logDbError` · 새 제약은 `db-error-constraints.ts`에 한 줄
- **#139** 🔴 **SQL 시즌2(2026-10-27)** — 시즌1은 `s1_season1.sql` 합본(얼었다). **새 SQL은 `s2_NNNN_설명.sql`**(다음 빈 번호) · 옛 이름은 가드가 실패시킨다 · 🔴 갈라진 작업 합칠 땐 [`docs/sql-season2.md`](docs/sql-season2.md)부터
- **#140** 한 구역을 `all: revert`로 초기화하면 **`hidden` 속성의 숨김까지 지워진다**(크로미움은 그 숨김을 표현 힌트로 건다 — 감춰 둔 이름표가 화면에 떠 있었다) → 바로 아래 `[hidden] { display: none !important }`를 함께 · 판별은 실브라우저 `getComputedStyle` · 되돌리는 선택자는 명시도 0(`:where(:scope), *`)
- **#141** ECS 월간 날짜 button 안의 button → SSR 파서가 셸 밖 노드를 남김 · 직접 진입 후 소프트 이동으로 검증
- **#142** 설정 문서의 한 섹션을 **통째로 갈아끼우면** 먼저 한 저장이 조용히 되돌아간다(`operations`) → 방금 읽은 값 위에 제 몫만 · 🔴 문서 **최상위에 새 키 금지** · 🔴 순서는 값 안의 순번으로
- **#143** 모든 RLS가 지나는 함수(`auth_tenant_id` 등)를 고칠 때 — 본문에 조건을 넣으면 전 지점 조회에 비용 → 얇은 겉함수(`return case … end`) + 속함수 · 🔴 `coalesce` 금지 · 검증은 운영 DB 실행 계획 비교
- **#144** Electron 안에서 `*.asar` 파일을 **쓰면** "Invalid package" — 연동 앱 PC 업데이트가 압축 해제에서 늘 실패했다(1.0.1~1.0.4 · node 테스트로는 안 보임). Electron에서 `.asar` 자체를 다룰 땐 `original-fs` · 업데이트 테스트는 포장된 실행기 안에서도(`bundled-runtime.cjs`)
- **#145** 모델을 올리면 **예시대로 하던 것이 규칙대로**가 된다(Haiku 4.5→5.5: "100%를 해 왔습니다") — 🔑 지시를 늘리지 말고 **재료를 고칠 것** · 모델 교체 시험은 **운영 프롬프트 그대로**
- **#146** Next 16은 **같은 경로에서 쿼리만 바뀌면 페이지(폼)를 새로 그리지 않는다**(상태 키에서 쿼리를 뺀다) — 쿼리가 '다른 화면'을 가리키면 페이지가 그 값으로 폼에 `key`를 걸 것(같은 화면을 가리키는 쿼리는 키에 넣지 말 것)
- **#147** 외부 웹훅이 **N초 안에 답을 못 받으면 다시 보낸다**(AssemblyAI 10초·최대 10번 → 녹음 1건에 AI 6~11번) — 무거운 일은 `after()`로 응답 뒤에 · 진단 = `ai_usage_logs` 같은 입력 토큰 줄
- **#148** 두 시스템이 동명이인 알파벳을 **따로** 매기면 같은 학생이 셋이 된다(권민서A·권민서·권민서B) — 상담→학생 전환은 상담 이름도 같이 바꾸고 · 동기화는 알파벳 뗀 이름 + 전화로 잇고 · 🔑 병합은 외부 키(`makeedu_id`)도 옮길 것
- **#149** `endsWith("등록")`은 **'미등록'도 잡는다** — 부정어가 앞에 붙는 한국어 상태값(미등록·미납·미배정)은 부정 분기를 맨 위에 (⚠️ 전환율 100%로 딱 떨어지는 달은 데이터부터 의심)
- **#150** `(수학)이름` 1인 보드는 발송 경로에서 빠졌어도 반 보드 원아의 **신분 증명 출처**였다 — 🔑 안 쓰는 것을 지우기 전에 읽는 곳을 grep으로 전부 · 원아를 영구히 떼려면 원아 연결도 고친다
- **#151** 고친 코드가 현장에 안 닿는 자리 — AywaSync **실행기(`AywaSync.exe`)는 앱 안 업데이트로 안 바뀐다** · 🔴 실행기 동작을 바꾸면 `LauncherVersion`을 올릴 것
- **#152** '요청 이후 바뀌었나' 스냅숏 대조에 **표시용 칸(반 이름)**을 넣으면 이름만 바꿔도 승인이 막힌다 — 대조 열쇠 `withdrawal_report_compare_key` · 앱 `snapshotMatches` 같은 규칙
- **#153** Next 16은 **경로 매개변수를 디코딩하지 않는다**(`subject:math` → `subject%3Amath` → 404) — `encodeURIComponent`·`decodeURIComponent`를 짝으로 · 부드러운 전환은 윗 `layout.tsx`의 Suspense
- **#154** '다른 강사 뷰'는 **권한표만 갈아 끼운다** — 담당·본인 판정·기록 명의는 `getCurrentUser({ teacherView: true })` · `=== "scoped"` 읽기는 `readonlyViewErasedScope`도 본다 · 확인 못 한 강사뷰는 읽기 전용
- **#155** PUBLIC 실행권을 거두면 **앱 밖 역할**이 막힌다(s2_0031 → 연동 PC `eywa_sync_agent` 42501, ClassNote 발송 1시간 40분 정지) — 🔑 거두기 전에 anon·authenticated·service_role 밖 역할을 센다
- **#156** node_modules 정션은 Turbopack dev에서 panic — 워크트리 dev 서버는 실제 `pnpm install`(정션은 typecheck/lint까지만 · 옛 #81 중복 번호)
- **#82** postgres.js에서 `${JSON.stringify(v)}::jsonb` = **이중 인코딩**(`"#153e75"` 9자 저장 → 검증 실패 → 설정 침묵 무시). 스칼라는 `to_jsonb(${v}::text)`·객체는 `sql.json(obj)`, 검증은 **길이까지** (⚠️ 눈으로 따옴표 구분 안 됨)

## 🎨 디자인 규칙 인덱스 (상세는 `docs/design-conventions.md`)

> UI·화면·폼·컴포넌트를 만질 때 해당 규칙을 `docs/design-conventions.md`에서 열어라. 대부분 각 절 끝에 "한 줄 규칙" 요약이 있다.

- **Editorial 구성 문법 — 새 화면 기본값** (PageHeader·BigStat·PhotoCard·소프트 패널·알약·de-mono 정책, ⚠️ 로컬 Stat/mono·영문 라벨 신설 금지)
- **타입 스케일 v5 + 컨트롤 프리셋 — 글자는 토큰만(xs 14 바닥), 컨트롤 높이는 세로 채움 70%(09-08)** (⚠️ 전역 기본값, 2026-09-03 — `text-[Npx]` 금지(가드), `control-scale.ts` 한 벌(라벨 **18 확정** → 높이 = 18 ÷ 0.7), 검색 `<input>`은 `h-full leading-normal`(잘림), 종이만 `.paper-scale`, 다열 보드 탭 접힘 금지 + 창 최소 크기 강제)
- **툴바 = 카드 껍데기 없이 · 높이는 control-scale · 라운드 덜 둥근 쪽 — 부품 [`toolbar.tsx`] + 가드** (⚠️ 필터/컨트롤 줄 기본값, 2026-09-01→09-03 — 새 툴바는 `<Toolbar>`/`<ToolbarSegment>`/`<ToolbarChip>`을 쓰고 치수를 손으로 적지 않는다. 09-03부터 높이는 h-8이 아니라 `h-(--control-h)`. 새 화면은 `CANON_SURFACES`에 추가. 읽기 전용 배지·패널 안쪽 컨트롤은 대상 아님)
- **컬러 토큰 v4 "White Contrast" + 의미색 캐논** (⚠️ 상태 표시 기본값, 2026-08-18 — 면=화이트·구분=테두리·색=의미에만. 배지 색은 `PillColor`가 아니라 **tone**을 고른다. 화면 파일에 `STATUS_META` 신설 금지. 의미(코드 고정)와 과목(학원설정) 두 축을 섞지 말 것)
- **디자인 lint = `pnpm lint`가 색·없는 클래스를 본다(`shadcn/no-raw-colors`·`shadcn/no-unknown-classes`, warn)** (⚠️ 2026-10-05 — 새 `shadcn/` 경고를 만들지 않는다 · 남은 경고는 [`docs/design-lint.md`](docs/design-lint.md)의 순서대로 고친다(색이 안 나오는 클래스 15곳이 먼저) · 인쇄 서식·랜딩 목업·강의실 도면은 결정 전까지 그대로 · 표식 클래스는 `eslint.config.mjs`의 `allow`에 찾는 쪽과 함께 · lint 첫 줄에 `@shadcn/lint가 설치돼 있지 않아`가 뜨면 이 규칙이 건너뛰어진 것 — `pnpm install`)
- 창(embed)·**모바일** 페이지 헤더 = PageHeader 자동 컴팩트 1행 (⚠️ 새 메뉴 헤더 기본값 — 수제 eyebrow/h1 신설 금지, 콘텐츠 제목은 embedLabel, 2026-07-19 / 모바일 확장 07-30)
- **페이지 헤더 = 한 줄 + 전체 페이지 최대화** (⚠️ 전 메뉴 기본값, 2026-10-01 — 데스크톱 헤더도 `eyebrow - 제목 - 설명` 한 줄 · 스켈레톤은 `PageHeaderSkeleton` · 최대화는 표식 `data-page-maximize` + globals.css 한 곳, 숨길 요소에 표식을 직접(`data-maximize-hide`·`data-page-header-extra`) · **머리글 줄(제목·동작·KPI·버튼)은 안 숨긴다**(eyebrow·설명만) · 최대화↔원래대로 = 머리글 오른쪽 끝 같은 파란 버튼 하나(스켈레톤에도 · 픽셀 고정 — 머리글 화면의 본문 위 여백·스크롤바 거터를 건드리지 말 것) · 머리글 없는 화면은 본문 위 출구 줄 · eyebrow = 사이드바 그룹 자동)
- **모바일 상단 크롬 = 한 줄 + 칩 툴바는 `.toolbar-rail` 가로 레일** (⚠️ 좁은 화면 기본값, 2026-07-30 — 크롬 43%→14% 실측. 상단 바는 하나·본문 헤더는 `compact-chrome`으로 접힘·판정 조건은 use-is-desktop과 함께 고칠 것)
- **상세 화면 헤더의 동작 버튼은 여는 대상을 라벨에 적는다** (⚠️ 새 상세 화면 기본값, 2026-08-07 — 한 화면에 '수정'이 둘이면 눌러보기 전엔 모른다. 헤더=목적어 붙임(학생 수정·근무 설정·이력서 수정 — 목적어는 **실제로 여는 것**으로) / 섹션 제목 옆·표 행 안·모달=짧게. ⚠️ `title` 툴팁은 모바일에서 없는 것과 같다)
- **종이 서식 표는 좁은 화면에서 카드로 쌓는다 — `data-label` 규약** (⚠️ 문서형 표 기본값, 2026-08-04 — 5열 이력서가 375px에서 "박/소/선"으로 무너진 것. `@media screen`으로 인쇄 제외·유틸 덮으려 unlayered+`!important`·입력 16px는 iOS 자동확대 방지)
- 컬러 토큰 (`src/app/globals.css`)
- **라운드 = 역할별 캐논** (⚠️ 표면 2xl · 칩 full · 버튼/인풋 lg(공용 기본 승계) · 모달 xl · 스켈레톤=실표면 동일, 임의 px 금지, 2026-07-20)
- 타이포
- Atoms (`src/components/atoms/`)
- Botanical 아이콘 (22개)
- AppShell
- shadcn base-nova (Base UI) 유지 사항
- **본문 하단 여백 = 셸 `<main>`의 `pb-8 lg:pb-10`** (⚠️ 새 화면 기본값, 2026-09-03 — 끝까지 내려도 마지막 카드가 바닥에 안 붙게. 화면이 `h-full`·`overflow-hidden`으로 그 여백을 덮지 말 것 · 크롬리스 라우트(`(seat)`·`(kiosk)`·`(intake)`·`(print)`)는 직접 같은 값을 주고 `loading.tsx`도 같게 · 예외 둘 = 하단 고정 저장 바 [[#110]] · **창 베젤 0 마커 `.edge-to-edge`**(시간표, 2026-09-08 — 창에서만 좌우·아래 0 + 거터 해제, 페이지 루트와 `loading.tsx` 루트가 같은 className))
- 스크롤바 — 전역 하네스 (⚠️ 무조건 적용)
- **메모·사유 툴팁 = 카드(`data-tip` + 문서마다 한 장인 레이어)** (⚠️ 메모를 띄우는 모든 자리 기본값, 2026-09-15 — 같은 값에 `title` 병기 금지 · 카드를 이미 띄우는 줄엔 카드 줄을 더한다 · 잘린 같은 글자를 펼치는 `title`은 대상 아님)
- 드롭다운/셀렉트 규약 (⚠️ 새 드롭다운 기본값)
- 비밀번호 입력 규약 (⚠️ 마스킹 비밀번호 필드 기본값, 2026-06-30)
- 버튼 크기 — 헤더 액션은 공용 `<Button>` 기본 크기로 통일 (⚠️ 새 버튼 기본값, 2026-06-24)
- 저장 버튼 = 창 하단 고정 sticky 바 + 미저장 닫기 가드 (⚠️ 창 데이터입력 폼 기본값, 2026-07-03)
- 줄바꿈 / 워드브레이크 — 한글 어절 단위 (⚠️ 전역, 좁은 창에서 특히 중요)
- 학교·학년 표기 = `schoolGradeLabel` 압축 "경명여중1" — 공백 join 금지 (⚠️ 전역, 2026-07-08)
- 격자형 이름 칸의 글자는 칸 폭에 비례 = `@container` + `fluidNameFontSize`(clamp 하한~24px, 숫자는 name-fit.ts에만) — 하한에서도 넘칠 때만 말줄임(`fitSeatName().clipped`) (⚠️ 격자형 이름 칸 기본값, 2026-08-19 → 09-04 갱신: 사다리 고정 px는 넓은 창에서 안 커진다)
- 드래그-팬 (잡고 끌기) — 넘치는 영역의 기본 인터랙션 (⚠️ 새 화면 기본값 · 🔴 **끌어 옮기는 화면에서는 끈다**(`pan={false}`, 원장 2026-09-09 *"학생 드래그 이동 때문에 드래그로 스크롤 이동하는건 시간표에서 제외시켜야겠어"*) — 시간표 기본뷰·강사뷰·통합뷰 배치 편집이 그렇다. dnd-kit 손잡이를 피해 가는 `skip()`만으로는 부족하다: 빈 곳을 스쳐 잡거나 5px 문턱 전에 손잡이를 벗어나면 팬이 포인터를 캡처해 드래그가 죽는다([[#97]] 계열). 드래그가 없는 넓은 표(교실 뷰)는 켠 채로 둘 것)
- **드래그 중 '여기엔 못 놓는다' = 붉은 빗금 `[data-drag-blocked]`** (⚠️ 시간표 드래그 기본값, 원장 2026-09-09 *"영어를 듣는 학생이면 영어 스케줄 때문에 이동이 불가능한 곳은 [빗금] 이런느낌으로 차단시켜"* → *"반 드래그도 마찬가지. 이동 불가능한 곳은 사전 차단."*) — 2026-09-04의 *"갈 수 있는 칸만 칠한다"*를 뒤집은 것이다. 그림은 `globals.css` 한 곳이고 격자 칸(반 드래그)과 반 카드(학생 드래그)가 같은 표식을 쓴다. 🔴 배경이 아니라 **덮개(`::after`)** — 반 카드는 자식이 제 배경을 칠해서 컨테이너 배경엔 안 보인다. ⚠️ `pointer-events:none` 필수(덮개가 포인터를 먹으면 드롭 판정이 죽는다). 🔴 화면 표식과 드롭 거절은 **같은 맵·같은 문구**를 쓰고, 판정 재료를 못 받으면 **아무것도 안 막는다**(fail-open — 표식은 도움이지 게이트가 아니다))
- 플로팅 창 기본 크기 — 넓은 메뉴는 크게 연다
- ~~다열 보드 = 큰창 그리드 / 작은창 탭~~ → **🔴 폐기(2026-09-03): 탭 접힘 금지 — 열을 유지하고 창 최소 크기로 막는다**
- 영역 구분 — 이질적 다(多)섹션은 헤더 달린 카드로 또렷이 나눈다 (⚠️ 상세/집계 뷰 기본값, 2026-06-24)
- **나란한 카드는 속살까지 줄맞춤 = `grid-rows-subgrid`** (⚠️ 카드 격자 기본값, 2026-08-04 — 높이(h-full)만 맞추면 안쪽 구획이 어긋난다. 행 간격은 `gap-y` 말고 **전용 트랙**으로)
- **고정 폭 표 칸의 가로 나열은 `flex-wrap`** (⚠️ `table-fixed` 열 기본값, 2026-08-04 — 넘친 컨트롤이 옆 칸 배경에 **덮여** "라벨이 가려진" 것처럼 보인다. 같이 다닐 것은 묶어서 접고, 좁은 input의 긴 placeholder는 title로)
- **데이터 표 = 열 제목과 값은 같은 축 + 열 구분선은 `--line-faint`** (⚠️ 표 기본값, 2026-08-05 → 정렬 2026-09-18 원장 *"다른 표도 이상한거 있음 전부 맞춰줘"* — 짧은 값 가운데 · 긴 글(점·표식이 붙는 값 포함) 왼쪽 · 금액 오른쪽, **제목도 같은 쪽**. **이미 맞는 표는 그대로**(*"잘 정렬된것까지 이상하게 할 필요는 없음"*) — 고칠지는 스크린샷으로. 맨 `<th>`는 브라우저가 저절로 가운데라 명시할 것. 세로선은 행 높이만큼 길어 가로선과 같은 농도면 훨씬 세게 읽힌다 → 한 단계 옅게. 셀 상수마다 말고 **표 한 곳**에서 `[&_tr>*:not(:first-child)]:border-l`, 너비와 **색을 같이**)
- 반응형 창 폭 — 넓은창 공간활용 + 좁은창 접힘 (⚠️ 새 페이지 기본값, 2026-06-19)
- 생성 폼은 우측 패널이 아니라 창으로 — autoClose 창 (⚠️ "새 X" 진입점 기본값, 2026-06-19)
- 동시편집 "수정중" 실시간 표시 — cross-user presence (⚠️ 편집 표면 기본, 2026-07-01)
- 강사 접근 조임 — 강제 URL = roleHome 폴백 (2026-07-01, `84199c4`)
- 로컬 초안 자동저장 — 길게 입력하는 폼은 입력 중 유실 방지 (⚠️ 긴 폼 기본값, 2026-06-30)
- 인쇄(Print) — 인쇄 버튼이 있는 모든 곳은 플로팅 창 + A4 (⚠️ 새 인쇄 표면 기본값, 2026-06-24)
- 목록 페이지네이션 표준 — 큰 목록은 전부 이 패턴으로 통일 (⚠️ 새 목록 기본값)
