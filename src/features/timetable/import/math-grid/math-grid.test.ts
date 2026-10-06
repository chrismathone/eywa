import { describe, expect, it } from "vitest";
import { computeGridDelta, type KnownClass } from "./delta";
import { parseMathGrid } from "./parse-cells";
import { parseMeta } from "./parse-meta";
import { exportToSheet, findText, insertColumn, setText, student } from "./test-fixture";
import type { MathGridInput } from "./types";

// 김선생: A(월·목 2교시) · B(수 2교시) · H(월·목 1교시 + 수 1교시)
// 이선생: C(수 2교시) · D(월·목 3교시 앞) + E(월·목 3교시 뒤) · F(토 09~12시)
// 박선생: G(화·금 1교시) — 수요일 열이 없다(원장이 열을 끼워 넣는 상황의 재료)
const SPECS = [
  {
    id: "c-a", name: "초등M A", teacher: "김선생", room: "본원201",
    slots: [["mon", "16:20"], ["mon", "17:15"], ["thu", "16:20"], ["thu", "17:15"]] as [string, string][],
    students: [
      student("s1", "김하나"),
      student("s2", "이두리", { attendanceDays: ["mon"] } as never),
      student("s3", "박세미", { status: "hold" }),
    ],
  },
  {
    id: "c-b", name: "초등M B", teacher: "김선생", room: "본원201",
    slots: [["wed", "16:20"], ["wed", "17:15"]] as [string, string][],
    students: [student("s4", "최네오"), student("s5", "정다섯")],
  },
  {
    id: "c-c", name: "중등M C", teacher: "이선생", room: "본원203",
    slots: [["wed", "16:20"], ["wed", "17:15"]] as [string, string][],
    students: [student("s6", "강여섯"), student("s7", "조일곱")],
  },
  {
    id: "c-d", name: "중등M D", teacher: "이선생", room: "본원203",
    slots: [["mon", "18:20"], ["thu", "18:20"]] as [string, string][],
    students: [student("s8", "윤여덟")],
  },
  {
    id: "c-e", name: "중등M E", teacher: "이선생", room: "본원204",
    slots: [["mon", "19:15"], ["thu", "19:15"]] as [string, string][],
    students: [student("s9", "장아홉")],
  },
  {
    id: "c-f", name: "고등M 토", teacher: "이선생", room: "본원603",
    slots: [["sat", "09:00"], ["sat", "10:00"], ["sat", "11:00"]] as [string, string][],
    students: [student("s10", "임열"), student("s11", "한퇴원", { status: "withdrawn", endDate: "2026-06-20" })],
  },
  {
    id: "c-g", name: "초등M G", teacher: "박선생", room: "본원202",
    slots: [["tue", "14:30"], ["tue", "15:25"], ["fri", "14:30"], ["fri", "15:25"]] as [string, string][],
    students: [student("s12", "오열둘")],
  },
  {
    id: "c-h", name: "초등M H", teacher: "김선생", room: "본원201",
    slots: [["mon", "14:30"], ["mon", "15:25"], ["thu", "14:30"], ["thu", "15:25"], ["wed", "14:30"], ["wed", "15:25"]] as [string, string][],
    students: [student("s13", "서열셋")],
  },
];
const CLASSES: KnownClass[] = SPECS.map((s) => ({ id: s.id, name: s.name }));

const deltaOf = (grid: MathGridInput, meta: string[][]) =>
  computeGridDelta(parseMathGrid(grid), parseMeta(meta), CLASSES);

