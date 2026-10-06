// 조용히 틀리는 입력 — 손대지 않았는데 '빠짐'·'새 반'이 생기거나, 적은 학생이 경고 없이 버려지는 경우.
// 2026-10-06 수리분 재리뷰가 재현한 것들이다(수리가 새로 연 구멍). 전부 "읽은 것은 다 읽고, 못 읽으면 알린다"를 잠근다.
import { describe, expect, it } from "vitest";
import { computeGridDelta } from "./delta";
import { studentNameOf } from "./grid-text";
import { parseMathGrid } from "./parse-cells";
import { parseMeta } from "./parse-meta";
import { exportToSheet, findText, insertColumn, setText, student } from "./test-fixture";
import type { MathGridInput } from "./types";

type Slots = [string, string][];
const cls = (id: string, name: string, teacher: string, slots: Slots, count: number, room = "본원201") => ({
  id, name, teacher, room, slots,
  students: Array.from({ length: count }, (_, i) => student(`${id}${i}`, `${name.slice(-1)}학생${i}`)),
});
const SAT3: Slots = [["sat", "09:00"], ["sat", "10:00"], ["sat", "11:00"]];
const MON: Slots = [["mon", "14:30"], ["mon", "15:25"]];

/** 서버 액션과 같은 방식 — 기록 속 학생 글자를 파서에 넘긴다. */
function run(grid: MathGridInput, metaRows: string[][], known: { id: string; name: string }[]) {
  const meta = parseMeta(metaRows);
  const studentTexts = meta.cells.flatMap((c) => c.students.flatMap((s) => [s.text, studentNameOf(s.text)]));
  return computeGridDelta(parseMathGrid(grid, { studentTexts }), meta, known);
}
const counts = (d: ReturnType<typeof run>) => [d.newClasses.length, d.moves.length, d.adds.length, d.removes.length];
const knownOf = (specs: { id: string; name: string }[]) => specs.map((s) => ({ id: s.id, name: s.name }));

