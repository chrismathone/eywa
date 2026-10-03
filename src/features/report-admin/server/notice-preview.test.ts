import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  writable: true, sendOn: true, version: 1, inserted: [] as Record<string, unknown>[],
  inSizes: [] as number[], enrollmentRanges: [] as number[][],
  classes: [] as { id: string; subject: string }[],
  enrollments: [] as { id: string; class_id: string; student_id: string }[],
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => ({ id: "u1", tenantId: "t1", systemRole: "admin" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => m.writable, canAccessTenant: async () => true }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ report: { classnoteSubjects: ["math"] } }) }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteSendOn: () => m.sendOn }));
vi.mock("@/features/onescreen/server/scope", () => ({ hasClassnoteNameCollision: async () => false }));
vi.mock("@/features/audit/server/log", () => ({ logAction: async () => undefined }));
vi.mock("./notice-class-route", () => ({ routeNoticeCandidates: async ({ candidates }: { candidates: { studentId: string; name: string; hints: string[] }[] }) => ({
  rest: [], skipped: [], classTargets: candidates.map((c) => ({ studentId: c.studentId, studentName: c.name, board: `board-${m.version}`, classId: c.hints[0], className: "가반" })),
}) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let ids: string[] = []; let range: number[] | null = null;
  const q = {
    select: () => q, eq: () => q, is: () => q, order: () => q,
    in: (_: string, values: string[]) => { ids = values; m.inSizes.push(values.length); return q; },
    range: (from: number, to: number) => { range = [from, to]; if (table === "enrollments") m.enrollmentRanges.push(range); return q; },
    insert: (value: Record<string, unknown>) => { m.inserted.push(value); return q; },
    single: async () => ({ data: { id: "notice-1" }, error: null }),
    then: (resolve: (value: unknown) => unknown) => {
      let rows: unknown[] = table === "classes" ? m.classes.filter((c) => ids.includes(c.id))
        : table === "enrollments" ? m.enrollments.filter((e) => ids.includes(e.class_id))
        : ids.map((id) => ({ id, name: `학생-${id}`, classnote_name: null, status: "enrolled" }));
      rows = range ? rows.slice(range[0], range[1] + 1) : rows.slice(0, 1000);
      return Promise.resolve({ data: rows, error: null }).then(resolve);
    },
  }; return q;
} }) }));
import { previewClassNotice, sendClassNotice } from "./notice-actions";
beforeEach(() => {
  m.writable = true; m.sendOn = true; m.version = 1; m.inserted = []; m.inSizes = []; m.enrollmentRanges = [];
  m.classes = Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, subject: "math" }));
  m.enrollments = Array.from({ length: 1201 }, (_, i) => ({ id: `e${i}`, class_id: i === 1200 ? "c100" : `c${i % 100}`, student_id: `s${i}` }));
});
const input = () => ({ classIds: m.classes.map((c) => c.id), body: "합성 테스트 공지", individual: { s0: "개별 내용" } });
it("previews and queues every target for 101 classes and a chunk exceeding 1000 enrollments", async () => {
  const result = await previewClassNotice(input());
  expect(result.ok).toBe(true); if (!result.ok) return;
  expect(result.preview).toMatchObject({ classCount: 101, studentCount: 1201, individualCount: 1 });
  expect(m.inserted).toHaveLength(0); expect(Math.max(...m.inSizes)).toBeLessThanOrEqual(100);
  expect(m.enrollmentRanges).toContainEqual([1000, 1999]);
  const sent = await sendClassNotice({ ...input(), previewFingerprint: result.preview.fingerprint });
  expect(sent).toMatchObject({ ok: true, queued: 1201 });
  expect(m.inserted).toHaveLength(1); expect(m.inserted[0].targets).toHaveLength(1201);
});
it("refuses changed recipients or content after preview before any queue write", async () => {
  const result = await previewClassNotice(input()); if (!result.ok) throw Error(result.error);
  m.version++;
  expect((await sendClassNotice({ ...input(), previewFingerprint: result.preview.fingerprint })).ok).toBe(false);
  m.version--;
  expect((await sendClassNotice({ ...input(), body: "변경된 본문", previewFingerprint: result.preview.fingerprint })).ok).toBe(false);
  expect(m.inserted).toHaveLength(0);
});
it("rejects invalid selections and read-only preview; never silently drops classes", async () => {
  expect((await previewClassNotice({ ...input(), classIds: [...input().classIds, "missing"] })).ok).toBe(false);
  m.writable = false; m.inSizes = [];
  expect((await previewClassNotice(input())).ok).toBe(false); expect(m.inSizes).toHaveLength(0);
  expect(m.inserted).toHaveLength(0);
});
it("preserves fixed test target and disabled-send dry run", async () => {
  const result = await sendClassNotice({ ...input(), classIds: ["missing"], test: true });
  expect(result).toMatchObject({ ok: true, queued: 1 });
  expect(m.inserted[0].targets).toEqual([{ studentId: null, studentName: "학원이", board: "(수학)학원이" }]);
  m.inserted = []; m.sendOn = false;
  expect(await sendClassNotice({ ...input(), test: true })).toMatchObject({ ok: true, queued: 0, dryRun: true });
  expect(m.inserted).toHaveLength(0);
});
