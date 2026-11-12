import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { TenantSettings } from "@/features/owner/settings-types";
import type { TeacherWork } from "@/features/dashboard/overview/teacher-work";

type Task = { tenant_id: string; kind: string; status: string; due_at: string | null };
const m = vi.hoisted(() => ({
  settings: null as TenantSettings | null,
  tasks: [] as Task[],
  byUser: new Map<string, { open: number; late: number }>(),
  hiddenPassed: [] as string[],
  notCalls: 0,
}));

vi.mock("./gate", () => ({
  getStaffTaskViewer: async () => ({ user: { id: "viewer", tenantId: "t1" }, canMonitor: true }),
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => m.settings }));
vi.mock("./queries", () => ({
  countOpenTasks: async (_tenantId: string, _userId: string | undefined, hidden: string[]) => {
    m.hiddenPassed = hidden;
    return m.byUser;
  },
}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));

function taskQuery() {
  const filters: ((task: Task) => boolean)[] = [];
  const query = {
    select: () => query,
    eq: (key: keyof Task, value: string) => { filters.push((task) => task[key] === value); return query; },
    lt: (key: keyof Task, value: string) => { filters.push((task) => task[key] != null && String(task[key]) < value); return query; },
    not: (key: keyof Task, _op: string, raw: string) => {
      m.notCalls += 1;
      const hidden = raw.replace(/^\(|\)$/g, "").split(",");
      filters.push((task) => !hidden.includes(String(task[key])));
      return query;
    },
    then: (resolve: (value: { count: number; error: null }) => void) => Promise.resolve({
      count: m.tasks.filter((task) => filters.every((filter) => filter(task))).length,
      error: null,
    }).then(resolve),
  };
  return query;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => taskQuery() }) }));

import { withStaffTasks } from "./teacher-work";

const baseWork = { rows: [] } as unknown as TeacherWork;

beforeEach(() => {
  m.settings = DEFAULT_SETTINGS;
  m.tasks = [];
  m.byUser = new Map();
  m.hiddenPassed = [];
  m.notCalls = 0;
});

describe("운영실 할 일 합계", () => {
  it("전체 합계와 사람별 집계가 같은 숨김 종류를 뺀다", async () => {
    m.settings = { ...DEFAULT_SETTINGS, modules: { ...DEFAULT_SETTINGS.modules, disabled: ["approvals"] } };
    m.tasks = [
      { tenant_id: "t1", kind: "approval_turn", status: "open", due_at: "2000-01-01T00:00:00Z" },
      { tenant_id: "t1", kind: "followup_due", status: "open", due_at: null },
    ];
    m.byUser = new Map([["u1", { open: 1, late: 0 }]]);

    const result = await withStaffTasks(Promise.resolve(baseWork));
    expect(result.tasks).toEqual({ byUser: { u1: { open: 1, late: 0 } }, open: 1, late: 0 });
    expect(m.hiddenPassed).toEqual(["approval_turn"]);
    expect(m.notCalls).toBe(2);
  });

  it("침산 조건에서는 제외 쿼리 없이 종전 합계를 센다", async () => {
    m.tasks = [
      { tenant_id: "t1", kind: "approval_turn", status: "open", due_at: "2000-01-01T00:00:00Z" },
      { tenant_id: "t1", kind: "followup_due", status: "open", due_at: null },
    ];
    m.byUser = new Map([["u1", { open: 2, late: 1 }]]);

    const result = await withStaffTasks(Promise.resolve(baseWork));
    expect(result.tasks).toMatchObject({ open: 2, late: 1 });
    expect(m.notCalls).toBe(0);
  });
});
