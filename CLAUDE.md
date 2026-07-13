@AGENTS.md

# eywa 프로젝트 가이드

이 프로젝트는 [D:\ijw-calander](D:\ijw-calander)(인재원 학원관리 SaaS)의 경량 재작성판입니다. 자세한 설계 결정은 [`C:\Users\user\.claude\plans\curried-popping-finch.md`](C:\Users\user\.claude\plans\curried-popping-finch.md)에 있습니다.

---

## 메뉴 12개

대시보드 / 시간표 · 출석부 · 수업목록 / 학생목록 · 등록상담 · 학생상담 · 퇴원관리 / 직원관리 · 수납관리 · 회의록 / 도움말

기존 ijw-calander의 43개 탭 중 마케팅, 셔틀관리, 자료실, 역할관리, 매출분석, 지출관리, 시간표배포, 알림센터, 학부모포털 등은 의도적으로 제외했습니다.

---

## 작업 원칙

- **반응속도(UI/UX)가 1순위**. 학원장/강사는 매일 수십 번 이 화면을 본다. 느리면 끝. 무거운 작업(특히 AI 호출, 큰 쿼리)은 가시적 progressive 렌더링 또는 백그라운드로 빼고, 보이는 데이터는 가능한 한 캐시·streaming·partial 렌더링으로 즉시 보여줄 것.
- **한 파일 200줄, 한 컴포넌트 props 10개 이하** — 기존 코드는 3,113줄 단일 컴포넌트, props 80개로 무너졌습니다.
- **Server Component 우선**. 클라이언트 컴포넌트는 상호작용이 필요할 때만.
- **모든 DB 테이블에 `tenant_id` + RLS**. 멀티테넌트 누수는 한 정책 빠지면 전사 노출 — pgTAP 테스트로 강제.
- **출석/급여/수강료 등 계산 함수**는 순수 함수로 분리해서 Vitest 단위테스트 강제(coverage 게이트 70%+).
- **AI 호출은 캐싱 + 명시적 트리거**: 재분석은 명시 버튼이 있을 때만. 페이지 로드만으로 절대 새 호출 안 함. 마지막 결과는 DB에 보존되며, "갱신" 버튼을 다시 누르기 전까지 그대로 표시.
- **UI에 model 이름 노출 금지**. "claude-opus-4-7-2026-05-27" 같은 문자열은 학원장 입장에서 노이즈. 생성 시점만 표시.

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
eywa는 메뉴=플로팅 창=same-origin iframe이라 **창마다 셸 레이아웃이 재실행**된다(창 N개 = 인증·설정 쿼리 N배).
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

provider/모델 레지스트리는 `src/lib/ai/models.ts`의 `AI_MODELS`(티어×provider) + `resolveModel()`:

| Tier | Upstage (폴백) | Anthropic (**기본**, 2026-07-13~) | 용도 |
|---|---|---|---|
| `fast` | `solar-pro3` | `claude-haiku-4-5` | 짧은 분류, 태깅, 간단 요약 (현재 미사용) |
| `balanced` | `solar-pro3` | **`claude-sonnet-5`** | **경량 호출 기본값**(텍스트 상담 메모 분석 등). |
| `reasoning` | — (없음) | `claude-opus-4-7` | **금지** (명시 요청 시만). reasoning은 Anthropic 고정. |

- **운영 기본 provider = Anthropic Claude Sonnet 5** — 품질 A/B(2026-07-13)에서 Solar가 상담 분석의 warnings를
  통째로 놓치고 잡담(주식 등)을 섞어 전환. 전환은 env: **Vercel(+로컬)에 `AI_PROVIDER=anthropic` 설정 필수.**
  ⚠️ **코드 기본값(env 미설정)은 여전히 `upstage`(Solar)** — Vercel env가 안 걸리면 프로덕션이 Solar로 동작하니 반드시 확인.
  롤백 = `AI_PROVIDER=upstage`(전역, Solar로) 또는 호출부 `provider:"upstage"`. (Solar: 한국어 강점 + ~20–25배 저렴이나 품질 열세.)

