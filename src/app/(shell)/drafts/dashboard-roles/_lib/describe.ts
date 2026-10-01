/**
 * 시안 위의 "보이는 칸 / 뺀 칸과 이유" 한 줄 — 배치(`buildLayout`)에서 **계산**한다(손으로 적으면 어긋난다).
 * 보이는 칸 = 지금 놓인 카드, 뺀 칸 = 이 역할에 못 놓는 카드(이유 = 역할 규칙) + 놓을 수 있지만 이 안에서 접은 카드.
 */
import { KPI_KEYS, type KpiKey, type OverviewLayout, type PanelId } from "@/features/dashboard/overview/layout";
import { allowedKpis, allowedPanels, billingAmountsFor, PANEL_AREAS, type RoleId, type Toggles } from "./roles";

export const PANEL_TITLES: Record<PanelId, string> = {
  studentsComp: "재원생 구성",
  attendance: "출결 현황",
  billingMonth: "이번 달 수납 현황",
  newcomerStages: "신규생 단계별 관리",
  changes: "등록 · 퇴원 추이",
  billing6: "6개월 청구 · 수납",
  enrolledTrend: "재원생 추이",
  subjects: "과목별 수강",
  grades: "학년별 재원생",
  schools: "학교별 학생",
  admissions: "콜&상담 전환",
  repeatAbsence: "반복 결석 학생",
  attendance14: "최근 14일 등원율",
  consultProgress: "상담 진행",
  reports: "학습 · 학부모 보고",
  studentConsult: "학생 상담",
  newcomerChecks: "신규생 체크 진행",
  sheets: "강사 시트 작성 현황",
  nowClasses: "현재 수업 현황",
  admissionsSchedule: "레벨테스트 및 첫수업 일정",
  staff: "직원 구성",
  operations: "행정 · 자산",
  expenses: "이번 달 지출 내역",
  notices: "학원 공지",
};

export const KPI_TITLES: Record<KpiKey, string> = {
  students: "재원생",
  withdrawals: "퇴원생",
  intake: "신규문의",
  calendar: "금일 입테",
  enrolledToday: "금일 등록",
  firstClass: "오늘첫수업",
  absent: "전일 결석",
  makeup: "보강예정",
};

export type RoleNotes = { sees: string[]; hides: { label: string; reason: string }[] };

/** 역할 규칙으로 못 놓는 이유 — 켜면 놓이는 칸은 어느 번호인지까지 적는다. */
function why(role: RoleId, id: PanelId | KpiKey): string {
  if (id === "billing6" || id === "expenses") return "금액 내역 — 원장 전용(기본)";
  if (id === "staff") return "직원 구성 — 원장 전용 · 켜려면 ⑥";
  if (role === "desk") return "교사 평가·학습 운영 성격 — 데스크 업무 아님";
  if (role === "subject") {
    if (id === "sheets") return "강사 작성률 비교 — 원장 결정 대기 · 켜려면 ③";
    if (id === "billingMonth") return "수납 금액 — 켜도 학원 전체 값 · 켜려면 ②";
    if (id === "withdrawals") return "퇴원 명단 — 켜려면 ④(자기 과목만)";
    return "과목으로 안 좁혀짐(학원 전체 값)";
  }
  return "이 역할에 두지 않음";
}

export function describeRole(role: RoleId, layout: OverviewLayout, t: Toggles): RoleNotes {
  const placed = new Set<PanelId>(
    layout.sections.flatMap((s) => s.panels.flatMap((p) => (p === "followup" ? (["reports", "studentConsult"] as PanelId[]) : [p]))),
  );
  const kpis = new Set<KpiKey>(layout.kpis ?? KPI_KEYS);
  const allowed = new Set<PanelId>(allowedPanels(role, t));
  const allowedK = new Set<KpiKey>(allowedKpis(role, t));
  const sees = [
    ...KPI_KEYS.filter((k) => kpis.has(k)).map((k) => `KPI ${KPI_TITLES[k]}`),
    ...[...placed].map((p) => PANEL_TITLES[p] + (p === "billingMonth" && !billingAmountsFor(role, t) ? "(건수만)" : "")),
  ];
  const hides: RoleNotes["hides"] = [];
  for (const k of KPI_KEYS) {
    if (kpis.has(k)) continue;
    hides.push({ label: `KPI ${KPI_TITLES[k]}`, reason: allowedK.has(k) ? "이 안에서 접음" : whyKpi(role, k) });
  }
  for (const p of Object.keys(PANEL_AREAS) as PanelId[]) {
    if (placed.has(p)) continue;
    hides.push({ label: PANEL_TITLES[p], reason: allowed.has(p) ? "이 안에서 접음(한 화면에 안 들어감)" : why(role, p) });
  }
  return { sees, hides };
}

function whyKpi(role: RoleId, k: KpiKey): string {
  if (role === "subject" && k !== "withdrawals") return "접수·등록·보강 명단에 과목이 없어 못 좁힘";
  return why(role, k);
}
