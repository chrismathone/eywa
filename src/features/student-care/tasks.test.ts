import { describe, expect, it } from "vitest";
import type { StaffTaskItem, StaffTaskList } from "@/features/staff-tasks/kinds";
import { mergeCareTasks } from "./tasks";
const task = (id: string, dueAt: string | null): StaffTaskItem => ({
  id, dueAt, kind: "followup_due", title: "", detail: null, link: null, status: "open",
  openedAt: "2026-10-20T00:00:00Z", closedAt: dueAt, closedBy: null, closeReason: null, assignees: [],
});
const list = (items: StaffTaskItem[], total = items.length): StaffTaskList => ({ items, total, page: 0, pageSize: 30 });
describe("학생 업무 합치기", () => {
  it("기한 순·동률 id 순, 기한 없음은 마지막이며 전체 수는 DB 집계다", () => {
    const result = mergeCareTasks([list([task("z", null), task("b", "2026-10-20T00:00:00Z")], 20),
      list([task("a", "2026-10-20T09:00:00+09:00"), task("c", "2026-10-19T00:00:00Z")], 10)], "open");
    expect(result.items.map((r) => r.id)).toEqual(["c", "a", "b", "z"]);
    expect(result.total).toBe(30);
  });
  it("종료 이력은 종료 시각 최신 순이다", () => {
    expect(mergeCareTasks([list([task("a", null), task("b", "2026-10-20T00:00:00Z"),
      task("c", "2026-10-19T00:00:00Z")])], "closed").items.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });
  it("여러 종류의 업무도 첫 30건만 노출하고 실제 전체 수를 유지한다", () => {
    const items = Array.from({ length: 60 }, (_, i) => task(String(i).padStart(2, "0"), null));
    const result = mergeCareTasks([list(items.slice(30), 1050), list(items.slice(0, 30), 500)], "open");
    expect(result.items.map((r) => r.id)).toEqual(items.slice(0, 30).map((r) => r.id));
    expect(result.total).toBe(1550);
  });
});