### 녹음 분석 = Solar 유지 + 폼 자동입력은 후보정 하네스로 방어 (2026-06-24)
실 ijw 녹음 3건을 eywa 파이프라인에 흘려 ijw(Claude) 저장 결과와 대조한 결론: **전사(AssemblyAI `universal-3-pro`)는
ijw와 동일 엔진이라 품질 차 없음**(12분 회의 재전사 4,880자 vs ijw 4,869자), **회의록 8섹션·학생상담 7섹션·등록상담 분석문
(서술형)도 Solar로 충분**. 유일한 약점은 **등록상담 "폼 자동입력"(구조화 추출)** — Solar(solar-pro3)가 ① 스키마 보기값을
그대로 베끼고(`parentRelation=부/모/조부/조모/기타`, 이미 `pickEnum`이 폐기) ② 학생이름을 학교명에 복사(`schoolName=이윤건`)
③ 학원명 환각(`prevAcademy=수중학교`) ④ 일반호칭을 이름으로(`parentName=어머니`) ⑤ 한글자 잡음(`lastScore=6`).
- **결정(2026-06-24): 비용(Solar ~20–25배 저렴 + 무료크레딧) 위해 Solar 기본 유지.** ⚠️ **2026-07-13 뒤집힘 — 품질 A/B(상담 분석)에서 Solar가 warnings 통째 누락·잡담 혼입 → Claude Sonnet 5로 전환**(결정 로그 참조). 폼 자동입력 후보정 하네스는 Claude에서도 유효해 유지. 대신 **단일 후처리 함수 [`buildFormPatch`](src/features/enrollment/form-fill.ts)에
  후보정 하네스**를 넣어 위 오류를 DB 진입 전 차단(순수함수 + Vitest). 가드: `grounded`(고유명사는 전사에 실제 등장해야 통과
  =환각 차단)·`notEcho`(학생이름 복사 거부)·`realName`(호칭≠이름)·`meaningful`(한글자 잡음)·`phoneOk`(전화 형식)·`등록완료` 자동입력 금지(상담사 확인 영역).
  웹훅이 `buildFormPatch(extracted, current, { studentName, transcript })`로 전사·학생명을 넘겨 grounding 동작.
- **provider 스위치는 인프라로 보존**: `resolveModel(tier, keyName, prefer?)` + `generateJSON({ provider })`. 평소 미사용(기본 Solar)이나
  품질이 더 필요하면 호출부에서 `provider: "anthropic"` 한 줄로 Claude 라우팅 가능(키 없으면 무중단 폴백). `AI_PROVIDER=anthropic`은 전역 전환.
- ⚠️ 향후 새 "AI 추출→폼/DB 자동기입"을 만들 땐 **반드시 이런 후보정(enum/grounding/echo/잡음) 가드를 통과시킨 값만** 기입할 것(약한 모델 전제 방어).

### 녹음 재처리 2종 분리 + 레거시 오디오 Firebase 콜드 백엔드 (2026-06-24)
회의록 "다시 분석"이 사실 **AssemblyAI 재제출**이라 옛 ijw 녹음(오디오가 Firebase Storage에 있고 Supabase 미이전)에선 실패했다. 재처리를 **2종으로 분리**:
- **기둥 A — "AI 분석 다시 생성"**(텍스트 기반, 신규 [`regenerateMeetingAnalysis`](src/features/meetings/server/actions.ts)): 저장된
  `transcription`으로 8섹션 재생성. **오디오·AssemblyAI·웹훅 불필요 → 로컬에서도 즉시 완주, 녹음 삭제 후에도 가능.** 회의 8섹션 분석은
  [`features/meetings/server/ai.ts`](src/features/meetings/server/ai.ts) `analyzeMeeting`/`formatMeetingTranscript` **단일 소스**로 추출(웹훅·재분석 공유).
  진행 표시: 액션이 `analyzing`으로 즉시 표시 후 **`after()`로 백그라운드 분석** → 음성 분석과 **동일한 '분석 중' 스켈레톤 + StatusWatcher
  자동 새로고침** 재사용(별도 진행바 UI 신설 없이 일관). 완료 시 페이지가 스스로 새 리포트로 갱신.
