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

| Tier | Upstage (기본) | Anthropic (폴백/롤백) | 용도 |
|---|---|---|---|
| `fast` | `solar-pro3` | `claude-haiku-4-5` | 짧은 분류, 태깅, 간단 요약 (현재 미사용) |
| `balanced` | **`solar-pro3`** | `claude-sonnet-4-6` | **경량 호출 기본값**(텍스트 상담 메모 분석 등). |
| `reasoning` | — (없음) | `claude-opus-4-7` | **금지** (명시 요청 시만). reasoning은 Anthropic 고정. |

- **기본 provider = `AI_PROVIDER` env (미설정 시 `upstage` = Solar Pro 3).** 한국어 강점 + Sonnet 대비
  ~20–25배 저렴($0.15/$0.60 per 1M, 128K). `AI_PROVIDER=anthropic` 한 줄로 즉시 Claude 롤백.

### 녹음 분석 = Solar 유지 + 폼 자동입력은 후보정 하네스로 방어 (2026-06-24)
실 ijw 녹음 3건을 eywa 파이프라인에 흘려 ijw(Claude) 저장 결과와 대조한 결론: **전사(AssemblyAI `universal-3-pro`)는
ijw와 동일 엔진이라 품질 차 없음**(12분 회의 재전사 4,880자 vs ijw 4,869자), **회의록 8섹션·학생상담 7섹션·등록상담 분석문
(서술형)도 Solar로 충분**. 유일한 약점은 **등록상담 "폼 자동입력"(구조화 추출)** — Solar(solar-pro3)가 ① 스키마 보기값을
그대로 베끼고(`parentRelation=부/모/조부/조모/기타`, 이미 `pickEnum`이 폐기) ② 학생이름을 학교명에 복사(`schoolName=이윤건`)
③ 학원명 환각(`prevAcademy=수중학교`) ④ 일반호칭을 이름으로(`parentName=어머니`) ⑤ 한글자 잡음(`lastScore=6`).
- **결정: 비용(Solar ~20–25배 저렴 + 무료크레딧) 위해 Solar 기본 유지.** 대신 **단일 후처리 함수 [`buildFormPatch`](src/features/enrollment/form-fill.ts)에
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
- **알려진 예외(KNOWN_EXCEPTION, 스키마 한계)**: ① 영어 10교시 `ENGLISH_PERIODS`(`periods.ts`) — 과목별 교시 세트
  스키마 미존재. ② 레벨테스트 `SUBSCORE_KEYS`(과목별 세부점수 차원) — operations 스키마 밖 도메인 메타. 둘 다 스키마 확장 시 전환.
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
  **앞으로 과목 키를 폐기·교체할 땐 이 6 테이블 + `users.subjects[]`(배열) + `tenant_settings` 전부 함께 마이그레이션**(놓치면 raw 키 누출/강사 필터 불일치).

### 배선 현황 (2026-06-19 Phase 1·2 픽스 후 — "동작 예시" 인용 시 ✅만)
- **✅ 배선 완료**: profile `name`·`branchLabel`·`logoText`, operations `subjects`·`jobTitles`·`gradeLevels`·
  `weekdayPeriods`·`weekendPeriods`·`holidays`, billing `dueDay`, notifications `printHeader` (기존) +
  **Phase 1·2 신규**: profile `brandColor`(layout가 `--primary` 등 CSS 변수 주입, `src/lib/color-utils.ts`),
  profile `representativeName`·`phone`·`email`·`address` + billing `latePolicy`(등록 인쇄물 푸터/안내,
  `(print)/enrollment/[id]/print`), notifications `alimtalkSenderKey`(kakao `pf_id` 지연 폴백, `messaging/provider.ts`)·
  `googleSheetId`(시트 동기 폴백, `integrations/server/{actions,queries}.ts`).
  - ⚠️ 영어 교시는 여전히 `ENGLISH_PERIODS`(`periods.ts`) 하드코딩 → `weekdayPeriods` 설정과 무관(Phase 3 과목별 교시로 해소 예정).
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
- **과목별 교시 세트**(영어 1교시≠수학 1교시 시각 — 위 `ENGLISH_PERIODS` 하드코딩의 근본 원인) →
  `weekdayPeriods: PeriodTime[]` → `Record<subjectKey, PeriodTime[]>`로 확장 + 기존 데이터 마이그레이션.
- **역할/권한 편집**(현재 `permissions.ts` 코드 하드코딩 — ijw 패리티 갭) → `tenant_role_permissions` 테이블 또는
  `…data.permissions` jsonb + 편집 UI(RLS와의 경계 설계 필요).

---

## 기술 스택 (실제 적용된 것)

| 영역 | 선택 |
|---|---|
| 프레임워크 | **Next.js 16.2.6** (App Router, Turbopack) |
| 언어 | TypeScript (strict) |
| 스타일 | Tailwind v4 + shadcn/ui (**base-nova preset = base-ui 기반**, Radix 아님) |
| 폰트 | Pretendard Variable (정적 풀 한글 subset, dynamic-subset 아님) |
| 백엔드 | Supabase Postgres + Auth + RLS |
| ORM | Drizzle (`src/lib/db/schema.ts`, `drizzle-kit` for migrations) |
| Server data | Supabase JS server client (cookies adapter) → RLS 통과 |
| 클라이언트 데이터 | TanStack Query (현재 거의 미사용) + Server Components |
| 폼/검증 | react-hook-form + Zod (현재는 useActionState + 수동 검증 위주) |
| AI | `@anthropic-ai/sdk` — Claude Opus 4.7. 없으면 stub fallback |
| 테스트 | Vitest (happy-dom) + Playwright (smoke만) |
| 배포 | Vercel (`bigshols-projects/eywa`, alias `eywa-alpha.vercel.app`) |

### 폴더 컨벤션

```
src/
├─ app/
│  ├─ (auth)/login/             # 로그인 (passthrough layout)
│  ├─ (shell)/                  # 인증된 12개 메뉴 — 공용 사이드바/헤더
│  └─ (print)/enrollment/[id]/print/  # A4 인쇄 — 사이드바 없음
├─ features/<menu>/server/queries.ts  # 메뉴별 서버 쿼리 + actions
├─ components/                  # shadcn + 공용 컴포넌트
├─ lib/
│  ├─ db/schema.ts              # Drizzle 단일 소스
│  ├─ supabase/{server,client,proxy}.ts
│  ├─ auth/current-user.ts      # getCurrentUser() (auth.uid → public.users)
│  ├─ permissions.ts            # SystemRole × MenuKey × Access 매트릭스
│  ├─ navigation.ts             # NAV_GROUPS (사이드바 + 헤더 page title)
│  └─ ai/anthropic.ts
supabase/migrations/
├─ 0000_*.sql, 0001_*.sql, ...  # drizzle-kit generate 결과 (자동)
├─ 0001a_*.sql, 0002a_*.sql ... # 손수 작성한 RLS/제약/트리거 (drizzle 무관)
└─ meta/_journal.json           # drizzle 추적 — 손수 파일은 여기 없음
scripts/seed.ts                 # `pnpm db:seed` — 데모 시드 (idempotent)
```

---

## 진행 상황

**12개 메뉴 + ijw 패리티 + Admin 도구 + 제품 중심 랜딩 + UI 폴리시 + super-admin Phase 1
+ ijw 갭 P0·P1·P2 메우기 완성.**
디자인 시안 (Daylight: forest green + 라이트 톤) 전면 적용. (사이드바 메뉴는 retention·성적관리 추가로
실제 14개 — "12메뉴 정체성"은 초기 사이드바 기준 표현.)

### 신규 미디어 업로드 = 단일 스토리지 추상화 + ijw Firebase(GCS) 라우팅 (2026-06-29) — ✅ 4게이트 그린 + GCS/CORS 실검증
사용자 비용 전략: **ijw가 쓰던 그 Firebase(버킷 `ijw-calander.firebasestorage.app`, 레거시 ~2GB가 이미 거기)를 그대로** 신규 미디어
저장소로. 무료 5GB로 Supabase $25를 늦추고, 결제 구간 오면 Supabase로 스왑 → **백엔드는 `MEDIA_STORAGE_BACKEND` 한 줄로 교체**. 계획 [`expressive-weaving-glacier.md`]. [[project_storage-cost-strategy]].
- **단일 추상화** [`src/lib/storage/`](src/lib/storage/media-storage.ts): `types.ts`(클라/서버 공용 `UploadTicket`)·`backend.ts`(`getMediaBackend`, 순수)·`gcs-client.ts`(GCS 클라 추출)·
  `media-storage.ts`(본체: `createUploadTicket`/`verifyUploadedObject`/`resolveAudioReadUrl`/`resolveTenantReadUrl(s)`/`resolveBrandingSrc`/`removeObject`, **kind 메타테이블**로 오디오/영수증/브랜딩 분리)·
  `upload-to-ticket.ts`(클라 XHR PUT, 진행률)·`legacy-audio.ts`→얇은 wrapper(호출부 무변경). ⚠️ **업로드 패턴 전환**: 브라우저 직접 Supabase upload → **서버 signed PUT URL 발급 → 브라우저 PUT**(GCS는 클라 RLS 불가).
- **권한·검증 하드닝(리뷰 반영)**: 티켓 발급 액션마다 ① **kind별 권한 게이트**(오디오=메뉴 write / 영수증=expense 테넌트 실존 / 브랜딩=master) ② **경로 서버 빌드**(클라 입력 불신)
  ③ size·contentType max. + **업로드 후 `verifyUploadedObject`(getMetadata: exists·size·CT)** 통과해야 DB 등록, 실패 시 **서버 `removeObject` cleanup**(GCS는 클라 삭제 불가). ⚠️ sign contentType ≠ PUT Content-Type = **403**(ticket.headers로 강제).
- **Phase A(오디오 3흐름)**: `issueAudioUploadTicket`([features/media/server/upload-actions.ts](src/features/media/server/upload-actions.ts)) → 3폼(회의·학생상담·등록상담 녹음) → 3 start 액션(`verifyUploadedObject`+`resolveAudioReadUrl`로 AssemblyAI 제출) → 회의 삭제 `removeObject`.
- **Phase B(이미지)**: 영수증([billing/server/expense-actions.ts](src/features/billing/server/expense-actions.ts)) 업/검증/cleanup/읽기(`resolveTenantReadUrls`)/삭제 GCS 전환 + **로고/직인 업로드 신규**(`issueBrandingUploadTicket` master, [profile-section.tsx](<src/app/(shell)/owner/_components/profile-section.tsx>) `BrandingField`, 인쇄 3곳 `resolveBrandingSrc`로 path→signed URL, http 하위호환).
- **CORS**: [scripts/setup-gcs-cors.cjs](scripts/setup-gcs-cors.cjs)가 SA로 `setCorsConfiguration` — ⚠️ **ijw 기존 규칙 보존 머지**(setCors는 전체 교체라). exact origin(`localhost:3001`·`eywa-alpha.vercel.app`). `*.vercel.app`(부분 와일드카드) 무효 → preview는 origin 추가 또는 `*` opt-in.
- 검증: typecheck0/lint0/**test516**(backend env분기·receipt/branding validator)/build✓ + **GCS 실라운드트립**(오디오 audio/webm·이미지 image/png: PUT200·메타·READ200·**wrong-CT 403**·delete) + **CORS preflight**(localhost·eywa-alpha 허용/evil 차단/ijw 보존) + /meetings/new 200.
- **브라우저 E2E(2026-06-29, PSS 웨일)**: 회의록 녹음(mp3)→브라우저 PUT→GCS 객체(size·audio/mpeg)→AssemblyAI가 GCS 서명URL fetch / 지출 영수증(png)→GCS 3세그 경로 객체+썸네일 GCS 읽기 / 로고(png, master)→GCS branding 경로 객체 — 전부 실객체 확인 후 정리. (학생상담·등록상담 녹음은 동일 issueAudioUploadTicket 코드라 동치.)
- **검증 중 발견·수정**: `.webm` 오디오 **파일**은 브라우저 MIME이 `video/webm`이라 서버 `allowCT(audio/*)`에 막힘(녹음 경로는 audio/webm이라 무영향) → 3폼에서 **contentType을 audio/*로 정규화**(file.type이 audio/* 아니면 `audio/${ext}`). video/webm 주입→정상 업로드, GCS contentType `audio/webm` 확인.
- ⚠️ **ops 전제**: ① GCS 업로드 쓰면 `FIREBASE_SERVICE_ACCOUNT_KEY` 선택→**필수**(프로덕션 Vercel 주입). ② 새 프로덕션 도메인/preview는 CORS origin 추가. ③ `MEDIA_STORAGE_BACKEND`는 **전역 플래그**(객체별 아님) — supabase 스왑 전 GCS tenant 객체 일괄 이전 + 프로덕션 Supabase 0 확인. ④ branding Supabase 버킷 RLS는 미작성(GCS 기본이라 불요, 스왑 시 추가). ⑤ 실 마이크/파일 업로드 UI E2E는 입력 한계로 GCS 메커니즘+CORS+렌더로 대체.

### 녹음 = 네이티브 팝업 창 → 내부 플로팅 창 + 녹음 중 창 잠금 (2026-06-26) — ✅ 4게이트 그린
사용자 제보: 회의록 등에서 "바로 녹음"을 누르면 **별도 브라우저 창**(`window.open` about:blank)이 떠 앱처럼 안 보였다. eywa는 이미 자체
플로팅 창 시스템이 있고 생성 폼(`meetings/new`·`enrollment/new`·`consultations/new`)도 **이미 플로팅 창**이라 녹음 전용 네이티브 팝업은 불필요·이질적.
- **결정/근거**: 네이티브 팝업의 유일한 가치는 "별도 OS 창이라 부모 탭 하드 새로고침에도 녹음 생존"이었으나, ① 일상 케이스(녹음하며 배경
  자유 사용)는 폼 창이 배경 소프트네비를 견뎌 그대로 보존 ② 부모 탭 하드 새로고침 생존은 **IndexedDB 청크 복구**([recording-recovery.ts](src/lib/recording-recovery.ts), 매 1초 저장)로 메움.
  → **네이티브 팝업 제거**([`recorder-popup.ts`](src/lib/recorder-popup.ts) 삭제), 녹음은 폼 창 안 **인라인**(기존 폴백 경로를 정식 경로로 승격).
- **녹음 중 창 잠금**(사용자 요청 "X 비활성화로 혹시 모를 일 차단"): same-origin **BroadcastChannel**([`window-busy.ts`](src/lib/realtime/window-busy.ts), record-channel 패턴)로
  iframe 폼 ↔ 부모 워크스페이스를 묶음. 폼이 [`useRecordingLock(isRecording)`](src/components/workspace/use-recording-lock.ts)로 자기 창 id(`route:meetings/new` 등,
  pathname에서 도출)로 busy 발행 → 부모 [FloatingWindow](src/components/workspace/floating-window.tsx)가 그 창의 **X(닫기)·배경보내기·Esc·드래그-투-배경 비활성화**
  (툴팁 "녹음 중 — 정지 후 닫기 가능"). **최소화는 허용**(iframe 마운트 유지=녹음 지속). 부모 탭 하드 새로고침은 [WorkspaceCanvas](src/components/workspace/workspace-canvas.tsx)가
  busy 동안 `beforeunload` 가드(iframe의 beforeunload는 탭 전체를 못 막으므로 최상위 프레임에서 별도). iframe 자체 이탈은 useRecordingLock이 beforeunload로 막음.
- **마이크 권한**: [route-window.tsx](src/components/workspace/route-window.tsx) iframe에 `allow="microphone"` 추가(일부 브라우저는 same-origin이어도 getUserMedia에 iframe allow 요구).
- **3곳 통일**: 회의록·등록상담은 인라인+복구가 이미 있어 팝업만 제거. **학생상담**([audio-consultation-form.tsx](<src/app/(shell)/consultations/_components/audio-consultation-form.tsx>))은 인라인만 있고 복구 없었음 →
  IDB 복구(`rec.start(1000)`+saveChunk, `RecoveryKind`에 `student-consultation` 추가)·복구 배너·녹음 잠금 추가해 동일 동작.
- **디스크 백스톱 복원**(사용자 "파일증발 대비"): 팝업이 정지 시 하던 **자동 다운로드**가 인라인 전환에서 빠졌었음 → [`downloadFile`](src/lib/audio-upload.ts)(best-effort,
  throw 안 함)를 3곳 onstop에 추가 — 정지 즉시 .webm을 다운로드 폴더로 저장(브라우저 내부 IDB 복구와 **별개**의 OS 파일 백업). 보호 3겹: 녹음중 IDB 청크 + 정지시 디스크 + 폼 state.
- **파일명 KST 통일**: 인라인 전환 때 `toISOString()`(UTC, `Z`접미 = 한국시간과 9시간 오차)로 떨어졌던 것을 공용 [`kstTimestamp()`](src/lib/audio-upload.ts)
  (`Intl.DateTimeFormat({timeZone:'Asia/Seoul'})`, 옛 팝업과 동일)로 교체. 다운로드 3곳 + IDB 복구 파일명(`복구_*`)까지 전부 `…_KST.webm`(OS 시간대 무관 한국시간).
- ⚠️ **백업 저장 위치 = 현재 "로컬 디스크 다운로드"(임시 방편), 추후 클라우드 스토리지로 이전 검토**: 정지 시 .webm을 사용자 **다운로드 폴더**로
  내려받는 건 "파일증발 대비"의 최소 백스톱일 뿐, 다운로드 폴더가 흩어지고 다른 기기에선 못 본다는 한계가 있다. **향후 Supabase Storage(현 업로드
  버킷 재사용) 또는 Firebase Storage(레거시 오디오 콜드 백엔드 기존 사용)에 정지 즉시 백업 업로드**로 옮기는 것을 검토한다(자동 분석 업로드와 별개로,
  분석 시작 전·실패해도 원본이 클라우드에 남게). 옮길 때 [`downloadFile`](src/lib/audio-upload.ts) 호출부(3곳 onstop)를 백업 업로드로 대체하거나 병행.
- 검증: typecheck0/lint0(신규0)/**test511**/build✓. ⚠️ 실제 마이크 녹음·창 잠금·다운로드 라이브 검증은 마이크+로그인 세션 필요(게이트로 대체).

### 시간표 주간 이동(타임머신) ijw 충실 이식 + 편집 드래그 UX + 헤더 재배치 (2026-06-26) — ✅ 4게이트 그린 + 라이브 검증
사용자 제보: ijw 시간표엔 "날짜 표시 + 주간 이동"이 있어 **반 이동·퇴원이 날짜로 기록**돼 주를 앞뒤로 옮기면 그 시점의 반 구성
(과거 퇴원·미래 이동 예정까지)을 볼 수 있었는데 eywa엔 미이식(오늘 스냅샷만). ijw 양쪽 소스(`useSubjectClassStudents.ts`·
`dateUtils.ts`·`TimetableManager.tsx`·`useStudentDragDrop.ts`)를 읽어 **그대로** 이식. 계획 [`expressive-weaving-glacier.md`].
- **데이터 모델 재확인(DB 실측)**: eywa `enrollments`는 이미 `start_date`+`end_date`+GiST daterange = **시간 구간 테이블**(ijw와 동형).
  데모 종료 enrollment 263건·시작일 2019~2026 분포 → **과거 재구성이 실제로 다르게 보임**(마이그 0). 미래는 거의 빔(미래시작 2건) → Phase B 필요.
- **A. 주간 이동 조회**: 순수 유틸 [`week.ts`](src/features/timetable/lib/week.ts)(`getWeekReferenceDate` 미래→월/현재→오늘/과거→일,
  `weekLabel` "2026년 6월 4주차 (22일~28일)", Vitest 12) + [queries.ts](src/features/timetable/server/queries.ts)
  `getWeeklyScheduleWithStudents({ referenceDate })`가 그 시점 명단 재구성(재원/대기[미래시작·on_hold]/퇴원/전입/신입을 기준일 기준 분류).
  **퇴원이 enrollment.end_date 없이 `students.withdrawn_at`로만 기록된 경우까지** 잡도록 student status/withdrawn_at 조인(=기존 "퇴원-개방 학생을 재원 오표시" 버그도 교정).
  [page.tsx](<src/app/(shell)/timetable/page.tsx>) `?week=` 파라미터 + [week-nav.tsx](<src/app/(shell)/timetable/_components/week-nav.tsx>)
  ◀ 이번주 ▶ + 주차 라벨 + "과거/미래 조회" 배지. 과거 주는 편집 비활성(소급 금지).
- **B. 미래 예약 이동**(`0056a` alpha, dev적용): [move_enrollments_batch](supabase/migrations/0056a_move_enrollments_effective_date.sql)에
  `p_effective_date` 추가(옛 end_date=적용일 / 새 start_date=적용일). [actions.ts](src/features/enrollments/server/actions.ts)
  `moveEnrollmentsBatch(moves, effectiveDate)` + [timetable-board.tsx](<src/app/(shell)/timetable/_components/timetable-board.tsx>)가
  **보고 있는 미래 주**를 적용일로 전달 → 미래 주에서 드래그하면 그 주에 이동 예약(현재 주엔 옛 반 유지). ijw `scheduledDate` 패턴.
- **편집 드래그 UX(별건, 같은 세션)**: ① **DragOverlay** — 잡으면 학생 이름 칩이 커서 따라옴(끄는 느낌). ② **도착 셀 "전입 예정"** —
  옮긴 학생이 도착 반에 초록 "+이름 ←원래반" 미리보기(`incoming` 맵, edit-context/timetable-board/class-cell). ③ **드래그 URL 고스트 픽스** —
  [WindowLink](src/components/workspace/window-link.tsx) anchor에 `draggable={false}`(끌 때 링크 URL 딸려오던 것 차단) + 편집 행 `select-none touch-none`.
- **헤더 재배치(사용자 제안)**: [app-header.tsx](src/components/app-header.tsx) 검색을 중앙 → **우측**, [BackgroundTabs](src/components/workspace/background-tabs.tsx)를
  부유 오버레이 → **헤더 인라인(검색 왼쪽)**으로 이동(workspace-canvas에서 제거). 배경 2개+일 때만 노출·드래그 꺼내기 동작 유지.
