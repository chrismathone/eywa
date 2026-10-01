/**
 * 역할별 운영실 시안의 **명세** — 역할 묶음 · 보이는 카드 · 3안 배치 · 원장이 켜고 끄는 6가지.
 *
 * 카드 정의는 실제 운영실(`Overview`) 그대로고, 이 파일은 "누구에게 어떤 카드를 어떤 순서로"만 정한다.
 * 🔴 순수 모듈(서버·DB 무관) — 시안은 실제 스냅샷을 **클라이언트에서** 걸러 보여 주고, 실제 적용 땐 같은 판정을
 *    서버가 스냅샷을 만들 때 건다(`docs/_audit/dashboard-role-drafts-2026-10-01.md`).
 */
import {
  DEFAULT_LAYOUT,
  KPI_KEYS,
  type KpiKey,
  type LayoutSection,
  type OverviewLayout,
  type PanelId,
  type PanelSlot,
} from "@/features/dashboard/overview/layout";

export type RoleId = "owner" | "subject" | "manager" | "desk";
export type LayoutId = "a" | "b" | "c";

export const ROLE_IDS: readonly RoleId[] = ["owner", "subject", "manager", "desk"];
export const LAYOUT_IDS: readonly LayoutId[] = ["a", "b", "c"];

/** 원장이 아직 답하지 않은 6가지 — 번호가 곧 주소(`?t=1,4`)의 값. 기본은 전부 꺼짐(보수적). */
export const TOGGLES = [
  { n: 1, key: "deskBilling", label: "데스크에게 미납 금액(미수 잔액)", role: "desk" },
  { n: 2, key: "subjectBilling", label: "과목 관리자에게 수납 금액", role: "subject" },
  { n: 3, key: "subjectSheets", label: "과목 관리자에게 강사 시트 작성 현황", role: "subject" },
  { n: 4, key: "subjectWithdrawals", label: "과목 관리자에게 퇴원 명단(자기 과목만)", role: "subject" },
  { n: 5, key: "showPhones", label: "원장 외에도 일정 제목의 전화번호 그대로", role: "all" },
  { n: 6, key: "staffCard", label: "직원 구성 카드를 실장·데스크에게도", role: "manager" },
] as const;
export type ToggleKey = (typeof TOGGLES)[number]["key"];
export type Toggles = Record<ToggleKey, boolean>;

export const NO_TOGGLES: Toggles = {
  deskBilling: false,
  subjectBilling: false,
  subjectSheets: false,
  subjectWithdrawals: false,
  showPhones: false,
  staffCard: false,
};

export function parseToggles(raw: string | null | undefined): Toggles {
  const on = new Set((raw ?? "").split(",").map((v) => Number(v)));
  return Object.fromEntries(TOGGLES.map((t) => [t.key, on.has(t.n)])) as Toggles;
}

export function toggleParam(t: Toggles): string {
  return TOGGLES.filter((x) => t[x.key]).map((x) => x.n).join(",");
}

export const ROLE_LABELS: Record<RoleId, string> = {
  owner: "원장",
  subject: "과목 관리자",
  manager: "실장(매니저)",
  desk: "경영지원 · 데스크",
};

/** 역할마다 한 줄 — 어떤 사람들인가(조사 결과의 묶음 규칙). 실측 인원은 적지 않는다. */
export const ROLE_RULES: Record<RoleId, string> = {
  owner: "원장 역할 + 슈퍼관리자 — 지금 운영실 그대로",
  subject: "관리자 + 담당 과목 있음 — 담당 과목 데이터만",
  manager: "매니저(권한 화면 표기 '실장') — 학원 전체 현장 · 돈·직원 제외",
  desk: "관리자 + 담당 과목 없음 — 접수·연락·원생 변동 · 돈은 건수만",
};

/** 카드가 읽는 스냅샷 영역 — 이 영역이 없으면 그 카드는 그려지지 않는다(`overview.tsx`). */
export const PANEL_AREAS: Record<PanelId, readonly string[]> = {
  studentsComp: ["students"],
  attendance: ["attendance", "processing"],
  billingMonth: ["billing"],
  newcomerStages: ["newcomers"],
  changes: ["changes"],
  billing6: ["billing"],
  enrolledTrend: ["enrolledTrend"],
  subjects: ["students"],
  grades: ["students"],
  schools: ["students"],
  admissions: ["admissions"],
  repeatAbsence: ["absences"],
  attendance14: ["attendanceTrend"],
  consultProgress: ["consultProgress"],
  reports: ["homework", "unread"],
  studentConsult: ["consultations"],
  newcomerChecks: ["newcomers"],
  sheets: ["englishSheet", "mathSheet"],
  nowClasses: ["schedule"],
  admissionsSchedule: ["calendar"],
  staff: ["staff"],
  operations: ["operations"],
  expenses: ["expenses"],
  notices: ["notices"],
};

const ALL_PANELS: readonly PanelId[] = Object.keys(PANEL_AREAS) as PanelId[];
const without = (list: readonly PanelId[], drop: readonly PanelId[]) => list.filter((p) => !drop.includes(p));