- **기둥 B — "전사부터 다시"**([`retryMeetingProcessing`](src/features/meetings/server/actions.ts)): 원본 오디오 재제출. 옛 ijw 오디오(~2GB)는
  Supabase 미이전(무료 1GB 초과)이라 **eywa가 Firebase에서 직접 읽는다**. [`resolveAudioUrl(path, kind, tenantId)`](src/lib/storage/legacy-audio.ts):
  tenant 경로→Supabase signed URL / 레거시 Firebase 경로(`{kind}-recordings/…`)→**Firebase v4 signed URL(2h, `exists()` 선확인)**.
  순수 판별([`legacy-audio-path.ts`](src/lib/storage/legacy-audio-path.ts), Vitest)은 **kind별 prefix allowlist**(교차접근 차단)+한글 파일명 허용.
  `@google-cloud/storage` + `FIREBASE_SERVICE_ACCOUNT_KEY`(base64). server-only 회피 위해 순수/IO 분리, `audio-path.ts`는 re-export shim(기존 import 무변경).
  throw는 호출부가 `{error}`로 catch(보존만료 삭제 시 "AI 분석 다시 생성 쓰라" 명확 메시지).
- 검증: typecheck0/lint0/**test464**(legacy-audio-path 5) + 실 E2E(레거시 회의→Firebase signed URL→AssemblyAI 전사 4,880자 / "AI 분석 다시 생성"→Solar→DB `completed`·`solar-pro3`).
- **가독성 후속(2026-06-24)**: 회의 분석 8섹션이 화면·인쇄 모두 `<p whitespace-pre-wrap>`라 Solar의 쉼표/번호 run-on이 한 줄로 쏟아짐 →
  등록상담과 동일하게 **[RichText](src/components/rich-text.tsx) `bulletize`로 전환**(나열형: 안건/결정/액션/발언/우려/다음단계 = list, 요약만 산문).
  화면 [ai-report.tsx](<src/app/(shell)/meetings/[id]/ai-report.tsx>) + 인쇄 [(print)/meetings/[id]/print](<src/app/(print)/meetings/[id]/print/page.tsx>) 통일.
  `analyzeMeeting` 프롬프트에도 줄바꿈·`**강조**` 규칙 추가(모델 협조 시 더 나음, RichText라 미협조도 안전). 실데이터 검증: 번호 run-on → 7~8불릿 정확 분리.
- **전사 가독성(화자 라벨 없는 녹음)**: 옛 ijw 임포트 회의는 **speaker_labels 거의 0개**(40건 중 39건)라 통짜 전사였음 → 순수
  [`breakIntoSentences`](src/lib/text/split-sentences.ts)(종결부호+공백 경계 분리, 소수점·% 안 쪼갬, Vitest 6)로 **문장마다 줄바꿈**.
  [TranscriptSection](src/components/transcript-section.tsx)이 화자 발화·plainText 폴백 둘 다 적용(`whitespace-pre-line`).
- ⚠️ **트레이드오프**: 기둥 B는 eywa↔Firebase 의존 → ijw **앱**은 닫아도 **Firebase Storage는 콜드 백엔드로 유지**(완전 삭제 불가). 기둥 A(텍스트
  재분석)는 Firebase·오디오 무관이라 오디오를 나중에 지워도 분석 재생성 가능. ⚠️ 프로덕션 "전사부터 다시"는 Vercel에 `FIREBASE_SERVICE_ACCOUNT_KEY` +
  유효 `UPSTAGE_API_KEY` 필요(웹훅이 프로덕션서 돔). 텍스트 기반 기둥 A는 로컬·프로덕션 모두 키 추가 없이 동작.

### 회의 화자 정확도 — ijw 화자 임포트 + 직원 연결 편집 + 목록 AI요약 (2026-06-24)
"전사 화자가 실제와 안 맞는다" 제보. **진짜 원인은 AssemblyAI가 아니라 임포트 누락** — ijw `meeting_reports`는 화자 구분
(`speakerLabels` 44/47건, 37건 2명+)·역할(`speakerRoles` 32건 명확)을 잘 해뒀는데 eywa POC 임포트가 **transcription 텍스트만**
가져와 eywa 40건 중 38건이 `speaker_labels` 0개(통짜). 3종 처리:
- **임포트(즉효)**: [`import-meeting-speakers.cjs`](scripts/_poc_migration/import-meeting-speakers.cjs)(멱등·--apply) — ijw firebase
  `meeting_reports` → eywa `meeting_minutes`. 매칭키 `storagePath`=`audio_path`(39/41). `speakerLabels`→`speaker_labels`(구조
  `{speaker,text,start,end}` 일치), `speakerRoles`→`ai_speaker_roles`. **speaker_labels 빈 행만**(멱등) + **roles는 함께 동기화**
  (통짜로 추론된 옛 `{A:전체}`는 새 A/B/C 집합과 안 맞아 교체). 적용: 37행 → 화자 2명+ 32건 복원. ⚠️ firebase-admin은 ijw node_modules
  (`NODE_PATH=D:/ijw-calander/node_modules`), postgres는 eywa 로컬.
- **직원 연결 화자 편집(0050a)**: 화자 A/B를 **직원관리(users) 드롭다운으로 매핑** — 표시 라벨 `ai_speaker_roles`(`{A:"원장"}`) +
  연계 기반 `speaker_staff`(`{A:userId}`, 신규 jsonb 컬럼) **분리 저장**. UI [speaker-editor.tsx](<src/app/(shell)/meetings/[id]/speaker-editor.tsx>)
  (전사 위, SearchableSelect 직원+자유입력) → 액션 [`updateMeetingSpeakers`](src/features/meetings/server/actions.ts). 직원옵션 경량
  쿼리 `getStaffOptions`. AssemblyAI/AI가 틀려도 사람이 교정 = "실제 화자 일치" 확실 보장 + **미래 업무연계 기반**.
- **목록 미리보기 AI요약**: [getMeetings](src/features/meetings/server/queries.ts) 카드 body가 전사 raw → `ai_summary ?? transcription ?? content`.
- **업무연계 비전 문서**: [`docs/meeting-to-workflow.md`](docs/meeting-to-workflow.md) — speaker_staff 기반으로 액션아이템→업무배정/캘린더/알림
  자동연계 로드맵(1단계 화자=직원만 구현, 2~4단계 미구현. 캘린더·직원 알림 인프라 선행 필요).
- 검증: typecheck0/lint0/**test470**/build✓ + DB(화자 2명+ 32건·`speaker_staff` PATCH 노출·목록 ai_summary 39/39) + 회의상세 서버 200.
  ⚠️ Chrome MCP 미연결로 시각검증은 DB+서버렌더로 대체. ⚠️ 이 임포트는 ijw가 진실 — Firebase 재이식 시 재실행(멱등).
