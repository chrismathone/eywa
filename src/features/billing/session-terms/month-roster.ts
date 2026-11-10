/**
 * **그 달의 (학생 × 반) 줄 집합** — 월별 출석부와 회차 확정이 **같은 규칙**으로 줄을 세우기 위한 순수 판정
 * (원장 2026-09-18 *"출석부에 존재하는 행 개수와, 회차 확정의 행 개수가 서로 유기적으로 일치해야해"* ·
 * *"그래야 모든 수업에 대해 수납액을 분배 가능하다"* · *"보강 추가 등으로 출석부 행이 더 생길 수도 있으니 거기에 맞춰서
 * 자동으로 회차 확정에도 행이 추가되면 좋겠네. 서로 완전히 일치하게 유기적 연동"*).
 *
 * 규칙은 월별 출석부(`getMonthlyAttendanceMatrix`, attendance/server/queries.ts)의 줄 모수 세 갈래를 그대로 옮긴 것이다:
 *  ① 수강 — 그 반 수강행이 그 달과 겹친다: `start_date ≤ 월말`(조회 조건) ∧ 휴원(on_hold) 아님 ∧ `end_date`가 없거나 월초 이후.
 *  ② 기록 — 그 달 그 반에 출결 기록이 있는데 **그 반 수강행이 하나도 없는** 학생(보강 방문). 🔴 휴원 중이거나 월초 전에 끝난
 *     수강행이 있는 학생은 기록이 있어도 세우지 않는다 — 출석부가 그렇게 숨긴다("휴원인데 기록 있음"을 보강으로 되살리지 않는다,
 *     queries.ts 1118-1125). 두 화면이 다른 말을 하면 원장이 세는 수가 갈린다.
 *  ③ 예약 — 그 달 그 반에 보강 **예약**(status=reserved)이 있는 학생(수강행 없음). 출석부는 명단엔 세우되 총원엔 안 센다 —
 *     여기서도 `sources`에 `reserved`로 남겨 소비처가 가른다(회차 확정은 확정 대상이 아닌 줄로 본다).
 * 🔴 **강사 렌즈는 없다** — 회차 확정은 사무실 화면(테넌트 전체·달력월)이다. 출석부 강사 보기가 방문자를 `ownsSlot`로 좁히는 것은
 *    그 화면의 값 렌즈이고, 관리자 반별 보기의 줄과 이 함수의 줄이 같다.
 * 🔑 기간 축은 **출석부 기본 보기와 같은 창**이다 — 반의 과목에 세션(0189a `operating_periods`)이 있으면 그 세션 창, 없으면 달력월
 *    (출석부 `getPeriodWindow({ subjectKey })`와 같은 해석, 보이지 않는 보강 반은 출석부처럼 달력월). 창은 서버(`loadMonthRoster`)가 정해
 *    여기엔 이미 창 안으로 거른 행과 창 시작(`from`)만 들어온다. ⚠️ 회차 계획·소비 RPC는 여전히 달력월이다(청구 축, 종전).
 */

import { makeupStudentIds } from "@/features/attendance/input-roster";
import { round1 } from "@/lib/guards";

/** 이 쌍이 줄로 서는 근거. 하나 이상이다. */
export type MonthRosterSource = "enrolled" | "recorded" | "reserved";

export type MonthRosterPair = {
  studentId: string;
  classId: string;
  sources: MonthRosterSource[];
  /**
   * 그 달 이 반에 찍힌 **실제 시수 합**(present·late·early_leave·makeup, `session_units` 없으면 1) — 기록이 있는 쌍만, 없으면 null.
   * 🔑 RPC `session_term_attendance`(0267a)의 `attendance_units` 셈법과 같다(같은 날·같은 교시는 마지막 행 하나). 회차 행이 없는
   *    줄은 RPC 결과에 없어서(terms CTE가 회차 행 기준) 화면이 "실제 N시수"를 이 값으로 적는다.
   */
  recordedUnits: number | null;
};

export type MonthRosterEnrollment = {
  studentId: string;
  classId: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
};

export type MonthRosterRecord = {
  studentId: string;
  classId: string;
  sessionDate: string;
  slotStart: string | null;
  status: string;
  sessionUnits: number | null;
};

export type MonthRosterReservation = { studentId: string; classId: string };

/** RPC 0267a와 같은 소비 상태 — 결석·공결은 시수가 아니다. */
const CONSUMED_STATUSES = new Set(["present", "late", "early_leave", "makeup"]);

export const monthRosterKey = (studentId: string, classId: string) => `${studentId}|${classId}`;

