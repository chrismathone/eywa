import { describe, expect, it } from "vitest";
import {
  classNamesOf,
  groupSeatSlots,
  isJjSeatLabel,
  isSeatLabel,
  seatAttKey,
  seatRowKey,
  shortClassLabel,
} from "./seat-day";

describe("자리 판정", () => {
  it("JJ 별칭만 자리로 본다", () => {
    expect(isJjSeatLabel("JJ")).toBe(true);
    expect(isJjSeatLabel("집중자율수업실")).toBe(true);
    expect(isJjSeatLabel("LAB")).toBe(false);
    expect(isJjSeatLabel("Hannah")).toBe(false);
    expect(isSeatLabel("LAB", "LAB")).toBe(true);
    expect(isSeatLabel("JJ", "LAB")).toBe(false);
  });
});

describe("타임 버킷 — 시작시각", () => {
  it("같은 시작·다른 종료는 한 방 한 표 (종료는 ends로만)", () => {
    const buckets = groupSeatSlots([
      { startTime: "16:20:00", endTime: "17:00:00", classId: "a" },
      { startTime: "16:20:00", endTime: "17:20:00", classId: "b" },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.slotStart).toBe("16:20");
    expect(buckets[0]!.ends).toEqual(["17:00", "17:20"]);
    expect(buckets[0]!.slotEnd).toBe("17:20");
  });

  it("같은 (시작,종료)의 여러 반은 한 버킷", () => {
    const buckets = groupSeatSlots([
      { startTime: "18:20", endTime: "19:20", className: "의치대" },
      { startTime: "18:20:00", endTime: "19:20:00", className: "최상위" },
      { startTime: "18:20:00", endTime: "19:20:00", className: "정규 B" },
    ]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.items).toHaveLength(3);
    expect(classNamesOf(buckets[0]!.items)).toEqual(["의치대", "최상위", "정규 B"]);
  });

  it("시각 순으로 정렬한다", () => {
    const buckets = groupSeatSlots([
      { startTime: "20:20:00", endTime: "21:10:00" },
      { startTime: "15:00:00", endTime: "15:40:00" },
    ]);
    expect(buckets.map((b) => b.slotStart)).toEqual(["15:00", "20:20"]);
  });
});

describe("쓰기 키", () => {
  it("행 키는 반+학생 — 같은 학생이 두 반이면 행이 둘", () => {
    expect(seatRowKey("c1", "s1")).not.toBe(seatRowKey("c2", "s1"));
  });

  it("출결 키는 교시까지 — HH:MM 으로 정규화", () => {
    expect(seatAttKey("c1", "s1", "16:20:00")).toBe("c1|s1|16:20");
  });
});

describe("반 라벨 압축", () => {
  it("과목 접두만 뗀다", () => {
    expect(shortClassLabel("중등E_초등 브릿지 A")).toBe("초등 브릿지 A");
    expect(shortClassLabel("브릿지 A")).toBe("브릿지 A");
  });
});
