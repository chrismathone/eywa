import { describe, expect, it } from "vitest";
import {
  groupScheduledImports,
  scheduledImportLabel,
  shortDate,
  type ScheduledSnapshot,
} from "./scheduled-import";

const TODAY = "2026-08-28";
const snap = (o: Partial<ScheduledSnapshot> & { id: string }): ScheduledSnapshot => ({
  effectiveDate: "2026-09-01",
  kind: "structure",
  createdAt: "2026-08-28T10:00:00Z",
  ...o,
});

describe("라벨", () => {
  it("올해면 월/일만", () => {
    expect(scheduledImportLabel("2026-09-01", TODAY)).toBe("9/1 시간표 적용 예정");
    expect(shortDate("2026-12-25", TODAY)).toBe("12/25");
  });
  it("해가 바뀌면 연도를 붙인다", () => {
    expect(shortDate("2027-01-05", TODAY)).toBe("27. 1/5");
  });
  it("망가진 값은 그대로 — 화면에 NaN을 흘리지 않는다", () => {
    expect(shortDate("내일", TODAY)).toBe("내일");
  });
});

describe("groupScheduledImports", () => {
  it("한 번의 적용이 만든 두 스냅샷을 날짜 하나로 묶는다", () => {
    const g = groupScheduledImports(
      [snap({ id: "s1", kind: "structure" }), snap({ id: "e1", kind: "enrollment" })],
      TODAY,
    );
    expect(g).toHaveLength(1);
    expect(g[0]!.effectiveDate).toBe("2026-09-01");
    expect(g[0]!.hasStructure && g[0]!.hasEnrollment).toBe(true);
    // 🔴 되돌리기는 적용의 역순 — 반이동을 먼저 되돌린다.
    expect(g[0]!.snapshotIds).toEqual(["e1", "s1"]);
  });

  it("과거·오늘은 예약이 아니다 — 되돌릴 수 없는 x를 띄우지 않는다", () => {
    const rows = [
      snap({ id: "past", effectiveDate: "2026-08-20" }),
      snap({ id: "today", effectiveDate: TODAY }),
      snap({ id: "future", effectiveDate: "2026-09-01" }),
    ];
    expect(groupScheduledImports(rows, TODAY).map((g) => g.snapshotIds)).toEqual([["future"]]);
  });

  it("날짜가 여럿이면 이른 것부터", () => {
    const g = groupScheduledImports(
      [snap({ id: "b", effectiveDate: "2026-10-01" }), snap({ id: "a", effectiveDate: "2026-09-01" })],
      TODAY,
    );
    expect(g.map((x) => x.effectiveDate)).toEqual(["2026-09-01", "2026-10-01"]);
  });

  it("같은 종류가 여럿이면 나중 것부터 되돌린다(덮어쓴 순서의 역순)", () => {
    const g = groupScheduledImports(
      [
        snap({ id: "old", createdAt: "2026-08-28T09:00:00Z" }),
        snap({ id: "new", createdAt: "2026-08-28T11:00:00Z" }),
      ],
      TODAY,
    );
    expect(g[0]!.snapshotIds).toEqual(["new", "old"]);
  });

  it("예약이 없으면 빈 배열", () => {
    expect(groupScheduledImports([], TODAY)).toEqual([]);
  });
});
