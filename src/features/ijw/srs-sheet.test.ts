import { describe, expect, it } from "vitest";
import type { IjwExamResult } from "./contract";
import { IJW_SHAPES } from "./contract";
import { srsSheetDataOf } from "./srs-sheet";

const base: IjwExamResult = {
  attemptId: "cmul1vjll0001uv6scgkytjw0",
  student: { id: "ijwgsy", name: "ijwgsy", className: "중고E_중1 의치대" },
  deck: { id: "d", name: "[보카킹] 26년 9월", examType: "regular" },
  submittedAt: "2026-09-17T08:17:37.000Z",
  elapsedMs: 1800000,
  total: 3,
  correct: 2,
  score: 67,
  classAvg: 80,
  overallAvg: 61,
  classCount: 6,
  overallCount: 88,
  rank: { overall: { rank: 12, of: 88 }, class: { rank: 2, of: 6 } },
  byPos: [],
  wrong: [],
};

const items = [
  { no: 1, prompt: "[명] 사과", answer: "apple", typed: "apple", correct: true, choice: true, answered: true, ms: 3000 },
  { no: 2, prompt: "[명] 지하실", answer: "basement", typed: "basment", correct: false, choice: false, answered: true },
  { prompt: "[동] 돕다", answer: "aid", typed: "", correct: false, choice: false, answered: false },
];

describe("srsSheetDataOf — 인재원 결과지에 넘길 데이터", () => {
  it("문항 목록이 없으면 null(aywa 결과지로 그린다)", () => {
    expect(srsSheetDataOf(base, "학원이")).toBeNull();
    expect(srsSheetDataOf({ ...base, items: [] }, "학원이")).toBeNull();
  });
  it("인재원 관리자 결과지와 같은 모양 · 이름은 aywa 이름", () => {
    const d = srsSheetDataOf({ ...base, items }, "추윤서")!;
    expect(d.studentName).toBe("추윤서");
    expect(d.userId).toBe("ijwgsy");
    expect(d.rank).toEqual({ rank: 12, total: 88, classRank: 2, classTotal: 6 });
    expect([d.allAvg, d.allCount, d.classAvg, d.classCount, d.pct]).toEqual([61, 88, 80, 6, 67]);
    expect(d.items.map((x) => x.no)).toEqual([1, 2, 3]); // 번호 없는 문항은 순서로
    expect(d.items[2]).toEqual({ no: 3, prompt: "[동] 돕다", answer: "aid", typed: "", correct: false, choice: false, answered: false });
  });
  it("전체 등수가 없으면(테스트 계정) 등수 칸 없음", () => {
    expect(srsSheetDataOf({ ...base, items, rank: { overall: null, class: null } }, "학원이")!.rank).toBeNull();
  });
  it("이름이 비면 인재원 이름으로", () => {
    expect(srsSheetDataOf({ ...base, items }, " ")!.studentName).toBe("ijwgsy");
  });
});

describe("계약 — items", () => {
  const raw = { v: 1, ...base, items };
  it("받는다", () => {
    expect(IJW_SHAPES.examResult.parse(raw).items).toHaveLength(3);
  });
  it("한 문항이라도 모양이 어긋나면 목록 전체를 버리고 결과지는 산다", () => {
    const bad = IJW_SHAPES.examResult.parse({ ...raw, items: [...items, { prompt: "x" }] });
    expect(bad.items).toBeUndefined();
    expect(bad.total).toBe(3);
  });
});
