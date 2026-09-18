import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeatClassRoster } from "./queries";

/**
 * JJ실 **'전체' 보기**(원장 2026-09-18 *"펼치기"*)의 하루치 조회 — 잠그는 것 넷:
 *  🔑 ① 왕복은 교시 수와 무관하다 — 계획 줄·JJ 칸은 **한 번씩**, ECS 게이트는 **반마다 한 번**(B6).
 *  🔑 ② 줄·칸은 **제 교시로만** 간다(같은 반이 하루 두 교시여도 섞이지 않는다).
 *  🔴 ③ 게이트를 못 지난 반은 어느 교시에도 **키가 없다**(교시 하나 보기와 같은 게이트).
 *  🔴 ④ 조회가 깨져도 출결 화면은 산다 — 계획은 빈 값, 명단은 칸 없이 그대로([[#95]]).
 */

const TENANT = "t1";
const DATE = "2026-09-18";
const A = "class-a"; // 16:20 · 17:20 두 교시
const B = "class-b"; // 17:20만
const DENIED = "class-x"; // ECS 게이트 거절

const calls = { from: [] as string[], gate: [] as string[] };
let failTable: string | null = null;

type Row = Record<string, unknown>;
const TABLES: Record<string, Row[]> = {
  class_sheet_plan_lines: [
    planRow("l1", A, "16:20:00", "인재원 SRS"),
    planRow("l2", A, "17:20:00", "Listening (NTA)"),
    planRow("l3", B, "17:20:00", "보카킹"),
    planRow("l4", DENIED, "17:20:00", "안 보여야 함"),
  ],
  class_sheet_student_marks: [
    { tenant_id: TENANT, mark_date: DATE, class_id: A, student_id: "s1", slot_start: "16:20:00", listening_level: "6", memorized_words: "50", status: null, progress_note: null },
    { tenant_id: TENANT, mark_date: DATE, class_id: A, student_id: "s1", slot_start: "17:20:00", listening_level: "7", memorized_words: "60", status: null, progress_note: null },
  ],
};

function planRow(id: string, classId: string, slot: string, textbook: string): Row {
  return {
    id,
    tenant_id: TENANT,
    class_id: classId,
    plan_date: DATE,
    slot_start: slot,
    term_mode: "regular",
    skill_area: "vocab",
    line_no: 1,
    textbook,
    page_range: null,
    progress: null,
    homework: null,
    updated_at: "2026-09-18T00:00:00Z",
  };
}

function makeBuilder(table: string) {
  const filters: { col: string; op: "eq" | "in"; val: unknown }[] = [];
  const rows = () =>
    (TABLES[table] ?? []).filter((r) =>
      filters.every((f) => (f.op === "eq" ? r[f.col] === f.val : (f.val as unknown[]).includes(r[f.col]))),
    );
  const api = {
    select: () => api,
    eq: (col: string, val: unknown) => (filters.push({ col, op: "eq", val }), api),
    in: (col: string, val: unknown[]) => (filters.push({ col, op: "in", val }), api),
    order: () => api,
    then: (ok: (v: { data: Row[] | null; error: { message: string } | null }) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve(
        failTable === table ? { data: null, error: { message: "column does not exist" } } : { data: rows(), error: null },
      ).then(ok, err),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      calls.from.push(table);
      return makeBuilder(table);
    },
  }),
}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("@/features/class-sheets/server/access", () => ({
  requireEcsClassAccess: async (classId: string) => {
    calls.gate.push(classId);
    if (classId === DENIED) return { ok: false, error: "권한 없음" };
    return { ok: true, access: { canWrite: classId === A, englishTrack: classId === B ? "eie" : "injaewon", skillAreas: [] } };
  },
}));

const { loadSeatJjPlans, loadSeatJjPlansForPeriods } = await import("./jj-plan");
const { attachJjMarks, attachJjMarksForPeriods } = await import("./jj-marks");

const PERIODS = [
  { start: "16:20", classIds: [A] },
  { start: "17:20", classIds: [A, B, DENIED] },
];

function roster(classId: string, studentId: string): SeatClassRoster {
  return {
    classId,
    className: classId,
    end: "17:00",
    bgColor: null,
    textColor: null,
    students: [
      {
        id: studentId,
        name: "강지원",
        school: "성광중",
        grade: "1",
        status: null,
        recordedBy: null,
        fromSeat: false,
        note: null,
      },
    ],
  } as SeatClassRoster;
}

