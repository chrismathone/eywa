// 쓰기 경로의 안전장치 — "도착지를 못 읽었는데 원래 반만 닫는다"·"남의 과목 수강을 닫는다" 같은 사고를 잠근다.
// 전부 쓰기 경로 적대 리뷰(2026-10-06)가 실제 입력으로 재현한 것이다. 격자는 진짜 익스포터가 그린 것을 고쳐 쓴다.
import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import { buildGridPlan, planSize, type PlanContext } from "./apply-plan";
import { computeGridDelta } from "./delta";
import { parseMathGrid } from "./parse-cells";
import { parseMeta } from "./parse-meta";
import { scheduleChanges, weekendSlotsShifted } from "./schedule-diff";
import { exportToSheet, findText, insertColumn, setText, student } from "./test-fixture";
import type { GridDelta, MathGridInput } from "./types";

const SPECS = [
  { id: "c-a", name: "초등M A", teacher: "김선생", room: "본원201", slots: [["mon", "16:20"], ["mon", "17:15"]] as [string, string][], students: [student("s1", "김하나"), student("s2", "이두리")] },
  { id: "c-b", name: "초등M B", teacher: "이선생", room: "본원203", slots: [["wed", "16:20"], ["wed", "17:15"]] as [string, string][], students: [student("s4", "최네오"), student("s5", "정다섯")] },
];
const world = (over: Partial<PlanContext> = {}): PlanContext => ({
  classes: [{ id: "c-a", name: "초등M A", open: true, days: ["mon"] }, { id: "c-b", name: "초등M B", open: true, days: ["wed"] }],
  students: [["s1", "김하나"], ["s2", "이두리"], ["s4", "최네오"], ["s5", "정다섯"]].map(([id, name]) => ({ id: id!, name: name!, school: "옥산초", grade: "초5", status: "enrolled" })),
  teachers: ["김선생", "이선생", "박선생"].map((name) => ({ id: `t-${name}`, name })),
  rooms: [{ id: "r-202", name: "본원202", archived: false }],
  enrollments: [["e1", "s1", "c-a"], ["e2", "s2", "c-a"], ["e4", "s4", "c-b"], ["e5", "s5", "c-b"]].map(([id, studentId, classId]) => ({ id: id!, studentId: studentId!, classId: classId!, endDate: null })),
  periods: { weekday: DEFAULT_PERIODS_CONFIG.weekday, weekend: DEFAULT_PERIODS_CONFIG.weekend },
  ...over,
});
const planOf = (grid: MathGridInput, meta: string[][], ctx = world()) =>
  buildGridPlan(computeGridDelta(parseMathGrid(grid, { roomNames: ["본원202"] }), parseMeta(meta), ctx.classes.filter((c) => c.open)), ctx);
const whys = (p: ReturnType<typeof buildGridPlan>) => p.skipped.map((s) => `${s.what} | ${s.why}`);
/** 그 학생의 원래 글자를 지운다(새로 적은 열은 남긴다). */
const erase = (grid: MathGridInput, text: string, keepCol = -1) => {
  for (const at of findText(grid, text)) if (at.col !== keepCol) setText(grid, at.row, at.col, "");
};
const delta = (over: Partial<GridDelta>): GridDelta => ({
  newClasses: [], placedClasses: [], moves: [], adds: [], removes: [], classSlots: [], ignored: [], notes: [], warnings: [],
  stats: { classCells: 1, students: 1 }, ...over,
});
const NEO = { studentId: "s4", text: "최네오/5옥산초" };
const B = { classId: "c-b", name: "초등M B" };
const A = { classId: "c-a", name: "초등M A" };

