/**
 * JJ실 시수 넘기기(원장 2026-10-07)의 **넘긴 뒤** 규칙 — 적대 리뷰가 잡은 세 구멍을 잠근다.
 *  ① 넘겨받은 JJ 행은 렌즈(칸의 값)에선 그 선생님 몫이지만 **강사 보기 저장은 손대지 않는다**(지우기·숫자 입력이 JJ실 기록을 망가뜨리지 않게).
 *  ② 넘겨받은 시수만큼 등록 차수 몫(= 실급여 상한)이 방에서 그 선생님으로 옮겨진다(안 옮기면 넘겨받아도 급여가 그대로다).
 *  ③ 넘긴 기록은 JJ실 월간 출석부의 시수 합계에서 빠진다("JJ가 -1").
 */
import { describe, expect, it } from "vitest";
import { planScopedDay, SCOPED_REJECT_MESSAGE } from "./ghost-transfer";
import { buildScopeOwner, buildScopeShare, type ScopeClassFacts } from "./scope-ownership";
import { planDayCellUnits, splitOutSeatRows, type DayTargetRow } from "./scoped-split";
import type { AxisSlot } from "./teacher-axis";
import { teacherTermSessions, withTakenSeatUnits, type TermShareWeights } from "./teacher-term-share";
import { salaryBilledCap } from "./salary-rates";

const CLASS = "c-mid2a";
const HOMEROOM = "t-homeroom";
const CHARLIE = "t-charlie";
const D = "2026-09-10"; // 목요일
const thu = (startTime: string, teacherId: string | null, label: string | null = null): AxisSlot => ({
  dayOfWeek: "thu", startTime, teacherId, slotTeacherLabel: label, validFrom: "2026-09-01", validTo: null,
});
/** 16:20 JJ실 · 17:20 Charlie · 18:20 Charlie. */
const FACTS: ScopeClassFacts = { homeroomTeacherId: HOMEROOM, slots: [thu("16:20:00", null, "JJ"), thu("17:20:00", CHARLIE), thu("18:20:00", CHARLIE)] };
const facts = new Map([[CLASS, FACTS]]);
const row = (id: string, over: Partial<DayTargetRow> = {}): DayTargetRow => ({ id, slot_start: "16:20:00", recorded_via: "seat", ...over });
const JJ_TAKEN = row("jj", { taught_by: CHARLIE });
const OWN1 = row("own1", { slot_start: "17:20:00", recorded_via: null });
const OWN2 = row("own2", { slot_start: "18:20:00", recorded_via: null });

describe("① 넘겨받은 JJ 행 — 렌즈에선 몫, 저장에선 자리", () => {
  const owner = buildScopeOwner({ teacherId: CHARLIE, facts });
  const share = buildScopeShare({ teacherId: CHARLIE, facts });
  const s = (r: DayTargetRow) => share(CLASS, D, r);

  it("렌즈(칸의 값·실급여)에선 그 선생님 몫이고, 저장 판정은 자리다 — 일부러 다르다", () => {
    expect(owner(CLASS, D, JJ_TAKEN)).toBe(true);
    expect(s(JJ_TAKEN)).toBe("seat");
    expect(share.takenSeat?.(CLASS, D, JJ_TAKEN)).toBe(true);
    // 넘기지 않은 JJ 행 · 다른 선생님이 넘겨받은 JJ 행 = 그냥 자리(막는 표식 아님).
    expect(s(row("jj0"))).toBe("seat");
    expect(share.takenSeat?.(CLASS, D, row("jj0"))).toBe(false);
    expect(s(row("jj-h", { taught_by: HOMEROOM }))).toBe("seat");
    expect(share.takenSeat?.(CLASS, D, row("jj-h", { taught_by: HOMEROOM }))).toBe(false);
    // 🔴 대신 보강 귀속이 걸린 **사람 수업** 행은 종전 그대로 제 몫이다(자리 신호가 없다).
    const makeup = row("mk", { slot_start: "19:20:00", recorded_via: null, taught_by: CHARLIE });
    expect(s(makeup)).toBe("mine");
    expect(share.takenSeat?.(CLASS, D, makeup)).toBe(false);
  });

  it("🔴 지우기·쓰기 대상에서 빠진다 — 강사 보기에서 그 칸을 지워도 JJ실 기록은 남는다", () => {
    const { write, seat } = splitOutSeatRows([JJ_TAKEN, OWN1, OWN2], (r) => s(r) === "seat", (r) => s(r) === "mine");
    expect(write.map((r) => r.id)).toEqual(["own1", "own2"]);
    expect(seat.map((r) => r.id)).toEqual(["jj"]);
    // 시수도 제 교시 행에만 나뉜다(JJ 행의 시수는 그대로).
    const plan = planDayCellUnits({ targets: [JJ_TAKEN, OWN1, OWN2], owns: (r) => s(r) === "mine", unitsVal: 2 });
    expect(plan.ok && [...plan.units.keys()]).toEqual(["own1", "own2"]);
  });

  it("🔴 넘겨받은 시수가 있는 칸은 강사 보기에서 고치지 않는다 — 입력도 지우기도(친 합계와 다시 읽은 합계가 갈린다)", () => {
    const taken = (r: DayTargetRow) => share.takenSeat?.(CLASS, D, r) === true;
    for (const clearing of [false, true]) {
      expect(planScopedDay({ targets: [JJ_TAKEN, OWN1], share: s, clearing, taken })).toEqual({ kind: "reject", reason: "seatTaken" });
      expect(planScopedDay({ targets: [JJ_TAKEN], share: s, clearing, taken })).toEqual({ kind: "reject", reason: "seatTaken" });
    }
    // 넘겨받은 행이 없는 칸은 종전 그대로(제 교시 = own · 자리뿐 + 입력 = 제 행을 새로 만든다).
    expect(planScopedDay({ targets: [row("jj0"), OWN1], share: s, clearing: false, taken })).toEqual({ kind: "own" });
    expect(planScopedDay({ targets: [row("jj0")], share: s, clearing: false, taken })).toEqual({ kind: "create" });
    // 반별 보기(스코프 없음)는 해당 없다.
    expect(planScopedDay({ targets: [JJ_TAKEN], share: null, clearing: false, taken })).toEqual({ kind: "own" });
    expect(SCOPED_REJECT_MESSAGE.seatTaken).toContain("넘겨받은 JJ실 시수가 있는 칸");
    // 선생님 계정도 따를 수 있는 안내 — 되돌리기는 관리자 몫이고, 선생님의 반별 보기도 같은 렌즈라 "반별 보기에서"는 거짓이다.
    expect(SCOPED_REJECT_MESSAGE.seatTaken).toContain("관리자가 JJ실 시수를 되돌린 뒤");
    expect(SCOPED_REJECT_MESSAGE.seatTaken).not.toContain("반별 보기");
  });

  it("다른 선생님 화면에선 그 행이 그냥 자리다 — 남이 넘겨받은 JJ 때문에 제 칸이 막히지 않는다", () => {
    const mine = buildScopeShare({ teacherId: HOMEROOM, facts });
    expect(mine(CLASS, D, JJ_TAKEN)).toBe("seat");
    expect(mine.takenSeat?.(CLASS, D, JJ_TAKEN)).toBe(false);
  });
});

