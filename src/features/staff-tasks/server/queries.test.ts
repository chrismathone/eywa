import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { TenantSettings } from "@/features/owner/settings-types";

type AnyRow = Record<string, unknown>;
const m = vi.hoisted(() => ({
  settings: null as TenantSettings | null,
  tables: new Map<string, AnyRow[]>(),
  rpcRows: [] as { user_id: string; open_count: number; late_count: number }[],
  notCalls: [] as { table: string; key: string; op: string; value: string }[],
}));

vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => m.settings }));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async (build: (from: number, to: number) => Promise<{ data: AnyRow[]; error: unknown }>) => {
    const result = await build(0, 999);
    if (result.error) throw result.error;
    return result.data ?? [];
  },
  fetchInChunks: async () => [],
}));

const valueAt = (row: AnyRow, key: string): unknown => key.split(".").reduce<unknown>((value, part) =>
  value && typeof value === "object" ? (value as AnyRow)[part] : undefined, row);

function queryFor(table: string) {
  const filters: ((row: AnyRow) => boolean)[] = [];
  let count = false;
  let from = 0;
  let to = Number.POSITIVE_INFINITY;
  const query = {
    select: (_columns: string, options?: { count?: string }) => { count = Boolean(options?.count); return query; },
    eq: (key: string, value: unknown) => { filters.push((row) => valueAt(row, key) === value); return query; },
    neq: (key: string, value: unknown) => { filters.push((row) => valueAt(row, key) !== value); return query; },
    lt: (key: string, value: string) => { filters.push((row) => String(valueAt(row, key) ?? "") < value); return query; },
    in: (key: string, values: readonly unknown[]) => { filters.push((row) => values.includes(valueAt(row, key))); return query; },
    not: (key: string, op: string, value: string) => {
      m.notCalls.push({ table, key, op, value });
      const values = value.replace(/^\(|\)$/g, "").split(",");
      filters.push((row) => !values.includes(String(valueAt(row, key))));
      return query;
    },
    order: () => query,
    limit: () => query,
    range: (nextFrom: number, nextTo: number) => { from = nextFrom; to = nextTo; return query; },
    maybeSingle: async () => {
      const rows = (m.tables.get(table) ?? []).filter((row) => filters.every((filter) => filter(row)));
      return { data: rows[0] ?? null, error: null };
    },
    then: (resolve: (value: { data: AnyRow[]; error: null; count?: number }) => void) => {
      const rows = (m.tables.get(table) ?? []).filter((row) => filters.every((filter) => filter(row)));
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null, ...(count ? { count: rows.length } : {}) }).then(resolve);
    },
  };
  return query;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async () => ({ data: m.rpcRows, error: null }),
    from: (table: string) => queryFor(table),
  }),
}));

import { countOpenTasks, listTasks, taskDetail } from "./queries";

const task = (id: string, kind: string): AnyRow => ({
  id, tenant_id: "t1", kind, title: kind, detail: null, link: null, status: "open",
  opened_at: "2026-11-01T00:00:00Z", due_at: "2000-01-01T00:00:00Z", closed_at: null,
  closed_by: null, close_reason: null,
});

beforeEach(() => {
  m.settings = DEFAULT_SETTINGS;
  m.tables = new Map();
  m.rpcRows = [];
  m.notCalls = [];
});

describe("꺼진 기능의 할 일 조회", () => {
  it("사람별 RPC 집계에서 감춘 열린 일과 늦은 일을 뺀다", async () => {
    m.settings = { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules, disabled: ["approvals"] } };
    m.rpcRows = [{ user_id: "u1", open_count: 2, late_count: 1 }];
    m.tables.set("staff_task_assignees", [{
      tenant_id: "t1", task_id: "hidden", user_id: "u1",
      staff_tasks: { status: "open", kind: "approval_turn", due_at: "2000-01-01T00:00:00Z" },
    }]);

    expect(Object.fromEntries(await countOpenTasks("t1"))).toEqual({ u1: { open: 1, late: 0 } });
  });

  it("목록과 상세에서 감춘 종류를 실제 행 조회 단계에서 제외한다", async () => {
    m.settings = { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules, disabled: ["approvals", "classnote"] } };
    m.tables.set("staff_tasks", [
      task("approval", "approval_turn"),
      task("unsent", "unsent_report"),
      task("failed", "report_send_failed"),
      task("visible", "followup_due"),
    ]);
    m.tables.set("staff_task_assignees", []);
    m.tables.set("staff_task_events", []);

    const listed = await listTasks({ tenantId: "t1", assigneeId: null, filter: "all", page: 0 });
    expect(listed.items.map((item) => item.id)).toEqual(["visible"]);
    expect(await taskDetail("t1", "approval", { userId: "u1", canMonitor: true })).toBeNull();
  });

  it("침산 조건인 빈 숨김 목록에서는 종전 행을 모두 보며 제외 쿼리를 붙이지 않는다", async () => {
    m.tables.set("staff_tasks", [task("approval", "approval_turn"), task("visible", "followup_due")]);
    m.tables.set("staff_task_assignees", []);

    const listed = await listTasks({ tenantId: "t1", assigneeId: null, filter: "all", page: 0 });
    expect(listed.items.map((item) => item.id)).toEqual(["approval", "visible"]);
    expect(m.notCalls).toEqual([]);
  });
});
