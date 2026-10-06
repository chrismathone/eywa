// 사람이 격자를 고치는 흔한 방식(행·열 끼우기, 손으로 칸 만들기, 칸에 반 덧적기)에서 **없는 '빠짐'을 만들지 않는지**.
// 2026-10-06 적대적 리뷰가 실제로 재현한 입력을 그대로 옮겨 잠갔다 — 원칙: 확실하지 않으면 빠짐을 내지 않고 알린다.
import { describe, expect, it } from "vitest";
import { computeGridDelta } from "./delta";
import { parseMathGrid } from "./parse-cells";
import { parseMeta } from "./parse-meta";
import { exportToSheet, findText, insertColumn, insertRow, setText, student } from "./test-fixture";
import type { MathGridInput } from "./types";

type Slots = [string, string][];
const cls = (id: string, name: string, teacher: string, slots: Slots, names: string[], room = "본원201") => ({
  id, name, teacher, room, slots,
  students: names.map((n, i) => student(`${id}-${i}`, n)),
});
const WHOLE = (day: string, start: "14:30" | "16:20"): Slots => [[day, start], [day, start === "14:30" ? "15:25" : "17:15"]];

// 김선생: X(월 1교시) · 이선생: 토1(토 09시) · 토2(토 10시) · 토긴(일 09~12시, 8명)
const SPECS = [
  cls("x", "초등M X", "김선생", WHOLE("mon", "14:30"), ["엑스하나", "엑스두리"]),
  cls("w1", "중등M 토1", "이선생", [["sat", "09:00"]], ["토하나", "토두리"]),
  cls("w2", "중등M 토2", "이선생", [["sat", "10:00"]], ["토세미", "토네오"]),
  cls("w3", "고등M 일", "이선생", [["sun", "09:00"], ["sun", "10:00"], ["sun", "11:00"]], ["가", "나", "다", "라", "마", "바", "사", "아"].map((c) => `일${c}`)),
];
const KNOWN = SPECS.map((s) => ({ id: s.id, name: s.name }));
const run = (grid: MathGridInput, meta: string[][], known = KNOWN, roomNames?: string[]) =>
  computeGridDelta(parseMathGrid(grid, { roomNames }), parseMeta(meta), known);
const counts = (d: ReturnType<typeof run>) => [d.newClasses.length, d.moves.length, d.adds.length, d.removes.length];

