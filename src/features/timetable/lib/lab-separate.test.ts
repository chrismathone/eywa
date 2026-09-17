import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRichCardGroups, type GridSlot } from "./class-grid";
import { isLabSeparateSlot, LAB_SEPARATE_LABEL, LAB_SEPARATE_TEXT_CLASS } from "./lab-separate";
import { DEFAULT_PERIODS_CONFIG } from "./periods";

const slot = (p: Partial<GridSlot>): GridSlot => ({
  classId: "c1",
  className: "PL1b",
  subject: "english",
  dayOfWeek: "tue",
  startTime: "14:20",
  endTime: "15:00",
  teacherName: "Hannah",
  classroomName: null,
  slotTeacherLabel: null,
  slotRoomLabel: null,
  classBgColor: null,
  classTextColor: null,
  students: [],
  ...p,
});

describe("'따로 수업(*LAB)' 표시 (원장 2026-09-17)", () => {
  it("LAB 자리 + 표식일 때만 — JJ·강사 교시엔 안 붙는다", () => {
    expect(isLabSeparateSlot("LAB", true)).toBe(true);
    expect(isLabSeparateSlot("LAB", false)).toBe(false);
    expect(isLabSeparateSlot("JJ", true)).toBe(false);
    expect(isLabSeparateSlot("Hannah", true)).toBe(false);
    expect(isLabSeparateSlot(null, true)).toBe(false);
  });

  it("통합뷰 칸이 표식을 싣는다 — 켜진 LAB 칸에만", () => {
    const [group] = buildRichCardGroups(
      [
        slot({ startTime: "14:20", slotTeacherLabel: "LAB", labSeparate: true }),
        slot({ startTime: "15:00", slotTeacherLabel: "LAB" }),
        slot({ dayOfWeek: "wed", startTime: "14:20", slotTeacherLabel: "JJ", labSeparate: true }),
      ],
      DEFAULT_PERIODS_CONFIG,
    );
    const cells = group!.cards[0]!.cells;
    expect(cells["860:tue"]).toEqual({ label: "LAB", isLab: true, labSeparate: true });
    expect(cells["900:tue"]).toEqual({ label: "LAB", isLab: true });
    expect(cells["860:wed"]).toEqual({ label: "JJ", isLab: true });
  });

  it("🔴 가상 `*LAB` 임시 칸과 글자는 같고 모양이 다르다 — 밑줄(설정에 있는 칸) vs 점선 테두리(임시 칸)", () => {
    // ⚠️ virtual-lab 모듈은 import하지 않는다(가드 virtual-lab-wiring이 import처를 잠근다) — 소스 글자로 비교한다.
    const virtual = readFileSync(join(process.cwd(), "src/features/timetable/lib/virtual-lab.ts"), "utf8");
    expect(virtual).toContain(`VIRTUAL_LAB_LABEL = "${LAB_SEPARATE_LABEL}"`);
    expect(LAB_SEPARATE_TEXT_CLASS).toContain("underline");
    expect(LAB_SEPARATE_TEXT_CLASS).toContain("italic");
    expect(virtual.match(/VIRTUAL_LAB_CELL_CLASS = "([^"]*)"/)?.[1]).not.toContain("underline");
    expect(LAB_SEPARATE_TEXT_CLASS).not.toContain("outline");
  });
});

describe("🔴 0270a 칸을 기존 조회에 끼우지 않는다 — SQL 적용 전 배포에도 안 죽게([[#95]])", () => {
  const SRC = join(process.cwd(), "src");
  // 명시 컬럼으로 class_schedules를 읽는 곳 — 여기에 lab_separate가 들어가면 0270a 전엔 시간표 500·반 수정 폼 빈 격자.
  const FILES = [
    "features/timetable/server/queries.ts",
    "features/classes/server/queries.ts",
    "features/classes/server/schedule-sync.ts",
    "features/timetable/server/move-actions.ts",
  ];
  it.each(FILES)("%s — select 문자열에 lab_separate가 없다(표식은 loadLabSeparateIds로 따로)", (rel) => {
    const code = readFileSync(join(SRC, rel), "utf8");
    // select( 뒤에 주석 줄이 끼어도 문자열을 잡는다.
    const selects = [...code.matchAll(/\.select\(\s*(?:\/\/[^\n]*\n\s*)*(`[^`]*`|"[^"]*")/g)].map((m) => m[1]!);
    expect(selects.length).toBeGreaterThan(0);
    for (const sel of selects) expect(sel).not.toContain("lab_separate");
    expect(code).toMatch(/(load|lookup)LabSeparateIds\(/);
  });

  it("반 저장은 칸을 못 읽었을 때 insert에서 lab_separate를 뺀다", () => {
    const code = readFileSync(join(SRC, "features/classes/server/actions.ts"), "utf8");
    expect(code).toContain("labSeparateSupported === true");
    expect(code).toMatch(/labSupported \? \{ lab_separate:/);
  });
});
