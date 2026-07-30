import { describe, expect, it } from "vitest";
import { assignDaySlots, buildWeekRows, matchSlot, splitStudentLabel, type BuildContext, type SlotRow } from "./build-rows";
import type { EcsImportIssue } from "./types";

const AREAS = [
  { key: "vocab", label: "Vocab" },
  { key: "grammar", label: "Grammar" },
];
const SLOTS: SlotRow[] = [
  { day: "mon", start: "14:20:00", validFrom: "2026-01-01", validTo: null },
  { day: "mon", start: "19:10:00", validFrom: "2026-01-01", validTo: "2026-07-20" },
];

function ctx(over: Partial<BuildContext> = {}): BuildContext {
  return {
    year: 2026,
    className: "중등E_중1 정규 A",
    skillAreas: AREAS,
    slots: SLOTS,
    studentsByName: new Map([["류지훈", [{ id: "s1", englishName: "Jay" }]]]),
    rosterIds: new Set(["s1"]),
    eligibleOn: () => true,
    ...over,
  };
}

/** 월요일 1교시(14:20) 블록 하나짜리 최소 격자. */
function grid(opts: { time?: string; skill?: string; note?: string; name?: string } = {}): string[][] {
  const W = 16;
  const mk = () => Array.from({ length: W }, () => "");
  const rows = [mk(), mk(), mk(), mk()];
  const c = 7;
  rows[0]![c] = "월";
  rows[0]![c + 1] = "시기";
  rows[1]![c - 1] = "1교시";
  rows[1]![c] = "Elsa\n(담임)\n\n303호";
  rows[1]![c + 1] = "평시";
  rows[1]![c + 2] = opts.skill ?? "Vocab";
  rows[1]![c + 3] = "능률 VOCA";
  rows[1]![c + 5] = "외우고 시험";
  rows[2]![c - 1] = opts.time ?? "02:20\n~\n03:00";
  rows[2]![c] = opts.name ?? "류지훈(Jay)";
  rows[2]![c + 1] = "TRUE";
  rows[2]![c + 2] = "침산초6";
  rows[2]![c + 3] = opts.note ?? "완";
  return rows;
}

describe("matchSlot — 시각이 정확히 맞을 때만", () => {
  it("유효기간 안의 슬롯에 붙는다", () => {
    expect(matchSlot(SLOTS, "mon", "14:20", "2026-07-27")).toBe("14:20");
  });
  it("🔴 유효기간이 끝난 슬롯엔 안 붙는다(옛 배치로 새 주를 채우지 않는다)", () => {
    expect(matchSlot(SLOTS, "mon", "19:10", "2026-07-27")).toBeNull();
    expect(matchSlot(SLOTS, "mon", "19:10", "2026-07-13")).toBe("19:10");
  });
  it("시각을 못 읽었거나 없는 시각이면 null", () => {
    expect(matchSlot(SLOTS, "mon", null, "2026-07-27")).toBeNull();
    expect(matchSlot(SLOTS, "mon", "15:00", "2026-07-27")).toBeNull();
  });
});

describe("assignDaySlots — 순서 보정은 '시각을 못 읽은' 블록에만", () => {
  const day = ["16:20", "17:00", "17:40"];
  it("시각이 맞는 블록을 먼저 확정한다", () => {
    const r = assignDaySlots([{ slotKey: "a", start24: "16:20" }, { slotKey: "b", start24: "17:40" }], day);
    expect([...r]).toEqual([["a", "16:20"], ["b", "17:40"]]);
  });
  it("🔴 시각을 못 읽은 블록은 앞뒤 사이 후보가 정확히 1개일 때만 채운다", () => {
    const r = assignDaySlots(
      [{ slotKey: "a", start24: "16:20" }, { slotKey: "b", start24: null }, { slotKey: "c", start24: "17:40" }],
      day,
    );
    expect(r.get("b")).toBe("17:00");
  });
  it("후보가 2개 이상이면 찍지 않고 비워 둔다", () => {
    const r = assignDaySlots([{ slotKey: "a", start24: "16:20" }, { slotKey: "b", start24: null }], ["16:20", "17:00", "17:40"]);
    expect(r.has("b")).toBe(false);
  });
  it("🔴 시각을 읽었는데 시간표에 없으면 보정하지 않는다(진짜 불일치는 사람이 봐야 한다)", () => {
    const r = assignDaySlots([{ slotKey: "a", start24: "19:00" }], ["16:20"]);
    expect(r.size).toBe(0);
  });
});

