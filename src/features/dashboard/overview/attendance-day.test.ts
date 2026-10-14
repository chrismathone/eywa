import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attendanceOverview, attendanceWindowStart } from "./attendance-day";

const cell = (session_date: string, status: string) => ({ session_date, status });

describe("attendanceOverview", () => {
  it("counts only today's cells for the '출결 현황' donut", () => {
    const { snapshot, trend } = attendanceOverview(
      [
        cell("2026-09-12", "absent"),
        cell("2026-09-12", "absent"),
        cell("2026-09-13", "present"),
        cell("2026-09-13", "late"),
        cell("2026-09-13", "absent"),
        cell("2026-09-13", "excused"),
      ],
      "2026-09-13",
    );
    expect(snapshot).toMatchObject({
      date: "2026-09-13",
      total: 4,
      present: 1,
      late: 1,
      absent: 1,
      excused: 1,
      // 출석률 = (출석 + 지각) ÷ 오늘 칸 — 어제 칸은 분자·분모 어디에도 안 들어간다.
      rate: 50,
    });
    // 추이 칸도 그날 칸만으로 나눈다 — 창 전체로 나누거나 지각을 빼면 여기서 걸린다.
    expect(trend.at(-1)).toEqual({ date: "2026-09-13", total: 4, rate: 50 });
    expect(trend.at(-2)).toEqual({ date: "2026-09-12", total: 2, rate: 0 });
  });

  it("does not fall back to the last recorded day when today has no cells", () => {
    const { snapshot, trend } = attendanceOverview([cell("2026-09-12", "present")], "2026-09-13");
    expect(snapshot).toBeNull();
    // 추이는 지난 날을 그대로 보여 준다 — 오늘만 비어 있다.
    expect(trend.at(-2)).toEqual({ date: "2026-09-12", total: 1, rate: 100 });
    expect(trend.at(-1)).toEqual({ date: "2026-09-13", total: 0, rate: null });
  });

  it("keeps a 14-day trend that starts where the query starts and ends today", () => {
    const { trend } = attendanceOverview([], "2026-09-13");
    expect(trend).toHaveLength(14);
    expect(trend[0].date).toBe(attendanceWindowStart("2026-09-13"));
    expect(trend[0].date).toBe("2026-08-31");
    expect(trend.at(-1)?.date).toBe("2026-09-13");
  });

  // 쿼리 창과 추이 창이 갈리면(예: 조회를 오늘 하루로 좁히면) 추이 14칸 중 13칸이 '기록 없음'이 된다 — 서버가
  // 같은 함수로 창을 열고 정정 접기를 거친 칸을 넘기는지 소스로 잠근다(kpi-wiring.test.ts와 같은 방식).
  it("server fetches the same window the trend draws", () => {
    const src = readFileSync(join(process.cwd(), "src/features/dashboard/overview/server.ts"), "utf8");
    expect(src).toContain('.gte("session_date", attendanceWindowStart(today))');
    // 정정 접기를 거친 칸을 넘긴다 — 과목 관리자 값(2026-10-14)도 같은 칸을 반 과목으로 거른 것이다.
    expect(src).toContain("const cells = effectiveAttendanceRecords(rows);");
    expect(src).toContain("attendanceOverview(pred ? cells.filter((c) => pred(subjectOf.get(c.class_id) ?? null)) : cells, today)");
  });
});
