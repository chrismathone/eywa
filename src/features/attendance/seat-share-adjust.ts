/**
 * **자리(JJ실·랩실) 몫을 수업 몫으로 돌리기** — 순수 규칙(Vitest). 원장 2026-10-07:
 *   *"JJ가 한달에 정해진 횟수를 19/5 이렇게 강제로 정한다기보다 20/4 등 유도리있게"*
 *   *"어떤반의 수업/JJ 비율을 19/5를 20/4로 변경할 수 있으면 가장 편할거같은데 · LAB도 마찬가지겠고"*
 *   *"반별로 한번에 설정도 가능하고, 반 내에서 개별적으로도 설정 가능하게"*
 *
 * 영어 반의 등록 차수(= 실급여 상한 `salaryBilledCap`의 제 몫)는 그 달 시간표에서 선생님 몫과 자리 몫으로 나뉜다. 담당이 자리 수업을
 * 대신한 달은 선생님이 실제로 더 가르쳤는데 몫은 시간표대로라 급여가 상한에 걸린다 — 그 달 그 반의 자리 몫에서 **몇 시수를 그 선생님
 * 몫으로 돌릴지**를 숫자로 적는다(0355a `attendance_seat_share_adjust`). 날짜를 고르지 않고 출결 기록도 건드리지 않는다.
 *
 * · 반 전체 값(`units`) + 따로 정한 학생(`students`) — 학생 값이 있으면 그 학생은 반 전체 값 대신 그 값을 쓴다(0도 값이다).
 * · 한 줄에서 실제로 가져가는 시수는 `seatShareTakeFor`가 센다 — 같은 반 선생님들이 그 줄의 자리 몫을 차례로 나눠 갖는다.
 * · 옮기는 일은 `withTakenSeatUnits`가 한다 — 그 줄의 자리 계획 몫까지만, 0.5 단위로.
 * 🔴 수업 차수(출결)는 그대로다 — 바뀌는 것은 등록 차수 몫(상한)뿐이라, 실제로 가르친 만큼만 급여가 는다.
 */
export type SeatShareAdjust = {
  /** 반 전체에 적용할 시수(0 = 반 전체 조정 없음). */
  units: number;
  /** 따로 정한 학생만 — 학생 id → 시수. */
  students: Record<string, number>;
};

/** 한 줄이 받을 수 있는 가장 큰 값 — 한 달 자리 교시 수를 넉넉히 덮는다(DB 제약과 같은 값). */
export const SEAT_SHARE_MAX = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 0.5 단위 · 0 이상 · 상한 이하의 수만. 그 밖(빈 값 · 글자 · 음수 · 0.3)은 null. */
export function parseSeatShareUnits(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n < 0 || n > SEAT_SHARE_MAX) return null;
  return Math.abs(n * 2 - Math.round(n * 2)) < 1e-9 ? Math.round(n * 2) / 2 : null;
}

/** 저장된 학생별 값(jsonb) → 깨끗한 맵. 모양이 틀리면 null(조용히 버리지 않는다). */
export function parseSeatShareStudents(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    const units = parseSeatShareUnits(raw);
    if (!UUID.test(id) || units === null) return null;
    out[id] = units;
  }
  return out;
}

/** 이 학생 줄에서 자리 몫 → 수업 몫으로 돌릴 시수 — 학생 값이 있으면 그 값, 없으면 반 전체 값. */
export function seatShareUnitsFor(adjust: SeatShareAdjust | null | undefined, studentId: string): number {
  if (!adjust) return 0;
  return Object.hasOwn(adjust.students, studentId) ? adjust.students[studentId]! : adjust.units;
}

/**
 * 한 학생 줄에서 **이 선생님이 실제로 가져가는 시수** — 같은 반의 조정값 전부를 선생님 id 순으로 그 줄의 자리 몫에서 차례로 깎는다.
 *
 * 🔴 선생님마다 따로 깎으면 안 된다 — 달 중간에 들어온 학생처럼 **그 줄의 자리 몫이 달 내내 계획보다 작은 줄**에서 두 선생님이 같은
 *    자리 시수를 각자 가져가, 둘의 상한 합이 청구액을 넘는다(적대 리뷰 2026-10-07: 자리 1인 줄에 A 2 + B 2 → 125,000 / 청구 100,000).
 *    어느 선생님 화면에서 세든 같은 순서로 깎아야 줄 단위로 합이 자리 몫을 넘지 않는다.
 * 🔴 **그 줄에 수업 몫이 없는 선생님은 건너뛴다** — 자리 교시만 다니는 학생 줄에 새 주인을 만들면, 확정이 계획보다 적은 달에
 *    '배분 확인'으로 빠져 상한이 줄 전체 청구액으로 풀린다(같은 리뷰). 이 조정은 그 선생님의 수업 / 자리 비율을 기울이는 것이다.
 * 0.5 단위로 내려서 센다(`withTakenSeatUnits`와 같은 식 — 여기서 센 값이 그대로 옮겨진다).
 */
