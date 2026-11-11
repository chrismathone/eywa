/**
 * 마이그레이션에는 있지만 2026-11-06 운영 스냅숏(DB 지도 작성 기준)에는 아직 없던 표 — 적용되면 보기가 저절로 생기고(SQL §5),
 * 비서는 이 설명으로 읽는다. 표를 새로 만들면 여기(또는 tables-a/b)에 한 줄 — 가드 `catalog.test.ts`.
 */
import { FACTORS } from "@/features/student-contribution/model/factors";
import type { AssistantTableDoc } from "./types";

/**
 * 원생 기여도 요인 중 앱이 조회 때 자동으로 계산하는 번호(`student-contribution/server/factor-query.ts`) — 이 값은 DB에 저장하지 않는다.
 * 바뀌면 같이 고친다(가드 `catalog.test.ts`가 factor-query.ts와 대조한다).
 */
export const AUTO_CONTRIBUTION_FACTORS = ["F01", "F02", "F06", "F08", "F09", "F13", "F35", "F39", "F40", "F42"] as const;
const FACTOR_NAMES = FACTORS.map((f) => `${f.id} ${f.name}(${f.unit})`).join(" · ");

export const TABLES_EXTRA: readonly AssistantTableDoc[] = [
  {
    name: "shuttle_vehicle_positions",
    label: "셔틀 위치",
    ko: "셔틀 운행 중 기사 폰이 보낸 차량 위치 기록(위도·경도·시각)",
    notes: "ran_on = 운행 날짜 · run_id = shuttle_runs 운행 · received_at = 서버가 받은 시각(화면의 'N초 전' 기준) · measured_at = 폰 시계 기준(틀릴 수 있다).",
    internal: true,
  },
  {
    name: "student_care_commitments",
    label: "상담 약속",
    ko: "학부모 상담에서 한 약속(누가 · 언제까지) — 상담 약속·인계",
    notes:
      "state: open=진행 중 · completed=완료 · cancelled=취소. owner_id = 맡은 직원(users.id) · due_on = 기한 · source_id = 출처 입학상담(enrollment_consultations) · document = 약속 내용(jsonb) · version = 고친 횟수. 기한 지난 약속 = state='open' and due_on < 오늘(한국 날짜).",
    columns: { owner_id: "맡은 직원", due_on: "기한", source_id: "출처 상담", document: "약속 내용(jsonb)" },
  },
  {
    name: "student_contribution_factor_records",
    label: "기여도 요인 기록",
    ko: "원생 기여도 42개 요인 중 직원이 손으로 넣은 값의 학생·월별 기록 — 값 · 근거 · 고친 이력",
    notes:
      "직원이 손으로 넣은 값만 쌓인다. 고칠 때마다 새 줄(version 1, 2, …) — 같은 학생·달·요인은 version이 가장 큰 줄이 마지막 손 기록이고, 그 줄이 measured·na면 화면은 자동 값보다 이 손 기록을 쓴다. " +
      "state: measured=직원이 넣은 값(value — 숫자 또는 글자) · na=해당 없음 · reset=손 기록을 거둠(자동 계산 요인이면 자동 값으로, 아니면 '아직 측정 안 함'으로 돌아간다). " +
      `🔴 앱이 조회할 때 자동으로 계산하는 요인(${AUTO_CONTRIBUTION_FACTORS.join("·")})의 자동 값은 DB에 저장되지 않는다 — 이 표에 줄이 없는 게 보통이니, 줄이 없다는 것만으로 '기록 없음'이라 하지 않고 그 값의 원래 자료(청구·출결·숙제·성적 등)를 조회해 본다. ` +
      `month = 'YYYY-MM' 글자 · evidence = 근거 글 · actor_id = 기록한 직원(users.id) · recorded_at = 기록한 때. 요인 번호를 원장에게 그대로 쓰지 않고 이름으로 쓴다: ${FACTOR_NAMES}. 학생×월 원래 수치는 student_contribution_months.`,
  },
  {
    name: "student_care_events",
    label: "약속 이력",
    ko: "상담 약속의 변경 이력(만들기·고치기·확인·증거·완료·취소)",
    notes: "kind: create=만들기 · revise=고치기 · acknowledge=확인 · evidence=증거 · complete=완료 · cancel=취소. commitment_id = student_care_commitments.id · actor_id = 한 사람 · created_at = 한 때.",
  },
  {
    name: "withdrawal_report_refund_decisions",
    label: "환불 결정",
    ko: "퇴원보고서 퇴원월 뒤 청구 줄마다 원장이 정한 환불 승인·환불 없음(s2_0037)",
    notes:
      "group_id = 퇴원보고 묶음(withdrawal_report_groups) · report_id = 결정한 화면의 보고서 · line_key = '<청구 id>#<줄 식별값>'(all = 청구 전체 · unalloc = 줄에 배분 안 된 납부 · unalloc:<과목들> = 과목 수강종료 몫(비율 추정) · unalloc:~<과목들> = 그 과목 몫을 뺀 나머지) · decision: refund=환불 승인(document_id = 데스크 환불 요청서 academy_documents) · none=환불하지 않음 · decided_by = 정한 원장(users.id) · decided_at · paid_net = 결정 때 그 줄 낸 돈(이어진 요청서 총 환불금액 상한의 재료) · paid_seen = 원장이 마지막으로 본 낸 돈(늘면 다시 결정) · supersedes = 이 결정이 대체한 옛 요청서 id · separate_amount·separate_at·separate_by = 환불을 마친 줄에 그 뒤 낸 돈이 늘어 원장이 '늘어난 몫은 수납에서 따로 처리'로 정한 금액(누계)·시각·원장 · refunded_total·refunded_docs = 이어진 요청서에 완료일자가 처음 들어갈 때 남긴 환불 완료 기록(다시 환불 승인하면 상한 = 낸 돈 − 따로 − 완료 기록). 결정은 묶음마다다(취소된 옛 묶음의 결정은 새 묶음에서 세지 않는다). '환불' 결정의 요청서를 지우면 그 줄은 다시 결정 안 됨. 묶음의 refund_hold = 환불 결정 대기(처리 보류) · refund_undecided = 결정 안 된 줄 키.",
    columns: { line_key: "청구 줄 키", decision: "refund=환불 승인 · none=환불하지 않음", document_id: "환불 요청서", decided_by: "정한 원장", paid_net: "결정 때 낸 돈(상한 재료)", paid_seen: "마지막으로 본 낸 돈", supersedes: "대체한 옛 요청서",
      separate_amount: "늘어난 몫을 수납에서 따로 환불하기로 한 금액(누계)", separate_at: "따로 환불로 정한 시각", separate_by: "따로 환불로 정한 원장",
      refunded_total: "이어진 요청서 환불 완료 기록(누계 · 완료일자를 비워도 남음)", refunded_docs: "환불 완료 기록을 남긴 요청서" },
  },
  // ── 신규생 90일 정착 관리 · 신규 콜&상담 여정(aywa-next 이식 · s2_0061~s2_0063 — 2026-11-11).
  {
    name: "student_onboarding_feedback",
    label: "신규생 피드백",
    ko: "신규생 90일 정착 관리 — 담임이 단계(첫 적응·30·60·90일)마다 남긴 적응 피드백과 관리자 확인·후속 조치",
    notes:
      "student_id = 학생 · subject = 과목 키('general' = 생활·종합) · stage: d7 첫 적응 · d30 · d60 · d90 · author_id = 쓴 사람(담임 또는 관리자) · condition: good 잘 적응 중 · watch 관찰 필요 · help 지원 필요 · summary = 관찰 내용 · next_action/next_due = 다음 조치와 기한(함께 있거나 함께 없다). review_state: pending 확인 대기 · confirmed 확인 완료 · revision 보완 요청(reviewed_by · reviewed_at · review_note) · response = 보완 요청에 대한 작성자의 보완 보고. followup_result/followup_at/followup_by = 후속 조치 처리 결과(followup_at이 비어 있으면 아직). 끝나지 않은 후속 조치 = next_action <> '' and followup_at is null · 기한이 지난 것 = 거기에 next_due < 오늘. 콜 완료 여부는 student_onboarding_checks.",
    columns: { stage: "d7·d30·d60·d90", condition: "good·watch·help", review_state: "pending·confirmed·revision", response: "보완 보고", next_due: "다음 조치 기한", followup_at: "후속 조치를 끝낸 시각", version: "고친 횟수" },
  },
  {
    name: "student_onboarding_followup_events",
    label: "신규생 이력",
    ko: "신규생 적응 피드백·담당 배정을 넣거나 고칠 때마다 남는 변경 이력",
    notes: "scope = 바뀐 표 이름(student_onboarding_feedback · student_onboarding_subject_assignments) · entity_id = 바뀐 기록(피드백 id · 배정은 학생 id) · document = 그때의 사본 · actor_id = 저장한 직원. 지금 값은 원래 표를 본다.",
    internal: true,
  },
  {
    name: "student_onboarding_manager_defaults",
    label: "신규생 기본담당",
    ko: "신규생 관리 콜의 과목별 기본 관리 담당자(과목마다 한 명)",
    notes: "subject = 과목 키 · manager_id = 기본 담당 직원(users.id). 학생·과목마다 따로 정한 것은 student_onboarding_subject_assignments(직접 지정이 이긴다).",
  },
  {
    name: "student_onboarding_subject_assignments",
    label: "신규생 담당",
    ko: "신규생마다 과목별 관리 담당 지정(과목 기본 담당을 따르거나 직접 지정)",
    notes:
      "student_id × subject 한 줄 · mode: default = 과목 기본 담당을 따름(manager_id 없음 — 담당자는 student_onboarding_manager_defaults에서 찾는다) · manual = 직접 지정(manager_id = 담당 직원 · 비어 있으면 '미지정'으로 정한 것). 줄이 없는 학생·과목은 과목 기본 담당이 있으면 그 사람, 없으면 미지정.",
    columns: { mode: "default=기본 담당 따름 · manual=직접 지정", manager_id: "직접 지정한 담당 직원", version: "고친 횟수" },
  },
  {
    name: "enrollment_journey_records",
    label: "상담 여정",
    ko: "신규 콜&상담의 전화·방문·등록 확인 기록 — 확인 근거가 있는 것만(상담 하나에 여러 줄)",
    notes:
      "consultation_id = 신규 콜&상담(enrollment_consultations). document(jsonb): kind = call 전화·온라인 상담 · visit 방문 예약·결과 · registration 등록 확정 / status = connected 상담 완료 · unanswered 연결 안 됨 · scheduled 방문 예약 · completed 실제 방문 완료 · no_show 노쇼 · cancelled 취소 · confirmed 등록 확정 / purpose = new 신규 입학 · returning 재입학 · existing 기존 재원 상담 · unknown 대상 확인 필요 / happenedOn = 실제 일자 · scheduledOn = 예정일 · ownerId = 담당 직원(users.id) · evidence = 확인 근거 · nextAction·nextDue·nextDoneOn = 후속 업무·기한·완료일. voided = true면 잘못 넣은 기록(집계 제외). 실제 방문 = document->>'kind'='visit' and document->>'status'='completed' and document->>'purpose' in ('new','returning') and voided = false · 날짜 = document->>'happenedOn'(없으면 scheduledOn). 변경 이력은 enrollment_journey_revisions.",
    columns: { consultation_id: "신규 콜&상담", document: "기록 내용(jsonb)", voided: "집계 제외 여부", version: "고친 횟수", actor_id: "마지막으로 저장한 직원" },
  },
  {
    name: "enrollment_journey_revisions",
    label: "여정 이력",
    ko: "콜&상담 여정 기록을 저장할 때마다 남는 버전 기록(수정 사유 포함)",
    notes: "record_id = enrollment_journey_records.id · version · document·voided = 그 버전의 내용 · reason = 수정·제외 사유(첫 저장은 빈 값) · actor_id = 저장한 직원. 지금 값은 enrollment_journey_records를 본다.",
    internal: true,
  },
  // ── 2026-11-11 실제 기록으로 이은 화면(aywa-next 이식 · s2_0048~0051) — 업무 작성센터 · 관찰 기록 · 조직·OKR · 스키마 스튜디오.
  {
    name: "academy_work_records",
    label: "업무 문서",
    ko: "업무 작성센터에서 직원이 쓴 업무 문서(주간 보고·기획안·연수·인수인계·개선 제안) — 문서마다 최신 한 줄",
    notes:
      "author_id = 작성 직원(users.id) · version = 고친 횟수 · document(jsonb): template(weekly 주간 업무보고 · proposal 기획안 · training 교육·연수 · handover 인수인계 · improvement 개선 제안 · free 일반) · title · date(기록 날짜) · plan · action · result · next · state(draft 작성 중 · submitted 검토 요청 · reviewed 확인 완료 · cancelled 취소) · reviewNote(검토자 확인 의견). 제출된 문서 = document->>'state' in ('submitted','reviewed'). 변경 이력은 academy_work_record_events.",
    columns: { author_id: "작성 직원", document: "문서 내용·상태(jsonb)", version: "버전" },
  },
  {
    name: "academy_work_record_events",
    label: "업무 문서 이력",
    ko: "업무 문서를 저장·검토할 때마다 남는 변경 기록(버전별 문서 사본)",
    notes: "record_id = academy_work_records.id · actor_id = 그 버전을 저장한 직원(작성자 또는 검토자) · version · document = 그 시점 문서 · request = 저장 요청 원문(재시도 판정용). 지금 상태는 academy_work_records를 본다.",
    internal: true,
  },
  {
    name: "academy_knowledge_records",
    label: "관찰 기록",
    ko: "현장 관찰·후속 조치·운영 목표·운영 보완 자료 — 고칠 때마다 새 버전이 쌓인다(수정·삭제 없음)",
    notes:
      "🔴 같은 기록(record_id)의 **가장 큰 version 한 줄**이 지금 값이다(지난 버전은 이력). author_id = 처음 쓴 직원 · actor_id = 그 버전을 저장한 직원. document->>'kind': observation(학생 관찰 — studentId · signal 관찰 항목 · value 수치 · fact 사실 · interpretation 해석 · severity 1~3 · state submitted 검토 요청/confirmed 확인됨/withdrawn 철회 · reviewNote 검토 의견) · action(후속 조치 — ownerId 담당 직원 · due 기한 · plan · result · state open/done/cancelled · originId 원인 관찰) · okr(운영 목표 — baseline·target·actual) · population(학교·학년 전체 학생 수) · balance(재무상태) · content(콘텐츠 성과) · staffing(업무 시간·인원). 확인된 관찰만 규칙 판정에 쓴다(본인 관찰은 다른 검토자가 확인한다). 조직·OKR 화면의 목표는 organization_okr(다른 표).",
    columns: { record_id: "기록 번호(버전끼리 같다)", version: "버전(가장 큰 값이 최신)", author_id: "처음 쓴 직원", actor_id: "이 버전을 저장한 직원", document: "기록 내용(jsonb · kind로 종류 구분)" },
  },
  {
    name: "organization_okr",
    label: "조직 OKR",
    ko: "조직·OKR 화면의 목표 — 담당자 본인이 쓰는 목표·핵심결과·실행 과제·주간 점검과 관리자 피드백(목표마다 최신 한 줄)",
    notes:
      "owner_id = 담당 직원(users.id) · parent_id = 상위 목표 · document(jsonb): scope(organization 조직 · team 팀 · individual 개인) · state(draft 기획 · active 실행 중 · closed 마감 · archived 보관) · title · from~through(기간) · krs[](핵심결과 — title · baseline · target · actual 실적(null=미측정) · unit · measuredOn · source: manual 직접 입력/tasks 과제 완료율/work 업무 문서 건수/lessons 수업보고서 건수) · tasks[](실행 과제 · status) · checkin(주간 점검 — date · result · confidence: blocked=지원 요청). review(jsonb) = 관리자의 마지막 피드백(note · verdict acknowledged 확인/revise 보완/support 지원 · reviewerId). 실적은 저장할 때 다시 센 값이다(실시간 아님). 변경 이력은 organization_okr_revisions.",
    columns: { owner_id: "담당 직원", parent_id: "상위 목표", document: "목표 내용(jsonb)", review: "관리자 피드백(jsonb)" },
  },
  {
    name: "organization_okr_revisions",
    label: "OKR 이력",
    ko: "조직·OKR 목표를 저장하거나 피드백할 때마다 남는 버전 기록",
    notes: "record_id = organization_okr.id · action: save=담당자 저장 · review=관리자 피드백 · actor_id = 저장한 직원 · document/review = 그 시점 사본. 지금 값은 organization_okr를 본다.",
    internal: true,
  },
  {
    name: "academy_model_versions",
    label: "모델 정의",
    ko: "스키마 스튜디오에서 고친 항목 정의·연결 점검 기준·근거 있는 참고 연결(버전이 쌓인다)",
    notes: "key별 가장 큰 version이 지금 값. document->>'kind': field(시트 항목의 이름·필수 여부·설명) · expectation(주체 유형마다 있어야 할 기록의 최소 개수) · link(두 기록 사이 참고 연결 — from · to · basis 근거 · date 확인일 · state). 학원 운영 수치가 아니라 지식그래프의 설정이다.",
    internal: true,
  },
  // ── 원생상담 평점(s2_0044 · 2026-11-11) — 병합 뒤 가드가 설명 없는 표로 잡아서 채웠다(같은 모양의 수업보고서 평점 표 설명을 따랐다).
  {
    name: "student_consultation_ratings",
    label: "상담 평점",
    ko: "원생상담 기록의 AI 평점(참고용, 1~5) — 상담 1:1 · 평점 스위치를 켠 지점만",
    notes:
      "consultation_id → student_consultations. points 1~5(기록의 정성·구체성 — 행이 없으면 평점 없음) · reason·evidence = 근거 글 · kinds = 상담 사유 태그 배열 · checks = 사유·맥락·대응·다음 단계 칸의 상태(present · not_recorded = 기록에 없음(실제로 없었다는 뜻 아님) · not_applicable · unclear) · rule: empty = 빈 양식 1점 · copied = 같은 글 여러 학생 3점까지(코드 규칙이 정한 점수) · basis: memo = 상담자가 쓴 기록 · recording = 녹음 전사문 · source: cli = 일괄 평점 · batch = 정기 처리 · rated_on = 평가일.",
    columns: { points: "평점 1~5", rule: "코드 규칙이 점수를 정했을 때의 규칙", basis: "평가한 자료(memo·recording)", source: "매긴 방식(cli·batch)" },
  },
  {
    name: "student_consultation_rating_queue",
    label: "상담평점 대기열",
    ko: "원생상담 평점 정기 처리 대기열",
    internal: true,
  },
  // 경영 분석(원장 전용 · s2_0052~0054 · aywa-next 이식 2026-11-10) · 강사 배정 상한(s2_0055)
  {
    name: "management_accounting_reports",
    label: "회계 자료",
    ko: "원장이 검토해 저장한 ECOUNT 손익계산서·계정별원장 월 집계(기간마다 한 줄)",
    notes:
      "period_start~period_end = 회계 기간 · document = 회사명·원본 파일명·해시·계정별 금액(lines[] = account·category·amount·sourceCell) · document.sourceKind: profit_loss=손익계산서 · ledger=계정별원장 집계(늘 검토 대기, complete=false) · document.complete=true + 합계 대사 일치일 때만 확정 이익률을 계산한다. category: revenue=매출 · labor=인건비 · marketing=광고·행사비 · rent=임차료 · operating=기타 영업비용 · nonoperating=영업외 · exclude=집계 제외. 금액 단위 원. 회사 전체 계정이라 임대 등 다른 사업이 섞일 수 있다. 수납 청구(invoices)와 다른 숫자다.",
  },
  { name: "management_accounting_versions", label: "회계 자료 이력", ko: "회계 자료를 저장할 때마다 남는 버전 이력(바뀌지 않음)", notes: "report_id = management_accounting_reports.id · version = 그때 버전 · actor_id = 저장한 원장.", internal: true },
  {
    name: "management_source_batches",
    label: "원본 대조 기록",
    ko: "MakeEdu 수납통합내역·ECOUNT 월별손익분석과 에이와 집계를 대조한 결과(바뀌지 않는 기록)",
    notes:
      "source: makeedu=수납 대조 · ecount=월별 손익 대조. month = 'YYYY-MM' · evidence.facts = 항목별 원본값(sourceValue)·에이와값(aywaValue) · evidence.issues = 확인할 항목(key·title·detail). 같은 원본·같은 비교 자료는 한 번만 저장된다. 같은 종류·달은 created_at이 가장 늦은 것이 현재 기록이고 나머지는 지난 기록이다. 대조 기록은 청구를 고치거나 회계 마감을 확정하지 않는다.",
  },
  { name: "management_review_events", label: "대조 확인 이력", ko: "원본 대조 확인 항목마다 원장이 덧붙인 상태·담당·기한·메모(버전)", notes: "batch_id = management_source_batches.id · issue_key = evidence.issues[].key · status: open=미확인 · reviewing=확인 중 · waiting=자료 대기 · recheck=조치 후 다시 대조 필요. 같은 항목은 version이 가장 큰 줄이 현재 상태. '해결됨' 상태는 없다." },
  { name: "management_collection_devices", label: "수집 PC", ko: "경영 분석 자료를 보내는 학원 PC 연결(90일 만료 · 해제 가능)", notes: "revoked_at = 해제 시각 · expires_at = 만료 · last_seen_at = 마지막 접속 · last_success_at = 마지막 전송 성공 · last_result = 마지막 처리 결과(code: saved=저장).", internal: true },
  { name: "management_collection_settings", label: "수집기 스위치", ko: "지점별 학원 PC 수집기 사용 여부(줄이 없으면 꺼짐)", internal: true },
  { name: "management_ai_reviews", label: "경영 AI 검토", ko: "경영 분석 'AI 검토' 버튼 결과 보관(그 달 집계 지표만 보낸 결과)", notes: "month = 'YYYY-MM' · answer = summary·findings[]·missingData[] · model = 쓴 모델 · 같은 달은 created_at이 가장 늦은 것이 화면에 보이는 결과.", internal: true },
  { name: "teacher_capacity_plans", label: "배정 상한", ko: "원장이 정한 강사별 이번 달 적정 담당 학생 수와 근거", notes: "month = 'YYYY-MM' · max_students = 적정 담당 학생 수(0 = 추가 배정 중지) · basis = 근거. 계획 한도이지 성과 점수가 아니다." },
  { name: "teacher_capacity_events", label: "배정 상한 이력", ko: "배정 상한 저장 요청 이력(요청 번호마다 한 줄)", internal: true },
  // ── 홍보·마케팅 기록 보관(s2_0047 — 옛 이름 20261110125726_marketing_archive_sources.sql · 이름을 시즌2 번호로 맞추자 가드가 설명 없는 표로 잡아서 채웠다).
  {
    name: "marketing_archive_events",
    label: "홍보 행사",
    ko: "홍보·마케팅 행사 기록(설명회·학원행사·전단배부·특수마케팅 등) — 행사마다 최신 한 줄",
    notes:
      "document(jsonb): title · type(설명회·학원행사·전단배부·특수마케팅·기타) · date(진행일) · period('YYYY-MM') · state(review 확인 필요 · planned 예정 · held 진행 확인 · cancelled 취소) · ownerId(담당 직원 users.id) · objective(acquisition 신규 모집 · retention 재원 관계·유지 · cross_subject 영수 동시수강 확대 · brand 인지도) · reservations·attendees(예약·참석 인원 — null=정확한 수를 모름, 원문은 reservationRaw·attendanceRaw) · budget·actualCost(원 · actualCost가 있으면 costReference=지급·배부 근거) · enrollmentGoal(등록 목표) · executions[](채널별 집행 — channel 전단·현수막·문자·블로그·SNS 등 · ownerId 담당 직원 · plannedQuantity·actualQuantity · budget·actualCost) · work[](준비 업무 — ownerId 담당 직원 · state todo·doing·done) · referenceEventId(참고한 지난 행사) · raw(가져온 원본 값). 진행된 행사 = document->>'state' = 'held'. 🔴 총비용(화면 계산과 같게): 채널별 집행(executions)이 **하나라도 있으면** 행사 actualCost는 쓰지 않고 채널 actualCost의 합 — 단 모든 채널에 actualCost가 있을 때만 합을 내고, 하나라도 비어 있으면 '비용 모름'(부분 합을 총비용으로 답하지 않는다). 채널이 없으면 행사 actualCost(없으면 모름). version = 고친 횟수. 변경 이력은 marketing_archive_audit.",
    columns: { source_key: "가져온 원본 열쇠(직접 만든 행사는 비어 있다)", document: "행사 내용(jsonb)", version: "버전", updated_by: "마지막으로 고친 직원" },
  },
  {
    name: "marketing_archive_students",
    label: "행사 참여 학생",
    ko: "홍보 행사에 초대·예약·참석·상담한 원생 기록(행사 × 원생 × 종류 × 날짜마다 한 줄)",
    notes:
      "event_id → marketing_archive_events · student_id → students. document->>'kind': invited 초대 · reserved 참석 예약 · attended 참석 · no_show 불참 · test_reserved 입학테스트 예약 · consulted 상담 완료 · date(그 일이 있던 날) · reference(근거) · result · nextAction. 행사가 등록으로 이어졌는지는 참석(attended)·상담 완료(consulted) 기록과 그 원생의 등록일을 함께 봐야 한다(기록만으로 등록을 단정하지 않는다).",
    columns: { document: "참여 내용(jsonb · kind로 종류 구분)", version: "버전", updated_by: "마지막으로 고친 직원" },
  },
  {
    name: "marketing_source_inbox",
    label: "홍보 원본함",
    ko: "밖에서 가져온 홍보·마케팅 원본 자료(글·문서) — 행사에 잇기 전에 검토한다",
    notes: "document(jsonb): provider(가져온 곳) · title · url · date · dateKind · type · status. review_status: review 확인 필요 · reference 참고 자료 · excluded 실적 제외 · linked 행사 연결. review_note = 검토 메모. 행사와의 연결은 marketing_archive_sources.",
    columns: { source_key: "원본 열쇠(같은 원본은 한 번만 들어온다)", review_status: "검토 상태", ingested_at: "가져온 시각" },
  },
  { name: "marketing_archive_sources", label: "행사 원본 연결", ko: "홍보 행사와 원본 자료의 연결(행사 하나에 원본 여럿)", notes: "event_id → marketing_archive_events.id · source_id → marketing_source_inbox.id.", internal: true },
  { name: "marketing_archive_audit", label: "홍보 기록 이력", ko: "홍보 행사·참여 학생·원본 검토를 저장할 때마다 남는 변경 기록", notes: "kind: event=행사 · student=참여 학생 · source=원본 검토 · entity_id = 그 기록의 id · actor_id = 저장한 직원 · document = 그 시점 사본 · version. 지금 값은 각 표를 본다.", internal: true },
];
