import { describe, expect, it } from "vitest";
import { liveTeacherClassIds } from "./scope";

function client(failed?: string, count = 1) {
  return { from: (table: string) => {
    let start = 0; let end = 999;
    const q = {
      select: () => q, eq: () => q, is: () => q, lte: () => q, gte: () => q, or: () => q, order: () => q,
      limit: () => q, range: (a: number, b: number) => { start = a; end = b; return q; },
      then: (resolve: (x: unknown) => unknown) => {
        const rows = table === "class_schedules" ? Array.from({length:count},(_,i)=>({class_id:`c${i}`})) : [];
        return Promise.resolve({ data: failed === table ? null : rows.slice(start,end+1), error: failed === table ? {message:`${table} failed`} : null }).then(resolve);
      },
    }; return q;
  } } as unknown as Parameters<typeof liveTeacherClassIds>[0];
}
describe("출결 강사 범위 조회의 실패와 페이지", () => {
  it.each(["class_schedules", "classes", "class_delegations"])("%s 실패를 휴원일 0명으로 바꾸지 않는다", async (table) => {
    await expect(liveTeacherClassIds(client(table), "teacher", "2026-10-03")).rejects.toBeDefined();
  });
  it("교시 배치가 1000행을 넘어도 담당 반을 빠뜨리지 않는다", async () => {
    const ids = await liveTeacherClassIds(client(undefined, 1001), "teacher", "2026-10-03");
    expect(ids).toHaveLength(1001);
    expect(ids).toContain("c1000");
  });
});
