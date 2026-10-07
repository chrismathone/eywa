import { describe, expect, it } from "vitest";
import {
  parseSeatShareStudents, parseSeatShareUnits, seatShareEmpty, seatShareOnlyShrinks, seatShareOverPlan, seatSharePeak, seatShareSame,
  seatShareSummary, seatShareTakeFor, seatShareUnitsFor, type SeatShareAdjust,
} from "./seat-share-adjust";
import { teacherTermSessions, withTakenSeatUnits, type TermShareWeights } from "./teacher-term-share";
import { salaryBilledCap } from "./salary-rates";

/**
 * 자리(JJ실·랩실) 몫을 수업 몫으로 돌리기(원장 2026-10-07 *"JJ가 한달에 정해진 횟수를 19/5 이렇게 강제로 정한다기보다 20/4 등
 * 유도리있게"* · *"반별로 한번에 설정도 가능하고, 반 내에서 개별적으로도"*) — 값의 모양과 학생별 판정.
 */
const S1 = "bbbbbbbb-2222-4222-8222-222222222221";
const S2 = "bbbbbbbb-2222-4222-8222-222222222222";

describe("시수 값", () => {
  it("0 이상 0.5 단위만 받는다 — 글자·음수·0.3·빈 값·상한 초과는 거절", () => {
    expect(parseSeatShareUnits(1)).toBe(1);
    expect(parseSeatShareUnits("1.5")).toBe(1.5);
    expect(parseSeatShareUnits(" 2 ")).toBe(2);
    expect(parseSeatShareUnits(0)).toBe(0);
    for (const bad of [0.3, -1, "abc", "", null, undefined, true, Number.NaN, 61]) expect(parseSeatShareUnits(bad)).toBeNull();
  });

  it("학생별 값 — 학생 id와 시수가 모두 맞아야 한다(하나라도 틀리면 통째로 거절 · 조용히 버리지 않는다)", () => {
    expect(parseSeatShareStudents(null)).toEqual({});
    expect(parseSeatShareStudents({ [S1]: 1, [S2]: "0" })).toEqual({ [S1]: 1, [S2]: 0 });
    expect(parseSeatShareStudents({ [S1]: 0.3 })).toBeNull();
    expect(parseSeatShareStudents({ "not-an-id": 1 })).toBeNull();
    expect(parseSeatShareStudents([1])).toBeNull();
  });
});

describe("학생 줄마다 돌릴 시수", () => {
  const adjust = { units: 1, students: { [S2]: 0 } };

  it("학생 값이 있으면 그 값, 없으면 반 전체 값 — 0도 값이다(이 학생만 빼기)", () => {
    expect(seatShareUnitsFor(adjust, S1)).toBe(1);
    expect(seatShareUnitsFor(adjust, S2)).toBe(0);
    expect(seatShareUnitsFor({ units: 0, students: { [S1]: 2 } }, S1)).toBe(2);
    expect(seatShareUnitsFor(null, S1)).toBe(0);
    expect(seatShareUnitsFor(undefined, S1)).toBe(0);
  });

  it("빈 값(반 전체 0 · 학생 없음)은 줄을 지운다 — 학생 값 0은 빈 값이 아니다", () => {
    expect(seatShareEmpty({ units: 0, students: {} })).toBe(true);
    expect(seatShareEmpty({ units: 0, students: { [S1]: 0 } })).toBe(false);
    expect(seatShareEmpty({ units: 0.5, students: {} })).toBe(false);
  });

  it("한 학생 줄에서 가져갈 수 있는 가장 큰 값 · 한 줄 요약", () => {
    expect(seatSharePeak({ units: 1, students: { [S1]: 2, [S2]: 0 } })).toBe(2);
    expect(seatSharePeak({ units: 1, students: {} })).toBe(1);
    expect(seatSharePeak(null)).toBe(0);
    const fmt = (n: number) => String(n);
    expect(seatShareSummary(1, 0, fmt)).toBe("1시수");
    expect(seatShareSummary(1.5, 2, fmt)).toBe("1.5시수 · 따로 2명");
    expect(seatShareSummary(0, 2, fmt)).toBe("따로 2명");
  });
});

/**
 * 🔴 원장이 본 실제 줄(2026-09 중고E_중3 심화 공민규): 확정 26 · 시간표 몫 = 선생님 19 / 자리 5 · 선생님 수업 차수 22.
 *    조정 전에는 등록 차수 몫이 21이라 급여가 21시수에서 잘렸다. 자리 몫 1을 돌리면 22 — 실제 수업한 만큼 잡힌다.
 */