- Upstage는 OpenAI 호환 → `openai` SDK + baseURL `https://api.upstage.ai/v1`. JSON mode
  (`response_format: json_object`) 사용 — 프롬프트에 "JSON" 단어 필수(현 프롬프트 충족).
- **자동 폴백**: 기본 provider 키가 없으면 다른 provider(키 있는 쪽)로 1회 폴백 → 둘 다 없으면
  호출부의 기존 stub/error로 떨어짐(무중단). `model_version`엔 실제 사용 모델 id 저장(UI 미노출).
- 대안: **Gemini 2.5 Flash**(`GEMINI_API_KEY` 등록됨) — fast-tier 후보, 코드 통합 미구현.

키 분리 (사용량 추적):
- `UPSTAGE_API_KEY` / `ANTHROPIC_API_KEY` → 등록상담(/enrollment) + 회의록(/meetings)
- `UPSTAGE_API_KEY_CONSULTATIONS` / `ANTHROPIC_API_KEY_CONSULTATIONS` → 학생 케어 인사이트(/students/[id])
  (Upstage는 consultations 전용 키 없으면 `UPSTAGE_API_KEY`로 폴백)
- `GEMINI_API_KEY` → 향후 fast-tier 작업용 (현재 미사용)

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

### 배선 현황 (2026-06-19 Phase 1·2 픽스 후 — "동작 예시" 인용 시 ✅만)
- **✅ 배선 완료**: profile `name`·`branchLabel`·`logoText`, operations `subjects`·`jobTitles`·`gradeLevels`·
  `weekdayPeriods`·`weekendPeriods`·`holidays`, billing `dueDay`, notifications `printHeader` (기존) +
  **Phase 1·2 신규**: profile `brandColor`(layout가 `--primary` 등 CSS 변수 주입, `src/lib/color-utils.ts`),
  profile `representativeName`·`phone`·`email`·`address` + billing `latePolicy`(등록 인쇄물 푸터/안내,
  `(print)/enrollment/[id]/print`), notifications `alimtalkSenderKey`(kakao `pf_id` 지연 폴백, `messaging/provider.ts`)·
  `googleSheetId`(시트 동기 폴백, `integrations/server/{actions,queries}.ts`).
  - ~~⚠️ 영어 교시는 여전히 `ENGLISH_PERIODS` 하드코딩~~ → **✅ 해소(2026-07-06)**: 과목 운영 탭 `subjects[].weekdayPeriods`로 과목별 설정 가능(미설정=english 내장→전역 폴백).
  - **(2026-06-19) operations `subjects`/`gradeLevels` 하드코딩 소비처 전수 배선 완료(20건/17파일)** — 멀티에이전트
    전수감사로 "설정 무시" 위반 20건 적발·수정. 첫 발견은 학생목록·수업목록·성적관리 과목 드롭다운에 설정에 없는
    "예술(arts)" 누출(`SUBJECT_FILTERS`/`SUBJECT_META`)이었고, 이어 과목 라벨/색/선택지/엑셀출력을 하드코딩한
    14개 추가 파일을 전부 설정 기반으로 전환. **클라 단일 소스 신설**: `(shell)/layout`이 3경로(embed창·미니셸·풀셸)를
    [`OperationsProvider`](src/features/owner/operations-context.tsx)로 감싸 `useSubjectMaps()`/`useGradeLevels()`
    훅 제공(클라는 부모 prop 배선 불필요·창 안까지 커버). 서버는 `buildSubjectMaps(getTenantSettings)` 직접.
    수정 파일: dashboard `now-cockpit`(+`subject-meta.ts`는 시간헬퍼만 남기고 과목 라벨/색 제거)·`student-summary-view`·
    `student-quick-popover`·`classes/[id]`·`enrollment-assign-dialog`·`convert-dialog`·`withdrawals`·`timetable/page`(SUBJECT_ORDER
    닫힌 enum→설정 도출)·`class-cell`·`level-tests`·`catalog-table`(과목만; 학년 초/중/고는 교재 coarse 버킷이라 유지)·
    `exam-form-dialog`·`staff/[id] basic-info`·`exports/{timetable,students}-excel`·`students/_components/student-filter-bar`(학년필터).
    **규칙은 위 "⚠️⚠️ 운영체계 enum 하드코딩 절대 금지" 섹션 참조.** 새 목록/필터/표시는 반드시 그 단일 소스로 — native 하드코딩 과목/학년 맵 금지.
