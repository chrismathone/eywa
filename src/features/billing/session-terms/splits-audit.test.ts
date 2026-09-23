import { describe, expect, it } from "vitest";
import { summarizeSplitChange } from "./splits-audit";

describe("summarizeSplitChange — 강사 분배 저장 감사 요약", () => {
  it("강사별 합계가 바뀐 사람만 전후 값으로 적는다", () => {
    const s = summarizeSplitChange(
      [
        { teacherName: "김", confirmedAmount: 100, actualAmount: 90 },
        { teacherName: "이", confirmedAmount: 50, actualAmount: 50 },
      ],
      [
        { teacherName: "김", confirmedAmount: 120, actualAmount: 90 },
        { teacherName: "이", confirmedAmount: 50, actualAmount: 50 },
        { teacherName: null, confirmedAmount: 10, actualAmount: 0 },
      ],
    );
    expect(s).toMatchObject({ rowsBefore: 2, rowsAfter: 3, confirmedBefore: 150, confirmedAfter: 180, actualBefore: 140, actualAfter: 140, changedMore: 0 });
    expect(s.changed).toEqual([
      { teacher: "김", confirmedBefore: 100, confirmedAfter: 120, actualBefore: 90, actualAfter: 90 },
      { teacher: "담당 미지정", confirmedBefore: 0, confirmedAfter: 10, actualBefore: 0, actualAfter: 0 },
    ]);
  });

  it("상한을 넘는 강사는 수만 남긴다", () => {
    const after = Array.from({ length: 5 }, (_, i) => ({ teacherName: `t${i}`, confirmedAmount: i + 1, actualAmount: 0 }));
    const s = summarizeSplitChange([], after, 2);
    expect(s.changed.map((c) => c.teacher)).toEqual(["t4", "t3"]);
    expect(s.changedMore).toBe(3);
  });
});
