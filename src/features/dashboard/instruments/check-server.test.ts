import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { TenantSettings } from "@/features/owner/settings-types";

type Task = { id: string; tenant_id: string; kind: string; status: string; due_at: string | null; title: string; link: string | null };
const m = vi.hoisted(() => ({
  settings: null as TenantSettings | null,
  tasks: [] as Task[],
  byUser: new Map<string, { open: number; late: number }>(),
  links: [] as { task_id: string; user_id: string }[],
  names: [] as { id: string; display_name: string | null }[],
  hiddenPassed: [] as string[],
  notCalls: 0,
}));

vi.mock("@/features/staff-tasks/server/gate", () => ({
  getStaffTaskViewer: async () => ({ user: { id: "viewer", tenantId: "t1" }, canMonitor: true }),
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => m.settings }));
vi.mock("@/features/staff-tasks/server/queries", () => ({
  countOpenTasks: async (_tenantId: string, _userId: string | undefined, hidden: string[]) => {
    m.hiddenPassed = hidden;
    return m.byUser;
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/features/dashboard/server/queries", () => ({ getAbsenceRiskStudents: vi.fn(), getAbsenceRiskAnchor: vi.fn() }));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async (build: (from: number, to: number) => Promise<{ data: Task[]; error: unknown }>) => {
    const result = await build(0, 999);
    if (result.error) throw result.error;
    return result.data ?? [];
  },
  fetchInChunks: async () => m.names,
  fetchAllPagedInChunks: async (ids: string[]) => m.links.filter((link) => ids.includes(link.task_id)),
}));

function taskQuery() {
  const filters: ((task: Task) => boolean)[] = [];
  const query = {
    select: () => query,
    eq: (key: keyof Task, value: string) => { filters.push((task) => task[key] === value); return query; },
    not: (key: keyof Task, _op: string, raw: string) => {
      m.notCalls += 1;
      const hidden = raw.replace(/^\(|\)$/g, "").split(",");
      filters.push((task) => !hidden.includes(String(task[key])));
      return query;
    },
    order: () => query,
    range: () => query,
    then: (resolve: (value: { data: Task[]; error: null }) => void) => Promise.resolve({
      data: m.tasks.filter((task) => filters.every((filter) => filter(task))),
      error: null,
    }).then(resolve),
  };
  return query;
}
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => taskQuery() }) }));

import { loadTaskBoard } from "./check-server";

const late = "2000-01-01T00:00:00Z";
const row = (id: string, kind: string): Task => ({ id, tenant_id: "t1", kind, status: "open", due_at: late, title: kind, link: `/${id}` });

beforeEach(() => {
  m.settings = DEFAULT_SETTINGS;
  m.tasks = [];
  m.byUser = new Map();
  m.links = [];
  m.names = [{ id: "u1", display_name: "담당자" }];
  m.hiddenPassed = [];
  m.notCalls = 0;
});

describe("새 대시보드 할 일 판", () => {
  it("종류 칩과 사람별 늦은 항목에서 꺼진 기능의 할 일을 함께 뺀다", async () => {
    m.settings = { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules, disabled: ["approvals", "classnote"] } };
    m.tasks = [row("approval", "approval_turn"), row("failed", "report_send_failed"), row("visible", "followup_due")];
    m.byUser = new Map([["u1", { open: 1, late: 1 }]]);
    m.links = m.tasks.map((task) => ({ task_id: task.id, user_id: "u1" }));

    const result = await loadTaskBoard();
    expect(result?.kinds).toEqual([{ kind: "followup_due", open: 1, late: 1 }]);
    expect(result?.people[0]?.items.map((item) => item.id)).toEqual(["visible"]);
    expect(m.hiddenPassed).toEqual(["approval_turn", "unsent_report", "report_send_failed"]);
  });

  it("침산 조건에서는 제외 쿼리를 붙이지 않고 모든 종류를 센다", async () => {
    m.tasks = [row("approval", "approval_turn"), row("visible", "followup_due")];
    m.byUser = new Map([["u1", { open: 2, late: 2 }]]);
    m.links = m.tasks.map((task) => ({ task_id: task.id, user_id: "u1" }));

    const result = await loadTaskBoard();
    expect(result?.kinds.map((kind) => kind.kind).sort()).toEqual(["approval_turn", "followup_due"]);
    expect(m.notCalls).toBe(0);
  });
});
