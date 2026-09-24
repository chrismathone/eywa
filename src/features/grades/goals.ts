import { EXAM_SLOT_LABEL, examSlotsFor, gradeMonthOf, isExamSlot, slotUsesMonth, type ExamSlotKey } from "./exam-slots";
import { isTerm, termLabel, termMonths, type Term } from "./term";

/**
 * **시험 목표** — 성적 칸과 같은 축(과목·년도·학기·시험·월)에 매단다(원장 2026-09-24 "제안대로 진행", codex 3라운드 합의).
 * 판정·라벨·검증이 이 파일 한 벌이다 — 학생 상세 목표 구역·학생 상세 기록 행·/exams 성적 현황·학생 추이가 전부 여기를 지난다.
 * 🔑 목표 대상 = **성적 입력(student_grades)의 시험 칸**뿐. 수업보고서 일일·확인테스트·레벨테스트는 대상이 아니다.
 */

export type GoalAxis = { subject: string; year: number; term: Term; slot: ExamSlotKey; month: number };

/** 칸 키 — 성적 칸의 유니크 축(0283a/0288a)과 같은 순서. 월을 안 쓰는 시험은 0. */
export function goalCellKey(a: { subject: string; year: number; term: number; slot: string; month: number }): string {
  return `${a.subject}|${a.year}|${a.term}|${a.slot}|${a.month}`;
}

/**
 * 통합 기록 한 줄의 칸 키 — **성적 입력의 시험 칸**만(수업보고서·레벨테스트·칸 없는 옛 행은 null = 목표 대상 아님).
 * 월말평가의 월은 시험일에서(성적 칸과 같은 `gradeMonthOf`).
 */
export function recordCellKey(r: { source: string; subject: string; slot?: string; schoolYear?: number; term?: number; date: string }): string | null {
  if (r.source !== "grade" || r.schoolYear == null || r.term == null || !isExamSlot(r.slot)) return null;
  return goalCellKey({ subject: r.subject, year: r.schoolYear, term: r.term, slot: r.slot, month: gradeMonthOf(r.slot, r.date) });
}

/** 사람이 읽는 시험 이름 — `2026년 2학기 · 중간고사` · `2026년 2학기 · 월말평가(10월)`. 목표의 exam_name에도 이 값을 남긴다. */
export function goalExamLabel(a: { year: number; term: Term; slot: ExamSlotKey; month: number }): string {
  const exam = EXAM_SLOT_LABEL[a.slot] + (slotUsesMonth(a.slot) && a.month ? `(${a.month}월)` : "");
  return `${termLabel(a.year, a.term)} · ${exam}`;
}

/**
 * 폼 값 → 축. 틀리면 **사유 문자열**(서버가 같은 함수로 다시 본다 — 화면 검증은 게이트가 아니다, #77).
 * 🔴 학기 규칙은 term.ts(1·2월 = 전년 2학기), 시험은 그 과목의 `examSlotsFor`, 월말평가의 월은 그 학기의 달만, 다른 시험은 월 0.
 */
export function parseGoalAxis(raw: { subject: string; year: unknown; term: unknown; slot: unknown; month: unknown }): GoalAxis | string {
  const subject = raw.subject.trim();
  if (!subject) return "과목을 선택해주세요";
  const year = Number(raw.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return "년도를 확인해주세요";
  const term = Number(raw.term);
  if (!isTerm(term)) return "학기를 선택해주세요";
  const slot = typeof raw.slot === "string" ? raw.slot.trim() : "";
  if (!isExamSlot(slot) || !examSlotsFor(subject).includes(slot)) return "이 과목에 없는 시험입니다";
  let month = 0;
  if (slotUsesMonth(slot)) {
    month = Number(raw.month);
    if (!termMonths(term).includes(month)) return "월말평가의 월이 그 학기에 없습니다";
  }
  return { subject, year, term, slot, month };
}

export type GoalStatus = "achieved" | "missed" | "noExam" | "pending" | "unknown";

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  achieved: "달성",
  missed: "미달",
  noExam: "시험없음",
  pending: "아직 점수 없음",
  unknown: "판정 불가",
};

/**
 * 목표 대비 상태 — 5종(codex 합의 6'). 순서: 시험없음 → 점수 없음 → 만점 비교.
 * 만점이 둘 다 있으면 **비율**(점수÷만점 ≥ 목표÷목표만점) — 화면엔 각자 원래 단위만 적고 환산 숫자는 안 적는다(원장 2026-09-24).
 * 둘 다 없으면 점수끼리, **한쪽만 없으면 판정 불가**(모르는 만점을 100으로 가정하지 않는다).
 */
export function goalStatus(goal: { target: number; max: number | null },
  cell: { score: number | null; max: number | null; noExam?: boolean } | null): GoalStatus {
  if (cell?.noExam) return "noExam";
  if (!cell || cell.score == null) return "pending";
  const gm = goal.max != null && goal.max > 0 ? goal.max : null;
  const cm = cell.max != null && cell.max > 0 ? cell.max : null;
  if (gm != null && cm != null) return cell.score * gm >= goal.target * cm ? "achieved" : "missed";
  if (gm == null && cm == null) return cell.score >= goal.target ? "achieved" : "missed";
  return "unknown";
}

/** 목표 한 건의 화면 모양 — 서버가 만들어 부품(GoalBadge)에 넘긴다. */
export type GoalView = { target: number; max: number | null; status: GoalStatus };
