import { describe, expect, it } from "vitest";
import { buildWeeklyChange, mondayOf, weeklyChangeStart } from "./weekly-change";

// 2026-09-09는 수요일 → 그 주 월요일은 2026-09-07.
const TODAY = "2026-09-09";

describe("주 경계", () => {
  it("앱 전역과 같은 **월요일 시작** — 일요일도 앞선 월요일에 붙는다", () => {
    expect(mondayOf("2026-09-07")).toBe("2026-09-07"); // 월
    expect(mondayOf("2026-09-09")).toBe("2026-09-07"); // 수
    expect(mondayOf("2026-09-13")).toBe("2026-09-07"); // 일 — 🔴 다음 주로 넘기지 않는다
    expect(mondayOf("2026-09-14")).toBe("2026-09-14"); // 그 다음 월
  });

  it("창 시작은 가장 이른 월요일 — 조회 범위와 화면이 같은 값을 쓴다", () => {
    expect(weeklyChangeStart(TODAY, 4)).toBe("2026-08-17");
  });
});

describe("주별 등록·퇴원", () => {
  it("이번 주를 포함해 4개 막대가 항상 선다 — 빈 주도 0으로", () => {
    const b = buildWeeklyChange({ enrolledOn: [], withdrawnOn: [] }, TODAY);
    expect(b.map((x) => x.monday)).toEqual(["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
    expect(b.every((x) => x.enrolled === 0 && x.withdrawn === 0)).toBe(true);
    // 🔴 빈 주가 사라지면 "그 주가 없었다"로 읽힌다.
    expect(b).toHaveLength(4);
  });

  it("날짜를 그 주 막대에 담는다", () => {
    const b = buildWeeklyChange(
      { enrolledOn: ["2026-09-09", "2026-09-13", "2026-08-18"], withdrawnOn: ["2026-09-07"] },
      TODAY,
    );
    const last = b[3];
    expect(last.enrolled).toBe(2); // 9/9(수) + 9/13(일) 둘 다 9/7 주
    expect(last.withdrawn).toBe(1);
    expect(b[0].enrolled).toBe(1); // 8/18 → 8/17 주
  });

  it("창 밖 날짜는 버린다 — 막대 수가 흔들리지 않는다", () => {
    const b = buildWeeklyChange({ enrolledOn: ["2026-01-05", "2026-12-01"], withdrawnOn: [] }, TODAY);
    expect(b).toHaveLength(4);
    expect(b.reduce((n, x) => n + x.enrolled, 0)).toBe(0);
  });

  it("형식이 깨진 값에 죽지 않는다", () => {
    const b = buildWeeklyChange({ enrolledOn: ["", "2026-9-9", "abc"], withdrawnOn: [] }, TODAY);
    expect(b.reduce((n, x) => n + x.enrolled, 0)).toBe(0);
  });

  it("라벨은 짧게 — 막대 아래 한 줄", () => {
    expect(buildWeeklyChange({ enrolledOn: [], withdrawnOn: [] }, TODAY)[3].label).toBe("9/7");
  });
});
