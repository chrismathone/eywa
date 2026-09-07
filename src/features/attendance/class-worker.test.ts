import { describe, expect, it } from "vitest";
import { classWorkerLabel, pickTopWorker } from "./class-worker";

describe("그 달 이 반을 한 사람", () => {
  it("한 명이면 그 이름만", () => {
    expect(classWorkerLabel(pickTopWorker([{ name: "유형숙", count: 7 }], "report"))).toBe("유형숙");
  });

  it("🔴 여럿이면 단정하지 않는다 — `외 N명`", () => {
    // 영어 실측: 한 반에 기록자가 2~4명이다. 최다 한 명만 적으면 나머지가 안 보인다.
    const w = pickTopWorker(
      [
        { name: "KRISTINE DRIVER", count: 6 },
        { name: "엄소윤", count: 10 },
        { name: "정유진", count: 2 },
      ],
      "attendance",
    );
    expect(classWorkerLabel(w)).toBe("엄소윤 외 2명");
    expect(w?.source).toBe("attendance");
  });

  it("🔴 근거가 없으면 아무것도 적지 않는다(지어내지 않는다)", () => {
    expect(pickTopWorker([], "report")).toBeNull();
    expect(pickTopWorker([{ name: "  ", count: 3 }], "report")).toBeNull();
    expect(pickTopWorker([{ name: "유형숙", count: 0 }], "report")).toBeNull();
    expect(classWorkerLabel(null)).toBeNull();
  });

  it("동수면 이름 순 — 새로고침마다 이름이 바뀌면 안 된다", () => {
    const a = pickTopWorker([{ name: "이수진", count: 3 }, { name: "강지훈", count: 3 }], "report");
    const b = pickTopWorker([{ name: "강지훈", count: 3 }, { name: "이수진", count: 3 }], "report");
    expect(a?.name).toBe("강지훈");
    expect(b?.name).toBe("강지훈");
  });

  it("이름의 앞뒤 공백은 털어서 적는다", () => {
    expect(pickTopWorker([{ name: " 남정화 ", count: 5 }], "report")?.name).toBe("남정화");
  });
});
