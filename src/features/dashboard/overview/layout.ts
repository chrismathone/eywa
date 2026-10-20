/**
 * 운영실(`Overview`) 화면 배치 — **카드 정의는 그대로**, 어떤 카드를 어떤 순서·열 수로 놓을지만 값으로 받는다.
 *
 * 기본 배치(`DEFAULT_LAYOUT`)는 이 파일이 생기기 전 `overview.tsx`가 손으로 적던 순서와 **같다**(3개 구역).
 * 이 옛 CSS 격자(구역 + 4열)는 **원장 기본 배치**(저장값 없음)만 그린다 — 그 밖의 역할·저장된 배치는 흐름 격자(`features/dashboard/layout`)로 그린다.
 * 🔴 화면 배치는 게이트가 아니다(#77) — 데이터를 빼는 일은 서버가 스냅샷을 만들 때 한다(`loadOverview`: 배치에 없는 카드의
 *    영역은 조회하지 않고 `loadPlan`, 금액·전화번호는 `shapeSections`가 비운다).
 */

/** 카드 한 칸의 식별자 — 운영실 패널(학습·학부모 보고 / 학생 상담은 둘로 센다). */
export type PanelId =
  | "studentsComp"
  | "attendance"
  | "billingMonth"
  | "newcomerStages"
  | "changes"
  | "earlyExits"
  | "billing6"
  | "enrolledTrend"
  | "courseTrend"
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
  | "teacherWork"
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
  | "courses"
  | "withdrawals"
  | "intake"
  | "calendar"
  | "enrolledToday"
  | "firstClass"
  | "absent"
  | "makeup";

export const KPI_KEYS: readonly KpiKey[] = [
  "students",
  "courses",
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
};

export const DEFAULT_LAYOUT: OverviewLayout = {
  sections: [
    {
      id: "academy-overview",
      title: "학원 운영 한눈에",
      note: "재원 · 출결 · 수납 · 신규생",
      panels: ["studentsComp", "attendance", "billingMonth", "newcomerStages", "changes", "billing6", "enrolledTrend", "courseTrend"],
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