- **🚫 입력 숨김(소비처 없어 v1 비노출 — 상태·스키마·저장은 보존, 소비처 생기면 입력만 복원)**: operations `terms`,
  billing `taxMode`·`defaultMethod`(invoices에 결제수단 컬럼 없음), notifications `kakaoChannelId`(발송 경로에 미사용·대응 컬럼 없음).
- **✅ 배선 완료(2026-06-23)**: notifications `privacyTerms`·`serviceTerms` → **학부모 QR 공개접수 폼**(`(intake)/intake/[token]`)의
  개인정보/환불·학칙 동의 블록으로 소비(notifications-section에 TextAreaField 입력 복원). + operations `shuttle`
  (enabled/fee/routes 신규) → 공개접수 폼 셔틀 섹션으로 소비(operations-section `ShuttleEditor`). 둘 다 owner 폼 저장 →
  공개 폼 즉시 반영(실검증: fee "월 35,000원" 저장→공개폼 반영). ⚠️ 공개 폼은 인재원 데모 정적 텍스트를 더 이상
  하드코딩하지 않고 전부 학원설정에서 읽음(소비처 0 orphan 해소).

### DB가 필요한데 없는 것 (jsonb로 못 담는 것 포함)
`tenant_settings.data`는 텍스트/숫자/배열만 담는다 — **이미지·파일은 Supabase Storage 버킷이 별도 필요**:
- 로고 **이미지**(현재 `logoText` 텍스트 워드마크뿐)·직인/도장 이미지 → Storage 버킷 + `…profile.logoUrl`/`sealUrl` 경로.
- 사업자등록번호·운영시간(영업시간, 교시와 별개) → jsonb 필드 추가만으로 가능(스키마 확장).
- ~~**과목별 교시 세트**~~ → **✅ 완료(2026-07-06)**: `subjects[].weekdayPeriods`(jsonb, 마이그 0) + 과목 운영 탭 편집기
  + `weekdayTableFor` 폴백 체인(과목 전용→english 내장→전역). 시간표 기본뷰·통합뷰·강사뷰·학생 상세 라벨 전부 소비.
