// 반영 계획 — 무엇을 쓰고 무엇을 (이유와 함께) 쓰지 않는가. 원장 2026-10-06: *"필터링이 잘 되는가. 왜 적용 못하는지
// 알림이 잘 뜨는가."* 여기서 잠그는 것은 두 가지다: 쓸 것은 DB에 넣을 모양 그대로 나오고, 못 쓰는 것은 조용히 사라지지 않는다.
import { describe, expect, it } from "vitest";
import { DEFAULT_PERIODS_CONFIG } from "@/features/timetable/lib/periods";
import { buildGridPlan, gridPlanHash, planSize, type PlanContext } from "./apply-plan";
import { toGridPreview } from "./build-preview";
import { computeGridDelta } from "./delta";
import { parseMathGrid } from "./parse-cells";
import { parseMeta } from "./parse-meta";
import { scheduleChanges } from "./schedule-diff";
import { exportToSheet, findText, insertColumn, setText, student } from "./test-fixture";
import type { DeltaSlot, GridDelta } from "./types";

const slot = (over: Partial<DeltaSlot> = {}): DeltaSlot => ({
  teacher: "허주연", days: ["수"], periodIds: ["2-1", "2-2"], weekend: false, room: "본원202", ...over,
});
const delta = (over: Partial<GridDelta>): GridDelta => ({
  newClasses: [], placedClasses: [], moves: [], adds: [], removes: [], classSlots: [], ignored: [], notes: [], warnings: [],
  stats: { classCells: 1, students: 1 }, ...over,
});
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  classes: [
    { id: "c-i", name: "초등M 개별 JJ2I", open: true },
    { id: "c-n", name: "초등M 개별 JJ2N", open: true },
    { id: "c-dead", name: "초등M 종강반", open: false },
  ],
  students: [
    { id: "s1", name: "박지호", school: "달성초", grade: "초6", status: "enrolled" },
    { id: "s2", name: "김하늘", school: "옥산초", grade: "초5", status: "enrolled" },
    { id: "s3", name: "김하늘", school: "칠성초", grade: "초4", status: "enrolled" },
    { id: "s4", name: "나휴원", school: "옥산초", grade: "초5", status: "on_hold" },
    { id: "s5", name: "다퇴원", school: "옥산초", grade: "초5", status: "withdrawn" },
  ],
  teachers: [{ id: "t-heo", name: "허주연" }],
  rooms: [{ id: "r-202", name: "본원202", archived: false }, { id: "r-old", name: "본원999", archived: true }],
  enrollments: [{ id: "e1", studentId: "s1", classId: "c-i", endDate: null }],
  periods: { weekday: DEFAULT_PERIODS_CONFIG.weekday, weekend: DEFAULT_PERIODS_CONFIG.weekend },
  ...over,
});
const jj2o = { classId: null, name: "초등M 개별 JJ2O" };
const newClass = (over: Partial<GridDelta["newClasses"][number]> = {}) => ({ name: jj2o.name, slots: [slot()], students: [], ...over });
const whys = (p: ReturnType<typeof buildGridPlan>) => p.skipped.map((s) => `${s.what} | ${s.why}`);

