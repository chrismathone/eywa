import { describe, expect, it } from "vitest";
import {
  POOL_ID,
  dedupeGroups,
  moveClass,
  offWeekCount,
  reorderGroups,
  unassignedOf,
  visibleIdsOf,
  type ClassOption,
  type GroupDraft,
} from "./group-assign";

const classes: ClassOption[] = [
  { classId: "c1", className: "JP1" },
  { classId: "c2", className: "KW6" },
  { classId: "c3", className: "MEC1" },
];

const g = (id: string, classIds: string[]): GroupDraft => ({ id, title: id.toUpperCase(), classIds });

describe("dedupeGroups", () => {
  it("한 반이 여러 줄에 있으면 먼저 나온 줄이 갖는다(렌더 규칙과 동일)", () => {
    expect(dedupeGroups([g("a", ["c1", "c2"]), g("b", ["c2", "c3"])]).map((x) => x.classIds)).toEqual([
      ["c1", "c2"],
      ["c3"],
    ]);
  });
});

describe("unassignedOf", () => {
  it("어느 줄에도 없는 반만, 입력 순서(가나다) 유지", () => {
    expect(unassignedOf(classes, [g("a", ["c2"])]).map((c) => c.classId)).toEqual(["c1", "c3"]);
  });
});

describe("moveClass — 같은 줄 안 재정렬", () => {
  it("뒤로 끌면 놓은 자리를 차지하고 나머지가 밀린다(arrayMove)", () => {
    const out = moveClass([g("a", ["c1", "c2", "c3"])], "c1", "a", "c3");
    expect(out[0].classIds).toEqual(["c2", "c3", "c1"]);
  });
  it("앞으로 끌면 그 칩 앞에 들어간다", () => {
    const out = moveClass([g("a", ["c1", "c2", "c3"])], "c3", "a", "c1");
    expect(out[0].classIds).toEqual(["c3", "c1", "c2"]);
  });
  it("빈 곳(맨 뒤)에 놓으면 마지막으로", () => {
    const out = moveClass([g("a", ["c1", "c2", "c3"])], "c1", "a", null);
    expect(out[0].classIds).toEqual(["c2", "c3", "c1"]);
  });
});

describe("moveClass — 줄 사이 이동", () => {
  it("다른 줄로 옮기면 원래 줄에서 빠진다(중복 배정 없음)", () => {
    const out = moveClass([g("a", ["c1", "c2"]), g("b", ["c3"])], "c1", "b", "c3");
    expect(out.map((x) => x.classIds)).toEqual([["c2"], ["c1", "c3"]]);
  });
  it("빈 줄에 놓으면 그 줄의 유일한 반", () => {
    const out = moveClass([g("a", ["c1"]), g("b", [])], "c1", "b", null);
    expect(out.map((x) => x.classIds)).toEqual([[], ["c1"]]);
  });
  it("미배정으로 빼면 모든 줄에서 사라진다", () => {
    const out = moveClass([g("a", ["c1", "c2"])], "c1", POOL_ID, null);
    expect(out[0].classIds).toEqual(["c2"]);
    expect(unassignedOf(classes, out).map((c) => c.classId)).toEqual(["c1", "c3"]);
  });
  it("없는 줄로는 무동작(상태를 안 망친다)", () => {
    const before = [g("a", ["c1"])];
    expect(moveClass(before, "c1", "nope", null)).toBe(before);
  });
});

describe("이 주 시간표에 없는 반의 배정 보존", () => {
  // 다른 주에만 있는 반(c9)은 칩으로 안 보이지만 저장 배열에 남아야 한다 — 지우면 그 주 배치가 무너진다.
  const withOffWeek = [g("a", ["c1", "c9", "c2"])];
  it("화면 칩은 이 주 반만", () => {
    expect(visibleIdsOf(withOffWeek[0], classes)).toEqual(["c1", "c2"]);
  });
  it("숨은 배정 수를 셀 수 있다(사용자에게 알리는 용도)", () => {
    expect(offWeekCount(withOffWeek, classes)).toBe(1);
  });
  it("드래그로 재정렬해도 숨은 반이 사라지지 않는다", () => {
    const out = moveClass(withOffWeek, "c2", "a", "c1");
    expect(out[0].classIds).toContain("c9");
    expect(visibleIdsOf(out[0], classes)).toEqual(["c2", "c1"]);
  });
  it("다른 줄로 옮겨도 숨은 반은 원래 줄에 남는다", () => {
    const out = moveClass([...withOffWeek, g("b", [])], "c1", "b", null);
    expect(out[0].classIds).toEqual(["c9", "c2"]);
  });
});

describe("reorderGroups", () => {
  it("줄 순서(통합뷰 섹션 순서)를 바꾼다", () => {
    expect(reorderGroups([g("a", []), g("b", []), g("c", [])], "c", "a").map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("모르는 id는 무동작", () => {
    const before = [g("a", []), g("b", [])];
    expect(reorderGroups(before, "a", "zzz")).toBe(before);
  });
});