- **역할/권한 편집**(현재 `permissions.ts` 코드 하드코딩 — ijw 패리티 갭) → `tenant_role_permissions` 테이블 또는
  `…data.permissions` jsonb + 편집 UI(RLS와의 경계 설계 필요).

---

## 📂 상세 문서 (필요할 때만 Read — 포인터, `@import` 아님)

아래는 **경로 언급(포인터)** 이라 Claude가 그 영역을 만질 때만 Read한다 → 평소 토큰 0. **`@docs/...`(import)로 바꾸지 말 것** (import는 인라인 전개라 매 세션 로드 = 토큰 절약 0).

- 날짜별 구현 로그 / "뭘 이미 해봤나" → `docs/changelog.md`
- UI·화면·폼·컴포넌트 규칙 → `docs/design-conventions.md` (요약은 아래 "디자인 규칙 인덱스")
- 막혔을 때 / 함정 상세·재현·원인 → `docs/gotchas.md` (트리거는 아래 "막힌 점 인덱스")
- 셋업·마이그레이션·git 협업·검증 게이트·데모 계정·남은 작업 → `docs/setup-and-ops.md`
- 로그인 지속·세션 정책(자동 로그인 = 회전 끔) + **외부 SaaS 전환 시 되돌리기** → `docs/auth-session-policy.md`
- ClassNote 발송(수업보고서→학부모) 구조·운영·트러블슈팅 → `docs/classnote-integration.md` (⚠️ ClassNote를 만지기 전 필독 — 보드 명명 A~G 접미사·안전 가드·알려진 구멍·테스트 학생 '학원이')
- 기타 심층 문서 → `docs/` (audit-log · ijw-feature-port · makeedu-reverse-sync · payment-collection-plan · perf-open-window-backlog 등)

> ⚠️ 새 기능·배선을 완성하면 그 요약을 `docs/changelog.md`에 한 줄 추가(진행 상황 로그). 새 함정을 만나면 `docs/gotchas.md`에 항목 추가 + 아래 인덱스에 트리거 한 줄. 새 UI 규칙은 `docs/design-conventions.md` + 디자인 인덱스.

## ✅ 이미 내린 결정 — 다시 제안·질문하지 말 것 (Decision Log)

이미 확정된 결정이다. **재제안·재질문 금지.** 바꿔야 할 새 근거가 생기면 "이건 이미 X로 정해졌는데, 이런 이유로 재검토할까요?"라고 **명시적으로** 물어라(조용히 뒤집지 말 것).

