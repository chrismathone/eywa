/**
 * 장부의 빈 칸 사유 — **결석** / **숙제없음** 분류(순수 · 서버/화면 공용).
 * 2026-10-09 표시 정정: 결석 분류는 유지하되 화면에는 날짜·색상·문구 없이 '—'로 표시한다.
 *
 * 원장 2026-10-01: *"결석인 경우에 - 말고 '결석'으로 처리해 놓을까? 숙제가 없었으면 '숙제없음'으로 대체하고."*
 *
 * 회차는 학생마다 '숙제가 나간 수업'을 센 것이라, 같은 반 다른 학생에게 있는 날이 이 학생에겐 없으면 뒤쪽 칸이 비어 있다.
 * 그 빈 칸에 **반에 숙제가 나갔는데 이 학생에겐 회차가 없는 날**을 날짜순으로 채워 이유를 말한다.
 *  · 그날 출결이 결석 → "결석" · 수강 중이었고 결석이 아니면 → "숙제없음" · 그날 수강생이 아니었으면 → 채우지 않는다('—').
 *  · 🔴 이 칸은 **회차가 아니다** — 완료 n/m의 m·열 수·필터·CSV에 들어가지 않는다("숙제 나간 날만 횟수가 늘어난다").
 *  · 출결 판정은 새로 만들지 않는다: 교시별 최신 정정본(`effectiveAttendanceRecords`)의 상태를 하루로 접는다 —
 *    출석·지각·조퇴(수업에 온 상태)가 하나라도 있으면 온 날(출석부가 하루를 접을 때 '들었으면 결석을 대표로 세우지 않는다'와 같다),
 *    없고 결석·공결(`absent`·`excused`, 표기 '결석')이 있으면 결석. 🔴 보강(`makeup`)은 출석이 아니라서 결석을 메우지 못한다 —
 *    같은 날 결석 교시와 보강 기록이 함께 있어도 결석이다(보강은 보강일 자기 칸에 찍힌다).
 *  · 수강 판정은 원스크린·장부 명단과 같은 `rosterIncludesEnrollment`(시작·종료·휴원·분리등원 요일) — 기록이 있는 날은 명단 밖이어도
 *    그 기록을 따른다(출석부가 기록 있는 행을 남기는 것과 같다).
 */
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { rosterIncludesEnrollment } from "@/features/onescreen/roster-filter";
import type { LedgerRound } from "./rounds";
import { roundPairKey } from "./rounds";
import type { LedgerEnrollment } from "./ledger-roster";

export type BlankReason = "absent" | "none";
/** 날짜 → 사유. 키가 없는 날은 그 학생이 그 반 수강생이 아니었던 날('—' 그대로). */
export type BlankFacts = Record<string, Record<string, BlankReason>>;
export type BlankCell = { date: string; reason: BlankReason };
export const BLANK_LABEL: Record<BlankReason, string> = { absent: "결석", none: "숙제없음" };

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** 수업에 온 상태 — 보강(makeup)은 일부러 뺀다(보강은 출석이 아니다). */
const CAME: ReadonlySet<string> = new Set(["present", "late", "early_leave"]);
export type DaySlot = { status: string };
export type BlankAttendanceRow = {
  id: string; student_id: string; class_id: string; session_date: string; slot_start: string | null; status: string; recorded_at: string;
};

/** 한 학생의 한 날이 결석인가 · 숙제없음인가 · 수강생이 아니었나(null). */
export function blankReasonOn(date: string, enrollments: readonly LedgerEnrollment[], slots: readonly DaySlot[]): BlankReason | null {
  if (slots.length) {
    if (slots.some((s) => CAME.has(s.status))) return "none";
    return slots.some((s) => s.status === "absent" || s.status === "excused") ? "absent" : "none";
  }
  const weekday = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return enrollments.some((row) => rosterIncludesEnrollment(row, date, weekday, true)) ? "none" : null;
}

/** 서버용 — (반·학생·날짜) 목록 + 수강·출결 재료 → 화면이 읽을 사유 지도(`classId:studentId` → 날짜 → 사유). */
export function buildBlankFacts(input: {
  targets: readonly { classId: string; studentId: string; dates: readonly string[] }[];
  enrollments: readonly LedgerEnrollment[]; records: readonly BlankAttendanceRow[];
}): BlankFacts {
  const enrollmentsOf = new Map<string, LedgerEnrollment[]>();
  for (const row of input.enrollments) {
    const key = roundPairKey({ classId: row.class_id, studentId: row.student_id });
    enrollmentsOf.set(key, [...(enrollmentsOf.get(key) ?? []), row]);
  }
  const slotsOf = new Map<string, DaySlot[]>();
  for (const row of effectiveAttendanceRecords(input.records)) {
    const key = `${roundPairKey({ classId: row.class_id, studentId: row.student_id })}:${row.session_date}`;
    slotsOf.set(key, [...(slotsOf.get(key) ?? []), { status: row.status }]);
  }
  const facts: BlankFacts = {};
  for (const target of input.targets) {
    const pair = roundPairKey(target);
    for (const date of target.dates) {
      const reason = blankReasonOn(date, enrollmentsOf.get(pair) ?? [], slotsOf.get(`${pair}:${date}`) ?? []);
      if (reason) (facts[pair] ??= {})[date] = reason;
    }
  }
  return facts;
}

/**
 * 화면용 — 학생의 빈 칸에 채울 사유들(앞에서부터, 최대 `slots`칸).
 * `classDates` = 그 반에 숙제가 나간 날들(그 반 학생들의 숙제 날짜 합), `own` = 이 학생의 회차.
 */
export function blankCells(input: {
  classDates: readonly string[]; own: readonly Pick<LedgerRound, "homeworkDate">[];
  facts: Record<string, BlankReason> | undefined; slots: number;
}): BlankCell[] {
  if (input.slots <= 0 || !input.facts) return [];
  const mine = new Set(input.own.map((round) => round.homeworkDate));
  const cells: BlankCell[] = [];
  for (const date of input.classDates) {
    const reason = input.facts[date];
    if (mine.has(date) || !reason) continue;
    cells.push({ date, reason });
    if (cells.length >= input.slots) break;
  }
  return cells;
}
