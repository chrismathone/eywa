/**
 * 운영실(`Overview`) 화면 배치 — **카드 정의는 그대로**, 어떤 카드를 어떤 순서·열 수로 놓을지만 값으로 받는다.
 *
 * 기본 배치(`DEFAULT_LAYOUT`)는 이 파일이 생기기 전 `overview.tsx`가 손으로 적던 순서와 **같다**(3개 구역).
 * 역할별 시안(`/drafts/dashboard-roles`)이 같은 카드를 다른 순서·부분집합으로 놓을 때만 다른 값을 넘긴다.
 * 🔴 이 배치는 **보여 주는 순서**일 뿐 권한이 아니다 — 카드를 빼도 데이터는 스냅샷에 남는다(#77: UI 조건은 게이트가 아님).
 *    권한(데이터 자체를 빼는 것)은 서버가 스냅샷을 만들 때 건다.
 */

/** 카드 한 칸의 식별자 — 운영실 패널 24개(학습·학부모 보고 / 학생 상담은 둘로 센다). */
export type PanelId =
  | "studentsComp"
  | "attendance"
  | "billingMonth"
  | "newcomerStages"
  | "changes"
  | "billing6"
  | "enrolledTrend"
  | "subjects"
  | "grades"
  | "schools"
  | "admissions"
  | "repeatAbsence"
  | "attendance14"
  | "consultProgress"
  | "reports"
  | "studentConsult"
  | "newcomerChecks"
  | "sheets"
  | "nowClasses"
  | "admissionsSchedule"
  | "staff"
  | "operations"
  | "expenses"
  | "notices";

/** 기본 배치에서 '학습·학부모 보고'와 '학생 상담'을 한 묶음(2열)으로 놓는 자리. */
export type PanelSlot = PanelId | "followup";

/** KPI 띠의 칸 — 스냅샷 영역 이름과 같다(`kpi-strip.tsx`). */
export type KpiKey =
  | "students"
  | "withdrawals"
  | "intake"
  | "calendar"
  | "enrolledToday"
  | "firstClass"
  | "absent"
  | "makeup";

export const KPI_KEYS: readonly KpiKey[] = [
  "students",
  "withdrawals",
  "intake",
  "calendar",
  "enrolledToday",
  "firstClass",
  "absent",
  "makeup",
];

export type LayoutSection = {
  id: string;
  /** 비우면 구역 제목줄을 그리지 않는다. */
  title: string;
  note: string;
  panels: readonly PanelSlot[];
};

export type OverviewLayout = {
  /** 놓을 KPI 칸(순서는 고정) — 없으면 영역이 온 칸 전부. */
  kpis?: readonly KpiKey[];
  sections: readonly LayoutSection[];
  /** 넓은 화면의 카드 열 수(기본 4). 좁은 폭의 접힘 규칙은 CSS가 그대로 맡는다. */
  columns?: number;
  /** 한 화면용 — 여백·머리를 줄인다. */
  compact?: boolean;
  /** 머리(학원 이름·새로고침 줄)를 그리지 않는다. */
  hideHeader?: boolean;
};

export const DEFAULT_LAYOUT: OverviewLayout = {
  sections: [
    {
      id: "academy-overview",
      title: "학원 운영 한눈에",
      note: "재원 · 출결 · 수납 · 신규생",
      panels: ["studentsComp", "attendance", "billingMonth", "newcomerStages", "changes", "billing6", "enrolledTrend"],
    },
    {
      id: "student-overview",
      title: "학생 · 학습 · 상담",
      note: "학생 구성과 학습·상담 신호",
      panels: [
        "subjects",
        "grades",
        "schools",
        "admissions",
        "repeatAbsence",
        "attendance14",
        "consultProgress",
        "followup",
      ],
    },
    {
      id: "operations-overview",
      title: "수업과 학원 운영",
      note: "신규생 체크 · 강사 시트 · 일정과 행정",
      panels: [
        "newcomerChecks",
        "sheets",
        "nowClasses",
        "admissionsSchedule",
        "staff",
        "operations",
        "expenses",
        "notices",
      ],
    },
  ],
};
