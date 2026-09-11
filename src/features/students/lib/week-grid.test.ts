import { describe, it, expect } from "vitest";
import { DEFAULT_PERIODS_CONFIG, settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { buildSubjectPeriodGrid, rowModeForDefaultView, type WeekGridRow } from "./week-grid";

const row = (
  classId: string,
  subject: string,
  className: string,
  teacherName: string | null,
  slots: WeekGridRow["slots"],
): WeekGridRow => ({ classId, subject, className, teacherName, slots });

const mathRow = (classId: string, className: string, slots: WeekGridRow["slots"]) =>
  row(classId, "math", className, "김샘", slots);

const cfg = DEFAULT_PERIODS_CONFIG; // 평일=MATH_PERIODS(8교시), 주말=09:00~ 8교시

describe("buildSubjectPeriodGrid (교시축 · 과목 탭)", () => {
  it("평일 단일 수업 → 그 과목 교시행 전체 + 해당 교시 셀", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }])],
      "math",
      false,
      cfg,
    );
    expect(g.days).toEqual(["mon"]);
    expect(g.rows.length).toBe(8); // MATH 8교시 전체(빈 교시 포함)
    const p3 = g.rows.findIndex((r) => r.key === "p-3"); // 16:20 = 3교시
    expect(p3).toBeGreaterThanOrEqual(0);
    expect(g.cellAt(p3, 0)?.className).toBe("수학A");
    expect(g.blocks.get(`${p3}:0`)).toEqual({ rowSpan: 1, colSpan: 1 });
  });

  it("같은 반 연속 교시 → 세로 rowSpan 병합", () => {
    const g = buildSubjectPeriodGrid(
      [
        mathRow("c1", "수학A", [
          { day: "mon", startTime: "18:20", periodLabel: "5교시" },
          { day: "mon", startTime: "19:15", periodLabel: "6교시" },
        ]),
      ],
      "math",
      false,
      cfg,
    );
    const p5 = g.rows.findIndex((r) => r.key === "p-5");
    const p6 = g.rows.findIndex((r) => r.key === "p-6");
    expect(g.blocks.get(`${p5}:0`)).toEqual({ rowSpan: 2, colSpan: 1 });
    expect(g.blocks.get(`${p6}:0`)).toBeUndefined(); // 위 블록에 피복
    expect(g.cellAt(p5, 0)?.classId).toBe("c1");
  });

  it("다른 반 연속 교시 → 병합 안 함(각자 1칸)", () => {
    const g = buildSubjectPeriodGrid(
      [
        mathRow("c1", "A", [{ day: "mon", startTime: "18:20", periodLabel: "5교시" }]),
        mathRow("c2", "B", [{ day: "mon", startTime: "19:15", periodLabel: "6교시" }]),
      ],
      "math",
      false,
      cfg,
    );
    const p5 = g.rows.findIndex((r) => r.key === "p-5");
    const p6 = g.rows.findIndex((r) => r.key === "p-6");
    expect(g.blocks.get(`${p5}:0`)).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(g.blocks.get(`${p6}:0`)).toEqual({ rowSpan: 1, colSpan: 1 });
  });

  it("다른 과목 행은 무시(과목 필터)", () => {
    const g = buildSubjectPeriodGrid(
      [
        mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }]),
        row("c2", "english", "영어B", "Anna", [{ day: "mon", startTime: "16:20", periodLabel: "4교시" }]),
      ],
      "math",
      false,
      cfg,
    );
    const p3 = g.rows.findIndex((r) => r.key === "p-3");
    expect(g.cellAt(p3, 0)?.subject).toBe("math");
    expect(g.days).toEqual(["mon"]);
  });

  it("평일/주말 슬롯 분리 — weekend=false면 주말 슬롯 제외, true면 주말만", () => {
    const rows = [mathRow("c1", "A", [{ day: "sat", startTime: "09:00", periodLabel: "1교시" }])];
    expect(buildSubjectPeriodGrid(rows, "math", false, cfg).days).toEqual([]);
    const wk = buildSubjectPeriodGrid(rows, "math", true, cfg);
    expect(wk.days).toEqual(["sat"]);
    const p1 = wk.rows.findIndex((r) => r.key === "p-1"); // 주말 09:00 = 1교시
    expect(wk.cellAt(p1, 0)?.className).toBe("A");
  });

  it("표준 교시에 안 맞는 시각 → 폴백(x-시각) 행 추가", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "A", [{ day: "mon", startTime: "16:00", periodLabel: "16:00" }])],
      "math",
      false,
      cfg,
    );
    expect(g.rows.some((r) => r.key === "x-16:00")).toBe(true);
    const xi = g.rows.findIndex((r) => r.key === "x-16:00");
    expect(g.cellAt(xi, 0)?.className).toBe("A");
  });

  it("슬롯 강의실(room)이 셀에 전달됨 (slot_room_label ?? 반 기본)", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시", room: "201호" }])],
      "math",
      false,
      cfg,
    );
    const p3 = g.rows.findIndex((r) => r.key === "p-3");
    expect(g.cellAt(p3, 0)?.room).toBe("201호");
  });

  it("강의실 없는 슬롯 → room null", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [{ day: "mon", startTime: "16:20", periodLabel: "3교시" }])],
      "math",
      false,
      cfg,
    );
    const p3 = g.rows.findIndex((r) => r.key === "p-3");
    expect(g.cellAt(p3, 0)?.room).toBeNull();
  });

  it("영어(11교시) 행 수 — 과목별 교시표 반영", () => {
    const g = buildSubjectPeriodGrid(
      [row("c1", "english", "E반", "Anna", [{ day: "mon", startTime: "14:20", periodLabel: "1교시" }])],
      "english",
      false,
      cfg,
    );
    expect(g.rows.length).toBe(11); // ENGLISH_PERIODS 11교시
  });

  // 교시 이름은 **학원설정이 단일 소스**다(코드가 `N교시`를 지어내지 않는다, 2026-08-13).
  // 비운 이름은 빈 문자열로 내려오고 그 자리엔 화면이 시간대를 그린다(student-period-grid).
  it("교시 이름 = 설정값 · 비우면 빈 문자열(내장표만 `N교시`)", () => {
    const named = settingsToPeriodsConfig({
      weekdayPeriods: [{ label: "1교시", startTime: "14:30", endTime: "15:25" }],
      weekendPeriods: [{ label: "1교시", startTime: "09:00", endTime: "10:00" }],
      subjects: [
        {
          key: "english",
          weekdayPeriods: [
            { label: "EiE 1교시", startTime: "14:20", endTime: "15:00" },
            { label: "", startTime: "15:00", endTime: "15:40" },
          ],
        },
      ],
    });
    const g = buildSubjectPeriodGrid(
      [row("c1", "english", "E반", "Anna", [{ day: "mon", startTime: "14:20", periodLabel: "EiE 1교시" }])],
      "english",
      false,
      named,
    );
    expect(g.rows.map((r) => r.label)).toEqual(["EiE 1교시", ""]);
    expect(g.rows.map((r) => r.time)).toEqual(["14:20~15:00", "15:00~15:40"]);
    // 내장표(설정 없음)는 종전대로 번호.
    const builtin = buildSubjectPeriodGrid(
      [row("c1", "english", "E반", "Anna", [{ day: "mon", startTime: "14:20", periodLabel: "1교시" }])],
      "english",
      false,
      cfg,
    );
    expect(builtin.rows[0]!.label).toBe("1교시");
  });
});