describe("수학 격자 — 조용히 틀리는 입력", () => {
  it("강의실 이름이 숫자뿐이어도 주말 반 학생을 빠짐으로 읽지 않는다(강의실 줄을 인원 줄로 읽지 않는다)", async () => {
    const specs = [cls("w", "고등M 토", "이선생", SAT3, 4, "603"), cls("x", "초등M X", "김선생", MON, 1)];
    const { grid, meta } = await exportToSheet(specs);
    const sat = parseMathGrid(grid).cells.find((c) => c.weekend)!;
    expect([sat.room, sat.students.length, sat.classes[0]!.periodIds]).toEqual(["603", 4, ["1-1", "1-2", "2-1"]]);
    expect([counts(run(grid, meta, knownOf(specs))), run(grid, meta, knownOf(specs)).warnings]).toEqual([[0, 0, 0, 0], []]);
  });

  it("인원 줄이 없는 주말 칸도 적힌 학생을 끝까지 읽는다(12행에서 자르지 않는다)", async () => {
    const specs = [cls("w", "고등M 토", "이선생", SAT3, 10), cls("x", "초등M X", "김선생", MON, 1)];
    const { grid, meta } = await exportToSheet(specs);
    const sat = parseMathGrid(grid).cells.find((c) => c.weekend)!;
    setText(grid, sat.row + 35, sat.col, ""); // 3슬롯 칸의 맨 아래 인원 숫자를 지운다
    const after = parseMathGrid(grid).cells.find((c) => c.weekend)!;
    expect(after.students).toHaveLength(10);
    expect(counts(run(grid, meta, knownOf(specs)))).toEqual([0, 0, 0, 0]);
  });

  it("주말 새 열에 손으로 만든 반으로 12줄 넘게 옮겨도 전원 이동으로 읽는다", async () => {
    const specs = [cls("w", "고등M 토", "이선생", SAT3, 10), cls("x", "초등M X", "김선생", MON, 1)];
    const exported = await exportToSheet(specs);
    const sat = parseMathGrid(exported.grid).cells.find((c) => c.weekend)!;
    const col = sat.col + 1;
    const grid = insertColumn(exported.grid, col);
    setText(grid, 2, col, "박선생");
    setText(grid, 3, col, "토");
    setText(grid, sat.row, col, "고등M 토새반");
    setText(grid, sat.row + 2, col, "본원604");
    specs[0]!.students.forEach((s, i) => {
      const text = `${s.name}/5옥산초`;
      const old = findText(grid, text)[0]!;
      setText(grid, old.row, old.col, "");
      setText(grid, sat.row + 4 + i, col, text);
    });
    const d = run(grid, exported.meta, knownOf(specs));
    expect([counts(d), d.newClasses[0]!.students.length]).toEqual([[1, 10, 0, 0], 10]);
  });

  it("빗금을 띄어 쓴 학생('이름 / 학교')도 같은 학생으로 읽는다", async () => {
    const specs = [cls("a", "초등M A", "김선생", MON, 2), cls("b", "초등M B", "이선생", MON, 1)];
    const { grid, meta } = await exportToSheet(specs);
    const from = findText(grid, "A학생0/5옥산초")[0]!;
    setText(grid, from.row, from.col, "");
    const to = findText(grid, "B학생0/5옥산초")[0]!;
    setText(grid, to.row + 1, to.col, "A학생0 / 5옥산초");
    const d = run(grid, meta, knownOf(specs));
    expect(d.moves.map((m) => [m.student.studentId, m.to.name])).toEqual([["a0", "초등M B"]]);
    expect(d.removes).toEqual([]);
  });

  it("읽지 않기로 한 칸에 [2]를 달아 옮긴 학생도 원래 반에서 빠짐으로 세지 않는다", async () => {
    const specs = [cls("d", "중등M D", "이선생", [["mon", "18:20"]], 2), cls("x", "초등M X", "김선생", MON, 1)];
    const { grid, meta } = await exportToSheet(specs);
    const cell = parseMathGrid(grid).cells.find((c) => c.classes[0]!.name === "중등M D")!;
    setText(grid, cell.row + 1, cell.col, "중등M 뒤반");
    const last = findText(grid, "D학생1/5옥산초")[0]!;
    const moved = findText(grid, "X학생0/5옥산초")[0]!;
    setText(grid, moved.row, moved.col, "");
    setText(grid, last.row + 1, last.col, "[2] X학생0/5옥산초");
    setText(grid, last.row + 2, last.col, "신입생/3옥산초"); // 접두 없는 새 학생 — 이 칸은 못 읽는다
    const d = run(grid, meta, knownOf(specs));
    expect(counts(d)).toEqual([0, 0, 0, 0]);
    expect(d.warnings.join(" ")).toContain("[1]·[2] 표시가 없어");
  });

  it("강의실 줄 없이 이름만 적은 학생을 강의실로 삼키지 않는다", async () => {
    const specs = [cls("a", "초등M A", "김선생", MON, 2)];
    const exported = await exportToSheet(specs);
    const parsed = parseMathGrid(exported.grid);
    const col = parsed.columns[0]!.col + 1;
    const grid = insertColumn(exported.grid, col);
    setText(grid, 2, col, "박선생");
    setText(grid, 3, col, "월");
    const start = parsed.blocks[0]!.start;
    ["초등M 새반", "", "A학생0", "A학생1"].forEach((t, i) => setText(grid, start + i, col, t));
    for (const t of ["A학생0/5옥산초", "A학생1/5옥산초"]) {
      const old = findText(grid, t)[0]!;
      setText(grid, old.row, old.col, "");
    }
    const d = run(grid, exported.meta, knownOf(specs));
    expect([counts(d), d.newClasses[0]!.slots[0]!.room]).toEqual([[1, 2, 0, 0], ""]);
  });

  it("손대지 않은 시트: 빈 주말 슬롯에 남은 학생 글자·학생 없는 합반 둘째 반이 거짓 변경을 만들지 않는다", async () => {
    const specs = [
      cls("w", "고등M 토", "이선생", [["sat", "09:00"]], 2),
      cls("p", "고등M P", "최선생", [["mon", "20:10"]], 1),
      cls("q", "고등M Q", "최선생", [["mon", "20:10"]], 0),
    ];
    const { grid, meta } = await exportToSheet(specs);
    // 익스포터가 1시간 칸에 대기·퇴원 줄을 넘치게 그리면 다음 빈 슬롯(12행 병합)의 첫 칸에 학생 글자가 남는다
    const sat = parseMathGrid(grid).cells.find((c) => c.weekend)!;
    setText(grid, sat.row + 12, sat.col, "퇴원생/5옥산초");
    const d = run(grid, meta, knownOf(specs));
    expect([counts(d), d.ignored, d.notes, d.warnings]).toEqual([[0, 0, 0, 0], [], [], []]);
  });
});
