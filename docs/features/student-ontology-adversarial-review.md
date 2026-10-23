# 학생 온톨로지 확장 — 푸시 전 적대적 구현 리뷰

- 검토일: 2026-10-23 (KST)
- 검토자: Claude (Opus 5.5), 읽기 전용. 소스·DB 변경, 테스트 실행, 커밋·푸시 없음.
- 대상: 작업트리 `git diff HEAD`(36개 수정 파일) + 새 파일 약 66개. 계획 재검토가 아니라 구현 검토다.
- 기준: HEAD `c9e73eedb`(main 통합 후, 통합분은 onescreen 6개 파일로 이번 변경과 겹침 없음) + 작업트리.
- 상태: **최종** — 배포 담당의 수리(RecordSummary·ExpandableConnections·StoredSummary·score-trend)까지 반영해 검토했다.

## 최종 판정

**APPROVE** (2차 수리 검토 후). B1·B2 모두 해소를 확인했다. M1~M4는 수리됐고(M1은 일일 유효기간을 유지하고 안내만 사실대로 고친 선택), 남은 M5~M10과 문서 메모 D1은 비차단이다. 원본 권한 우회·지점 누수·frozen payload 확산·SQL 기간/중복/다른 반 연결·lease/CAS/한도에서 차단 결함은 없다.