// ───────── 2026-09-11 원장 제보 — "영어 학생 수업탭 시간표가 실제 영어 시간표와 다르다" ─────────
// 🔴 픽스처 = **실제 영어 평일 교시표**(injaewon 학원설정 2026-09-11 조회) — EiE 40분·인재원 60분 두 체계가
//    한 표에 섞여 시작이 같은 교시가 셋(15:00·16:20·18:20)이다. 이름은 학원장이 전부 비웠다(시간대만).
const ENGLISH_TABLE = (
  [
    ["14:20", "15:00"], ["15:00", "15:40"], ["15:00", "16:00"], ["15:40", "16:20"], ["16:00", "17:00"],
    ["16:20", "17:00"], ["16:20", "17:20"], ["17:00", "17:40"], ["17:20", "18:10"], ["17:40", "18:20"],
    ["18:20", "19:00"], ["18:20", "19:20"], ["19:20", "20:10"], ["20:20", "21:10"], ["21:10", "22:00"],
  ] as const
).map(([startTime, endTime]) => ({ label: "", startTime, endTime }));
const realCfg = settingsToPeriodsConfig({
  weekdayPeriods: [],
  weekendPeriods: [],
  subjects: [{ key: "english", weekdayPeriods: ENGLISH_TABLE }],
});

