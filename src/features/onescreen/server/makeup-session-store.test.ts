import { describe, expect, it, vi } from "vitest";
import { changeMakeupSession } from "./makeup-session-store";
import { addMakeupSessionEntries } from "../makeup-session";

const scope = { tenantId: "tenant", teacherId: "teacher", studentId: "student", date: "2026-09-12" };
function database(replies: unknown[]) {
  const writes: Record<string, unknown>[] = [];
  const predicates: unknown[][] = [];
  const from = vi.fn(() => {
    const reply = replies.shift();
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { predicates.push(args); return query; },
      maybeSingle: async () => reply,
      update: (input: Record<string, unknown>) => { writes.push(input); return query; },
      insert: async (input: Record<string, unknown>) => { writes.push(input); return reply; },
    };
    return query;
  });
  return { db: { from } as unknown as Parameters<typeof changeMakeupSession>[0], writes, predicates };
}
const add = (p: Parameters<Parameters<typeof changeMakeupSession>[2]>[0]) => addMakeupSessionEntries(p, [{ subject: "math", absentDate: "2026-09-13" }]);
describe("보강 명단 저장 경쟁", () => {
  it("다른 창의 저장이 먼저 끝나면 최신 멘트를 읽어 보강 명단만 추가한다", async () => {
    const db = database([
      { data: { id: "session", updated_at: "2026-09-12T01:00:00Z", subject_progress: { regular: { draft: "옛 내용" } } }, error: null },
      { data: null, error: null },
      { data: { id: "session", updated_at: "2026-09-12T01:00:01Z", subject_progress: { regular: { draft: "새 내용" } } }, error: null },
      { data: { updated_at: "2026-09-12T01:00:02Z" }, error: null },
    ]);
    expect(await changeMakeupSession(db.db, scope, add)).toMatchObject({ ok: true, previousUpdatedAt: "2026-09-12T01:00:01Z" });
    expect(db.writes[1].subject_progress).toMatchObject({ regular: { draft: "새 내용" }, "makeup::math": { makeup: true } });
    expect(db.predicates).toContainEqual(["updated_at", "2026-09-12T01:00:01Z"]);
    expect(db.predicates).toContainEqual(["tenant_id", scope.tenantId]);
    expect(db.predicates).toContainEqual(["updated_by", scope.teacherId]);
  });
  it("최초 저장의 유니크 충돌도 상대가 저장한 진도를 보존한다", async () => {
    const db = database([
      { data: null, error: null }, { error: { code: "23505" } },
      { data: { id: "session", updated_at: "2026-09-12T01:00:00Z", subject_progress: { regular: { today: "p.10" } } }, error: null },
      { data: { updated_at: "2026-09-12T01:00:02Z" }, error: null },
    ]);
    expect((await changeMakeupSession(db.db, scope, add)).ok).toBe(true);
    expect(db.writes[1].subject_progress).toMatchObject({ regular: { today: "p.10" } });
  });
  it("조회 실패를 빈 세션으로 간주해 덮지 않는다", async () => {
    const db = database([{ data: null, error: { message: "offline" } }]);
    expect((await changeMakeupSession(db.db, scope, add)).ok).toBe(false);
    expect(db.writes).toEqual([]);
  });
});