describe("buildWeekRows", () => {
  it("계획·목표·학생기록을 날짜/슬롯에 붙인다", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부/수업계획서", grid(), ctx(), issues);
    expect(w.monday).toBe("2026-07-27");
    expect(w.planRows).toEqual([
      {
        planDate: "2026-07-27",
        slotStart: "14:20",
        termMode: "regular",
        skillArea: "vocab",
        lineNo: 1,
        textbook: "능률 VOCA",
        pageRange: null,
        progress: "외우고 시험",
        homework: null,
      },
    ]);
    expect(w.markRows).toEqual([
      { studentId: "s1", markDate: "2026-07-27", slotStart: "14:20", status: "완", progressNote: null },
    ]);
    expect(issues).toEqual([]);
  });

  it("🔴 출석 체크(TRUE)만 있고 기록이 없으면 행을 만들지 않는다 — 출석은 가져오지 않는다", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부", grid({ note: "" }), ctx(), issues);
    expect(w.markRows).toEqual([]);
  });

  it("🔴 시간표에 없는 교시는 계획·기록 모두 버리고 이슈로 올린다(추정 배치 금지)", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부", grid({ time: "05:00\n~\n06:00" }), ctx(), issues);
    expect(w.planRows).toEqual([]);
    expect(w.markRows).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(["slot-unmapped"]);
  });

  it("🔴 설정에 없는 영역은 slug를 지어내지 않고 null + 이슈", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부", grid({ skill: "Phonics" }), ctx(), issues);
    expect(w.planRows[0]!.skillArea).toBeNull();
    expect(issues.map((i) => i.kind)).toEqual(["skill-unknown"]);
  });

  it("🔴 그 반 수강생이 아니면 기록을 넣지 않는다(다른 반 학생이 템플릿에 남아 있다)", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부", grid(), ctx({ rosterIds: new Set() }), issues);
    expect(w.markRows).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(["student-off-roster"]);
  });

  it("수강 중이 아닌 날짜(등원요일·보류)면 넣지 않는다", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부", grid(), ctx({ eligibleOn: () => false }), issues);
    expect(w.markRows).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(["student-off-roster"]);
  });

  it("이름을 확정 못하면(없음·동명) 넣지 않고 이슈", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("7/27-31 출석부", grid({ name: "홍길동" }), ctx(), issues);
    expect(w.markRows).toEqual([]);
    expect(issues[0]).toMatchObject({ kind: "student-unresolved" });
  });

  it("동명이인은 그 반 수강생으로 좁히고, 그래도 남으면 영문명으로 가른다", () => {
    const two = new Map([
      [
        "김수아",
        [
          { id: "a", englishName: "Sua" },
          { id: "b", englishName: "Sue" },
        ],
      ],
    ]);
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows(
      "7/27-31 출석부",
      grid({ name: "김수아(Sue)" }),
      ctx({ studentsByName: two, rosterIds: new Set(["a", "b"]) }),
      issues,
    );
    expect(w.markRows[0]!.studentId).toBe("b");
  });

  it("주차 제목을 못 읽으면 그 탭만 건너뛴다", () => {
    const issues: EcsImportIssue[] = [];
    const w = buildWeekRows("데이터", grid(), ctx(), issues);
    expect(w.skipped).toBeTruthy();
    expect(w.planRows).toEqual([]);
    expect(issues.map((i) => i.kind)).toEqual(["week-title"]);
  });

  it("이름 표기 분해", () => {
    expect(splitStudentLabel("강지원 (Kevin)")).toEqual({ korean: "강지원", english: "Kevin" });
    expect(splitStudentLabel("김채은A")).toEqual({ korean: "김채은A", english: null });
  });
});