/**
 * 순수 판정 — 입력은 이미 **그 반의 기간 창으로 조회·거른** 행들이다(수강 `start_date ≤ 창 끝`, 기록·예약은 창 안).
 * `from`은 창 시작 — 수강 종료가 그보다 앞서면 그 달 줄이 아니다(출석부 `end_date < startIso` 제외와 같다). 반마다 창이 다르면
 * (과목별 세션 기간, 0189a) 반 id를 받는 함수로 준다.
 */
export function monthRosterPairs(input: {
  enrollments: readonly MonthRosterEnrollment[];
  records: readonly MonthRosterRecord[];
  reservations: readonly MonthRosterReservation[];
  from: string | ((classId: string) => string);
  /**
   * 실제 시수(`recordedUnits`)를 셀 기록 — 없으면 `records`로 센다. 🔑 줄 멤버십은 출석부 창(세션)이지만 **시수는 청구 축(달력월)** 이라
   * 서버가 따로 넘긴다(소비 RPC 0267a·계획이 달력월 — 같은 줄이 행이 생기는 순간 숫자가 바뀌지 않게, 재리뷰 2026-09-18).
   */
  unitRecords?: readonly MonthRosterRecord[];
}): MonthRosterPair[] {
  const { enrollments, records, reservations } = input;
  const fromOf = typeof input.from === "string" ? () => input.from as string : input.from;
  const live = new Map<string, MonthRosterPair>();
  for (const e of enrollments) {
    const key = monthRosterKey(e.studentId, e.classId);
    if (e.onHold) continue;
    if (e.endDate && e.endDate < fromOf(e.classId)) continue;
    if (!live.has(key)) live.set(key, { studentId: e.studentId, classId: e.classId, sources: ["enrolled"], recordedUnits: null });
  }

  // 실제 시수 — 같은 (학생·반·날짜·교시)는 한 행. 🔴 서버가 `effectiveAttendanceRecords`로 **이미 최신 정정만** 넘긴다
  //    (0267a `order by recorded_at desc, id desc`와 같은 규칙) — 여기서 순서로 고르지 말 것(id 순은 무작위다).
  const latest = (rows: readonly MonthRosterRecord[]) => {
    const cells = new Map<string, MonthRosterRecord>();
    for (const r of rows) cells.set(`${r.studentId}|${r.classId}|${r.sessionDate}|${r.slotStart ?? ""}`, r);
    return [...cells.values()];
  };
  const recordedPairs = new Map<string, MonthRosterRecord>();
  for (const r of latest(records)) {
    const key = monthRosterKey(r.studentId, r.classId);
    if (!recordedPairs.has(key)) recordedPairs.set(key, r);
  }
  const unitsByPair = new Map<string, number>();
  for (const r of latest(input.unitRecords ?? records)) {
    if (!CONSUMED_STATUSES.has(r.status)) continue;
    const key = monthRosterKey(r.studentId, r.classId);
    unitsByPair.set(key, round1((unitsByPair.get(key) ?? 0) + (r.sessionUnits ?? 1)));
  }

  const out = new Map<string, MonthRosterPair>(live);
  const reservedKeys = new Set(reservations.map((v) => monthRosterKey(v.studentId, v.classId)));
  // 수강 줄에 기록·예약이 있으면 근거를 더한다.
  for (const [key] of recordedPairs) {
    const existing = out.get(key);
    if (!existing) continue;
    existing.sources.push("recorded");
    existing.recordedUnits = unitsByPair.get(key) ?? 0;
  }
  for (const key of reservedKeys) {
    const existing = out.get(key);
    if (existing && !existing.sources.includes("reserved")) existing.sources.push("reserved");
  }

  // ②③ 수강행 없는 방문자(기록·예약) — 🔴 출석부와 **같은 함수**(`makeupStudentIds`, 일별 입력·월별 출석부 공용)로 반마다 가른다.
  //    "그 반 수강행이 있나"는 휴원·기간 전 종료까지 **전부**로 본다 — 그래서 휴원생의 기록은 방문자로 되살아나지 않는다.
  //    입력 순서도 출석부 `extraIds`와 같다(기록 먼저, 예약 뒤).
  const enrolledByClass = new Map<string, string[]>();
  for (const e of enrollments) (enrolledByClass.get(e.classId) ?? enrolledByClass.set(e.classId, []).get(e.classId)!).push(e.studentId);
  const visitorsByClass = new Map<string, string[]>();
  for (const r of recordedPairs.values()) (visitorsByClass.get(r.classId) ?? visitorsByClass.set(r.classId, []).get(r.classId)!).push(r.studentId);
  for (const v of reservations) (visitorsByClass.get(v.classId) ?? visitorsByClass.set(v.classId, []).get(v.classId)!).push(v.studentId);
  for (const [classId, visitorIds] of visitorsByClass) {
    for (const studentId of makeupStudentIds(visitorIds, enrolledByClass.get(classId) ?? [])) {
      const key = monthRosterKey(studentId, classId);
      const recorded = recordedPairs.has(key);
      const sources: MonthRosterSource[] = [];
      if (recorded) sources.push("recorded");
      if (reservedKeys.has(key)) sources.push("reserved");
      out.set(key, { studentId, classId, sources, recordedUnits: recorded ? unitsByPair.get(key) ?? 0 : null });
    }
  }
  return [...out.values()].sort((a, b) => a.classId.localeCompare(b.classId) || a.studentId.localeCompare(b.studentId));
}


