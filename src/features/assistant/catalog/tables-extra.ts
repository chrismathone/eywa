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
];