- 검증: typecheck0/lint0/**test511**(week 12)/build✓ + 라이브(PSS 웨일, localhost:3001): 과거주 2026-03 등록 1424→1124·BS1B as-of 재구성 **DB와 1:1 일치**·
  과거/미래 배지·과거 편집 비활성 / **Phase B E2E**: 미래(2026-07-13) 예약 → DB split 정확(BS1B end=07-13·tr / CR1C start=07-13·trIn) → 미래 주엔 CR1C·현재 주엔 BS1B → 검증 후 원복.
  ⚠️ MCP 합성 드래그는 dnd-kit 발화가 까다로워(2단계 PointerEvent) Phase B 데이터·양 주 효과는 RPC 직접+DB+양 주 DOM으로 결정적 검증.
- ⚠️ 후속: 미래 퇴원 예약은 ijw도 즉시라 범위 밖. 데모 미래 데이터 희소 → 미래 주 검증은 Phase B로 생성 후.

### ijw 강사 색상 이식 + 통합뷰 셀·담임색 배선 (2026-06-26) — ✅ 게이트 그린 + 라이브 검증
계획서 "분기점"(강사 헤더색: ijw 저장색 vs eywa 해시) 해소. ijw `staff`(42명 전원 bgColor/textColor 보유)를 eywa `users`로 이식하고
시간표 통합뷰가 저장색을 실제로 쓰게 배선(익스포터는 기존부터 `users.bg_color` 소비, 화면은 해시였음).
- **데이터 이식**: [`backfill-teacher-colors.cjs`](scripts/_poc_migration/backfill-teacher-colors.cjs)(멱등·--apply) — ijw `staff.name`↔eywa `users.display_name`
  **42/42 매칭(불일치 0)** → `bg_color`/`text_color` + **`english_name`**(영문닉네임). 색 분포 ijw와 완전 일치(24색 히스토그램). 반색은 기존 백필(52).
- **`users.english_name` 추가**(`0055a`, dev적용): 영어 시간표 슬롯 라벨이 **영문닉네임**("Kristine"·"Hannah")이라 한글 `display_name`로는
  매칭 불가 → english_name도 키로. 백필 후 distinct 슬롯 라벨 14개 **전부 색 해결(미해결 0)**.
- **통합뷰 배선**: [`getTeacherColorMap()`](src/features/timetable/server/queries.ts)(users → `display_name`·`english_name` → hex, 테넌트 RLS)
  → page(통합뷰만 fetch) → [rich-grid-view](<src/app/(shell)/timetable/_components/rich-grid-view.tsx>) → [rich-card-group](<src/app/(shell)/timetable/_components/rich-card-group.tsx>):
  미니그리드 **셀**(슬롯 강사)·**담임 칩**이 저장색(인라인 hex) 우선, 미해결 라벨만 [`teacherColor`](src/features/timetable/lib/class-grid.ts) 해시 폴백.
  `TeacherColorMap`은 plain 객체라 클라 전달 안전([[#61]]). LAB은 파란 배지 유지.
- 검증: typecheck0/lint0/**test499**/build✓ + dev(3001) 통합뷰(영어) HTML에 저장색 인라인 렌더 확인(#ffa8d2·#3b82f6·#93c47d·#674ea7 등).
- ⚠️ 강사색 기본뷰(요일그룹밴드)는 범위 밖(통합뷰만 — **강사**색 한정). ⚠️ ijw가 진실 — Firebase 재이식 시 backfill-teacher-colors.cjs 재실행(멱등).

### 반 색상(classes.bg_color)을 기본뷰·편집 폼 스케줄까지 반영 (2026-06-26) — ✅ 게이트 그린 + 라이브 검증
사용자 제보: 반 색을 설정해도 시간표에 안 보임. 원인 = **반 색이 통합뷰에만 배선**돼 있고 **기본뷰는 과목색, 편집 폼 스케줄은 고정 초록**(선택 표시)을 써서
반 색이 새지 않았다(로그인/계정 무관). 통합뷰 외 두 소비처에 배선(커밋 `a9943c3`).
- **기본뷰 ClassCell 헤더**([class-cell.tsx](<src/app/(shell)/timetable/_components/class-cell.tsx>)): `slot.classBgColor`가 있으면 헤더 인라인 hex(글자색=`readableTextColor` 휘도 자동),
  없으면 기존 과목색 폴백. ⚠️ **WindowLink는 `style` prop 미지원**([[#61]] 계열) → 색은 **감싸는 styled `<div>`** 에 주고 WindowLink는 그 안에(클래스는 폴백일 때만).
- **편집 폼 스케줄 그리드**([schedule-grid.tsx](<src/app/(shell)/classes/_components/schedule-grid.tsx>)): 선택 셀이 **반색 미리보기**(폼 라이브 `bgColor`, 없으면 기본 초록 `bg-primary`).
  부담임 오버라이드 셀은 **보라 링**(`ring-purple-700`)으로 구분(반색 위에서도 식별). [class-form.tsx](<src/app/(shell)/classes/_components/class-form.tsx>)가 `bgColor` 전달 + 라벨 "(시간표 통합뷰)"→**"(시간표·스케줄)"**.
- 검증: typecheck0/lint0/**test499**/build✓ + Chrome MCP 라이브(기본뷰 MS2A 헤더 `rgb(250,180,180)`=#fab4b4 / 편집 폼 선택 셀 4개 동일). 이제 통합뷰·기본뷰·편집 폼 3곳 모두 반색 반영.

### 엑셀 다운로드 버그픽스 + 구글시트 연동 단순화(ON/OFF) + 사이드바 경계 + 병목 빠른승리 (2026-06-26) — ✅ 게이트 그린 + 라이브 검증
사용자 연속 요청 묶음. 게이트: typecheck0/lint0(신규0)/**test499**(content-disposition 4)/build✓. dev(3001) 라이브 검증.
- **🐛 엑셀 다운로드 전면 깨짐 픽스(핵심)**: 시간표·학생·수납 엑셀 4라우트가 `Content-Disposition: filename="수학_시간표_…"`에
  **한글**을 넣어 응답 생성 시 `TypeError: Cannot convert argument to a ByteString`(한글 코드포인트>255)로 **500** → "엑셀 버튼
  무반응"(iframe이 빈 500으로 이동). 익스포터/버퍼는 정상, 파일명 헤더만 문제. **RFC 5987 헬퍼 [`attachmentFilename`](src/lib/http/content-disposition.ts)**(ASCII
  폴백 `filename` + UTF-8 `filename*`, Vitest 4)로 4라우트 교체. **curl 실측 재검증**: 시간표 200·165KB·유효 xlsx(PK) / 학생 200 / 수납 200.
- **구글시트 연동 = 단순 ON/OFF 토글로 전환**(사용자 "싹 빼고 ON 버튼만"): 연결 패널(이메일·시트생성·서비스계정 안내·지금동기화)
  **전면 제거** → owner 연동 면은 **토글 1개**([_client.tsx](<src/app/(shell)/admin/integrations/sheets/_client.tsx>) `setSheetsExportEnabled`,
  **`user_integrations.sync_enabled` 재활용=마이그 0**). **시간표 '시트' 버튼 = master + 연동 ON일 때만** 노출([timetable/page.tsx](<src/app/(shell)/timetable/page.tsx>)
  `isGoogleSheetsExportEnabled`, `syncSheetsNow`도 enabled 게이트 이중방어). 대상 시트·서비스계정은 운영자 설정(연동 화면에 "관리자에게 문의").
  죽은 `connectGoogleSheets`/`disconnectSheets`/`createTenantSpreadsheet` 제거. 라이브 검증: DB off→버튼 숨김 / on→노출(디버그로그로 canSync 확인).
- **사이드바 오른쪽 경계선 = 사이드바 너비조절로**(사용자 "탭크기와 같이 움직이게"): 창이 경계에 붙으면 창 좌측 리사이즈 핸들이
  사이드바 핸들을 덮어 "창만 리사이즈"됐음 → 사이드바를 **`z-[45]`**(캔버스 z-40 위·팰릿 z-50 아래)로 올려 경계 드래그=사이드바
  너비조절(폭 바뀌면 캔버스 left=rail 따라가 창 reflow) + 창 드래그 **x≥0 클램프**([use-pointer-drag.ts](src/components/workspace/use-pointer-drag.ts))로 창이 사이드바 뒤로 안 감.
- **병목 감사(40에이전트, 확정22/기각10) → 빠른승리 적용**([[project_operational-readiness-verdict]] 계열 후속): ① **시간표 교재→진도
  직렬→`Promise.all`**(queries.ts) ② **recharts(~367KB) `next/dynamic`(ssr:false) 6곳**(차트 리프 `*-impl.tsx` 분리 + 스켈레톤
  로딩 — 차트 보일 때만 로드) ③ **`getAvailablePeriods` 무페이징→`fetchAllPaged`**(invoices 1606행 1000절단으로 수납 월칩에서
  2026-03 누락 **실측 버그** 해소) ④ **findOrphans·시간표엑셀 enrollments→`fetchAllPaged`/`fetchInChunks`**(이식 직전 잠복 절단 봉쇄)
  ⑤ **dead export `getStudentConsultations` 삭제**(호출 0·footgun).
- **병목 M-노력 2차(멀티윈도우 비용)**: ⑥ **멀티윈도우 셸 재실행 →`getTenantSettings` tenantId별 `unstable_cache`**
  ([owner/server/queries.ts](src/features/owner/server/queries.ts) `loadTenantSettingsRaw`: admin client + 신뢰 tenantId 키 = 쿠키 없이 캐시 안전,
  getTenantSettingsByTenantId와 동일 service_role 패턴·`.eq(tenant_id)` 격리). 창=iframe마다 셸 레이아웃이 재실행돼도 DB 2쿼리를 공유.
  resolveSettings(DEFAULT merge)는 캐시 밖이라 코드 변경 즉시 반영. 무효화 = `saveOwnerSection`이 **`updateTag`**(server action read-your-writes,
  즉시) + 기존 `revalidatePath("/","layout")`(unstable_cache 태그 무효화 폴백) + `revalidate:300` TTL 백스톱. ⚠️ Next16 `revalidateTag`는 2-arg
  (`tag,profile`)로 시그니처 변경 → read-your-writes엔 `updateTag(tag)` 사용([[reference: node_modules/next/dist/docs … version-16.md]]).
  ⑦ **복원 창 스톰 →route-window iframe `src` stagger 마운트**([route-window.tsx](src/components/workspace/route-window.tsx)): 포커스 창만 즉시,
  나머지는 z순서×250ms 후 활성화(`activated` state, 동기 setState 없이 setTimeout). 복원 시 6창이 동시에 풀 라우트 렌더+하이드레이션하던 폭발 제거.
  검증: typecheck0/lint0/test499/build✓ + dev(3001) 라이브 200(설정 캐시 런타임·unstable_cache+admin client 에러 0). 창 stagger는 빌드+로직(드래그 E2E 비실용).
  ⑧ **시간표 초기로드 스트리밍 →route [`loading.tsx`](<src/app/(shell)/timetable/loading.tsx>)**(무거운 getWeeklyScheduleWithStudents 동안 Next가 스켈레톤을 즉시 스트리밍 — 창=iframe 첫 페인트가 빈 화면 아님).
  툴바가 데이터(과목칩·인원)에 의존해 부분 페인트가 안 되므로 셸 전체 스켈레톤. ⚠️ **트레이드오프**: 과목/뷰 전환(searchParam 네비)에도 스켈레톤이 잠깐 뜸 — 무플래시로 하려면 과목 필터를 클라(fetch-once)로 옮기는 별도 리팩터 필요.
  ⚠️ **미적용(별도·근거)**: getCurrentUser 인증 네트워크(GoTrue getUser, 보안 민감 → 보류)·**#9 학생목록 과목필터 `.in()`**(P1 — subject 필터를 resolved id `.in()`으로 좁히는데 distinct+exact count를 PostgREST로 못 풀어 **RPC 필요**, math~400<1000으로 현재 미발현 → Firebase 전체이식 전 전용 작업으로)·**#11 출석 matrix 2회**(null 콜은 early-return으로 **classes 목록만**=경량이라 중복은 light 1쿼리뿐 → 리팩터 가치 낮아 스킵).

### 수학 시간표 = ijw 익스포터 완전이식 + 구글시트 공유-탭 push (2026-06-25) — ✅ 게이트 그린 + 13에이전트 적대리뷰
계획 [`giggly-orbiting-sunset.md`]. eywa가 ijw `exportMathTimetableToExcel`과 **동일 xlsx**를 생성(verbatim 이식
[`exporter.ts`](src/features/exports/math-timetable/exporter.ts) + 얇은 어댑터 [`assemble.ts`](src/features/exports/math-timetable/assemble.ts))하고,
전환기에 **한 구글 스프레드시트를 두 앱(ijw+eywa)이 공유**하도록 eywa는 **자기 탭만 비파괴 추가**한다. (수학만 먼저 — 영어=10교시·LAB 별도, 후속.)
- **단일 빌더**: [`buildMathTimetableBuffer({teacherId?})`](src/features/exports/math-timetable/build-buffer.ts) = 다운로드 라우트
  ([route.ts](<src/app/api/exports/timetable/route.ts>) `?subject=math`)와 시트 동기화가 공유(중복 제거). 강사 헤더색은 `users.bg_color/text_color`→없으면 익스포터 해시색.
- **구글시트 비파괴 공유 push** [`pushMathTimetableTabs(spreadsheetId, buffer, tenantToken)`](src/features/integrations/google-sheets.ts):
  xlsx→임시 Google Sheets import → 각 탭 `copyTo`(색·병합·서식 보존) → 한 batchUpdate에서 **직전 탭 삭제→신규 탭 rename**(순서 보장: ≥1시트 + 제목충돌 회피) → 임시파일 삭제.
  소비처=`syncSheetsNow`([integrations/server/actions.ts](src/features/integrations/server/actions.ts)). spreadsheetId=`user_integrations` 또는 `settings.notifications.googleSheetId` 폴백.
  (옛 `pushTimetableToSheets` 전체 덮어쓰기는 제거 — 공유 시트에서 남의 탭을 지웠음.)
- **⚠️ 적대리뷰(13에이전트) 확정 6건 전부 수정** — 이 영역의 함정 = "공유 시트 + 액션 중복 노출":
  1. **(HIGH) 무스코프 PII 누수**: 동기화가 테넌트 **전체** 시간표(전 강사·전 학생)를 외부 시트로 내보내 강사 스코핑(B5) 우회 → **`syncSheetsNow` master 게이트**로 해소(전체 내보내기가 master 권한과 일치).
  2. **(MED) 액션 게이트 부재**: `/timetable` 툴바 `시트` 버튼이 전 역할 노출 → 서버 master 게이트 + 툴바 `canSync`(master) 숨김 **이중 방어**(CLAUDE.md #58 "페이지 아닌 액션을 게이트").
  3. **(MED) 멀티테넌트 탭 교차삭제**: 두 테넌트가 같은 시트를 가리키면 `eywa·` 접두만 보고 서로 탭 삭제 → 탭 접두를 **`eywa·{tenant}·`**([sheet-tabs.ts](src/features/exports/math-timetable/sheet-tabs.ts), `tenantId.slice(0,8)`)로 네임스페이스 → 교체 대상이 자기 테넌트로 국한.
  4. **(LOW) 쓰기 한도/429**: copyTo·batchUpdate에 **429/503 지수백오프 재시도** + 부분 실패 시 방금 복사한 미rename 탭 정리(orphan 누적 차단=사실상 원자적).
  5. **(LOW) ops 전제 미노출**: ijw 전체 덮어쓰기 경고를 연동 UI([_client.tsx](<src/app/(shell)/admin/integrations/sheets/_client.tsx>))에 한 줄 추가.  6. **(LOW)** 실패 `last_error` upsert best-effort 주석.
  (기각 4건: batchUpdate 순차적용 의미·copyTo가 hidden 보존·죽은 가드분기·변환 충실도 — 근거 타당.)
- ⚠️ **ops 전제(코드 불가)**: ① eywa 서비스계정이 공유 시트에 **편집(writer) 권한** ② 공유 기간 동안 **ijw 자동 push 일시중지**(ijw `drive.files.update` 전체 덮어쓰기가 eywa 탭을 지움).
- 검증: typecheck0/lint0(신규0)/**test495**(sheet-tabs 7, 교차테넌트 격리 포함)/build✓. ⚠️ 구글시트 E2E는 라이브 서비스계정+공유시트 필요 → 순수 단위테스트+게이트+적대리뷰로 대체(로컬 미검).

### 시간표 내보내기 라이브 검증 + 구글시트 push = ijw식 "기존 시트 덮어쓰기"로 전환 (2026-06-29) — ✅ xlsx 실측 / 시트 전제 정정
사용자 "실제로 스프레드시트에서 확인되나" 요청 → **xlsx는 실측 정상**, **구글시트 push는 위 copyTo 설계가 가용 서비스계정과 호환 안 돼 ijw식으로 교체**.
- **xlsx 다운로드 = 실데이터 E2E 통과**(Chrome MCP, master 로그인 localhost:3001): `/api/exports/timetable?subject=math` → HTTP200·정확 MIME·163KB·ZIP유효. 브라우저에서 zip 해제·파싱: **14시트**(통합 1 + 강사별 12 + `_meta`), 메인 A1:AY100·셀 5,098·**병합 1,123**·**채움색 33**(밴드/강사색 보존)·실한글(합계행·요일밴드·교시·반명·강의실·이번주 날짜). = Excel/시트에서 정상 열림 확정.
- **🔑 키 진상**: 앞서 "GOOGLE_SERVICE_ACCOUNT_KEY 없음"은 그 이름의 env만 없던 것 — 실제 서비스계정 키([D:\ijw-calander\serviceAccount.json](D:\ijw-calander\serviceAccount.json))는 **eywa가 이미 `FIREBASE_SERVICE_ACCOUNT_KEY`로 보유**(동일 SA `firebase-adminsdk-fbsvc@ijw-calander.iam.gserviceaccount.com`, base64). 실호출: authorize OK·Drive/Sheets API 활성.
- **❗ 결정적 제약(라이브 실측)**: 이 서비스계정은 **Drive 저장공간 limit=0** → **파일 생성 불가**(`drive.files.create`/`spreadsheets.create`가 403 `storageQuotaExceeded`). 즉 옛 `pushMathTimetableTabs`의 "xlsx→임시시트 생성→copyTo"는 **첫 단계에서 실패**(가용 키로는 절대 동작 안 함). ijw 자기 코드도 동일 한계를 알고 우회([D:\ijw-calander\functions\timetableSheetsSync.js](D:\ijw-calander\functions\timetableSheetsSync.js) `translateError`·`updateSheetContent`).
- **→ 전환(2026-06-29)**: 구글시트 push를 **ijw식 [`overwriteMathTimetableSheet(spreadsheetId, buffer)`](src/features/integrations/google-sheets.ts)**(`drive.files.update` media 교체 + `supportsAllDrives`)로 교체. 사람이 **미리 만든 빈 시트**(소유자=원장 계정 용량)에 SA를 **'편집자'로 공유** → eywa는 그 시트를 **전체 덮어쓰기**(생성 안 함). 키는 `GOOGLE_SERVICE_ACCOUNT_KEY` 우선 + **`FIREBASE_SERVICE_ACCOUNT_KEY` 폴백**(기존 키 재사용, 새 env 불요). 신규 [`getServiceAccountEmail()`]이 연동 UI에 **공유 대상 이메일을 직접 표시**([sheets-face.tsx](<src/app/(shell)/owner/_components/sheets-face.tsx>) "처음 한 번 설정" 가이드).
- ⚠️ **설계 트레이드오프**: copyTo "eywa·{tenant}· 탭 비파괴 다앱 공유"는 **폐기**(시트 전체 덮어쓰기 = 테넌트 1개당 전용 시트 1개 가정). 그래서 [sheet-tabs.ts](src/features/exports/math-timetable)·그 테스트 **삭제**(dead). `syncSheetsNow` caller도 토큰 인자 제거. 같은 시트를 두 테넌트/두 앱이 가리키면 서로 덮어씀 — **전용 시트 필수**.
- 검증: typecheck0/lint0(신규0)/**test518**/build보류(실행 중 dev 서버 .next 충돌 회피, typecheck로 커버) + **실 push E2E 완료(2026-06-29, 사용자 시트)**: 원장이 빈 시트(`[Eywa] 수학 시간표`) 생성→SA 편집자 공유→연동 탭 ID 등록→sync_enabled ON. **앱 '시트' 버튼 클릭→syncSheetsNow→overwriteMathTimetableSheet** → "시트에 반영됨" + 시트 modifiedTime 갱신 + **14탭(통합+강사12+_meta)·메인 A1 실데이터** 되읽기 확인 + `last_synced_at` 기록·`last_error` null. getServiceAccountEmail=FIREBASE키 재사용도 라이브 증명(GOOGLE_SERVICE_ACCOUNT_KEY env 없이 동작). ⚠️ 사람이 만든 시트가 SA에 공유돼야만 가능(SA 용량0=생성 불가)·시트는 전체 덮어쓰기.

### 시간표 기본뷰 평일 1시간 수업 = ijw식 4그룹 풀높이 셀 + 폭 3개(웹·엑셀·시트) 통일 (2026-06-29) — ✅ 게이트 그린 + 라이브 검증
사용자 제보: 평일 1~4교시가 2시간 그룹 1칸이라 **1-2·2-1 등 1시간만 하는 반(예 JJ2A=15:25~16:20)을 어떻게 표시**할지 + 가로폭 3개 통일.
- ⚠️ **방향 정정(시행착오 기록)**: 처음엔 "8서브행(1-1..4-2)으로 쪼개 1시간 수업=반쪽 행" 구현 → **반쪽 행(165px)이 너무 작아 학생 9~10명이 안 들어가는** 실문제(사용자 제보, screenshot 대조). → **ijw 실제 방식으로 복귀**: 평일은 **4그룹 행 유지 + 셀 풀높이**. 1시간 수업도 그룹 셀에 **풀높이 카드**(학생 공간 충분), **서브슬롯은 헤더 시각**("15:25~16:20")으로 구분. periods.ts의 split 인프라(`opts.split`·`mathSubSlotRows`·`PeriodRow.group`)는 전부 제거(되돌림).
- **렌더(weekday-group-tables.tsx)**: rows=4그룹(`subjectPeriodRows`), 셀은 `slotPeriodRow`(그룹키)로 모은 슬롯을 `mergeSlotsByClass`로 반별 카드화 → 단일 반=풀높이 1카드, **1-1/1-2가 서로 다른 반이면 2카드 적층**(ijw "상단 수업명 반 분할"과 등가). `computeBlocks`가 그룹간 연속·인접요일 rowSpan/colSpan 병합. 검증(라이브): 4그룹 행·JJ2A(1-2) rowSpan=1 **풀높이에 학생 10명 전부 렌더**·시각 15:25~16:20 표시.
- **폭 통일(스프레드시트=기준)**: 실측(Sheets API) 컬럼폭 **교시 79px·요일 51px** → 웹 `PERIOD_COL_W 92→80·DAY_COL_W 150→60`(51에서 가독성 위해 +9)·수/주말 2배(120)로 맞춤. 스프레드시트=엑셀 익스포터 xlsx 변환이라 거의 일치.
- **요일 헤더에 날짜(스프레드시트→웹 역이식, 2026-06-29)**: 기본뷰 요일 헤더가 "월"만 보이고 날짜가 없었음(엑셀 익스포터는 이미 날짜 포함) → page가 `weekMonday`(조회 주 월요일)를 WeekdayGroupTables에 전달, 순수 헬퍼 `dayDateLabels`(UTC 롤오버 안전)로 요일별 "M/D" 계산 → 헤더에 "월 6/29 / 목 7/2"(평일·주말 모두). 주간 이동(타임머신)하면 그 주 날짜로 갱신.
- **학생 행 ijw식(가독성)**: 52px라 기존 justify-between은 이름이 먼저 잘림 → **"이름/학교학년" 한 줄 truncate(이름 우선, 메타가 뒤에서 잘림)**로 전환([class-cell.tsx](<src/app/(shell)/timetable/_components/class-cell.tsx>) StudentRow/DraggableStudentRow). 메타는 **`formatSchoolGrade(...,{numberLast:true})`**로 압축("경명중"+"중1"→**"경명중1"**, exports/math-timetable/student-format.ts 재사용). 좁아도 이름 노출·전체정보는 hover.
- 검증: typecheck0/lint0(신규0)/**test518** + 라이브(PSS, localhost:3001): 4그룹 행·JJ2A(1-2) 풀높이 학생10명·폭 80/60·요일 날짜(월 6/29)·학생 이름 정상 표시 스크린샷 확인. ⚠️ build 보류(실행 중 dev 서버 .next 충돌 회피, typecheck 커버).
- **헤더 분할(ijw식 빈 서브슬롯 밴드, 2026-06-29 후속)**: 시각 라벨만으론 1-2를 한눈에 못 본다는 제보 → [class-cell.tsx](<src/app/(shell)/timetable/_components/class-cell.tsx>) `ClassCell`에 **`subSlot` prop**(top/bottom/full) 추가. bottom(1-2만)이면 헤더 **위에 빈 1-1 밴드**, top(1-1만)이면 헤더 **아래 빈 1-2 밴드**를 26px로 그려 "어느 칸 수업인지" 시각 표시(**학생 영역은 풀 유지** — 밴드는 26px만 차지). `subSlot`은 weekday-group-tables `subSlotOf(card,config,rowKey)`가 그룹 g의 서브슬롯 시각(2g-1 끝/2g 시작) 대조로 판정. 검증(라이브): JJ2A(1-2) 헤더 위 빈 밴드 + 학생 10명 전부.
- **셀 시각 텍스트 삭제 + hover 라벨 통일(2026-06-29 후속, 사용자 요청)**: 셀 헤더의 "15:25~16:20"은 hover 카드에 이미 나와 중복 → 셀에선 제거(이름+인원+강의실만). hover 정보카드([hover-cards.tsx](<src/app/(shell)/timetable/_components/hover-cards.tsx>) `StudentInfoCard`) 학교·학년도 셀과 동일하게 **`formatSchoolGrade(numberLast)` 압축**("초6 · 칠성초"→**"칠성초6"**).
- ⚠️ **트레이드오프**: 60px라도 평일 칸은 학생 메타(학교)가 잘림(이름 우선) — 수/주말 120px 칸은 "이름/경명중1" 다 보임. 통합뷰는 의도적으로 4그룹 유지(subSlot 미전달=헤더 분할 없음). + owner 연동 탭(`?tab=sheets`)도 전체폭 2열로 넓힘. ⚠️ 한 강사 셀에 1-1·1-2 서로 다른 반이면 2카드 적층(ijw 동일, genuine 2반 케이스).

### 운영 적합성 하드닝 — 블로커 B1~B6 + 강사 시간표 스코핑 (2026-06-25) — ✅ 게이트 그린 + 라이브 검증
ijw↔eywa 크로스검증(둘 다 Chrome MCP) + 15에이전트 운영적합성 감사([[project_operational-readiness-verdict]]) 결과,
코어(RLS 격리·접근제어·돈 계산·스케일)는 프로덕션급이나 실학원 end-to-end를 막는 **블로커 6 + 멀티스태프 PII 1**을 수정.
항목별 게이트(typecheck0/lint0). **test 470→480**(generate 폴백 10), **test:rls 4**(신규), build✓.
- **관측성 단일 진입점**(B3): 신규 [`reportError`/`reportWarning`](src/lib/observability/report-error.ts)(외부 서비스 0, 구조화 JSON→Vercel 로그 grep) +
  [`src/instrumentation.ts`](src/instrumentation.ts)(Next16 `register`=zod env 검증[코어4 hard-fail·권장 WARN] + `onRequestError`=서버에러 중앙 캡처).
  **소비처**: 웹훅 background write ~7곳(`route.ts` `runWrite`로 래핑→`{error}` 검사·로깅), generateJSON 폴백 로그, cron 회수 로그.
- **AI provider 폴백**(B1): [models.ts](src/lib/ai/models.ts) `resolveModelChain`(키 있는 provider 정렬) + [generate.ts](src/lib/ai/generate.ts) `generateJSON`이
  **체인 루프**로 호출 → 401/403/429면 다른 provider 자동 재시도(무효·만료 키도 회복; 기존엔 무효 키가 첫 provider에 고정). 그 외 오류는 즉시 한글화 throw.
- **웹훅 URL 중앙화**(B6): [`getAppUrl`/`getAssemblyaiWebhookUrl`](src/lib/config/app-url.ts) — `eywa-alpha.vercel.app` 조용한 하드코딩 폴백 제거,
  미설정 시 명확 throw. 3흐름(meetings/enrollment/consultations) 4곳이 이 헬퍼 사용. `.env.local.example`에 `NEXT_PUBLIC_APP_URL` 명시.
- **멈춘 전사 복구 cron**(B2): [`/api/cron/reconcile-transcriptions`](<src/app/api/cron/reconcile-transcriptions/route.ts>)(`CRON_SECRET` Bearer 게이트) +
  [vercel.json](vercel.json) `0 18 * * *`(매일 1회 — ⚠️Vercel **Hobby는 cron 일 1회 제한**이라 `*/15`은 배포 거부됨; 더 빠른 회수는 Pro 업그레이드나 외부 스케줄러로 라우트 호출).
  3테이블 `processing_status IN (uploaded/transcribing/analyzing) AND updated_at<now-30m` → `failed`+안내(명시 실패→사용자 retry 유도). **라이브 E2E**: no-auth 401 / secret 200 `reconciled.meeting_minutes:1` / 멈춘 행→failed.
- **강사 `/timetable` 스코핑**(intra-tenant PII): [queries.ts](src/features/timetable/server/queries.ts) `getWeeklyScheduleWithStudents(teacherId?)` — teacher면
  `getTeacherScope().classIds`로 슬롯 필터. [page.tsx](<src/app/(shell)/timetable/page.tsx>)가 `requireAccess` 반환 user로 teacherId 전달. [teacher-menu](src/components/teacher-menu.tsx) 시간표 링크 복원.
  **라이브 E2E**: 박지훈 영어뷰 48슬롯/489 (영어 칩만, 본인만) vs master 371슬롯/2470(3과목·전강사) — 누수 차단 확인.
- **DB 프로비저닝 일원화**(B4): [`scripts/apply-all-alphas.ts`](scripts/apply-all-alphas.ts)(`pnpm db:alphas`, 멱등·사전순 54파일) — 신규 DB는
  `db:migrate && db:alphas`. `0019a`(dropped `scenarios`)는 존재 가드로 no-op화. README §3/§4/§5 갱신(0050a~0053a 추가).
- **RLS 격리 회귀테스트**(B5): [`tests/integration/rls-isolation.test.ts`](tests/integration/rls-isolation.test.ts)(`pnpm test:rls`, [vitest.integration.config.ts](vitest.integration.config.ts)) —
  2-테넌트 throwaway + `set local role authenticated`+JWT claim으로 실제 RLS 발동. 본인 테넌트 1·타 테넌트 0 검증. 기본 `pnpm test` 미포함(DB 없는 CI 안전).
- ⚠️ **사용자 ops(코드 불가)**: Vercel `UPSTAGE_API_KEY` 교체, 카카오 비즈채널·SOLAPI(알림톡), `CRON_SECRET` 프로덕션 설정. 학부모 메시징 실발송·대시보드 강사 스코핑은 후속.

### 인쇄 플로팅 창+A4 표준 / 교재요청서 / 교재 3체크 / 지출 미리보기 / 계산기 / 배선 감사 (2026-06-24) — ✅ 게이트 그린(시각검증 사용자 몫)
사용자 연속 요청 묶음. 전부 typecheck0/lint0/라우트307. ⚠️ Chrome MCP 미연결 → **시각 인쇄/렌더 검증은 사용자 확인 필요**.
- **인쇄 = 플로팅 창 + A4 표준**(핵심): 인쇄 버튼 있는 모든 곳을 새 탭이 아니라 **플로팅 창**으로 연다. 신규
  [`usePrintWindow`/`PrintWindowButton`](src/components/workspace/print-window.tsx)(창 id `print/<type>/<id>` + ROUTE_WINDOW_SIZE `print/<type>` A4 등록 —
  windowIdForHref 파생 id는 longest-prefix 미스로 DEFAULT 480×560로 떨어지므로 명시 id 필수). 진입점 라벨="인쇄 미리보기"(창 띄움),
  창 안 window.print()="인쇄". 닫기는 embedded(x-embed 헤더)면 숨김(창 X). **세부 규약·5체크는 디자인 시스템 "인쇄(Print)" 섹션 참조.**
  - A4 클리핑 근본픽스(globals.css `@media print`): 셸/임베드 `<main h-screen overflow>`가 인쇄 시 문서를 한 화면 높이로 잘라
    2페이지째(환불 규정 등)가 사라지던 것 → html/body/main `height:auto`·`overflow:visible` 리셋. 전역 landscape @page(시간표용)는
    유지하되 세로 문서는 `print-portrait` 클래스로 opt-in(@page portrait-doc). **통짜 break-inside-avoid 금지**(섹션 통째 밀림→행 단위).
  - 인쇄 공간 압축: `.quote-doc`(수강료 안내문)·`.meeting-doc`(회의록) 스코프 CSS로 글씨·패딩·여백 대폭 축소(빈 견적/적은 회의도
    2페이지 넘던 것 1페이지화). 회의록 인쇄에 **전사 생략 토글**. 화면은 무영향.
- **교재요청서**(ijw `TextbookPreviewCard` 이식, `(print)/textbook/[id]/print`): serif·가운데정렬·외곽2px/내부1px 카드 + PNG(html2canvas, oklch
  회피로 inline hex)·인쇄. **학원설정 billing.account(은행/예금주/계좌) 5단계 배선** → 카드 계좌 자동표시(데모 계좌 세팅됨).
- **교재 상태 = ijw식 3개 독립 체크(등록/주문/납부)**(5단계 드롭다운 폐기, 0051a `registered_at`+`status_by_name/status_at`): 각자
  타임스탬프 + 마지막 변경자·날짜. flex-wrap으로 좁은 창 자동 2행. [toggleTextbookCheck](src/features/billing/server/textbook-actions.ts).
- **지출 증빙 첨부 썸네일 미리보기 + 라이트박스 확대**(signExpenseReceipts 일괄 서명). 회의 목록 카드 요약 길면 hover 전문.
- **수강료 계산기**: 교재/기타 picker에 **교재 단가표(146권) 연동**(교재명 검색)·필수항목 빨간 `*`·교재/기타 에디터 라벨.
- **비활성 버튼 필수 `*` 전수 sweep**: 실게이팅 3곳(계산기·학생/시간표 엑셀 import)만 적용, 6곳 skip(사유 기록).
- **배선 orphan 전수 감사**(멀티에이전트 + 수동 적대검증): **나가리되는 user-facing 기능 0건**. dead code(미사용 shadcn 5·죽은
  컴포넌트 StudentQuickPanel/Popover·죽은 액션 endEnrollment/recomputePrimaryTeacher·write-only `textbook_orders.notes`)만 발견.
  ⚠️ **CLAUDE.md "student-quick-panel 모바일 peek 폴백 잔존" 메모는 stale**(실제 미연결). 정리는 백로그.
- **신규 [`docs/audit-log.md`](docs/audit-log.md)**: 검토 항목 체크오프(이중검토 방지). 필수* sweep 8폼 판정 + 배선 감사 결과 기록.
- **후속 1 — 교재 메모 orphan 복구**: `textbook_orders.notes`가 입력만 받고 어디서도 표시 안 되던 write-only 갭 → 목록 행 "메모:" 표시 + 수정 prefill(round-trip).
- **후속 2 — dead code 정리**(audit 백로그): 미사용 shadcn 5(tabs·checkbox·badge·card·table)·죽은 컴포넌트 2(StudentQuickPanel/Popover)·중복
  액션 1(`endEnrollment`, `endSingleEnrollment`가 실사용) 제거. `recomputePrimaryTeacher`는 유용한 미배선 유틸이라 유지.
- **후속 3 — AI 보고서 섹션 인라인 수정(회의록 + 등록상담)**: staff가 인쇄/공유 전 AI 오류를 직접 교정. 섹션 hover→수정→textarea→저장,
  해당 섹션만 jsonb 머지(다른 섹션 보존) + 마지막 수정자·시각. 상단에 "OOO님 수정·시각".
  · 회의록: `ai-report.tsx` 아코디언, `updateMeetingReportSection`(0052a `ai_report_edited_by/at`).
  · 등록상담: `consultation-report-editor.tsx` 카드 12섹션, `updateConsultationReportSection`(0053a `report_edited_by/at`).
    `print_payload.audioReport`를 머지 — **동결 스냅샷이지만 명시적 교정 허용(사용자 선택 A)**. ⚠️ 명시적 "재분석"을 누르면 같은
    model_version 행이 덮어써질 수 있음(재분석은 명시 버튼이라 인지됨). ⚠️ 데모에 분석행 0개라 검증용 테스트 audioReport 1행 시드(상담 d6126902).
  pnpm build 게이트도 통과(4게이트 그린, 인라인수정·dead code 정리 전 기준 — 변경은 모두 typecheck0/lint0/라우트307).
- ⚠️ **남은 후속**: ① 시각 인쇄 검증(방향·크롬제외·페이지수, Chrome MCP 미연결) ② 인라인수정·정리 후 `pnpm build` 재확인(dev 점유 시 보류).

### 강사 경험 대규모 보강 — onescreen 데모 → 실작동 + 강사 스코핑 + 허브 (W1~W3, 2026-06-24) — ✅ 브라우저 E2E
owner 쪽이 ijw 패리티로 대거 채워지는 동안 강사(teacher)는 `/onescreen` 한 화면뿐이고 그마저 **하드코딩 데모**였다.
멀티에이전트 강사경험 갭 감사(8영역 60건) → **제품결정: B(원스크린 전문화 허브)** 선택(사이드바 복원 A·하이브리드 C 대신,
"강사=원스크린 전용" 기존 정체성 유지). W1(데모→실데이터)·W2(스코핑+내비)·W3(허브 깊이) 완료.

**W1 — onescreen 데모 → 실데이터 작동 도구:**
- **데모 강사 실데이터화**: `teacher@ijw-demo.com`(박지훈)은 seed 계정이라 POC 564명 데이터의 반에 담당이 0개였다 →
  `scripts/_poc_migration/assign-demo-teacher.cjs`(멱등)가 **teacher 없는 english 반 6개(학생 61명, mon~fri 분산)** 배정.
  ⚠️ **비파괴**: null-teacher 반만 대상 → 기존 POC 강사·병렬 owner 세션 무영향(남의 반 안 뺏음).
- **실데이터 로더**([onescreen/server/roster.ts](src/features/onescreen/server/roster.ts)): `getCurrentUser` → 강사 본인의
  **오늘 요일 담당 반 → 활성 수강생** 조회(강사 스코프=누수 없음, fetchInChunks). 오늘 수업 없으면(주말) 전체 담당 반 폴백.
  `DEMO_ONESCREEN` 하드코딩 제거([page.tsx](<src/app/(shell)/onescreen/page.tsx>)). 날짜·학년필터칩도 실데이터 도출.
- **과목 인지 진도 입력**: onescreen UI가 math 커리큘럼(757줄 `curriculum.ts`) 전용이었다 → 박지훈은 영어라 빈 드롭다운.
  `Subject.subjectKey` 추가 → `progress-card`가 **math=커리큘럼 드롭다운 / 그 외=freeform 텍스트**로 분기(미지정=데모=math 보존).
- **보고서 DB 저장**(D3): 발송이 토스트 목업이었다 → [server/actions.ts](src/features/onescreen/server/actions.ts) `saveLessonReport`가
  `lesson_reports`(0049a)에 INSERT(진도·시험·과제·강사·본문, source='onescreen') + **강사 스코프 가드**(담당 반 학생 아니면 거부).
  메시징/PDF 발송 연동은 후속(토스트도 정직하게 "저장됨, 발송 연동 준비 중"). ⭐ lesson_reports는 시간표 hover "[진도]" 소비처와 동일 → 통합.
**W2 — 강사 데이터 스코핑(E2 보안) + 미니멀 셸 '내 메뉴' 드롭다운(F2):**
- ⚠️ 갭: 강사는 메뉴에 scoped 권한이 있으나 (1) 쿼리에 강사 필터가 없어 URL로 가면 **테넌트 전체가 보임**(intra-tenant 누수)
  (2) 미니멀 셸에 내비가 없어 도달 불가. 둘 다 해소.
- **공유 헬퍼** [`src/lib/auth/teacher-scope.ts`](src/lib/auth/teacher-scope.ts)(React cache): 강사 담당(`classes.teacher_id`) →
  `classIds`·`studentIds`·`subjects`. **각 목록 쿼리가 자체 스코프**(호출부가 빠뜨려도 `systemRole==='teacher'`면 좁힘=fail-safe).
- **스코핑 적용 5 feature**: students(목록+Stat) · classes(목록+Stat) · attendance(반selector + URL classId 가드) ·
  consultations(목록+Stat+학생드롭다운) · exams(담당 **과목** 기준 — exams엔 teacher_id 없음). 검증: 박지훈 학생 524→**61**.
- **`TeacherMenu`** 드롭다운([teacher-menu.tsx](src/components/teacher-menu.tsx), layout 강사 헤더): **스코핑 완료 페이지만** 노출
  (원스크린·내 학생·출석부·내 수업·성적관리·학생상담 6링크). ⚠️ 미스코프(시간표·대시보드·retention)는 누수 방지로 **제외**.

**W3 — onescreen 허브 깊이(B2):**
- [`hub-bar.tsx`](src/features/onescreen/components/hub-bar.tsx): **통계 4카드**(오늘 학생·진도확정·테스트입력·보고서발송, 클라 state 도출)
  + **오늘 수업 위젯**(roster가 오늘 담당 반·시작시각·인원 반환 → 시각순 칩). 강사가 "오늘 누구·몇 반·언제"를 한눈에.

- **검증**: typecheck0/lint0(신규0)/test441 + **브라우저 E2E**: W1(실학생 51명/오늘 수요일/영어 freeform → 보고서 DB저장
  "권나연·영어 Unit8·박지훈"·발송완료 pill) · W2(학생 61 스코프·내메뉴 6링크) · W3(통계4·오늘 수업 5개 14:20~18:20 시각순)·콘솔에러0.
- **남은 후속(저우선)**: 시간표 스코핑(복잡 — onescreen 오늘일정 위젯이 대체) + exams 디테일 스코핑 + 강사 셀프 급여(/my-payroll,
  데모 급여설정 부재로 임팩트 작음) + 과목별 보고서 스키마(`lesson_reports.subject`) + 카톡/문자/PDF 실발송 연동.

### 등록상담 상세/타임라인 가독성 — 화자구분·전사접힘·AI불릿·월픽커 (2026-06-24) — ✅ 실브라우저 + 멀티에이전트 리뷰
사용자 요청 4건(타임라인 월 점프 / 전사 기본접힘 / 전사 화자 상담자·학부모·학생 구분 / AI 분석 줄바꿈·강조).
- **타임라인 월 픽커**: [timeline-view.tsx](<src/app/(shell)/students/[id]/_tabs/timeline-view.tsx>) 가운데 월 라벨을
  `SearchableSelect`(드롭다운 규약)로 교체 → 아무 달이나 바로 점프(◀▶는 유지). 실검증: 7개월 목록·4월 클릭→점프.
- **전사 화자구분 + 기본접힘**: 회의록 전용이던 `TranscriptSection`을 **공유 컴포넌트**로 추출
  ([src/components/transcript-section.tsx](src/components/transcript-section.tsx), 구조적 utterance 타입 `{speaker,text}` —
  meetings·enrollment 둘 다 만족). 기본 접힘(🎤 클릭 펼침)·발화 60개 캡·"+N개 더보기". **화자→역할**은 웹훅 13섹션
  콜에 `speakerRoles` 추론 추가([route.ts](<src/app/api/webhooks/assemblyai/route.ts>) handleConsultation, A/B→상담자/학부모/학생,
  `print_payload.speakerRoles` 별도 저장 — audioReport는 13섹션만, destructure로 분리). 쿼리가 `speakerLabels`(Array.isArray
  가드)·`speakerRoles` 노출. 역할맵 없으면 "화자 A/B" 폴백. 실검증: [상담자]/[학부모] 라벨 렌더.
- **AI 분석 가독성**: 신규 [RichText](src/components/rich-text.tsx)(서버컴포넌트 가능·hook無·dangerouslySetInnerHTML無=XSS안전)가
  `\n`·불릿마커·`**강조**`를 안전 렌더. ⚠️ **solar-pro3가 줄바꿈/불릿 프롬프트 지시를 무시**(쉼표 run-on 반환)하므로
  프롬프트에만 의존 안 함 — 리스트형 섹션(걱정/질문/요청/특이/대응/세일즈/합의/후속/주의)에 `bulletize` 주면 RichText가
  **괄호 인식 쉼표 분할**(`splitTopLevelCommas`, "(숙제 부담, 문법)" 같은 괄호 안 쉼표 보존, Vitest 4)로 불릿화 → 모델
  비협조와 무관하게 동작. 산문 섹션(상담성격/가정배경/만족도)은 문단. 웹 상세 + **인쇄 페이지**(`(print)/enrollment/[id]/print`) 동일 적용.
- **멀티에이전트 리뷰 적용**: 적대 리뷰 워크플로(차원별 find→검증, 29 에이전트) → 실결함 6건 픽스(강조 정규식 non-greedy·
  RichText 빈입력 가드·speaker_labels Array.isArray·studentTraits/teacherResponse 불릿추가·audioReport에서 speakerRoles 분리·
  인쇄 RichText 통일). 나머지 findings는 "정상 확인".
- 검증: typecheck0/lint0/**test445**(rich-text 4 추가) + 실브라우저(월픽커 점프·전사접힘+[상담자]/[학부모]·AI 52불릿/산문 분류·콘솔0).
- **후속(사용자 피드백)**: ① AI 분석이 "너무 나열형·영역구분 안 됨" → 12섹션을 각각 **이모지 헤더(🧭🏠😟❓🙋😊🎒🧑‍🏫💡🤝📞⚠️) + 테두리 카드**로
  분리(회의록 패턴, `ConsultationReportPanel`). ② 과목별 점수 **영어 라벨이 raw 키**(academyHistory·learningProgress 등)로
  뜨던 것 → `subjectLabelMap`이 `COMMON_FIELDS`(form-config export) 라벨을 항상 포함해 한글화(영어는 ENGLISH_GROUPS에 공통필드가 없어 폴백됐던 것).
- **후속2(사용자 피드백)**: ① 헤더 **수정 버튼 2개**(전체 편집 `/edit` 링크 + ConsultationManageButtons 모달) → 모달 quick-edit
  제거하고 **전체 편집 페이지 하나로 통일**. ② 헤더 **배지 2개**(outcome "AI 완료" + processing "완료") → `PROCESSING_BADGE.completed=null`로
  중복 배지 숨김(진행 중·실패만 표시). ③ **좌우 카드 스타일 통일** — 공용 `Card`를 단일 박스(이모지+굵은 라벨 헤더, 별도 음영 바
  제거 → "이중 박스"감 해소)로 바꾸고 좌측 정보 카드(🙋📚📇🧑‍🎓📊)·우측 AI 섹션 모두 동일 스타일 사용(17개 카드 동일 클래스 확인).
- **후속3(IA 정리, 사용자 피드백)**: 우측만 "상담 AI 분석" 제목이 있어 좌우 비대칭이었음 → **좌측에 "상담 기록" 제목 추가**(우측과 대칭).
  좌측=**상담 기록(입력)**=학부모 QR 제출/상담사 입력/AI 자동입력이 함께 채우는 한 기록, 우측=**녹음 분석**(13섹션 + 전사). 입력 데이터인
  **과목별 점수를 우측(분석)→좌측(입력)으로 이동**(좁은 컬럼 맞춰 단일 컬럼). `from_public_intake`면 상담 기록 헤더에 **"학부모 직접 제출" 배지**.

### 음성 파이프라인 복구 + 등록상담 폼 자동입력(ijw 패리티) (2026-06-23) — ✅ 실 ijw 녹음 E2E
사용자 요청: 상담/등록상담의 **녹음→전사→분석**이 실제 작동하는지 점검 + 등록상담은 ijw처럼 **전사 분석으로
폼 내용까지 자동입력**되는지. ijw Firebase Storage의 **실제 등록상담 녹음**(이윤건 19분/17.7MB,
`registration-recordings/`, serviceAccount `D:\ijw-calander\serviceAccount.json`, 버킷 `ijw-calander.firebasestorage.app`)을
eywa 파이프라인에 그대로 흘려 E2E 검증.
- **🐛 전사 전면 차단 버그 발견·수정**(`4c42531`): [assemblyai.ts](src/lib/ai/assemblyai.ts) `submitTranscript`가
  **폐기된 `speech_model: "universal"`** 사용 → AssemblyAI가 이제 **HTTP 400 거부** → eywa의 **모든 전사
  (회의·등록상담·학생상담, submitTranscript 공유)가 깨져 있었음**. `speech_models: ["universal-3-pro","universal-2"]`로
  교체(ijw functions/index.js와 동일). 실 19분 녹음 → **7,866자 한국어 전사 복구 확인**.
- **⚠️ 웹훅은 프로덕션에서 실행됨**(`NEXT_PUBLIC_APP_URL` 미설정 → 폴백 `eywa-alpha.vercel.app`). 즉 로컬에서
  녹음해도 AssemblyAI 콜백은 **프로덕션 웹훅**으로 가고 같은 Supabase DB에 결과를 쓴다(시크릿 일치 확인). 그래서
  위 "학생상담 AI 녹음"의 "localhost 웹훅 미도달" 메모는 **부정확**. **단 프로덕션 Vercel의 `UPSTAGE_API_KEY`가
  무효(401)** → 분석이 프로덕션에서 401로 실패(전사는 성공). **운영 조치 필요: Vercel env UPSTAGE_API_KEY 갱신.**
  (로컬 키는 유효 → 로컬 dev 웹훅으로 분석 완주 검증.)
- **등록상담 폼 자동입력(ijw `processRegistrationRecording` 패리티)**: 기존엔 13섹션 분석을 읽기 패널로만 보여주고
  기본 4필드만 자동입력. 이제 **전용 폼 추출 콜**([form-extract.ts](src/features/enrollment/server/form-extract.ts),
  13섹션과 `Promise.allSettled` 병렬)이 학교·학년·보호자·관계·성별·생일·주소·상담경로·진로·형제·셔틀·등록상태·과목·
  학부모요구·이전학원/최근성적/약점(learning_history)·후속조치·**과목별 점수(subject_details)**를 추출 →
  순수 [form-fill.ts](src/features/enrollment/form-fill.ts) `buildFormPatch`가 **빈 필드만** DB 패치로 매핑(수기 입력
  보존, 정적 enum 검증, Vitest 13). 웹훅 [handleConsultation](<src/app/api/webhooks/assemblyai/route.ts>) 배선.
  실검증(이윤건 녹음): `subject=english`·`parent_request`·`learning_history{prevAcademy,lastScore,weakSubjects}`·
  `siblings`·`gender`·`follow_up_content`·`subject_details{math,english}` 자동입력 → 상세 폼 카드에 렌더.
- **AI 키/인증 오류 한글화**([generate.ts](src/lib/ai/generate.ts) `rethrowAi`): generateJSON이 401·403·429를
  관리자가 알아볼 한글 메시지로 throw("AI 키 오류: … 관리자가 키를 확인·갱신")→ processing_error에 영문 원문 대신
  조치 가능한 메시지. (silent provider 폴백은 의도적 미추가 — 키 무효는 표면화돼야 관리자가 고친다.)
- 검증: typecheck0/lint0(신규)/**test441**(form-fill 13) + 실 ijw 녹음 E2E(전사 7866자·13섹션·폼 자동입력 DB영속).
  ⚠️ 브라우저 시각검증은 dev 재시작 후 웨일 확장 연결 끊김으로 미캡처(데이터 레이어·서버 200으로 검증). 테스트 행
  `7149e772`(이윤건)는 데모 DB에 잔존(실 PII — 정리 대상).

### ijw→eywa 갭 전수 재비교 + Tier 1 이식 6건 (2026-06-22) — ✅ 게이트 그린 + 실검증
ijw-calander ↔ eywa 현행 전수 비교(멀티에이전트 32 — 16영역 비교+검증, 거짓양성 제거) → confirmed 107건을 우선순위
재분류(`docs/ijw-eywa-gap-2026-06-22.md`). "이미 구현(overstated 16)·의도적 제외 다수"를 빼면 진짜 이식 가치 ≈20건.
그 중 **Tier 1(작고 임팩트 큼) 6건 구현**(항목별 1커밋, 미push):
1. **등록상담 텍스트 검색**(이름/전화/학교) — 칸반만이던 enrollment에 `.or(ilike)` 검색(학생상담 패턴 이식, 학생id 조인 불요). 실검증 204→62.
2. **출석 매트릭스 셀 메모 입력** — 저장·표시는 기존, 팝오버에 메모 input + `setAttendanceCell` note 파라미터(상태와 함께 저장).
3. **반 색상 폼 배선** — `classes.bg_color/text_color`·시간표 통합뷰 소비처는 기존, 폼·createClass/updateClass 미배선이라 항상 과목색 폴백이던 것 연결. native color picker + text_color 휘도 자동(`color-utils.readableTextColor`).
4. **회의록 제목 인라인수정 / TXT 다운로드 / 음성회의록 다시분석** — `updateMeetingTitle` + 제목 편집기 / 8섹션·전사 평문 Blob(`MeetingTxtButton`) / 완료 음성건도 재제출 버튼(status 리셋→webhook 'completed' 가드 자연통과, 8섹션 재생성).
5. **수납 결제 상세 6필드**(결제수단·카드사·현금영수증·적립금·할인사유·청구일) — `0042a` alpha(invoices +6컬럼, dev적용, RLS 0004a 유지) + schema + createInvoice/updateInvoicePayment + 생성/수정 다이얼로그 + 표 결제수단 라벨. 실검증: card/신한 DB영속 + 부분납부 행에도 라벨.
6. **견적→청구 전환** — 계산기 견적(`tuition_quotes`, student_id 없음)에서 `create-invoice-dialog`를 청구액·메모로 prefill해 열고 학생은 picker로 선택(Option B 저위험, createInvoice 재사용·신규액션/마이그 無).
- 검증: typecheck0/lint0/test399/build✓ + 실브라우저(로그인, 항목1·5 E2E·항목3·4 렌더·콘솔0). 커밋 `0b4c1b7`~`1df1702`.
- ⚠️ 남은 갭: Tier 2(등록상담 테이블뷰·성적 목표설정/코멘트·출석 일별 미처리추적·퇴원 연락처/worklist·강사 인수인계·휴가 관리자대시보드·대시보드 30일추이)·Tier 3(학생상담 AI녹음·강의실 자동배정·엑셀 import마법사·시간표 시나리오). 의도적 제외(Calendar/Gantt/Chatbot/MakeEdu/Contracts)는 비이식. ⚠️ 공통UX 비교는 워크플로우 실패(플레이스홀더)·픽셀 시각비교 미수행 — 후속.

### ijw→eywa 탭별 이식 후속 — Tier 2·3 진행 + 스코프 결정 (2026-06-23)
사용자 상시 지시("모든 탭에 ijw 기능 한 탭씩 이식 + 브라우저/코드 점검을 스스로 끝까지, 10커밋마다 push")로 자율 진행.
- **Tier 2 완료**: 출석 일별 미처리추적(`89ecec1`)·대시보드 재원변동 드릴다운(`8f0383e`)·휴가 관리자대시보드 `/staff/leaves`(`a884749`)·성적 목표설정+학습코멘트(`03d7860`, 0043a)·등록상담 테이블뷰(`e0bf1d8`)·강사 인수인계(`9e8bb84`, 0044a). (+성적관리 시험범위·퇴원 연락처/worklist는 직전 배치.)
- **Tier 3**: ✅ **강의실 자동배정**(`9b6c3c0`, 순수 그리디 — 시간충돌회피+정원+균등분산, 마이그無). ✅ **엑셀 import**=학생 일괄등록(`1db514c`, ExcelJS 기설치 재사용)+시간표 enrollment import 기존.
- **⚠️ 스코프 결정(사용자 2026-06-23)**: **시간표 시뮬레이션(시나리오) = 영구 배제**(Calendar/Gantt/Chatbot/MakeEdu/Contracts와 동급 비이식). **Excel/스프레드시트는 내보내기·가져오기만 있으면 충분**(마법사·임의 컬럼매핑 불요). 현 커버리지: 학생(export+import)·시간표(export+import)·수납(export). 재무 import는 위험·ijw 미존재라 비이식.
- ✅ **학생상담 AI 녹음**(`4872931`, 0045a): eywa는 음성→전사→AI가 meetings·신입생 등록상담엔 이미 있었고
  재원생 student_consultations만 텍스트 전용이던 갭을 메움. enrollment 오디오 파이프라인(AssemblyAI·generateJSON·
  공용 웹훅·consultation-recordings 버킷·processing_status enum) 재사용 + student_consultations에 오디오/AI 컬럼 13개.
  공유 `consultations/server/ai.ts`(케어 7섹션) → 웹훅 handleStudentConsultation + 텍스트 액션 runStudentConsultationAnalysis
  단일 프롬프트. UI: 상세 녹음 패널(상태폴링·전사·7섹션·AI분석버튼) + 새상담 녹음/업로드 폼 + 목록 🎙️/AI 배지.
  ⚠️ (정정 2026-06-23) "localhost 웹훅 미도달"은 부정확 — 실제론 웹훅이 프로덕션으로 라우팅돼 작동하며, 당시 미검의
  진짜 원인은 `speech_model` 폐기 버그(전 전사 차단)였음. 위 "음성 파이프라인 복구" 섹션 참조(실 ijw 녹음으로 E2E 복구·검증).
- **⚠️ 스코프 결정(사용자)**: 시간표 시뮬레이션(시나리오) 영구 배제 / Excel은 export·import만(마법사 불요).
- **→ ijw 탭별 이식 Tier 1·2·3 사실상 완료**(의도적 제외 = Calendar/Gantt/Chatbot/MakeEdu/Contracts/시간표시나리오).
- 검증: 항목별 typecheck0/lint0 + 신규 Vitest(classroom-assign 11·student-import 12, 전체 428) + Chrome(웨일) 실브라우저
  E2E(자동배정 적용→DB·재실행 수렴 / 학생 import 6행→신규3·DB영속 / 학생상담 AI 7섹션 실 generateJSON(solar-pro3)→DB영속).

### 등록 상담 폼 전체 + 학부모 QR 공개접수 (2026-06-23) — ✅ 실브라우저 E2E
사용자 요청: ijw 등록 상담 폼 전체 이식 + 학부모 QR → 공개 등록 프로세스. 둘 다 enrollment에 구현·검증.
- **등록 상담 폼 전체**(`9bead94`, 0046a): 6필드 → ijw 전체(메인 ~32 + 과목별 점수 탭). 메인은 enrollment_consultations
  컬럼, 과목 점수(수학 영역점수·영어 AI/NELT/EiE 레벨차트·국어/과학/기타)는 `subject_details jsonb`.
  데이터주도 [`form-config.ts`](src/features/enrollment/form-config.ts) + 공용 `consultation-full-form`(생성/수정, 섹션+과목탭,
  useSubjectMaps/useGradeLevels 단일소스) + `/enrollment/[id]/edit` + 상세 '학생 상세 정보'·'과목별 점수' 카드.
  ⚠️ create insert에 tenant_id 누락으로 RLS 거부되던 기존 버그 동시 수정(getCurrentUser().tenantId 명시).
- **학부모 QR 공개접수**(`f9d42f2`, 0047a): `intake_tokens`(테넌트별 공개 토큰, RLS) + enrollment_consultations
  from_public_intake/intake_token_id. 공개 라우트 `(intake)/intake/[token]`(proxy PUBLIC_PATHS, admin client로 토큰→테넌트
  해석) → 학부모 폼 → `submitPublicIntake`(비인증 admin client: 토큰검증·레이트리밋1h20·허니팟·정화·privacy필수) →
  enrollment_consultations(pending+from_public_intake). 관리 QR패널(/enrollment, 서버 qrcode SVG+공개URL) + 칸반 'QR' 배지.
  의존성 `qrcode` 추가. ⚠️ 공개 쓰기는 admin client + 검증된 토큰의 tenant_id만 사용(조작 불가).
- 검증(Chrome): 전체폼 생성→상세(과목점수95)→DB subject_details·tenant 영속→수정 round-trip / QR 토큰생성→/intake/{token}
  학부모폼→제출→성공→DB(pending·from_public_intake·tenant·token링크)+submission_count→칸반 QR배지. typecheck0/lint0/test428/콘솔0.
- **공개접수 서버검증 하드닝(2026-06-23, 멀티에이전트 보안감사 후속)**: `submitPublicIntake`가 비인증·admin client라
  `<select>`(클라 가드)를 우회한 직접 POST에 무방비였음 → **필수·화이트리스트 서버검증 추가**: 필수(보호자명/연락처/학교/성별/
  관계/상담경로/학년) 누락 시 거부 + 운영 enum(성별·혈액형·관계·상담경로=`form-config` 상수 / **과목·학년=토큰 테넌트의
  `getTenantSettingsByTenantId`+`buildSubjectMaps`**, 단일소스 대조)으로 대조해 설정 밖 값 거부, 선택값은 null. 실검증: 정상제출✓·
  변조 gender 거부(미저장)·무효 subject→null. + **카운터 정합**: `usage_count`를 제출 시가 아니라 공개 페이지 노출에서 +1해
  조회(usage)≠제출(submission) 분리(패널 "조회·제출" 정확). (테넌트 격리·RLS·토큰 위변조는 감사서 정상 확인.)
- **공개접수 운영 하드닝 A(2026-06-23, `0048a`)**: 신규 `intake_attempts`(ip_hash·ok·시각, RLS, 0048a) = **시도 기반
  다층 레이트리밋** 단일소스 → `submitPublicIntake`에 ① **time-trap**(폼 렌더 후 `MIN_FILL_MS`=3s 미만 제출 거부, no-DB
  선차단) ② **per-IP/per-tenant/per-token 슬라이딩 1h 한도**(상수 `IP_LIMIT`15·`TENANT_LIMIT`200·`TOKEN_LIMIT`60 —
  합법 오픈하우스 버스트 우선, 거부건도 시도로 기록해 자원소모 abuse 카운트, 기존 "consultations 행 카운트"는 제거) ③
  **env-gated Cloudflare Turnstile**(`TURNSTILE_SECRET_KEY`/`NEXT_PUBLIC_TURNSTILE_SITE_KEY` — 미설정=캡차 off=데모 무중단,
  설정 시 siteverify fail-closed; `turnstile-widget.tsx`). IP는 `parseForwardedFor`(키오스크 재사용) → **sha256(ip:tenant)
  해시만 저장(원본 IP 미보존)**. + `createIntakeToken` **기본 90일 만료**(미입력 시 영구 → +90d). 실검증(라이브 E2E):
  정상제출✓·time-trap 거부✓·per-IP 16번째 차단✓·기본만료 90일✓·캡차 스킵(키 없음)✓. ⚠️ Turnstile 실키 발급은 운영 몫
  (데모는 off 경로만 검증). 분산(다수 IP) 공격은 캡차가 주방어, 레이트리밋은 단일/소수 IP 백스톱.

### 시간표 셀 hover 정보 카드 — ijw 시간표 hover 이식 (2026-06-23) — ✅ 실브라우저(ijw 라이브 대조)
사용자 요청: ijw 시간표 마우스오버 정보를 "ijw와 동일한 정도까지" 이식. **ijw를 dev(3001)로 띄워 실제 hover를 관찰**
(학생 행 title = HTML title이라 DOM에서 직접 확인) → ijw 학생 hover 4줄 확정: **이름/학년·학교 · (반이동 날짜) ·
교재(학생별) · [진도] 날짜+내용**. (수업카드 헤더 툴팁은 ijw도 master 권한이라 억제 — 학생 title이 본체.)
- **hover 인프라**: [`hover-cards.tsx`](<src/app/(shell)/timetable/_components/hover-cards.tsx>) — `HoverCard`(커서 위치
  포털 fixed·z9999·pointer-events-none, overflow 컨테이너에 안 잘림, cloneElement로 트리거에 핸들러 주입) + `ClassInfoCard`
  + `StudentInfoCard`. 양 뷰(`class-cell.tsx` 기본 / `rich-card-group.tsx` 통합, 둘 다 client) 배선. WindowLink에
  onMouseEnter/Leave forward 추가.
- **데이터(추가 fetch 최소)**: 학생 식별·학년/학교·상태·신입/전입·분리등원·퇴원일·영문명은 이미 props(런타임 StudentLine 전체 도착).
  · **교재** = `textbook_orders`(이미 학생별, 실데이터 350행) 최신 1건을 시간표 쿼리가 배치 조인 → `StudentLine.latestTextbook`.
  · **진도** = 신규 `lesson_reports`(`0049a`, RLS) — **ijw Edutrix Supabase의 reports(별도 프로젝트, anon read 15,716건)를
    학생 이름 매칭으로 이식**([`scripts/_poc_migration/import-lesson-reports.cjs`](scripts/_poc_migration/import-lesson-reports.cjs),
    멱등 source='edutrix_import', 진도 있는 최신 1건/학생 → 289명 매칭·296행). 시간표 쿼리가 최신 1건 배치 조인 → `StudentLine.latestReport`.
- 수업 hover(ClassInfoCard)=수업명·과목(설정색)·담임·강의실(통합뷰 요일별)·시간·인원 / 미니그리드셀·강의실라벨=native title(풀 강사/강의실).
- 검증: typecheck0/lint0/test428 + 실브라우저(eywa 학생 hover에 "교재 초4-2 발전 2권(2026-06-15)" + "진도 2026-03-19·김민주 / 1.9까지의 수의 순서…" 렌더, ijw와 동일 형식).
- ⚠️ 남은 1줄 = **반이동 '날짜'**(eywa는 전입 배지만, enrollments에 전입일 추가하면 됨 — 소). 클래스 헤더 hover는 ijw(억제)보다 약간 더 보여줌(담임·강의실·인원, 무해).
- ⚠️ 진도 데이터는 **Edutrix가 진실** — Firebase/Edutrix 재이식 시 import-lesson-reports.cjs 재실행(멱등). ijw .env.local의 VITE_SUPABASE_URL/ANON_KEY 사용.

### 시간표 통합뷰 = ijw EnglishClassTab "반=열 리치 그리드" 충실 이식 (2026-06-22) — ✅ 데이터 백필 + 실검증
사용자 요청: ijw 영어 통합뷰(스크린샷)의 깔끔함을 **그대로 이식**. 영어는 한 수업 안에 (요일,교시)마다 강사·LAB가
다른 **여러 케이스**가 있어 요일×교시 미니그리드가 본질. (설계 변천: 전과목색오버뷰→단순카드그리드→**리치 그리드(최종)**.
앞 둘은 영어 데이터를 못 살려 폐기.) **결정적 발견: eywa 데모 데이터가 평면**이라(슬롯별 강사/강의실/영문이름 0건)
ijw 익스포트에서 **백필**해야 사진처럼 살아난다 → 백필 + 리치뷰 둘 다 구현.
- **A. 데이터 백필** ([`scripts/_poc_migration/backfill-english-slots.cjs`](scripts/_poc_migration/backfill-english-slots.cjs),
  멱등·`--apply`): ijw 익스포트(`D:\tmp\ijw-export-*.json`)의 `slotTeachers`(요일·교시별 강사·"LAB")·`slotRooms`·
  `bgColor`/`textColor`·학생 `englishName`을 자연키 매칭(반=class_name+subject 유니크 / 슬롯=day+start_time, 교시표는
  transform.ts와 동일 상수 / 학생=name+학교+학년)으로 eywa에 적재. **적용: slotTeacher 183·slotRoom 84·LAB 65셀·
  반색 52·영문이름 29, 매칭누락 0**(highmath→subject_1 별칭). ⚠️ POC IdMap 미영속이라 ijw id 직접매칭 불가 → 자연키.
- **B. 스키마(0041a)**: `class_schedules.slot_teacher_label`·`slot_room_label` 추가(dev적용). 영문닉네임("Hannah"/"Zoe")·
  "LAB"·"LAB실"은 `users.display_name`(한글)·classrooms FK로 못 풀어 **문자열 라벨로 보존**(셀 표시·해시색). NULL=반 기본 상속.
  (`classes.bg_color`/`text_color`·`students.english_name`은 기존 컬럼 — 백필만.)
- **C. 쿼리 확장** ([timetable/server/queries.ts](src/features/timetable/server/queries.ts)): `fetchSlots`가 슬롯 라벨 +
  반 색을, `getWeeklyScheduleWithStudents`가 학생 영문이름을 읽는다. `ScheduleSlot`에 `slotTeacherLabel/slotRoomLabel/classBgColor/classTextColor`,
  `StudentLine`에 `englishName` 추가(기본뷰도 더 정확해짐 — 폴백 동일이라 무해).
- **D. 리치 그리드 뷰**: 순수함수 [`class-grid.ts`](src/features/timetable/lib/class-grid.ts)(`buildRichCardGroups`/`teacherColor`,
  +test 6) → 서버 [`rich-grid-view.tsx`](<src/app/(shell)/timetable/_components/rich-grid-view.tsx>)(그룹 빌드·섹션헤더) +
  클라 [`rich-card-group.tsx`](<src/app/(shell)/timetable/_components/rich-card-group.tsx>)(DragScrollArea·좌측 sticky 라벨열·반=열·미니그리드).
  **시작 교시별 섹션**(평일 기준, 주말 전용은 "주말" 섹션 — 각 섹션은 그 섹션이 쓰는 교시만=visiblePeriods). 카드 = ijw 헤더색(`bg_color`)
  수업명 + 담임(반기본 ?? 최빈 슬롯강사) + **요일별 강의실**(`월수 본원304 / 목 LAB실·본원304`) + **요일×교시 미니그리드**(셀마다
  강사약칭(`slice(0,4)`)·강사해시색 / LAB=파란배지) + **재원/대기/퇴원** 3섹션(신입 빨강·전입 초록, 영문이름 `이름 (English)`).
  대기/퇴원 행높이는 그룹 내 max로 동기화(라벨열·전 카드 baseline 정렬). 읽기전용. 과목칩 양쪽 노출.
  - **server-only 금지**([[#61]]): class-grid.ts·rich-card-group.tsx(클라)는 server-only 미import. SubjectMaps(메서드 보유)는
    클라로 못 넘겨 → 서버가 `SUBJECT_SOFT[colorOf]` **plain 클래스 문자열**만 전달. teacherColor는 순수라 클라 import OK.
- **갭(가짜 없이 폴백)**: 담임 ijw "Hannah"(영문닉네임 FK미해결)→최빈 슬롯강사로 폴백. 합반(classGroupId)·영어 레벨배너 미이식(후속).
  강사 고정색 없어 이름해시. 슬롯 없는 반(고등E_고2 TOP 등)은 반기본강사 단색(수학과 동일).
- 제거: 직전 카드섹션 뷰(`class-columns.ts`·`class-column-view.tsx`).
- 검증: typecheck0/lint0/**test398**(class-grid 6)/build✓. **실브라우저**: 영어 통합뷰 46반·7섹션·LAB 65배지·강사셀(Kristine/Zoe)·
  영문이름(Willy)·요일별강의실(본원302·LAB실)·PJ2 헤더색#93c47d·콘솔0 / 수학 67반·5섹션·반강사 단색(슬롯데이터 없음).
- ⚠️ 후속: 슬롯 강사/강의실·영문이름은 **ijw 익스포트가 진실** — Firebase 전체 재이식 시 이 백필 스크립트 재실행(멱등). 합반·영어레벨 미이식.

### 쿼리 성능/정합 2차 — 멀티에이전트 전수 감사 + 측정 기반 픽스 6건 (2026-06-20)
대시보드 경량화에 이어 **전 feature 쿼리/페이지를 멀티에이전트로 전수 감사**(16 feature, 42 agent — 각 finding을
적대 검증) → "전건 fetch + JS 집계(PostgREST ~1000행 silent 절단, #54)"·"대량 `.in()`(414, #53)"·"직렬 await"를
21건 confirmed. **핵심 원칙(사용자 지침): 측정부터.** 감사가 "high"로 라벨한 다수는 **가설상 >1000행 미래 멀티테넌트**
기준이었다. 데모 DB 실측(1회성 count)으로 **지금 실제로 잘리는 것만** 골라냈다: student_consultations **1340**·
invoices 1606(단 월버킷 max 400=안전)·enrollments 1057/active 794·enrollment_consultations **204**(안전)·
attendance/date 9·max class 15. → 결론: **상담 통계만 현재 데이터로 실제 오출력**, 나머지는 방어/지연.
- **✅ 픽스(6건, 측정으로 선별)**:
  1. **상담 통계 2함수 → DB group-by RPC**(`0040a_consultation_stats_rpc.sql`, dev적용): `getConsultationByCategory`·
     `getConsultationTrend`([consultations/server/queries.ts](src/features/consultations/server/queries.ts))가 6개월
     student_consultations(1340행)를 전건 fetch→JS 집계해 **1000행에서 잘려 카테고리·추세 student 라인이 340행 과소집계**
     되고 있었다. `consultation_category_counts`/`consultation_monthly_trend`(security invoker + `auth_tenant_id()` 이중격리,
     0039a 패턴)로 무절단. 브라우저 검증: 차트 렌더·콘솔에러0·trend 바 높이 월별 실분포 반영(4월 343=최고).
  2. **classes `getClassesList` → `fetchInChunks`**: 활성 enrollment 전건 fetch(현 794, Firebase 이식시 >1000)를
     표시 반 id로 청크 조회(getClassesPage 패턴). 같은 함수 schedules `.in(classIds)`도 청크화. 브라우저: "등록 학생 794명"·반당 6명·129반 정상.
  3. **payroll 월 출석 → `fetchAllPaged`**: 활동 많은 강사(반 5+)는 월 출석 1000행 초과 가능 → 전건 fetch면 잘려
     **시간 과소합산=급여 과소지급**(돈 정확성). range 페이지네이션으로 전건.
  4·5·6. **직렬 await → `Promise.all`**: `getStaffList`(3쿼리 독립)·`getWithdrawalDetail`(2쿼리)·`getClassDetail`(2쿼리).
     출력 동일, round-trip 절감. 전 페이지 브라우저 렌더 검증(staff 39·classes·withdrawals·payroll, 에러0).
- **⚪ 의도적 지연(현재 데이터로 안 잘림 — 방어 백로그, Firebase 전체 이식 후 재점검)**: enrollment 대시보드 3함수
  (outcomeDistribution·conversionTrend·consultantPerformance — enrollment_consultations 204행이라 안전)·exams
  `getExamDetail`(시험당 소량)·attendance `getAttendanceForDate`(일자당 9)·매트릭스 `.in()`(반 최대 15명)·admin
  findDuplicateStudents(564<1000)·findOrphans `.in(129반)`·retention campaign-targets(소량)·billing(월버킷 400=안전)·
  students 반별 카운트 N+1(3~5쿼리, RPC 필요)·search 직렬 canAccessTenant(캐시됨, 이득~0). **새 코드는 #53/#54 헬퍼로 처음부터.**
- 검증: typecheck0 / lint0(신규0) / test392 / 브라우저 5페이지 렌더·에러0. 마이그 `0040a`(dev DB 적용, 손수 alpha).

### 같은 탭 다중 창(복제) + 크로스 창/탭 저장 경고 (2026-06-19) — ✅ 구현·검증·데스크톱 UI 확인 완료(main 머지)
**main 머지 완료**(브랜치 `feat/multi-window-and-save-warning` 삭제됨). 상세 함정·규칙은
위 "구현 중 막혔던 점 #64", 설계는 [`C:\Users\user\.claude\plans\steady-questing-music.md`](로컬, 미동기).
- **A. 같은 탭 다중 창**: 타이틀바 **복제 버튼**(현재 화면 그대로) + 탭/링크 **Shift+클릭**(`openNewInstance`, 새 인스턴스)
  — 둘 다. primary 창 id 보존(`route:students`), 복제본만 `#n`(window-only, 배경 가드 store레벨+드래그훅+스포트라이트).
  스위처·스포트라이트 `(2)` 라벨. 사이드바 관리자도구 아래 Shift 안내 문구. ([window-store.ts](src/components/workspace/window-store.ts)
  `windowId(...,instance?)`/`isDuplicate`/`baseWindowId`/`instanceLabel`/`duplicate`/`openNewInstance` + floating-window·app-sidebar·window-link·use-pointer-drag·background-drop-zone·window-switcher·spotlight-strip.)
- **B. 크로스 창/탭 저장 경고**: 레코드 스코프(`student:123`)+`BroadcastChannel`로 다중 창·다중 탭 동시 보호.
  publish는 **성공 확정 후**(update 액션 `redirect`→`{ok,redirectTo,nonce}` 반환, nonce로 연속 저장 구분),
  dirty는 **FormData 스냅샷**(버튼 변경 포착). 신규 [`record-channel.ts`](src/lib/realtime/record-channel.ts)·
  [`form-snapshot.ts`](src/lib/realtime/form-snapshot.ts)·[`use-concurrent-edit-guard.ts`](src/components/workspace/use-concurrent-edit-guard.ts).
  배선: 학생·반·직원 수정 폼 + 학원설정 section-form(scope·formRef·nonce effect).
- **검증**: typecheck0/lint0(신규0)/build✓/**test 392**(신규 19: window-store 12·form-snapshot 4·record-channel 3).
  **B 실브라우저 검증 완료** — 학생 수정 폼 clean=무경고/ dirty=경고 토스트(+새로고침), BroadcastChannel 배달·Toaster 마운트·콘솔에러0 확인.
- **✅ A 데스크톱 UI 실브라우저 검증 완료**(2026-06-22, preview 1280×900 + 로그인): ① 학생목록 일반클릭=단일 →
  Shift+클릭 2회 = `학생목록`/`(2)`/`(3)` 3창 ② primary를 **학생 상세로 드릴인 후 복제 버튼** → `학생 상세 (4)`가
  드릴인된 상세 URL로 열림(최초 목록 아님 — 검토① 확정) ③ 복제본 `(2)(3)(4)`는 "배경으로 보내기" 버튼 없음(window-only)
  ④ 사이드바 펼침 시 Shift 안내 문구(`<kbd>` 포함) 렌더. 콘솔에러0. (드래그-투-배경·스포트라이트 store 가드는 단위테스트.)

### 역할/권한 override 배선 전수 감사 + 보안 갭 수정 (2026-06-19) — ✅ 배선 완전, 갭 2건 처리
사용자 요청으로 owner "역할·권한"(Phase 4) override가 **실제 접근제어에 연결됐는지(write-only-orphan 아닌지)** 전수 검수
(다중 에이전트 + 직접 grep). **결론: 배선 완전 — 권한을 바꾸면 모든 소비처에서 동작이 실제로 바뀐다. orphan 0건.**
- **단일 진입점**: 하드코딩 `MENU_ACCESS`(기본) + `tenant_settings.data.permissions.overrides`(sparse) → `resolveMatrix()` →
  서버는 `getPermMatrix()`(React cache, [perm-matrix.ts](src/lib/auth/perm-matrix.ts)), 클라는 layout이 `resolveMatrix`로 prop 주입.
- **소비처 전수(전부 tenant-aware, 매트릭스 없는 bare `canAccess`/`accessLevel` 직접호출 = 0건)**:
  · 페이지 ~60개 = `requireAccess`(메뉴) · export/api 라우트 = `apiAccess`/`canAccessTenant`
  · 기능 액션(billing/exams/meetings/consultations/enrollment/kiosk/search) = `accessLevelTenant`/`canAccessTenant`
  · UI(사이드바·커맨드팰릿·모바일내비) = layout `permMatrix` prop → `canAccess(role,menu,permMatrix)`
  · (bare `canAccess`는 `super-admin.ts`(권한 직교)와 테스트뿐 — 정상)
- **쓰기·가드레일**: `saveOwnerSection` master 전용 게이트 + Zod `permissionsSchema.superRefine` ↔ 적용단 `isPermissionLocked`
  **이중 방어**(role-locked 메뉴·student 컬럼·master 자기잠금 금지). `resolveSettings` deep-merge가 sparse 배열 보존.
- **보안 갭 2건 → 처리 완료(2026-06-19)**:
  1. ✅ **자기상승(DB레벨) 수정**: `0038a_tenant_settings_master_guard` 트리거로 `tenant_settings` INSERT/UPDATE/DELETE를
     **master 전용으로 DB레벨 강제**(비-master 인증 사용자의 직접 API 변조 차단, service_role/직접연결=auth.uid() null은 통과 —
     0026a users-guard 패턴). DB 3-경로 테스트 통과(비-master 차단·master 허용·직접연결 허용). 이제 권한 override 쓰기 경로는
     앱(saveOwnerSection master 게이트) + DB(트리거) **이중**.
  2. ✅ **fail-open = 의도적 최종 결정**(코드 변경 없음, 주석 확정): `getPermMatrix`가 설정 조회 실패 시 코드 기본으로 폴백.
     fail-closed는 장애 시 master까지 /owner 락아웃(복구 불능)이라 채택 안 함. 기본=master full이라 복구 가능성 보존 + #1로
     override가 항상 정당(master 설정)해져 일시 무효의 잔여 위험 낮음·자가복구. (perm-matrix.ts 주석에 근거 명시.)

> ⚠️ **권한/접근제어를 건드리는 새 코드는 반드시 `requireAccess`/`apiAccess`/`accessLevelTenant`/`canAccessTenant`(tenant-aware)로
> 게이트**할 것 — 매트릭스 인자 없는 `canAccess(role,menu)`/`accessLevel`은 override를 무시한다(위 orphan 0건을 깨지 말 것).
> 그리고 이런 중요한 배선은 **구현할 때마다 이 CLAUDE.md에 소비처·갭을 기록**한다(사용자 지침).

### 수강료 계산기 전면 재구현 — 신입생 상담 견적 도구 + 환불규정 + 공휴일 정밀화 (2026-06-19)
사용자 지적: 계산기의 "청구서로 저장"이 **재원생 + invoices 테이블**에 묶여 엉뚱했고(신입생 상담 견적 도구여야 함),
공휴일 이름이 전부 "공휴일"로 떴으며, 청구서에 환불규정이 없었다. ijw 계산기를 충실 재구현.
- **신입생 견적 도구로 재설계**: 학생 정보 **자유 입력**(이름/학교/학년/상담자/기간 — 재원생 선택 아님) + **다과목**
  (단가표에서 추가, 반/요일/시수/금액/비고 편집 + 공휴일 제외·월N회 고정 per-course) + 교재/기타 + 할인. 라이브
  **수강료 안내문**(우측, 인쇄용) — 월별 분할·소계, 최종 납부 금액. `tuition-calculator.tsx`(오케스트레이터) +
  `quote-editors.tsx`(행 편집) + `quote-document.tsx`(안내문) + 순수계산 `quote-calc.ts`(splitCoursesByMonth/quoteTotal,
  Vitest 10케이스).
- **별도 저장소 `tuition_quotes`**(`0037a` alpha, RLS — invoices와 완전 분리): 학생정보 + courses/extras/discounts jsonb
  스냅샷 + 총액. `server/tuition-quote-{queries,actions}.ts`(saveQuote/list/get/delete, billing-full). 계산기 서브탭에
  **저장된 청구서** 추가(`?csub=quotes`, `saved-quotes-{panel,list}.tsx`) — 목록/검색/삭제 + 클릭 시 `?qid=`로 계산기 재열람.
  ⚠️ 기존 `createInvoice`(재원생 청구)는 **수납 면 신규청구**에 그대로 — 계산기만 분리.
- **환불 규정 verbatim 이식**(`refund-policy.tsx`, ijw `TuitionInvoicePreview` 그대로): 학원 수칙 3항 + 환불 규정 표
  (제18조 제2항 1·2호/3호, 1개월 이내/초과 × 경과시점, rowspan/colspan) + 각주 2 + 소득공제 disclaimer. 안내문 하단 고정·인쇄 포함.
- **공휴일 정밀화**(`holidays-data.ts` → `{date,name}[]`): ijw KOREAN_HOLIDAYS 날짜에 **정확한 이름**(설날/추석/부처님오신날/
  대체공휴일/어린이날…) 부여(기존 8개만 이름 → 전부). 공휴일 면에 **연도 ◀▶ + 월 선택**(`?hy=&hm=`). 계산기는
  `koreanHolidayDatesForRange`로 차시 제외.
- 검증: typecheck0 / lint0(신규0) / test378 / build✓ + 브라우저 4서브탭 200(계산기=신입생도구·환불규정 포함, 견적목록, 공휴일 이름·연도이동).
- **후속(사용자 "학원 공휴일에 공휴일명도")**: 학원설정 `operations.holidays`를 `string[]` → **`{date,name}[]`**(`holidaySchema`)로.
  운영 폼에 `HolidayListEditor`(날짜+공휴일명 입력), 공휴일 면 "학원 지정 휴원일"이 이름과 함께 표시. **옛 string[] 저장데이터는
  `resolve.ts`의 `normalizeHolidays`가 `{date,name:""}`로 승격**(읽기 정규화 — DB 마이그 불요, 다음 저장 시 신형식). 계산기엔
  `holidays.map(h=>h.date)`로 날짜만 전달. ⚠️ `operations.holidays`를 읽는 새 코드는 객체 배열임에 유의.

### 수강료 계산기 "설정" 이식 — 단가표·할인·세션·공휴일 (2026-06-19)
ijw 수강료 계산기는 "설정"에 5탭(수강료 단가표 43과목·교재/기타·할인·공휴일·세션)이 붙어 있었는데, eywa는
회당 단가를 매번 손으로 치는 단순 폼뿐이었다(사용자 제보). ijw 5탭을 eywa 컨벤션으로 충실 이식.
- **신규 테이블 `tuition_catalog`**(`0034a` alpha, RLS 격리 — schema.ts + 교재 단가표 `textbook_catalog` 패턴 미러).
  ijw의 분리 컬렉션 3개(`tuition_courses`·`tuition_extras`·`tuition_discounts`)를 **한 테이블에 `category`로 통합**:
  과목 분류(수학/EIE/영어/국어) → 단가 picker, `기타` → 부가항목, `할인` → 할인 프리셋. 권한도 billing-full 일관.
  공유 상수·타입은 `features/billing/tuition-catalog.ts`(클라/서버 공용, ⚠️ server-only 금지), DB 쿼리는
  `server/tuition-catalog-queries.ts`(server-only), CRUD는 `server/tuition-catalog-actions.ts`.
- **계산기 면에 서브탭(FaceTabs)**: `계산기 · 수강료 단가 · 공휴일` (ijw "계산기 모드 ↔ 설정" 재현, `?csub=`/필터는
  `cat`/`cactive`/`cpage`로 네임스페이스해 상위 `?tab=`와 충돌 회피). `calculator-panel.tsx`가 서브탭 디스패치.
- **계산기 강화(소비처 배선)**: `tuition-calculator.tsx`에 **수강료 과목 picker**(선택→회당 단가 자동입력 + 청구서
  notes에 과목명) + **할인 프리셋 picker**(선택→할인액). 수기 입력도 그대로 가능(오버라이드).
- **공휴일 면**: 학원 휴원일은 테넌트 설정(master 전용)이라 계산기에선 **읽기전용 표시 + 학원설정(/owner?tab=operations)
  링크**, 양력 고정 공휴일은 그 해 목록을 이름과 함께 표시(계산기 "양력 공휴일 제외" 토글로 반영). 소비처는
  기존 `tuition-calc.ts`의 `mergeHolidays`/`countSessions`.
- **세션(드래그 다중기간 manager)는 의도적 미복제** — eywa는 `countSessions(시작~종료 + 요일 + 공휴일)`로 차시를
  이미 도출(ijw "default mode"와 동일 계산). ijw의 월별 드래그 다중 range는 데모 임팩트 대비 과중 → 보류.
- **데이터 이식**: ijw `constants/tuitionCourses.ts` 43과목 + `tuitionExtras.ts` 기타 4·할인 3 = 50행을
  `scripts/_poc_migration/import-tuition-catalog.cjs`(멱등, ijw-demo 테넌트)로 적재.
- **후속(같은 날, 사용자 요청 "ijw 공휴일·단가 그대로 + 교재단가표 두 곳에")**: ① **ijw 공휴일 전체 이식** —
  `features/billing/holidays-data.ts`에 ijw `KOREAN_HOLIDAYS`(2024–2030, 음력·대체·부처님오신날 포함) **그대로**
  포팅. 계산기 토글이 양력 고정 8개 대신 **그 해 전체 공휴일**을 제외(`koreanHolidaysForRange`), 공휴일 면도 전체
  목록(`holidayName`과 함께) 표시. (`tuition-calc.ts`의 `mergeHolidays`/`fixedHolidaysForYear`는 테스트만 유지·UI 미사용.)
  ② **교재 단가표를 "내부탭"으로 두 곳에 배치** — 최상위 `교재 단가표` 면 **제거** → 교재 면(내부탭 `목록`/`교재 단가표`,
  `tsub=`, `textbooks-face.tsx` 신설) + 계산기 서브탭에 `교재 단가표` 추가(공휴일 왼쪽: 계산기/수강료 단가/교재 단가표/공휴일).
  **같은 `CatalogPanel` 재사용**(`base` prop으로 위치별 필터/검색/페이지 링크를 해당 면 안에 보존). 검증 그린 + 4면 200.
- 검증: typecheck 0 / lint 0(기존 경고 9 외 신규 0) / test 368 / build ✓. **브라우저 실검증**: 3개 서브탭
  200 + 단가표에 임포트 데이터(Dr.Phonics·중등M·형제 할인·시스템 사용료)·계산기 picker 마크업 확인.
  ⚠️ 검증 중 만난 `/billing` 500은 **병렬 expenses 세션의 stale HMR**(setExpenseApproval)이지 이 작업 무관(#35).

### UX 정돈 — 이름앞 아바타 제거 · 성적관리 리네임 · 생성폼 창화 · 드롭다운 규약 (2026-06-19)
세션 단위 UX 정돈 묶음.
- **이름 앞 아바타(Initial) 전면 제거**: 12개 화면의 `<Initial>` 14곳 + `atoms/initial.tsx` 컴포넌트 삭제.
  사람 표시는 **이름 텍스트만**(영구 규칙 — "디자인 시스템 › Atoms" + `design_handoff_eywa` 문서 갱신). 죽은
  헬퍼(colorForGrade 등)·ROLE 맵 `init` 필드·빈 아바타 placeholder도 정리.
- **메뉴 리네임 시험관리 → 성적관리**(`/exams` 라우트·테이블 유지, 라벨만): navigation·메타·권한 주석·docs 갱신.
- **"새 X" 생성 폼 = 우측 Sheet 패널 → 플로팅 창**(반·직원·학생·등록상담·상담·회의록 6개). 기존 `/X/new` 라우트를
  `useOpenFormWindow`로 창 오픈 + `WindowParams.autoClose` → 제출 성공(=/X/new 경로 이탈) 시 RouteWindow가
  창 닫기+배경 새로고침(서버액션·폼 무수정). `ROUTE_WINDOW_SIZE`에 `X/new` 크기 등록. 자세히는 "디자인 시스템 ›
  생성 폼은 우측 패널이 아니라 창으로" 참고.
- **수업목록 강사 필터**: 과목 선택 시 해당 과목 담당(`users.subjects`) 강사만 노출 + 과목 전환 시 비해당 강사 초기화.
- **드롭다운/셀렉트 규약 문서화**: `SearchableSelect` 단일 통일(native `<select>` 신규 금지) + 옛 Base UI `<Select>` 권고 정리.
- 검증: typecheck 0 / lint 0. ⚠️ 브라우저 실검증은 auth-gate로 보류. student-quick-panel Sheet는 모바일 peek 폴백으로 잔존.

### 시간표 ijw 충실 이식 — 그룹밴드·평일/주말 분리·2D 병합·엑셀 격자 (2026-06-18)
"기능 자체를 완전히 이식해 자연스러운 이전 느낌"이 목표(디자인 복제 아님). ijw 수학 시간표 코드(`TimetableGrid.tsx`)+
스크린샷 대조로 기본뷰 전면 재구축.
- **교시 축 과목 인지**(`features/timetable/lib/periods.ts` `slotPeriodRow`/`subjectPeriodRows`) — 16시→1교시 휴리스틱
  제거. 수학 8교시→4그룹, 영어 10교시, 주말 8교시(시간단위). 매칭 실패는 '기타' 폴백. 데모 데이터가 ijw 교시 시각 보존.
- **요일그룹 밴드 + 평일/주말 분리**(`_components/weekday-group-tables.tsx`) — 월목/화금/수 그룹 컬럼 밴드(3단 헤더),
  주말은 1교시 시작시각이 달라(09:00) 우측에 자체 교시열로. 행높이 2:1(2주말교시=1평일그룹) 격자 정렬.
- **2D 병합**(`lib/grid.ts` `computeBlocks`) — 같은 반이 연속교시(rowSpan)·인접요일(colSpan)에 걸치면 한 칸 + 셀 내
  같은 반 합치기. **엑셀 격자**(table-fixed+colgroup 균일 폭, 빈 교시도 균일 높이, 넘치면 셀 내부 스크롤).
- 셀=학생 세로 명단(이름·학교·학년, 신입 빨강/전입 초록). 통합뷰도 실교시 축.
- ⚠️ **분리등원(월-only/목-only 학생)·합반**은 데모 데이터(attendance_days 전건 빔, merge_group 희소)가 없어 보류.
- **남은 기능 이식(학생/수업목록 빠른승리 · 죽은기능 배선 · import복원/강의실배정)은 [`docs/ijw-feature-port.md`](docs/ijw-feature-port.md)** 에 정리 — 다른 컴퓨터에서 이어가기.

### ijw 기능 갭 P2 — 운영 깊이 7건 + 카카오 알림톡 머지 (2026-06-18)
ijw-calander ↔ eywa 전수 갭검수(143건)에서 P0(막다른 길 9건)·P1(일상운영 9건)에 이어 **P2(운영 깊이 7건)
전부 완료**. 신규 테이블이 필요한 무거운 기능 — 데모를 '진짜 운영툴'로 보이게 하는 깊이. 계획서
[`C:\Users\user\.claude\plans\sunny-coalescing-diffie.md`]. 항목별 커밋·검증 그린(typecheck0/lint0/test332/build✓).
- **P2-1 시험(Exam) 모듈 = 신규 최상위 메뉴 `/exams`**: `exams` 테이블(`0028a` alpha) + `student_grades.exam_id`
  (부분유니크 `ux_grades_exam_student WHERE exam_id is not null`). 순수 `features/exams/calc.ts`(examStats/rankByScore).
  목록(통계 on-the-fly, denormalize 안 함) + 상세(반선택→**일괄 점수 그리드**, `batchSaveScores`=제출분 delete→insert 멱등).
  학생그룹 메뉴(teacher scoped·accountant none), 창 960×680.
- **P2-2 수강종료(과목 이탈) 추적**(마이그레이션 無): 재원이지만 특정 과목 enrollment 전부 종료된 학생.
  순수 `withdrawals/subject-ended.ts`(getEndedSubjects) + `withdrawals/page.tsx` 퇴원/수강종료 유형 토글.
- **P2-3 급여 월별 전직원표** `/staff/payroll`(master): 월 ◀▶ + 상태칩 + tfoot 합계. ⚠️ 미작성 직원은
  월기본만(전원 동시 calculateMonthlyPayroll 지양 — 반응속도 #1). ⚠️ 데모: 39명 중 급여설정 1명뿐 → 거의 0원.
- **P2-4 수강료 계산기** `/billing?tab=calculator`(책갈피 4면): 순수 `billing/tuition-calc.ts`(countSessions 공휴일제외)
  → 라이브 견적 → 청구서 저장(createInvoice 재사용) + 인쇄.
- **P2-5 교재 카탈로그(단가표)** `textbook_catalog`(`0030a`) + `/billing` 책갈피 5면 '단가표' CRUD + textbook-dialog
  '교재 검색' picker. **ijw `data/textbookCatalog.ts` 146종 이식**(`import-catalog.cjs`, 초/중/고 수학142+영어4).
- **P2-6 운영 감사로그** `audit_logs`(`0031a`, RLS 격리) + `/admin/audit` 뷰어(master). **8개 mutation 계측**
  (역할변경·직원삭제·청구서생성·시험생성/삭제/일괄성적·급여정산·퇴원사유).
- **P2-7 레벨테스트** `level_tests`(`0032a`) + 학생 상세 성적탭 섹션(배치/승급/진단·과목별 세부점수 jsonb).
- **카카오 알림톡 PR#1 머지**(`8e27419`) + **main CI 복구**(`43ff624` verify 잡 `NODE_OPTIONS=4096`로 tsc OOM 방지 /
  `150e490` typecheck 전 최소 `next-env.d.ts` 생성 — gitignore라 CI에 없음). 마이그 `0027d_kakao→0029a`(충돌 해소).
- ⚠️ **버그픽스 2건**: `18649ba` deleteStaff가 auth 404("User not found")에 멈추던 것 건너뛰고 public 삭제(#31).
  `8dd7d30` 인페이지 `BackLink`를 `useInFrame`으로도 숨김 — 탭 Link 드릴인이 `?embed=1` 떨궈 ← 이중 + /classes 오이동.
- ⚠️ **미구현/후속**: ① 데모 갭 — `audit_logs`·`level_tests` 비어있음(필요 시 시드), 급여설정 38명 무설정.
  ② **브라우저 실검증 보류**(이 세션 Chrome MCP 미연결 — 로직 레벨만). ③ **drizzle 스냅샷 reconciliation 별도 과제**
  (P2 신규 테이블은 전부 손수 alpha — `db:generate` 금지, #P0-6 드리프트). ④ **P3 미착수**(상담녹음AI / QR공개접수 /
  시간표시뮬 / 엑셀라운드트립 / 지출결재) + 급여 정책엔진(과정별 단가). ⑤ 시간표 P1 2건(인라인검색·강사색상)은
  병렬 timetable 세션 소관(이 세션 검토 시 미반영 상태였음 — 그 세션 병합 후 재확인).

### 데모 데이터 정합·온보딩·브랜드 + 수납관리 책갈피(교재/지출) (2026-06-17)
3제품 비교(makeedu·ijw·eywa) 후 데모 완성 백로그를 우선순위로 처리 + 수납관리 확장.
- **상담 데이터 버그**(데모 직격): import(`scripts/_poc_migration/run.ts`)가 소스 필드를 다중 오매핑
  (summary←notes·category←type·follow←followUpContent)해 1340 상담이 전부 "(내용 없음)"·category="parent"였음.
  run.ts 재매핑 수정 + 기존 행 `fix-consultations.cjs`로 1338행 패치(소스 students로 재조인).
- **데모 데이터 보강**: 담임 263명 실수강 데이터로 유도(`fix-primary-teacher.cjs`, 261은 반 teacher_id 공란), 성적
  3290행 **합성**(`fabricate-grades.cjs`, 전 enrolled — ⚠️가짜).
- **멀티윈도우 온보딩**: 첫 진입 코치마크(`workspace-onboarding.tsx`, prefs.onboarded) + 닫을 때 사이드바 펼침(발견성).
- **브랜드 로고**: 검은 동심원 → 포레스트그린 사각 + 흰 sprout(botanical) 마크(app-sidebar). (대시보드 차트는 병렬
  세션의 "운영 콕핏 개편"으로 대체되어 미적용.)
- **AI 목업 라벨링**: 퇴원관리 "인사이트"(sparkle) → "자동 요약"(pulse) — 라이브 AI(등록/케어/회의록)와 구분.
- **창 로딩 ← 버그**: route-window가 about:blank 단계 pathname("blank")으로 canBack 오판 → 스켈레톤에 ← 떴음. 가드 추가.
- **수납관리 책갈피 3면**: 창 오른쪽 세로 책갈피(수납/교재/지출, 파스텔, 앨범 인덱스)로 `?tab=` 면 전환(드릴인 아님 →
  ← 안 뜸). 신규 `textbook_orders`·`expenses` 테이블(`0025`+`0025a` RLS) + ijw 소스 **실데이터 이식**(교재 350·지출 95,
  `import-textbooks-expenses.cjs`). 창 폭 760×620. floating-window 타이틀바=live 문서제목 항상 표시.
- ⚠️ **시연 계정**: 데모는 POC 임포트본이라 `db:seed` 금지(전체 wipe). super-admin 사용자관리는 실-auth(박지훈 등)만.

### 전수 컴팩트화 — 대량 데이터에서 폭발하던 목록·매트릭스·칸반 정비 (2026-06-17)
멀티에이전트 감사로 "전건 평면 `.map`" 안티패턴 20여 건을 우선순위 순 정비. 모두 기존 표준(`<Pagination>`·
slice+토글·`DragScrollArea`·네이티브 `<details>`) 재사용. 브라우저 검증 완료(classes 129→3p 페이지 nav,
billing tfoot·상태칩, attendance 30→14열·출석률 sticky, enrollment 칸반 +N, 콘솔 에러 0).
- **서버 페이지네이션 신설**: 회의록(메모리)·퇴원(메모리)·수업목록(`getClassesPage`+`getClassesStats`, day는 SQL
  .in()로 총계 정확)·직원(메모리)·감사로그(`getAuditLogsPage`)·테넌트(`getTenantsPage`+`getTenantPlanStats`,
  .in()스코프 카운트)·중복그룹(20/p)·테넌트사용자(소수면 자동숨김). **회의록·퇴원·직원은 사이드 집계/필터가
  전체 기준이라 billing식 메모리 페이지네이션**(전건 fetch는 기존과 동일, 렌더만 캡).
- **캡+토글**: 회의 전사 발화(60)·등록상담 칸반(8)·이탈캠페인(10)·학생 상담탭(15, `<details>`)·타임라인(50).
- **수납 테이블**: 11→10컬럼(항목 인라인) + 상태분포 칩 + `<tfoot>` 페이지 합계행.
- **출석부**: 매트릭스 `DragScrollArea`+출석률 sticky right-0 + 월/2주 토글; 일자상세 반별 `<details>`(기본 접힘).
- **시간표 통합뷰**: 셀 수업 5개 + 더보기(client `IntegratedCell`).
- ⚠️ **의도적 미적용 2건**: ① 출석 입력폼 페이지네이션 — 반은 소그룹(정원 ~8)이라 벽 없음 + 단일 저장폼
  분할 시 미저장분 유실 위험. ② 대시보드 결석위험 캡 — 리스트 아님(카운트만), 캡 시 카운트 과소(버그) +
  쿼리도 안 가벼워짐. 둘 다 컴팩트 이슈 아님.
- ⚠️ **병렬 세션 함정 재확인**: 다른 세션이 staged한 파일을 `git add 특정경로` 후 `git commit`이 쓸어담음
  (랜딩 day-numbers/roi 삭제가 섞임 → reset --soft로 분리). 이후 **`git commit -m "msg" -- <명시경로>`** 사용.
- **재검수(멀티에이전트 18 agent) — 1차에서 놓친 11건 발견·수정**: 핵심은 **수백 옵션 native `<select>`**
  (학생 ~547·반 ~129 — 벽 + 전역 스크롤바 미적용 + 페이로드). 새 **`SearchableSelect`**
  ([src/components/ui/searchable-select.tsx](src/components/ui/searchable-select.tsx)) — 타이핑 필터 + 렌더 캡(50) +
  디자인 스크롤바 div 팝업. 폼 모드(`name`→hidden input, 필수성은 서버 액션 검증) / 네비 모드(`value`+`onValueChange`).
  적용: 수강배정 다이얼로그(학생·반)·상담 폼(학생). **`FilterSelect`에 `searchable` prop** 추가(네비 콤보박스) → 출석부 반 스위처.
  또 **리텐션 보드**(기본 진입 524명 평면 — 최대 누락 벽)·admin/cleanup 고아목록·상담→학생 전환 반 체크박스도 캡/페이지네이션.
  **새 대량 옵션 드롭다운은 native `<select>` 금지 → `SearchableSelect`** (수십 옵션 넘으면).

### 로그인 후 전수 QA + 창 내비게이션·쿼리 견고화 (2026-06-17)
- **전수 QA + 멀티에이전트 적대검증**: 로그인 후 전 화면을 브라우저로 훑어 증상 수집 → Workflow 서브에이전트가 코드를
  직접 읽어 코드버그/시드데이터/정상으로 판별(파일:줄 근거). 발견 코드버그 다수 수정(아래), 시드/데이터 결함은 Firebase 재이식 과제로 분리.
- **창 내비게이션(Idea A)**: 라우트 창 타이틀바가 iframe 제목/경로 라이브 동기화 + 뒤로(←)는 드릴인 때만(루트=X로 닫기) +
  인페이지 백은 임베드에서 숨김(`EmbedProvider`+`back-link.tsx`) + 닫을 때 부모 `router.refresh()`로 배경 즉시 반영. (#55·#56)
- **카드 전체 클릭**: 직원·학생상담 카드 어디나 클릭 → 상세/수정(수정 버튼·힌트 제거).
- **쿼리 견고화**: 공용 `src/lib/supabase/batch.ts`(`fetchInChunks`/`fetchAllPaged`)로 대량 `.in()` 414·1000행 절단·error
  삼킴을 retention(CRITICAL)·super-admin·students(export/recompute)·withdrawals·admin 전반에서 해소. (#53·#54)
- **표시/로직**: 회의 참석자 `[object Object]`, 과목 `HIGHMATH`→"수학(심화)", 수납 미수금 라벨, 퇴원 enrollment 종료,
  전화 정규화, AI 재분석 generated_at, 내학습 결석 리포트 모순, 권한 리다이렉트(루프 방지), super-admin 상태라벨.
- **AI provider = Upstage Solar 기본** 적용(`openai` 패키지 설치 + `UPSTAGE_API_KEY`; 없으면 Anthropic 폴백). "AI 모델 정책" 참고.
- ⚠️ **데모 데이터는 seed가 아니라 ijw POC 임포트본**(564명). 쓰레기 레코드·접미사·빈 성적·담임공란은 데이터 결함(코드 아님).
  최종 목표는 Firebase 전체 이식(serviceAccount `F:\ijw-calander\serviceAccount.json`, 명명DB `restore260202`) — 별도 과제.

### 선생님 원스크린 (강사 전용, 2026-06-01)
- 강사용 **수업 마감 원스크린** (`/onescreen`) — `data/원스크린_전달/` 디자인 핸드오프(React/JSX 프로토타입)를 eywa 톤으로 충실 이식.
- 한 화면: ① 진도 확인 ② 일일/확인 테스트 점수 ③ today 보고서 작성·발송. 좌(학생 9명 + 진/테/보 셀) · 중(진도+테스트) · 우(보고서).
- **데모 충실 이식**: 입력은 클라이언트 state(새로고침 리셋), 보고서는 **템플릿 자동생성**(`buildReport`, 라이브 AI 0), 발송은 **sonner 토스트 목업**(실제 전송 없음 — 알림센터 제외 원칙 유지). 새 DB 테이블·마이그레이션 없음.
- **강사 전용**: `permissions.ts`에 `teacher_onescreen: { teacher:"full", 나머지 none }` → 원장(master) 사이드바엔 미표시(12메뉴 정체성 유지), 직접 URL 진입 시 `requireAccess`가 `/`로 리다이렉트. 강사용 투어는 `teacher@ijw-demo.com` 계정.
- 순수함수 `report.ts`(buildReport/studentStatus/pct/delta) + Vitest 15케이스. `src/features/onescreen/`로 도메인 격리.

### 학생 원스크린 — 내 학습 현황 + 데일리 리포트 (학생 전용, 2026-06-01)
- `data/원스크린_패키지/`의 학생/학부모용 2화면을 강사 원스크린과 **마찬가지 패턴**으로 이식.
- **내 학습 현황** (`/my-learning`): KPI4(평균정답률·출석률·학습횟수·진도%) + 점수추이 차트(recharts, 과목 필터) + 과목별 진도 바 + 출결 달력 + 최근 기록(→데일리 리포트).
- **데일리 리포트** (`/my-learning/report?date=M/D`): 그날 진도·일일/확인 테스트(점수·%·delta) + 선생님 한마디(`buildReport` 재사용).
- **데모 충실 이식**: `src/features/my-learning/history.ts`가 프로토타입 `data.js`의 **결정적 9세션 이력**(LCG RNG)을 이식 — 정적·AI 0·네트워크 0. 강사 원스크린 9명(`DEMO_ONESCREEN`)·`buildReport`·`subjectTone` 재사용. Vitest 10케이스.
- **학생 전용 접근**: `SystemRole`에 `student` 신설(enum + 망라 맵), `my_learning: { student:"full", 나머지 none }`. `(shell)/layout`이 teacher·student면 **사이드바 없는 미니멀 셸**. 로그인 시 student → `/my-learning` 리다이렉트. 데모 학생 `student@ijw-demo.com`.

### Super-admin Phase 2~5 (4개 commit, 2026-05-29)
- **Phase 2 audit log**: `super_admin_audit_logs` 테이블 + `logSuperAdminAction` helper + `/super-admin/audit` viewer. 모든 super-admin mutation 추적.
- **Phase 3 지점장 보기**: `/super-admin/tenants/[id]/view` read-only 미러 (KPI+학생+회의, service_role). 진입 시 `impersonate_view` audit. 실제 조작 진입(RLS 함수 분기)은 Phase 6으로 보류.
- **Phase 4 라이선스**: `tenant_licenses` 테이블 (좌석형 student_seats + 토글형 ai_analysis/google_sheets/meeting_recording). tenants/[id] 라이선스 섹션.
- **Phase 5 사용자 관리**: changeUserRole/resetUserPassword/setUserActive (auth admin API) — tenants/[id] 사용자 행 액션.
- **⚠️ seed 가짜 강사 auth 부재**: seed의 teacher 5명은 `public.users`에만 INSERT (auth.users 없음). auth admin API(updateUserById)가 "User not found" 반환 → Phase 5 액션이 가짜 강사엔 실패. 실 운영 user(createTenantWithMaster/createStaff로 생성)는 auth 있어 정상. 데모 강사 관리하려면 seed를 auth.admin.createUser 기반으로 바꿔야 함 (후속).

### Super-admin Phase 1 (3개 commit, 2026-05-28)
- `super_admins` 별도 테이블 (academy 권한과 직교 — chrismathone은 master + super_admin 둘 다)
- RLS: 본인 row select만, write는 service_role 전용 + `is_super_admin(uid)` SQL helper
- `(super-admin)/` 라우트 그룹 — academy `(shell)`과 시각적 완전 분리 (ink 다크 배경 + gold accent)
- 4개 페이지: 대시보드 / 학원 목록 / 신규 발급 / 상세
  - 학원 신규 발급 = tenants INSERT + auth.admin.createUser(app_metadata)로 master 동시 생성
  - 트리거 `tg_sync_user_from_auth`가 public.users에 자동 mirror
- 모든 query는 service_role 클라이언트로 RLS bypass (multi-tenant read가 본질)
- impersonate / audit log / 라이선스 관리는 Phase 2로

### UI 폴리시 (1개 commit, 2026-05-28)
- ~~OS별 단축키 자동 분기 (`useIsMac()`)~~ → **2026-06-15 단축키 기능 전부 제거.** 가짜 단축키(⌘N·G+D/S/B, 미구현)·키캡 칩·전역 키바인딩·`useIsMac()`/`_shortcuts.tsx` 삭제. 검색 팰릿은 헤더 검색 **클릭**으로만 열림(메뉴 점프 그대로).
- 모바일 top nav 재구성 — 가로 스크롤 제거, 브랜드 banner 자체 행으로 분리, 메뉴 grid `auto-fit minmax(96px, 1fr)`로 균등 분할 (그룹 구분선 제거)
- `.scrollbar-thin` 유틸 (globals.css) — 6px width, line-tinted thumb. 디자인 톤에 녹는 스크롤바

### ijw-calander 패리티 (9개 commit, 2026-05-28)
- 학생 상세 7탭 (Overview/Billing/Grades/Attendance/Consultations/Memos/Timeline)
- 상태 전환 모달 (퇴원/휴원/재원 복구)
- 수강 배정 모달 + 반 신규/수정 폼
- 출석 셀 메모 + 숙제 체크박스
- 시간표 드래그앤드롭 + PNG export + A4 인쇄
- 강사 급여 정산 (자동 + 수동) + 휴가 관리
- billing 카테고리 + 담임 자동 매칭
- 상담 통계뷰 (전환율/사유/추세 차트)
- 대시보드 위젯 (결제 예정 / 결석 위험)
- 엑셀 export (시간표 색상 보존 / 학생 / 수납)
- Google Sheets 동기화 (service account JWT)
- Admin 도구 (중복 병합 / 데이터 정리) — 시나리오는 엑셀/스프레드시트로 대체

### 라우트 구조
- `/` = **제품 중심 랜딩** (Hero 제품 쇼케이스 → 자동연동(0.4s) → 기능 목업 시간표/출석부/수납 → **워크스페이스 멀티윈도우** → AI → 데이터 → ROI → 12메뉴 점선목차 → 단일 인터뷰 → 베타 요금 → CTA). 구 8섹션(Flow/LogoWall/Manifesto 등) 폐기. 컴포넌트: `(marketing)/_sections/*` + `_ui/*`(BrowserFrame·product-showcase·mock-{timetable,attendance,billing,workspace}·feature-block·cta-button) + `_motion/*`(Reveal·CountUp·landing.css). 워크스페이스 목업 레일은 실제 `app-sidebar`와 동일한 Lucide 아이콘.
- `/dashboard` = 대시보드 (예전 `/`에서 이동)
- `/exams`, `/exams/[id]` = **성적관리** (신규 최상위 메뉴, 학생 그룹) — 일괄 성적입력
- `/staff/payroll` = 급여 월별 전직원표 (master 전용, /staff 드릴인)
- `/login` = 로그인. 성공 시 `/dashboard` redirect
- `/admin/*` = **학원 설정(/owner) "관리" 면으로 병합됨(2026-06-20)** — 구 라우트는 `/owner?tab=data|dup|audit|sheets` redirect stub(북마크 보존), 본문은 `owner/_components/{data,duplicates,audit,sheets}-face.tsx`(admin `_client.tsx` 재사용). admin menuKey는 hidden 보존(리다이렉트·창 해석용). owner = 설정 5면 ┃ 관리 4면(FaceTabs group 구분선)
- `/super-admin/*` = **SaaS owner 전용 super_admin 레이어** (academy 권한과 직교)
- `(marketing)/` = 랜딩 그룹 (사이드바·헤더 없음, marketing nav 64h)
- `(shell)/` = 인증된 12개 메뉴 + admin (사이드바 232px + Topbar 64px)
- `(super-admin)/` = super_admin 그룹 (다크 사이드바 + gold accent + "Super Admin" 라벨)
- `(print)/enrollment/[id]/print/` = A4 인쇄

### 12개 메뉴 — 핵심 위젯 (ijw 패리티 적용 후)

| 메뉴 | 데이터 | 핵심 위젯 |
|---|---|---|
| 대시보드 (`/dashboard`) | dashboard 9개 쿼리 | 김수진 인사말 + KPI 4 + Timeline(1.55fr) + Announcements(1fr) + 7일 추세 |
| 시간표 (`/timetable`) | `class_schedules`(+슬롯 라벨) + `enrollments` + `students` | **과목 단일선택(기본 수학)** + 기본뷰(요일그룹밴드 월목/화금/수 + 주말 별도판, 과목별 실교시, 같은반 2D병합, 엑셀격자) / 통합뷰(ijw 반=열 리치 그리드 — 시작교시 섹션 + 좌측 고정 라벨열 + 반=열: 수업명(반색)·담임·요일별강의실·**요일×교시 미니그리드(셀마다 강사/LAB)**·재원/대기/퇴원, 읽기전용). [`docs/ijw-feature-port.md`] |
| 출석부 (`/attendance`) | `attendance_records` | **학생 × 30일 매트릭스** + Stat 4 + 반 chip + 월 ◀▶ + 셀 클릭 입력 (`/attendance/[date]/[classId]`) |
| 수업목록 (`/classes`) | `classes` + schedules + enrollments | **테이블/카드 토글** + 과목·강사·요일 chip + 검색 + 메모/요일 컬럼 |
| 학생목록 (`/students`) | `students` + enrollments | Stat 4 + **검색 + 과목/상태 chip** + 학생별 수강 과목 다중 pill (상세 성적탭에 **레벨테스트** 섹션) |
| 성적관리 (`/exams`) | `exams` + `student_grades` | 시험 목록(응시/평균/최고/최저 통계) + 등록 + 상세 **반선택 → 일괄 점수 그리드** + 석차 |
| 등록상담 (`/enrollment`) | `enrollment_consultations` + AI | **AI 배너 (forest gradient + sparkle)** + 4열 칸반 + 월/상담사 chip + 대시보드 (recharts) |
| 학생상담 (`/consultations`) | `student_consultations` | Stat 4 + **기간/카테고리/후속 chip + 검색** + Follow-up urgency 자동 |
| 퇴원관리 (`/withdrawals`) | `students.status='withdrawn'` | Stat 4 + 리스트(1.4fr) + 사유 분석 진행바(1fr) + **기간/사유 chip + 검색** + amber AI 인사이트 |
| 직원관리 (`/staff`) | `users` + classes/students 카운트 | Stat 5 + **역할/상태 chip + 검색** + 3col 카드 그리드 + **급여 월별표 진입(`/staff/payroll`)** |
| 수납관리 (`/billing`) | `invoices` + `textbook_orders` + `expenses` + `textbook_catalog` + `tuition_catalog` | Stat 5 + 월 ◀▶ + 검색 + 정렬 + **FaceTabs 4면**(수납/교재/지출/**계산기**). 교재 면=내부탭(목록/교재 단가표), 계산기 면=서브탭(계산기/**수강료 단가**/교재 단가표/공휴일/**저장된 청구서**). 계산기=**신입생 상담 견적 도구**(자유입력 학생정보 + 다과목 + 교재/할인 + 환불규정 포함 인쇄 안내문 → `tuition_quotes` 저장, invoices와 분리). 교재 단가표는 두 면이 같은 `CatalogPanel` 재사용, 공휴일은 ijw 전체(음력·대체·이름·연도이동) |
| 회의록 (`/meetings`) | `meeting_minutes` + AssemblyAI | Stat 3 + **기간/상태 chip + 검색** + 음성 + AI 요약 + LIVE pill |
| 도움말 (`/help`) | (정적) | Search hero(gradient) + 12 메뉴 가이드 + FAQ + 1:1 문의 |

### 인증 / RLS

- 두 master 계정 (`chrismathone@gmail.com`, `st2000423@gmail.com`)이 `ijw-demo` 테넌트에 sync됨
- master `chrismathone`의 `display_name = "김수진"`, `job_title = "원장"`, `hire_date = 1998-03-15` (시안 페르소나)
- **`st2000423`만 super_admin (SaaS 총괄)**, **`chrismathone`은 인재원 지점장(academy master)일 뿐 super_admin 아님.** 둘 다 ijw-demo의 academy master지만 super_admins 테이블엔 st2000423만 있음. (super_admin ⊥ academy master — 직교.)
- 권한 매트릭스는 `lib/permissions.ts`의 `canAccess(role, menuKey)` 헬퍼. AppSidebar에서 필터링, 빈 그룹 자동 숨김
- super_admin 권한은 `getCurrentSuperAdmin()` / `requireSuperAdmin()` (`src/lib/auth/super-admin.ts`)
- 실제 데이터 보안은 RLS (`auth_tenant_id()` 함수 + tenant_isolation 정책)에서 강제
- super-admin 영역은 `createAdminClient()` (service_role)로 RLS bypass — multi-tenant read가 본질이므로

---

## 디자인 시스템 (Daylight 시안 적용)

`data/design_handoff_eywa/`의 픽셀 시안 → eywa 코드 매핑 완료. **라이트 전용**, 다크모드 제거.

### 컬러 토큰 (`src/app/globals.css`)
| 토큰 | hex | 용도 |
|---|---|---|
| `--background` | `#fbf9f3` | 페이지 배경 (따뜻한 아이보리) |
| `--bg-soft` | `#f1ede2` | 섹션 구분 / 사이드바 배경 |
| `--card` | `#ffffff` | 카드 표면 |
| `--foreground` / `--ink` | `#1a1f1c` / `#0d1110` | 본문 / 다크 강조 |
| `--text-dim` / `--text-faint` | `#5a635f` / `#9aa39d` | 보조 / 캡션 |
| `--primary` | `#1a5f3c` | **포레스트 그린** — CTA, 활성 메뉴, 출석/완납 |
| `--gold` | `#b8893a` | 강조 · 베타 배지 · AI 라벨 (POWERED BY CLAUDE) |
| `--blue` | `#1f6ba8` | 정보 · 학생 안정 · 영어 과목 |
| `--rose` | `#c44d6d` | 상담 · 학부모 · 국어 과목 |
| `--amber` | `#d68f1a` | 지각 · 부분 납부 · 경고 |
| `--danger` | `#d04848` | 결석 · 미수 · 긴급 |
| `--purple` | `#7a4ba8` | 회계 · 과학 과목 |

차트 슬롯 재매핑: chart-1(blue) · chart-2(primary) · chart-3(amber) · chart-4(danger) · chart-5(rose).

### 라운드 (ijw 운영 톤에 맞춰 시안에서 대폭 축소)
| 토큰 | 시안 | 적용값 |
|---|---|---|
| `--radius-xl` (카드) | 16px | **6px** |
| `--radius-pill` | 999px | **4px** (사각 batch) |
| `--radius-2xl` | 20px | 8px |
| `--radius-3xl` | 24px | 10px |

### 타이포
- **Pretendard Variable** (self-host) + **JetBrains Mono** (메타·숫자·키칩)
- 헬퍼 클래스: `.display-xl 96px / .display-md 56px / .h1-large 32px / .h2 24px / .h3 19px / .body / .body-sm / .caption / .micro (mono 11px 700 uppercase) / .tabular (숫자 강조)`

### Atoms (`src/components/atoms/`)
- ~~**`Initial`** — 이니셜 사각 배지~~ → **제거됨 (2026-06-19, `initial.tsx` 삭제).** 이름 앞에 붙던
  프로필사진/이니셜 배지는 전 화면에서 전부 떼어냈다. **이름 앞 아바타 금지 (⚠️ 영구 규칙)**: 사람
  표시는 **이름 텍스트만** — 이니셜 사각 배지·동그란 프사·이미지 아바타 어느 것도 이름 앞/옆에 새로
  붙이지 말 것 (앞으로도 불필요). 자리 채우기용 빈 아바타 placeholder(`size-N rounded` 회색 칸)도 금지.
- **`Pill`** — mono 11px uppercase, soft/solid + color (primary/gold/blue/rose/amber/danger/purple/neutral)
- **`SectionTitle`** — 14px 700 + action slot

### Botanical 아이콘 (22개)
- `src/components/icons/eywa-icons.tsx` — `<EyIcon name="tree" size={18} />` 단일 컴포넌트
- 이름: tree/leaf/pulse/branch/seed/sprout/wave/falling/roots/pollen/rings/spore/search/bell/arrowUp/arrowDown/arrowRight/play/check/plus/dot/sparkle
- 메뉴 매핑: `MENU_ICON[menuKey]` (대시보드=tree, 시간표=leaf, 출석부=pulse, 학생=seed, 등록상담=sprout, ...)
- AI 강조는 모든 곳에서 `sparkle + gold-soft` 일관

### AppShell
- **Sidebar = 너비 조절형 레일** (bgSoft 배경). 오른쪽 경계선을 잡고 끌면 너비가 따라오고,
  충분히 줄이면 **접힘(52px 아이콘만)**, 늘이면 **펼침(150~360px 아이콘+라벨)**으로 스냅. 더블클릭=빠른
  토글, ←/→ 키도 지원(`role=separator`). 너비/펼침 여부는 `usePrefs`(localStorage `eywa-prefs`)에 영속.
  구현: [`use-sidebar-resize.ts`](src/components/workspace/use-sidebar-resize.ts) 훅 + [`app-sidebar.tsx`](src/components/app-sidebar.tsx).
  접힘 시 hover Tooltip 라벨, 펼침 시 그룹 헤더(01~05) 노출.
- **접힘↔펼침 모핑 애니메이션**(200ms `cubic-bezier(0.22,0.61,0.36,1)`): 아이콘은 left 26px(접힘 레일
  중앙)에 **고정**해 안 튀고, 활성/hover 하이라이트는 절대배치 bg의 `left/right`(8↔4)로 **사각형↔행 모핑**,
  라벨은 `max-width+opacity` 페이드, 그룹 슬롯은 `height`(접힘 6/13 ↔ 펼침 22)로 "패널이 열리듯" 성장.
  **모션 OFF(`usePrefs.animations`)면 트랜지션 전부 0s**(즉시). 드래그 중엔 1:1 추종이라 트랜지션 off.
- 5그룹: 홈 / 수업 / 학생 / 운영 / 지원 + 01~05 인덱스 (mono uppercase)
- 활성 메뉴: primary bg + white text + shadow-primary-glow
- 푸터: `김수진 / 원장 · chrismathone@gmail.com`
- **Topbar 64px**: breadcrumb (mono 11px primary) + 19px 800 페이지 제목 + 검색바 280px + 알림 + 사용자

### shadcn base-nova (Base UI) 유지 사항
- `render` prop (asChild 아님), `TooltipProvider delay` (delayDuration 아님)
- 일부 atom 함수형 컴포넌트 신규 작성, 나머지 shadcn 그대로 사용

### 스크롤바 — 전역 하네스 (⚠️ 무조건 적용)
**모든 스크롤 영역은 디자인 톤 스크롤바로 통일한다. 옵트인 아님.** `globals.css`의 전역 규칙
(`*`, `*::-webkit-scrollbar*`)이 페이지·패널·드롭다운 팝업·textarea 등 **모든 스크롤 컨테이너에
자동 적용** — 6px, line 컬러(`rgba(13,17,16,0.18)`, hover 0.32) thumb, 투명 track, 999px radius.
- 새 스크롤 영역을 만들 때 **별도 클래스가 필요 없다** (이미 전역). `.scrollbar-thin`은 기존 사용처
  호환용 별칭으로만 남김.
- ⚠️ **네이티브 `<select>`의 옵션 팝업 스크롤바는 OS가 그려 CSS가 닿지 않는다.** 그래서 드롭다운은
  아래 "드롭다운/셀렉트 규약"대로 [`SearchableSelect`](src/components/ui/searchable-select.tsx)로 통일한다
  (styleable 팝오버 `div` → 전역 스크롤바 자동 적용).
- 회색 기본 스크롤바가 한 군데라도 보이면 위반. 새 화면 추가 시 점검.

### 드롭다운/셀렉트 규약 (⚠️ 새 드롭다운 기본값)
- 모든 드롭다운은 [`SearchableSelect`](src/components/ui/searchable-select.tsx)로 통일.
  테두리·padding·ChevronDown·검색 팝오버 일관 + 전역 디자인 스크롤바 적용.
- URL 필터는 [`FilterSelect`](src/components/filter-select.tsx)를 쓴다 — 내부에서 SearchableSelect 렌더
  (`searchable`/`ariaLabel` prop은 호환용, 무시).
- 폼 필드는 `SearchableSelect`에 `name`을 주면 hidden input으로 값 제출.
- **native `<select>` 신규 금지** — OS 팝업은 디자인 스크롤바 미적용·스타일 불일치.

### 버튼 크기 — 헤더 액션은 공용 `<Button>` 기본 크기로 통일 (⚠️ 새 버튼 기본값, 2026-06-24)
한 줄(페이지/상세 헤더의 액션 클러스터, 다이얼로그 푸터)에 들어가는 액션 버튼은 **크기가 제각각이면 안 된다**.
증상: 1차 액션은 공용 `<Button>`(기본 `h-8 text-sm`)인데 옆의 2차 액션("통계 보기"·"엑셀 내보내기"·"월별 급여"
등)은 손으로 깎은 `inline-flex … border px-2.5 py-1 text-xs` 작은 링크라 **나란히 두면 높이·글자크기가 따로 논다**
(사용자 제보: 학생상담 헤더 "통계 보기"(작음) ↔ "상담 추가"(큼)).

**규칙(불변): 같은 액션 행의 모든 버튼은 공용 [`Button`](src/components/ui/button.tsx)을 쓰고 크기는 기본값
(`size="default"` = `h-8 text-sm`)으로 통일한다 — "오른쪽(1차) 버튼 크기"가 표준이다.**
- **1차 액션** = `<Button>`(기본 variant=default). **2차 액션** = `<Button variant="outline">`(또는 ghost/secondary).
  variant(색)만 다르고 **size는 전부 같다**.
- **링크/네비/다운로드 버튼**도 손으로 깎지 말고 `render`로 감싼다:
  `<Button variant="outline" render={<WindowLink href=… title=… />}>` / `render={<a href=… />}`(엑셀 export). [[#2]](base-ui는 `asChild` 아닌 `render`)
- **size 변형 금지(헤더/푸터 액션)**: `size="sm"`·`text-xs`·손깎은 `px-2.5 py-1` 버튼을 1차 `<Button>` 옆에 두지 말 것
  (`CreateInvoiceTrigger`의 `size="sm"`·outline 손깎기도 기본 크기로 정규화함). 아이콘은 `className="size-4"`(또는 미지정→Button이 size-4).
- **이 규칙 밖(작은 크기 허용)**: ① **표/리스트 행 안의 인라인 액션**(행 높이에 맞춤) ② **transient 인라인 확인 플로우**
  (삭제 "예/취소" 같은 순간 폼) ③ Pill·배지처럼 버튼이 아닌 칩. 헤더 액션 클러스터에는 적용, 이 셋엔 미적용.
- 전수 적용(2026-06-24): 학생상담·학생목록(엑셀 내보내기/가져오기)·직원(월별급여/휴가관리)·수납(엑셀 내보내기/청구서 생성)·
  성적 상세(수정/삭제) 헤더를 전부 `Button` 기본 크기로 통일.

> **한 줄 규칙: 한 액션 행의 버튼은 공용 `<Button>` 기본 크기로 통일(색=variant만 차이). 손깎은 text-xs 링크·`size="sm"`를 1차 버튼 옆에 두지 말 것.**

### 줄바꿈 / 워드브레이크 — 한글 어절 단위 (⚠️ 전역, 좁은 창에서 특히 중요)
**텍스트가 "발표·세미 / 나" 식으로 단어 한가운데서 깨지지 않게 한다.** 플로팅 창은 폭이 좁아
(기본 480px) 이런 "얼토당토 않은 곳에서의 줄바꿈"이 흉한 뷰를 만든다. 전역 규칙이 기본을 잡는다:
- **`globals.css`의 `body { word-break: keep-all; overflow-wrap: anywhere; }`** — `keep-all`은 CJK를
  글자 사이에서 끊지 않고 **공백(어절) 경계에서만** 줄바꿈 → 한글이 자연스럽게 단어 단위로 접힌다.
  `overflow-wrap: anywhere`는 URL·긴 영문 같은 끊을 곳 없는 토큰이 넘칠 때만 강제로 끊는다. **새 화면은
  별도 클래스 없이 이미 이 동작**(옵트인 아님).
- **절대 쪼개지면 안 되는 인라인 조각**(라벨·배지·Pill·버튼 텍스트·날짜/시각·"N개 발화" 같은 메타)은
  **`whitespace-nowrap`**(flex 안이면 `shrink-0` 동반)을 붙인다. `keep-all`도 공백은 끊으므로 "AI 분석"
  처럼 공백 든 짧은 라벨은 nowrap 없으면 "AI / 분석"으로 깨진다(회의 상세 AI 헤더가 이 케이스였음).
- **좁은 창 헤더에 라벨 + 긴 부제 + 메타를 한 줄에 욱여넣지 말 것.** 긴 부제(예: 회의 유형)는 **자기
  full-width 줄로 내려** keep-all로 깔끔히 접히게 한다(라벨/메타는 윗줄에 nowrap으로 고정).
- **긴 본문에는 `whitespace-nowrap` 금지**(가로 오버플로 유발) — keep-all에 맡긴다. `truncate`/`line-clamp`는
  "한 줄/N줄 자르고 …" 의도일 때만.

### 드래그-팬 (잡고 끌기) — 넘치는 영역의 기본 인터랙션 (⚠️ 새 화면 기본값)
**가로/세로로 넘치는 영역은 막대 스크롤바에만 의존하지 말고, 마우스로 빈 곳을 끌어 내용을
움직일 수 있게 한다** — 태블릿/지도 앱 느낌(놓으면 관성 글라이드 + 넘치는 가장자리 페이드).
구현체: [`src/components/ui/drag-scroll-area.tsx`](src/components/ui/drag-scroll-area.tsx)의 `<DragScrollArea>`.
- **적용**: 기존 `<div className="… overflow-auto …">{내용}</div>` →
  `<DragScrollArea className="… (overflow-auto 빼고)">{내용}</DragScrollArea>`.
  안쪽 컨테이너가 overflow를 담당하므로 바깥 className에서 `overflow-auto`는 뺀다.
- **양축 자동**: 넘치는 축만 팬. 안 넘치면 grab 커서·페이드 자동 off.
- **충돌 안전**: 터치는 네이티브 스크롤에 위임, dnd-kit draggable(`[aria-roledescription="draggable"]`)·
  폼 컨트롤 위에선 팬을 시작하지 않는다. 5px 임계값으로 "탭=클릭 / 끌기=팬"을 구분하고, 실제로
  끌었으면 뒤따르는 click 1회를 차단(카드·링크 오작동 방지). 팬을 막을 자식엔 `data-no-drag-scroll`.
- 전역 스크롤바 하네스와 **병행** — 스크롤바는 그대로 보이고 드래그가 더해질 뿐. 새 화면에서
  넓은 표·캔버스·가로 목록을 만들 땐 처음부터 `DragScrollArea`로 감쌀 것.

### 플로팅 창 기본 크기 — 넓은 메뉴는 크게 연다
메뉴는 플로팅 창(크롬리스 iframe)으로 열리고 기본 480×560인데, 넓은 표는 거기 안 들어가 가로
스크롤이 과해진다(#24). **넓은 메뉴는 크게 연다** —
[`src/components/workspace/window-geometry.ts`](src/components/workspace/window-geometry.ts)의
`ROUTE_WINDOW_SIZE: Record<menuKey, {w,h}>`에 등록(없으면 `DEFAULT_WINDOW`). 캔버스보다 크면
`cascadeNext`가 자동 clamp(작은 화면 안전). 예: `timetable: { w: 1040, h: 680 }`.

### 다열 보드 = 큰창 그리드 / 작은창 탭 (⚠️ 칸반형 레이아웃 기본값, 2026-06-19)
플로팅 창은 기본 480px로 좁다. **여러 독립 컬럼을 가로로 늘어놓는 보드(칸반)** 를 좁은 창에서 그냥
1열로 떨구면 컬럼들이 세로로 쌓여 "다른 컬럼 보려고 한참 스크롤"하는 흉한 뷰가 된다(등록상담 제보).
**해법: 창이 넓으면(lg≥1024px) N열 그리드로 전부 펼치고, 좁으면 상단 탭바로 컬럼을 전환해 한 번에
1개만 보인다.** 창=iframe이라 Tailwind `lg:` 브레이크포인트가 **창 폭에 그대로 반응** → 같은 창을
리사이즈/스냅하면 "큰창=그리드 ↔ 작은창=탭"이 라이브로 바뀐다(JS 미디어쿼리 불필요, 활성 탭 state만
클라이언트가 소유).
- **레퍼런스 구현**: [`enrollment/_components/enrollment-kanban.tsx`](<src/app/(shell)/enrollment/_components/enrollment-kanban.tsx>).
  서버 페이지는 컬럼별 데이터(`{key,label,color,cards}[]`)만 만들어 넘기고, 이 클라이언트 컴포넌트가
  탭 state·아이콘·렌더를 소유.
- **핵심 클래스 레시피**: ① 탭바 컨테이너 `flex overflow-x-auto lg:hidden`(좁을 때만), 활성칩은 보드
  필터 톤과 통일(`bg-foreground text-background`). ② 그리드 `grid grid-cols-1 lg:grid-cols-N`.
  ③ 각 컬럼 카드 `lg:flex ${i===active ? "flex" : "hidden"}` — 좁을 땐 활성 1개만, lg부턴 전부.
- **적용 기준(=칸반일 때만)**: 컬럼들이 **동등·독립한 평행 목록**일 때만 맞다(상태별 보드 등).
  - ✅ 칸반(등록상담: 대기·예약 / 상담완료 / AI완료 / 등록·종료).
  - ❌ **동질 카드 그리드**(수업목록·직원 `lg:grid-cols-3`)는 탭 아님 → **목록 페이지네이션** 표준으로.
  - ❌ **상세 본문+사이드 분할**(`lg:grid-cols-3`의 1.5+1 류)은 그냥 세로로 쌓이면 됨.
  - △ 약한 후보: `/retention`(이탈 방어) 2열 대시보드(`lg:grid-cols-[1.5fr_1fr]`) — 필요해지면 적용.
- 2번째 칸반이 생기면 그때 제네릭 컴포넌트로 추출(지금은 단일 사용처라 등록상담에 인라인).

### 영역 구분 — 이질적 다(多)섹션은 헤더 달린 카드로 또렷이 나눈다 (⚠️ 상세/집계 뷰 기본값, 2026-06-24)
**성격이 다른 정보 묶음을 한 화면에 모을 때 밋밋한 나열/벽으로 두지 말고, 각 묶음을 시각적으로 또렷이 구분한다.**
밋밋하면 "다 비슷해 보여 어디가 어디인지 모르겠다"가 된다(등록상담 AI 13섹션이 한 카드 안에 불릿으로 쏟아져 제보된 케이스).
레퍼런스 구현: [`(shell)/enrollment/[id]/page.tsx`](<src/app/(shell)/enrollment/[id]/page.tsx>) — 좌 "상담 기록"(입력) ↔ 우 "상담 AI 분석"(녹음 분석).

**규칙(이질적 다섹션일 때):**
- **섹션 = 헤더 달린 단일 카드**: `bg-card border-line rounded-md border p-4` + 헤더(이모지/아이콘 + 굵은 라벨 13px). 공용 `Card({title, emoji})`.
  ⚠️ 별도 음영 헤더 바를 content 위에 얹은 **"이중 박스" 금지**(단일 박스 안에 헤더+본문). 한 화면의 카드는 **모두 같은 클래스**로(좌우 통일).
- **평행 그룹엔 그룹 제목으로 대칭**: 좌/우 열처럼 성격이 다른 묶음은 각 묶음에 **그룹 제목**(아이콘+제목)을 달아 대칭. 한쪽만 제목이면 비대칭=혼란.
- **데이터는 성격대로 배치**: 입력 데이터는 입력 그룹, 분석 결과는 분석 그룹(예: "과목별 점수"=입력이라 분석 열→입력 열로 이동). 출처가 다르면 배지로(예: `학부모 직접 제출`).
- **리스트형 섹션은 불릿**([RichText](src/components/rich-text.tsx) `bulletize`), 산문 섹션은 문단.

**⚠️ 과적용 금지 — 케이스가 다른 곳(여기엔 적용하지 말 것):**
- **동질 목록**(학생·수납·상담 목록 등): 한 행=한 카드로 박지 말 것 → **목록 페이지네이션** 표준(아래) 사용.
- **밀집 그리드**(시간표 매트릭스·출석부 30일): 셀을 박스로 나누지 말 것 → 그리드/엑셀격자 자체 처리.
- **단일 폼/단일 콘텐츠**: 섹션이 1~2개뿐이면 카드 분리가 오히려 노이즈·무거움. 나눌 게 있을 때만 나눈다.
- **칸반형 평행 컬럼**: 이미 위 "다열 보드" 규약으로 영역 구분됨 — 그걸 따른다(중복 적용 X).

> **한 줄 규칙: 이질적 다섹션 = 헤더 카드로 또렷이 + 평행 그룹은 대칭 제목. 동질 목록·밀집 그리드·단일 콘텐츠엔 적용 금지.**

**적용 현황(2026-06-24 전수 서베이 15화면 → needs 5곳만, 케이스 구분):** ✅ 적용 = 등록상담 상세(레퍼런스, 좌 상담기록↔우 AI분석)·
반 상세(좌 반정보↔우 수강중인학생)·퇴원 상세(수강이력 카드 통일)·강사 원스크린(중앙/우측 그룹 제목)·회의록 상세(원본노트 카드)·
도움말(동질 메뉴 13개 개별카드→한 컨테이너 리스트 = **과적용 제거 사례**). ⏭️ 제외 = 학생/직원 상세·대시보드·my-learning·분석
대시보드(이미 카드 양호/경계)·시험상세·시간표·출석부(밀집 그리드)·이탈방어(동질 목록)·owner/billing(FaceTabs)·각종 목록(페이지네이션)·폼.

### 반응형 창 폭 — 넓은창 공간활용 + 좁은창 접힘 (⚠️ 새 페이지 기본값, 2026-06-19)
모든 (shell) 페이지는 크롬리스 iframe(플로팅 창)에서 렌더되고, 창은 **360px(MIN_W) ~ 최대화 시
전체폭(~2300px)** 까지 자유 리사이즈/스냅된다. **창=iframe이라 Tailwind 브레이크포인트
(sm 640 / md 768 / lg 1024 / xl 1280)가 창 폭에 그대로 반응** → 같은 창을 리사이즈하면 레이아웃이
라이브로 바뀐다(미디어쿼리·JS 불필요). 그래서:
- ⚠️ **고정 좁은 `mx-auto max-w-4xl` 중앙정렬은 안티패턴** — 창을 최대화하면 콘텐츠가 그 폭에 갇혀
  좌우 여백이 수백 px씩 비고, 그 안에서도 열이 안 늘어 단일 입력칸만 비대해진다(owner 학원설정이 주범이었음).
- **원칙: 넓은 창은 여백 대신 "열/콘텐츠"로 채우고, 좁은 창(sm 미만)은 단일 컬럼으로 접는다.** max-w를
  막연히 키워 단일 입력이 가로로 폭주하게 두지 말 것.

**pageType별 처방:**
- **설정(탭형 다카드)** = 좌측 세로탭 + 우측 본문 **마스터-디테일**: 바깥 `lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8`,
  nav는 좁으면 상단 가로탭(`flex flex-wrap … lg:flex-col`), 섹션 카드는 `grid gap-4 xl:grid-cols-2`로 펼침.
  **레퍼런스: [owner-console.tsx](<src/app/(shell)/owner/_components/owner-console.tsx>)** (페이지 캡 `max-w-7xl`).
- **설정(비탭 다카드, 예 kiosk-settings)** = `grid gap-6 lg:grid-cols-2 lg:items-start` + `max-w-5xl`(헤더는 그리드 밖 full-width).
- **단일 입력만 있는 폼**(meetings/new, sheets 연결) = 오히려 **`max-w-xl~2xl`로 좁혀 가둔다**(열 늘릴 콘텐츠가
  없어 안 좁히면 한 줄 입력이 폭주). admin/cleanup처럼 짧은 카드 스택은 `grid md:grid-cols-2 xl:grid-cols-3`.
- **데이터 입력 폼**(학생/직원/반/상담) = 필드로 꽉 찬 중앙 `max-w-4xl`는 **OK**(희박한 낭비 아님 — 그대로 둠).
  더 채우려면 필드 grid를 `sm:grid-cols-2 xl:grid-cols-3` / `sm:grid-cols-3 xl:grid-cols-4`로(cap는 유지).
- **list / detail / dashboard** = full-width + `grid lg:grid-cols-[…]` 마스터-디테일(**이미 정석, 손대지 말 것**).
  넘치는 표는 막대스크롤만 두지 말고 **[`DragScrollArea`](src/components/ui/drag-scroll-area.tsx)** 로 감싼다
  (`<div className="… overflow-auto">표</div>` → `<DragScrollArea className="…(overflow-auto 뺀)">표</DragScrollArea>`).
- **student-screen / print / 단일 키패드** = 의도적 `mx-auto max-w-[680~768px]` 유지(읽기 흐름·단일 입력). 넓은창 여백 정당.

**좁은 창(360~480px) 체크리스트** (새 페이지 추가 시 필수):
- 모든 다열 grid가 sm 미만에서 `grid-cols-1`로 접히는가(기본 `grid-cols-1` 명시).
- 편집 헤더(타이틀 + 삭제/이동 버튼)는 `flex flex-wrap items-end justify-between gap-3`(안 그러면 360px서 한 줄에 낌).
- 버튼 그룹(상태칩 등)도 `flex-wrap`(출석 입력폼 6버튼 케이스).
- 가로 오버플로는 BREAKS가 아니라 `DragScrollArea`/`overflow-x`로 흡수(전역 스크롤바 하네스와 병행).

⚠️ **새 설정·폼 페이지를 만들 때 이 규약을 점검** — 특히 `mx-auto max-w-Nxl` 중앙정렬을 기본으로 박지 말 것.
같은 "큰창=펼침 / 작은창=접힘" 패러다임의 칸반 버전은 위 "다열 보드" 섹션 참고.

### 생성 폼은 우측 패널이 아니라 창으로 — autoClose 창 (⚠️ "새 X" 진입점 기본값, 2026-06-19)
"새 반/직원/학생/등록상담/상담/회의록" 같은 생성 폼은 우측 슬라이드 `<Sheet>`를 **쓰지 않는다**. 이미 있는
`/X/new` 라우트를 **플로팅 창**으로 연다(윈도우 패러다임 일관). 트리거는 기존 버튼 마크업을 그대로 두고
[`useOpenFormWindow()`](src/components/workspace/open-window-button.tsx)로 `openFormWindow("/X/new", "제목", e)`만
호출(데스크톱=창, 모바일=풀페이지 네비). 창은 `WindowParams.autoClose`로 열려, iframe이 `/X/new` 경로를
**벗어나면**(=제출 성공 후 서버 `redirect` 또는 `router.push`) RouteWindow가 **창을 닫고 배경을 새로고침**한다
(옛 패널의 "닫고 목록 갱신"과 동일 — 서버액션·폼 로직 수정 0). `ROUTE_WINDOW_SIZE`에 `"X/new"` 폭 등록(옛 패널 폭 계승).
- ⚠️ 콘텐츠용 우측 슬라이드 `<Sheet side="right">`는 **신규 추가 금지** — 창으로 연다. (`Sheet`는 모바일 내비
  드로어 등에 한정.) ⚠️ **정정(2026-06-24 배선 감사)**: `students/_components/student-quick-panel`(+`components/student-quick-popover`)은
  "모바일 peek 폴백 잔존"이라 적혀 있었으나 **실제로는 어디서도 import 안 되는 dead 컴포넌트**(미연결). 제거/재연결은 백로그([`docs/audit-log.md`](docs/audit-log.md)).
- 한계: 배경(메인 프레임) 목록은 `router.refresh()`로 갱신되지만, 목록이 **별도 창**이면 그 창은 즉시
  갱신되지 않음(창 X 버튼 `closeAndRefresh`와 동일한 앱 전반 한계).

### 인쇄(Print) — 인쇄 버튼이 있는 모든 곳은 플로팅 창 + A4 (⚠️ 새 인쇄 표면 기본값, 2026-06-24)
**인쇄 버튼이 달린 모든 곳은 새 브라우저 탭이 아니라 eywa 플로팅 창으로 열고, 결과는 항상 A4로 깔끔히 인쇄된다**
(멀티윈도우 정체성 일관 + 여러 학생 요청서 동시 비교). 플로팅 창=same-origin iframe이고 `window.print()`는 **그 iframe
문서만** 인쇄하며 **창 타이틀바는 부모 프레임에 있어 인쇄에 안 섞인다**(계산기 안내문으로 검증). 인쇄 표면 = 등록상담
인수인계서·회의록·교재요청서(전용 `(print)` 라우트) + 수강료 안내문·지출결의서(이미 창인 in-place `window.print()`).

- **진입점 = [`PrintWindowButton`/`usePrintWindow`](src/components/workspace/print-window.tsx)** (데스크톱=플로팅 창, 모바일=풀페이지).
  **raw `<a target="_blank">` 새 탭 금지.** ⚠️ 창 id는 **명시 `print/<type>/<recordId>`** 로 준다 — `windowIdForHref`가 만드는
  `enrollment/123/print`는 [`routeWindowSize`](src/components/workspace/window-geometry.ts) longest-prefix가 못 잡아 DEFAULT(480×560)로 떨어진다.
  `print/<type>` prefix면 [ROUTE_WINDOW_SIZE](src/components/workspace/window-geometry.ts)에 등록한 A4 세로 크기(`print/enrollment`·`print/meetings`·`print/textbook`)로 매칭.
- **세로 문서 = 루트에 `print-portrait` 클래스.** globals.css의 전역 `@page { size: A4 landscape }`(시간표용)를 `@page portrait-doc`로
  덮어쓴다(opt-in). 시간표는 기본 landscape(인쇄 버튼 현재 없음 — 범위 밖). 비문서 크롬(액션바·FaceTabs·뒤로가기)은 `print:hidden`.
- **전역 인쇄 하네스(globals.css `@media print`)**: 셸/임베드 `<main>`이 `h-screen + overflow-auto`라 인쇄 시 문서를 **한 화면
  높이로 잘라** 2페이지째(예: 환불 규정)가 통째로 사라진다 → `html/body/main`에 `height:auto`·`overflow:visible`·`max-height:none`
  리셋으로 자연 페이지 흐름. (이 리셋 없으면 긴 문서 2페이지째 클리핑.)
- ⚠️ **통짜 `break-inside-avoid` 금지** — 한 페이지보다 높은 섹션에 걸면 통째로 다음 장으로 밀려 1페이지 하단 공백/잘림. 표는
  전역 `tr/td/th { page-break-inside: avoid }`가 **행 단위**로 보호 → 섹션 통짜 회피는 불필요·역효과. 제목 고아만 `break-after-avoid`.
- **닫기 버튼**: 인쇄 라우트의 `window.close()`는 iframe(창) 안에서 무효 → 인쇄 페이지(서버)가 `headers().get("x-embed")`로
  `embedded`를 판별해 prop으로 내려 **embedded면 닫기 숨김**(창 X로 닫음). 인쇄/이미지저장은 유지.
- **새 인쇄 표면 5체크**: ① `(print)` 라우트 또는 이미 창인 문서 ② 루트에 `print-portrait` ③ 비문서 `print:hidden`
  ④ `PrintWindowButton`(id `print/<type>/<id>`) + `ROUTE_WINDOW_SIZE`에 `print/<type>` A4 등록 ⑤ 통짜 `break-inside-avoid` 금지.

> **한 줄 규칙: 인쇄 버튼은 `PrintWindowButton`(id `print/<type>/<id>`)로 플로팅 창을 열고, 문서 루트엔 `print-portrait`, 통짜 break-inside-avoid 금지.**

### 목록 페이지네이션 표준 — 큰 목록은 전부 이 패턴으로 통일 (⚠️ 새 목록 기본값)
실데이터 이전 후 목록이 수백~천 행이 되며 페이지가 22s까지 느려졌다(전 행 fetch + 전 행 렌더).
**행이 수십을 넘을 수 있는 모든 목록은 서버 페이지네이션으로 통일한다.** 스타일·구조를 한 곳에
맞춰 학생·수납·상담이 동일하게 보이고 동작하도록:

- **공용 컴포넌트** [`src/components/pagination.tsx`](src/components/pagination.tsx)의 `<Pagination>` —
  `이전/다음` + `현재/전체` 칩. **인라인으로 nav를 다시 짜지 말 것.** props: `page`, `totalPages`,
  `hrefForPage(p)=>string`. `totalPages<=1`이면 자동으로 null. (서버 컴포넌트끼리 함수 prop 안전.)
- **쿼리 헬퍼 2종** (feature `server/queries.ts`):
  - `getXPage(filters, page=1, pageSize=50): Promise<{ rows, total }>` — Supabase `.range(from,from+size-1)`
    + `.select(cols, { count: "exact" })`. **필터는 가능한 한 SQL로** (eq/gte/ilike/or). 조인 컬럼
    검색은 별도 id 해석 후 `.or("base.ilike.%q%,fk.in.(ids)")` (상담 학생명 검색 참고).
  - **Stat 카드용 경량 집계** — 행을 fetch하지 말고 `.select("*", { count:"exact", head:true })`로 count만
    (학생 `getStudentStatusCounts`, 상담 `getStudentConsultationCounts`). 카드는 페이지가 아니라 **전체**
    기준이어야 하므로 페이지 rows에서 도출 금지.
  - 월 단위처럼 모집단이 이미 작으면(수납 ~400행/월) **한 번만 fetch 후 메모리에서 검색·슬라이스**해도
    됨(수납 `summarizeInvoices` + `filtered.slice`). 이중 fetch만 피하면 됨.
- **페이지 컴포넌트 표준 코드**:
  ```ts
  const PAGE_SIZE = 50;
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total }, counts] = await Promise.all([ getXPage(filters, page, PAGE_SIZE), getXCounts() ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p) => { /* 현재 필터 보존 + p>1일 때만 page= 세팅 */ };
  // 빈 상태 판정은 rows.length이 아니라 total === 0
  // …목록… <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
  ```
- **page 리셋 규칙**: 필터 chip·검색·정렬·월이동 href(`buildHref`/`buildSortHref`)는 **page 파라미터를
  넣지 않는다** → 자동으로 1페이지로. `pageHref`만 `p>1`일 때 `page=`를 세팅. "결과 N건"은 `total`
  (페이지 rows.length 아님), 옆에 `{page}/{totalPages} 페이지` 표기.
- **PAGE_SIZE = 50** 고정(표·카드 공통). 변경 시 전 목록 동시 변경.

---

## 구현 중 실제로 막혔던 점들 (시간순)

미래의 자기/팀이 같은 함정에 빠지지 않도록 기록.

### 1. Next.js 16 — "middleware" 컨벤션 deprecation
`middleware.ts` 사용 시 dev 서버에 deprecation 경고. Next.js 16에서는 `proxy.ts`로 rename됨. 시그니처는 동일하지만 함수 이름이 `middleware` → `proxy`. `src/middleware.ts` → `src/proxy.ts`, 그리고 helper `src/lib/supabase/middleware.ts` → `proxy.ts`로 정리.

### 2. shadcn base-nova preset = base-ui 기반 (Radix 아님)
shadcn `init -d`로 부트스트랩하면 기본이 base-nova preset인데 이건 **Radix UI가 아닌 [Base UI](https://base-ui.com)** 기반. 결과:
- `asChild` prop이 존재하지 않음 → 대신 **`render` prop** 사용 (`<SidebarMenuButton render={<Link href="..." />}>` 형태)
- `TooltipProvider`는 `delayDuration` 아닌 `delay` prop
- `DropdownMenuTrigger`도 `render` prop 패턴

shadcn 코드를 외부에서 복붙해서 가져올 때마다 `asChild` → `render` 변환 필요. 첫 빌드에서 typecheck 5개 에러로 발견.

### 3. Pretendard dynamic-subset이 SVG 텍스트를 못 감지
`pretendardvariable-dynamic-subset.min.css` (CDN) 사용 시 페이지에 등장한 글자만 동적 로딩. 단 **SVG `<text>` 노드 안의 글자는 감지 안 됨** → fallback 시스템 폰트로 일부 글리프 깨짐 ("월"→"원", "수"→"스", "선린중"→"선린종" 같은 자모 수준 변형).

해결: SVG 안 한글 텍스트를 모두 **HTML로 빼서 absolute positioning**으로 align. 또 추후 폰트를 **정적 풀 한국어 subset** (`pretendardvariable.min.css`)으로 전환해서 SVG에 한글이 들어가도 정상 표시.

### 4. SVG viewBox 비례 확대 = fontSize도 확대
`<svg viewBox="0 0 720 180" className="w-full">`에서 컨테이너 width가 ~1300px이면 `fontSize="9"`가 16px+로 렌더됨 ("거대해 보임" 버그의 진짜 원인).

해결: 
- 차트의 X축 라벨을 SVG 밖 HTML로 빼서 `left: ${xPct}%` absolute positioning
- 차트 자체는 `max-w-[860px] mx-auto`로 wrapper 크기 제한해서 SVG의 자연 비례 유지

### 5. postgres-js batch insert의 컬럼 이름
postgres-js의 `sql`insert into table ${sql(rows)}` ` 형태에서 rows 객체의 키는 **DB 컬럼명 그대로** (snake_case)여야 함. JS 측 camelCase로 주면 "column "tenantId" does not exist" 에러.

`{ tenant_id, class_id, ... }` 형식으로 바로 만들어서 전달.

### 6. drizzle-kit이 .env.local 자동 로드 안 함
`drizzle-kit migrate` 실행 시 `DATABASE_URL` 누락 에러. drizzle-kit은 Node CLI라 Next.js의 dotenv 처리를 거치지 않음.

해결: `dotenv` 패키지 설치 후 `drizzle.config.ts` 상단에서:
```ts
import { config } from "dotenv";
config({ path: ".env.local" });
```

### 7. Drizzle migration 번호 vs 손수 RLS SQL의 prefix 충돌
`drizzle-kit generate`가 `0001_*.sql`을 만드는데, 우리가 손수 작성한 RLS 파일도 같은 prefix를 쓰려다가 보면 두 `0001_*`가 됨. drizzle은 _journal.json 기반이라 자기 파일만 인식해서 실행에는 문제 없지만 git에서 헷갈림.

컨벤션: **drizzle 파일은 `0001_*.sql`, 손수 RLS는 `0001a_*.sql`** 같은 alpha suffix. drizzle은 alpha 파일을 무시하지만 우리는 그 파일을 별도로 `node --env-file=.env.local -e "..."` 스크립트로 적용.

### 8. Supabase 새 프로젝트는 IPv4 direct connection이 deprecated
처음에 `postgresql://postgres:PWD@db.{ref}.supabase.co:5432/postgres` (direct connection) URL을 사용했더니 `ENOTFOUND` — 새 Supabase 프로젝트는 **IPv6 전용**이라 IPv4만 라우팅되는 환경에서 안 됨. DNS는 AAAA 레코드만 (`Resolve-DnsName ... -Type AAAA`로 확인).

해결: **Session pooler** URL (`postgres.{ref}:PWD@aws-1-{region}.pooler.supabase.com:5432/postgres`) 사용. region 부분은 dashboard에서 확인 필요 (Seoul = `ap-northeast-2`였고 prefix는 `aws-0`이 아니라 `aws-1`이었음). Transaction pooler (port 6543)는 prepared statement 비활성이라 drizzle-kit과 호환 이슈, 그래서 Session pooler를 사용.

### 9. DB password를 Google OAuth secret과 혼동
사용자가 처음 "db 패스워드"라며 보낸 값이 `GOCSPX-...` 형태였는데 이건 **Google OAuth 2.0 client secret**의 표준 형식 (`GOCSPX-` prefix). Supabase가 자동 생성하는 비번은 그런 prefix 안 씀. 문자열 형식만 보고 "잘못된 키"라고 짚어서 사용자가 진짜 supabase 비번을 다시 보냄.

교훈: 키 형식이 의외이면 사용자 입력을 그대로 적용하기 전에 형식 검증해서 확인할 것.

### 10. Server Action 로그인이 cookie 전파 안 되는 무한 redirect (가장 큰 버그)
사용자 보고: "로그인 후 바로 로그아웃되버린다". Chrome MCP로 재현해보니:
1. 로그인 폼 submit → Server Action `signInWithPassword` 호출 → Supabase가 `sb-{ref}-auth-token` cookie를 set (`base64-...` prefix 형식, length 2799)
2. Server Action이 `redirect("/")` 호출 → 브라우저가 `/`로 navigate
3. middleware (`proxy.ts`)가 그 cookie로 `supabase.auth.getUser()` 호출 → **user `null` 반환**
4. middleware가 `/login`으로 다시 redirect → 사용자에겐 "로그인 직후 자동 로그아웃"

원인 추정: `@supabase/ssr 0.10.x`의 `base64-` prefix cookie 포맷이 Next.js 16 + Vercel 환경의 middleware cookies adapter를 통과할 때 server-side `getUser()`가 cookie를 verify 못 함. 클라이언트는 같은 라이브러리지만 정상 동작.

**해결 (2단계)**:
1. **로그인을 client-side로 전환** — `createBrowserClient`로 `signInWithPassword` 호출. browser SDK는 자체적으로 cookie + localStorage 동기화. 그 후 `router.push(next ?? "/")` + `router.refresh()`.
2. **middleware를 단순화** — `supabase.auth.getUser()` 호출을 빼고 **단순히 `sb-*-auth-token` cookie 존재 여부만** 체크. 실제 user 검증은 `(shell)/layout`의 `getCurrentUser()`가 처리 (같은 cookies adapter지만 layout 컨텍스트에선 정상 작동). RLS가 최종 보안 레이어이므로 등급 동일.

### 11. React Server Component에서 `Date.now()` 호출 lint 에러
새 `react-hooks/purity` 룰이 RSC body에서 `Date.now()`를 catch함. 그러나 RSC는 매 request마다 새로 실행되어 "stable per request"이므로 사실 문제 없음.

해결: `const cutoff = Date.now() - 7 * 86_400_000`을 `// eslint-disable-next-line react-hooks/purity -- server component renders once per request` 코멘트와 함께 사용.

### 12. Lucide React 화살표 아이콘이 한글 자모로 오인됨
KPI 카드의 `<ArrowUpRight className="size-3" />` (12px, default strokeWidth=2)이 작은 화면에서 한글 "ㄱ"/"ㄴ"과 흡사하게 보임. "ㄱ +12 최근 7일" 식으로 읽힘.

해결: `size-3.5 strokeWidth={2.5}`로 굵게 + 살짝 크게. 아이콘 모양이 명확해짐.

### 13. trend window가 오늘 포함하면 0% drop
대시보드 7일 추세 차트가 마지막 점 (오늘)에서 0%로 떨어짐 — 오늘은 attendance 시드 안 됨 + 진행 중인 날이라 의미 없음. delta "-93.3pt" 같은 거짓 정보 표시.

해결: window를 `end = yesterday`로 잡음. "최근 7일"의 의미를 "어제까지 7일"로 (학원 운영 관점에서 자연스러움).

### 14. 시드 변수 중복 선언 (`today`)
attendance loop에서 `const today = new Date()` 사용 후, invoice loop에서 또 `const today = new Date()` 추가 → esbuild parse 에러 "The symbol 'today' has already been declared". 둘 다 같은 함수 스코프.

교훈: seed.ts처럼 긴 함수에서는 변수 이름 prefix를 명확하게 (`invoiceNow`, `enrolledAt` 식으로).

### 15. Drizzle이 GiST EXCLUDE / 부분 인덱스 / generated column을 표현 못 함
- `EXCLUDE USING gist (...)` — Drizzle schema로 표현 불가
- `CREATE UNIQUE INDEX ... WHERE status<>'withdrawn'` — `uniqueIndex` builder는 WHERE 미지원
- `name_normalized text GENERATED ALWAYS AS (...) STORED` — Drizzle generated column 미지원

모두 손수 작성한 `0001a_*.sql` raw 파일에서 추가. drizzle generate는 base 테이블만, 손수 SQL이 후처리.

### 16. UI 자잘한 어색함들 (frontend-design swing 후)
사용자가 "어색해" 피드백한 점들:
- 트렌드 차트가 거대 (viewBox 비례 확대)
- KPI 화살표가 한글 자모로 보임
- 로그인 좌측 패널이 vertical 균형 깨짐 (`justify-between` → `my-auto`)
- Hero 우측 stats 카드가 작음 (`text-sm` → `text-base`, `py-2.5` → `py-3`)
- "선린종" 같은 한글 깨짐 (Pretendard subset)

Chrome MCP로 직접 production을 봐가며 조정한 것들. **자동 fix 후 사용자에게 "맞춰주세요" 묻기 전에 실제로 캡처해서 확인하는 사이클**이 중요.

### 17. Vercel deployment queue / dev 서버 hang
- Push 후 Vercel 빌드가 큐에 대기 (1-2분). 두 번 연달아 push하면 큐에 두 개 쌓임 — 두 번째 push의 결과를 보려면 1-3분 기다림.
- 로컬 dev 서버가 file convention 변경 (`middleware.ts` → `proxy.ts`) 같은 큰 변경 후 hang. 죽이고 재시작 필요.
- 포트 3000을 다른 앱이 점유 (MathGen Vite 등). `PORT=3100 pnpm dev`로 우회.

### 18. Server Component의 cookies() / RSC vs Server Action
Next.js 16의 `cookies()`는 async (`await cookies()`). Server Action에서는 set 가능하지만 Server Component에서는 set 불가. 우리 `lib/supabase/server.ts`의 `setAll`은 try/catch로 swallow (Server Component에서는 무시, Server Action에서는 실제 적용). 이 패턴이 일반적이지만 위 (10) 버그처럼 일부 환경에서 round-trip 깨질 수 있음.

### 19. 시안 디자인 vs 실 운영 도구 갭
시안(Daylight)이 단순 주간 일정 그리드를 가정하는데, 실제 ijw 운영 화면은 강사 × 학생 × 월 매트릭스, 마스터-디테일, 다중 chip 필터 등 정보 밀도가 훨씬 높음.

**해결**: 시안 디자인 토큰만 차용하고, 화면 구조는 ijw 운영 패턴 채택. 시간표 = 강사/요일/교시 + 학생 명단, 출석부 = 학생 × 30일 매트릭스, 학생목록 = 검색 + 과목/상태 chip, 수업관리 = 테이블 + 다중 필터, 수납 = 검색 + 월 selector + 컬럼 정렬 ▼.

### 20. 라운드 디자인 톤 조정
시안의 16px 카드 / 999px pill이 운영 도구로는 과해 보임. **globals.css 한 곳에서 토큰 일괄 축소** (`--radius-xl 16→6`, `--radius-pill 999→4`) + raw 픽셀 radius 7개 파일 (rounded-[7px] 등) 일괄 변경. ijw 직선 위주 톤에 가깝게.

### 21. (marketing) 라우트 그룹과 `/` 경로 충돌
랜딩을 `/`로 잡으려면 기존 `(shell)/page.tsx` (대시보드)와 충돌. Next.js 라우트 그룹은 URL에 영향 없으므로 같은 path 잡으면 conflict.

**해결**: `(shell)/page.tsx` → `(shell)/dashboard/page.tsx`로 이동. `(marketing)/page.tsx`가 `/` 차지. proxy.ts에서 `PUBLIC_PATHS = new Set(["/"])`로 비로그인 통과. 로그인 후 navigation은 `/dashboard`로.

### 22. invoices delete 순서 (시드 재실행)
seed.ts wipe 단계에서 students를 invoices 삭제 전에 지우면 FK 위반. 순서: attendance → invoices → enrollments → student_consultations → enrollment_consultations → students → class_schedules → classes → classrooms → announcements → meeting_minutes → users.

### 23. dev 서버 background 출력 stdout flush 안 됨
PowerShell에서 `pnpm dev`를 background로 띄우고 turbopack의 컴파일 로그를 보려고 .output 파일 read 했을 때, 이미 ready 후 새 GET 요청 로그가 즉시 안 보임. Bash run_in_background는 자식 프로세스 stdout buffer가 line buffered되지 않을 수 있음.

**우회**: 새 GET 직접 curl로 → 상태코드 확인. 또는 dev 서버 logical 통신 (Chrome MCP read_console_messages)으로.

### 24. 시간표 컬럼 폭 (강사 × 다중 요일)
ijw 스타일 기본뷰는 강사 컬럼 안에 가르치는 요일만 sub-column으로 표시. 강사 수 × 평균 2~3요일 → 가로 스크롤 필수.

**해결**: 좌측 4개 컬럼 (교시/이름/학년/학교) sticky `left: 0/40px` 고정. 헤더도 sticky `top: 0`. 컬럼 폭 `min-width: 180px` 부여.

### 25. React 19 `react-hooks/set-state-in-effect` 룰 — setState in useEffect 금지
OS 감지 hook을 `useEffect(() => setIsMac(...))`로 짰더니 React 19 / Next 16의 새 lint 룰이 즉시 차단. setState 동기 호출이 cascading render를 일으킬 수 있어서 권장 안 됨.

**해결**: `useSyncExternalStore`로 리팩토링. `getSnapshot` (client에서 navigator.userAgent 검사), `getServerSnapshot` (false 반환)으로 SSR/CSR mismatch 없이 안전하게 동기화.

```ts
export function useIsMac() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
```

### 26. 모바일 nav `overflow-x-auto` 가로 스크롤바 + 어색한 wrap
좁은 폭에서 14개 메뉴를 `overflow-x-auto + shrink-0` 패턴으로 두면 회색 기본 스크롤바가 뜸. `flex-wrap`으로 바꾸면 wrap은 되지만 그룹 구분선 위치가 어색하고 마지막 줄 우측 공백이 큼.

**해결 (2단계 진화)**:
1. `flex-wrap`로 일단 가로 스크롤바 제거 + `.scrollbar-thin` 유틸로 디자인 톤 스크롤바
2. 브랜드 banner를 자체 행으로 분리하고 메뉴는 CSS Grid `auto-fit minmax(96px, 1fr)` — 모든 cell 균등 너비 + 그룹 구분선 제거

`.scrollbar-thin` 유틸은 globals.css에 한 번 정의:
```css
.scrollbar-thin { scrollbar-width: thin; scrollbar-color: rgba(13,17,16,0.18) transparent; }
.scrollbar-thin::-webkit-scrollbar { width: 6px; height: 6px; }
.scrollbar-thin::-webkit-scrollbar-thumb { background: rgba(13,17,16,0.18); border-radius: 999px; }
```

table.tsx / billing / attendance / kanban-filters / 학생 상세 탭 nav에 일괄 적용.

**진화(이후)**: 사용자 지시로 **전역 하네스화** — `.scrollbar-thin` 옵트인을 `globals.css`의 `*` 전역
규칙으로 승격해 **앱 전체 스크롤바 무조건 통일**. 자세한 규칙은 위 "디자인 시스템 › 스크롤바 — 전역
하네스" 참고. 네이티브 `<select>` 팝업은 CSS가 안 닿으니 드롭다운은 `SearchableSelect`로 통일(드롭다운/셀렉트 규약).

### 27. super_admin layer를 만들 때 깨질 가정 4가지
`users` 테이블은 강력하게 1:1 tenant 매핑 (NOT NULL, RLS도 `auth_tenant_id()`로 강제). SaaS owner 같은 multi-tenant viewer를 같은 테이블에 끼우면 schema가 무너짐.

**결정**: `super_admins` 별도 테이블 신설 — academy 권한과 직교. `chrismathone`은 academy master + super_admin 둘 다 가짐. RLS도 super_admins 자체엔 본인 row select만, write는 service_role 전용.

**multi-tenant read는 service_role 클라이언트로 처리** — `createAdminClient()` (`src/lib/supabase/admin.ts`). RLS bypass라 모든 tenant 데이터 한 번에 조회 가능. (이게 위험해 보이지만, 모든 사용처가 `requireSuperAdmin()` 가드를 거치므로 안전.)

mathlab의 `viewing_tenant` 쿠키 + Zustand 패턴은 매력적이지만 eywa의 RLS 강제를 회피해야 해서 Phase 2로 미룸.

### 28. `(super-admin)` 라우트 그룹 + `/super-admin/*` URL → 폴더가 두 번 중첩
Next.js 라우트 그룹 `(super-admin)`은 URL에 영향 없음. 그래서 `/super-admin` URL을 잡으려면 폴더 구조가:
```
src/app/(super-admin)/super-admin/page.tsx
src/app/(super-admin)/super-admin/tenants/page.tsx
```
바깥 `(super-admin)`은 layout 적용용, 안쪽 `super-admin`은 URL용. 처음에 `(super-admin)/page.tsx`로 짜면 `/` 충돌 (랜딩이 차지함).

### 29. Server Component layout에서 active pathname 못 받음
`(super-admin)/layout.tsx`가 server component인데 사이드바에 active 메뉴 highlight하려면 pathname이 필요. `headers().get('x-pathname')`는 기본 동작 안 함 (Next.js가 자동으로 set 안 함).

**해결**: 사이드바를 client component로 만들어서 `usePathname()` 사용. 작은 인터랙티브 부품이라 client로 빼는 비용 작음.

### 30. invoices 컬럼명 `amount` vs `amount_total`
Super-admin 쿼리에서 `invoices.select("amount")`로 시작했더니 KPI가 "0원" 표시. 실제 schema는 `amount_total / amount_paid / amount_discount` 3개 컬럼. 다른 도메인 코드를 참고하지 않고 추측한 결과.

**교훈**: 새 도메인 쿼리 작성 시 항상 `src/lib/db/schema.ts`에서 해당 테이블 컬럼명을 먼저 확인. typecheck로는 안 잡힘 (supabase 클라이언트는 string-typed).

### 31. seed 가짜 강사가 auth.users에 없음 → auth admin API "User not found"
super-admin Phase 5(사용자 관리)에서 강사 계정에 `auth.admin.updateUserById`(role 변경/비번 재설정/ban) 호출 시 **"User not found"**. 원인: `scripts/seed.ts`가 만든 teacher 5명은 `public.users`에 **직접 INSERT**만 하고 `auth.users`는 거치지 않음 (가짜 이메일 `teacher.xxx@ijw-demo.local`). 즉 로그인·auth 관리 불가능한 "데이터 전용" 레코드.

**영향**: 시간표/출석/수업 등 `public.users`만 참조하는 기능엔 무해. 단 로그인·super-admin 사용자 관리(auth admin API)는 실패. 실 운영 user(`createTenantWithMaster`/`createStaff` = `auth.admin.createUser`로 생성)는 auth 있어 정상.

**교훈**: auth가 필요한 계정은 반드시 `auth.admin.createUser`로 생성 (트리거가 public.users mirror). 데모 강사를 진짜 로그인·관리 가능하게 하려면 seed를 그 방식으로 전환해야 함 (후속).

### 32. seed wipe가 실제 gmail 계정(teacher로 강등된 st2000423)을 삭제 → 로그인 튕김
`db:seed`의 wipe `delete from users where tenant_id=... and system_role <> 'master'`가 academy 시뮬레이션용 teacher였던 `st2000423`(실제 auth 계정)을 `public.users`에서 삭제. auth.users엔 남아 signInWithPassword는 성공하지만 `getCurrentUser()`가 null → `(shell)` layout이 `/login`으로 redirect = "로그인 직후 튕김".

**해결**: seed에 wipe 이후 실제 auth 계정을 명시 복구하는 블록(1c/1d). 또는 그 계정을 master로 두면 wipe 조건에서 보존됨. **교훈**: wipe 조건이 실제 로그인 계정을 건드리지 않도록 항상 점검.

### 33. Chrome MCP 좌표 클릭이 작은 토글의 form submit을 못 트리거
super-admin 라이선스 토글·사용자 비활성화 버튼(작은 `<button type=submit>` 안에 span)을 `computer left_click(ref)`로 눌러도 **server action POST가 안 일어남** (network 0건). 반면 `javascript_tool`로 `button.click()` (native click dispatch)하면 정상 submit + DB 반영.

**진단/우회**: MCP 합성 마우스 이벤트가 작은 버튼의 React form submit을 항상 트리거하진 않음. 검증 시 `javascript_tool`의 `el.click()` 또는 `form.requestSubmit()`로 우회. **실제 사용자 마우스 클릭은 native click이라 정상** — 코드 버그 아님.

### 34. 로그인 폼 autofill이 MCP 입력을 덮어씀
Chrome MCP로 `st2000423` 이메일을 `form_input`한 뒤 로그인 클릭했더니 브라우저 autofill이 직전 `chrismathone`으로 되돌려 엉뚱한 계정 로그인 실패. 

**우회**: `read_page`로 ref 새로 얻은 뒤 `form_input(email) → form_input(password) → click`을 **한 batch**로 연속 실행 (autofill 개입 전에). navigate 후엔 ref가 무효화되므로 매번 새로 얻을 것.

### 35. server action 신규 추가 시 dev hot reload가 stale
Phase 4/5에서 새 server action(`toggleTenantLicense`, `setUserActive` 등)을 추가한 직후 dev에서 호출해도 반영 안 됨. dev 재시작 후 정상. Turbopack hot reload가 새 `"use server"` export를 즉시 등록 못 하는 경우가 있음.

**우회**: server action 추가 후 검증 전 `PORT=3100 pnpm dev` 재시작. (단 이번엔 재시작해도 #33/#31이 겹쳐 진단이 길어짐 — 증상이 여러 개면 하나씩 분리할 것.)

### 36. dev 서버가 build와 동시 실행 시 자주 죽음 + screenshot clip 에러
`pnpm build`를 dev 서버 켜둔 채 돌리면 `.next` 충돌로 dev가 exit 1/7로 죽음 (background task가 "failed"로 뜨지만 실제론 ready였다가 죽은 것). 또 Chrome MCP `screenshot`이 간헐적으로 `clip.scale` 에러(`-32602`) — window resize 직후 발생. 

**우회**: 검증은 dev로, build는 별도 타이밍에. dev 죽으면 `curl`로 확인 후 재시작. screenshot 에러는 잠시 후 재시도 또는 resize 없이 호출.

### 37. Base UI Sheet/Dialog는 React state mount에 시간차 (~1.5–2.5s)
`open={true}` set 직후 `document.querySelectorAll('[data-slot="sheet-content"]').length`가 0 → 1.5~2.5초 뒤 1. Chrome MCP로 sheet open 검증 시 즉시 확인하면 false negative.

**우회**: 클릭 후 `wait 3s` 또는 `setTimeout` 후 sheet count 확인.

### 38. Chrome MCP 전체 버튼 재검증 — `[BLOCKED: Cookie/query string data]`
`javascript_tool`로 칩 필터의 활성 상태를 확인하려고 `location.search`나 `a.getAttribute('href')`(쿼리스트링 포함)를 읽으면 **`[BLOCKED: Cookie/query string data]`** 로 차단됨. 쿼리스트링이 민감정보 유출 경로로 취급되기 때문.

**우회**: 현재 URL은 `tabs_context_mcp`(권위 있는 URL 반환)로, 칩 href 검사는 `find` 툴로. JS 안에서는 쿼리스트링을 절대 읽지 말 것.

### 39. MCP 합성 ref-click이 앵커 내비·React onClick을 항상 트리거하진 않음 (#33 확장)
칩(앵커 링크)·작은 버튼을 `computer left_click(ref)`로 눌러도 내비게이션/`onClick`이 안 일어나는 경우가 잦음 (meetings 상태 칩 → URL 그대로, billing 수정 버튼). #33의 "작은 토글 form submit" 증상과 같은 뿌리 — MCP 합성 마우스 이벤트의 한계.

**우회**: `javascript_tool`의 native `element.click()`은 핸들러/내비를 안정적으로 발화. `<select>`는 `form_input`. **실제 사용자 마우스는 native click이라 정상** — 코드 버그 아님(검증 도구의 한계).

### 40. `read_network_requests`가 base64 `data:image` 포함 시 토큰 한도 초과
AI 호출 0건을 검증하려 `read_network_requests`를 호출했더니 응답에 base64 `data:image/png` 요청이 섞여 **179KB → 토큰 한도 초과**로 파일에 덤프됨. 그 파일을 파싱하려 했더니: 로컬 **`jq`는 깨진 npm shim**(`Cannot find module 'commander'`), **PowerShell `ConvertFrom-Json`**도 임베디드 base64에서 파싱 실패(`':' or '}' expected`).

**우회**: 덤프 파일은 버리고 새 DOM 쿼리로 재확인. (네트워크 목록은 에러 출력에 이미 인라인으로 찍혀 있어 **AI 호출 0건**은 그걸로 확인됨.) 네트워크 검증은 처음부터 필터링된 작은 쿼리로.

### 41. 커스텀 인라인 다이얼로그·아이콘 버튼 탐지
billing 수납 "수정"이 여는 건 `[role=dialog]`/`[data-slot*=dialog]`가 아니라 **커스텀 `div.space-y-4`** (취소/저장 버튼 보유). 표준 셀렉터로는 "다이얼로그 안 열림"으로 오판.

**우회**: 클릭 후 **새로 나타난 취소/저장 버튼 유무**로 다이얼로그 열림을 판정. 아이콘 전용 버튼(수정 등)은 `innerText`가 비어 텍스트 매치 실패 → `aria-label`("수정")로 매치.

### 42. 셀프투어 재검증에서 잡은 진짜 깨진 창문 — 상태 변경 메뉴가 항상 "재원으로 전환…"만
학생 상세에서 휴원·퇴원 학생인데도 상태 변경 드롭다운이 항상 "재원으로 전환…"만 노출. 원인: `students/[id]/page.tsx`가 `StatusAction`에 `currentStatus`로 **한글 라벨**(`STATUS_LABEL[student.status]`)을 넘김 → `status-action.tsx`의 분기가 raw enum(`enrolled`/`on_hold`/`withdrawn`) 기준이라 전부 빗나가 `else`(전환)로 떨어짐.

**해결**: page는 **raw enum** 그대로 전달(`currentStatus={student.status}`), `status-action`은 분기는 enum으로 하고 다이얼로그 표시용으로만 자체 `STATUS_LABEL`로 라벨화. **교훈**: enum 분기 컴포넌트엔 절대 표시용 라벨을 넘기지 말 것 — 표시 변환은 컴포넌트 안에서. 셀프투어에선 이런 "옵션이 틀린 메뉴"가 전형적 깨진 창문.

### 43. Chrome MCP 로그인 — form_input이 React 상태 미동기 + 합성 submit 미발화 (#33/#34/#39 합본)
강사 계정 로그인 검증에서 `form_input`으로 이메일·비번을 채우고 `computer left_click(submit)`을 눌렀는데 **/login 그대로**(제출 안 됨). 두 원인 겹침: (1) `form_input`은 DOM value만 바꾸고 React controlled state의 onChange를 안 태워 제출 시 빈 값일 수 있음; (2) 합성 클릭이 submit을 항상 띄우진 않음(#33/#39).

**우회**: `javascript_tool`로 **native setter + input/change 이벤트 dispatch** 후 `form.requestSubmit()` — React 폼 값 주입의 정석.
```js
const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;d.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));};
set(email,'…'); set(pw,'…'); email.closest('form').requestSubmit();
```
autofill(#34)도 이 방식이면 덮어쓰니 무관. 버튼·드롭다운 클릭도 native `element.click()`이 안정적(예: 사용자 메뉴 → 로그아웃).

### 44. Stage Manager 배경 교체 — `router.push` 직후 pathname 비동기 레이스
플로팅 창 ⇄ 배경(메인 프레임 라우트) 1:1 맞교환 버튼(`SendToBack`). 처음엔 옛 배경 라우트를
`usePathname()`로 읽었는데, `router.push`가 비동기라 전환 완료 전 **연타하면 pathname이 옛 값** →
엉뚱한 배경 탭(유령 `route:admin` 등) 생성.

**해결**: 배경 라우트를 store에 명시 필드(`background`)로 두고 캔버스가 pathname과 동기,
`swapToBackground`는 그 값을 결정적으로 읽고 갱신. + 전환(퇴장 애니메이션) 중 버튼 `disabled`.
**교훈**: 비동기 네비 직후 `usePathname()`에 의존하지 말 것 — 필요한 상태는 store에 명시적으로 들고 동기화.

### 45. 스냅/타일 "해제 시 원래 크기 복원" — applyLayout이 prevRect를 지웠음
Snap Layouts 바·Snap Assist 타일링(`applyLayout`/`applyDragLayout`)이 `prevRect: undefined`로
자유(레이아웃 전) 크기를 **지워버려**, 드래그로 빼도 원래 작은 크기로 못 돌아갔다(최대화만 복원됐음).

**해결**: `Win`에 `snapped` 플래그 추가 → 레이아웃/스냅 진입 시 원본 rect를 `prevRect`에 보존
(이미 snapped/maximized면 최초 원본 유지), 드래그 시작 시 `restoreUnderPointer`(기존
`unmaximizeUnderPointer`를 snapped까지 일반화)로 커서 아래 복원. 수동 이동/리사이즈는 snapped 해제.

### 46. 드래그가 드롭 때만 clamp → 타이틀 가림 + 스냅 바 과민
- 타이틀바 드래그는 이동 중 clamp 없이 **drop에서만** clamp → 타이틀바를 헤더 위로 끌어올려 가릴 수
  있었다. `onPointerMove`에서 `y = Math.max(0, …)`로 상단 클램프(포인터 sy는 계속 위로 갈 수 있어 스냅 바 소환엔 무영향).
- 스냅 레이아웃 바가 `TOP_BAND=150`으로 너무 빨리 떠 "선택만 해도 뜨는" 느낌 → **히스테리시스**
  (소환 ≤44px, 유지 ≤160px)로 "상단에 올렸을 때만" 노출.

### 47. 창 애니메이션 — 지연 언마운트 + 모션 토글 + TS 클로저 narrowing 소실
- 닫기/최소화/배경교체는 React가 **즉시 언마운트**라 퇴장 애니메이션이 없었다 → `exiting` 상태 set →
  150ms 후 실제 동작 실행(`runExit`). tw-animate `animate-out fade-out-0 zoom-out-95`.
- **모션 토글**: `usePrefs`(zustand persist "eywa-prefs"). `motionDisabled()`=설정 **단일 기준**(`!animations`).
  설정 **기본값만** OS '동작 줄이기'를 따르고(`animations: !osReducedMotion()`), 한 번 토글하면 그 값이
  OS를 **덮어씀**(ON이면 reduce-motion이어도 애니메이션 보임). 훅(비-React)은 `usePrefs.getState()` 임의
  읽기로 게이트, 컴포넌트는 구독으로 반응. UI는 UserMenu의 `DropdownMenuCheckboxItem`(`closeOnClick={false}`).
- 가드로 좁힌 타입(`win.params.href`)이 `runExit(() => …)` **클로저 안에서 `string|undefined`로 풀림**
  → 상수로 캡처(`const href = win.params.href`) 후 사용.

### 48. 커밋 분할 — 결합된 변경은 같은 커밋, 파일 단위로만 쪼갬
여러 기능이 같은 파일을 건드리면(`window-store`·`floating-window` 등) **파일 단위로만 분할 가능**
(비대화형 환경은 `git add -p` 불가). 또 강결합 변경(예: `avatar.tsx` 삭제 ↔ `user-menu`의 avatar
import 제거)은 **반드시 같은 커밋**에 — 안 그러면 중간 커밋이 빌드 깨짐.

### 49. 배경 탭 스트립이 선택할 때마다 재정렬 — 스택 순서 ≠ 활성 표시
`setBackground`가 선택된 배경을 `[...filter(id), params]`로 **항상 맨 끝(top)으로 이동**시켜,
탭 클릭(=pathname 변경)마다 캔버스가 이를 호출 → 스트립이 재정렬됐다(사용자: "들어온 순서대로 있어야").

**해결**: 배경 스택은 **삽입 순서로 고정**(append만), "현재 보이는 배경"은 별도 `activeBackgroundId`로 분리
→ 하이라이트만 이동, 배열 불변. 탭 클릭 핸들러는 `setBackground`로 **active를 직접** 갱신(router.push
타이밍에 의존 X; 같은 경로면 pathname 효과가 안 떠 active가 안 바뀌는 사각지대 제거).
**교훈**: "스택/순서"와 "현재 선택"은 다른 상태 — 한 배열의 위치로 둘 다 표현하면 선택이 순서를 흔든다.

### 50. 창→배경 드래그 칩 ↔ 스냅 레이아웃 바 — 같은 상단을 두 어포던스가 다툼
워크스페이스 드래그 어휘를 통일하며(배경 탭↓→창 `backgroundToWindow` / 창→상단 '배경으로' 칩
`swapToBackground` / 레일 아이콘→오른쪽 드래그→드롭 지점에 창 `open`+`setRect`), 창→배경 칩이
스냅 레이아웃 바와 **같은 상단 중앙**을 차지해 충돌. 칩은 **창 1개여도** 떠야 하는데 스냅바는 2개+에서만 뜸.

**해결**: 칩(`backgroundDropZone`)을 스냅바와 **독립**으로 띄우고, 스냅바는 `SNAP_BAR_BG_OFFSET`(44px)만큼
**아래로 밀어** 겹침 회피 — 렌더(`snap-layouts-bar`)와 히트테스트(`use-pointer-drag`)에 **동일 오프셋** 적용
(렌더 +offset, 히트테스트 py −offset). 드래그 훅이 칩 영역을 스냅보다 **우선** 판정. 드롭은
`FloatingWindow`의 `handleSwapToBackground`(router.push + 퇴장 애니메이션)를 콜백으로 재사용. 타이틀바
'배경으로 보내기' 버튼은 그대로 유지(중복 경로 공존). 레일 드래그는 세로 스크롤과 충돌 안 나게 **가로 우세**만 판정.

### 51. dnd-kit `DndContext`는 SSR에서 명시적 `id` 필수 (hydration 불일치)
`@dnd-kit`은 `id`를 안 주면 `aria-describedby="DndDescribedBy-N"`을 **모듈 전역 카운터**로 생성 →
SSR(0)↔CSR(1) 카운터가 어긋나 hydration 경고("attributes … didn't match"). 기능은 정상이나 a11y 연결이 깨짐.
**해결**: `<DndContext id="timetable-dnd" …>`처럼 **안정 id 지정** → SSR=CSR 일치. (timetable-board.tsx)

### 52. 합성 PointerEvent로 워크스페이스 드래그 테스트 — 캡처 메서드 둘 다 stub
`usePointerDrag`는 pointerdown에서 `setPointerCapture`, pointerup에서 `releasePointerCapture` 호출.
합성 `PointerEvent`(가짜 pointerId)는 둘 다 throw → **하나만 stub하면** onPointerUp 첫 줄에서 멈춰
드롭이 적용 안 됨(**테스트 아티팩트, 제품 버그 아님**). `Element.prototype.{set,release}PointerCapture`를
**둘 다** no-op stub해야 정확 재현. 또 드래그 결과 측정은 **outer div의 `.style.width`/rect**로 —
inner dialog `getBoundingClientRect`는 글라이드 트랜지션 중 mistimed(스냅 후 456으로 보였다가 outer는 934).
배경 칩/스냅 셀 위로 가려면 포인터를 먼저 상단(stage sy≤44)으로 올려 reveal 후 셀로 내려야 함.

### 53. 대량 `.in("…id", ids)` = HTTP 414 + error 삼킴 (반복 안티패턴)
수백~수천 개 id를 단일 `.in()`에 넣으면 supabase-js가 GET 쿼리스트링에 전부 직렬화 → URL이 ~16KB+ 한도를
넘겨 **HTTP 414(URI Too Long)** 로 실패한다. 그런데 `const { data } = await …; data ?? []`로 받으면 **error를
조용히 삼켜** 결과가 통째로 비고, 화면은 에러 없이 "정상"처럼 오작동한다(고아탐지가 전 재원생을 오탐, 이탈관리
위험점수가 거짓, export 과목 누락 등). 발견처: admin findOrphans, retention 로스터(5쿼리), students export·
recomputePrimaryTeacher, withdrawals 로스터.
**처방(공용)**: [`src/lib/supabase/batch.ts`](src/lib/supabase/batch.ts) — `fetchInChunks`(id를 100개 청크로 나눠
병렬 `.in()` 후 합침: URL 안전 + 청크당 행이 1000 미만), `fetchAllPaged`(`.range(from,to)` 페이지네이션으로 1000행
한도 초과 전건 확보). **둘 다 `error`를 throw**(절대 `?? []`로 삼키지 말 것). 새 대량 조회는 처음부터 이 헬퍼로.

### 54. PostgREST 기본 max-rows ≈ 1000 — 전건 fetch는 silent 절단
`.in()`/필터 없이 전건을 가져와 JS로 집계(카운트·SUM)하면 PostgREST 기본 1000행에서 **에러 없이 잘린다**
(`config.toml`·max-rows 오버라이드 없음). super-admin `getAllTenants`/`getSaaSStats`가 멀티테넌트 users·students·
invoices를 전건 받아 JS Map으로 세다가 테넌트 증가 시 과소집계. **단순 카운트는 `count:"exact", head:true`,
합계·그룹은 RPC group-by 또는 `fetchAllPaged`로.** "세기만 하려고 수백 행을 JS로 끌어오기"는 신호.

### 55. 창(iframe) ⇄ 배경(메인 프레임)은 **별도 문서** — 저장이 자동 반영 안 됨
플로팅 창은 크롬리스 same-origin iframe(별도 Next 인스턴스). 창에서 server action으로 저장하면 그 **iframe 안**은
revalidate되지만, 이미 렌더된 **부모(배경) 라우트는 stale**(다른 문서라 모름). → 라우트 창을 **닫을 때 부모를
`router.refresh()`**(`floating-window.tsx`의 `closeAndRefresh`)해 배경 목록이 즉시 갱신되게 한다. iframe 제목/경로도
부모가 자동으로 모르므로 `route-window.tsx`가 `contentDocument.title`/`location`을 MutationObserver+popstate로 관찰해
타이틀바에 동기화(`window-store`의 `live`).

### 56. 창 내비게이션 모델 — 루트에선 ← 숨김(닫기=X), 권한 리다이렉트는 루프 주의
- **뒤로(←)는 드릴인했을 때만**(iframe path ≠ 창 루트). 루트(첫 화면)에선 ← 가 "닫기"와 중복이라 숨기고 우상단 X로
  닫는다. 인페이지 "← …로" 백은 임베드(창)에서 숨김(`EmbedProvider`+`<BackLink>`), 배경 풀페이지에선 표시. 닫으면
  부모 새로고침(#55)으로 배경 메뉴가 그대로 드러난다(= 사용자가 기대하는 "창 닫힘").
- **권한없음 리다이렉트는 `/dashboard`로 무조건 보내면 안 됨** — `student`는 dashboard 접근이 `none`이라 `/dashboard`가
  또 막혀 **무한 리다이렉트 루프**. `requireAccess`/`requireSuperAdmin`은 "대시보드 접근 가능하면 `/dashboard`, 아니면
  공개 랜딩 `/`"로 분기(`canAccess(role,"dashboard")`).

### 57. 너비 조절 사이드바 — 드래그 핸들 + 프리뷰 트랜지션 얼음 함정
사용자 요청으로 사이드바에 "접기/펼치기 버튼"을 넣었다가(하단 토글이 계정 줄과 겹쳐 어색) **버튼 대신
오른쪽 경계선 드래그-리사이즈**로 전환(`use-sidebar-resize.ts`). THRESHOLD(120px) 미만으로 끌면 접힘(52px)
스냅, 이상이면 펼침(150~360 클램프). 드래그 중엔 `dragging` 플래그로 `transition-[width]`를 끈다(커서 1:1 추종).
더블클릭=토글, ←/→ 키 + `role=separator`로 접근성. 너비/펼침은 `usePrefs`에 영속.
- ⚠️ **검증 중 "inline `width:240px`인데 computed/getBoundingClientRect는 52px" 미스터리** — 원인은
  **프리뷰 백그라운드 탭의 멈춘 document 타임라인**. 하이드레이션 점프(52→240)가 띄운 width transition이
  `currentTime:0`에 얼어 **inline `!important`까지 덮어쓴다**(러닝 트랜지션이 캐스케이드 최상위). 제품 버그 아님.
  구분법: `MutationObserver`로 style 속성 mutation을 1초 카운트 → 0이면 렌더루프 아님(트랜지션 얼음).
  `el.getAnimations().forEach(a=>a.finish())` 후 측정하거나, 렌더 박스 말고 **inline style + 영속 store**(진실값)를
  읽어 검증. 자세한 환경 함정은 메모리 `reference_browser-verification-env`.

### 58. 권한 게이트는 tenant-aware 헬퍼만 — bare `canAccess`/`accessLevel` 직접호출 금지 (⚠️ 하면 안 됨)
역할/권한 override(owner "역할·권한")는 `getPermMatrix()`(=하드코딩 MENU_ACCESS + tenant override) 매트릭스로만
반영된다. **새 게이트는 반드시** 페이지=`requireAccess`, 라우트=`apiAccess`, 액션=`accessLevelTenant`/`canAccessTenant`,
UI=layout의 `permMatrix` prop을 쓴다. **`canAccess(role,menu)`/`accessLevel(role,menu)`을 매트릭스 인자 없이 직접
부르면 하드코딩 기본만 봐서 owner override를 무시**(write-only-orphan) — 금지. (2026-06-19 전수 감사: orphan 0건 — 깨지 말 것.
bare `canAccess`는 super-admin(권한 직교)·테스트에서만 정상.)

### 59. tenant_settings 직접 쓰기 금지 — owner 단일 진입점 + DB 트리거가 비-master를 막는다
`tenant_settings`(학원 설정·권한 override)는 `saveOwnerSection`(master 게이트)이 유일한 쓰기 경로다. 기능 코드에서
`tenant_settings`를 직접 INSERT/UPDATE하지 말 것 — **0038a 트리거가 `auth.uid()`가 비-master면 raise**(self-escalation
차단). service_role(admin)·직접 DB연결(`auth.uid()` null)만 통과한다. 즉 일반 RLS 클라이언트로 비-master가 쓰면 막힌다.
(읽기는 `getTenantSettings()`→`resolveSettings()` 단일 경로.)

### 60. 권한 폴백은 fail-open 고정 — fail-closed로 바꾸지 말 것 (⚠️ 복구불능 락아웃)
`getPermMatrix`가 `getTenantSettings` 실패 시 코드 기본(master=full)으로 폴백한다. **fail-closed(차단)로 바꾸면
설정 조회 장애 시 master까지 /owner에 못 들어가 override를 고칠 길이 없어진다**(복구불능). #59 트리거로 override가
항상 정당(master 설정)해져 일시 무효의 잔여 위험은 낮다. fail-open은 의도적·최종 결정(perm-matrix.ts 주석에 근거).

### 61. 클라가 import하는 공유 모듈에 `import "server-only"` 금지 — 런타임 상수 누출 빌드깨짐
순수 계산·공유 상수 모듈(`features/billing/{tuition-catalog,quote-calc,holidays-data}.ts`)은 **클라이언트 컴포넌트도
import**하므로 `server-only`를 넣으면 빌드가 깨진다. 특히 **런타임 값(상수/함수)을 server-only 모듈에서 클라로 import
하면** `'server-only' cannot be imported from a Client Component`로 폭발(예: `DISCOUNT_CATEGORY`를 server-only
`*-queries.ts`에서 클라 계산기로 import → 실패). **규약: 타입+런타임 상수+순수함수는 server-only 없는 공유 모듈에,
DB 쿼리만 `server/*-queries.ts`(server-only)에.** 클라는 서버 모듈에서 `import type`(타입만, 빌드시 소거)만 허용.

### 62. 병렬 세션 schema.ts/공유파일 충돌 — 통째 `git add` 금지, 내 hunk만 인덱스에 적용
여러 세션이 `schema.ts`(+ CLAUDE.md·README 등 공유파일)를 **동시에 편집**한다. 통째 `git add <file>`로 커밋하면
**남의 미커밋 변경을 내 커밋이 휩쓸어** 간다. 비대화형이라 `git add -p` 불가 → 충돌 시:
`git diff -- file | awk '내 hunk만 추출' | git apply --cached --recount`로 **내 hunk만 인덱스에 적용**(작업파일 불변 →
상대 WIP 보존). 커밋 후 반드시 `git diff <parent> <commit> -- file`로 **삭제(남의 코드 clobber) 0줄** 확인.
충돌이 없으면(diff가 내 변경만) 통째 add OK. 항상 `git commit -- <명시경로>`로 파일 단위 분리. (이번 세션 schema.ts에
tuition_catalog·tuition_quotes 추가 시 students 0036a와 같은 파일에서 충돌 → 이 방식으로 분리 커밋.)

### 63. 내 커밋 단독 검증 = 격리 워크트리 typecheck (작업트리 전체는 남의 WIP로 깨질 수 있음)
작업 트리 전체 `tsc`가 **다른 세션의 미커밋 WIP**(예: classes `page.tsx` prop 불일치)로 실패할 수 있다 — 내 변경과
무관. **내 커밋만 단독 검증**: `git worktree add --detach /d/tmp/x <commit>` → node_modules 정션 + `next-env.d.ts`
복사 → `./node_modules/.bin/tsc --noEmit`. ⚠️ **정리 순서 함정(Windows)**: 워크트리 제거 전 **정션을 먼저 `rmdir`로
끊어라**(`cmd //c "rmdir D:\tmp\x\node_modules"`) — 안 그러면 `git worktree remove`가 정션을 타고 들어가 **실제
node_modules를 지울 위험** + permission-denied. 또: 다른 세션이 내 커밋 위에 쌓아 push하면 **내 ff push가 "behind"로
거부돼도 이미 내 커밋이 origin에 올라간 정상 상태**일 수 있다(merge-base로 확인 후 종료).

### 64. 같은 탭 다중 창(복제) + 크로스 창/탭 저장 경고 — 창 id 인스턴스 모델·BroadcastChannel·publish 타이밍
사용자 요청으로 (A) **같은 탭을 여러 창으로**(듀얼) + (B) 같은 레코드를 다른 창/탭에서 저장하면 **경고 토스트**를 구현.
핵심 함정·규칙:
- **창 id 인스턴스 모델 (A)**: primary 창 id는 오늘과 동일(`route:students`)로 두고 **복제본만 `#n` 접미사**
  ([`windowId(kind,paramId,instance?)`](src/components/workspace/window-store.ts) + `isDuplicate`/`baseWindowId`/`instanceLabel`).
  영속 레이아웃·배경 매핑이 primary id에 묶여 있어 **primary를 절대 바꾸지 말 것**. `params.id`는 base 라우트(`students`,
  크기·아이콘 매핑)라 **`baseWindowId`(=`route:students`, kind 접두 포함)와 혼동 금지** — `duplicate()`는 `params`를
  통째 복제(`params.id` 보존)하고 화면은 **nav 현재 URL·live 제목**을 따른다(`win.params.href`는 최초 URL이라 드릴인 후
  복제 시 엉뚱한 화면). 진입점 2개: 타이틀바 "복제" 버튼(`duplicate`) + 탭/링크 **shift+클릭**(`openNewInstance`,
  사이드바·SubTab·WindowLink. ctrl/cmd/alt는 브라우저 기본 유지). 사이드바 관리자도구 아래 shift 안내 문구.
- **복제본은 window-only — 배경 가드는 store 레벨에서 (A)**: 타이틀바 버튼 숨김만으론 부족(드래그 훅·스포트라이트 스왑은
  FloatingWindow를 안 거침). `swapToBackground`는 `isDuplicate`면 no-op, `swapFocusedWithBackground`는 복제본이면
  `sendFocused=false`, `use-pointer-drag`/`background-drop-zone`은 `!isDuplicate(id)`로 칩 비활성. "라우트↔배경 1:1" 불변식 보존.
- **저장 경고는 레코드 스코프 + BroadcastChannel (B)**: 키를 라우트/탭이 아니라 **레코드**(`student:123`·`tenant-settings:profile`)로
  잡아 같은 레코드 편집창만 경고하고 무관한 "새 X" 폼끼린 오경고 안 함. [`record-channel.ts`](src/lib/realtime/record-channel.ts)가
  same-origin 모든 iframe·탭을 한 채널로 묶어 **다중 창 + 다중 브라우저 탭 동시 보호**. 토스트는 메시지 받은 그 문서가
  자기 Toaster(루트 레이아웃이 모든 iframe에 마운트)로 띄움 → "그 창 안에" 뜬다.
- **dirty는 onInput 아니라 FormData 스냅샷 (B)**: 반 시간표 토글·학원설정 add/remove는 **버튼→state→hidden input**이라
  `onInput` 미발생. 값 단일 출처인 `new FormData(form)`을 [`serializeForm`](src/lib/realtime/form-snapshot.ts)(정렬 tuple
  JSON, `$ACTION_*` 제외)으로 스냅샷해 비교. 마운트 시 baseline, 저장 후 재스냅샷.
- **⚠️ publish는 "성공 확정 후" — onSubmit(제출 전) 금지 (B)**: `onSubmit`은 서버 액션 실행 전이라 실패 저장도 경고하고
  상대가 저장 전 데이터를 다시 읽을 수 있다. 그래서 `updateStudent/Class/Staff`를 **`redirect()` 대신 `{ ok, redirectTo, nonce }`
  반환**으로 바꿨다(클라가 성공 확정 후 publish→`router.push`). `saveOwnerSection`도 `nonce` 추가(in-window). **effect는
  `state.ok`만 보면 안 됨** — 첫 성공 후 ok가 계속 true라 owner 2번째 저장이 누락 → **`state.nonce` 관찰 + 처리한 nonce를
  ref로 비교**해 매 성공 1회 발화.
- **server-only 금지 (B)**: `record-channel.ts`·`form-snapshot.ts`는 클라 컴포넌트/훅이 import → `server-only` 넣으면
  빌드 폭발([[#61]] 규칙). 둘 다 client 전용 순수 모듈로 유지.

---

## 마이그레이션 & 시드 흐름

> 적용 방식·순서·alpha 파일 목록·**현재 적용 상태(검증 2026-06-16: 번호본 0000~0024 + alpha 전부 적용,
> trgm 색인 11개·RLS 미적용 테이블 0개 확인)**는 [`supabase/migrations/README.md`](supabase/migrations/README.md).
> ⚠️ **2026-06-18 이후 alpha 추가**(드리즐 스냅샷은 `0027_big_swordsman`에 멈춤 — 신규는 전부 손수 alpha, `db:generate` 금지):
> `0027b` 학생메모핀 · `0027d~f` 직원phone/조퇴/학생프로필 · `0027g/h` 시간표포트 RLS·이전 · **`0028a` 시험(exams) ·
> `0029a` 카카오메시징 · `0030a` 교재카탈로그 · `0031a` 운영감사로그 · `0032a` 레벨테스트 · **`0039a` 대시보드 집계 RPC ·
> `0040a` 상담통계 집계 RPC · **`0041a` 시간표 슬롯 라벨**(`class_schedules.slot_teacher_label/slot_room_label` — 영어 통합뷰
> 미니그리드용, ijw slotTeachers/slotRooms 백필)**(전부 dev DB 적용·RLS 격리·security invoker + `auth_tenant_id()` 이중격리).
> drizzle 번호본은 `db:migrate`가 자동, RLS/트리거/확장/GIN trigram 색인 등 `000Na_*` **alpha는 손수** 적용
> (신규 DB 셋업 시 누락 주의).

1. **스키마 수정** — `src/lib/db/schema.ts`
2. **`pnpm db:generate`** — drizzle이 SQL diff 생성 (`supabase/migrations/000N_*.sql`)
3. **손수 RLS/제약/트리거 작성** — `0001a_*.sql` 같은 alpha suffix 파일로
4. **`pnpm db:migrate`** — drizzle이 자기 파일만 적용
5. **`node --env-file=.env.local -e "..."`** 식으로 alpha 파일을 raw SQL 실행 (또는 supabase dashboard SQL editor)
6. **`pnpm db:seed`** — `scripts/seed.ts` 실행. idempotent (테넌트 데이터 전부 삭제 후 재삽입).

## Git 협업 규칙 (⚠️ 여러 세션이 병렬로 작업함)

**여러 Claude 세션·사용자가 동시에 이 repo에 커밋·push한다.** 그래서:

1. **작업 시작 전 항상 최신 커밋 확인**:
   ```bash
   git fetch origin && git log origin/main..HEAD --oneline   # 로컬에 미push 커밋 확인
   git log HEAD..origin/main --oneline                       # 원격에 내가 모르는 커밋 확인
   ```
   origin/main에 내가 모르는 커밋이 있으면 **먼저 그 위로 맞춘 뒤** 작업.

2. **push 전 반드시 최신에 merge/rebase**:
   ```bash
   git pull --rebase origin main   # 원격 최신을 내 커밋 아래로 당겨와 충돌 없이 쌓기
   git push origin main
   ```
   바로 `git push`로 reject되면(`non-fast-forward`) 위 rebase 후 재시도. **force push 금지.**

3. **working tree가 clean인데 "ahead of origin by N commits"** = 다른 세션이 만든 로컬 커밋이 push 안 된 상태일 수 있음. push 전 그 N개가 무엇인지 `git log origin/main..HEAD`로 확인하고, 의도된 것이면 함께 push.

4. **커밋은 작게·자주**. 한 기능 = 한 커밋. 여러 세션이 같은 파일을 건드릴 수 있으니 큰 덩어리는 충돌 위험이 큼.

## 여러 세션 병렬 작업 — 언제 좋고, 어떻게 격리하나

**핵심 원칙: 두 세션이 같은 것을 동시에 *쓰면* 충돌, 다른 것을 쓰면 안전.** 여기서 "같은 것" = 파일 · `.next` · 같은 포트의 dev 서버 · Supabase DB · main 브랜치.

⚠️ **이 repo는 세션들이 단일 작업 트리(`D:/eywa_refactoring`)를 공유**한다 (`git worktree list` 하면 워크트리 1개뿐). 그래서 격리 없는 동시 *쓰기*는 위험:
- **같은 파일 동시 편집** → 나중 쓴 쪽이 덮어씀, 상대 세션의 화면은 stale
- **둘 다 `pnpm dev`** → `.next` 락 충돌·생성파일 손상 (#17/#23 — `routes.d.ts` 깨짐 → `.next` nuke 후 재빌드해야 복구)
- **둘 다 `db:seed`/마이그레이션** → 같은 Supabase를 상호 wipe (seed가 idempotent-wipe라 더 위험)
- **둘 다 push** → non-fast-forward 도돌이표 (위 Git 협업 규칙)

### 병렬이 안전·유용한 경우
- **파일이 안 겹치는 독립 작업** (예: `/billing` ∥ `/meetings`). 단 공유 파일(`globals.css`·`schema.ts`·`navigation.ts`·`permissions.ts`)은 한쪽만 건드릴 것.
- **읽기·탐색 ∥ 코딩** — 한 세션은 쓰기를 안 함.
- **긴 작업(빌드·마이그레이션·긴 AI 호출) 돌려두고** 다른 작업 진행.
- **다른 repo/프로젝트** — 공유 상태 없으니 무조건 안전.

### 진짜 병렬 코딩은 worktree로 격리
```bash
git worktree add ../eywa-billing -b feat/billing   # 별도 디렉터리 + 별도 브랜치
PORT=3101 pnpm dev                                  # dev 서버는 포트 분리 (3100과 다르게)
```
세션마다 자기 worktree(= 자기 `.next`·자기 파일)를 열면 파일·빌드 충돌이 원천 차단되고, 끝나면 브랜치를 merge.
⚠️ **단 Supabase DB·Vercel 프로젝트는 worktree로도 안 갈라진다** — DB 변경(seed/migrate)은 격리해도 동시 금지.

### 오히려 한 세션 안에서가 나은 병렬
"조사하면서 구현"류는 새 세션보다 **서브에이전트(Agent)**(여러 곳 동시 탐색, 결과가 한 맥락으로 복귀) + **백그라운드 실행**이 안전하고 맥락이 안 흩어진다.

**한 줄 규칙: 읽기·탐색은 마음껏 병렬. 쓰기(편집·dev·DB·push)는 "격리됐는가?"를 먼저 확인 — 아니면 한 세션으로.**

## 검증 게이트 (commit 전)

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint
pnpm test        # vitest unit
pnpm build       # next build (Turbopack)
```

네 단계 모두 그린이어야 push. Vercel은 push 후 자동 빌드.

## 데모 로그인 계정 (현재 상태)

| 이메일 | 비밀번호 | 역할 | 용도 |
|---|---|---|---|
| chrismathone@gmail.com | mbplaza2* | master (지점장) | 인재원 지점장. super_admin 아님. **원장용 투어** (12메뉴) |
| st2000423@gmail.com | qkrthtjs1234@ | master + super_admin | SaaS 총괄 (전체 지점 관리) |
| teacher@ijw-demo.com | ijwteacher1! | teacher (박지훈) | **강사용 투어** — 선생님 원스크린. seed가 auth 생성 + wipe-safe 보존 |
| student@ijw-demo.com | ijwstudent1! | student (김서연) | **학생용 투어** — 내 학습 현황 + 데일리 리포트. seed가 auth 생성 + wipe-safe 보존 |

두 master 모두 ijw-demo academy master지만 **super_admin은 st2000423만**. `display_name`은 김수진 / 석태선.
데모 강사/학생은 `scripts/seed.ts`의 `ensureDemoAuth`가 idempotent 생성하고, wipe(#32) 직후 `public.users` 행을
on-conflict로 재upsert한다(강사=박지훈 `TEACHERS[0]`, 학생=김서연). `student`는 `system_role` enum에 없어
시드가 `ALTER TYPE … ADD VALUE IF NOT EXISTS 'student'`로 멱등 추가 후 사용(#31/#32 회피).
`st2000423`을 teacher 등 다른 role로 되돌리려면 admin API 한 번:
```js
fetch(URL + '/auth/v1/admin/users/fcf735fa-edf7-4095-8fa6-724285a018ed', {
  method: 'PUT',
  headers: { apikey: SERVICE_ROLE_KEY, Authorization: 'Bearer ' + SERVICE_ROLE_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_metadata: { system_role: 'teacher', tenant_id: 'becaa316-e636-42e9-9d09-08b133e0b094' } }),
});
// + super_admins 테이블에서 제거: delete from super_admins where email='st2000423@gmail.com'
```

## 남은 작업

### 성능 (최우선)

production 반응속도가 느림. 의심 가는 병목:

1. **Vercel 함수 cold start** — Serverless 함수가 cold일 때 첫 응답이 1-3초. 미들웨어 + RSC가 매번 실행.
   - 대응 후보: 일부 라우트를 `export const dynamic = 'force-dynamic'` 대신 ISR/static로 (가능한 곳)
   - 또는 Vercel Edge runtime (단 `@supabase/ssr` cookies 이슈 재발 가능 — 확인 필요)

2. **Supabase pooler latency** — 서울 region이지만 매 함수 호출마다 새 connection. `postgres-js` connection caching이 함수 인스턴스 안에서만 가능.
   - 대응 후보: Drizzle을 쓰는 server actions은 connection 재사용. supabase JS도 cache.

3. **대시보드 9개 Promise.all** — getCurrentUser + 9개 쿼리 = 10 round-trips.
   - 대응 후보: 단일 RPC 함수로 합치기 (서버 측에서 한 번에) 또는 PostgREST의 cte 기능
   - 또는 Suspense streaming — 위젯별로 비동기 렌더링하여 빠른 위젯 먼저 노출

4. ✅ **(shell)/layout 인증 호출 중복** — `getCurrentUser`/`createClient`를 React `cache()`로 래핑, `requireAccess` 반환값 재활용. (ef53e86 다음 커밋)

5. ✅ **Pretendard CDN 첫 로드** — variable font를 `next/font/local`로 self-host. CDN RTT 제거 + Next 자동 preload + font-display swap.

6. **AI 호출 자체는 느림** (Claude 응답 2-10초). 단 명시적 버튼이라 사용자 기대치 OK. 개선이라면 Suspense + streaming response.

### 기능

1. ✅ **Hero 한글 호칭** — chrismathone → 김수진 원장 (seed에서 display_name 업데이트)
2. ✅ **ijw 운영 패리티** — 시간표 매트릭스 / 출석부 30일 그리드 / 학생·수업·수납 검색·필터 / 4개 메뉴 chip 추가
3. ✅ **제품 중심 랜딩 전면 재설계** (경쟁사 학원조아·makeedu 벤치마크) — "코더 느낌" 탈피, 제품 전면화:
   제품 쇼케이스 Hero(브라우저 프레임 + 플로팅 카드 부유) · 기능 인앱 목업(시간표·출석부·수납) ·
   **워크스페이스 멀티윈도우 차별점(cascade↔1+2 타일 자동재생, 실제 스냅 이징 cubic-bezier(0.22,0.61,0.36,1))** ·
   카피 탈감성화(날짜 서사 제거) · 목업 이름 마스킹(강OO, 개인정보 오해 차단) · 전 모션 reduced-motion 폴백.
4. **pgTAP RLS 테스트** — 두 테넌트 격리 자동 검증
5. **AI 분석 history 보존** — 현재는 UPDATE라 마지막 분석만 남음. 별도 테이블에 INSERT-only로 누적 + history viewer (옵션)
6. **Gemini Flash 통합** — fast-tier 작업이 생기면 비용 절감
7. **시드 확장** — 학생 30→90~248명 (페이지네이션·검색 가치 명확화). Phase 7에서 시드 구조만 잡고 데이터는 그대로 둠
8. **(장기) Firestore → Supabase 마이그레이션 스크립트** — 실제 운영 데이터 전환 시
9. ✅ **검색 데이터 색인** — 완료: **pg_trgm 트라이그램 GIN 색인**(`0024a_search_trgm.sql`, 적용됨 — tsvector 아님: 한국어 부분일치 때문). 커맨드 팰릿이 메뉴(클라) + 학생·수업·상담·등록상담(서버 `/api/search/palette`, `src/features/search/server/queries.ts`, RLS 테넌트 격리, RPC 없이 `.ilike`)을 함께 검색. 한국어 1~2글자는 trgm 효율 낮음(후속 pg_bigm 평가 가능).
10. ✅ **배경 탭 스택(다중 배경)** — 완료: `background`를 스택 배열로(맨 뒤 대시보드). 창 '배경으로 보내기'로 push, 상단 스트립(`background-tabs.tsx`)에서 클릭=전환/우클릭=창으로 꺼내기. 라우트는 창이거나 배경 탭이거나(중복 방지).
11. ✅ **ijw 기능 갭 메우기 P0·P1·P2** — 전수검수 143건 중 P0(막다른 길 9)·P1(일상운영 9)·P2(운영 깊이 7) 완료.
    P2 = 시험모듈(`/exams`)·수강종료추적·급여월별표·수강료계산기·교재카탈로그·운영감사로그·레벨테스트 + 카카오 알림톡 머지.
    상세: 위 "진행 상황 › ijw 기능 갭 P2"(2026-06-18). (남은 P3는 #14.)
12. **데모 시드 갭(P2 신규 테이블)** — `audit_logs`는 mutation 사용 시 자동 채워짐(현재 비어있음). `level_tests`는 비어있음
    (필요 시 시드). 급여 월별표는 활성직원 39명 중 급여설정 1명뿐이라 거의 0원 — 데모용 급여설정 시드 필요. (⚠️ `db:seed`는 POC 데모 wipe — 금지.)
13. **P2 브라우저 실검증** — 시험 일괄입력·계산기·단가표·감사로그·레벨테스트는 **로직 레벨만 검증**(타입/테스트/빌드 그린).
    Chrome MCP 재연결 후 웨일에서 실거동 일괄 검증 필요(역할별 메뉴 노출 포함). [[reference_browser-verification-env]]
14. **ijw 갭 P3(미착수)** — 상담 녹음 AI / QR 공개접수 / 시간표 시뮬레이션 / 엑셀 라운드트립(import) / 지출 결재 +
    급여 정책엔진(과정별 단가·강사 override). 무겁고 데모 임팩트는 P2 < — 우선순위 재점검 후 진행.
15. **drizzle 스냅샷 reconciliation** — `0027b`~`0040a`(P2 테이블 + 설정/계산기/권한 + 집계 RPC)는 전부 **손수 alpha**
    (`db:generate` 금지, #P0-6 드리프트). 0027 시리즈(kiosk·timetable·messaging) 전부 main 안착 후 드리즐 스냅샷
    정식 재산출을 **별도 과제**로. 현재 적용 상태·alpha 전체 목록은 [`supabase/migrations/README.md`](supabase/migrations/README.md) §4·§5(검증 2026-06-20).
16. **시간표 P1(인라인 검색·강사 시간표 색상)** — 병렬 timetable 세션 소관. 이 세션 검토 시점엔 미반영(시간표가 과목×교시
    그리드로 재설계되어 방향이 다름). 그 세션 병합 후 실제 구현 여부 재확인.