export function seatShareTakeFor(
  byTeacher: ReadonlyMap<string, SeatShareAdjust> | null | undefined,
  teacherId: string,
  studentId: string,
  weights: ReadonlyMap<string, number>,
): number {
  if (!byTeacher?.size || !teacherId) return 0;
  let pool = Math.max(0, weights.get("") ?? 0);
  for (const id of [...byTeacher.keys()].sort()) {
    const want = (weights.get(id) ?? 0) > 0 ? seatShareUnitsFor(byTeacher.get(id), studentId) : 0;
    const take = Math.floor(Math.min(Math.max(0, want), pool) * 2 + 1e-9) / 2;
    if (id === teacherId) return take;
    pool -= take;
  }
  return 0;
}

/** 조정이 하나도 없는 값인가 — 줄을 지워도 되는가. */
export const seatShareEmpty = (adjust: SeatShareAdjust) => adjust.units === 0 && Object.keys(adjust.students).length === 0;

/** 두 값이 같은가(없음 = 반 전체 0 · 학생 없음). */
export function seatShareSame(a: SeatShareAdjust | null | undefined, b: SeatShareAdjust | null | undefined): boolean {
  const key = (v: SeatShareAdjust | null | undefined) => JSON.stringify([v?.units ?? 0, Object.entries(v?.students ?? {}).sort(([x], [y]) => x.localeCompare(y))]);
  return key(a) === key(b);
}

/**
 * 다음 값이 **어느 학생 줄에서도** 이전 값보다 크지 않은가 — 줄이거나 지우기만 하는 저장인가.
 * 그 달 그 반을 더는 맡지 않는 선생님의 줄 · 명단에서 빠진 학생의 값도 이런 저장으로는 고칠 수 있어야 한다(안 그러면 남은 값이
 * 영영 굳어 다른 선생님 몫까지 막는다 — 적대 리뷰 2026-10-07).
 * ⚠️ 학생 값을 지우면 그 학생은 반 전체 값을 따른다 — 0으로 빼 둔 학생의 값을 지우는 것은 **늘리는** 저장이다.
 */
export function seatShareOnlyShrinks(prev: SeatShareAdjust | null | undefined, next: SeatShareAdjust): boolean {
  const before = prev ?? { units: 0, students: {} };
  if (next.units > before.units) return false;
  return [...new Set([...Object.keys(before.students), ...Object.keys(next.students)])]
    .every((id) => seatShareUnitsFor(next, id) <= seatShareUnitsFor(before, id));
}

/**
 * 이 선생님이 한 학생 줄에서 가져갈 수 있는 **가장 큰 값**(반 전체 값과 학생별 값 가운데) — 여러 선생님이 같은 자리 몫을 나눠 갖는
 * 반에서 합이 자리 몫을 넘지 않는지 볼 때 쓴다(넘으면 같은 시수가 두 선생님 출석부에 선다).
 */
export const seatSharePeak = (adjust: SeatShareAdjust | null | undefined) =>
  adjust ? Math.max(adjust.units, 0, ...Object.values(adjust.students)) : 0;

/**
 * 반 전체의 **최종 상태**가 그 달 자리 계획 몫을 넘는가 — 선생님마다 가장 큰 값의 합으로 본다(조정 창과 저장이 같은 식을 쓴다).
 * 🔴 선생님 한 명씩이 아니라 최종 상태로 본다 — 두 선생님 값을 맞바꾸는 저장(합은 그대로)이 순서 때문에 거절되지 않게.
 * ⚠️ 넘더라도 **지금보다 늘지 않는 저장**은 막지 않는다 — 시간표가 바뀌어 이미 넘은 값을 줄일 수 있어야 한다.
 *    (넘은 채로 남은 값도 줄 단위로는 자리 몫까지만 옮겨진다 — `seatShareTakeFor`.)
 */
export function seatShareOverPlan(
  seat: number,
  before: Iterable<SeatShareAdjust | null | undefined>,
  after: Iterable<SeatShareAdjust | null | undefined>,
): boolean {
  const sum = (list: Iterable<SeatShareAdjust | null | undefined>) => [...list].reduce((total, value) => total + seatSharePeak(value), 0);
  const next = sum(after);
  return next > seat + 1e-9 && next > sum(before) + 1e-9;
}

/** 한 줄 요약 — "1시수" · "1시수 · 따로 2명" · "따로 2명". */
export function seatShareSummary(units: number, ownStudents: number, format: (units: number) => string): string {
  return [units > 0 ? `${format(units)}시수` : null, ownStudents > 0 ? `따로 ${ownStudents}명` : null].filter(Boolean).join(" · ");
}
