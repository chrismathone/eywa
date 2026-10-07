/**
 * **JJ실 시수를 선생님에게 주기** — 순수 규칙(Vitest). 원장 2026-10-07:
 *   *"지금 회차 확정에 JJ가 없으니까 이 고생을 하고 있는데, 회차 확정에 JJ반이 생기면 거기서 주면 그냥 쉽게 해결할 수 있는것 같은데?"*
 *   → 회차 확정의 반 묶음에 **JJ실 줄**을 세우고, 대신 수업한 **날짜를 골라** 선생님에게 준다(학생 한 명 · 그 반 그 날 전원).
 *
 * 주는 것은 새 저장 칸이 아니다 — 그 날 그 학생의 JJ실 출결 기록에 귀속 표식(`attendance_records.taught_by`, 0316a)을 단다.
 * 그 기록은 그 선생님 출석부의 시수가 되고(렌즈가 `taughtBy`를 가장 먼저 본다), 등록 차수 몫(실급여 상한)도 함께 옮겨지며
 * (`withTakenSeatUnits`), JJ실 월간 출석부의 시수 합계에서는 빠진다. 여기는 **어느 행을 누구 몫으로 고칠지**만 정한다.
 *
 * 🔴 JJ실 기록만이다(`isJjSeatRow` — 랩실 기록은 자리 시수가 급여 근거라 대상이 아니다).
 * 🔴 판정은 교시마다 **가장 최근 행**(그 칸의 값)으로 하고, 귀속은 같은 교시의 옛 정정 행까지 함께 고친다(다음 정정 때 갈리지 않게).
 */
import { consumedUnits, type AttendanceMark } from "./cell-display";
import { isJjSeatRow } from "./seat-transfer";
import type { AxisSlot } from "./teacher-axis";

export type SeatGiveRecord = {
  id: string;
  studentId: string;
  date: string;
  slotStart: string | null;
  seatLabel: string | null;
  recordedVia: string | null;
  taughtBy: string | null;
  status: AttendanceMark;
  units: number | null;
  recordedAt: string | null;
};

/** 한 칸(학생 × 날짜)의 JJ실 기록 요약. */
export type SeatGiveCell = {
  studentId: string;
  date: string;
  /** 그 칸의 JJ실 시수(교시별 최신 행의 합 — 결석은 0 · 미입력은 1, 출석부 칸과 같은 셈). */
  units: number;
  /** 지금 몫 — null = JJ실 그대로 · id = 그 선생님 · "mixed" = 교시마다 다르다. */
  holder: string | null | "mixed";
  /** 귀속을 고칠 행(그 칸 JJ 교시의 **모든** 행 — 옛 정정 행까지). */
  rowIds: string[];
  /**
   * 몫별 조각 — 교시마다 몫이 다른 칸(`mixed`)은 조각이 둘 이상이다. 옮길 때 조각마다 (실제 이전 몫 → 새 몫)으로 세어야
   * 감사로그가 맞다(한 덩어리로 접으면 A에게서 빠진 시수의 '되돌리기' 줄이 사라진다 — 재리뷰 2026-10-07).
   */
  parts: { holder: string | null; units: number; rowIds: string[] }[];
};

export const seatGiveKey = (studentId: string, date: string) => `${studentId}|${date}`;

const round1 = (v: number) => Math.round(v * 10) / 10;