describe("수학 격자 반영 계획", () => {
  it("새 반은 DB에 넣을 모양으로 — 강사·강의실은 id, 수업 시간은 교시표의 시각(한 교시 = 두 줄)", () => {
    const p = buildGridPlan(
      delta({
        newClasses: [newClass()],
        moves: [{ student: { studentId: "s1", text: "박지호/6달성초" }, from: { classId: "c-i", name: "초등M 개별 JJ2I" }, to: jj2o, days: [] }],
      }),
      ctx(),
    );
    expect(p.classes).toEqual([
      {
        key: "new:초등m개별jj2o",
        name: "초등M 개별 JJ2O",
        teacherId: "t-heo",
        teacherName: "허주연",
        classroomId: "r-202",
        room: "본원202",
        slots: [
          { day: "wed", startTime: "16:20", endTime: "17:15" },
          { day: "wed", startTime: "17:15", endTime: "18:10" },
        ],
        when: ["수 16:20~18:10 (2교시)"],
      },
    ]);
    expect(p.moves).toEqual([
      { enrollmentId: "e1", studentId: "s1", label: "박지호/6달성초", fromName: "초등M 개별 JJ2I", to: { classId: null, key: "new:초등m개별jj2o", name: "초등M 개별 JJ2O" }, attendanceDays: [] },
    ]);
    expect([planSize(p), p.skipped, p.notes]).toEqual([2, [], []]);
    expect(toGridPreview(p, "수학 탭", { classCells: 1, students: 1 }).classes[0]!.students).toEqual(["박지호/6달성초"]);
  });

  it("만들 수 없는 새 반은 이유를 말하고, 그 반으로 가는 학생도 함께 빠진다(원래 반은 그대로)", () => {
    const move = { student: { studentId: "s1", text: "박지호/6달성초" }, from: { classId: "c-i", name: "초등M 개별 JJ2I" }, to: jj2o, days: [] };
    const cases: [string, Partial<GridDelta["newClasses"][number]>, string][] = [
      ["직원 명단에 없는 강사", { slots: [slot({ teacher: "새선생" })] }, '"새선생"은(는) 반을 맡을 수 있는 직원 명단에 없는 이름입니다.'],
      ["강사 열이 둘", { slots: [slot(), slot({ teacher: "이수진", days: ["월"] })] }, "강사 열이 둘 이상입니다(허주연 · 이수진) — 한 반은 한 강사 열에만 적어 주세요."],
      ["요일 없는 열", { slots: [slot({ days: [] })] }, "요일을 읽지 못한 열에 놓여 있습니다."],
    ];
    for (const [label, over, why] of cases) {
      const p = buildGridPlan(delta({ newClasses: [newClass(over)], moves: [move] }), ctx());
      expect([label, planSize(p), whys(p)]).toEqual([
        label,
        0,
        [`새 반 "초등M 개별 JJ2O" | ${why}`, '박지호/6달성초: "초등M 개별 JJ2I" → "초등M 개별 JJ2O" | 새 반 "초등M 개별 JJ2O"을(를) 만들 수 없어 함께 빠집니다.'],
      ]);
    }
    // 종강·폐지 반이 그 이름을 쥐고 있다 · 클래스노트 보드 이름과 겹치는 모양
    expect(whys(buildGridPlan(delta({ newClasses: [newClass({ name: "초등M 종강반" })] }), ctx()))[0]).toContain("같은 이름의 종강·폐지 반이 있습니다");
    expect(whys(buildGridPlan(delta({ newClasses: [newClass({ name: "(수학)홍길동" })] }), ctx()))[0]).toContain("괄호로 시작하는 이름");
  });

  it("등록 안 된(또는 보관된) 강의실은 반을 막지 않고 비워 둔다고 알린다", () => {
    const p = buildGridPlan(delta({ newClasses: [newClass({ slots: [slot({ room: "본원999" })] })] }), ctx());
    expect([p.classes[0]!.classroomId, p.notes]).toEqual([null, ['"초등M 개별 JJ2O" — 강의실 "본원999"은(는) 등록된 강의실과 달라 비워 둡니다.']]);
  });

  it("학생: 명부와 글자가 다르면 이름만으로 잇지 않고, 이름만 적은 건 한 명일 때만, 퇴원생은 넣지 않는다", () => {
    const to = { classId: "c-n", name: "초등M 개별 JJ2N" };
    const add = (text: string) => ({ student: { studentId: null, text }, to, days: [] });
    const p = buildGridPlan(
      delta({ adds: [add("박지호/3칠성초"), add("박지호"), add("김하늘"), add("김하늘/4칠성초"), add("나휴원"), add("다퇴원/5옥산초")] }),
      ctx(),
    );
    expect(p.adds.map((a) => [a.studentId, a.onHold])).toEqual([["s1", false], ["s3", false], ["s4", true]]);
    expect(whys(p)).toEqual([
      '박지호/3칠성초 → "초등M 개별 JJ2N" | 학생 명부에 없는 글자입니다 — 원생목록에 먼저 등록하거나, 명부의 이름·학교·학년대로 적어 주세요.',
      '김하늘 → "초등M 개별 JJ2N" | 같은 이름의 학생이 여럿입니다 — 학교·학년까지 적어 주세요.',
      '다퇴원/5옥산초 → "초등M 개별 JJ2N" | 퇴원한 학생입니다 — 재원으로 복구한 뒤 배정해 주세요.',
    ]);
  });

  it("이동: 옛 수강이 이미 없으면 추가만, 이미 옮겨 가 있으면 종료만, 이동·종료가 예약돼 있으면 건드리지 않는다", () => {
    const move = { student: { studentId: "s1", text: "박지호/6달성초" }, from: { classId: "c-i", name: "초등M 개별 JJ2I" }, to: { classId: "c-n", name: "초등M 개별 JJ2N" }, days: ["수"] };
    const run = (enrollments: PlanContext["enrollments"]) => buildGridPlan(delta({ moves: [move] }), ctx({ enrollments }));

    const gone = run([]);
    expect([gone.moves.length, gone.adds.map((a) => [a.studentId, a.attendanceDays]), gone.removes.length]).toEqual([0, [["s1", ["wed"]]], 0]);

    const both = run([{ id: "e1", studentId: "s1", classId: "c-i", endDate: null }, { id: "e2", studentId: "s1", classId: "c-n", endDate: null }]);
    expect([both.moves.length, both.adds.length, both.removes.map((r) => r.enrollmentId)]).toEqual([0, 0, ["e1"]]);

    const booked = run([{ id: "e1", studentId: "s1", classId: "c-i", endDate: "2026-12-01" }]);
    expect([planSize(booked), whys(booked)]).toEqual([0, ['박지호/6달성초: "초등M 개별 JJ2I" → "초등M 개별 JJ2N" | "초등M 개별 JJ2I"에서 이미 반 이동이나 종료가 예약되어 있습니다.']]);

    // 종강한 반으로는 옮기지 않는다
    const closed = buildGridPlan(delta({ moves: [{ ...move, to: { classId: "c-dead", name: "초등M 종강반" } }] }), ctx());
    expect(whys(closed)[0]).toContain("종강·폐지된 반입니다");
  });

  it("해시는 쓸 내용이 바뀔 때만 바뀐다(쓰지 않는 것·알림은 넣지 않는다)", () => {
    const base = delta({ newClasses: [newClass()] });
    const h = gridPlanHash(buildGridPlan(base, ctx()));
    expect(gridPlanHash(buildGridPlan({ ...base, notes: ["알림"], ignored: [{ what: "x", why: "y" }] }, ctx()))).toBe(h);
    expect(gridPlanHash(buildGridPlan(delta({ newClasses: [newClass({ slots: [slot({ days: ["목"] })] })] }), ctx()))).not.toBe(h);
  });
});

