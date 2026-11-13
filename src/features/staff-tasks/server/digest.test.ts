import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";

type Task = { id: string; tenant_id: string; kind: string; status: string; due_at: string };
const m = vi.hoisted(() => ({
  tasks: [] as Task[],
  links: [] as { task_id: string; user_id: string }[],
  sent: [] as { title: string; body: string | null }[],
}));

vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: async () => ({
    ...DEFAULT_SETTINGS,
    modules: { ...DEFAULT_SETTINGS.modules, disabled: ["classnote"] },
    permissions: { ...DEFAULT_SETTINGS.permissions, specialAccess: { ...DEFAULT_SETTINGS.permissions.specialAccess, staffTaskMonitorIds: ["monitor"] } },
  }),
}));
vi.mock("@/features/notifications/server/notify", () => ({
  notifyUsers: async (items: { title: string; body: string | null }[]) => { m.sent.push(...items); },
}));
vi.mock("@/features/notifications/server/notify", () => ({
  notifyUsers: async (items: { title: string; body: string | null }[]) => { m.sent = items; },
}));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async (build: (from: number, to: number) => Promise<{ data: Task[]; error: unknown }>) => {
    const result = await build(0, 999);
    if (result.error) throw result.error;
    return result.data ?? [];
  },
  fetchInChunks: async (ids: string[]) => m.links.filter((link) => ids.includes(link.task_id)),
}));

function rowsQuery<T extends Record<string, unknown>>(rows: T[]) {
  const filters: ((row: T) => boolean)[] = [];
  const query = {
    select: () => query,
    eq: (key: keyof T, value: unknown) => { filters.push((row) => row[key] === value); return query; },
    lt: (key: keyof T, value: string) => { filters.push((row) => String(row[key] ?? "") < value); return query; },
    in: (key: keyof T, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
    not: (key: keyof T, _op: string, raw: string) => {
      const hidden = raw.replace(/^\(|\)$/g, "").split(",");
      filters.push((row) => !hidden.includes(String(row[key])));
      return query;
    },
    order: () => query,
    range: () => query,
    then: (resolve: (value: { data: T[]; error: null }) => void) => Promise.resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))), error: null }).then(resolve),
  };
  return query;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { sendStaffTaskDigest } from "./digest";

const admin = {
  rpc: async () => ({ error: null }),
  from: (table: string) => {
    if (table === "staff_tasks") return rowsQuery(m.tasks);
    if (table === "users") return rowsQuery([
      { id: "monitor", tenant_id: "t1", status: "active", system_role: "teacher", display_name: "담당자" },
      { id: "u1", tenant_id: "t1", status: "active", system_role: "teacher", display_name: "강사" },
    ]);
    if (table === "notification_events") return {
      upsert: () => ({ select: async () => ({ data: [{ id: "event" }], error: null }) }),
    };
    throw new Error(`예상하지 않은 표: ${table}`);
  },
};

beforeEach(() => {
  m.tasks = [
    { id: "hidden", tenant_id: "t1", kind: "report_send_failed", status: "open", due_at: "2000-01-01T00:00:00Z" },
    { id: "visible", tenant_id: "t1", kind: "followup_due", status: "open", due_at: "2000-01-01T00:00:00Z" },
  ];
  m.links = [{ task_id: "hidden", user_id: "u1" }, { task_id: "visible", user_id: "u1" }];
  m.sent = [];
});

describe("할 일 아침 요약", () => {
  it("꺼진 ClassNote에서 생긴 발송 실패는 종류·인원·합계에서 모두 뺀다", async () => {
    expect(await sendStaffTaskDigest(admin as never, "t1")).toBe(1);
    expect(m.sent).toHaveLength(1);
    expect(m.sent[0]).toMatchObject({ title: "기한 초과 업무 1건" });
    expect(m.sent[0]?.body).toContain("상담 후속조치 1");
    expect(m.sent[0]?.body).not.toContain("보고서 발송 실패");
  });
});
