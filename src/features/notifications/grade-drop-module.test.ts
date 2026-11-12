import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  retentionOn: false,
  existingAny: true,
  recorded: new Map<string, { seeded: boolean }>(),
  sent: 0,
}));

vi.mock("@/features/owner/server/modules", () => ({ isModuleOnForTenant: async () => m.retentionOn }));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: async () => ({ operations: { subjects: [] } }),
}));
vi.mock("@/lib/supabase/batch", () => ({
  fetchAllPaged: async () => [
    { id: "old", student_id: "student", subject: "math", score: "100", max_score: "100", taken_on: "2026-10-01", student: { name: "학생" } },
    { id: "new", student_id: "student", subject: "math", score: "70", max_score: "100", taken_on: "2026-11-01", student: { name: "학생" } },
  ],
  fetchAllPagedInChunks: vi.fn(),
  fetchInChunks: vi.fn(),
}));
vi.mock("./server/notify", () => ({ notifyUsers: async () => { m.sent += 1; } }));

import { detectGradeDrop } from "./server/events";

const admin = {
  from: (table: string) => {
    if (table !== "notification_events") throw new Error(`예상하지 않은 표: ${table}`);
    const query = {
      select: () => query,
      eq: () => query,
      then: (resolve: (value: { count: number; error: null }) => void) => Promise.resolve({
        count: m.existingAny || m.recorded.size ? 1 : 0,
        error: null,
      }).then(resolve),
      upsert: (rows: { subject_key: string; bucket: string; seeded: boolean }[]) => ({
        select: async () => {
          const inserted: { subject_key: string; bucket: string }[] = [];
          for (const row of rows) {
            const key = `${row.subject_key}::${row.bucket}`;
            if (m.recorded.has(key)) continue;
            m.recorded.set(key, { seeded: row.seeded });
            inserted.push({ subject_key: row.subject_key, bucket: row.bucket });
          }
          return { data: inserted, error: null };
        },
      }),
    };
    return query;
  },
};

beforeEach(() => {
  m.retentionOn = false;
  m.existingAny = true;
  m.recorded = new Map();
  m.sent = 0;
});

describe("성적 급락 알림 기능 스위치", () => {
  it("꺼진 동안은 시드만 남기고, 다시 켜도 같은 급락을 뒤늦게 알리지 않는다", async () => {
    expect(await detectGradeDrop(admin as never, "t1")).toBe(0);
    expect([...m.recorded.values()]).toEqual([{ seeded: true }]);
    expect(m.sent).toBe(0);

    m.retentionOn = true;
    expect(await detectGradeDrop(admin as never, "t1")).toBe(0);
    expect(m.sent).toBe(0);
  });
});