beforeEach(() => {
  calls.from = [];
  calls.gate = [];
  failTable = null;
});

describe("수업계획 — 하루치 한 번", () => {
  it("🔑 줄 조회 1번 · 게이트는 반마다 1번 — 교시가 몇 개여도", async () => {
    await loadSeatJjPlansForPeriods("jj", PERIODS, TENANT, DATE);
    expect(calls.from).toEqual(["class_sheet_plan_lines"]);
    expect([...calls.gate].sort()).toEqual([A, B, DENIED].sort());
  });

  it("🔑 줄은 제 교시로만 가고 · 🔴 게이트를 못 지난 반은 키가 없다", async () => {
    const out = await loadSeatJjPlansForPeriods("jj", PERIODS, TENANT, DATE);
    expect(Object.keys(out)).toEqual(["16:20", "17:20"]);
    expect(out["16:20"]![A]!.lines.map((l) => l.textbook)).toEqual(["인재원 SRS"]);
    expect(out["17:20"]![A]!.lines.map((l) => l.textbook)).toEqual(["Listening (NTA)"]);
    expect(out["17:20"]![B]!.lines.map((l) => l.textbook)).toEqual(["보카킹"]);
    expect(out["17:20"]![DENIED]).toBeUndefined();
    // 16:20엔 B가 없다 — 다른 교시의 반이 새어 들어오지 않는다.
    expect(out["16:20"]![B]).toBeUndefined();
    // 쓰기 자격·내신 구획은 게이트 값 그대로.
    expect(out["17:20"]![A]!.canEdit).toBe(true);
    expect(out["17:20"]![B]!.canEdit).toBe(false);
    expect(out["17:20"]![B]!.showExamTerm).toBe(false);
  });

  it("교시 하나 보기(`loadSeatJjPlans`)는 여러 교시 함수의 한 칸과 같은 값", async () => {
    const one = await loadSeatJjPlans("jj", [A, B, DENIED], TENANT, DATE, "17:20");
    const all = await loadSeatJjPlansForPeriods("jj", PERIODS, TENANT, DATE);
    expect(one).toEqual(all["17:20"]);
  });

  it("🔴 랩실엔 계획이 없다 — 조회도 게이트도 안 돈다", async () => {
    expect(await loadSeatJjPlansForPeriods("lab", PERIODS, TENANT, DATE)).toEqual({});
    expect(calls.from).toEqual([]);
    expect(calls.gate).toEqual([]);
  });

  it("🔴 줄 조회가 깨지면 빈 값 — 화면은 계획 없이 산다", async () => {
    failTable = "class_sheet_plan_lines";
    expect(await loadSeatJjPlansForPeriods("jj", PERIODS, TENANT, DATE)).toEqual({});
  });
});

describe("JJ 칸(듣기·단어) — 하루치 한 번", () => {
  it("🔑 조회 1번 · 칸은 제 교시로만", async () => {
    const out = await attachJjMarksForPeriods({ "16:20": [roster(A, "s1")], "17:20": [roster(A, "s1")] }, TENANT, DATE);
    expect(calls.from).toEqual(["class_sheet_student_marks"]);
    expect(out["16:20"]![0]!.students[0]!.listeningLevel).toBe("6");
    expect(out["17:20"]![0]!.students[0]!.listeningLevel).toBe("7");
    expect(out["17:20"]![0]!.students[0]!.memorizedWords).toBe("60");
  });

  it("교시 하나(`attachJjMarks`)와 같은 값", async () => {
    const one = await attachJjMarks([roster(A, "s1")], TENANT, DATE, "17:20");
    const all = await attachJjMarksForPeriods({ "17:20": [roster(A, "s1")] }, TENANT, DATE);
    expect(one).toEqual(all["17:20"]);
  });

  it("🔴 조회가 깨지면 명단은 칸 없이 그대로", async () => {
    failTable = "class_sheet_student_marks";
    const input = { "16:20": [roster(A, "s1")] };
    const out = await attachJjMarksForPeriods(input, TENANT, DATE);
    expect(out["16:20"]).toEqual(input["16:20"]);
  });
});