describe("등록 차수 몫과 실급여 상한 — 19/5 → 20/4", () => {
  const TEACHER = "t-homeroom";
  const weights = (): TermShareWeights => Object.assign(new Map([[TEACHER, 19], ["", 5]]), { homeroomTeacherId: TEACHER });
  const term = { units: 26, daysBasis: false } as Parameters<typeof teacherTermSessions>[0];

  it("조정 전: 확정 26 중 선생님 몫 21(시간표 19 + 남는 2) · 자리 5", () => {
    expect(teacherTermSessions(term, TEACHER, weights()).units).toBe(21);
  });

  it("자리 몫 1을 돌리면 선생님 22 · 자리 4 — 합계(반 전체)는 그대로", () => {
    const moved = withTakenSeatUnits(weights(), TEACHER, seatShareUnitsFor({ units: 1, students: {} }, S1));
    expect(moved.get(TEACHER)).toBe(20);
    expect(moved.get("")).toBe(4);
    const share = teacherTermSessions(term, TEACHER, moved);
    expect(share.units).toBe(22);
    expect(share.classUnits).toBe(26);
    // 청구 325,000 · 수업 22시수 × 12,500 = 275,000 → 상한이 262,500(21시수)에서 275,000(22시수)으로 올라 깎이지 않는다.
    expect(salaryBilledCap(325000, teacherTermSessions(term, TEACHER, weights()))).toBe(262500);
    expect(salaryBilledCap(325000, share)).toBe(275000);
  });

  it("🔴 자리 몫보다 많이는 못 돌린다 · 따로 0으로 둔 학생은 시간표 몫 그대로", () => {
    expect(withTakenSeatUnits(weights(), TEACHER, 9).get(TEACHER)).toBe(24);
    expect(withTakenSeatUnits(weights(), TEACHER, 9).get("")).toBe(0);
    const kept = withTakenSeatUnits(weights(), TEACHER, seatShareUnitsFor({ units: 1, students: { [S2]: 0 } }, S2));
    expect(kept.get(TEACHER)).toBe(19);
  });
});

/**
 * 🔴 적대 리뷰 2026-10-07 — 같은 반에서 두 선생님이 조정을 받을 때. 화 = A · 목 = B · 금 = JJ인 반, 달 내내 계획 A 5 / B 4 / 자리 4.
 *    A 2 + B 2는 합 4라 저장 검사를 통과한다. 그런데 달 중간에 들어온 학생 줄은 A 2 / B 1 / 자리 1이다 — 따로 깎으면
 *    A도 1, B도 1을 가져가 같은 자리 시수가 두 번 선다(상한 합 125,000 / 청구 100,000).
 */
describe("한 줄의 자리 몫을 같은 반 선생님들이 차례로 나눠 갖는다", () => {
  const A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const B = "bbbbbbbb-0000-4000-8000-00000000000b";
  const both = new Map<string, SeatShareAdjust>([[B, { units: 2, students: {} }], [A, { units: 2, students: {} }]]);
  const row = (a: number, b: number, seat: number): TermShareWeights => Object.assign(new Map([[A, a], [B, b], ["", seat]]), { homeroomTeacherId: A });

  it("달 내내 다닌 줄(자리 4)은 둘 다 2씩 — 합이 자리 몫과 같다", () => {
    expect(seatShareTakeFor(both, A, S1, row(5, 4, 4))).toBe(2);
    expect(seatShareTakeFor(both, B, S1, row(5, 4, 4))).toBe(2);
  });

  it("🔴 자리 몫이 작은 줄(자리 1)은 id 순으로 — 앞 선생님이 1, 뒤 선생님은 0(둘의 합이 자리 몫을 넘지 않는다)", () => {
    const late = row(2, 1, 1);
    const takes = [seatShareTakeFor(both, A, S1, late), seatShareTakeFor(both, B, S1, late)];
    expect(takes).toEqual([1, 0]);
    // 어느 선생님 화면에서 세든 같은 답 — 옮긴 뒤 두 화면의 몫을 더해도 줄 전체(4)를 넘지 않는다.
    const mineA = withTakenSeatUnits(late, A, takes[0]!);
    const mineB = withTakenSeatUnits(late, B, takes[1]!);
    expect((mineA.get(A) ?? 0) + (mineB.get(B) ?? 0)).toBeLessThanOrEqual(4);
    const term = { units: 4, daysBasis: false } as Parameters<typeof teacherTermSessions>[0];
    const caps = salaryBilledCap(100000, teacherTermSessions(term, A, mineA))! + salaryBilledCap(100000, teacherTermSessions(term, B, mineB))!;
    expect(caps).toBeLessThanOrEqual(100000);
  });

  it("학생별 값도 같은 순서로 — 0으로 뺀 선생님은 자리를 안 쓰고 다음 선생님이 받는다 · 0.5 단위로 내린다", () => {
    const mixed = new Map<string, SeatShareAdjust>([[A, { units: 2, students: { [S1]: 0 } }], [B, { units: 1, students: {} }]]);
    expect(seatShareTakeFor(mixed, A, S1, row(2, 1, 1))).toBe(0);
    expect(seatShareTakeFor(mixed, B, S1, row(2, 1, 1))).toBe(1);
    expect(seatShareTakeFor(mixed, A, S2, row(2, 1, 1.4))).toBe(1);
    expect(seatShareTakeFor(mixed, B, S2, row(2, 1, 1.4))).toBe(0);
  });

  it("🔴 그 줄에 수업 몫이 없는 선생님은 못 가져간다 — 자리 교시만 다니는 학생 줄에 새 주인을 만들지 않는다", () => {
    // 금요일(JJ)만 다니는 학생: 몫은 자리 4뿐 · 확정 2. 새 주인이 생기면 '배분 확인'이 되어 상한이 줄 전체(100,000)로 풀린다.
    const seatOnly: TermShareWeights = Object.assign(new Map([["", 4]]), { homeroomTeacherId: A });
    const one = new Map<string, SeatShareAdjust>([[A, { units: 1, students: {} }]]);
    expect(seatShareTakeFor(one, A, S1, seatOnly)).toBe(0);
    const moved = withTakenSeatUnits(seatOnly, A, seatShareTakeFor(one, A, S1, seatOnly));
    const share = teacherTermSessions({ units: 2, daysBasis: false } as Parameters<typeof teacherTermSessions>[0], A, moved);
    expect(share.allocationPending).toBeFalsy();
    expect(salaryBilledCap(100000, share)).toBe(0);
    // 수업 몫이 없는 앞 선생님은 자리를 쓰지도 않는다 — 뒤 선생님 차례가 그대로 온다.
    const onlyB: TermShareWeights = Object.assign(new Map([[B, 3], ["", 1]]), { homeroomTeacherId: A });
    expect(seatShareTakeFor(both, A, S1, onlyB)).toBe(0);
    expect(seatShareTakeFor(both, B, S1, onlyB)).toBe(1);
  });

  it("조정이 없는 반 · 조정 없는 선생님은 0", () => {
    expect(seatShareTakeFor(undefined, A, S1, row(5, 4, 4))).toBe(0);
    expect(seatShareTakeFor(new Map(), A, S1, row(5, 4, 4))).toBe(0);
    expect(seatShareTakeFor(new Map([[B, { units: 2, students: {} }]]), A, S1, row(5, 4, 4))).toBe(0);
  });
});

