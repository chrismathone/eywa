import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildRichCardGroups, type GridSlot } from "./class-grid";
import {
  applyLabSeparateMarks,
  isLabSeparateSlot,
  LAB_SEPARATE_LABEL,
  LAB_SEPARATE_STUDENT_CLASS,
  LAB_SEPARATE_TEXT_CLASS,
  labSeparateMetaClass,
} from "./lab-separate";
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

  it("🔴 이탤릭은 합성을 켜야 보인다 — body가 font-synthesis:none이고 Pretendard엔 이탤릭 서체가 없다(원장 2026-09-18)", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const virtual = readFileSync(join(process.cwd(), "src/features/timetable/lib/virtual-lab.ts"), "utf8");
    // 전제가 바뀌면(전역 합성을 켜면) 이 가드도 함께 다시 볼 것.
    expect(css).toMatch(/font-synthesis:\s*none/);
    expect(LAB_SEPARATE_TEXT_CLASS).toContain("[font-synthesis:style]");
    expect(virtual.match(/VIRTUAL_LAB_CELL_CLASS = "([^"]*)"/)?.[1]).toContain("[font-synthesis:style]");
  });
});

describe("🔴 0271a 칸을 기존 조회에 끼우지 않는다 — SQL 적용 전 배포에도 안 죽게([[#95]])", () => {
  const SRC = join(process.cwd(), "src");
  // 명시 컬럼으로 class_schedules를 읽는 곳 — 여기에 lab_separate가 들어가면 0271a 전엔 시간표 500·반 수정 폼 빈 격자.
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

describe("*LAB 배정 원생 이름 표식 (0271b, 원장 2026-09-18 *\"이름 색을 lab 과 같은 색상으로 해주고 이탤릭체로\"*)", () => {
  const st = (id: string, over: Record<string, unknown> = {}) => ({
    studentId: `s-${id}`,
    enrollmentId: `e-${id}`,
    status: "active" as string,
    ...over,
  });

  it("서식 = LAB 칸과 같은 파랑 + 이탤릭(합성 켬) · 밑줄 없음(밑줄은 교시 고정)", () => {
    expect(LAB_SEPARATE_STUDENT_CLASS).toContain("text-blue");
    expect(LAB_SEPARATE_STUDENT_CLASS).toContain("italic");
    expect(LAB_SEPARATE_STUDENT_CLASS).toContain("[font-synthesis:style]");
    expect(LAB_SEPARATE_STUDENT_CLASS).not.toContain("underline");
  });

  it("그 주 *LAB 교시가 있는 반의 켠 원생에만 붙는다 — 한 반의 슬롯들은 같은 명단 배열을 공유한다", () => {
    const roster = [st("a"), st("b")];
    const slots = [
      { classId: "pl1b", students: roster },
      { classId: "pl1b", labSeparate: true as const, students: roster },
      { classId: "other", students: [st("c")] },
    ];
    const out = applyLabSeparateMarks(slots, new Set(["e-a", "e-c"]));
    expect(out[0]!.students[0]).toMatchObject({ labSeparate: true });
    expect(out[0]!.students[1]).not.toHaveProperty("labSeparate");
    expect(out[0]!.students).toBe(out[1]!.students); // 참조 공유 유지(RSC 페이로드)
    // *LAB 교시가 없는 반은 켜져 있어도 안 붙인다(뜻을 잃은 배정).
    expect(out[2]!.students[0]).not.toHaveProperty("labSeparate");
    expect(out[2]).toBe(slots[2]);
  });

  it("🔴 퇴원 줄엔 안 붙인다 · 수강 id를 모르면 안 붙인다 · 재료가 없으면 입력 그대로", () => {
    const slots = [{ classId: "pl1b", labSeparate: true as const, students: [st("a", { status: "withdrawn" }), st("b", { enrollmentId: undefined })] }];
    const out = applyLabSeparateMarks(slots, new Set(["e-a", "e-b"]));
    expect(out).toEqual(slots);
    expect(applyLabSeparateMarks(slots, null)).toBe(slots);
    expect(applyLabSeparateMarks(slots, new Set())).toBe(slots);
  });

  it("🔴 세 뷰(기본·통합·강사)가 같은 서식 상수를 쓴다", () => {
    for (const f of [
      "src/app/(shell)/timetable/_components/student-rows.tsx",
      "src/app/(shell)/timetable/_components/rich-card-group.tsx",
      "src/app/(shell)/timetable/_components/teacher-chip.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toContain("LAB_SEPARATE_STUDENT_CLASS");
    }
    expect(readFileSync(join(process.cwd(), "src/app/(shell)/timetable/page.tsx"), "utf8")).toMatch(
      /applyLabSeparateMarks\(/,
    );
  });

  it("🔴 이름 뒤 `/학교학년` 꼬리도 같은 서식 — 세 뷰가 같은 판정 함수를 쓴다(원장 2026-09-18 \"전체를 파랑 및 이탤릭으로\")", () => {
    // 이름만 칠하면 `유희린`은 파랑인데 `/침산초3`은 검정이라 한 줄이 두 색으로 갈린다.
    expect(labSeparateMetaClass(true, undefined)).toBe(LAB_SEPARATE_STUDENT_CLASS);
    expect(labSeparateMetaClass(false, undefined)).toBe("");
    expect(labSeparateMetaClass(undefined, undefined)).toBe("");
    // 교시 고정 줄은 이름만 — 밑줄이 꼬리까지 끌리면 `유희린/침산초3` 전체에 줄이 그어진다.
    expect(labSeparateMetaClass(true, "월 2교시 고정")).toBe("");
    for (const f of [
      "src/app/(shell)/timetable/_components/student-rows.tsx",
      "src/app/(shell)/timetable/_components/rich-card-group.tsx",
      "src/app/(shell)/timetable/_components/teacher-chip.tsx",
    ]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toContain("labSeparateMetaClass(");
    }
  });
});
