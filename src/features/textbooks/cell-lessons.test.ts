import { describe, expect, it } from "vitest";
import { planCellExtras, type CellBookLine } from "./cell-lessons";

const line = (id: string, progress: string | null, homework: string | null = null, extra: Partial<CellBookLine> = {}): CellBookLine => ({
  id,
  textbook: "SKY",
  pageRange: "25분",
  progress,
  homework,
  ...extra,
});
const A = { progress: "Unit 1", homework: "WB 1" };
const B = { progress: "Unit 2", homework: "WB 2" };

describe("planCellExtras — 한 칸 둘째 차수부터", () => {
  it("차수 하나면 할 일 없음", () => {
    expect(planCellExtras({ lessons: [A], lines: [line("1", "Unit 1")], title: "SKY", pageTime: "25분" })).toEqual({ updates: [], creates: [] });
  });

  it("🔴 첫 줄만 있으면 둘째 차수를 새 줄로(차시마다 한 줄)", () => {
    const out = planCellExtras({ lessons: [A, B], lines: [line("1", "Unit 1", "WB 1")], title: "SKY", pageTime: "25분" });
    expect(out).toEqual({ updates: [], creates: [B] });
  });

  it("이미 두 줄이면 다시 눌러도 줄이 안 는다(빈 칸만 채움)", () => {
    const out = planCellExtras({
      lessons: [A, B],
      lines: [line("1", "Unit 1", "WB 1"), line("2", "Unit 2", null)],
      title: "SKY",
      pageTime: "25분",
    });
    expect(out).toEqual({ updates: [{ id: "2", patch: { homework: "WB 2" } }], creates: [] });
  });

  it("🔴 1차수 줄을 지운 칸을 다시 가져와도 2차수가 두 벌이 되지 않는다(1차수만 새로)", () => {
    const out = planCellExtras({ lessons: [A, B], lines: [line("2", "Unit 2", "WB 2")], title: "SKY", pageTime: "25분" });
    expect(out).toEqual({ updates: [], creates: [A] });
  });

  it("고쳐 쓴 둘째 줄은 덮지 않는다", () => {
    const out = planCellExtras({
      lessons: [A, B],
      lines: [line("1", "Unit 1", "WB 1"), line("2", "Unit 2 절반만", "WB 2")],
      title: "SKY",
      pageTime: "25분",
    });
    expect(out).toEqual({ updates: [], creates: [] });
  });

  it("🔑 옛 `A / B` 한 줄은 나눈다 — 첫 줄을 첫 차수로, 나머지는 새 줄", () => {
    const out = planCellExtras({ lessons: [A, B], lines: [line("1", "Unit 1 / Unit 2", "WB 1 / WB 2")], title: "SKY", pageTime: "25분" });
    expect(out).toEqual({ updates: [{ id: "1", patch: { progress: "Unit 1", homework: "WB 1" } }], creates: [B] });
  });

  it("옛 이은 줄이라도 사람이 고쳤으면 나누지 않는다(둘째 줄만 새로)", () => {
    const out = planCellExtras({ lessons: [A, B], lines: [line("1", "Unit 1 / Unit 2 복습", "WB 1 / WB 2")], title: "SKY", pageTime: "25분" });
    expect(out).toEqual({ updates: [], creates: [B] });
  });

  it("차수 문구가 같은 교재(`10개`)는 나누지 않고 둘째 줄만 만든다", () => {
    const same = { progress: "10개", homework: null };
    const out = planCellExtras({ lessons: [same, same], lines: [line("1", "10개")], title: "SKY", pageTime: "25분" });
    expect(out).toEqual({ updates: [], creates: [same] });
  });

  it("빈 둘째 줄이면 교재명·시간까지 채운다", () => {
    const out = planCellExtras({
      lessons: [A, B],
      lines: [line("1", "Unit 1", "WB 1"), line("2", null, null, { textbook: null, pageRange: null })],
      title: "SKY",
      pageTime: "25분",
    });
    expect(out.updates).toEqual([{ id: "2", patch: { textbook: "SKY", page_range: "25분", progress: "Unit 2", homework: "WB 2" } }]);
  });
});