describe("저장 판정 — 같은 값 · 줄이기만 · 자리 몫 넘김", () => {
  it("같은 값(없음 = 반 전체 0 · 학생 없음) — 학생 순서는 상관없다", () => {
    expect(seatShareSame(null, { units: 0, students: {} })).toBe(true);
    expect(seatShareSame({ units: 1, students: { [S1]: 2, [S2]: 0 } }, { units: 1, students: { [S2]: 0, [S1]: 2 } })).toBe(true);
    expect(seatShareSame({ units: 1, students: {} }, { units: 1, students: { [S1]: 1 } })).toBe(false);
    expect(seatShareSame({ units: 0, students: { [S1]: 0 } }, null)).toBe(false);
  });

  it("줄이거나 지우기만 하는 저장 — 어느 학생 줄에서도 값이 커지지 않는다", () => {
    const before = { units: 2, students: { [S1]: 3, [S2]: 0 } };
    // 통째로 지우기 — 반 전체 2 → 0 · S1 3 → 0 · S2는 0 그대로(반 전체가 0이 되니 값을 지워도 0이다).
    expect(seatShareOnlyShrinks(before, { units: 0, students: {} })).toBe(true);
    expect(seatShareOnlyShrinks({ units: 2, students: { [S1]: 3 } }, { units: 0, students: {} })).toBe(true);
    expect(seatShareOnlyShrinks(before, { units: 1, students: { [S1]: 1, [S2]: 0 } })).toBe(true);
    expect(seatShareOnlyShrinks(before, { units: 3, students: { [S1]: 3, [S2]: 0 } })).toBe(false);
    // 🔴 0으로 빼 둔 학생의 값을 지우면 그 학생은 반 전체 값(2)을 따른다 — 늘리는 저장이다.
    expect(seatShareOnlyShrinks(before, { units: 2, students: { [S1]: 3 } })).toBe(false);
    expect(seatShareOnlyShrinks(null, { units: 0, students: { [S1]: 0 } })).toBe(true);
    expect(seatShareOnlyShrinks(null, { units: 0.5, students: {} })).toBe(false);
  });

  it("🔴 자리 몫은 반 전체의 최종 상태로 본다 — 맞바꾸기는 통과 · 넘더라도 지금보다 늘지 않으면 통과", () => {
    const v = (units: number): SeatShareAdjust => ({ units, students: {} });
    // 자리 5 · A 2 · B 3 → A 3 · B 2 (합은 그대로 5)
    expect(seatShareOverPlan(5, [v(2), v(3)], [v(3), v(2)])).toBe(false);
    expect(seatShareOverPlan(5, [v(2), v(3)], [v(3), v(3)])).toBe(true);
    expect(seatShareOverPlan(5, [], [v(6)])).toBe(true);
    expect(seatShareOverPlan(5, [], [{ units: 1, students: { [S1]: 6 } }])).toBe(true);
    // 시간표가 바뀌어 자리 몫이 1로 준 뒤: 3 → 2는 여전히 넘지만 줄이는 저장이라 막지 않는다.
    expect(seatShareOverPlan(1, [v(3)], [v(2)])).toBe(false);
    expect(seatShareOverPlan(1, [v(3)], [v(3.5)])).toBe(true);
    expect(seatShareOverPlan(0, [], [v(0.5)])).toBe(true);
    expect(seatShareOverPlan(0, [], [null])).toBe(false);
  });
});
