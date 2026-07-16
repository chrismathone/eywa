# 운영실 일일 AI 브리핑 — 구현 계획 확정본 (2026-07-16)

> 배경: 운영실(6962b14 개편)은 LLM 0회 결정론 신호 브리핑이다. 전수 조사(테이블 67·조회 함수 ~168·기존 AI 기능 실사용 ~20건 미만) 결과
> **"버튼형 AI는 안 눌리고, 워크플로에 자동으로 흘러드는 AI만 쓰인다"** 가 실증 결론 — 그래서 본선은 "매일 아침 cron 1회 생성 → DB 저장 →
> 대시보드 표시" 형태다. 원장 승인(2026-07-16): ① 일일 cron AI 호출 허용(테넌트당 1콜/일, 신호 0건 날은 LLM 스킵),
> ② 벨 알림은 **master만**, ③ 대화형(tool-use) 비서는 **보류**(부록 참조, 재검토 전 구현 금지).

## 설계 원칙 (전부 기존 규칙 준수)

- AI 호출 = cron 1회/일 + 명시 "다시 생성" 버튼만. 페이지는 항상 DB 저장분 렌더 (CLAUDE.md AI 정책).
- 숫자·명단 = 결정론 신호(payload), LLM = 서술(narrative)만. 서술은 **후검증 가드(숫자·이름 grounding) 통과분만** 저장, 실패 시 결정론 요약 폴백.
- 대시보드 첫 페인트에 새 무게 0 (B7). 무거운 계산(retention 등)은 전부 cron으로.
- daily_briefings는 **authenticated select 정책 없음**(0074a notifications식) — anon 키 devtools 우회 차단(#77). 서버가 admin으로 읽어 역할 필터 후 렌더.
- payload는 TodayActionItem[] 수준(menuKey·requiredAccess 보존)으로 저장 → 렌더 시 기존 page.tsx 역할 필터 재사용. narrative는 master/admin/manager에게만 렌더.

## 적대 리뷰로 뒤집힌 3가지 (재제안 금지)

1. **retention 신호는 라이브 대시보드 금지** — 위험 점수는 DB 미저장 JS 파생이라 count 불가, `computeRetentionRoster`는 "앱에서 가장 무거운 읽기"(B7 위반). cron이 계산해 payload에 저장.
2. **아침 cron 다이제스트 = "어제 마감 + 오늘 예정"** — 07:00 KST엔 '오늘 무단결석'(session_date=today 행 없음)·'오늘 미작성 보고서'(nowMinutes 게이트)가 구조적으로 항상 0. 수집기에 asOf(기준일·시각) 주입 필수.
3. **RPC 3종(unassigned_enrolled·absence_risk·top_outstanding)은 service_role에서 에러 없이 0행** — auth_tenant_id()가 auth.uid()=null이라 무매치. p_tenant 변형 RPC가 cron의 선행 조건. 검증 = 세션 경로와 동일 행수 대조.

## PR 분할

### PR0 — AI usage 계측 (독립)
- `ai_usage_logs` 테이블(0113a): tenant_id nullable·feature·provider·model·key_name·input/output_tokens·ok·error. RLS = 0108a 읽기전용 변형(select만, write=service_role).
- `callProvider` 반환 `{ text, usage }`로 확장(Upstage `res.usage.prompt/completion_tokens`, Anthropic `res.usage.input/output_tokens` — 현재 버림).
- `GenerateJSONOptions.meta?: { tenantId?, feature? }` + 호출부 feature 스레딩. 기록은 `createAdminClient()` **await+try/catch(reportWarning만)** — floating promise 금지(서버리스 드랍), 실패해도 본 호출 안 막음.
- CLAUDE.md에 "외부 AI 전송 금지 필드"(주민번호·계좌·급여·이력서 form_data·환불 계좌) 명문화.

### PR1 — 신호 수집기 주입 리팩터 + ClassNote 발송 신호 (LLM 무관)
- `getTodayActionSignals`에 `db?: { supabase, tenantId }` + `asOf?: { date, nowMinutes }` 주입(런타임 createClient는 L315 1곳뿐, TimetableDb 계약 복제). admin 주입 시 16개 쿼리 사이트 전부 `.eq("tenant_id", …)` — 하나라도 빠지면 교차 테넌트 누수.
- 새 신호 `classnote-attention`: head:true count 3개(failed·too_old 7일 창 / blocked_shared·name_conflict **창 없음**(실사고 교훈) / processing 10분 멈춤). 라벨 한글만, href=`/lesson-reports?tab=writing`, menuKey=`lesson_reports`.
- 신호 추가 체크리스트(f356de2 역산): today-actions.ts(Raw 필드+push) / action-signals.ts(scope+collectSignal) / page.tsx(scope 배선) / operations-briefing.ts(ACTION_LABEL_BY_KEY) / today-actions.test.ts.

### PR2 — 일일 AI 브리핑 (본선)
- **0114a**: `daily_briefings`(id·tenant_id·briefing_date(KST)·processing_status idle|analyzing|completed|failed·processing_error·payload jsonb·narrative·model_version·generated_at·notified_at·updated_at 트리거, unique(tenant_id,briefing_date)) — select 정책 없음. + **p_tenant RPC 변형 3종**(execute를 service_role로 한정).
- cron `/api/cron/daily-briefing`(vercel.json `0 22 * * *` = 07:00 KST): CRON_SECRET Bearer·force-dynamic·maxDuration 120. 테넌트 열거 = 활성 master/admin/manager ≥1인 테넌트만(sheets-sync식 순회+테넌트별 try/catch). 다이제스트 = 어제 마감 + 오늘 예정 + retention 요약. `generateJSON({tier:"balanced", keyName:"default"})` — 신규 keyName 금지(anthropic 키 폴백 없음 → env 미설정 시 조용히 Solar 강등).
- **환각 가드(순수함수+Vitest)**: narrative의 숫자가 payload 숫자 집합 밖이거나 미등장 인명 등장 → narrative 폐기, 결정론 요약 폴백.
- 알림: `notified_at` 게이트로 **최초 insert 시 1회만**, 수신자 **master만**, type `daily_briefing`(types.ts union + NOTIFICATION_ICON), link=`/dashboard`, IMPORTANT 목록 미등재(벨 배지만). "다시 생성"은 알림 미발송.
- 카드: 신규 `_components/daily-briefing-card.tsx`(page.tsx +2줄, 200줄 규칙). generated_at만 표시(model_version 미노출·KST). 오늘 행 없으면 "오늘 브리핑이 아직 없습니다"(어제 것 위장 금지), narrative만 실패 시 결정론 요약+실패 표시.
- "다시 생성"(master 게이트): enrollment 패턴 복제 — 원자 claim(neq analyzing)+updated_at 5분 stuck 우회+after() 백그라운드. 워처는 **5초 폴링만**(select 정책 없음 → Realtime 불가). 성공 부수효과 없음(#67).

## 사전 체크
1. Vercel cron 슬롯: 이미 3개 등록(문서엔 "Hobby 2개 한도" 기록과 모순). 4번째 배포 거부 시 대안 = (a) 기존 cron 라우트에 스텝 합승 (b) 외부 스케줄러가 CRON_SECRET 호출.
2. env: CRON_SECRET·ANTHROPIC_API_KEY·AI_PROVIDER=anthropic (키 무효 시 조용히 Solar 폴백 전례).
3. 마이그레이션 번호는 push 직전 origin/main 재확인(0111a 중복 실례) + README 표 갱신. DDL은 alpha 수동 + `pnpm db:alphas`.

## 갱신 (2026-07-16 저녁) — 방향: "eywa = 학원 매니저 팀"

원장 피드백 "데이터 정리해서 알려주는 것뿐, 비서 느낌이 아니다" → 방향 확정: **능동 보고 + 대화, 둘 다**.
- **Phase 1 ✅ 구현 완료**: 브리핑 v2 = 매니저 팀 보고(`briefing-team-report.ts`, 0116a `team_report`) — 영역별
  판단+"오늘 할 일" 제안, 위험 학생 스포트라이트(retention `risk.reasons`·`primaryAction` 결정론, LLM은 명단 안에서만 언급).
- **Phase 2 ✅ 구현 완료(2026-07-17)**: 대화 채널 "매니저 팀에게 물어보기" — 운영실 질문 패널(`assistant-panel.tsx`,
  canManageStaff 게이트) + `runAssistantLoop`(`features/assistant/server/loop.ts`) + read-only 툴 9종(`tools-*.ts`,
  기존 queries 래핑·PII 표면 제외·한글 라벨 상류 차단) + 대화 저장(0117a own-row RLS). **모델 = Solar Pro 3 기본**
  (원장 지시 2026-07-17 — OpenAI 호환 function calling 실스모크 통과, ~20–25배 저렴) + 키 오류 시 Sonnet 5 폴백
  (resolveModelChain prefer "upstage"). usage = feature "assistant_chat"(Solar vs Claude 비용·품질 비교 재료).
- **Phase 3 (이후)**: 이벤트 감지 능동 알림(결석 연속·후속조치 D-day·미수 임계) — notifyUsers 재사용.

## 부록 — 대화형(tool-use) 비서 재검토 자료 (Phase 2 설계 재료 — 보류 해제, 2026-07-16)

- 결정 로그 "챗봇 = 의도적 비이식(영구 제외)"의 실체 = ijw의 ChatbotFAB + **Gemini function-calling 에이전트(데이터 조회 툴 15종**: 학생검색·수강·성적·출결·수납·퇴원·상담·시험·숙제 등). 갭 감사 문서에 "(도입하려면 별도 결정)" 명문 — 재도입 문은 열려 있으나 원장 재결정 필요.
- 기술 준비도: `@anthropic-ai/sdk 0.98.0`에 toolRunner·betaZodTool·prompt caching 내장(의존성 추가 불요). 격차 = generateJSON이 단발 JSON 전용(스트리밍·멀티턴·tool 루프·대화 저장 전무) → 별도 진입점(runAssistantLoop) 신설 필요.
- 구조적 이점: features/*/server/queries.ts ~168개 함수가 쿠키 세션 createClient 기반 → **사용자 세션 내에서 tool 루프를 돌리면 RLS·teacher-scope·권한 매트릭스 자동 상속**(service_role 불요).
- 필수 경계: PII(주민번호·계좌·급여·이력서 form_data) tool 노출 금지 / read-only tool만 / reasoning(Opus) 금지 / 페이지 로드 무호출 / #77 공용 게이트.
- 실증 리스크: 기존 버튼형 AI 5종 합산 실사용 ~20건 미만(케어 2/807·상담분석 0/1,542 등) — 대화형도 채택 격차가 최대 리스크.