describe("수학 격자 — 손으로 고친 시트", () => {
  it("교시 블록 어디에 행을 끼워도 주말 칸을 잃거나 삼키지 않는다", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const block = parseMathGrid(grid).blocks[0]!;
    for (let off = 3; off <= block.end - block.start; off++) {
      const d = run(insertRow(grid, block.start + off), meta);
      expect([off, ...counts(d), d.warnings]).toEqual([off, 0, 0, 0, 0, []]);
    }
    // 첫 슬롯 반에 행을 끼워 한 명을 더 적으면 그 한 명만 '추가'다(아래 칸 토2가 밀려도 그대로 읽힌다)
    const last = findText(grid, "토하나/5옥산초")[0]!;
    const edited = insertRow(grid, last.row + 1);
    setText(edited, last.row + 1, last.col, "신입생/3옥산초");
    const d = run(edited, meta);
    expect(d.adds.map((a) => [a.student.text, a.to.name])).toEqual([["신입생/3옥산초", "중등M 토1"]]);
    expect([d.newClasses, d.removes]).toEqual([[], []]);
  });

  it("주말 여러 슬롯 칸의 아홉째 줄(슬롯이 바뀌는 줄)에 이름만 적어도 새 반으로 읽지 않는다", async () => {
    const { grid, meta } = await exportToSheet(SPECS);
    const eighth = findText(grid, "일아/5옥산초")[0]!;
    const from = findText(grid, "엑스하나/5옥산초")[0]!;
    setText(grid, from.row, from.col, "");
    setText(grid, eighth.row + 1, eighth.col, "엑스하나");
    const d = run(grid, meta);
    expect(d.moves.map((m) => [m.student.studentId, m.from.name, m.to.name])).toEqual([["x-0", "초등M X", "고등M 일"]]);
    expect([d.newClasses, d.removes]).toEqual([[], []]);
  });

  it("한 반짜리 칸에 반을 덧적어도 원래 학생을 빠짐으로 읽지 않는다", async () => {
    const specs = [cls("d", "중등M D", "이선생", [["mon", "18:20"]], ["디하나", "디두리", "디세미"])];
    const known = [{ id: "d", name: "중등M D" }];
    const exported = await exportToSheet(specs);
    const cell = parseMathGrid(exported.grid).cells[0]!;

    const tagged = structuredClone(exported.grid);
    setText(tagged, cell.row + 1, cell.col, "중등M 뒤반");
    setText(tagged, findText(tagged, "디하나/5옥산초")[0]!.row + 3, cell.col, "[2] 신입생/3옥산초");
    const d = run(tagged, exported.meta, known);
    expect(d.newClasses.map((n) => [n.name, n.slots[0]!.periodIds, n.students.map((s) => s.text)])).toEqual([
      ["중등M 뒤반", ["3-2"], ["신입생/3옥산초"]],
    ]);
    expect(d.removes).toEqual([]);

    // [2] 표시 없이 적으면 어느 반인지 모른다 — 그 칸은 읽지 않고 알리기만 한다
    setText(tagged, findText(tagged, "[2] 신입생/3옥산초")[0]!.row, cell.col, "신입생/3옥산초");
    const untagged = run(tagged, exported.meta, known);
    expect(counts(untagged)).toEqual([0, 0, 0, 0]);
    expect(untagged.warnings.join(" ")).toContain("[1]·[2] 표시가 없어");
  });

  it("손으로 만든 칸: 재원 머리 줄 없이 적거나 이름 바로 아래에 강의실을 적어도 학생을 다 읽는다", async () => {
    const exported = await exportToSheet(SPECS);
    const parsed = parseMathGrid(exported.grid);
    const col = parsed.columns.find((c) => c.teacher === "김선생")!.col + 1;
    const start = parsed.blocks[0]!.start;
    const make = (lines: string[]) => {
      const grid = insertColumn(exported.grid, col);
      setText(grid, 2, col, "박선생");
      setText(grid, 3, col, "월");
      lines.forEach((t, i) => setText(grid, start + i, col, t));
      for (const t of ["엑스하나/5옥산초", "엑스두리/5옥산초"]) {
        const old = findText(grid, t).find((p) => p.col !== col)!;
        setText(grid, old.row, old.col, "");
      }
      return grid;
    };
    // 이름 · (빈 줄) · 강의실 · 학생(재원 머리 줄 자리부터)
    const a = run(make(["초등M 새반", "", "본원202", "엑스하나/5옥산초", "엑스두리/5옥산초"]), exported.meta);
    expect([counts(a), a.newClasses[0]!.slots[0]!.room]).toEqual([[1, 2, 0, 0], "본원202"]);
    // 이름 · 강의실(등록된 이름) · 학생
    const b = run(make(["초등M 새반", "본원202", "엑스하나/5옥산초", "엑스두리/5옥산초"]), exported.meta, KNOWN, ["본원202"]);
    expect([counts(b), b.newClasses.map((n) => n.name), b.newClasses[0]!.slots[0]!.room]).toEqual([[1, 2, 0, 0], ["초등M 새반"], "본원202"]);
  });

  it("못 읽는 칸에 옮겨 적힌 학생은 원래 반에서 빠짐으로 읽지 않는다", async () => {
    const exported = await exportToSheet(SPECS);
    const parsed = parseMathGrid(exported.grid);
    const col = parsed.columns.find((c) => c.teacher === "김선생")!.col + 1;
    const grid = insertColumn(exported.grid, col);
    setText(grid, 2, col, "박선생");
    setText(grid, 3, col, "월");
    const start = parsed.blocks[0]!.start;
    // 이름 아래 줄의 글자가 등록 안 된 강의실 → 둘째 반으로 읽혀 학생에 [1]·[2]가 없다(어느 반인지 모름)
    ["초등M 새반", "별관9", "엑스하나/5옥산초"].forEach((t, i) => setText(grid, start + i, col, t));
    const old = findText(grid, "엑스하나/5옥산초").find((p) => p.col !== col)!;
    setText(grid, old.row, old.col, "");
    const d = run(grid, exported.meta);
    expect(d.removes).toEqual([]);
    expect(d.warnings.join(" ")).toContain("[1]·[2] 표시가 없어");
  });

  it("가로 병합 칸 사이에 요일 없는 열이 끼어도 오른쪽 요일에만 오는 학생을 빠짐으로 읽지 않는다", async () => {
    const specs = [
      {
        ...cls("a", "초등M A", "김선생", [...WHOLE("mon", "14:30"), ...WHOLE("thu", "14:30")], []),
        students: [student("a1", "에이하나"), student("a2", "에이목", { attendanceDays: ["thu"] } as never)],
      },
    ];
    const exported = await exportToSheet(specs);
    const thu = parseMathGrid(exported.grid).columns.find((c) => c.day === "목")!;
    const d = run(insertColumn(exported.grid, thu.col), exported.meta, [{ id: "a", name: "초등M A" }]);
    expect(counts(d)).toEqual([0, 0, 0, 0]);
    expect(d.warnings.join(" ")).toContain("요일 칸을 읽지 못했습니다");
  });

  it("보낸 뒤 앱에서 합반 둘째 반 이름이 바뀌었으면 새 반·추가로 읽지 않는다", async () => {
    const specs = [
      cls("p", "고등M P", "최선생", [["mon", "20:10"]], ["피하나"]),
      cls("q", "고등M Q", "최선생", [["mon", "20:10"]], ["큐하나", "큐두리"]),
    ];
    const { grid, meta } = await exportToSheet(specs);
    const d = run(grid, meta, [{ id: "p", name: "고등M P" }, { id: "q", name: "고등M Q2" }]);
    expect(counts(d)).toEqual([0, 0, 0, 0]);
    expect(d.warnings).toEqual(['합반 칸의 "고등M Q" 반을 수업목록에서 찾지 못했습니다(이름이 바뀌었거나 종강) — 이 반은 읽지 않았습니다.']);
  });

  it("주말 구역에 손으로 적은 반은 한 시간으로 읽고, 구역과 어긋난 요일 열은 읽지 않는다", async () => {
    const exported = await exportToSheet(SPECS);
    const parsed = parseMathGrid(exported.grid);
    const sun = parsed.columns.find((c) => c.day === "일")!;
    const start = parsed.blocks[0]!.start;
    const weekend = insertColumn(exported.grid, sun.col + 1);
    setText(weekend, 2, sun.col + 1, "박선생");
    setText(weekend, 3, sun.col + 1, "일");
    ["고등M 새일반", "", "본원604", "", "신입생/3옥산초"].forEach((t, i) => setText(weekend, start + i, sun.col + 1, t));
    expect(run(weekend, exported.meta).newClasses.map((n) => [n.name, n.slots[0]!.periodIds, n.slots[0]!.weekend])).toEqual([
      ["고등M 새일반", ["1-1"], true],
    ]);

    const mon = parsed.columns.find((c) => c.day === "월")!;
    const wrong = insertColumn(exported.grid, mon.col + 1);
    setText(wrong, 2, mon.col + 1, "박선생");
    setText(wrong, 3, mon.col + 1, "토");
    setText(wrong, start, mon.col + 1, "초등M 토반");
    const d = run(wrong, exported.meta);
    expect(counts(d)).toEqual([0, 0, 0, 0]);
    expect(d.warnings.join(" ")).toContain("주말 요일이 평일 구역에");
  });
});