type Slot = WeekGridRow["slots"][number];
const at = (day: Slot["day"], startTime: string, endTime: string, extra: Partial<Slot> = {}): Slot => ({
  day,
  startTime,
  endTime,
  periodLabel: "",
  ...extra,
});
const eng = (slots: Slot[], classId = "pl1b", className = "PL1b") => row(classId, "english", className, "송지혜", slots);

/** 그 요일 열에 **보이는 칸**을 위에서부터 — [덮는 행 시간대들, 담당(자리면 자리 이름), 강의실]. */
function visible(g: ReturnType<typeof buildSubjectPeriodGrid>, day: Slot["day"]) {
  const ci = g.days.indexOf(day);
  return g.rows.flatMap((_, ri) => {
    const b = g.blocks.get(`${ri}:${ci}`);
    const c = g.cellAt(ri, ci);
    if (!b || !c) return [];
    const span = g.rows.slice(ri, ri + b.rowSpan).map((r) => r.time).join(" + ");
    return [[span, c.seat ?? c.teacherName, c.room]];
  });
}

describe("학생 탭 = 실제 영어 시간표와 같은 사실(2026-09-11)", () => {
  it("🔴 (시작,종료) 짝 — 60분 수업은 `16:20~17:20` 행에 앉는다(시작만 보면 40분 `16:20~17:00` 행)", () => {
    const g = buildSubjectPeriodGrid(
      [eng([at("tue", "16:20", "17:20", { teacherName: "정은지", room: "본원304" })])],
      "english",
      false,
      realCfg,
      "used",
    );
    expect(visible(g, "tue")).toEqual([["16:20~17:20", "정은지", "본원304"]]);
  });

  it("종료가 교시표와 어긋난 옛 행은 시작시각 교시로 폴백 — 사라지지 않는다", () => {
    const g = buildSubjectPeriodGrid([eng([at("tue", "16:20", "17:05")])], "english", false, realCfg, "used");
    expect(g.rows.map((r) => r.time)).toEqual(["16:20~17:00"]);
  });

  it("🔴 반이 같아도 담당·자리가 갈리면 잇지 않는다 — 이도윤B PL1b 월(Sam 606 → LAB 603)", () => {
    const g = buildSubjectPeriodGrid(
      [
        eng([
          at("mon", "14:20", "15:00", { teacherName: "김태건", room: "본원606" }),
          at("mon", "15:00", "15:40", { seat: "LAB", room: "본원603" }),
        ]),
      ],
      "english",
      false,
      realCfg,
      "used",
    );
    expect(visible(g, "mon")).toEqual([
      ["14:20~15:00", "김태건", "본원606"],
      ["15:00~15:40", "LAB", "본원603"],
    ]);
  });

  it("🔴 화 LAB → Anna → LAB — 가운데 담당이 가려지지 않는다", () => {
    const g = buildSubjectPeriodGrid(
      [
        eng([
          at("tue", "14:20", "15:00", { seat: "LAB", room: "본원603" }),
          at("tue", "15:00", "15:40", { teacherName: "육소희", room: "본원606" }),
          at("tue", "15:40", "16:20", { seat: "LAB", room: "본원603" }),
        ]),
      ],
      "english",
      false,
      realCfg,
      "used",
    );
    expect(visible(g, "tue").map((v) => v[1])).toEqual(["LAB", "육소희", "LAB"]);
  });

  it("보이는 내용이 같고 시간이 이어지면 잇는다 — 김나윤A LS4b 목 Sam 15:00·15:40(사이 인재원 15:00~16:00 행은 빠진다)", () => {
    const g = buildSubjectPeriodGrid(
      [
        eng(
          [
            at("thu", "14:20", "15:00", { seat: "LAB", room: "본원603" }),
            at("thu", "15:00", "15:40", { teacherName: "김태건", room: "본원604" }),
            at("thu", "15:40", "16:20", { teacherName: "김태건", room: "본원604" }),
            at("thu", "16:20", "17:00", { seat: "LAB", room: "본원603" }),
          ],
          "ls4b",
          "LS4b",
        ),
      ],
      "english",
      false,
      realCfg,
      "used",
    );
    expect(visible(g, "thu")).toEqual([
      ["14:20~15:00", "LAB", "본원603"],
      ["15:00~15:40 + 15:40~16:20", "김태건", "본원604"],
      ["16:20~17:00", "LAB", "본원603"],
    ]);
  });

  it("🔴 같은 담당·같은 방이어도 사이에 교시가 있었으면 잇지 않는다(빈 행이 빠져 붙어 보여도)", () => {
    const g = buildSubjectPeriodGrid(
      [
        eng([
          at("fri", "14:20", "15:00", { teacherName: "김태건", room: "본원606" }),
          at("fri", "16:20", "17:00", { teacherName: "김태건", room: "본원606" }),
        ]),
      ],
      "english",
      false,
      realCfg,
      "used",
    );
    expect(visible(g, "fri").map((v) => v[0])).toEqual(["14:20~15:00", "16:20~17:00"]);
  });

  it("같은 담당이어도 방이 바뀌면 잇지 않는다(방도 칸에 보이는 사실)", () => {
    const g = buildSubjectPeriodGrid(
      [
        eng([
          at("thu", "15:00", "15:40", { teacherName: "이다교", room: "본원606" }),
          at("thu", "15:40", "16:20", { teacherName: "이다교", room: "본원604" }),
        ]),
      ],
      "english",
      false,
      realCfg,
      "used",
    );
    expect(visible(g, "thu").map((v) => v[2])).toEqual(["본원606", "본원604"]);
  });

  it("쉬는 시간만 사이에 있으면 잇는다 — 수학 17:15~18:10 → 18:20~19:15(시간표 기본뷰와 같은 모양)", () => {
    const g = buildSubjectPeriodGrid(
      [mathRow("c1", "수학A", [at("mon", "17:15", "18:10"), at("mon", "18:20", "19:15")])],
      "math",
      false,
      cfg,
    );
    const p4 = g.rows.findIndex((r) => r.key === "p-4");
    expect(g.blocks.get(`${p4}:0`)).toEqual({ rowSpan: 2, colSpan: 1 });
  });

  it("🔴 'used' 행 = 수업 있는 교시만(통합뷰 keepUsedRows) — 다른 체계의 빈 행이 끼지 않는다", () => {
    const slots = [at("tue", "16:20", "17:20"), at("tue", "17:20", "18:10", { seat: "JJ" })];
    const used = buildSubjectPeriodGrid([eng(slots)], "english", false, realCfg, "used");
    expect(used.rows.map((r) => r.time)).toEqual(["16:20~17:20", "17:20~18:10"]);
    // 'all'(기본뷰 규칙)은 교시표 전부 — 수학처럼 기본뷰가 처음 뷰인 과목은 종전 그대로.
    const all = buildSubjectPeriodGrid([eng(slots)], "english", false, realCfg);
    expect(all.rows).toHaveLength(15);
  });

  it("rowModeForDefaultView — 통합뷰만 'used', 기본뷰·강사뷰·모르는 값은 'all'", () => {
    expect(rowModeForDefaultView("integrated")).toBe("used");
    expect(rowModeForDefaultView("basic")).toBe("all");
    expect(rowModeForDefaultView("teacher")).toBe("all");
    expect(rowModeForDefaultView("")).toBe("all");
  });
});