- **AI provider 기본 = Anthropic Claude Sonnet 5** (2026-07-13 품질 A/B로 Solar Pro 3에서 전환 — Solar가 상담 분석 warnings를 놓치고 잡담을 섞음). 운영 전환은 env: **Vercel+로컬 `AI_PROVIDER=anthropic` 필수**(코드 기본값 미설정은 여전히 upstage=Solar이므로 안 걸면 프로덕션이 Solar로 동작). 모든 AI(JSON) 호출은 `src/lib/ai/generate.ts`의 `generateJSON()` 단일 진입점. 롤백 = `AI_PROVIDER=upstage`(전역, Solar로) 또는 호출부 `provider:"upstage"`. `reasoning` 티어(Opus)는 **금지**(명시 요청 시만), Anthropic 고정.
- **테넌트 `injaewon` = 프로덕션 실데이터** (ijw-calander 은퇴·전체 이식). 데모 아님 → **`db:seed` 절대 금지**, 검증 중 무심한 mutation 금지(읽기 전용·국소·원복 우선). "데모=일회용" 전제 폐기.
- **의도적 비이식(영구 제외)**: 캘린더/간트/챗봇/시간표 시뮬레이션(시나리오)/계약서/양방향 자동 동기화. 마케팅·셔틀·자료실·역할관리 원본탭·매출분석·시간표배포·학부모포털도 12메뉴 정체성상 제외. (인앱 알림은 경량 `notifications`만 신설했고 ijw "알림센터"는 아님.)
- **Excel/스프레드시트 = 내보내기·가져오기만.** 마법사·임의 컬럼매핑 불요(2026-06-23 결정).
- **미디어 저장 = 현재 Firebase/GCS** (무료 5GB로 Supabase $25 지연). 결제 구간 오면 Supabase로 스왑 = `MEDIA_STORAGE_BACKEND` 전역 플래그 한 줄.
- **makeedu 동기화 = 집 신뢰 IP 로컬 실행** (데이터센터 IP는 CAPTCHA 차단 → GitHub cron 폐기). 담당 PC = 작업 스케줄러 + 상주 워처. 프로덕션 '지금 동기화' = DB 요청 큐 릴레이. **역동기화 전면 자동 = 비권장**(QR 접수 상담 건별 수동 푸시만 opt-in).
- **강사 = 원스크린 전용 미니셸** ('내 메뉴' 드롭다운). 사이드바 복원(A안) 비채택.
- **수강료 계산기 = 신입생 상담 견적 도구** (`tuition_quotes`, invoices와 분리 — 재원생 청구는 별개).
- **커스텀 권한그룹(makeedu식 면/탭 전면 매트릭스) = 비채택.** "이 기능만 다른 권한" 요구는 **menuKey 승격**이 정석(textbook_requests·integrations 선례).
- **과목 내부 키(`subjects[].key`) = 자동 확정·불변**, 학원장이 손대지 않음. key를 편집 input으로 되돌리지 말 것(orphan). 폐기·교체는 "삭제 → 다른 과목에 흡수"(`absorbSubject`).
- **라이트 전용(Daylight)** — 다크모드 제거. 폰트 = Pretendard **정적 풀 한글 subset**(dynamic-subset 아님).
- **이름 앞 아바타/이니셜 배지 = 금지 (영구).** 사람 표시는 이름 텍스트만.
- **master 시스템역할 표시 라벨 = "원장"** (2026-07-07 "owner→원장" 전역 환원, 최신). ⚠️ 07-02엔 "owner"로 통일했다가 뒤집힘 — **다시 owner로 되돌리지 말 것**.
- **로그인 세션 = "절대 로그아웃 안 함"(자동 로그인).** Supabase Auth `refresh_token_rotation_enabled=false`(2026-07-09 적용 — 멀티 iframe 회전 경합이 "밤새고 오면 로그아웃"의 원인이었음). `sessions_timebox`·`sessions_inactivity_timeout`=0. **학원 내부 단일 운영 전제**의 트레이드오프(탈취 토큰 자동무효화 포기). ⚠️ 이 설정은 **코드가 아니라 Supabase 서버측**(Management API/Dashboard→Auth→Sessions). **외부/공개 SaaS로 가면 회전 복원 + 재사용 유예 확대**로 되돌린다 — 상세·명령 = `docs/auth-session-policy.md`.
- **겸직(관리자 계열 + 담당 반) 뷰 전환 = 강사뷰↔관리자뷰 토글** (2026-07-09). 관리자뷰 사이드바 하단 '강사뷰로 전환' / 강사 미니셸 '내 메뉴' 드롭다운 하단 '관리자뷰로 전환'. 쿠키(`eywa-view`)만 바꿈 = **권한 불변**(실 `system_role`이 authoritative). 강사 데이터 스코프는 **`effectiveTeacherId`/`effectiveTeacherScope`([view-mode.ts](src/lib/auth/view-mode.ts)) 단일소스** — 새 teacher-scope 코드는 `systemRole==="teacher"` 직접비교 금지, 이 헬퍼 사용. ⚠️ base-ui 드롭다운 안 서버액션 `redirect()`는 클라 네비 유실 → 경로반환 + `window.location`.

