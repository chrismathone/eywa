import { beforeEach, expect, it, vi } from "vitest";
import type postgres from "postgres";

const fake = vi.hoisted(() => ({ sql: {} as unknown }));
vi.mock("postgres", () => ({ default: () => fake.sql }));
vi.mock("@/lib/auth/tenant-view-outbound", () => ({ assertTenantViewOutboundAllowed: async () => {} }));
import { reopenClassWithSchedules } from "./class-term-store";

const actor = { tenantId: "tenant-a", id: "owner", displayName: "원장" };
type Change = { id: string; before: string | null; after: string | null };

function database(
  klass: { class_name: string; closed_at: string | null } | null,
  logs: Change[][],
  state: { restored?: number; periodEnd?: string | null; students?: string[] } = {},
) {
  const calls: { query: string; args: unknown[] }[] = [];
  const tx = Object.assign(
    async (strings: TemplateStringsArray, ...args: unknown[]) => {
      const query = strings.join("?").replace(/\s+/g, " ");
      calls.push({ query, args });
      if (query.includes("from classes")) return klass ? [structuredClone(klass)] : [];
      if (query.includes("from audit_logs a")) return logs.map((schedules) => ({ schedules }));
      if (query.includes("class_period_closed_end")) return [{ period_end: state.periodEnd ?? null }];
      if (query.includes("update class_schedules s set"))
        return Array.from({ length: state.restored ?? (args[0] as unknown[]).length }, () => ({ id: "s" }));
      if (query.includes("reopen_class_enrollments"))
        return (state.students ?? []).map((student_id) => ({ student_id }));
      return [];
    },
    { json: (v: unknown) => v },
  ) as unknown as postgres.TransactionSql;
  fake.sql = {
    begin: async (_: string, run: (t: postgres.TransactionSql) => unknown) => run(tx),
    end: async () => {},
  };
  return calls;
}

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://test";
});

it("재개강은 한 거래로 — 지난 재개강 뒤의 종강 기록을 합쳐 배치를 되돌리고, 종강일을 비우고, 수강을 되살리고, 기록을 남긴다", async () => {
  const calls = database(
    { class_name: "LS4b (~26.09.30)", closed_at: "2026-09-30" },
    [
      [
        { id: "open", before: null, after: "2026-09-30" },
        { id: "later", before: "2026-12-31", after: "2026-09-30" },
      ],
      // 밤 정리가 나중에 다시 닫은 줄 — 먼저 기록된 원래 값이 이긴다
      [
        { id: "open", before: "2026-10-05", after: "2026-09-30" },
        { id: "reopened", before: null, after: "2026-09-30" },
      ],
    ],
    { students: ["s1", "s2", "s1"] },
  );
  await expect(reopenClassWithSchedules(actor, "c")).resolves.toEqual({
    className: "LS4b (~26.09.30)",
    restoredSchedules: 3,
    affectedStudents: 2,
  });
  const read = calls.find((c) => c.query.includes("from audit_logs a"))!;
  expect(read.query).toContain("a.action='class_end_term'");
  expect(read.query).toContain("r.action='class_reopen_term'");
  expect(read.query).toContain("order by a.created_at, a.id");
  expect(read.args).toEqual([actor.tenantId, "c", "2026-09-30", actor.tenantId, "c"]);
  const restore = calls.find((c) => c.query.includes("update class_schedules s set"))!;
  expect(restore.args[0]).toEqual([
    { id: "open", before: "2026-09-30", after: null },
    { id: "later", before: "2026-09-30", after: "2026-12-31" },
    { id: "reopened", before: "2026-09-30", after: null },
  ]);
  // 그새 손으로 바꾼 줄은 건드리지 않는다 = 끝나는 날이 기록 그대로일 때만
  expect(restore.query).toContain("s.valid_to is not distinct from (x->>'before')::date");
  const reopen = calls.find((c) => c.query.includes("update classes"))!;
  expect(reopen.query).toContain("closed_at=null");
  expect(reopen.args).toEqual([actor.tenantId, "c"]);
  const enroll = calls.find((c) => c.query.includes("reopen_class_enrollments"))!;
  expect(enroll.args).toEqual(["c", "종강"]);
  const log = calls.find((c) => c.query.includes("insert into audit_logs"))!;
  expect(log.query).toContain("'class_reopen_term'");
  expect(log.args.at(-1)).toEqual({ classId: "c", affectedStudents: 2, restoredSchedules: 3 });
  const order = [restore, reopen, enroll, log].map((c) => calls.indexOf(c));
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

it("되살린 뒤에도 밤 정리가 운영 기간 종료로 볼 반이면 재개강을 막는다 — 그날 밤 수강이 다시 닫힌다", async () => {
  const calls = database({ class_name: "PL2 (~26.07.02)", closed_at: "2026-07-02" }, [], { periodEnd: "2026-07-01" });
  await expect(reopenClassWithSchedules(actor, "c")).rejects.toThrow("시간표 배치가 2026-07-01에 모두 끝나 있어");
  expect(calls.find((c) => c.query.includes("class_period_closed_end"))!.args).toEqual(["c"]);
  expect(calls.some((c) => c.query.includes("update classes"))).toBe(false);
  expect(calls.some((c) => c.query.includes("reopen_class_enrollments"))).toBe(false);
  expect(calls.some((c) => c.query.includes("insert into audit_logs"))).toBe(false);
});

it("밤 정리가 운영 기간 종료로 보지 않는 반(배치 없음 · 끝난 뒤 만든 줄)은 막지 않는다", async () => {
  const calls = database({ class_name: "상담반 (~26.07.02)", closed_at: "2026-07-02" }, [], { periodEnd: null });
  await expect(reopenClassWithSchedules(actor, "c")).resolves.toMatchObject({ restoredSchedules: 0 });
  expect(calls.some((c) => c.query.includes("update classes"))).toBe(true);
});

it("이미 운영 중이거나 없는 반은 거절한다", async () => {
  database({ class_name: "PL2", closed_at: null }, []);
  await expect(reopenClassWithSchedules(actor, "c")).rejects.toThrow("이미 운영 중인 반");
  database(null, []);
  await expect(reopenClassWithSchedules(actor, "c")).rejects.toThrow("재개강할 반을 찾지 못했습니다");
});