| 구분 | 건수 | 내용 |
|---|---|---|
| 차단(해소 확인) | 2 | B1 긴 서버 액션을 `useTransition`으로 감쌈(#102) · B2 요약 생성 쓰기 경로에 감사로그 없음(원장 규칙) |
| 경미(수리 확인) | 4 | M1 안내 문구 · M2 출결 귀속 정본 일치 · M3 검색 제외 메모 AI 차단 · M4 위임 근거 ID 일치 |
| 경미(잔여·비차단) | 6 + 문서 1 | M5~M10, D1 |

이력: 1차 판정은 "B2 반영을 조건으로 APPROVE"였다. 아래 "2차 수리 최종 검토" 절이 이를 갱신한다.

원본 권한 우회, 지점(tenant) 누수, 다른 강사 뷰 범위 확장, 개인 frozen payload 확산, current-scope SQL의 기간·중복·다른 반 연결, lease/CAS/일일 한도에서 **재현 가능한 결함은 찾지 못했다**(근거는 "검토 범위와 반증 결과" 절).

## 차단 결함

### B1. 긴 서버 액션을 `startTransition(async …)`로 감싸 그동안 화면 이동이 멈춘다 (#102 같은 계열)

- 위치: `src/features/student-contribution/components/record-summary.tsx:10-19`(수리 전), `src/features/student-contribution/components/expandable-connections.tsx:13-21`(수리 전).
- 공격 경로: 기여도 상세에서 `최근 기록 요약하기` 클릭 → `generateStudentRecordSummary`가 최대 45초(+ 원본 재조회) 도는 동안 같은 창의 `원생 목록`·`원본에서 보기`(EmbedLink) 등 라우터 이동을 누르면, React가 진행 중 비동기 트랜지션과 같은 갈래로 묶어 **액션이 끝날 때까지 커밋하지 않는다**(`docs/gotchas.md:1248-1255`). 네트워크에는 목적지 RSC가 200으로 와 있는데 화면은 그대로 → "버튼 무반응".
- `ExpandableConnections`의 `기록 펼치기`(출결 90일·성적·MCS 학습 지도·영상 등 7개 원본 병렬 조회)도 같은 모양이다. 짧지만 MCS 반 시트 조회가 끼면 수 초.
- 덧붙여 `#102`의 라우터 대기열 주석(`docs/gotchas.md:1256-1258`): 트랜지션을 빼도 **같은 화면의 다른 서버 액션**(요약 생성 중 `기록 펼치기`)은 앞 액션이 끝날 때까지 줄을 선다. 이 부분은 문서화된 잔여 한계로 남겨도 되지만 진행 표시가 "불러오는 중…"에서 오래 머물 수 있다는 점을 알아 둘 것.
- 기대 수리: 트랜지션 없이 이벤트 핸들러에서 호출, 진행 표시는 `useState`(+중복 클릭 방지). → **해소 확인**(아래 "수리 범위 최종 검토").

### B2. 요약 생성(DB 쓰기 + 외부 AI 전송)에 감사로그가 없다

- 위치: `src/features/student-contribution/server/summary-actions.ts:13-44`.
- 규칙: 원장 2026-09-09 *"기능이 추가되거나 변동되는건 모두 감사로그에 남도록"* (기억 `feedback_audit-log-every-feature`: "새 서버 액션·RPC가 DB에 쓰면 그 자리에서 `logAction`"). 같은 기능의 다른 쓰기 액션은 모두 남긴다(`server/actions.ts:31,43,63`, `referral-actions.ts:46`).
- 재현: 원장 계정으로 요약 생성 → `student_ontology_summaries`에 행 저장 + `student_ontology_summary_daily_usage` 증가 + 학생의 상담·메모 발췌가 Claude로 전송되지만 `audit_logs`에는 아무 줄도 없다. "오늘 20회를 누가 썼나", "이 학생의 상담 내용을 누가 외부 AI로 보냈나"를 되짚을 수 없다(`ai_usage_logs`는 기능·지점·토큰만 남고 학생·요청자 단위 추적이 아니다).
- 기대 수리: 성공·실패(한도 초과·근거 검증 실패 포함) 모두 `logAction({ action: "student_contribution_summary_generate", targetType: "student", targetLabel: 학생 이름, metadata: { studentId, outcome, itemCount, inputHash, model } })` — 원문·발췌 본문은 metadata에 넣지 않는다. 새 action 키는 감사로그 화면의 한글 라벨 맵에도 추가(raw 키 노출 금지).
- 성격: 데이터·보안 결함이 아니라 원장 규칙 위반이다. 배포 판단은 원장/배포 담당에게 맡기되, 수리 비용이 작아 푸시 전에 넣는 것을 권한다.
- 1차 확인 시점에는 `logAction` 호출이 없었다. → **2차에서 해소 확인**(아래 "2차 수리 최종 검토").

## 경미·의견 (비차단)

- **M1. 요약 자정 무효화 + 거짓 안내** — *2차: 안내 수리, 일일 유효기간은 유지(선택)* — `summary-input.ts:16-17`의 해시에 `day: context.today`가 들어가고, 수강 항목의 `relationProof`에도 `asOf: today`가 들어간다. 23:50에 생성한 요약이 00:00 KST가 지나면 원본이 그대로여도 `stale`이 되고, 화면은 "원본이나 열람 범위가 바뀌어 이전 요약을 표시하지 않습니다"(`record-summary.tsx`)라고 사실과 다른 이유를 말한다. CLAUDE.md AI 원칙("마지막 결과는 DB에 보존되며 '갱신' 버튼을 다시 누르기 전까지 그대로 표시")과도 어긋나고, 지점당 하루 20회 한도를 매일 다시 쓰게 만든다. 날짜·`asOf`를 해시에서 빼고 원본 ID·본문·상태만 해시하면 정확성(원본이 바뀌면 무효)은 그대로다. 그렇게 하지 않으려면 안내 문구를 "날짜가 바뀌어 다시 확인이 필요합니다"처럼 사실대로.
- **M2. 출결 귀속 표시가 단일 소스와 두 곳에서 갈린다** — *2차: 수리 확인* — `src/features/students/ontology/attendance-axis.ts:11-14`. ① 과거 날짜에서 인계 이력(audit)이 열린 구간 A인데 현재 `classes.teacher_id`가 B면, 정본 `homeroomTeacherOnDate`(`classes/teacher-as-of.ts:80-81`, "현재 값이 우선")는 B, 여기서는 A를 넘겨 A가 나온다. ② `source: "homeroom"`인데 `live-attendance.ts:42`가 "시간표 기준: 이름"으로 표기(담임 폴백은 시간표가 아니다). 과거 날짜 + 인계 이력 없음은 정본이 현재 담임, 여기는 "담당자 확인 필요"인데 이는 계획의 "현재 담당자를 과거로 대체하지 않음"에 따른 의도라 수용 가능. 표시 전용이며 급여·출결 값에는 영향 없음.
- **M3. 검색 제외(민감) 메모도 AI 입력에 들어간다** — *2차: 수리 확인* — `live-records.ts:11`은 `searchable`을 보지 않는다. 0250a 주석상 이 토글은 "민감한 메모는 토글을 꺼서 뺀다"의 용도다. 외부 AI 전송은 검색보다 넓은 노출이므로 `summarySources`(`students/ontology/summary.ts:13-19`)에서 `searchable=false` 메모를 빼는 것을 권한다(현재 전송 금지 필드 위반은 아님 — 정책 판단).
- **M4. 위임 근거 ID가 화면과 SQL에서 다르다** — *2차: 수리 확인* — TS(`live-enrollments.ts:46`)는 `classId:userId:from:to` 합성값, SQL(`0446a:94`)은 `class_delegations.id`. 표시·근거 링크 전용이라 비차단이지만 "같은 사실 = 같은 원본 ID" 계약에는 어긋난다.
- **M5. 담당 범위 조회 실패가 페이지 오류가 된다** — `fact-access.ts:18`이 엄격판(`strictDelegation=true`)으로 바뀌어 일시 장애 시 throw → `CurrentConnections`/월별 패널이 오류 경계로 간다. "실패를 0명으로 위장하지 않는다"는 의도와 테스트(`fact-access.test.ts`)가 있으므로 수용. 대상은 학생 열람이 `scoped`이면서 기여도 게이트를 통과하는 소수 계정뿐.
- **M6. 한도는 '시도' 단위이고 provider 호출 단위가 아니다** — 같은 회사 기본 모델 재시도가 끼면 예약 1회에 Claude 호출 2회가 될 수 있다. 문서의 "횟수 통제"와 실제 비용 상한 해석에 주의.
- **M7. `supabase/.temp/`가 추적 밖인데 무시 목록에도 없다** — `git check-ignore`로 확인. 경로 명시 커밋 규칙(#62)상 섞일 가능성은 낮지만 `git add` 대상에서 빼야 한다.
- **M8. 현재 관점 선택 목록이 허용 학생 전원을 내려보낸다** — `0446a:117-123`의 `options`에 학생 노드 전부(실측 331명)가 들어간다. 열람 범위 안이라 누수는 아니며 95ms로 성능 문제도 아직 없다. 학생 수가 커지면 학생 선택은 검색형 서버 조회로 분리할 후보.

## 검토 범위와 반증 결과

### 원본 권한 우회·지점·다른 강사 뷰
- 모든 현재 연결 읽기는 `getLiveContext`(`live-context.ts:12-24`)를 지난다: UUID 형식 → `getContributionGate`(시범 지점 + 기여도·수납·실험실) → `readableFactStudents`(학생 메뉴 none이면 빈 집합, scoped면 담임·교시·위임 반 ±60일) → 학생 존재·테스트·병합 확인. 클라이언트는 사용자 세션(`createClient`, RLS 적용) + 모든 쿼리에 `tenant_id` 필터.
- 원본 탭 대조: 상담·후속조치는 원본 `getStudentConsultationHistory`와 같은 `effectiveTeacherId()` 상담자 필터(`queries.ts:1531-1541`)에 `consultations` 메뉴를 추가로 요구 — 원본보다 좁다. 출결·기존 보강은 `attendance`, 셔틀 `shuttle`, 학부모 글 `lesson_reports` + 모듈 모드, MCS는 `mcs` + `requireMcsClassAccess`, 성적은 `getUnifiedGrades`의 `effectiveTeacherScope`, 영상은 `requireAccess("students")` + `getStudentById`. 진도 보고서(회수 포함)·메모 조회 조건은 원본(`getStudentLessonReportsPage`, `getStudentMemos`)과 같다.
- 형제: 열람 가능 학생만 이름을 싣고 건수도 그 기준이라 존재 여부가 새지 않는다. 연락처는 선택만 하고 화면·AI로 보내지 않는다.
- 새 보강관리: `getMakeupCases`(사용자 클라이언트) 재사용, 지점 보기에서 닫힌 메뉴를 admin으로 우회하지 않음. 설정 조회 실패(`foldedReason`)를 `off`로 바꾸지 않음.
- 지점 보기(운영 콘솔): 쓰기는 `canWriteTenant`의 `isTenantViewWriteBlocked`로 `requireContributionWrite`에서 막히고, `generateJSON`은 `assertTenantViewOutboundAllowed`를 거친다. 0445a 트리거가 요청자 지점 불일치도 거절.
- 다른 강사 뷰: 게이트가 `getCurrentUser({ teacherView: true })` 기준이라 강사 역할로 내려가면 기여도 메뉴가 닫히고, 열려 있어도 `canWrite`는 owner만이다.

### private frozen payload
- `student-months.ts:46-55`: 최신 저장본을 먼저 고른 뒤(`latestStudentSourceFacts`) **병합 전 원본 학생 ID로** `canReadFactSource`·`canResolveFactSource`를 적용하고, payload는 `facts/coverage/subjects/correctionReasons/corrections/evidenceIds`만 명시적으로 만든다(`relations` 등 나머지는 스프레드하지 않음). `corrections`는 모든 원본 학생을 읽을 수 있을 때만. 화면 소비처(`student-panel.tsx`)가 쓰는 필드와 일치.
- 관점 캐시(`ontology-cache.ts`)는 최신 저장본 선택 → 끊긴 병합 격리 순서라 지워진 최신본 뒤의 옛 본이 되살아나지 않는다. 캐시 키에 읽기 범위·격리 목록·버전(v3) 포함.
- 긍정 신호 인용: `signal-display.ts`가 원문 해시·소유 학생·판정 시각·인용/작성자/분류를 현재 원본과 대조. 원본 확인 실패 시 신호는 남기되 인용·작성자·취소 사유를 지운다. `judged_at`↔`recordedAt`은 둘 다 PostgREST 문자열이라 형식 차이로 전부 가려지는 일은 없다(`model/ontology-facts.ts:91-95`).

### summary 권한 재검증 / lease / CAS / 일일 한도
- 생성: `requireContributionWrite` → 고정 조회 묶음(가족 제외, 허용 목록 5종, 민감 패턴 항목 제외) → 라이선스·전용 키 → 0445a 존재 확인 → lease(`claimSummary`: ON CONFLICT DO NOTHING 삽입, 아니면 `request_token is null or requested_at < now-120s` 조건 갱신) → 24KB 상한 → 원자 예약 → `generateJSON`(Claude 전용, fast/low, 45초 신호) → 발췌 검증(입력 원문의 연속 부분 문자열, 중복 itemId·민감 패턴 거절) → **원본 재조회 해시 비교** → 토큰 일치 시에만 저장(CAS) → finally에서 자기 토큰만 해제.
- 경쟁: 같은 요청자 동시 클릭은 삽입 충돌/조건 갱신으로 한 쪽만 lease. 만료 뒤 다른 요청이 가로채면 앞 요청의 `finishSummary`가 토큰 불일치로 실패(덮어쓰기 없음). 생성 중에도 이전 결과는 보존·표시.
- 일일 한도: `ON CONFLICT DO UPDATE … WHERE attempts < 20 RETURNING` — 충돌 행 잠금 후 최신 값으로 WHERE 재평가라 원자적. 실패 호출도 차감(문서와 일치).
- 표시: 매 요청 `getLiveContext`로 현재 권한, 현재 원본으로 해시·계약 버전 비교, 발췌가 현재 원문에 실제로 있는지 재검증. 어느 단계든 실패하면 본문 없이 `stale`/`unavailable`. 요청자별 행이라 다른 사용자 요약이 보이지 않는다.
- 0445a: RLS on + 정책 0 + anon/authenticated 회수, 예약 함수는 service_role 실행만. 트리거가 학생·요청자 지점 일치 검사. 결과 크기·해시 형식 제약.

### current-scope SQL (0446a)
- 기간: 재원 = `start<=today and (end is null or end>today or (end=today and not transferred))` — `isEnrollmentOnRosterOn`(`enrollments/eligibility.ts:18-25,58-77`)과 동치. 위임 `revoked_at is null and from<=today<=to` = `isDelegationActiveOn`. 교시 `valid_from<=today<=valid_to`(포함) = `activeOn`/`liveValidTo`. 휴원 포함, 숨은 보강 반·종강일 지난 반·테스트 학생 제외.
- 중복: 인원·반·과목·강사·연결 수는 전부 `count(distinct …)`. 같은 반 두 수강 행(일반 종료 당일 + 같은 날 새 수강)은 학생 행 안에서 반 하나 + `enrollmentIds` 2건으로 묶인다.
- 다른 반 연결: `connections`는 (학생, 반) 쌍이 선택 범위(`scope_roster`)에 있을 때만 센다 — 강사 보기에서 그 강사 학생의 **다른 반·다른 강사**로 번지지 않는다. 학생 행의 반 목록도 `scope_roster`만.
- 범위: service_role 전용 실행, `p_tenant`를 모든 표에 재적용, 학생은 서버가 넘긴 열람 가능·정본 ID만. 응답은 `validateLiveScope`가 허용 학생 밖 ID·건수 모순을 거절. 과목 라벨은 서버가 학원 설정으로 바꿔 raw 키 노출 없음.
- 배포 담당 실측(운영 RPC 331명/93반/17강사/2과목, 95ms, 권한 16항목)과 사전 대사 일치는 이 판정과 모순 없음.

### 회귀
- `getDelegatedClassIdsInRange`·`teacherClassScopeStrict` 새 인자는 기본값이 종전 동작. 기존 호출부 영향 없음.
- MCS: `id`/`sourceId`/`source` 추가 — 저장 스키마(zod 기본 strip)·`learningGoalPlanKey`(필드 지정 비교)에 섞이지 않음. `math_learning_goals.id`·`math_learning_track_goals.id`는 0269b/0269c에 있다.
- 수강 타임라인 `sourceIds` 추가 — 다른 소비처(`enrollment-history.ts:77`)는 스프레드만, 테스트는 `objectContaining`.
- 기여도 디렉터리의 `is_makeup_pool=false`(not null 컬럼) — 명단 포함 여부는 수강 키로 정해져 그대로이고, 과목 목록·반 라벨에서만 숨은 반이 빠진다. 집계·마감 경로는 이 함수를 쓰지 않는다.
- 보강 `ReadResult.reason` 추가는 선택 필드.

## 수리 범위 최종 검토

### `record-summary.tsx` · `expandable-connections.tsx` (B1 수리)
- 두 컴포넌트 모두 `useTransition`을 빼고 이벤트 핸들러에서 서버 액션을 직접 `await`, 진행 표시는 `useState`, 중복 실행은 `useRef` 가드로 막는다(`record-summary.tsx:10-23`, `expandable-connections.tsx:50-62`). `finally`에서 가드·표시를 함께 내리므로 실패·예외에도 버튼이 잠긴 채 남지 않는다. → #102 규칙("트랜지션 없이 부르고 진행 표시는 useState")과 일치. **B1 해소.**
- 새 회귀 테스트(`record-summary.test.tsx`)는 요약 대기 중 다른 트랜지션이 커밋되는지와 중복 호출 1회를 검증한다. jsdom에서 Next 라우터 대신 `useTransition` 셸로 흉내 낸 것이라 실제 라우터 대기열(아래 M9)까지 보장하지는 않는다.
- 비차단 메모: 서버 액션이 이미 `revalidatePath`로 현재 페이지 트리를 돌려주므로 성공 뒤 `router.refresh()`는 한 번 더 왕복하는 중복이다(해는 없음).

### `stored-summary.tsx`
- `RecordSummary key={studentId}` — 다른 학생으로 바뀌면 메시지·진행 상태가 초기화된다. 이전 학생의 액션은 서버에서 계속 돌 수 있으나 CAS·요청자별 행이라 다른 학생 화면에 섞이지 않는다. 문제 없음.

### `model/score-trend.ts` (카드 172.66 / 추이 172.65 차이 수리)
- 원인 판단이 맞다: 종전은 달마다 `scoreRaws(...).total`(부동소수)을 더했고, 카드는 전 기간 정수 원자료 합에 배점을 한 번 적용한다. `scoreRaws`는 선형(`raws × points / 100,000`)이고 원자료는 `assertRaws`로 안전 정수가 강제되므로, 새 방식의 마지막 점은 **카드와 같은 정수 합에 같은 연산**을 하게 되어 정확히 같다(`score-trend.ts:12-16` ↔ `student-panel.tsx` 카드 계산).
- 빈 달은 0 원자료로 채우고(종전과 같음), 음수 정정은 `sumRaws`가 정수 그대로 더한다. 정렬을 함수 안에서 다시 해 입력 순서에 의존하지 않는다. 병합 전 학생에게만 있던 달(원자료 0)도 종전과 같이 점 하나로 들어간다.
- 소비처는 `student-panel.tsx:22` 한 곳이며 종전 반복문을 그대로 대체한다. 다른 화면(목록 합계 등)은 이미 원자료 합 방식이라 영향 없음.
- **M9(비차단)**: `change`는 그 달 원자료의 점수라, 표시 반올림(소수 둘째 자리)에서 `이전 누적 + 이번 달 증감`이 `이번 누적`과 0.01 어긋나 보일 수 있다(예: 1월 0.01 + 2월 0.075→"0.07" ≠ 누적 "0.09"). 종전에도 있던 반올림 성질이고 카드와 추이 끝점 일치라는 이번 목표와 무관. 툴팁·막대가 서로 더해 보이는 화면이면 `change`를 "표시된 누적의 차"로 정의하는 선택지가 있다.

### 그 밖의 확인
- 통합된 main `c9e73eedb`는 onescreen 수학 보고서 6개 파일만 바꿔 이번 변경과 겹치는 파일이 없다. `HEAD..origin/main` 추가 진행 없음(검토 시점).
- 1차에 읽은 서버·SQL 파일은 그 뒤 바뀌지 않았다(수정 시각 대조). 따라서 1차 판정(B2 미해소, M1~M8)은 그대로 유효하다.
- **M10(비차단)**: 요약 생성 중 같은 화면의 다른 서버 액션(`기록 펼치기`)은 Next 라우터 대기열 때문에 요약이 끝날 때까지 기다린다(`docs/gotchas.md:1256-1258`). 화면 이동은 막히지 않는다. 긴 대기가 문제가 되면 요약 생성을 라우트 핸들러 + `fetch`로 옮기는 것이 다음 수다.

## 2차 수리 최종 검토 (B2 · M1~M4)

검토 대상: 보고서 작성 이후 바뀐 파일 17개(`summary-actions.ts`·`audit/describe.ts`·`audit/server/log.ts`·`slack/activity-catalog.ts`·`record-summary.tsx`·`summary.ts`·`live-contract.ts`·`live-records.ts`·`attendance-axis.ts`·`live-attendance.ts`·`classes/server/delegation.ts`·`live-enrollments.ts`와 관련 테스트). 범위는 넓히지 않았다.

### B2 감사로그 — 해소
- `summary-actions.ts:15-52`: `requireContributionWrite` 통과 직후 감사 객체를 만들고, 바깥 `finally`에서 한 번만 `logAction`을 부른다. 조기 반환(원본 열람 불가·기록 없음·라이선스·키·표 없음 = `unavailable`, 임대 경쟁 = `busy`, 24KB = `input_limit`, 한도 = `quota`, 원본 변경 = `source_changed`), 예외(`failed`), 성공(`saved` + 발췌 수·모델) 전부 기록된다. 안쪽 `finally`(임대 해제)가 먼저 돌고 그 뒤 기록하므로 순서도 맞다.
- 권한 거절은 감사 객체가 `null`이라 기록하지 않는다 — 지점 보기·다른 강사 뷰에서 쓰기가 생기지 않는다. 생성 액션의 다른 거절과 같은 결이라 수용.
- 실패한 기록이 성공 응답을 덮을 위험 없음: `logAction`은 내부에서 모든 예외를 삼킨다(`audit/server/log.ts:689-724`). 지점 보기 중이면 운영 감사 로그로 가지만 그 경로는 쓰기 게이트에서 이미 막힌다.
- metadata는 학생 ID·결과·입력 해시·AI 요청 여부·발췌 수·모델 라벨뿐이고 원문·발췌 본문이 없다. 화면 상세(`describe.ts:813-817`)는 결과를 한글로만 보여 주고 해시·내부 코드를 노출하지 않는다(가드 `model/summary-audit.test.ts`). 액션 라벨(`log.ts:58`) 추가로 raw 키 노출 없음. 슬랙은 같은 기능의 다른 키와 함께 `FORBID_KEYS`에 넣어 학생 기록 요약 사실이 외부 채널로 나가지 않는다.
- 비차단 메모: `targetLabel`이 "학생 기록 요약" 고정이라 감사로그 목록에서 학생 이름이 보이지 않는다(학생 ID는 metadata에 있음). 학생 이름을 감사 대상 칸에 싣지 않은 선택은 개인정보 측면에서 보수적이라 그대로 둬도 된다. `providerRequested=true`는 "예약 후 호출을 시작함"이며 provider 쪽 실제 도달까지 뜻하지는 않는다(예: `generateJSON` 안의 라이선스·지점 보기 차단).

### M1 요약 일일 무효화 — 안내 수리, 정책 유지
- 해시에 날짜를 그대로 두고(일일 근거 유효기간 유지) `stale` 안내를 "기준 날짜·원본·열람 범위가 달라져 …"로 바꿨다(`record-summary.tsx:33`). 자정 경계에서도 사실과 맞는 문구가 됐다.
- 남는 트레이드오프(비차단): 원본이 그대로여도 매일 다시 생성해야 하고 하루 20회 한도를 그만큼 쓴다. CLAUDE.md의 "갱신 버튼 전까지 그대로 표시"보다 엄격한 쪽이며, 현재 수강 관계가 날짜 기준 사실이라는 근거로 선택한 것으로 본다. 시범 운영에서 재생성 빈도가 문제면 그때 재검토.

### M2 출결 귀속 — 수리 확인
- `attendance-axis.ts:10-14`: 근거가 있을 때(오늘이거나 그 날짜를 덮는 인계 구간이 있을 때)는 정본 `homeroomTeacherOnDate(history, currentTeacher, date)`를 그대로 부른다 → 열린 구간이 현재 담임과 어긋나면 현재 값이 우선이라는 정본 규칙과 일치. 과거 날짜에 근거가 없으면 `null`(계획의 "현재 담당자를 과거로 대체하지 않음"). 첫 인계 이전 날짜는 정본도 `null`이라 갈리지 않는다.
- `live-attendance.ts:42`: `homeroom` 출처는 "담임 기준", 교시 담당은 "시간표 기준", `taught_by`는 "기록상 귀속", 자리는 "자리 수업"으로 분리됐다. 정본과 남는 차이는 "과거 날짜 + 인계 이력 없음" 한 경우뿐이며 의도로 문서화된 동작이다.

### M3 검색 제외 메모의 AI 차단 — 수리 확인
- `live-records.ts:11-16`이 `searchable`을 읽어 `searchable !== true`(거짓·미상 모두)인 메모에 `summaryExcluded`를 달고, `summarySources`(`summary.ts:15`)가 그 항목을 AI 입력에서 뺀다. 화면 열람은 그대로.
- 생성 뒤 메모를 검색 제외로 바꾸면 그 항목이 입력에서 빠져 해시가 달라지므로 저장된 요약은 `stale`로 숨는다. 표시 검증도 현재 입력에 있는 itemId만 받는다. → 사후 철회까지 막힌다.
- `searchable` 칸은 0250a(2026-09-08)부터 운영에 있어 [[#95]] 위험 없음.

### M4 위임 근거 ID — 수리 확인
- `getActiveDelegationsForClasses`가 `id`를 함께 읽고(`delegation.ts:126-141`) 현재 연결 화면이 그 값을 근거 ID로 쓴다(`live-enrollments.ts:46`) → SQL(0446a의 `d.id`)과 같은 원본 ID.
- 공용 함수 변경의 회귀: `id`는 선택 필드로만 추가했고 PK라 컬럼 부재 위험이 없다(같은 쿼리가 이미 `.order("id")`). 다른 소비처(`attendance/live/server/actions.ts`, `cross-notify.ts`)는 필드를 읽지 않으며, 단일 소스 가드(`teacher-axis-single-source.test.ts`)는 호출 문자열만 검사한다. 값이 비면 `""`가 되어 `validateLiveSection`이 그 항목을 `partial`로 거른다 — 거짓 근거가 되지 않는다.

### D1 문서(비차단)
- `docs/features/student-ontology-expansion.md:67` 표에 "새 RPC는 로컬 준비 상태"가 남아 있다. README·결정 문서는 운영 적용으로 갱신됐으므로 이 한 줄도 맞추면 좋다.
- 구현 기록에 이번 수리 셋(요약 생성 감사로그, 검색 제외 메모의 AI 차단, 요약의 일일 근거 유효기간)이 아직 적혀 있지 않다. 다음 사람이 "왜 날짜가 바뀌면 요약이 사라지나"를 다시 물을 자리라 한 줄씩 남길 것을 권한다.

## 잔여 한계

- 테스트·타입 검사·빌드를 실행하지 않았다(지시대로 읽기 전용). 수치·실측은 배포 담당의 보고를 인용했다.
- 직원별 실제 계정(개인 예외·수납 차단·scoped)으로의 화면 대조, 실기기 모바일, 실제 Claude 발췌 품질은 이 리뷰 범위 밖.
- `getHomeroomHistoryIndex`·`loadStudentSiblings`·`getMathSheetMonth` 등 재사용 원본 함수의 내부는 기존 코드로 신뢰했다.
