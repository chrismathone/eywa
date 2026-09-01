/**
 * MCS 칸 상태 판정 — **단일 소스**(순수, Vitest). 진도표 칸·진도 레일 점·툴바 요약이 전부 이걸 통과한다.
 *
 * 🔴 **"기록이 없다"는 이유가 다섯이고, 한 색으로 뭉치면 거짓 숫자가 나온다.**
 *    실측(2026-08 수학 전체, 수강 기간을 지켜서 센 값): 학생-수업일 2,533칸 중 보고서가 없는 칸이
 *    886개인데 그중
 *    · 203칸은 **결석**(안 온 사람의 수업 기록을 요구하는 건 거짓 재촉이다)
 *    · 410칸은 **출결 기록조차 없다**(8/15 광복절·8/17이 대부분 — 그날은 반 전체가 비어 있다)
 *    · 남는 **273칸**만이 "왔는데 안 적힌" 진짜 미작성이다(작성률 86%).
 *    886을 미작성이라 부르면 실제의 3.2배이고, 그 숫자를 본 사람은 화면을 믿지 않게 된다.
 *
 * 🔴 **넷째 이유 = 아직 그날이 안 왔다**(원장 2026-09-01 제보: 9월 시트가 칸마다 *"출결도 기록도 없음"*).
 *    앞의 셋은 전부 **지난 일에 대한 사실**인데 미래 날짜를 거기 섞으면 아무도 잘못한 게 없는 칸이
 *    "아무 흔적이 없다"고 적힌다 — 9월을 9/1에 열면 전 칸이 그 문장이었다. `upcoming`은 **그 칸을
 *    판정에서 빼는 것**이지 새 실패가 아니다(작성률 분모에도 '흔적 없음' 수에도 안 들어간다).
 *    ⚠️ 순서가 중요하다 — **미리 찍힌 출결·기록이 있으면 그게 이긴다**(사실이 달력을 이긴다).
 *
 * 🔴 **다섯째 이유 = 학원 휴일이다**(원장 2026-09-01 *"ecs/mcs 휴일참조 시켜"*). 앞의 넷과 축이 다르다 —
 *    사람이 안 왔거나 아직 안 온 게 아니라 **학원이 안 열었다**. 그래서 결석·무기록과 **섞지 않고** 따로 센다.
 *    · 안 쓴 휴일 = 어떤 수에도 안 들어간다(작성률 분모 밖 — 휴일엔 의무가 없다)
 *    · 쓴 휴일   = `written`이다(**한 일로 인정** — 감점되지 않는다)
 *    규약 자체는 [`holiday.ts`](@/features/class-sheets/lib/holiday)가 갖고 있고 ECS도 같은 것을 읽는다.
 *    🔴 **칸을 없애지도 잠그지도 않는다** — 실측 2026-08-17(대체공휴일)에 출결 21행이 있다. 학원이 실제로
 *       수업한 날이라, 칸을 없애면 그 기록이 화면에서 사라진다.
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
  /** 아직 그 수업일이 안 지났다 — 비어 있는 게 정상이라 어떤 수에도 안 들어간다. */
  | "upcoming"
  /** 학원 휴일 — 수업 기록이 없는 게 정상이다. 안 쓴 휴일은 어떤 수에도 안 들어간다. */
  | "holiday"
  /** 그 날짜에 이 학생은 이 반 소속이 아니었다 — 칸을 만들지 않는다. */
  | "off-roster";

/**
 * 칸 상태의 한글 라벨 — **진도표 칸 문구와 진도 레일 툴팁이 같은 표를 읽는다.**
 *
 * 🔴 화면마다 사본을 두지 말 것. 이 파일에 `upcoming`을 더했을 때 두 화면의 사본을 각각 고쳐야 했고,
 *    한쪽만 고쳤으면 레일엔 계속 "출결도 기록도 없음"이 떴을 것이다(사본은 새 상태를 따라오지 않는다 —
 *    학생 상세 진도 탭의 `classnoteBadge` 사본이 회수 3종을 통째로 "—"로 삼킨 것과 같은 함정).
 * ⚠️ `written`은 보통 실제 교재·진도 문자열로 덮어쓴다 — 이 값은 그게 비었을 때의 폴백이다.
 */
