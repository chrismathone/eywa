/**
 * MCS 칸 상태 판정 — **단일 소스**(순수, Vitest). 진도표 칸·진도 레일 점·툴바 요약이 전부 이걸 통과한다.
 *
 * 🔴 **"기록이 없다"는 이유가 셋이고, 셋을 한 색으로 뭉치면 거짓 숫자가 나온다.**
 *    실측(2026-08 수학 전체, 수강 기간을 지켜서 센 값): 학생-수업일 2,533칸 중 보고서가 없는 칸이
 *    886개인데 그중
 *    · 203칸은 **결석**(안 온 사람의 수업 기록을 요구하는 건 거짓 재촉이다)
 *    · 410칸은 **출결 기록조차 없다**(8/15 광복절·8/17이 대부분 — 그날은 반 전체가 비어 있다)
 *    · 남는 **273칸**만이 "왔는데 안 적힌" 진짜 미작성이다(작성률 86%).
 *    886을 미작성이라 부르면 실제의 3.2배이고, 그 숫자를 본 사람은 화면을 믿지 않게 된다.
 *
 * 🔴 **수강 기간 밖은 아예 칸이 아니다.** 달 중간에 들어온 학생에게 그 전 날짜를 '흔적 없음'으로
 *    칠하면 오지도 않은 날을 빠뜨린 것처럼 보인다. 판정은 [`roster.ts`](./roster.ts) 단일 소스 —
 *    수강 종료·**반이동 전출**·**학원 퇴원**을 함께 본다(셋 다 봐야 "재원"이 참이 된다).
 *
 * ⚠️ 출결 상태는 `AttendanceStatusKey`(코드 고정)를 그대로 쓴다 — 여기서 새 enum을 만들지 말 것.
 *    `excused`(사유 결석)는 결석과 같은 취급(둘 다 "안 왔다")이고, `early_leave`는 온 것이다.
 */
import { isOnMathRoster, type MathEnrollmentWindow } from "./roster";
import type { AttendanceStatusKey } from "@/features/attendance/status-color";

/** 칸 하나가 놓일 수 있는 자리. */
export type MathCellState =
  /** 그 날 수업 기록(lesson_reports)이 있다. */
  | "written"
  /** 왔는데(출석·지각·조퇴·보강) 수업 기록이 없다 — **진짜 미작성**. */
  | "unwritten"
  /** 결석(사유 결석 포함) — 기록이 없는 게 정상이다. */
  | "absent"
  /** 출결도 수업 기록도 없다 — 그날 반이 안 돌았거나 아무도 안 찍었다. */
  | "untracked"
  /** 그 날짜에 이 학생은 이 반 소속이 아니었다 — 칸을 만들지 않는다. */
  | "off-roster";

/** 온 것으로 치는 출결 상태 — 이 상태에서 기록이 없으면 미작성이다. */
const ATTENDED: ReadonlySet<string> = new Set<AttendanceStatusKey>([
  "present",
  "late",
  "early_leave",
  "makeup",
]);

/** 안 온 것으로 치는 상태 — 기록이 없어도 미작성이 아니다. */
const MISSED: ReadonlySet<string> = new Set<AttendanceStatusKey>(["absent", "excused"]);

export type { MathEnrollmentWindow } from "./roster";

export function cellStateOf(args: {
  /** 그 학생의 이 반 수강 구간(여러 건일 수 있다 — 나갔다 돌아온 경우). */
  enrollments: readonly MathEnrollmentWindow[];
  /** `students.withdrawn_at` — 수강에 종료일이 안 찍힌 채 퇴원한 경우를 여기서 잡는다. */
  withdrawnAt: string | null;
  date: string;
  /** 그 날 그 학생의 출결 상태. 여러 교시면 호출부가 대표 하나로 접어서 넘긴다. */
  attendance: string | null | undefined;
  /** 그 날 그 학생의 수업 기록이 있는가. */
  hasReport: boolean;
}): MathCellState {
  if (!isOnMathRoster(args.enrollments, args.withdrawnAt, args.date)) return "off-roster";
  if (args.hasReport) return "written";
  const att = args.attendance ?? null;
  if (att && MISSED.has(att)) return "absent";
  if (att && ATTENDED.has(att)) return "unwritten";
  // 출결이 없거나 모르는 상태값이면 '왔다'로 넘겨짚지 않는다 — 없는 미작성을 만드는 쪽이 더 나쁘다.
  return "untracked";
}

/**
 * 하루에 교시가 둘 이상이면 대표 상태 하나로 접는다.
 * 🔴 **결석이 이긴다** — 1교시 출석·2교시 결석인 날을 '출석'으로 접으면 결석이 화면에서 사라진다.
 *    그 다음이 '왔다'(present/late/…), 아무것도 없으면 null.
 */
export function foldDayAttendance(statuses: readonly (string | null | undefined)[]): string | null {
  let attended: string | null = null;
  for (const s of statuses) {
    if (!s) continue;
    if (MISSED.has(s)) return s;
    if (!attended) attended = s;
  }
  return attended;
}

export type MathFillStats = {
  /** 기록이 있는 칸. */
  written: number;
  /** 왔는데 안 적힌 칸 — 조치가 필요한 유일한 수. */
  unwritten: number;
  absent: number;
  untracked: number;
  /** written + unwritten + absent + untracked (off-roster 제외). */
  total: number;
  /** 왔는데 안 적힌 칸이 하나도 없으면 100. 분모는 **온 칸만**(written + unwritten). */
  pct: number;
};

export function tallyCells(states: readonly MathCellState[]): MathFillStats {
  const out: MathFillStats = { written: 0, unwritten: 0, absent: 0, untracked: 0, total: 0, pct: 0 };
  for (const s of states) {
    if (s === "off-roster") continue;
    out.total += 1;
    if (s === "written") out.written += 1;
    else if (s === "unwritten") out.unwritten += 1;
    else if (s === "absent") out.absent += 1;
    else out.untracked += 1;
  }
  // 🔴 분모에서 결석·흔적없음을 뺀다 — 안 온 날을 분모에 넣으면 결석이 많은 반일수록
  //    작성률이 낮게 나와, 성실히 적은 담임이 나쁘게 보인다.
  const shown = out.written + out.unwritten;
  out.pct = shown === 0 ? 100 : Math.round((out.written / shown) * 100);
  return out;
}
