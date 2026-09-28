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
- **규칙**: 차트=리프를 **`next/dynamic(() => import("./X-impl"), { ssr:false, loading: 스켈레톤 })` 래퍼 + `*-impl.tsx` 분리**(차트가 보일 때만 로드, 소비처 import 불변). 무거운 처리(엑셀 빌드 등)는 서버 액션/라우트에서 `await import()`. **새 차트는 처음부터 이 패턴**(레퍼런스: enrollment/dashboard `*-impl` 6곳).

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
직접 `getAnthropic`/`getUpstage`를 부르지 말 것 — provider 라우팅·파싱·폴백이 한 곳에 모여 있다.

- **⚠️ 사실 원칙은 모든 AI 호출에 예외 없이 붙는다 (원장 지시 2026-07-23, 불변)**: *"'팩트' '환각금지'
  '사실만 작성' '창작 금지' '추측 금지'도 항상 거쳐야 해."* → [`FACT_GUARD`](src/lib/ai/fact-guard.ts)가
  `generateJSON()` 안에서 **모든 프롬프트 앞에 자동 부착**(멱등). generateJSON을 안 거치는 자체 루프를
  새로 만들면 시스템 프롬프트에 같은 상수를 직접 이을 것 — 유일한 실례였던 대화형 비서(`runAssistantLoop`)가
  2026-09-03 제거돼 **지금 자체 루프는 0개**다(전 AI 호출이 `generateJSON()` 단일 진입점).
  🔴 **호출부 프롬프트 본문에만 적지 말 것** — 본문은 원장이 화면에서 편집 가능(`ai_prompt_overrides`)이라
  편집 한 번에 가드가 사라진다. 지울 수 없는 자리(코드)에 둬야 "항상"이 성립한다. 문구 완화·삭제 금지
  (Vitest가 5개 원칙 단어를 잠근다). 항목별 세부 규칙은 호출부가 계속 담당 — 여기는 최소 공통 바닥.

- **외부 AI 전송 금지 필드(불변, 2026-07-16 명문화)**: 주민번호·계좌/카드번호·급여(`users.hourly_rate/monthly_base`·`payroll_records`)·
  이력서 `academy_documents.form_data`(restricted)·환불요청서 계좌 — **어떤 AI 프롬프트에도 넣지 않는다**(전송 전례 0,
  restricted RLS+재인증으로 잠근 대상). 학생 이름·학교·상담 내용 수준은 기존 관행상 전송 허용선.
  - **승인된 예외(원장 2026-08-03)**: **직원 계약서 스캔 PDF의 Claude 비전 전사(OCR)** — 종이 계약서 자동 인식을 위해
    스캔 이미지 전송을 원장이 명시 승인(질문·답변 로그 있음). 단 ① 전송은 전사 1회뿐, ② 이후 추출 프롬프트에 싣는
    텍스트는 [`maskResidentRegNo`](src/features/staff/contract-extract.ts)로 **주민번호 뒤 7자리 항상 마스킹**(글자 PDF
    경로 포함), ③ `generateJSON({ document })`는 Anthropic 한정(폴백 없음 — 다른 provider로 첨부가 새는 것 방지).
    다른 스캔/이미지 전송을 새로 열 땐 이 예외를 근거로 확장하지 말고 다시 물을 것.
- **usage 계측(0113a `ai_usage_logs`) + 지점 라이선스**: 모든 AI 호출부는 `generateJSON({ …, meta: { feature: "<호출부 식별자>", tenantId } })`를
  넘긴다 — 🔴 **`tenantId`는 필수**(2026-09-25, 타입 + 런타임 거절). 지점을 모르면 라이선스(ai_analysis)를 판정할 수 없어 꺼진 지점에서도
  AI가 새므로, 비어 있으면 `generateJSON`이 호출 전에 거절한다([`decisions/tenant.md`](docs/decisions/tenant.md) 지점 기능 라이선스). 사용량 기록 자체는 best-effort.

provider/모델 레지스트리는 `src/lib/ai/models.ts`의 `AI_MODELS`(티어×provider) + `resolveModel()`:

| Tier | Upstage (폴백) | Anthropic | DeepSeek | 용도 |
|---|---|---|---|---|
| `fast` | `solar-pro3` | **`claude-haiku-4-5`** | `deepseek-v4-flash` | **학부모 멘트 전용**(유일한 소비처 = `classnote_ment`). 🔴 deepseek 폴백은 **v4-flash**(원장 2026-08-28 *"haiku -> 폴백 deepseek v4 flash"*) — v4-pro를 걸었더니 자동작성 한 번에 **86초**(추론 6,505토큰)라 폴백이 또 다른 장애가 됐다. flash는 7.3초. **되돌리지 말 것**(같은 날 *"flash 말고 v4 pro"*를 실측 보고 뒤집은 것). |
| `balanced` | `solar-pro3` | `claude-sonnet-5` | **`deepseek-v4-pro`** | 경량 호출 기본값 + **전사 분석 3종 기본**(아래). |
| `reasoning` | — (없음) | `claude-opus-4-7` | — | **금지** (명시 요청 시만). reasoning은 Anthropic 고정. |

