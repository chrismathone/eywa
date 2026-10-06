import { describe, expect, it } from "vitest";
import type { PlannedLine } from "@/features/textbooks/plan-expand";
import { planHoverOf } from "./plan-hover";

const line = (lessonNo: number, title = "Vocab Up", progress: string | null = null): PlannedLine => ({
  lessonNo,
  date: "2026-10-02",
  slotStart: "20:20",
  skillArea: "vocab",
  title,
  pageTime: null,
  progress,
  homework: null,
  termMode: "regular",
});
const lbl = (n: number) => `${n}차수`;

describe("planHoverOf — 지금 일정 ⇔ 원래 계획", () => {
  it("미룸·당김이 없으면 같다고 한 줄", () => {
    expect(planHoverOf([line(3)], [line(3)], lbl)).toEqual({ kind: "same", plan: "Vocab Up 3차수" });
  });
  it("당김이면 지금은 다음 차수", () => {
    expect(planHoverOf([line(3)], [line(4, "Vocab Up", "p.20")], lbl)).toEqual({
      kind: "diff",
      now: "Vocab Up 4차수 p.20",
      base: "Vocab Up 3차수",
    });
  });
  it("미룸으로 이 칸이 비면 지금은 빈 글(화면이 '없음'으로 적는다)", () => {
    expect(planHoverOf([line(3)], [], lbl)).toEqual({ kind: "diff", now: "", base: "Vocab Up 3차수" });
  });
  it("영역이 여럿이면 ` · `로 잇는다", () => {
    expect(planHoverOf([line(3), line(5, "Grammar")], [line(3), line(5, "Grammar")], lbl)).toEqual({
      kind: "same",
      plan: "Vocab Up 3차수 · Grammar 5차수",
    });
  });
  it("둘 다 없거나, 서버가 일정을 안 실었으면 툴팁 없음", () => {
    expect(planHoverOf([], [], lbl)).toBeNull();
    expect(planHoverOf([line(3)], undefined, lbl)).toBeNull();
  });
});