describe("수학 격자 — 시트에서 계획까지", () => {
  const specs = [
    { id: "c-a", name: "초등M A", teacher: "김선생", room: "본원201", slots: [["wed", "16:20"], ["wed", "17:15"]] as [string, string][], students: [student("s1", "김하나"), student("s2", "이두리")] },
    { id: "c-b", name: "초등M B", teacher: "이선생", room: "본원203", slots: [["wed", "16:20"], ["wed", "17:15"]] as [string, string][], students: [student("s3", "박세미")] },
  ];
  const world: PlanContext = {
    classes: specs.map((s) => ({ id: s.id, name: s.name, open: true })),
    students: [["s1", "김하나"], ["s2", "이두리"], ["s3", "박세미"]].map(([id, name]) => ({ id: id!, name: name!, school: "옥산초", grade: "초5", status: "enrolled" })),
    teachers: ["김선생", "이선생", "박선생"].map((name) => ({ id: `t-${name}`, name })),
    rooms: [{ id: "r-202", name: "본원202", archived: false }],
    enrollments: [{ id: "e1", studentId: "s1", classId: "c-a", endDate: null }, { id: "e2", studentId: "s2", classId: "c-a", endDate: null }, { id: "e3", studentId: "s3", classId: "c-b", endDate: null }],
    periods: { weekday: DEFAULT_PERIODS_CONFIG.weekday, weekend: DEFAULT_PERIODS_CONFIG.weekend },
  };
  const planOf = (grid: Parameters<typeof parseMathGrid>[0], meta: string[][], exported: Parameters<typeof scheduleChanges>[1]) => {
    const d = computeGridDelta(parseMathGrid(grid, { roomNames: ["본원202"] }), parseMeta(meta), world.classes.map((c) => ({ id: c.id, name: c.name })));
    return buildGridPlan(d, world, scheduleChanges(d.classSlots, exported));
  };

  it("열을 끼워 새 반을 만들고 한 명을 옮기면: 반 1 + 이동 1, 적용하지 않는 것 없음", async () => {
    const ex = await exportToSheet(specs);
    const parsed = parseMathGrid(ex.grid);
    const col = parsed.columns.find((c) => c.teacher === "이선생")!.col;
    const start = parsed.blocks.find((b) => b.gid === 2)!.start;
    const grid = insertColumn(ex.grid, col);
    ["박선생"].forEach((t) => setText(grid, 2, col, t));
    setText(grid, 3, col, "수");
    ["초등M 새반", "", "본원202", "", "이두리/5옥산초"].forEach((t, i) => setText(grid, start + i, col, t));
    const old = findText(grid, "이두리/5옥산초").find((p) => p.col !== col)!;
    setText(grid, old.row, old.col, "");

    const p = planOf(grid, ex.meta, ex.exported);
    expect(p.classes.map((c) => [c.name, c.teacherId, c.classroomId, c.slots.length])).toEqual([["초등M 새반", "t-박선생", "r-202", 2]]);
    expect(p.moves.map((m) => [m.enrollmentId, m.to.key])).toEqual([["e2", "new:초등m새반"]]);
    expect([p.adds, p.removes, p.skipped, p.warnings]).toEqual([[], [], [], []]);
  });

  it("이미 있는 반을 다른 강사 열로 옮겨 적으면 쓰지 않고, 무엇이 다른지와 어디서 고치는지 말한다", async () => {
    const ex = await exportToSheet(specs);
    const name = findText(ex.grid, "초등M B")[0]!;
    setText(ex.grid, 2, name.col, "박선생"); // B가 서 있는 열의 강사 머리를 바꾼다
    const p = planOf(ex.grid, ex.meta, ex.exported);
    expect(planSize(p)).toBe(0);
    expect(p.skipped).toEqual([
      {
        what: '"초등M B" 수업 시간·강사가 다릅니다 — 수업목록: 수 2교시(이선생) → 시트: 수 2교시(박선생)',
        why: "이미 있는 반의 요일·교시·강사는 시트로 바꾸지 않습니다(출결 기록이 그 시간에 매여 있습니다) — 수업목록이나 시간표에서 옮겨 주세요.",
      },
    ]);
  });

  it("강의실 글자만 바꿔도 알린다 · 대기 구역으로 옮긴 것도 알린다", async () => {
    const ex = await exportToSheet(specs);
    const room = findText(ex.grid, "본원203")[0]!;
    setText(ex.grid, room.row, room.col, "본원202");
    const parsed = parseMathGrid(ex.grid);
    const cellA = parsed.cells.find((c) => c.classes[0]!.name === "초등M A")!;
    const block = parsed.blocks.find((b) => b.start === cellA.row)!;
    const who = findText(ex.grid, "이두리/5옥산초")[0]!;
    setText(ex.grid, who.row, who.col, "");
    setText(ex.grid, block.end - 5, cellA.col, "1명 - 대기");
    setText(ex.grid, block.end - 4, cellA.col, "이두리/5옥산초");
    const p = planOf(ex.grid, ex.meta, ex.exported);
    expect(planSize(p)).toBe(0);
    expect(p.skipped.map((s) => s.what)).toEqual([
      '이두리/5옥산초 — "초등M A" 재원 → 대기',
      '"초등M B" 강의실을 바꿨습니다 — 본원203 → 본원202',
    ]);
  });
});
