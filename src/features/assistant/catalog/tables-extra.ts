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
];