## 🗣️ 사용자 작업 선호 — 반복 교정 금지 (항상 적용)

사용자가 이미 준 피드백이다. **같은 교정을 두 번 하게 만들지 말 것.**

- **main = 프로덕션.** dev(또는 격리 워크트리)에서 검증 끝나고 **사용자 승인**이 있을 때만 main 반영. 곧바로 main 커밋·push 금지. (비가역·외부발신도 승인 후.)
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

## 🎨 디자인 규칙 인덱스 (상세는 `docs/design-conventions.md`)

> UI·화면·폼·컴포넌트를 만질 때 해당 규칙을 `docs/design-conventions.md`에서 열어라. 대부분 각 절 끝에 "한 줄 규칙" 요약이 있다.

- 컬러 토큰 (`src/app/globals.css`)
- 라운드 (ijw 운영 톤에 맞춰 시안에서 대폭 축소)
- 타이포
- Atoms (`src/components/atoms/`)
- Botanical 아이콘 (22개)
- AppShell
- shadcn base-nova (Base UI) 유지 사항
- 스크롤바 — 전역 하네스 (⚠️ 무조건 적용)
- 드롭다운/셀렉트 규약 (⚠️ 새 드롭다운 기본값)
- 비밀번호 입력 규약 (⚠️ 마스킹 비밀번호 필드 기본값, 2026-06-30)
- 버튼 크기 — 헤더 액션은 공용 `<Button>` 기본 크기로 통일 (⚠️ 새 버튼 기본값, 2026-06-24)
- 저장 버튼 = 창 하단 고정 sticky 바 + 미저장 닫기 가드 (⚠️ 창 데이터입력 폼 기본값, 2026-07-03)
- 줄바꿈 / 워드브레이크 — 한글 어절 단위 (⚠️ 전역, 좁은 창에서 특히 중요)
- 학교·학년 표기 = `schoolGradeLabel` 압축 "경명여중1" — 공백 join 금지 (⚠️ 전역, 2026-07-08)
- 드래그-팬 (잡고 끌기) — 넘치는 영역의 기본 인터랙션 (⚠️ 새 화면 기본값)
- 플로팅 창 기본 크기 — 넓은 메뉴는 크게 연다
- 다열 보드 = 큰창 그리드 / 작은창 탭 (⚠️ 칸반형 레이아웃 기본값, 2026-06-19)
- 영역 구분 — 이질적 다(多)섹션은 헤더 달린 카드로 또렷이 나눈다 (⚠️ 상세/집계 뷰 기본값, 2026-06-24)
- 반응형 창 폭 — 넓은창 공간활용 + 좁은창 접힘 (⚠️ 새 페이지 기본값, 2026-06-19)
- 생성 폼은 우측 패널이 아니라 창으로 — autoClose 창 (⚠️ "새 X" 진입점 기본값, 2026-06-19)
- 동시편집 "수정중" 실시간 표시 — cross-user presence (⚠️ 편집 표면 기본, 2026-07-01)
- 강사 접근 조임 — 강제 URL = roleHome 폴백 (2026-07-01, `84199c4`)
- 로컬 초안 자동저장 — 길게 입력하는 폼은 입력 중 유실 방지 (⚠️ 긴 폼 기본값, 2026-06-30)
- 인쇄(Print) — 인쇄 버튼이 있는 모든 곳은 플로팅 창 + A4 (⚠️ 새 인쇄 표면 기본값, 2026-06-24)
- 목록 페이지네이션 표준 — 큰 목록은 전부 이 패턴으로 통일 (⚠️ 새 목록 기본값)