describe("수학 격자 되읽기", () => {
  it("내보낸 그대로 되읽으면 반·요일·교시·학생이 그대로 나온다", async () => {
    const { grid } = await exportToSheet(SPECS);
    const parsed = parseMathGrid(grid);
    const cell = (name: string) => parsed.cells.filter((c) => c.classes.some((k) => k.name === name));

    const [a] = cell("초등M A");
    expect(a).toMatchObject({ teacher: "김선생", days: ["월", "목"], room: "본원201", weekend: false });
    expect(a!.classes).toEqual([{ name: "초등M A", periodIds: ["2-1", "2-2"] }]);
    const roster = Object.fromEntries(a!.students.map((s) => [s.text, [s.section, s.days.join("")]]));
    expect(roster).toEqual({
      "김하나/5옥산초": ["active", "월목"],
      "이두리/5옥산초": ["active", "월"], // 분리등원 — 월요일 열에만 적힌다
      "박세미/5옥산초": ["hold", "월목"],
    });

    // 한 교시를 앞·뒤로 나눠 쓰는 칸 = 한 칸에 반 둘, 학생은 [1]·[2]로 갈린다
    const [split] = cell("중등M D");
    expect(split!.classes).toEqual([
      { name: "중등M D", periodIds: ["3-1"] },
      { name: "중등M E", periodIds: ["3-2"] },
    ]);
    expect(split!.students.map((s) => [s.classIdx, s.text])).toEqual([[1, "윤여덟/5옥산초"], [2, "장아홉/5옥산초"]]);

    // 주말은 1시간 슬롯을 세로로 잇는다(09~12시 = 3슬롯). 퇴원 구역은 명단에서 구분된다
    const [sat] = cell("고등M 토");
    expect(sat).toMatchObject({ teacher: "이선생", days: ["토"], weekend: true });
    expect(sat!.classes[0]!.periodIds).toEqual(["1-1", "1-2", "2-1"]);
    expect(sat!.students.map((s) => [s.text, s.section])).toEqual([["임열/5옥산초", "active"], ["한퇴원/5옥산초", "withdrawn"]]);

    expect(cell("초등M H")).toHaveLength(2); // 월·목 칸 + 수 칸
    expect(parsed.warnings).toEqual([]);
  });

  it("손대지 않은 시트는 변경이 0건이다(거짓 이동·빠짐 없음)", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const d = deltaOf(grid, meta);
    expect([d.newClasses, d.placedClasses, d.moves, d.adds, d.removes, d.notes, d.warnings]).toEqual([[], [], [], [], [], [], []]);
    expect(d.stats.classCells).toBe(8);
  });

  it("열을 끼워 새 반을 만들고 학생을 옮기면 새 반 + 이동으로 읽는다(자리 번호가 밀려도)", async () => {
    const exported = await exportToSheet(SPECS);
    const before = parseMathGrid(exported.grid);
    const target = before.columns.find((c) => c.teacher === "이선생" && c.day === "수")!;
    const block = before.blocks.find((b) => b.gid === 2)!;

    const grid = insertColumn(exported.grid, target.col); // 이선생 수요일 열의 왼쪽에 박선생 열을 끼운다
    const col = target.col;
    setText(grid, 2, col, "박선생");
    setText(grid, 3, col, "수\n6/24");
    setText(grid, block.start, col, "초등M 새반");
    setText(grid, block.start + 2, col, "본원202");
    setText(grid, block.start + 3, col, "3명 - 재원생");
    ["최네오/5옥산초", "강여섯/5옥산초", "신입생/3옥산초"].forEach((t, i) => setText(grid, block.start + 4 + i, col, t));
    // 원래 칸에서는 지운다(잘라 붙이기) — 끼운 열 때문에 강여섯은 한 칸 오른쪽에 있다
    for (const t of ["최네오/5옥산초", "강여섯/5옥산초"]) {
      const old = findText(grid, t).find((p) => p.col !== col)!;
      setText(grid, old.row, old.col, "");
    }

    const d = deltaOf(grid, exported.meta);
    expect(d.newClasses).toEqual([
      {
        name: "초등M 새반",
        slots: [{ teacher: "박선생", days: ["수"], periodIds: ["2-1", "2-2"], weekend: false, room: "본원202" }],
        students: [
          { studentId: "s4", text: "최네오/5옥산초" },
          { studentId: "s6", text: "강여섯/5옥산초" },
          { studentId: null, text: "신입생/3옥산초" },
        ],
      },
    ]);
    expect(d.moves.map((m) => [m.student.studentId, m.from.name, m.to.name, m.to.classId])).toEqual([
      ["s4", "초등M B", "초등M 새반", null],
      ["s6", "중등M C", "초등M 새반", null],
    ]);
    expect(d.adds).toEqual([{ student: { studentId: null, text: "신입생/3옥산초" }, to: { classId: null, name: "초등M 새반" } }]);
    expect([d.removes, d.warnings]).toEqual([[], []]);
    // 손으로 적은 이름은 병합 없이 윗줄에만 놓인다 — 새 반이면 교시 전체로 읽고 그렇게 읽었다고 알린다
    expect(d.notes).toEqual(['"초등M 새반" — 반 이름이 한 줄에만 적혀 있어 교시 전체로 읽었습니다.']);
  });

  it("학교·학년 없이 이름만 적어도 시트에 한 명뿐이면 그 학생의 이동으로 읽는다", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const from = findText(grid, "조일곱/5옥산초")[0]!;
    setText(grid, from.row, from.col, "");
    const to = findText(grid, "정다섯/5옥산초")[0]!;
    setText(grid, to.row + 2, to.col, "조일곱"); // 정다섯·최네오 아래 빈 줄
    const d = deltaOf(grid, meta);
    expect(d.moves.map((m) => [m.student.studentId, m.from.name, m.to.name])).toEqual([["s7", "중등M C", "초등M B"]]);
    expect([d.adds, d.removes]).toEqual([[], []]);
  });

  it("같은 반에서 학교·학년 글자만 고친 것은 빠짐·추가로 세지 않는다", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const at = findText(grid, "조일곱/5옥산초")[0]!;
    setText(grid, at.row, at.col, "조일곱/6옥산초");
    const d = deltaOf(grid, meta);
    expect([d.moves, d.adds, d.removes]).toEqual([[], [], []]);
    expect(d.notes.join(" ")).toContain("글자만 바뀐 것으로 보고");
  });

  it("학생을 지우기만 하면 '빠짐', 기존 반에 적으면 '추가'", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const gone = findText(grid, "조일곱/5옥산초")[0]!;
    setText(grid, gone.row, gone.col, "오열둘/5옥산초"); // 그 자리에 다른 반 학생을 적는다(오열둘은 G에도 그대로)
    const d = deltaOf(grid, meta);
    expect(d.removes.map((r) => [r.student.studentId, r.from.name])).toEqual([["s7", "중등M C"]]);
    expect(d.adds.map((a) => [a.student.studentId, a.to.classId])).toEqual([["s12", "c-c"]]);
    expect(d.moves).toEqual([]);
  });

  it("반 칸을 통째로 지우거나 이름을 바꾸면 그 반 학생을 '빠짐'으로 읽지 않는다", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const name = findText(grid, "초등M B")[0]!;
    setText(grid, name.row, name.col, "초등M B2");
    const d = deltaOf(grid, meta);
    expect(d.removes).toEqual([]);
    expect(d.newClasses.map((n) => n.name)).toEqual(["초등M B2"]);
    expect(d.warnings.join("\n")).toContain('"초등M B" 반이 격자에서 보이지 않습니다');
  });

  it("같은 반의 한 칸에서만 지운 것은 빠짐이 아니라 참고로 알린다", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const cells = findText(grid, "서열셋/5옥산초");
    expect(cells).toHaveLength(2);
    setText(grid, cells[1]!.row, cells[1]!.col, "");
    const d = deltaOf(grid, meta);
    expect(d.removes).toEqual([]);
    expect(d.notes.join("\n")).toContain("일부 칸에서만 빠졌습니다");
  });

  it("재원 14줄이 꽉 찬 반에 한 명을 더 적으면(비어 있던 대기 머리 행) 그 학생도 읽는다", async () => {
    const full = {
      id: "c-full", name: "초등M 꽉찬", teacher: "최선생", room: "본원205",
      slots: [["tue", "14:30"], ["tue", "15:25"], ["fri", "14:30"], ["fri", "15:25"]] as [string, string][],
      students: Array.from({ length: 14 }, (_, i) => student(`f${i}`, `학생${String(i).padStart(2, "0")}`)),
    };
    const { grid, meta } = await exportToSheet([full]);
    const parsed = parseMathGrid(grid);
    const cell = parsed.cells[0]!;
    const block = parsed.blocks.find((b) => b.start === cell.row)!;
    expect(cell.students).toHaveLength(14);
    setText(grid, block.end - 5, cell.col, "신입생/3옥산초");
    const d = computeGridDelta(parseMathGrid(grid), parseMeta(meta), [{ id: "c-full", name: "초등M 꽉찬" }]);
    expect(d.adds).toEqual([{ student: { studentId: null, text: "신입생/3옥산초" }, to: { classId: "c-full", name: "초등M 꽉찬" } }]);
    expect(d.removes).toEqual([]);
  });

  it("같은 반이 짝이 다른 합반 칸 둘에 서도 학생을 엉뚱한 반으로 읽지 않는다", async () => {
    // P는 월요일엔 Q와, 수요일엔 R과 같은 시간·같은 강사 — 기록에는 두 칸 모두 대표 반(P)만 남는다
    const slot = (day: string): [string, string][] => [[day, "20:10"]];
    const specs = [
      { id: "c-p", name: "고등M P", teacher: "최선생", room: "본원601", slots: [...slot("mon"), ...slot("wed")], students: [student("p1", "피하나")] },
      { id: "c-q", name: "고등M Q", teacher: "최선생", room: "본원601", slots: slot("mon"), students: [student("q1", "큐하나")] },
      { id: "c-r", name: "고등M R", teacher: "최선생", room: "본원601", slots: slot("wed"), students: [student("r1", "알하나")] },
    ];
    const { grid, meta } = await exportToSheet(specs);
    const parsed = parseMathGrid(grid);
    // 앞 시간(20:10)에만 있는 반 — 이름이 윗줄에만 적히고 교시는 4-1 하나다
    expect(parsed.cells.map((c) => c.classes.map((k) => `${k.name}:${k.periodIds.join(",")}`).join(" + "))).toEqual([
      "고등M P:4-1 + 고등M Q:4-1",
      "고등M P:4-1 + 고등M R:4-1",
    ]);
    const known = specs.map((x) => ({ id: x.id, name: x.name }));
    const d = computeGridDelta(parsed, parseMeta(meta), known);
    expect([d.newClasses, d.moves, d.adds, d.removes, d.warnings]).toEqual([[], [], [], [], []]);

    const r1 = findText(grid, "[2] 알하나/5옥산초")[0]!;
    setText(grid, r1.row, r1.col, "");
    const after = computeGridDelta(parseMathGrid(grid), parseMeta(meta), known);
    expect(after.removes.map((x) => [x.student.studentId, x.from.name])).toEqual([["r1", "고등M R"]]);
  });

  it("머리 행이 망가졌으면 읽지 않고 이유를 말한다", async () => {
    const { grid } = await exportToSheet(SPECS);
    setText(grid, 2, 0, "");
    expect(() => parseMathGrid(grid)).toThrow("머리 행을 찾지 못했습니다");
  });
});