/** 이 역할·토글에서 놓을 수 있는 카드(= 데이터도 이 카드들이 읽는 영역만 내려간다). */
export function allowedPanels(role: RoleId, t: Toggles): readonly PanelId[] {
  switch (role) {
    case "owner":
      return ALL_PANELS;
    case "manager":
      return without(ALL_PANELS, ["billing6", "expenses", ...(t.staffCard ? [] : (["staff"] as const))]);
    case "desk":
      return without(ALL_PANELS, [
        "billing6",
        "expenses",
        "reports",
        "studentConsult",
        "sheets",
        ...(t.staffCard ? [] : (["staff"] as const)),
      ]);
    case "subject":
      return [
        "subjects",
        "nowClasses",
        "notices",
        ...(t.subjectSheets ? (["sheets"] as const) : []),
        ...(t.subjectBilling ? (["billingMonth"] as const) : []),
      ];
  }
}

/** 이 역할에서 KPI 띠에 놓을 칸. */
export function allowedKpis(role: RoleId, t: Toggles): readonly KpiKey[] {
  switch (role) {
    case "owner":
    case "manager":
    case "desk":
      return KPI_KEYS;
    case "subject":
      return ["students", "firstClass", "absent", ...(t.subjectWithdrawals ? (["withdrawals"] as const) : [])];
  }
}

/** 수납 현황 칸이 금액까지 보이나 — 원장 / ①(데스크) / ②(과목 관리자)만. 아니면 건수만. */
export function billingAmountsFor(role: RoleId, t: Toggles): boolean {
  return role === "owner" || (role === "desk" && t.deskBilling) || (role === "subject" && t.subjectBilling);
}

const sec = (id: string, title: string, note: string, panels: readonly PanelSlot[]): LayoutSection => ({ id, title, note, panels });

/** B안(일 중심)과 C안(한 화면)의 **희망 배치** — 못 놓는 카드는 `buildLayout`이 걸러 낸다. */
const B_SECTIONS: Record<Exclude<RoleId, "owner">, readonly LayoutSection[]> = {
  manager: [
    sec("b-now", "오늘 현장", "수업 · 출결 · 반복 결석", ["nowClasses", "attendance", "attendance14", "repeatAbsence"]),
    sec("b-new", "신입 · 상담", "신입 90일 체크 · 상담 진행 · 입테 일정", ["newcomerStages", "newcomerChecks", "consultProgress", "admissionsSchedule"]),
    sec("b-learn", "학습 · 보고", "숙제·보고서 · 학생 상담 · 강사 시트", ["reports", "studentConsult", "sheets"]),
    sec("b-status", "현황", "재원 · 등록·퇴원 · 수납(건수)", ["studentsComp", "changes", "billingMonth", "staff"]),
    sec("b-office", "공지 · 행정", "공지와 행정 건수", ["notices", "operations"]),
  ],
  desk: [
    sec("b-intake", "접수 · 상담", "문의 → 상담 → 입테 일정", ["consultProgress", "admissionsSchedule", "admissions", "newcomerStages"]),
    sec("b-call", "연락 · 출결", "결석 연락 · 출결 처리 · 오늘 수업", ["repeatAbsence", "attendance", "nowClasses"]),
    sec("b-pay", "수납 · 행정", "이번 달 수납 · 행정 건수 · 공지", ["billingMonth", "operations", "notices"]),
    sec("b-roster", "원생 변동", "등록·퇴원과 구성", ["changes", "studentsComp", "subjects", "newcomerChecks", "staff"]),
  ],
  subject: [
    sec("b-class", "오늘 내 과목 수업", "시간표 · 시트 작성", ["nowClasses", "sheets"]),
    sec("b-students", "내 과목 수강", "과목 수강 · 수납(켰을 때)", ["subjects", "billingMonth"]),
    sec("b-notice", "공지", "", ["notices"]),
  ],
};

const C_PANELS: Record<Exclude<RoleId, "owner">, { panels: readonly PanelSlot[]; columns: number }> = {
  manager: {
    panels: ["nowClasses", "attendance", "repeatAbsence", "newcomerChecks", "sheets", "consultProgress", "billingMonth", "notices"],
    columns: 4,
  },
  desk: {
    panels: ["consultProgress", "admissionsSchedule", "billingMonth", "repeatAbsence", "attendance", "newcomerChecks", "operations", "notices"],
    columns: 4,
  },
  subject: { panels: ["nowClasses", "subjects", "sheets", "billingMonth", "notices"], columns: 3 },
};

function keepAllowed(panels: readonly PanelSlot[], allowed: readonly PanelId[]): PanelSlot[] {
  return panels.flatMap((slot): PanelSlot[] => {
    if (slot === "followup") {
      const kept = (["reports", "studentConsult"] as const).filter((p) => allowed.includes(p));
      return kept.length === 2 ? ["followup"] : kept;
    }
    return allowed.includes(slot) ? [slot] : [];
  });
}

/** 역할·안·토글 → 실제 운영실 `Overview`에 넘길 배치. 원장은 어느 안이든 지금 배치 그대로다. */
export function buildLayout(role: RoleId, layout: LayoutId, t: Toggles): OverviewLayout {
  if (role === "owner") return DEFAULT_LAYOUT;
  const allowed = allowedPanels(role, t);
  const kpis = allowedKpis(role, t);
  const toSections = (src: readonly LayoutSection[]) =>
    src.map((s) => ({ ...s, panels: keepAllowed(s.panels, allowed) })).filter((s) => s.panels.length > 0);
  if (layout === "a") return { kpis, sections: toSections(DEFAULT_LAYOUT.sections) };
  if (layout === "b") return { kpis, sections: toSections(B_SECTIONS[role]) };
  const c = C_PANELS[role];
  return {
    kpis,
    compact: true,
    hideHeader: true,
    columns: c.columns,
    sections: toSections([sec("c-one", "", "", c.panels)]),
  };
}