/**
 * 회차 행이 아직 없는 줄의 **화면용 id** — 표·초안·선택이 전부 `row.id`를 키로 쓰므로 유일하고 안정적인 값이 필요하다.
 * 🔴 DB id가 아니다 — 서버 액션은 `parseVirtualTermId`로 풀어 **그 달 줄 집합에 있는지 다시 판정**하고(#77) 확정·배분을
 *    저장하는 순간에만 실제 행을 만든다(미리 만들면 다음 '계획 갱신'이 지우고 검증 화면의 미확정 수만 부풀린다).
 */
export const VIRTUAL_TERM_PREFIX = "v:";

export function virtualTermId(studentId: string, classId: string): string {
  return `${VIRTUAL_TERM_PREFIX}${studentId}:${classId}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VIRTUAL_RE = new RegExp(`^v:(${UUID}):(${UUID})$`, "i");

export function parseVirtualTermId(id: string): { studentId: string; classId: string } | null {
  const m = id.match(VIRTUAL_RE);
  return m ? { studentId: m[1]!, classId: m[2]! } : null;
}

export const isVirtualTermId = (id: string) => id.startsWith(VIRTUAL_TERM_PREFIX);

/**
 * 줄의 회차 상태 — 회차 행이 있으면 `term`, 없으면 청구서 유무로 갈린다.
 *  · `missing`     회차 행이 없는데 그 달 청구서(취소 아님)는 있다 → 확정·배분하는 순간 행을 만든다.
 *  · `no_invoice`  그 달 청구서가 없다 → 붙일 청구서가 없어 확정·배분을 잠근다(청구서는 수납 쪽 일).
 *  · `void_invoice` 청구서가 취소(void)됐다 → 같은 이유로 잠근다.
 * 🔴 raw 코드다 — 화면은 `TERM_STATE_LABEL`을 거친 한글만 내보낸다.
 */
export type TermRowState = "term" | "missing" | "no_invoice" | "void_invoice";

export function termRowState(input: { hasTerm: boolean; invoiceStatus: string | null | undefined }): TermRowState {
  if (input.hasTerm) return "term";
  if (!input.invoiceStatus) return "no_invoice";
  if (input.invoiceStatus === "void") return "void_invoice";
  return "missing";
}

/** 확정·배분으로 행을 **만들 수 있는** 상태인가(청구서가 있어야 한다). */
export const canMaterializeTerm = (state: TermRowState) => state === "missing";

/** 화면 라벨 — 한 벌(회차 확정 표·배분 창·시수 검증이 같이 읽는다). tone은 의미색 캐논: 손댈 것 = caution, 해당 없음 = inert. */
export const TERM_STATE_LABEL: Record<Exclude<TermRowState, "term">, { label: string; tone: "caution" | "inert"; tip: string }> = {
  missing: { label: "회차 없음", tone: "caution", tip: "출석부엔 있는데 회차 행이 아직 없습니다 — 시수를 확정하거나 수납을 배분하면 그때 행이 만들어집니다." },
  no_invoice: { label: "청구서 없음", tone: "inert", tip: "이 달 청구서가 없어 확정·배분할 곳이 없습니다 — 청구서가 생기면 여기서 확정합니다." },
  void_invoice: { label: "청구서 취소", tone: "inert", tip: "이 달 청구서가 취소(void)됐습니다 — 확정·배분할 수납이 없습니다." },
};

/** 회차 행은 있는데 그 달 줄 집합엔 없는 줄(종강·반이동·휴원 뒤 남은 행) — 돈이 걸려 있을 수 있어 감추지 않고 표식만 단다. */
/**
 * 회차 행은 있는데 이 달 **출석부(그 반의 세션 기간)** 엔 없는 줄 — 종강·반이동·휴원 뒤 남은 행이거나 달력월 경계의 수업(예정·실 소비는
 * 달력월로 센다). 예정 칸의 숫자는 그대로 두고 실납 칸 꼬리표로 선다.
 */
export const NO_LESSON_LABEL = {
  label: "출석부에 없음",
  tip: "이 달 출석부(세션 기간)엔 이 학생·반 줄이 없습니다 — 종강·반이동·휴원 뒤 남은 회차 행이거나 세션 경계의 수업입니다. 돈이 걸려 있을 수 있어 감추지 않습니다.",
} as const;