/** 한 반의 출결 기록 → 칸(학생 × 날짜)마다 JJ실 기록 요약. JJ실 기록이 없는 칸은 없다. */
export function seatGiveCells(records: readonly SeatGiveRecord[], slots: readonly AxisSlot[]): Map<string, SeatGiveCell> {
  // 교시(학생 × 날짜 × 시작)마다 모으고 최신 행을 고른다.
  const bySlot = new Map<string, SeatGiveRecord[]>();
  for (const r of records) {
    const key = `${r.studentId}|${r.date}|${r.slotStart ?? ""}`;
    const list = bySlot.get(key);
    if (list) list.push(r);
    else bySlot.set(key, [r]);
  }
  const acc = new Map<string, { studentId: string; date: string; units: number; holders: Set<string | null>; rowIds: string[]; parts: Map<string | null, { units: number; rowIds: string[] }> }>();
  for (const list of bySlot.values()) {
    const latest = [...list].sort((a, b) => (b.recordedAt ?? "").localeCompare(a.recordedAt ?? "") || b.id.localeCompare(a.id))[0]!;
    if (!isJjSeatRow({ slotStart: latest.slotStart, seatLabel: latest.seatLabel, recordedVia: latest.recordedVia }, slots, latest.date)) continue;
    const key = seatGiveKey(latest.studentId, latest.date);
    const cell = acc.get(key) ?? { studentId: latest.studentId, date: latest.date, units: 0, holders: new Set<string | null>(), rowIds: [], parts: new Map<string | null, { units: number; rowIds: string[] }>() };
    const units = consumedUnits(latest.status, latest.units);
    const holder = latest.taughtBy ?? null;
    const ids = list.map((r) => r.id);
    cell.units += units;
    cell.holders.add(holder);
    cell.rowIds.push(...ids);
    const part = cell.parts.get(holder) ?? { units: 0, rowIds: [] };
    part.units += units;
    part.rowIds.push(...ids);
    cell.parts.set(holder, part);
    acc.set(key, cell);
  }
  const out = new Map<string, SeatGiveCell>();
  for (const [key, cell] of acc) {
    out.set(key, {
      studentId: cell.studentId,
      date: cell.date,
      units: round1(cell.units),
      holder: cell.holders.size === 1 ? [...cell.holders][0]! : "mixed",
      rowIds: cell.rowIds,
      parts: [...cell.parts].map(([holder, part]) => ({ holder, units: round1(part.units), rowIds: part.rowIds })),
    });
  }
  return out;
}

export type SeatGiveChange = { studentId: string; date: string; teacherId: string | null };

export type SeatGivePlan = {
  /** (이전 몫 → 새 몫) 묶음 — 고칠 행 id와 감사로그 재료(날짜 · 학생 수 · 시수). 묶음마다 고치고 바로 로그를 남긴다. */
  moves: { from: string | null; to: string | null; dates: string[]; students: number; units: number; ids: string[] }[];
  /** 달라진 칸 수. */
  changed: number;
  /** 요청했지만 그 칸에 JJ실 기록이 없어 건너뛴 수(그사이 기록이 지워졌다). */
  missing: number;
};

/**
 * 요청한 칸들을 지금 기록에 대조해 고칠 행을 정한다. 이미 그 몫인 칸(조각)은 건너뛴다(같은 값으로 다시 쓰지 않는다).
 * 교시마다 몫이 달랐던 칸(`mixed`)은 요청한 한 몫으로 통일하되, **조각마다** (실제 이전 몫 → 새 몫)으로 센다.
 */
export function planSeatGive(cells: ReadonlyMap<string, SeatGiveCell>, changes: readonly SeatGiveChange[]): SeatGivePlan {
  const moves = new Map<string, { from: string | null; to: string | null; dates: Set<string>; students: Set<string>; units: number; ids: string[] }>();
  let changed = 0;
  let missing = 0;
  const seen = new Set<string>();
  for (const change of changes) {
    const key = seatGiveKey(change.studentId, change.date);
    if (seen.has(key)) continue; // 같은 칸을 두 번 보낸 요청 — 첫 값만 쓴다.
    seen.add(key);
    const cell = cells.get(key);
    if (!cell) {
      missing += 1;
      continue;
    }
    if (cell.holder === change.teacherId) continue;
    changed += 1;
    for (const part of cell.parts) {
      if (part.holder === change.teacherId) continue; // 이미 그 몫인 조각
      const moveKey = `${part.holder ?? ""}>${change.teacherId ?? ""}`;
      const move = moves.get(moveKey) ?? { from: part.holder, to: change.teacherId, dates: new Set<string>(), students: new Set<string>(), units: 0, ids: [] as string[] };
      move.dates.add(change.date);
      move.students.add(change.studentId);
      move.units += part.units;
      move.ids.push(...part.rowIds);
      moves.set(moveKey, move);
    }
  }
  return {
    moves: [...moves.values()].map((m) => ({ from: m.from, to: m.to, dates: [...m.dates].sort(), students: m.students.size, units: round1(m.units), ids: m.ids })),
    changed,
    missing,
  };
}
