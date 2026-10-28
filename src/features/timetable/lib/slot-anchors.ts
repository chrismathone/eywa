import { enrollmentAttendsOnDay, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";

/**
 * 배치 시각에 **매달린 기록** — 반 블록 옮기기(`moveClassSlots`)가 적용일 이후 이 기록을 본다([[#126]]).
 * 기록은 (반, 날짜, `slot_start`)로 배치에 매달려 있어 배치만 옮기면 옛 시각에 남는다 — 수업 시트는 2026-09-22부터 고아 교시를
 * 그리지 않아 **경고 없이 사라진 것처럼** 보인다(리뷰 2026-10-28: 운영 미래분 출결 282건·계획 줄 454건·학생 기록 436건·미룸 11건).
 * - `carry`가 있는 표 = **새 교시로 함께 옮긴다**(원장 2026-10-28 (가)안 — 날짜 규칙·판정은 [`slot-carry.ts`](./slot-carry.ts)).
 *   `keyColumns` = 유니크 열쇠의 날짜·교시 밖 칸(옮기는 순서·겹침 판정에 쓴다) · `slotInKey` = 유니크 열쇠에 교시가 드나.
 * - `carry: null` = **출결** — 실제로 찍힌 기록이고 급여로 흐르니 시스템이 옮기지 않는다(있으면 막는다).
 * - 수업 시트 교시 메모(`class_sheet_memos`의 `slot:날짜:HH:MM` 키)도 함께 옮긴다 — 모양이 달라(열쇠 글자) 여기 없이 서버가 따로 읽는다.
 * ⚠️ 옮기지 않는 것: `seat_period_pins`(요일·적용 시작일로 매달리고 끝나는 날 칸이 없어 쪼갤 수 없다 · 운영 0건).
 * 칸 이름은 시험이 SQL 정의와 대조한다(`slot-anchor-columns.test.ts`).
 */
export const SLOT_ANCHORS = [
  { table: "attendance_records", dateColumn: "session_date", label: "출결", carry: null },
  {
    table: "class_sheet_plan_lines",
    dateColumn: "plan_date",
    label: "수업 계획",
    // 유니크 class_sheet_plan_lines_pos_uq(…, plan_date, slot_start, term_mode, line_no)
    carry: { keyColumns: ["term_mode", "line_no"], slotInKey: true },
  },
  {
    table: "class_sheet_student_marks",
    dateColumn: "mark_date",
    label: "학생 기록",
    carry: { keyColumns: ["student_id"], slotInKey: true },
  },
  {
    table: "class_lesson_shifts",
    dateColumn: "plan_date",
    label: "미룸·당김 표식",
    // 유니크 class_lesson_shifts_lane_uniq(…, plan_date, slot_start, lane, pos)
    carry: { keyColumns: ["lane", "pos"], slotInKey: true },
  },
  { table: "class_sheet_slot_flags", dateColumn: "flag_date", label: "Shouting 체크", carry: { keyColumns: [], slotInKey: true } },
  {
    table: "seat_period_moves",
    dateColumn: "session_date",
    label: "자리 이동",
    // 유니크(seat, session_date, class_id, student_id) — 교시가 열쇠에 없다(그날 그 학생이 설 교시 하나).
    carry: { keyColumns: ["seat", "student_id"], slotInKey: false },
  },
] as const;

export type SlotAnchorHit = { label: string; count: number; lastDate: string };

/** `YYYY-MM-DD` 다음 날(UTC 결정적 — KST 날짜 문자열 산술의 앱 관례). */
export function nextDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + 1)).toISOString().slice(0, 10);
}

/**
 * 막힘 안내(출결) — 🔴 기록을 지우라고 하지 않는다(출결은 급여로 흐른다). 마지막 기록 다음 날부터 적용하도록 권하고, 출결은 함께
 * 옮기지 않는다는 것을 밝힌다(종전 문구 "그 기록을 먼저 정리한 뒤"는 출결 삭제를 부추겼다 — 리뷰 2026-10-28). 다른 기록은 함께 옮긴다.
 */
export function slotAnchorBlockText(hits: readonly SlotAnchorHit[]): string {
  const last = hits.reduce((m, h) => (h.lastDate > m ? h.lastDate : m), "");
  const what = hits.map((h) => `${h.label} ${h.count}건`).join(" · ");
  return `적용일 이후 이 교시에 이미 적힌 기록이 있습니다(${what} · 마지막 ${last}) — 출결은 실제로 찍힌 기록이라 새 교시로 함께 옮기지 않습니다(옮기면 옛 시각에 남아 화면에서 사라집니다). 적용일을 ${nextDay(last)} 이후로 정해 주세요`;
}

/**
 * 요일을 옮기면 블록에 **새로 들거나 빠지는** 분리등원 학생 — 옛 요일에 오던 것과 새 요일에 올 것이 다르면(`attendance_days`는
 * 요일만 적어 블록을 못 가리킨다). 빈 목록이면 반의 모든 요일이라 바뀌지 않는다. 적용일에 이미 끝난 수강은 빼다(종료 규약은
 * `isEnrollmentEndedOn` 한 곳 — 반이동 종료일은 그날 이미 새 반).
 */
export function daySplitStudents(
  enrollments: readonly { name: string; attendanceDays: readonly string[] | null; endDate?: string | null; isTransferred?: boolean }[],
  dayChanges: readonly { from: string; to: string }[],
  effective: string,
): string[] {
  return enrollments
    .filter((e) => !isEnrollmentEndedOn(e.endDate, effective, e.isTransferred))
    .filter((e) => dayChanges.some((c) => enrollmentAttendsOnDay(e.attendanceDays, c.from) !== enrollmentAttendsOnDay(e.attendanceDays, c.to)))
    .map((e) => e.name);
}
