import type { UnifiedRecord } from "../model";

export function numberOrNull(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isoDaysBefore(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function gradeKind(slot: string | null | undefined, name: string): UnifiedRecord["kind"] {
  if (/일일테스트/.test(name)) return "daily";
  if (/확인테스트/.test(name)) return "check";
  if (slot === "monthly" || name.includes("월말")) return "monthly";
  // 영어 듣기평가도 학교 시험이다 — 시험정보 `26-2-듣기`가 여기를 지나야 붙는다(roster-action은 이미 학교 시험으로 저장).
  if (slot === "school" || slot === "midterm" || slot === "final" || slot === "listening" || /내신|중간고사|기말고사|듣기평가/.test(name)) return "school";
  if (/입학|레벨/.test(name)) return "admission";
  return "other";
}