- **폴백 사다리 = anthropic → deepseek → upstage(Solar)** ([`FALLBACK_LADDER`](src/lib/ai/models.ts), 원장 2026-08-28). 한 provider가 **인증·한도·잔액 소진**으로 막히면 다음으로 넘어간다 — 🔴 **크레딧 소진은 400이라 예전엔 사다리를 안 탔다**([[#118]]: 2026-08-27 멘트 AI가 이틀간 전건 실패). Solar가 맨 뒤인 건 품질 A/B 탈락이라 마지막 보루이기 때문. ⚠️ 새 provider 오류 모양(402·`insufficient_quota` 등)을 만나면 `isCreditExhaustedError`에 추가할 것.
- **전역 기본 provider = Anthropic Claude Sonnet 5** (`AI_PROVIDER=anthropic`, 2026-07-13~) — 품질 A/B에서 Solar가
  상담 분석의 warnings를 통째로 놓치고 잡담(주식 등)을 섞어 전환. ⚠️ **코드 기본값(env 미설정)은 여전히 `upstage`(Solar)** —
  Vercel env가 안 걸리면 프로덕션이 Solar로 동작하니 확인. 롤백 = `AI_PROVIDER=upstage` 또는 호출부 `provider:"upstage"`.
- **전사 분석 3종(회의록·등록상담·재원생 상담) = DeepSeek v4-pro** (2026-07-16, `AI_PROVIDER`과 무관하게 코드에서 우선) —
  실측 A/B(injaewon 실전사 5건): v4-pro가 warnings를 5/5 Sonnet급으로 생성(255·316·243·219·97자), 비용은 압도적으로 저렴.
  경량 v4-flash·레거시 chat·Solar는 warnings를 2~3/5 "확인된 위험 신호 없음"으로 붕괴(Solar 탈락과 동일 실패)라 v4-pro 채택.
  ⚠️ 트레이드오프: v4-pro는 추론형이라 Sonnet보다 ~1.2배 느림(백그라운드 분석이라 감수). **Vercel에 `DEEPSEEK_API_KEY` 설정 필요** —
  없으면 anthropic/upstage로 **무중단 폴백**(키 추가 전까지 프로덕션은 Sonnet 유지, 롤백=키 제거). 라우팅은 호출부 `provider:"deepseek"`
  ([analyzeMeeting](src/features/meetings/server/ai.ts)·[runConsultationAnalysis](src/features/enrollment/server/consultation-analysis.ts)·
  [analyzeStudentConsultation](src/features/consultations/server/ai.ts) 기본값 + 웹훅 인라인). form-extract·멘트(Haiku)·care는 불변.

### 녹음·회의 처리 (Solar 후보정 하네스 · 재처리 2종 · 회의 화자) → [`docs/decisions/ai-recording.md`](docs/decisions/ai-recording.md)
- 폼 자동입력 = `buildFormPatch` 후보정 하네스(grounding·echo·잡음 가드) — 새 "AI 추출→폼/DB 자동기입"도 이 가드를 통과한 값만.
- 회의 재처리 = 기둥 A '분석 다시 생성'(텍스트) / 기둥 B '전사부터 다시'(오디오, Supabase 서명 — Firebase 의존 0). 화자 = `ai_speaker_roles`(표시) + `speaker_staff`(직원 연결).
- Upstage = OpenAI 호환(JSON mode, 프롬프트에 "JSON" 필수) · 키 없으면 다른 provider로 무중단 폴백.

### 키 분리 = 기능별 8그룹 (원장 2026-09-15 *"기능별로 키를 발급받아서 사용량 체크를 하려고"*)
**env 이름 = `<회사>_API_KEY_<그룹>`**(회사 = `ANTHROPIC`·`DEEPSEEK`·`UPSTAGE`). 그룹은 호출부 식별자(`meta.feature`)에서
[`FEATURE_KEY_GROUP`](src/lib/ai/models.ts)이 도출한다 — 🔴 **새 AI 호출부를 만들면 그 표에 한 줄**을 더할 것(가드
[`key-groups.test.ts`](src/lib/ai/key-groups.test.ts)가 빠진 것·죽은 것을 잡는다).

| 그룹 | 호출부(meta.feature) | 지금 1순위 |
|---|---|---|
| `MENT` | classnote_ment · english_ment · ment_prompt_preview · ment_style_profile | Claude(Haiku·Sonnet) |
| `MEETING` | meeting_analysis | DeepSeek |
| `ENROLLMENT` | enrollment_analysis · enrollment_form_extract · enrollment_prep_brief | DeepSeek(분석·브리프) · Claude(폼) |
| `CONSULTATIONS` | consultation_analysis · student_care | DeepSeek(분석) · Claude(케어) |
| `BRIEFING` | daily_briefing | Claude |
| `ATTENDANCE` | attendance_recap · parent_attendance_intent | DeepSeek |
| `NOTICE` | notice_translate | DeepSeek |
| `STAFF` | staff_contract_pdf · staff_contract_pdf_ocr | Claude(OCR은 **Claude 전용**) |

- **키 고르는 순서 = 그룹 키 → 옛 버킷 키(`_CONSULTATIONS`) → 기본 키**(`resolveKeyEnv`). 그룹 키가 아직 없어도
  기본 키로 돌아 **멈추는 기능이 없다**(키를 하나씩 넣는 동안의 안전장치).
- 🔴🔴 **기본 키 셋(`ANTHROPIC_API_KEY`·`DEEPSEEK_API_KEY`·`UPSTAGE_API_KEY`)은 절대 지우지 말 것** — 그룹 키를
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
- 기타 심층 문서 → `docs/` (audit-log · ijw-feature-port · makeedu-reverse-sync · payment-collection-plan · perf-open-window-backlog 등)

> ⚠️ 새 기능·배선을 완성하면 그 요약을 `docs/changelog.md`에 한 줄 추가(진행 상황 로그). 새 함정을 만나면 `docs/gotchas.md`에 항목 추가 + 아래 인덱스에 트리거 한 줄. 새 UI 규칙은 `docs/design-conventions.md` + 디자인 인덱스.

## ✅ 이미 내린 결정 — 다시 제안·질문하지 말 것 (Decision Log)

이미 확정된 결정이다. **재제안·재질문 금지.** 바꿔야 할 새 근거가 생기면 "이건 이미 X로 정해졌는데, 이런 이유로 재검토할까요?"라고 **명시적으로** 물어라(조용히 뒤집지 말 것).

> 🔴 **아래는 제목만 있는 인덱스다. 그 영역을 만지기 전에 해당 `docs/decisions/*.md`를 반드시 Read** — 🔴 금지 조항·단일 소스 파일·실측 근거는 전부 그 파일에 있다. **새 결정은 해당 파일에 추가하고 여기엔 제목 한 줄만** 더한다(본문을 여기 쓰지 말 것 — CLAUDE.md가 비대해져 매 세션 토큰을 먹는다). `@docs/...` import로 바꾸지 말 것.

### 멀티테넌트·지점·브랜드·제품 이름 → [`docs/decisions/tenant.md`](docs/decisions/tenant.md)
- 지점 기능 라이선스 = 슈퍼관리자 카드가 실제로 막는다 · 행이 없으면 허용 · 켜진 지점(침산)은 그대로
- 슬랙 알림 = 지점 스위치(기본 꺼짐) · 원장이 봇 토큰 등록(원장만·가린 값) · `notifyUsers` 경유 알림 중 고른 종류를 1:1·채널로 · 응답 뒤 발송 · 잔디는 웹훅뿐이라 기각
- 연결 앱(오늘의 수학) = 지점 스위치(기본 꺼짐) · 왼쪽 '연결 앱'의 보통 링크(새 탭) · 명단·진도 API도 같은 스위치 · 영어 선생님(담당 과목이 영어뿐)에겐 안 보인다 · 자동 로그인 = eywa 사용자 id(`sub`)로 처음 한 번 비밀번호 연결(이메일은 신원 아님)
- 이용 분석(슈퍼관리자만 봄·지점 비공개) = 활동 시간 기본 · 화면 시간 대조 · 권한(강사는 과목별)·지점 묶음만 · 사람별 표 없음 · 슈퍼관리자 계정은 안 셈 · 새 셸 첫 칸 라우트·새 크롬 층은 계측 배선도 함께
- 제품 이름 = aywa · 도메인 `www.aywa.co.kr` · 저장 키·외부 연동 이름은 eywa 그대로
- 멀티테넌트 = 하나의 Supabase DB(공유 DB + `tenant_id` + RLS) 유지 · 테넌트마다 프로젝트를 두지 않는다
- 멀티테넌트 URL = 지점을 URL에 넣지 않는다(C안) · 로그인 전 화면은 "회사 브랜드" 하나 · 지점을 알아야 하는 로그인 전 화면(자리 PIN)은 화면에서 지점을 고른다
- AI·워커도 지점(테넌트) 단위로 가른다 — 큐를 집는 쪽이 제 지점 것만 집는다
- 새 지점 = 일반판(방향 B) · 침산은 손대지 않는다 — 판정은 설정 행 하나
- 테넌트 `injaewon` = 프로덕션 실데이터

### 성적관리 → [`docs/decisions/grades.md`](docs/decisions/grades.md)
- 성적관리 = 시험을 등록하지 않는다 · `년도 · 학기 · 과목 · 반 · 시험` 격자 하나
- 성적관리(`exams`) = 강사는 담임·부담임 반만, 부원장·관리자는 모든 반

### 출석부·보강·출결 귀속·자리 → [`docs/decisions/attendance.md`](docs/decisions/attendance.md)
- 보강 예약 = 별도 표(0264a), 출결 행이 아니다 · 교시는 학원설정 교시표에서만 · 이행은 보강일 출결 저장이 자동으로
- 월별 출석부(관리자) 상단 = 툴바 한 줄 + 표 위 한 줄 · 실급여는 토글 · 실급여는 청구액을 넘지 않는다 · 제목행 가운데
- 월별 출석부 강사 보기 = 그 강사가 수업하는 날·교시만 · 빗금 없음
- 메모·사유 툴팁은 카드다 · 시간표 보강 박스는 병합을 쪼개지 않는다 · 빗금 칸은 "누가 찍었나"를 말한다
- 강사 보기 저장은 자리(JJ·랩실) 기록을 건드리지 않는다 · 운영실 '결석학생'은 어제 기준
- 수학 출석 시수 = 그날 수업 길이로 자동 · 새 칸에만 · 숫자를 친 건 그대로
- 자리(랩실) 드래그 = 다른 시간으로만 · 그 반·그 학생의 다른 수업 시각은 막되 끄는 동안 보인다
- 자리(랩실·JJ실) 출석부의 결석 사유 = 마우스 오버로만, 공개 PIN엔 안 내려보낸다
- 보강은 "보강을 받는 반·날짜" 축에서만 추가한다 — 자리(LAB실·JJ실) 출석부는 출결 전용
- 출결의 강사 귀속 축 = [`teacher-axis.ts`](src/features/attendance/teacher-axis.ts) 단일 소스
- 강사 보기에서 친 그날 합계는 그 강사 교시에만 나눈다 — 몫 판정은 서버가 화면과 같은 함수로
- 출석부 메뉴 기본 착지 = 월별 출석부
- 기간 단위 = 세션(`operating_periods`) 단일 소스, 미정의는 달력월 폴백

### 시간표(드래그·가져오기·예약·담임·배치 이력) → [`docs/decisions/timetable.md`](docs/decisions/timetable.md)
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
- 수업 회차는 한 칸씩 미루거나 당긴다 — 원래 월간계획은 고정, **일정(가져올 차수)만** 밀린다(2026-09-28)
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
- 슈퍼관리자 화면 = 앱과 같은 디자인 체계 · 폰은 상단 한 줄 바 · 영역 가드
- 왼쪽 색 띠 금지 — 카드·타일·알림에 굵은 왼쪽 띠를 두르지 않는다
- 대규모 디자인 수정 v5 = "가장 작은 창에서 글자를 최대로" — 가독성 > 레이아웃·여백·장식
- 글자색은 한 값 `#121212`(rgb 18,18,18) · 컨트롤 세로 채움 70% · 탭 아이콘은 이미지 생성물
- 탭 스티커의 범위 = 탭·내부 탭 + '표시 자리'(빅 스탯 지표 칩)
- 기간 네비는 `‹ 2026년 8월 ›` 한 덩어리 — [`PeriodNav`](src/components/period-nav.tsx) 단일 소스
- 툴바는 부품으로 쓴다 — 상수만 두면 새 탭이 모르고 제 클래스를 적는다
- 화면 상단 규약 3종(앱 전역, 원장 2026-09-01)
- 라이트 전용(Daylight)
- 앱 디자인 = "Injaewon Editorial" + 팔레트 v3 네이비 (2026-07-19 원장 확정).
- 팔레트 v4 "White Contrast" + 의미색 캐논 (원장 2026-08-18).
- 이름 앞 아바타/이니셜 배지 = 금지 (영구).

### 운영실(대시보드) → [`docs/decisions/dashboard.md`](docs/decisions/dashboard.md)
- 운영실 카드 표시 규칙 9종
- 운영실 일정 카드의 학생 이름·콜&상담 링크 = 저장 없이 갱신마다 판정 · 모호하면 안 붙인다
- 운영실에서 '대화형 비서'·'실시간 운영'·'빠른 작업'을 걷어냈다 · '학원 펄스' → '학원생 증감'
- 운영실 상단 KPI = 8칸(재원생·퇴원생·신규문의·금일입테·
- "N건 있다"는 신호와 그 일을 하는 화면은 같은 게이트를 지난다
- 운영실에 '지출 결재 대기'는 없다
- '살펴볼 학생'은 사전 통보로 전부 설명되는 결석을 배제한다
- 운영실 '미작성 보고서'는 aywa에 보고서를 쓰는 과목만 센다 — 영어 제외
- 운영실 = "학원 매니저 팀" (2026-07-16 원장 방향)

### 원생·콜&상담·신규생·학교 표기 → [`docs/decisions/students.md`](docs/decisions/students.md)
- 재원생 = '실시간' — 아직 시작 안 한 수강만 가진 학생은 안 센다 · 오늘 출결 카드는 '한 수업 = 한 블록' · 휴원도 과목을 고른다
- 신규생 관리 탭 = 신입 등록 후 90일 체크리스트 · 기준일이 둘이다
- 신규생 체크 ↔ 원생상담 = 반자동(상담 등록 화면에서 사람이 확정) · AI 판정 없음 · 손 체크가 이긴다
- 메뉴에서 '학생'은 '원생'이라 부른다
- 메뉴 '등록상담'은 '콜&상담'이라 부른다
- 강사(teacher) = 학생 기록 열람 전용
- 학교 표기는 저장 시 강제 통일 — `~초등학교`→`~초`, `일중`→`대구일중`
- 등록상담 목록뷰(`?view=table`) = 칸반 카드의 내용을 옛 콜앤상담 시트 *모양*으로
- 등록상담 칸반 = 4칸
- 수강료 계산기 = 신입생 상담 견적 도구
- QR 등록상담 자동연결 = `student_id` 연결만, `outcome` 강제 안 함

### 원스크린·수업보고서·ClassNote·AI·알림 → [`docs/decisions/reports-ai.md`](docs/decisions/reports-ai.md)
- 강사별 멘트 말투 프로파일 = 0214a 코퍼스를 주 1회 접어 자동작성에 붙인다 · 표본은 직접 작성 + 자동작성 후 수정
- 영어 수업보고서 = 원스크린 영어 행 '템플릿 모드' · 인재원 학습 데이터 = pull API
- 발송 기한(오늘 포함 7일)이 지난 보고서도 원장이 지정한 건은 보낸다
- ClassNote 테스트 학생 '학원이'는 aywa에서 아무에게도 배정하지 않는다 — 배정은 ClassNote 쪽에서 전 강사에게
- AI provider 전역 기본 = Anthropic Claude Sonnet 5
- 전사 분석 3종(회의록·등록상담·재원생 상담) = DeepSeek v4-pro
- 음성 전사 엔진 = AssemblyAI `universal-2` 유지
- 수업보고서 테스트 표기 = "N문제 중 M개 맞음" 하나뿐
- 오늘 과제의 쪽수는 강제가 아니라 후보정
- 분석 화면에 AI 모델 라벨 노출
- 알림 경로는 둘이고 서로 다른 물건이다 (2026-08-07, 0188a).

### 수납·회차·정산·급여 → [`docs/decisions/billing.md`](docs/decisions/billing.md)
- 🏁 D:\attendance "쏙쏙 이전" 이식 = 완결 (2026-07-17, main a9f5dab).
- 강사 정산 단가 = 회차 확정 단가 우선(수학 반) → 없으면 수강 티어
- 회차 확정 줄 = 월별 출석부 줄(그 달 학생×반 한 벌) · 회차 행이 없는 줄은 저장하는 순간에만 만든다
- 회차 확정 금액 이월(0278a) = 보내는 달 한 곳에 저장 · 실납은 `netAllocatedAmount` 한 벌
- 수납 자유 배분(0279a) = 관리자 이상 · 합계 ≤ 수업 청구액 · 항목별 배분이 기본
- ⚠️ 돈 산식 변경 = 골든마스터 통과 필수 (2026-07-17, attendance R2·R6 이식).
- 급여명세서 열람 = 하드 픽스 명단 + super_admin

### 직원·권한·전자결재·연차 → [`docs/decisions/staff.md`](docs/decisions/staff.md)
- 직원 편집 창구는 셋이고 내용이 안 겹친다 — 겹치는 칸은 이력서가 단일 소스
- super_admin은 새로 만드는 어떤 제한 명단·게이트도 자동 통과한다
- 전자결재 = 양식 중립 문서 껍데기 + 양식별 상세, 결재선은 순차
- 연차 조정 = 법정 부여 위에 얹는 행 · 자리는 직원관리 · 권한은 명단 3인
- 연차 부여 = 입사일에서 계산, 저장하지 않는다
- 커스텀 권한그룹(makeedu식 면/탭 전면 매트릭스) = 비채택.
- 직원관리(/staff) 접근 = 원장(master) + 개인 예외 체제
- 과목 내부 키(`subjects[].key`) = 자동 확정·불변
- master 시스템역할 표시 라벨 = "원장"

### 셸·창·강사뷰·로그인 세션 → [`docs/decisions/shell.md`](docs/decisions/shell.md)
- 창 모드(플로팅 창) = 지점별 켜고 끄기 · 슈퍼관리자 학원 상세 · 기본 켜짐 · 창을 여는 판정은 `useWindowMode()`
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
- 셔틀의 다음 축은 '실시간·관제·위치'다 — 법정 기록도 학부모 표면도 아니다
- 셔틀 탭 = aywa DB 단일 진실 · 정류장 마스터 + 시즌 축
- Excel/스프레드시트 = 내보내기·가져오기만.
- 미디어 저장 = Supabase Storage 단일 경로
- makeedu 동기화 = 집 신뢰 IP 로컬 실행

## 🗣️ 사용자 작업 선호 — 반복 교정 금지 (항상 적용)

사용자가 이미 준 피드백이다. **같은 교정을 두 번 하게 만들지 말 것.**

- **main = 프로덕션 · 작업 격리 정책 (2026-07-15 원장 지시로 갱신 — 07-14 "main 직접"을 뒤집음):** **항상 격리 git 워크트리(origin/main 기반)에서 작업 → 검증 → 적대적 리뷰 → main에 병합/푸시.** ⚠️ **공유 작업트리(D:\eywa_refactoring)에 미커밋 편집을 두지 말 것** — 여러 세션·하네스(epitaxy 자동 stash)·codex 에이전트가 동시에 브랜치를 계속 전환/reset해서, 미커밋 편집이 auto-stash로 쓸려가거나 유실된다(2026-07-15 한 세션에서 2~3회 실측: billing 다계좌·시간표 hover 편집이 브랜치 전환에 사라짐). 격리 워크트리는 별도 디렉터리라 이 churn에 영향 없음.
  - **표준 절차:** `git fetch origin` → `git worktree add <리포 밖 scratch경로> -b fix/<name> origin/main`(중첩 worktree=eslint OOM 회피) → 편집 → 검증(node_modules **정션** 연결 후 typecheck(내 파일 에러만; 마케팅 `_img/*.webp`는 미추적 노이즈)·lint·가능하면 실행) → **적대적 리뷰**(결함 있으면 수리·재검증·재리뷰 · 마지막 커밋·푸시 전 필수, 2026-08-18) → 정션은 `cmd //c rmdir`(링크만)로 뗌([[#66]]류 rm -rf 정션 함정 금지) → **내 파일 경로만** 커밋(`git add -A`/`-a` 절대 금지, [[#62]]) → **⚠️ push 직전 최신 통합(원장 지시 2026-07-16): `git fetch origin` → origin/main이 진행했으면 `git merge origin/main`(병렬 작업 보존 위해 merge 우선 — 충돌은 내 파일만 해결, 남의 hunk 보존)** → (병합에서 손본 hunk가 있으면 그 부분 재리뷰) → `git push origin HEAD:main`(훅 우회 `# ALLOW_DANGER`는 **사용자 승인 시만**) → `git worktree remove --force` + 브랜치 삭제.
  - **⚠️ 커밋·푸시 전 항상 최신 git 확인 (원장 지시 2026-07-16):** 다른 사람/세션이 동시에 작업 중일 수 있으니 **반드시 `git fetch` 후 최신 origin/main을 pull/merge로 통합**한 뒤 반영한다. **병렬 작업을 절대 덮어쓰지(clobber) 말 것** — 진행했으면 merge(병렬 커밋 보존)로 통합, 충돌 시 내 파일만 해결하고 남의 변경은 그대로 둔다. force-push·非-FF clobber 금지.
  - **⚠️ 커밋 전 항상 적대적 리뷰 (원장 지시 2026-08-18 → 2026-08-31 강화: *"커밋 전에 항상 구현건에 대해 적대적 리뷰하고 버그 수정"*):** **모든 커밋** 전에 이번 구현을 공격하는 관점으로 반증하고, 나온 결함은 **그 자리에서 고친 뒤** 커밋한다(중간 WIP 커밋도 예외가 아니다 — 옛 규칙은 '마지막 커밋'만 걸었는데 그러면 결함이 여러 커밋을 지나 살아남는다). 순서 = 적대적 리뷰 → (결함 수리 + 재검증 + 재리뷰) → 커밋 → fetch/merge(바로 위 불릿) → (손본 hunk 재리뷰) → 푸시. 이 규칙은 fetch/merge·격리 절차를 대체하지 않는다. "일단 커밋하고 리뷰" 금지. 적대적 리뷰 = 문서·설정 포함 **이번 변경**을 공격하는 관점(회귀·권한·상태 레이스·집계 축 불일치·다른 표면과의 숫자 차이)으로 반증하고, 통과한 것만 반영한다. 자기 작업을 정당화하는 혼잣말은 리뷰가 아니다.
  - **⚠️ 적대적 검증은 지침이 명시한 지점에서만 (원장 지시 2026-08-19):** 위 규칙이 요구하는 검증(푸시 전 리뷰 · 수리 후 재리뷰 · 병합에서 손본 hunk 재리뷰)은 반드시 실시하되, **그 외 지점에서 적대적 검증을 임의로 추가하지 말 것**(원장: *"지침으로 적대적 검증하라고 하면 검증 실시할 것, 이외에 적대적 검증 금지"*). 리뷰 라운드를 늘리는 것은 시간·토큰 비용이다 — 필수 지점만 정확히.
  - 이미 공유 트리에 두었다가 stash로 쓸려간 작업은 `git checkout 'stash@{0}' -- <내 파일>`로 워크트리에 추출(다른 세션 WIP 섞인 stash는 **드롭 금지**, 내 파일만). 공유 트리에 남은 내 **고아 부분편집**은 diff로 순수 내 것 확인 후 `git checkout -- <내 파일>`로 정리.
  - **남의 워크트리/브랜치/stash는 건드리지 말 것.** 검증은 항상 유지, **대형·비가역·외부발신은 여전히 사용자 승인 후 반영.**
- **모든 뷰 세팅은 계정 귀속 (원장 2026-08-04 "당연하지만 항상")**: 정렬·필터·글씨 크기·표시 토글 등 화면 보기 상태는 localStorage가 아니라 **`users.ui_prefs.<화면>` DB**에 저장한다(다른 PC에서도 같은 상태로 열린다). localStorage는 **포트 포함 origin 단위**라 "로그인은 그대로인데 설정만 리셋"으로 위장한다([[#90]]). 서버가 목록을 좁혀 내려주는 필터는 저장 후 `router.refresh()`.
- **"제목/이름 변경" 요청 = 라벨 문자열만** 바꾼다. 데이터 바인딩·소스를 임의로 갈아끼우지 말 것(기존 행이 "—"로 증발함). 바꾸는 게 낫다 싶으면 **제안만**. 리네임 후 기존 행이 동일 렌더되는지 확인이 완료 조건.
- **병렬 세션 주의(#62)**: 공유 작업트리를 여러 세션이 동시 사용한다. 통째 `git add` 금지 → **내 파일 명시 경로만** 커밋. 큰 변경 후 `git fetch` + `HEAD..origin/main`으로 내 WIP가 물렸는지, 의존하는 신규 파일 누락은 없는지 점검.
- **운영 enum 하드코딩 금지**: 과목/학년/직급/교시 = 학원설정 단일 소스. 서버 `buildSubjectMaps(getTenantSettings)`, 클라 `useSubjectMaps()`/`useGradeLevels()`. `SUBJECT_META`/`LABEL`/`COLOR` 등 코드 상수 신설 금지.
- **UI에 raw 코드·기술 원문 노출 금지 (반복 지적, 2026-07-10 재발)**: 화면에 `withdrawn`·`math`·`page.goto: net::ERR…` 같은
  영문 enum/키/에러 원문을 그대로 내보내지 말 것. 상태=`studentStatusLabel`([status-labels.ts](src/features/students/status-labels.ts)),
  과목=`labelOf`, 에러=한글 요약+원문은 `title` 툴팁([classnote-error.ts](src/features/report-admin/classnote-error.ts) 선례).
  **새 표시 문자열이 DB 값·에러 객체에서 오면 한글 매핑을 거쳤는지 확인이 완료 조건.**
- **성능/병목 = 기능 버그 동급**: 새 쿼리·라우트·차트는 위 "성능/병목 절대 규칙(B1~B7)" 체크리스트 통과가 "완료" 조건.
- **중요 배선은 문서화**: 권한/설정 등 배선을 구현할 때마다 소비처·갭을 `docs/changelog.md`(또는 여기)에 기록.
- **2열 카드 높이 균형**: 한쪽이 짧아 빈 여백이 드러나면 `lg:items-stretch` + 짧은 카드 `flex flex-col` + 마지막 요소 `mt-auto`.
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
- **#81** node_modules 정션은 Turbopack dev에서 panic — 워크트리 dev 서버는 실제 `pnpm install`(정션은 typecheck/lint까지만)
- **#81** `"use client"` 모듈의 문자열 상수를 서버가 import = 런타임 undefined — 공유 상수는 일반 모듈로 (⚠️ 타입체크 통과하는 침묵 버그)
- **#83** React 19는 `<form action={서버액션}>`을 제출할 때마다 **자동 리셋** — 컨트롤드 입력이 "저장했는데 옛 값"으로 굳고, 재저장 시 직전 저장이 되돌아감 (⚠️ 제출 후에도 남는 폼은 `onSubmit`+직접 디스패치)

- **#84** "정렬 편향 × 상위 N 자르기" = 카테고리 통째 실종 — 상위 N 미리보기는 **카테고리별로** 자를 것(⚠️ Postgres 정렬은 로마자→한글, `localeCompare("ko")`는 정반대)
- **#85** 배포가 "초록색 success"인데 실제로는 안 나감 — `ignoreCommand`는 **tip 커밋 1개만** 본다. **머지하고 push하면 항상 skip**이었다(워크트리 정책과 충돌). ⚠️ 뭉쳐 push할 땐 docs 커밋을 tip에 두지 말 것 · 확인은 초록색이 아니라 `gh api …/status --jq '.statuses[].description'`
- **#86** 창 시스템 앱에서 `router.push`는 눈에 안 보인다 — 배경이 창에 덮여 있다 (⚠️ 알림/팰릿 등 최상위 프레임 이동은 WindowLink와 같은 경로로) + 본문이 N명인데 link가 1개면 그 link는 거짓말
- **#87** `overflow-x: scroll`은 넘치지 않아도 트랙을 예약 → **꽉 찬 thumb의 가짜 스크롤바**("스크롤이 없는데도 스크롤이 있네"). 넘침 판정은 브라우저에 맡기고(`auto`) 굵기·색만 손댈 것 (⚠️ 진단 = `offsetHeight-clientHeight`≠0인데 `scrollWidth-clientWidth`=0)
- **#88** `class_schedules`는 **운영 이력을 함께 담는다**(실측 1,068행 중 480행 만료) — 전 행을 그리면 끝난 교시가 현재로 보이고(반 상세 25줄 중 15줄) 미래 시작 교시도 현재로 샌다. 화면·AI·집계는 `summarizeSchedule`, 쿼리는 `liveValidTo` 절 (⚠️ 종강 반엔 걸지 말 것 — 요일이 통째로 사라진다)
- **#89** 상한 걸린 미리보기의 **배열 길이를 건수로** 쓰면 34명이 영원히 "30"(냄새=숫자가 상한값과 같고 안 변함) · 창으로 좁힌 수치에서 창을 떼면 거짓말(13건 ↔ 실제 171건) · 후검증 가드가 **프롬프트가 사실로 준 영문**을 막아 정상 응답을 폐기 · `max_tokens` 절단이 "JSON 문법 오류"로 위장(진단=output_tokens가 한도와 같은지) · ⚠️ **폴백 있는 기능은 실패율을 따로 계측**해야 보인다(화면은 매일 멀쩡해 보임)
- **#90** 브라우저에 저장한 "사용자 설정"은 계정 설정이 아니다 — localStorage는 **포트까지 포함한 origin 단위**(쿠키는 호스트 단위라 "로그인은 그대로인데 설정만 리셋"으로 위장). 사람을 따라다녀야 할 값(안 보기·읽음·온보딩)은 DB에 계정 단위로 · 설정 토글은 **바꾸는 순간 저장**(닫기 버튼에 매달면 체크만 하고 이동 시 유실) · ⚠️ 마이그 번호는 **rebase 시점**에 확정되고, 개명 시 일괄 치환하면 남의 주석을 깨뜨린다(내 파일만 + `git diff origin/main` 확인)
- **#91** RLS 정책에 **컬럼을 안 쓰는 게이트 함수를 맨몸으로** 쓰면 **행마다** 호출된다(`auth_billing_can_read()` 1회 14ms × 3,225행 = 2.1s). `STABLE`로는 안 접힌다 → **`(select f())`로 감쌀 것**(InitPlan, 권한 무변경). ⚠️ service_role 프로브는 RLS를 우회해 **정상으로 보인다** — 성능은 authenticated 롤로 잴 것. 🔑 판별은 "함수를 썼나"가 아니라 **"컬럼과 비교되나"** — `tenant_id = auth_tenant_id()`는 `Index Cond`(1회)라 감쌀 필요 없다(감싸도 무변화 실측). `EXPLAIN`에서 `Filter`인 것만 감싼다. 상관 서브쿼리는 감싸면 의미가 바뀐다
- **#92** RLS를 한 테이블에 걸었다고 **그 계열이 다 잠긴 게 아니다** — 0158a가 invoices·expenses만 잠근 사이 같은 계열 `invoice_teacher_splits`·`invoice_session_terms`(단가·분배액)와 `staff_contracts`(계약 조건 132행 중 54행이 급여성 문구)는 **역할을 안 보는 tenant_isolation 하나**로 강사·뷰어에게 PostgREST 직결로 열려 있었다(#77의 변종). ⚠️ **"의도적 제외"는 반드시 마이그레이션에 적어라** — 안 적힌 테이블은 닫힌 걸로 오인된다. ⚠️ 잠그기 전 `auth_menu_access` DEFAULTS에 그 메뉴가 있는지 확인(없으면 master 빼고 전부 'none' = fail-closed 락아웃)
- **#93** 이름이 비슷한 두 컬럼이 **다른 사실**일 수 있다 — `textbook_orders.created_by`(작성자) ≠ `teacher_name`(소유자). 대리 작성이 의도된 동작이라 사무실이 강사 앞으로 낸 요청은 작성자=사무실·소유자=그 강사다. ⚠️ **소유 판정을 created_by로 갈아끼우면 그 강사가 자기 요청을 못 고친다** · ⚠️ 소유자 이름으로 작성자 칸을 **백필하지 말 것**(사실 아닌 값이 남는다 — 모르면 null이 정직하다) · ⚠️ UPDATE의 `with check`는 OLD를 못 봐서 `col = auth.uid()`를 걸면 대리 작성분이 락아웃
- **#94** PostgREST 임베드에 **FK 이름을 안 적으면**, 남이 컬럼 하나 더한 날 **손도 안 댄 화면이 죽는다**(0171a가 `makeup_class_id`를 더해 lesson_reports→classes FK가 2개 → `classes(...)`가 PGRST201/HTTP 300 → 51건이 **"총 0건"으로 위장**). `.select(`의 임베드는 항상 `ident!<FK이름>(…)` — ⚠️ **정렬 문자열엔 넣으면 400**(select만 확정하면 정렬은 따라온다) · 🔑 위험 조합이 이미 **11쌍(8쌍이 →users)** 이라 `classes.select("…, users(...)")`류는 **지금 쓰면 바로 죽는다** · 진단은 REST 상태코드(RLS 의심보다 먼저) · 전수 가드 `postgrest-embed-hints.test.ts`
- **#95** 🔴🔴 **마이그레이션보다 앱을 먼저 배포하면 그 화면이 통째로 죽는다** — aywa는 SQL을 **원장이 손으로** 실행하므로 push와 적용 사이에 **항상 간격**이 있다. 2026-08-03 실사고: `classnote_notice_id`(0174a)를 `.select()`에 넣고 앱만 먼저 배포 → 컬럼 부재로 PostgREST 400 → `fetchInChunks`가 (규약대로) throw → **강사 전원의 원스크린이 먹통**. ⚠️ **모든 배포는 옛 스키마·새 스키마 둘 다에서 돌아야 한다**(expand/contract) — 새 컬럼을 읽는 코드는 ① SQL 적용을 **확인한 뒤** 푸시하거나 ② 컬럼이 없어도 안 죽게 짠다. 🔑 특히 **전원이 매일 쓰는 경로**(원스크린 로스터·시간표)엔 새 컬럼을 **넣지 말 것** — 사무실 화면 하나가 에러 나는 것과 급이 다르다(가드: `textbook-onescreen-hotpath.test.ts`)
- **#96** 지원 안 하는 모델을 요청 배열에 넣어도 **에러가 안 난다** — 조용히 폴백해서 주석·문서만 거짓이 된다(`universal-3-pro`를 몇 달간 보냈지만 실제는 전건 `universal-2`). 🔑 판별은 요청값이 아니라 **응답의 `speech_model_used`** · ⚠️ "상위 모델=더 좋다"는 언어별로 안 통한다(AssemblyAI 상위 라인 18개 언어에 **한국어만 빠짐**, 일·중은 있다) · 가드 `assemblyai-models.test.ts`
- **#97** 표를 **잡고 끌 수 있게** 만들면 더블클릭이 새어나간다(팬이 5px에서 `setPointerCapture` → 두 번째 클릭이 칸이 아니라 컨테이너로) → 드래그-팬 영역의 여는 동작은 **우클릭**으로 · ⚠️ `preventDefault`는 잠긴 칸에서도 항상 · 같은 표의 둘째 함정 = **자동 폭**은 열 너비를 그 열의 최장 내용에서 뽑아 **행이 사라질 때마다 표가 밀린다**(접기 한 번에 135→115px) → `colgroup`+`table-fixed`, 가변 칸만 폭을 비우고 하한은 `minWidth` · 🔑 사용자의 원인 가설("7일 잠금 탓")을 그대로 받지 말 것(master는 애초에 안 잠긴다)
- **#98** `transform` 걸린 조상은 **`position:fixed` 자손의 좌표계를 갈아탄다** — 모달을 `-translate-x-1/2`로 가운데 놓으면 dnd-kit `DragOverlay`가 패널 원점만큼 밀려 "끌고 있는 칩이 엉뚱한 데"(⚠️ 드래그·팝오버를 품는 컨테이너는 **flex 센터링** · 사촌 함정 = `zoom`은 fixed 좌표를 배율만큼 곱하니 zoom 래퍼는 **DndContext 안쪽** · 합성 PointerEvent 검증은 한 틱에 재면 안 된다)
- **#99** `aspect-ratio` 박스에 **높이를 주면 폭이 높이×비율로 되계산돼 제 열을 넘는다**(비율 아이템은 `justify-self:normal`이 stretch가 아니라 **start**) — 게다가 `relative`가 붙어 있으면 옆 칸 **위에** 칠해진다(출석부 허브 사진이 목록을 253px 가림). 🔑 지문은 **"창을 넓혀도 안 변한다"**(폭이 창 **높이**에서 나온다) · 비율 카드는 **`w-full`로 폭 확정**(크롭은 `object-cover`) · ⚠️ 한 열로 접히는 창은 반대로 커지거나(폭에서 비율) 손톱만 해지니 **띠 높이 명시**(`h-40 lg:h-full`)
- **#100** 단일 구간(`starts~ends`) 스키마에 **흩어진 날짜**를 넣으면 모델이 하나만 남기고 하필 **"오늘"이 사라진다**(벨 제목 "결석 8/12"인데 원문은 "8월 7일(오늘) 이랑 11일, 12일") — 가장 이른 날을 잡고 나머지는 detail로(가장 늦은 날을 endsOn에 넣으면 **사이 날까지 결석**이 돼 아이가 못 온다) · 🔴 후검증은 **알리기만**(원문 날짜로 판정을 당기면 없는 결석을 만든다) · 🔑 **그릇이 표현 못 하는 입력은 에러가 아니라 조용한 손실**로 나온다
- **#101** 폰 알림이 안 오는 건 권한이 아니라 **API가 다른 것** — 안드로이드 크롬은 `new Notification()`을 **아예 지원 안 함**(서비스워커 필수, `catch`가 삼켜 "권한 문제"로 위장) · iOS는 홈 화면 추가가 **필요조건이지 충분조건이 아니다**(manifest+SW+구독+VAPID 전부) · ⚠️ `sw.js`에 fetch 캐싱 금지(새 배포가 **폰에만** 옛 코드로 남는다) · ⚠️ 권한 팝업은 브라우저 크롬이라 자동화로 못 누른다(실기기 확인은 사람 몫)
- **#104** RLS 정책이 **0개인 표**는 사용자 클라이언트로 읽으면 **에러 없이 0행**(정책 없는 RLS = 전부 거부). `class_sheet_*`가 그렇고, 그래서 ECS 화면은 처음부터 admin으로 읽고 있었다 — 새 소비처가 `createClient()`를 쓰자 시트 초안이 통째로 사라졌다(조용히). 🔑 "쿼리 성공인데 0행"이면 필터보다 **`pg_policies` 유무**를 먼저 · ⚠️ admin은 RLS 우회라 **`tenant_id` 필터 필수** · ⚠️ fail-soft `.catch` 조회면 로그조차 안 남는다
- **#105** **조치가 필요한 목록**에 짧은 시간창을 걸면 고치기도 전에 사라진다 — 발송 큐 3일 창이 날마다 하루씩 실패를 밀어내, 실측 16건 중 **15건이 창 밖**이고 **11건은 발송 기한(7일)까지 넘겨 학부모에게 영영 못 나갔다**(재발송 UI가 그 카드뿐이라 되살릴 길도 함께 사라졌다). 🔑 창은 "언제 생겼나"가 아니라 **"언제까지 손 쓸 수 있나"**로 · ⚠️ 자동 재시도가 붙은 상태(`failed`)라고 시스템이 끝낼 거라 보지 말 것(판별은 상태 이름이 아니라 **사유**) · ⚠️ 기한은 **행에 남은 날로**("오늘까지") · ⚠️ 만료 뒤에도 며칠은 '만료'라는 결말을 보이고 내릴 것(마지막 날까지 보이던 행이 다음 날 증발하면 같은 불만이 반복)
- **#106** 시작시각이 같은 교시가 둘이면(**EiE 4교시 16:20~17:00 / IJW 1교시 16:20~17:20**) 찍어둔 수업이 **다른 칸으로 옮겨 보인다** — 역매핑 Map이 시작시각만 키로 써서 뒤엣것이 앞을 덮었다(DB는 내내 정확·화면만 거짓, 단 그대로 재저장하면 종료시각이 진짜로 바뀐다). 🔑 역매핑은 **(시작,종료) 짝 먼저**(`buildPeriodMatcher`) · 🔴 **시작시각 폴백은 남길 것**(splitGridSlots가 시작시각으로 분류하므로 폴백이 없으면 슬롯이 그리드에서 사라져 저장 시 삭제) · ⚠️ 교시 **이름은 학원설정이 단일 소스**(`${id}교시`는 폴백일 뿐) · ⚠️ 같은 표를 읽는 시간표 축은 반대로 "앞을 유지"였다(규약을 맞출 것)
- **#102** 서버 액션을 부른 **직후의 `router.push`는 삼켜진다** — 액션 응답이 *현재 페이지*의 RSC 트리를 다시 적용하면서 방금 시작한 이동을 덮는다. 지문이 고약하다: **목적지를 이미 받아놓고 멈춘다**(네트워크에 `GET /목적지?_rsc=` 200이 찍혀 있는데 화면은 그대로 · 버튼은 '처리 중…'에 disabled). 🔑 서버 액션 뒤 클라 이동은 **`window.location.assign`**(뷰 전환이 쓰던 규약) · ⚠️ 클라가 서버에 물어보고 이동하는 자리엔 **타임아웃**도 걸 것(안 돌아오면 폼이 영영 잠긴다)
- **#103** 칸을 잠그면 **이동 경로와 뒷문**까지 같이 봐야 한다 — `focus()`는 disabled 입력에 안 먹어 **Enter 세로 이동이 그 행에서 멈추고**(증상은 "눌렀는데 무반응"), '맨 위 행 복사'·'값 일괄 적용'·'이전 회차 가져오기'는 잠근 칸에 **지울 수 없는 값**을 밀어 넣는다(#77의 뒤집힌 꼴). 🔴 **되돌릴 문(출결)은 절대 같이 잠그지 말 것** — 오클릭한 결석에서 못 빠져나온다 · ⚠️ 값 적용만 건너뛰고 **행 목록에서는 빼지 말 것**(출결 일괄 적용이 같은 목록을 쓴다) · 📌 `<tr>` 자식은 `<td>`뿐이라 잠금 fieldset은 **칸 안에서** `display:contents`로
- **#107** "권한 위에 있다"를 **override 폐기**로 구현하면 기본값이 닫힌 메뉴에서 super_admin이 일반 직원보다 **덜** 본다 — 개인 예외로 연 수업 평가와 역할 override로 연 학원 설정이 동시에 사라지고, 정작 원장이 닫아 둔 메뉴는 보였다(= override 통째 무시) · 🔑 진단은 **사라진 것이 아니라 남아 있는 것**을 볼 것 · 고침 = 폐기가 아니라 `mergeMostPermissive`(잠금 무시 + 부여 보존) · ⚠️ 테스트 단계 메뉴는 기본값이 전 역할 `none`이라 "기본값으로 되돌리기"가 곧 차단이다
- **#108** `window.location.origin`으로 만든 문자열을 **텍스트로 렌더하면** 하이드레이션이 깨진다(React **#418**, 인자 `["text",""]` = 한쪽이 빈 문자열) — 클라 컴포넌트도 **SSR된다**: 서버는 `""`라 `/r/…`, 클라는 `https://…/r/…` → 그 subtree가 클라에서 통째로 재생성(원스크린 공유링크 `<code>{shareUrl}</code>`). 🔑 위험은 관용구가 아니라 **소비 위치** — 렌더 스코프면 위험, **핸들러·useEffect 안이면 안전**(같은 관용구를 쓰는 report-list는 무해) · 고침 = **표시는 `NEXT_PUBLIC_APP_URL`**(빌드 시 인라인이라 서버·클라 동일) **복사는 클릭 시점 origin** · ⚠️ `suppressHydrationWarning`은 경고만 지우고 재생성 비용은 남는다 · ⚠️ 같은 오류로 페이지 클릭이 전부 먹통이 된 전례([[#75]])
- **#109** RLS 정책 **둘이 서로의 표를 조회**하면 무한 재귀(42P17) — 그 표의 **모든** select가 500(0행이어도, 자기 행만 읽어도. 재귀는 행 평가가 아니라 재작성 단계에서 잡힌다). 고침 = 교차 조회를 **security definer 함수**로 감싸기(0211a) · 🔑 **service_role로는 재현 안 된다**(RLS 우회라 200) → 새 표에 RLS를 붙였으면 배포된 앱의 **공개 anon 키로 한 번 긁어 볼 것** · ⚠️ 정책이 다른 표를 참조하면 **그 표의 정책도 함께** 읽을 것 · ⚠️ 조회 throw가 서버 컴포넌트를 500으로 만들면 창이 검게 죽어 단서가 0 — 한글 배너 + 원문은 툴팁으로
- **#110** 하단 고정 저장 바와 "스크롤 끝 여백"은 **같은 속성(main pb)을 반대로 요구** — 08-14 셸 main `pb-8`이 07-10 밀착 규약을 조용히 깨서 **모든 저장 바가 떠 있고 그 틈으로 본문이 지나갔다**(셔틀 편집기). 고침 = 바 루트에 `.sticky-save-bar` 마커 + unlayered `main:has(.sticky-save-bar){padding-bottom:0}` 한 곳 (⚠️ **새 하단 고정 저장 바엔 반드시 이 클래스**를 붙일 것 · 음수 margin·`after:` 덮개는 이미 실패한 시도)
- **#111** **인라인 `<a>`에 건 `truncate`는 아무 일도 안 한다**(`overflow`는 비치환 인라인에 미적용) — 이름이 안 잘려 옆 배지가 **둘째 줄로 꺾이고** 그 행만 22→37px로 부푼다(동명이인 접미사 한 글자가 경계를 넘긴다). 지문 = **말줄임(…)이 한 번도 안 보임** · 부모가 flex면 자식이 블록화돼 같은 클래스가 잘 돈다(옆 화면만 멀쩡한 이유) · 고침 = flex 한 줄(이름 `shrink-0 nowrap` + 배지 `min-w-0 truncate`) · ⚠️ 밀도 높은 입력 표에선 `flex-wrap` 금지(접히면 그 행만 두 줄) · ⚠️ jsdom·타입체크는 못 잡는다(실브라우저 측정으로 확인)
- **#112** "대표 행 하나"를 **최신순**으로 집으면 하루에 여러 번 있는 축(교시)에서 **엉뚱한 행**을 집는다 — 결석 칸을 최신 1건으로 찾다가 그게 다른 교시의 **출석**이라 "그날 결석 기록이 없습니다"로 위장(실측 21건, 영어는 **하루 한 교시인 반이 0개**라 상시). 자매 경로는 상태를 안 봐서 **출석 칸에 "보강 예정"을 적었다**. 🔑 찾는 조건을 **정렬로 흉내 내지 말 것**(쿼리가 `status`로 좁혀야 한다) · ⚠️ 좁힌 뒤 여럿이면 고르는 규칙을 명시 + **이미 처리된 행 우선**(멱등) · ⚠️ 같은 판정을 두 액션이 따로 구현하면 한쪽만 고쳐진다(공용 모듈 + 가드) · ⚠️ 조회 실패를 빈 배열로 삼키면 "없다"는 거짓 결론
- **#113** **부분 유니크 인덱스는 `ON CONFLICT (컬럼)`로 추론이 안 된다** → supabase `upsert`가 **전건 42P10 실패**(타입체크·테스트는 다 통과, 실행해야 드러남). 🔑 `WHERE`를 붙이기 전에 **그 축으로 upsert할 계획이 있는지** 볼 것 — NULL 행이 안 겹치길 원한 거면 **일반 유니크 인덱스가 이미 그렇다**(술어는 얻는 것 없이 upsert만 깨뜨린다). 타겟 없는 `on conflict do nothing`은 무관.
- **#114** 카드 테두리는 `border`가 아니라 **그림자 링**(팔레트 v4)이라 **박스 밖**에 그려진다 → 카드를 `overflow-y-auto` 컨테이너에 직접 담으면(가로도 자동으로 `auto`가 되어) **좌·우 세로선만 잘려** "테두리가 깨져 보인다". 스크롤 컨테이너에 안쪽 여백(`px-1`)을 줄 것 (⚠️ DPR 1.25에서 border는 스냅되고 링은 안 되는 "굵기 제각각"과는 다른 문제)
- **#115** 같은 사실을 **FK와 텍스트 라벨 두 벌**로 들면 한쪽이 비는 날 표시가 갈린다 — 슬롯 `classroom_id`가 빈 하루 때문에 라벨 `302`가 그대로 나와 **`본원 3층`과 별도로 `3층`**이 섰다(`roomGroupOf`는 `건물명+호수`를 읽는다). 고침 = 라벨 폴백을 **등록된 강의실 이름으로 맞춰서**(`canonicalRoomName`) 내보내기 · ⚠️ **애매하면 손대지 말 것**(`602`=바른602/본원602) · ⚠️ 행 분할이라 그 하루짜리 이력 행은 **영구히 남는다**(그날을 보면 계속 갈라짐) · 🔑 폴백 값도 **정본의 형식으로 정규화**해야 "같은 방인가" 비교까지 산다
- **#116** 좁은 `table-fixed` 퍼센트 칸의 **`whitespace-nowrap` 라벨은 접지도 잘리지도 못해 흘러넘친다** — 풀 폭에선 패딩이 먹어 "빠듯"해 보일 뿐이라 **재현이 안 된다**(창 폭 ~650px 이하에서 표 밖으로). 고침 = 라벨만 `break-keep`+좁은 여백(🔴 `truncate` 금지 — 종이 서식에서 잘린 라벨은 넘치는 것보다 나쁘다) · 🔴🔴 공유 클래스 상수를 쪼갤 땐 **값을 하나도 빼지 말 것**(호출부가 덮어쓰는 충돌 유틸의 승자는 문자열 순서가 아니라 **생성된 CSS 순서** — `py-2`를 뺐더니 도장칸 머리 행이 34→22px로 납작해졌고 게이트는 다 통과했다)
- **#117** 한 배열에 **모양이 셋인 결과**(게시 `{ok,…}` · 수정 `{board,reports}` · 회수 `{board,revoked}`)를 담으면 `!x.ok`가 **성공을 전건 실패로 뒤집는다** — 7명에게 정상 게시된 공지를 제자리 수정하자 화면이 "발송 완료 · 실패 7 · 사유 없음"이 됐고 발송자는 재발송 직전이었다(학부모 알림장에 같은 글 2개 = 되돌릴 수 없다). 🔑 **0144a 트리거는 2026-07-23에 이미 같은 오탐을 고쳤는데 화면만 안 고쳐졌다**(벨은 조용, 화면만 거짓말) · 고침 = `ok` 키가 **있고** true가 아닌 것만 실패([`noticeFailures`](src/features/report-admin/notice-failures.ts) 단일 소스, 저장된 행까지 즉시 교정) + 워커 `editNotice`는 `{...r}`로 보존 · ⚠️ **`revokeNotice`엔 스프레드 금지**(`reports`가 남아 회수 취소선이 죽는다) · ⚠️ jsonb라 원소가 객체가 아닐 수 있다(`"ok" in x`를 typeof로 감쌀 것)
- **#118** **크레딧 소진은 400이라 "폴백할 오류"로 안 잡힌다** — 폴백 사다리가 멀쩡히 있는데도 멘트 AI가 이틀간 전건 실패했다(8/27 77건·8/28 32건). 🔑 판정은 상태코드+문구를 **둘 다**(Anthropic 400 `credit balance` / DeepSeek **402** `Insufficient Balance` / OpenAI 호환 429 `insufficient_quota`) · 사다리 = **anthropic → deepseek → upstage(Solar)** · ⚠️ **폴백 산출물이 원본보다 적게 말하면 그 차이가 조용한 사실 손실**(템플릿에 특이사항 칸이 없어 "내일 4시에 보강입니다"가 증발한 채 49건 발송) · ⚠️ 폴백 있는 기능은 **실패율을 따로 계측**해야 보인다([[#89]]) · ⚠️ plain object 오류는 `String(err)`=`[object Object]`라 문구 판정에 안 걸린다
- **#119** **`"use server"` 파일은 async 함수만 export할 수 있다** — 동기 헬퍼에 export를 붙이면 **빌드만** 깨진다(typecheck·lint·테스트 전부 통과). 공유 동기 헬퍼는 서버 액션 파일 **밖** 일반 모듈로 (⚠️ `import "server-only"`는 붙이지 말 것 — [[#61]]) · 가드 `server-action-exports.test.ts`
- **#120** **유니크 인덱스에 `WHERE is_active`가 없으면 폐지된 반이 이름을 붙든다** — 개명 예약은 성사되고 **그날 cron만** 23505로 실패하는데, 실패해도 '적용함' 표식을 남겨 **재시도조차 안 한다**(실측 17건 중 2건 영구 미적용). ⚠️ 활성만 보는 시뮬레이션은 "겹침 0"이라 한다 — **제약이 걸린 쓰기는 트랜잭션 안에서 실제로 실행**해 볼 것
- **#121** 임계값·창(window)의 **이름을 화면 문구로** 쓰면 숫자는 맞는데 사실이 틀린다(새벽 2시에 오후 2시 수업을 "2시간 뒤") — 화면엔 기준이 만들어 낸 **실제 값**(시각·날짜)을 적을 것
- **#122** 시트가 **번호만** 적는 값(방 `602`)은 후보가 둘이면 목록 순서가 대신 고른다 — 원장이 **보관해 둔** 폐강의실에 배치가 붙었다(가져오기만 `archived_at`을 안 봄). 필터는 **후보를 고르는 곳**에만, id→이름 조회엔 걸지 말 것
- **#123** "어제까지 마감·오늘부터 새로"(`planSlotArchives`)가 **미래 예약과 만나면 그 사이 하루가 빈다** — 적용일 전날에 그 반을 수정하면 그날 수업이 화면에서 통째로 사라진다 (미해결)
- **#124** 구분자로 자른 **첫 조각만** 읽으면 한 칸에 값이 둘일 때 나머지가 조용히 사라진다 — 합반 셀(`A/ B/ 304`)의 둘째 반이 시간표에서 통째로 없어졌고 가져오기가 마감까지 했다
- **#125** 명단 쿼리의 `end_date.gte` 는 **답이 아니라 프리필터**다 — 반열림(`[start,end)`)으로 닫힌 반이동이 그 하루 겹쳐 **한 학생이 옛 반·새 반 양쪽 명단**에 섰다(JJ·LAB 자리 출석부). 판별 = `is_transferred`를 select하고 `isEnrollmentEndedOn`을 **실제로 부르는지**. ⚠️ 모르면 일반 종료로(반대로 잡으면 퇴원 예정이 하루 일찍 사라진다)
- **#126** "이 반만 왜 다르지" = 여러 반을 한꺼번에 정리한 뒤 **정정이 일부에만** 들어갔다(브릿지 B가 20분 수업으로 남음) — 사라진 배치는 `timetable_snapshots…apply.inserts[].id` ↔ `class_schedules` 대조로 되짚되 **내용으로 한 번 더** 거를 것(id만 세면 재삽입분까지 실종으로 보인다: 48 → 진짜 6). 🔴🔴 **배치 시각은 이미 찍힌 출결의 앵커** — 시작시각을 옮기면 그날 `slot_start`로 찍힌 기록이 고아가 된다(종료만 늘리는 것과 위험도가 다르다). 🔴 **되돌려도 늦다** — 그때 열려 있던 화면이 없어진 교시로 저장하고 `rollupDay`가 그걸 합산해 시수가 부푼다(수업 시간 중 배치 수정 금지). 🔴 손으로 지운 배치는 **시트가 진실이라 다음 가져오기에 되살아난다** · 🔑 "파서가 이상하다"는 가설은 **원본을 한 번 읽으면** 대개 죽는다
- **#127** 선택자 목록 안의 **`:has(> …)`가 dev 산출 CSS에서 조용히 사라진다**(파일은 맞고 재시작해도 같다 — lightningcss 단독은 보존, Tailwind v4 파이프라인 어딘가) → 판별은 "매칭"이 아니라 **서빙된 CSS에 선택자가 있는지**(`document.styleSheets` grep) · 회피 = 감출 요소에 표식을 **직접**(`td[data-empty]`) · ⚠️ CSS는 어떤 게이트에도 안 걸리니 새 규칙은 실브라우저 `getComputedStyle`로 한 번 확인
- **#128** `overflow-hidden` 카드 안에서 `absolute`로 띄운 겹판은 **카드 경계에서 잘린다**(DOM은 있는데 안 보임 = z-index 아니라 잘림) — 겹판만 **포털+fixed**로 꺼내고 스크롤 재계산·앵커 이탈 시 닫기·초점 이동까지 함께 (⚠️ 첫 프레임은 `visibility` 말고 `opacity`+`pointer-events-none`)
- **#129** **끌던 줄이 언마운트되면 dnd-kit `active.data`가 빈 객체가 된다** — 무장(arming) 줄이 드래그 중 `pointerover`로 갈아타 "출발 반을 알 수 없어"(수학 기본뷰). 고침 = 누르는 동안 무장 잠금(`holdArmedRow`) + 집는 순간 data 스냅샷 · ⚠️ 터치 기기(전 줄 무장)에선 재현 안 됨 · 곁가지 = 막힌 칸 거절은 **이유**를 말한다·드래그 직후 더블클릭은 삼킨다(700ms)
- **#130** 내보낸 걸 그대로 되읽었는데 **“전건 변경”** — export는 **해석한 이름**(`Jane`→`추민아`)을 시트에 쓰고 import는 **DB 원문**과 비교했다(실측 유효 321칸 중 **199칸**이 강사만 다른 update, 방·종료시각은 0건). 🔑 **왕복하는 두 방향은 같은 정규화를 태울 것**(고침 = `slotTeacherDisplay`를 함께 실어 원문·해석값 둘 다 비교, 원문은 UPDATE 금지) · ⚠️ 곁가지(미해결): export는 **요일 칸마다 이번 주 그 요일 날짜**로, import는 **적용일 하루**로 유효 행을 골라 반영↔가져오기 사이에 바꾼 배치가 `생성 1·제거 1`로 되돌아온다 — 바꿨으면 **반영을 다시 누르고** 가져올 것
- **#131** `display:none`인 iframe은 **preload한 폰트를 안 쓴다** — 최소화한 창(=`hidden`)이 문서를 통째로 로드하고 있었다(셸·인증·DB·RSC를 **아무도 못 보는 문서**에 전부 지불, B6가 걱정하던 그 비용). 폰트 배선은 멀쩡했다(preload URL ≡ `@font-face` src, `?dpl=`까지 동일 · 웜 캐시 `transferSize:0` · 콜드 573ms < FCP 780ms) · 🔑 진단은 경고 문구가 아니라 `document.fonts`의 **`status:"unloaded"`** · ⚠️ `preload:false`로 고치지 말 것 · `visibility:hidden`·화면 밖은 정상(레이아웃이 산다)
- **#132** 이름·학교·학년이 같다고 붙이는 자동 연결은 **동명이인을 합친다** — "비퇴원 중 유일 매칭"은 방어가 아니다(기존 1명 + 새 아이 = 유일). 모순 증거(보호자 연락처가 다름)가 있으면 붙이지 말 것(0258a, 김근우 건) · 🔴 연결이 먼저 일어나면 '수업 배정'의 접미사 방어는 **실행될 기회가 없다** · 🔴 DB 트리거가 데이터를 바꾸면 **트리거가 감사로그**를 쓴다(앱 한 곳에서 쓰면 다른 진입 경로가 빠진다) · ⚠️ 같은 모양이 makeedu 학생 동기화·수납 가져오기에도 남아 있다(미해결)
- **#133** 창 안 **소프트 이동이 주소에서 `embed=1`을 지우면** 다음 `router.refresh()`·서버 액션 재검증이 embed 없는 주소로 공유 레이아웃까지 다시 받아 **창 안에 전체 셸**이 뜬다(이동 직후엔 멀쩡해 보인다 — refresh를 한 번 돌려 볼 것) · 이동 부품은 `useEmbed()`면 `withEmbed`, 하드 이동은 `EmbedAnchor`·`EmbedHiddenInput` · 안전망 `EmbedUrlKeeper`(`replaceState(null, …)` — ⚠️ 복원 뒤 첫 refresh는 트리 불일치 재시도 비용이라 자주 도는 출처는 이동 시점에 싣는다)
- **#134** 창(iframe) 덮개를 `load`에서 걷으면 창 안 `loading.tsx`·스트리밍이 **안 보인다**(첫 페인트 = `main.embed-main` 도착) · iframe 문서의 `visibilityState`는 **탭 기준**이라 숨은 창도 `visible`(부모가 덮는다, `frame-visibility.ts`) · ⚠️ 덮개를 일찍 걷거나 덮개 없이 하드 이동하면 load 전 입력이 가능 → 미저장 표식은 **떠난 문서의 것만** 내릴 것(표식에 주인 문서를 적는다) · 서버 액션 `redirect()`는 **303**(`ok`=false — 성공 판정은 `x-action-revalidated`)
- **#82** postgres.js에서 `${JSON.stringify(v)}::jsonb` = **이중 인코딩**(`"#153e75"` 9자 저장 → 검증 실패 → 설정 침묵 무시). 스칼라는 `to_jsonb(${v}::text)`·객체는 `sql.json(obj)`, 검증은 **길이까지** (⚠️ 눈으로 따옴표 구분 안 됨)

## 🎨 디자인 규칙 인덱스 (상세는 `docs/design-conventions.md`)

> UI·화면·폼·컴포넌트를 만질 때 해당 규칙을 `docs/design-conventions.md`에서 열어라. 대부분 각 절 끝에 "한 줄 규칙" 요약이 있다.

- **Editorial 구성 문법 — 새 화면 기본값** (PageHeader·BigStat·PhotoCard·소프트 패널·알약·de-mono 정책, ⚠️ 로컬 Stat/mono·영문 라벨 신설 금지)
- **타입 스케일 v5 + 컨트롤 프리셋 — 글자는 토큰만(xs 14 바닥), 컨트롤 높이는 세로 채움 70%(09-08)** (⚠️ 전역 기본값, 2026-09-03 — `text-[Npx]` 금지(가드), `control-scale.ts` 한 벌(라벨 **18 확정** → 높이 = 18 ÷ 0.7), 검색 `<input>`은 `h-full leading-normal`(잘림), 종이만 `.paper-scale`, 다열 보드 탭 접힘 금지 + 창 최소 크기 강제)
- **툴바 = 카드 껍데기 없이 · 높이는 control-scale · 라운드 덜 둥근 쪽 — 부품 [`toolbar.tsx`] + 가드** (⚠️ 필터/컨트롤 줄 기본값, 2026-09-01→09-03 — 새 툴바는 `<Toolbar>`/`<ToolbarSegment>`/`<ToolbarChip>`을 쓰고 치수를 손으로 적지 않는다. 09-03부터 높이는 h-8이 아니라 `h-(--control-h)`. 새 화면은 `CANON_SURFACES`에 추가. 읽기 전용 배지·패널 안쪽 컨트롤은 대상 아님)
- **컬러 토큰 v4 "White Contrast" + 의미색 캐논** (⚠️ 상태 표시 기본값, 2026-08-18 — 면=화이트·구분=테두리·색=의미에만. 배지 색은 `PillColor`가 아니라 **tone**을 고른다. 화면 파일에 `STATUS_META` 신설 금지. 의미(코드 고정)와 과목(학원설정) 두 축을 섞지 말 것)
- 창(embed)·**모바일** 페이지 헤더 = PageHeader 자동 컴팩트 1행 (⚠️ 새 메뉴 헤더 기본값 — 수제 eyebrow/h1 신설 금지, 콘텐츠 제목은 embedLabel, 2026-07-19 / 모바일 확장 07-30)
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
