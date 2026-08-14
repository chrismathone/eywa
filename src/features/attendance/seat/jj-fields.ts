/**
 * JJ실 출석부의 **전용 입력 칸** — 랩실 출석부와 갈라지는 지점.
 *
 * 원장 2026-08-13: JJ 수업은 점수를 없애고 **듣기 레벨 · 누적 암기 단어수**를 적는다.
 * 칸 구성은 ECS 로스터 폼(`roster-form` selfStudy)이 단일 소스다. 여기서 라벨을 다시 쓰지 말 것.
 *
 * 🔴 저장은 `class_sheet_student_marks`다(출결 `attendance_records`가 아님). 영어 시트 JJ 칸과
 *    **같은 행**이라 한쪽에서 고치면 다른 쪽에도 보인다.
 * 🔴 자리 시수(`seat_label`)와는 무관 — 이 칸을 적는다고 담임 정산에서 빠지지 않는다.
 */
import { rosterTextCols, type MarkTextField, type RosterTextCol } from "@/features/class-sheets/lib/roster-form";
import type { SeatKey } from "./seat";

export const JJ_MARK_FIELDS = ["listeningLevel", "memorizedWords"] as const;
export type JjMarkField = (typeof JJ_MARK_FIELDS)[number];

export const JJ_MARK_MAXLEN = 30;

/** 로그인 JJ실 출석부에만 전용 칸을 그린다. 랩실·공개 PIN은 출결만. */
export function seatHasJjFields(seat: SeatKey): boolean {
  return seat === "jj";
}

export function parseJjMarkField(raw: string | null | undefined): JjMarkField | null {
  const v = raw ?? "";
  return (JJ_MARK_FIELDS as readonly string[]).includes(v) ? (v as JjMarkField) : null;
}

/** 화면에 그릴 열 — ECS JJ 폼과 같은 배열. */
export function jjSeatTextCols(): readonly RosterTextCol[] {
  return rosterTextCols("selfStudy");
}

export function isJjMarkField(field: MarkTextField): field is JjMarkField {
  return (JJ_MARK_FIELDS as readonly string[]).includes(field);
}
