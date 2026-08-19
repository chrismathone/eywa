import { describe, expect, it } from "vitest";
import { pickAbsenceNoteTarget } from "./server/absence-cell";

/**
 * 보강 메모를 붙일 결석 칸 고르기 — 순수부만 단독으로 잠근다(조회는 서버, 판정은 여기).
 * 🔴 이 판정이 무너지면 "보강 1회가 결석 3교시를 다 메운 것처럼" 보이거나, 두 번 눌렀을 때
 *    다른 교시에 같은 줄이 하나 더 늘어난다.
 */
describe("pickAbsenceNoteTarget", () => {
  const memo = "8/19 보강 예정";

  it("결석 칸이 없으면 null — 없는 칸을 만들지 않는다(선보강)", () => {
    expect(pickAbsenceNoteTarget([], memo)).toBeNull();
  });

  it("교시가 여럿이면 **한 칸**만 고른다(목록은 최근 기록순)", () => {
    const rows = [
      { id: "a", note: null },
      { id: "b", note: null },
    ];
    expect(pickAbsenceNoteTarget(rows, memo)?.id).toBe("a");
  });

  it("🔴 두 번째 보강은 **아직 안 적힌 칸**으로 간다 — 같은 칸에 쌓이면 한 교시를 두 번 보강한 것처럼 보인다", () => {
    // 2교시 결석을 8/19·8/26 두 번에 나눠 보강하는 경우.
    const rows = [
      { id: "a", note: "8/19 보강 예정" },
      { id: "b", note: null },
    ];
    expect(pickAbsenceNoteTarget(rows, "8/26 보강 예정")?.id).toBe("b");
  });

  it("모든 칸에 이미 보강이 적혀 있으면 최신 칸으로(없는 칸을 만들지 않는다)", () => {
    const rows = [
      { id: "a", note: "8/19 보강 예정" },
      { id: "b", note: "8/20 보강 완료" },
    ];
    expect(pickAbsenceNoteTarget(rows, "8/26 보강 예정")?.id).toBe("a");
  });

  it("🔴 이미 그 줄이 적힌 칸이 있으면 그 칸이 이긴다(멱등 — 다른 교시에 같은 줄이 늘지 않는다)", () => {
    const rows = [
      { id: "a", note: "병결" },
      { id: "b", note: `병결\n${memo}` },
    ];
    expect(pickAbsenceNoteTarget(rows, memo)?.id).toBe("b");
  });

  it("비슷한 다른 날짜 줄은 같은 줄로 치지 않는다(부분 일치 금지)", () => {
    const rows = [
      { id: "a", note: null },
      { id: "b", note: "8/1 보강 예정" },
    ];
    expect(pickAbsenceNoteTarget(rows, memo)?.id).toBe("a");
  });
});
