import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OverviewData } from "./model";
import { BREAK_MAX_MIN, mergeContinuousClasses } from "./continuous-classes";

type Row = OverviewData["schedule"][number];

const row = (id: string, startTime: string, endTime: string, over: Partial<Row> = {}): Row => ({
  id,
  classId: "c1",
  className: "주말내신특강(중2)",
  subject: "math",
  startTime: `${startTime}:00`,
  endTime: `${endTime}:00`,
  teacherName: "이성우",
  classroomName: "고수803",
  status: "upcoming",
  ...over,
});

const times = (rows: Row[]) => rows.map((r) => `${r.startTime.slice(0, 5)}-${r.endTime.slice(0, 5)}`);

describe("mergeContinuousClasses — 이어지는 교시를 한 줄로", () => {
  it("같은 반·강사·교실이 이어지면 첫 교시 시작 ~ 마지막 교시 끝 한 줄 (id는 첫 교시)", () => {
    const out = mergeContinuousClasses([
      row("b", "12:00", "13:00"),
      row("a", "11:00", "12:00"),
      row("c", "13:00", "14:00"),
    ]);
    expect(times(out)).toEqual(["11:00-14:00"]);
    expect(out[0].id).toBe("a");
  });

  it("쉬는 시간(≤10분)을 사이에 둔 교시도 묶는다 — 넘으면 따로", () => {
    expect(BREAK_MAX_MIN).toBe(10);
    expect(times(mergeContinuousClasses([row("a", "14:20", "15:20"), row("b", "15:25", "16:20")]))).toEqual([
      "14:20-16:20",
    ]);
    expect(times(mergeContinuousClasses([row("a", "17:15", "18:10"), row("b", "18:20", "19:15")]))).toEqual([
      "17:15-19:15",
    ]);
    expect(times(mergeContinuousClasses([row("a", "16:20", "17:00"), row("b", "17:20", "18:10")]))).toEqual([
      "16:20-17:00",
      "17:20-18:10",
    ]);
  });

  it("강사가 바뀌면 묶지 않는다 — 영어는 교시마다 담당이 갈린다(묶으면 강사 교대가 사라진다)", () => {
    const out = mergeContinuousClasses([
      row("a", "16:20", "17:20", { teacherName: "Kristine" }),
      row("b", "17:20", "18:10", { teacherName: "Yoojin" }),
    ]);
    expect(out.map((r) => r.teacherName)).toEqual(["Kristine", "Yoojin"]);
  });

  it("교실이 바뀌어도 묶지 않는다 · 강사 미정(null)과 빈 이름은 다른 값", () => {
    expect(
      mergeContinuousClasses([row("a", "15:00", "15:40"), row("b", "15:40", "16:20", { classroomName: "본원603" })]),
    ).toHaveLength(2);
    expect(
      mergeContinuousClasses([row("a", "15:00", "15:40", { teacherName: null }), row("b", "15:40", "16:20", { teacherName: "" })]),
    ).toHaveLength(2);
    expect(
      mergeContinuousClasses([
        row("a", "15:00", "15:40", { teacherName: null, classroomName: null }),
        row("b", "15:40", "16:20", { teacherName: null, classroomName: null }),
      ]),
    ).toHaveLength(1);
  });

  it("다른 반은 같은 시각·같은 강사여도 따로 — 결과는 시작 시각 순", () => {
    const out = mergeContinuousClasses([
      row("x", "13:00", "14:00", { classId: "c2", className: "학원이(테스트)" }),
      row("a", "12:00", "13:00"),
      row("b", "13:00", "14:00"),
      row("w", "11:00", "12:00", { classId: "c2", className: "학원이(테스트)" }),
      row("y", "12:00", "13:00", { classId: "c2", className: "학원이(테스트)" }),
    ]);
    expect(out.map((r) => `${r.className} ${r.startTime.slice(0, 5)}-${r.endTime.slice(0, 5)}`)).toEqual([
      "학원이(테스트) 11:00-14:00",
      "주말내신특강(중2) 12:00-14:00",
    ]);
  });

  it("상태 = 조각 합성 — 하나라도 진행 중이면 진행 중 · 쉬는 시간(끝남+남음)도 진행 중", () => {
    const merged = (...s: Row["status"][]) =>
      mergeContinuousClasses(s.map((status, i) => row(`p${i}`, `${11 + i}:00`, `${12 + i}:00`, { status })))[0].status;
    expect(merged("done", "ongoing", "upcoming")).toBe("ongoing");
    expect(merged("done", "upcoming")).toBe("ongoing");
    expect(merged("done", "done")).toBe("done");
    expect(merged("upcoming", "upcoming")).toBe("upcoming");
  });

  it("같은 시간에 겹친 중복 행은 한 줄 — 더 늦은 끝을 쓴다", () => {
    expect(times(mergeContinuousClasses([row("a", "12:00", "14:00"), row("b", "13:00", "13:30")]))).toEqual([
      "12:00-14:00",
    ]);
  });

  it("입력을 고치지 않는다", () => {
    const input = [row("a", "12:00", "13:00"), row("b", "13:00", "14:00")];
    const snapshot = JSON.stringify(input);
    mergeContinuousClasses(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("배선 — 운영실 서버가 교시 목록을 묶어서 내려준다", () => {
  it("overview/server.ts의 schedule 조각이 getTodaySchedule 결과를 mergeContinuousClasses에 통과시킨다", () => {
    // 주석은 강제력이 없다 — 코드만 본다(kpi-wiring.test.ts와 같은 규약).
    const src = readFileSync(join(process.cwd(), "src/features/dashboard/overview/server.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    // 줄바꿈·들여쓰기가 바뀌어도 통과하고, 감싸는 호출을 빼면 실패한다.
    expect(src).toMatch(/add\("schedule"[\s\S]{0,200}?mergeContinuousClasses\(\s*\(await getTodaySchedule\(\)\)/);
  });
});