describe("② 넘겨받은 시수만큼 등록 차수 몫이 옮겨진다(JJ −1 · 선생님 +1)", () => {
  /** 월 계획: Charlie 16 · JJ실 8 — 확정 24. */
  const weights = (): TermShareWeights => Object.assign(new Map([[CHARLIE, 16], ["", 8]]), { homeroomTeacherId: HOMEROOM });
  const term = { units: 24, daysBasis: false };

  it("넘겨받기 전 — 제 몫 16 · 상한은 청구액 × 16/24", () => {
    const mine = teacherTermSessions(term, CHARLIE, weights());
    expect(mine).toMatchObject({ units: 16, classUnits: 24 });
    expect(salaryBilledCap(240000, mine)).toBe(160000);
  });

  it("🔴 JJ 1시수를 넘겨받으면 제 몫 17 — 상한도 청구액 × 17/24로 는다(안 늘면 넘겨받아도 급여가 그대로다)", () => {
    const moved = withTakenSeatUnits(weights(), CHARLIE, 1);
    expect(moved.get(CHARLIE)).toBe(17);
    expect(moved.get("")).toBe(7);
    expect(moved.homeroomTeacherId).toBe(HOMEROOM);
    const mine = teacherTermSessions(term, CHARLIE, moved);
    expect(mine).toMatchObject({ units: 17, classUnits: 24 });
    expect(salaryBilledCap(240000, mine)).toBe(170000);
    // 반 전체 합은 그대로 — 다른 선생님 몫·담임 잔여 규칙이 안 바뀐다.
    expect([...moved.values()].reduce((a, b) => a + b, 0)).toBe(24);
  });

  it("🔴 0.5 단위로 내려서 옮긴다 — 1.3을 그대로 옮기면 '배분 확인'이 되어 상한이 줄 전체 청구액으로 풀린다", () => {
    const moved = withTakenSeatUnits(weights(), CHARLIE, 1.3);
    expect(moved.get(CHARLIE)).toBe(17);
    expect(moved.get("")).toBe(7);
    const mine = teacherTermSessions(term, CHARLIE, moved);
    expect(mine.allocationPending).toBeFalsy();
    expect(mine).toMatchObject({ units: 17, classUnits: 24 });
    expect(salaryBilledCap(240000, mine)).toBe(170000);
    // 반쪽 시수는 그대로 옮긴다 · 0.5에 못 미치면 옮길 것이 없다(원본 그대로).
    expect(withTakenSeatUnits(weights(), CHARLIE, 1.5).get(CHARLIE)).toBe(17.5);
    const w = weights();
    expect(withTakenSeatUnits(w, CHARLIE, 0.4)).toBe(w);
  });

  it("🔴 방 몫보다 많이는 못 옮긴다 · 자리 계획이 없는 줄은 그대로 · 0·음수·깨진 값은 무시", () => {
    expect(withTakenSeatUnits(weights(), CHARLIE, 20).get(CHARLIE)).toBe(24);
    expect(withTakenSeatUnits(weights(), CHARLIE, 20).get("")).toBe(0);
    const noSeat: TermShareWeights = Object.assign(new Map([[CHARLIE, 16]]), { homeroomTeacherId: HOMEROOM });
    expect(withTakenSeatUnits(noSeat, CHARLIE, 2)).toBe(noSeat);
    const w = weights();
    for (const bad of [0, -1, Number.NaN]) expect(withTakenSeatUnits(w, CHARLIE, bad)).toBe(w);
    // 원본은 바꾸지 않는다(같은 반의 다른 학생 줄이 같은 맵을 볼 수 있다).
    withTakenSeatUnits(w, CHARLIE, 1);
    expect(w.get(CHARLIE)).toBe(16);
  });
});
