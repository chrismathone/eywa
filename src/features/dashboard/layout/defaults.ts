/**
 * 역할별 **기본 배치** — 코드에 있다(원장 2026-10-01 *"기본 디폴트 세팅을 만들어두고"* → 2026-11-09 새 대시보드 모양으로 다시 짬).
 *
 * 모양 = 새 대시보드(`board.ts`): 핵심 업무 · KPI(한눈에 보기 6칸 + 오늘 운영 띠) · 추이·비교 · 비중·구성 · 오늘 운영 구역.
 * · 원장 = 지금 새 대시보드 전부.
 * · 실장 = 원장에서 금액 내역(6개월 청구·지출)·직원 구성을 뺀 것.
 * · 관리자 · 경영지원형(데스크) = 일정·상담·출결 위주 — 학습 운영(보고·학생 상담·강사 시트)·금액 카드 없음.
 * · 관리자 · 과목 운영형 = 담당 과목의 수업·학생 위주 — 금액·직원·강사 시트·퇴원 명단 없음.
 * 🔴 저장값이 없는 역할은 이 기본을 **그대로 따른다** — 기본을 코드로 고치면 안 건드린 역할이 따라온다(저장할 때 기본과 같은 역할은 지운다 — `normalize.ts`).
 * 🔴 민감 옵션(금액 `amounts`·전화번호 `phones`)은 원장 밖 역할에서 **가림이 기본**이다 — 원장이 편집기에서 켜야 열린다(`optionDefault`).
 */
import type { PanelId } from "@/features/dashboard/overview/layout";
import { boardItems } from "./board";
import type { BoardKpi } from "./registry";
import type { Bundle, CoreKey, Item } from "./types";

/** 민감 옵션(금액·전화번호)의 역할 기본 — 원장만 보임, 나머지는 가림(원장이 카드마다 켠다). */
export const optionDefault = (bundle: Bundle): boolean => bundle === "owner" || bundle === "super";

/** 원장 밖 역할에서 기본으로 빼는 칸 — 금액 내역·직원(원장 전용 정보). */
export const SENSITIVE_PANELS: readonly PanelId[] = ["billing6", "expenses", "staff"];

const ALL_CORE: readonly CoreKey[] = ["newcomers", "management", "workRecords"];
const ALL_KPIS: readonly BoardKpi[] = ["students", "courses", "withdrawals", "intake", "calendar", "enrolledToday", "firstClass", "absent", "makeup"];
const GLANCE: readonly BoardKpi[] = ["students", "courses", "withdrawals", "intake", "enrolledToday", "todayTests"];

const OWNER_TODAY = [
  { id: "student-overview", title: "학생 · 학습 · 상담", note: "학생 구성과 학습·상담 신호",
    panels: ["subjects", "grades", "schools", "admissions", "repeatAbsence", "attendance14", "consultProgress", "reports", "studentConsult"] as PanelId[] },
  { id: "operations-overview", title: "수업과 학원 운영", note: "신규생 체크 · 강사 시트 · 일정과 행정",
    panels: ["newcomerChecks", "sheets", "nowClasses", "admissionsSchedule", "staff", "operations", "expenses", "notices"] as PanelId[] },
];

const without = (drop: readonly PanelId[]) => (list: readonly PanelId[]) => list.filter((p) => !drop.includes(p));

function ownerItems(drop: readonly PanelId[] = []): Item[] {
  const keep = without(drop);
  return boardItems({
    core: ALL_CORE, kpis: ALL_KPIS, glance: GLANCE,
    trend: keep(["changes", "billing6", "enrolledTrend", "courseTrend", "earlyExits"]),
    mix: keep(["studentsComp", "attendance", "billingMonth", "newcomerStages"]),
    today: OWNER_TODAY.map((s) => ({ ...s, panels: keep(s.panels) })),
  });
}

const DESK = boardItems({
  core: ["newcomers", "management", "workRecords"],
  kpis: ["students", "intake", "calendar", "enrolledToday", "firstClass", "absent", "makeup"],
  glance: ["students", "intake", "enrolledToday", "todayTests", "absent", "makeup"],
  trend: ["changes", "enrolledTrend"],
  mix: ["studentsComp", "attendance", "newcomerStages"],
  today: [
    { id: "consult", title: "상담 · 신입", note: "콜&상담 · 입테 · 첫수업 일정", panels: ["admissions", "consultProgress", "admissionsSchedule", "newcomerChecks"] },
    { id: "attendance", title: "출결 · 수업", note: "결석 · 등원율 · 지금 수업", panels: ["repeatAbsence", "attendance14", "nowClasses"] },
    { id: "office", title: "학원 운영", note: "행정 · 공지", panels: ["operations", "notices"] },
  ],
});

const SUBJECT = boardItems({
  core: ["newcomers", "management", "workRecords"],
  kpis: ["students", "courses", "withdrawals", "firstClass", "absent", "makeup"],
  glance: ["students", "courses", "withdrawals", "firstClass", "absent", "makeup"],
  trend: ["changes", "enrolledTrend", "courseTrend"],
  mix: ["studentsComp", "attendance", "newcomerStages"],
  today: [
    { id: "classes", title: "수업 · 출결", note: "지금 수업 · 결석 · 등원율", panels: ["nowClasses", "repeatAbsence", "attendance14"] },
    { id: "students", title: "학생 · 학습", note: "수강 · 학년 · 보고 · 상담", panels: ["subjects", "grades", "reports", "studentConsult", "newcomerChecks"] },
    { id: "notices", title: "공지", panels: ["notices"] },
  ],
});

const simple = (spec: { kpis?: BoardKpi[]; mix?: PanelId[]; panels: PanelId[]; title: string; core?: CoreKey[] }) => boardItems({
  core: spec.core ?? ["workRecords"], kpis: spec.kpis ?? [], glance: (spec.kpis ?? []).slice(0, 6), trend: [], mix: spec.mix ?? [],
  today: [{ id: "today", title: spec.title, panels: spec.panels }],
});

/** 편집기가 시작하는 값이자 저장값이 없는 역할의 배치 — 모든 역할에 있다. */
export function defaultItems(bundle: Bundle): Item[] {
  switch (bundle) {
    case "super":
    case "owner":
      return ownerItems();
    case "manager":
      // 등록 후 3개월 내 퇴원(학생 이름)은 원장 화면에만 있던 카드 — 실장 기본으로 넓히지 않는다(원장이 설정에서 넣을 수 있다 · 리뷰 2026-11-09).
      return ownerItems([...SENSITIVE_PANELS, "earlyExits"]);
    case "desk":
      return DESK.map((i) => ({ ...i }));
    case "subject":
      return SUBJECT.map((i) => ({ ...i }));
    case "counselor":
      return simple({ core: ["newcomers", "workRecords"], kpis: ["intake", "calendar", "enrolledToday"], mix: ["newcomerStages"], title: "상담 · 신입", panels: ["admissions", "consultProgress", "admissionsSchedule", "notices"] });
    case "accountant":
      return simple({ mix: ["billingMonth"], title: "행정", panels: ["operations", "notices"] });
    case "viewer":
      return simple({ kpis: ["students"], title: "수업", panels: ["subjects", "nowClasses", "notices"] });
    case "teacher":
      return simple({ title: "수업", panels: ["nowClasses", "reports", "notices"] });
    case "parttime":
    case "student":
      return simple({ core: [], title: "공지", panels: ["notices"] });
  }
}