describe("도착지를 못 읽으면 원래 반 수강을 닫지 않는다", () => {
  const start = (grid: MathGridInput) => parseMathGrid(grid).blocks.find((b) => b.gid === 2)!.start;
  /** 맨 오른쪽에 열을 끼우고 머리(강사·요일)와 새 반 칸을 적는다. */
  const newColumn = (grid: MathGridInput, head: { teacher: string; day: string }, students: string[]) => {
    const col = Math.max(...grid.cells.map((r) => r.length));
    const g = insertColumn(grid, col);
    setText(g, 2, col, head.teacher);
    setText(g, 3, col, head.day);
    ["초등M 새반", "", "본원202", ""].forEach((t, i) => setText(g, start(grid) + i, col, t));
    students.forEach((t, i) => setText(g, start(grid) + 4 + i, col, t));
    return { g, col };
  };

  it("새 열에 강사 이름을 빠뜨렸다 · 요일을 '수요일'로 적었다 → 수강 종료 0건, 어디에 남아 있는지 알린다", async () => {
    for (const head of [{ teacher: "", day: "수" }, { teacher: "박선생", day: "수요일" }]) {
      const ex = await exportToSheet(SPECS);
      const { g, col } = newColumn(ex.grid, head, ["최네오/5옥산초", "정다섯/5옥산초"]);
      erase(g, "최네오/5옥산초", col);
      erase(g, "정다섯/5옥산초", col);
      const p = planOf(g, ex.meta);
      expect([planSize(p), p.warnings.length]).toEqual([0, 1]);
      expect(whys(p).filter((w) => w.includes("이 학생으로 보이는 글자가")).map((w) => w.split(" | ")[0])).toEqual([
        '정다섯/5옥산초 — "초등M B"에서 빠짐',
        '최네오/5옥산초 — "초등M B"에서 빠짐',
      ]);
    }
  });

  it("옮기며 학교 글자를 틀리게 적었다 → 새 반은 만들되 원래 반은 그대로, 이유 둘(명부에 없는 글자 · 이 학생으로 보이는 글자가 남아 있음)", async () => {
    const ex = await exportToSheet(SPECS);
    const { g } = newColumn(ex.grid, { teacher: "박선생", day: "수" }, ["최네오/5옥산"]);
    erase(g, "최네오/5옥산초");
    const p = planOf(g, ex.meta);
    expect([p.classes.length, p.moves, p.adds, p.removes]).toEqual([1, [], [], []]);
    expect(whys(p).map((w) => w.split(" | ")[0])).toEqual(['최네오/5옥산초 — "초등M B"에서 빠짐', '최네오/5옥산 → "초등M 새반"']);
  });

  it("옮기며 이름 글자가 달라졌다(오타·메모·한 칸에 두 명·학교 먼저) → 종료로 쓰지 않는다", async () => {
    for (const typed of ["최내오/5옥산초", "최네오(월수)/5옥산초", "최네오 신입", "최네오/5옥산초\n정다섯/5옥산초", "5옥산초/최네오"]) {
      const ex = await exportToSheet(SPECS);
      const { g } = newColumn(ex.grid, { teacher: "박선생", day: "수" }, [typed]);
      erase(g, "최네오/5옥산초");
      const p = planOf(g, ex.meta);
      expect([typed, p.removes, whys(p).some((w) => w.startsWith('최네오/5옥산초 — "초등M B"에서 빠짐 | 이 학생으로 보이는 글자가'))]).toEqual([typed, [], true]);
    }
  });

  it("구분 알파벳을 빼고 옮겨 적으면(김지유A → 김지유) 보류하고, 시트가 아는 다른 학생(김지유B)은 '남은 글자'로 세지 않는다", async () => {
    const specs = [
      { ...SPECS[0]!, students: [student("s1", "김하나"), student("j2", "김지유B", { status: "withdrawn", endDate: "2026-06-18" })] },
      { ...SPECS[1]!, students: [student("j1", "김지유A"), student("s5", "정다섯")] },
    ];
    const ctx = world({
      students: [...world().students, { id: "j1", name: "김지유A", school: "옥산초", grade: "초5", status: "enrolled" }],
      enrollments: [...world().enrollments, { id: "ej1", studentId: "j1", classId: "c-b", endDate: null }],
    });
    // 그냥 지움 — A의 퇴원 줄에 "김지유B"(한 글자 다르고 학교가 같다)가 있어도 진짜 빠짐이다
    const gone = await exportToSheet(specs);
    erase(gone.grid, "김지유A/5옥산초");
    expect(planOf(gone.grid, gone.meta, ctx).removes.map((r) => r.enrollmentId)).toEqual(["ej1"]);
    // 새 열에 알파벳 없이 옮겨 적음 — 명부에 없는 글자라 추가는 못 하고, 원래 반도 닫지 않는다
    const moved = await exportToSheet(specs);
    const { g } = newColumn(moved.grid, { teacher: "박선생", day: "수" }, ["김지유/5옥산초"]);
    erase(g, "김지유A/5옥산초");
    const p = planOf(g, moved.meta, ctx);
    expect([p.removes, whys(p).map((w) => w.split(" | ")[0])]).toEqual([[], ['김지유A/5옥산초 — "초등M B"에서 빠짐', '김지유/5옥산초 → "초등M 새반"']]);
  });

  it("새 열 맨 윗줄(반 이름 자리)부터 학생을 적으면 그 이름의 반을 만들지 않고, 원래 반도 닫지 않는다", async () => {
    const ex = await exportToSheet(SPECS);
    const col = Math.max(...ex.grid.cells.map((r) => r.length));
    const g = insertColumn(ex.grid, col);
    setText(g, 2, col, "박선생");
    setText(g, 3, col, "수");
    ["최네오", "정다섯"].forEach((t, i) => setText(g, start(ex.grid) + i, col, t));
    erase(g, "최네오/5옥산초");
    erase(g, "정다섯/5옥산초");
    const p = planOf(g, ex.meta);
    expect([planSize(p), whys(p).filter((w) => w.includes("학생 이름이 반 이름 자리에")).length]).toEqual([0, 2]);
  });

  it("두 반을 다니는 학생을 옮기면서 다른 반 칸의 이름을 고쳐 적으면: 새 반으로의 추가를 못 읽은 만큼 원래 반 종료도 보류한다", async () => {
    const specs = [
      { id: "c-g", name: "초등M G", teacher: "김선생", room: "본원201", slots: [["mon", "14:30"], ["mon", "15:25"]] as [string, string][], students: [student("s1", "김하나"), student("s2", "이두리")] },
      { ...SPECS[1]!, students: [student("s1", "김하나"), student("s5", "정다섯")] },
      { id: "c-z", name: "초등M Z", teacher: "김선생", room: "본원201", slots: [["fri", "16:20"], ["fri", "17:15"]] as [string, string][], students: [student("s4", "최네오")] },
    ];
    const ex = await exportToSheet(specs);
    const cells = parseMathGrid(ex.grid).cells;
    const cellOf = (name: string) => cells.find((c) => c.classes[0]!.name === name)!;
    const inB = cellOf("초등M B").students.find((s) => s.text === "김하나/5옥산초")!;
    setText(ex.grid, inB.row, inB.col, "");
    setText(ex.grid, cellOf("초등M Z").row + 6, cellOf("초등M Z").col, "김하나/5옥산초");
    setText(ex.grid, cellOf("초등M G").row, cellOf("초등M G").col, "초등M G2");
    const d = computeGridDelta(parseMathGrid(ex.grid), parseMeta(ex.meta), specs.map((s) => ({ id: s.id, name: s.name })));
    expect([d.moves, d.adds, d.removes]).toEqual([[], [], []]);
    expect(d.ignored.map((i) => i.what)).toEqual(['반 이름 "초등M G" → "초등M G2"', '김하나/5옥산초 → "초등M Z"', '김하나/5옥산초 — "초등M B"에서 빠짐']);
  });

  it("남의 반 맨 아래(퇴원) 줄·인원 줄에 옮겨 적었다 → 종료로 쓰지 않는다", async () => {
    for (const fromEnd of [1, 0]) {
      const ex = await exportToSheet(SPECS);
      const parsed = parseMathGrid(ex.grid);
      const cellA = parsed.cells.find((c) => c.classes[0]!.name === "초등M A")!;
      const block = parsed.blocks.find((b) => b.start === cellA.row)!;
      erase(ex.grid, "최네오/5옥산초");
      setText(ex.grid, block.end - fromEnd, cellA.col, "최네오/5옥산초");
      const p = planOf(ex.grid, ex.meta);
      expect([fromEnd, planSize(p), whys(p).some((w) => w.includes("이 학생으로 보이는 글자가"))]).toEqual([fromEnd, 0, true]);
    }
  });

  it("진짜 빠짐은 그대로 종료 — 글자를 지웠을 때, 그리고 그 반의 퇴원 줄로 내렸을 때", async () => {
    const ex = await exportToSheet(SPECS);
    erase(ex.grid, "최네오/5옥산초");
    expect(planOf(ex.grid, ex.meta).removes).toEqual([{ enrollmentId: "e4", label: "최네오/5옥산초", className: "초등M B" }]);

    const ex2 = await exportToSheet(SPECS);
    const parsed = parseMathGrid(ex2.grid);
    const cellB = parsed.cells.find((c) => c.classes[0]!.name === "초등M B")!;
    erase(ex2.grid, "최네오/5옥산초");
    setText(ex2.grid, parsed.blocks.find((b) => b.start === cellB.row)!.end - 1, cellB.col, "최네오/5옥산초");
    const p = planOf(ex2.grid, ex2.meta);
    expect([p.removes.map((r) => r.enrollmentId), p.skipped]).toEqual([["e4"], []]);
  });

  it("다른 반을 그만둔 기록(보낼 때부터 있던 퇴원 줄)은 '남아 있는 이름'으로 세지 않는다", async () => {
    const specs = [
      { ...SPECS[0]!, students: [...SPECS[0]!.students, student("s4", "최네오", { status: "withdrawn", endDate: "2026-06-18" })] },
      SPECS[1]!,
    ];
    const ex = await exportToSheet(specs);
    const before = parseMathGrid(ex.grid).cells.find((c) => c.classes[0]!.name === "초등M A")!.students;
    expect(before.filter((s) => s.section === "withdrawn").map((s) => s.text)).toEqual(["최네오/5옥산초"]);
    const cellB = parseMathGrid(ex.grid).cells.find((c) => c.classes[0]!.name === "초등M B")!;
    const inB = cellB.students.find((s) => s.text === "최네오/5옥산초")!;
    setText(ex.grid, inB.row, inB.col, "");
    expect(planOf(ex.grid, ex.meta).removes.map((r) => r.enrollmentId)).toEqual(["e4"]);
  });
});

