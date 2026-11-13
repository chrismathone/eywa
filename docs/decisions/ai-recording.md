# AI 모델 정책 — 녹음·회의 처리 이력

> CLAUDE.md 'AI 모델 정책'에서 옮긴 원문이다(2026-09-23).
> ⚠️ 2026-10-19 Upstage(Solar)를 통째로 뺐다(원장 *"솔라는 빼버려. 두개면 충분"*) — 아래의 Solar 이야기는 그때까지의 기록이다. 지금 회사는 Claude(1순위) · ChatGPT(폴백) 둘 — DeepSeek은 2026-11-12에 뺐다.

### 녹음 분석 = Solar 유지 + 폼 자동입력은 후보정 하네스로 방어 (2026-06-24)
실 ijw 녹음 3건을 aywa 파이프라인에 흘려 ijw(Claude) 저장 결과와 대조한 결론: **전사(AssemblyAI `universal-2`
— ⚠️ 2026-08-06 정정, 원래 `universal-3-pro`라 적혀 있었으나 실측상 그 모델은 한국어 미지원이라 한 번도 쓰인 적이 없다 [[#96]])는
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
- **기둥 B — "전사부터 다시"**([`retryMeetingProcessing`](src/features/meetings/server/actions.ts)): 원본 오디오 재제출.
  [`resolveAudioUrl(path, kind, tenantId)`](src/lib/storage/legacy-audio.ts)가 signed URL을 만든다.
  ⚠️ **2026-07-29 정정**: 옛 ijw 오디오는 07-28에 **Supabase kind 버킷으로 원경로 그대로 이전**됐고 GCS 분기는 제거됐다 →
  tenant·레거시(`{kind}-recordings/…`) **둘 다 Supabase에서 서명**한다. `@google-cloud/storage`·`FIREBASE_SERVICE_ACCOUNT_KEY` 불요.
  순수 판별([`legacy-audio-path.ts`](src/lib/storage/legacy-audio-path.ts), Vitest)은 **kind별 prefix allowlist**(교차접근 차단)+한글 파일명 허용 — 키 모양이 그대로라 계속 유효.
  server-only 회피 위해 순수/IO 분리, `audio-path.ts`는 re-export shim(기존 import 무변경).
  throw는 호출부가 `{error}`로 catch(보존만료 삭제 시 "AI 분석 다시 생성 쓰라" 명확 메시지).
- 검증: typecheck0/lint0/**test464**(legacy-audio-path 5) + 실 E2E(레거시 회의→Firebase signed URL→AssemblyAI 전사 4,880자 / "AI 분석 다시 생성"→Solar→DB `completed`·`solar-pro3`).
- **가독성 후속(2026-06-24)**: 회의 분석 8섹션이 화면·인쇄 모두 `<p whitespace-pre-wrap>`라 Solar의 쉼표/번호 run-on이 한 줄로 쏟아짐 →
  등록상담과 동일하게 **[RichText](src/components/rich-text.tsx) `bulletize`로 전환**(나열형: 안건/결정/액션/발언/우려/다음단계 = list, 요약만 산문).
  화면 [ai-report.tsx](<src/app/(shell)/meetings/[id]/ai-report.tsx>) + 인쇄 [(print)/meetings/[id]/print](<src/app/(print)/meetings/[id]/print/page.tsx>) 통일.
  `analyzeMeeting` 프롬프트에도 줄바꿈·`**강조**` 규칙 추가(모델 협조 시 더 나음, RichText라 미협조도 안전). 실데이터 검증: 번호 run-on → 7~8불릿 정확 분리.
- **전사 가독성(화자 라벨 없는 녹음)**: 옛 ijw 임포트 회의는 **speaker_labels 거의 0개**(40건 중 39건)라 통짜 전사였음 → 순수
  [`breakIntoSentences`](src/lib/text/split-sentences.ts)(종결부호+공백 경계 분리, 소수점·% 안 쪼갬, Vitest 6)로 **문장마다 줄바꿈**.
  [TranscriptSection](src/components/transcript-section.tsx)이 화자 발화·plainText 폴백 둘 다 적용(`whitespace-pre-line`).
- ⚠️ ~~**트레이드오프**: 기둥 B는 aywa↔Firebase 의존이라 **Firebase Storage를 콜드 백엔드로 유지**(완전 삭제 불가)~~ →
  **해소(2026-07-29)**: 오디오를 Supabase로 이전하고 GCS 분기를 제거해 **Firebase 의존 0**(ijw-calander GCP 프로젝트는 삭제됨).
  두 기둥 모두 `FIREBASE_SERVICE_ACCOUNT_KEY` 없이 동작한다 — 프로덕션 "전사부터 다시"에 필요한 건 유효한 전사/AI 키뿐(웹훅이 프로덕션서 돔).

### 회의 화자 정확도 — ijw 화자 임포트 + 직원 연결 편집 + 목록 AI요약 (2026-06-24)
"전사 화자가 실제와 안 맞는다" 제보. **진짜 원인은 AssemblyAI가 아니라 임포트 누락** — ijw `meeting_reports`는 화자 구분
(`speakerLabels` 44/47건, 37건 2명+)·역할(`speakerRoles` 32건 명확)을 잘 해뒀는데 aywa POC 임포트가 **transcription 텍스트만**
가져와 aywa 40건 중 38건이 `speaker_labels` 0개(통짜). 3종 처리:
- **임포트(즉효)**: [`import-meeting-speakers.cjs`](scripts/_poc_migration/import-meeting-speakers.cjs)(멱등·--apply) — ijw firebase
  `meeting_reports` → aywa `meeting_minutes`. 매칭키 `storagePath`=`audio_path`(39/41). `speakerLabels`→`speaker_labels`(구조
  `{speaker,text,start,end}` 일치), `speakerRoles`→`ai_speaker_roles`. **speaker_labels 빈 행만**(멱등) + **roles는 함께 동기화**
  (통짜로 추론된 옛 `{A:전체}`는 새 A/B/C 집합과 안 맞아 교체). 적용: 37행 → 화자 2명+ 32건 복원. ⚠️ firebase-admin은 ijw node_modules
  (`NODE_PATH=D:/ijw-calander/node_modules`), postgres는 aywa 로컬.
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
- 대안: **Gemini 2.5 Flash** — fast-tier 후보, 코드 통합 미구현(⚠️ `GEMINI_API_KEY`는 아무도 안 읽어 2026-09-15 환경변수 정리에서 뺐다. 붙일 때 다시 넣는다).