export const CELL_STATE_LABEL: Record<MathCellState, string> = {
  written: "기록 있음",
  unwritten: "출석 · 기록 없음",
  absent: "결석",
  untracked: "출결도 기록도 없음",
  upcoming: "아직 수업 전",
  // ⚠️ 폴백이다 — 화면은 보통 실제 공휴일명("추석")으로 덮어쓴다(이름이 곧 사유라 훨씬 유용하다).
  holiday: "학원 휴일",
  "off-roster": "수강 전/후",
};

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
  /** 오늘(KST). 이 날짜보다 뒤면 아직 안 지난 수업일이다. */
  today: string;
  /** 그 날이 학원 휴일인가(학원설정 단일 소스 — 호출부가 `isHolidayOn`으로 접어서 넘긴다). */
  holiday?: boolean;
}): MathCellState {
  if (!isOnMathRoster(args.enrollments, args.withdrawnAt, args.date)) return "off-roster";
  // 🔴 **사실이 달력을 이긴다** — 휴일에 수업하고 적었으면 그건 `written`이고 100%로 인정된다
  //    (writing-rate.ts의 휴일 분기와 **같은 순서**: 휴일이 다른 분기보다 먼저 이기되, 쓴 것은 인정).
  if (args.hasReport) return "written";
  // 🔴 휴일은 결석·무기록·미래보다 **먼저** 이긴다 — 학원이 안 연 날에 "왔는데 안 적음"은 성립하지 않는다.
  //    (그날 출결이 찍혀 있어도 마찬가지다. 쓸 의무가 없으므로 미작성으로 세면 거짓 재촉이 된다.)
  if (args.holiday) return "holiday";
  const att = args.attendance ?? null;
  if (att && MISSED.has(att)) return "absent";
  if (att && ATTENDED.has(att)) return "unwritten";
  // 🔴 여기까지 왔으면 흔적이 하나도 없는 칸이다 — 그게 **지난 일인지 앞일인지**를 가른다.
  //    (미리 찍힌 출결·기록은 위에서 이미 이겼다: 사실이 달력을 이긴다.)
  if (args.date > args.today) return "upcoming";
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
  /** 아직 안 지난 수업일 — 어떤 판단에도 안 쓴다(세어만 둔다). */
  upcoming: number;
  /**
   * 학원 휴일이라 기록이 없는 칸 — 어떤 판단에도 안 쓴다(세어만 둔다).
   * ⚠️ 휴일에 **쓴** 칸은 여기 없다. 그건 `written`이다(한 일로 인정 — [[holiday.ts]] 규약).
   */
  holiday: number;
  /** written + unwritten + absent + untracked (off-roster·upcoming·holiday 제외 = **지난 칸만**). */
  total: number;
  /** 왔는데 안 적힌 칸이 하나도 없으면 100. 분모는 **온 칸만**(written + unwritten). */
  pct: number;
};

export function tallyCells(states: readonly MathCellState[]): MathFillStats {
  const out: MathFillStats = {
    written: 0,
    unwritten: 0,
    absent: 0,
    untracked: 0,
    upcoming: 0,
    holiday: 0,
    total: 0,
    pct: 0,
  };
  for (const s of states) {
    if (s === "off-roster") continue;
    // 🔴 아직 안 지난 칸은 `total`에도 안 넣는다 — 넣으면 "이 달 칸 N개 중 M개 작성"이 달 초에
    //    항상 처참해 보인다(아무 일도 안 일어난 것을 실패로 세는 꼴).
    if (s === "upcoming") {
      out.upcoming += 1;
      continue;
    }
    // 🔴 안 쓴 휴일도 마찬가지 — 학원이 안 연 날을 분모에 넣으면 추석이 낀 달의 담임이 나쁘게 보인다.
    //    (휴일에 **쓴** 칸은 위에서 `written`으로 들어와 분모·분자에 함께 잡힌다 = 100% 인정.)
    if (s === "holiday") {
      out.holiday += 1;
      continue;
    }
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