describe("계획 — 쓰면 안 되는 것을 쓰지 않는다", () => {
  it("추가가 막히면 그 학생의 원래 반 종료도 보류한다(다른 반에 못 넣었는데 원래 반만 닫히면 안 된다)", () => {
    const dead = { classId: "c-dead", name: "초등M 종강반" };
    const p = buildGridPlan(
      delta({ adds: [{ student: NEO, to: dead, days: [] }, { student: NEO, to: A, days: [] }], removes: [{ student: NEO, from: B }] }),
      world({ classes: [...world().classes, { id: "c-dead", name: "초등M 종강반", open: false }] }),
    );
    expect([p.adds.map((a) => a.to.name), p.removes]).toEqual([["초등M A"], []]);
    expect(whys(p)).toEqual([
      '최네오/5옥산초 → "초등M 종강반" | "초등M 종강반"은(는) 종강·폐지된 반입니다.',
      '최네오/5옥산초 — "초등M B"에서 빠짐 | 이 학생을 다른 반에 넣는 변경이 적용되지 않아, 원래 반 수강도 그대로 둡니다.',
    ]);
  });

  it("출발 반이 수학 반이 아니면 건드리지 않는다 · 화면에 싣는 이름은 시트 글자가 아니라 명부의 것", () => {
    const ctx = world({ enrollments: [...world().enrollments, { id: "e-eng", studentId: "s1", classId: "eng-1", endDate: null }] });
    const forged = { studentId: "s1", text: "지울줄/5옥산초" };
    const other = buildGridPlan(delta({ removes: [{ student: forged, from: { classId: "eng-1", name: "정리용" } }] }), ctx);
    expect([planSize(other), whys(other)[0]]).toEqual([0, expect.stringContaining("수학 수업목록에 없는 반의 수강이라 건드리지 않았습니다")]);
    // 수학 반이면 쓰되, 누구의 수강인지는 명부의 이름으로 보인다
    expect(buildGridPlan(delta({ removes: [{ student: forged, from: A }] }), ctx).removes).toEqual([
      { enrollmentId: "e1", label: "김하나/5옥산초", className: "초등M A" },
    ]);
  });

  it("등원 요일은 그 반이 실제로 여는 요일 안에서만 — 어긋나거나 수업 시간이 없는 반으로는 옮기지 않는다", () => {
    const move = { student: NEO, from: B, to: A, days: ["월"] };
    const run = (days: string[] | undefined) =>
      buildGridPlan(delta({ moves: [move] }), world({ classes: [{ id: "c-a", name: "초등M A", open: true, days }, world().classes[1]!] }));
    expect(run(["mon", "thu"]).moves.map((m) => m.attendanceDays)).toEqual([["mon"]]);
    expect([run(["tue", "fri"]).moves, whys(run(["tue", "fri"]))]).toEqual([
      [],
      ['최네오/5옥산초: "초등M B" → "초등M A" | "초등M A" 반은 수업목록에서 화·금요일에 수업합니다 — 시트에 적은 요일(월)과 달라 등원 요일을 정할 수 없습니다.'],
    ]);
    expect(whys(run([]))[0]).toContain("수업목록에 수업 시간이 없습니다");
    expect(run(undefined).moves.length).toBe(1); // 요일을 모르면 견주지 않는다
  });

  it("예비·상담완료 학생은 넣지 않는다(앱의 배정 게이트와 같은 이유) · 휴원은 휴원 표식을 달고 들어간다", () => {
    const ctx = world({
      students: [
        ...world().students,
        { id: "s8", name: "예비생", school: "옥산초", grade: "초3", status: "prospect" },
        { id: "s9", name: "상담생", school: "옥산초", grade: "초3", status: "consulted" },
        { id: "s7", name: "나휴원", school: "옥산초", grade: "초3", status: "on_hold" },
      ],
    });
    const add = (text: string) => ({ student: { studentId: null, text }, to: A, days: [] });
    const p = buildGridPlan(delta({ adds: [add("예비생/3옥산초"), add("상담생"), add("나휴원")] }), ctx);
    expect(p.adds.map((a) => [a.label, a.onHold])).toEqual([["나휴원/3옥산초", true]]);
    expect(whys(p).map((w) => w.split(" | ")[1])).toEqual(Array(2).fill("아직 재원 학생이 아닙니다 — 상태를 '재원'으로 전환한 뒤 배정해 주세요."));
  });

  it("대기 칸으로 옮겨 적으면 반만 옮기고, 휴원 상태는 안 바뀐다고 알린다", async () => {
    const specs = [{ ...SPECS[0]!, students: [student("s1", "김하나"), student("s2", "이두리", { status: "hold" })] }, SPECS[1]!];
    const ex = await exportToSheet(specs);
    erase(ex.grid, "최네오/5옥산초");
    const held = findText(ex.grid, "이두리/5옥산초")[0]!;
    setText(ex.grid, held.row + 1, held.col, "최네오/5옥산초");
    const p = planOf(ex.grid, ex.meta);
    expect(p.moves.map((m) => [m.enrollmentId, m.to.name])).toEqual([["e4", "초등M A"]]);
    expect(whys(p)).toEqual(['최네오/5옥산초 — "초등M A" 재원 → 대기 | 휴원(대기) 전환은 시트로 바꾸지 않습니다 — 반만 옮기고 휴원 상태는 그대로 둡니다. 학생 화면에서 바꿔 주세요.']);
  });

  it("종강이 잡힌 반으로 가는 변경은 그 날짜를 싣고(서버가 적용일과 견준다) 미리 알린다", () => {
    const ctx = world({ classes: [{ id: "c-a", name: "초등M A", open: true, closesOn: "2026-10-20" }, world().classes[1]!] });
    const p = buildGridPlan(delta({ moves: [{ student: NEO, from: B, to: A, days: [] }] }), ctx);
    expect([p.moves[0]!.to.closesOn, p.notes]).toEqual(["2026-10-20", ['"초등M A" 반은 2026-10-20에 종강 예정입니다 — 그 전 날짜로만 적용할 수 있습니다.']]);
  });

  it("앞 교시를 안 쓰는 주에는 주말 칸의 교시를 믿지 않는다 — 주말 새 반은 만들지 않고, 주말 자리는 견주지 않는다", () => {
    const cls = (schedule: string[]) => [{ id: "c-a", teacher: "김선생", schedule }];
    expect([weekendSlotsShifted(cls(["월 1-1", "월 1-2", "토 2-1"])), weekendSlotsShifted(cls(["월 2-1", "토 2-2"])), weekendSlotsShifted([])]).toEqual([false, true, false]);

    const weekendClass = { name: "초등M 주말반", slots: [{ teacher: "박선생", days: ["토"], periodIds: ["1-1"], weekend: true, room: "" }], students: [] };
    const p = buildGridPlan(delta({ newClasses: [weekendClass] }), world({ weekendShifted: true }));
    expect([p.classes, whys(p)[0]]).toEqual([[], expect.stringContaining("주말 칸의 시간을 확실히 읽을 수 없습니다")]);
    expect(buildGridPlan(delta({ newClasses: [weekendClass] }), world()).classes.length).toBe(1);

    // 주말 칸이 당겨진 주: 시트의 토요일 자리(1-1로 읽힘)와 수업목록(2-1)이 달라 보여도 알림을 내지 않는다
    const slots = [{ classId: "c-a", name: "초등M A", roomWas: [], slots: [{ teacher: "김선생", days: ["토"], periodIds: ["1-1"], weekend: true, room: "" }] }];
    expect(scheduleChanges(slots, cls(["토 2-1"]))).toEqual([]);
    expect(scheduleChanges(slots, cls(["월 1-1", "토 1-2"])).length).toBe(1);
  });

  it("새 반의 강의실이 칸마다 다르면 비워 두고 그렇게 말한다(등록 안 된 강의실이라는 틀린 이유를 대지 않는다)", () => {
    const slot = (day: string, room: string) => ({ teacher: "박선생", days: [day], periodIds: ["2-1", "2-2"], weekend: false, room });
    const p = buildGridPlan(delta({ newClasses: [{ name: "초등M 새반", slots: [slot("월", "본원202"), slot("목", "본원203")], students: [] }] }), world());
    expect([p.classes[0]!.classroomId, p.notes]).toEqual([null, ['"초등M 새반" — 강의실이 칸마다 다르게 적혀 있어(본원202 · 본원203) 비워 둡니다. 수업목록에서 넣어 주세요.']]);
  });

  it("사라진 반의 학생을 새 반 둘로 나눠 적으면 '이름 변경'이 아니라 '반을 나눔'으로 알린다", async () => {
    const ex = await exportToSheet(SPECS);
    const parsed = parseMathGrid(ex.grid);
    const top = parsed.blocks.find((b) => b.gid === 2)!;
    const cellB = parsed.cells.find((c) => c.classes[0]!.name === "초등M B")!;
    let g = ex.grid;
    [["초등M 새반1", "수", "최네오/5옥산초"], ["초등M 새반2", "금", "정다섯/5옥산초"]].forEach(([name, day, who]) => {
      const col = Math.max(...g.cells.map((r) => r.length));
      g = insertColumn(g, col);
      setText(g, 2, col, "박선생");
      setText(g, 3, col, day!);
      [name!, "", "본원202", "", who!].forEach((t, i) => setText(g, top.start + i, col, t));
    });
    for (let r = cellB.row; r <= top.end; r++) setText(g, r, cellB.col, "");
    const p = planOf(g, ex.meta);
    expect([planSize(p), p.skipped.map((s) => s.what)]).toEqual([0, ['"초등M B" 반을 "초등M 새반1" · "초등M 새반2"(으)로 나눔']]);
  });
});
