import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLASS_UPDATES_APPLIED_KIND } from "@/features/timetable/due-class-updates";
import { kstToday } from "@/lib/date-kst";

/**
 * 예약 그룹 반영이 **실패해도 그 예약의 완료 표식은 남고, 다음 실행은 그 예약을 통째로 건너뛴다**(기존 계약 · 2026-10-05 확인).
 *
 * 그래서 그룹 반영의 충돌 재시도는 "다음 날"이 아니라 같은 실행 안에서 해야 한다(`scheduled-groups.ts`) —
 * 표식을 안 남기면 이미 끝난 반 이름·담임 변경이 다음 날 통째로 재생된다.
 * 이 테스트는 그 전제(실패 → 표식 → 다음 실행 skip)를 라우트 수준에서 고정한다.
 */
const m = vi.hoisted(() => ({
  snapshots: [] as Record<string, unknown>[],
  logs: [] as { snapshot_id: string; restored_at: string | null; result: Record<string, unknown> }[],
  applyGroups: vi.fn(),
  audits: [] as unknown[],
}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: vi.fn() }));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("@/features/owner/server/queries", () => ({ tenantSettingsTag: (id: string) => `settings:${id}` }));
vi.mock("@/features/owner/server/scheduled-groups", () => ({ applyScheduledGroupPlan: m.applyGroups }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "timetable_snapshots") {
        const query = { lte: () => query, gt: () => query, order: () => query, limit: async () => ({ data: m.snapshots, error: null }) };
        return { select: () => query };
      }
      if (table === "timetable_import_logs") {
        return {
          select: () => ({
            in: async (_column: string, ids: string[]) => ({
              data: m.logs
                .filter((l) => ids.includes(l.snapshot_id))
                .map((l) => ({ snapshot_id: l.snapshot_id, restored_at: l.restored_at, kind: l.result.kind ?? null })),
              error: null,
            }),
          }),
          insert: async (row: { snapshot_id: string; result: Record<string, unknown> }) => {
            m.logs.push({ snapshot_id: row.snapshot_id, restored_at: null, result: row.result });
            return { error: null };
          },
        };
      }
      if (table === "audit_logs") return { insert: async (row: unknown) => (m.audits.push(row), { error: null }) };
      throw new Error(`예상하지 못한 표: ${table}`);
    },
  }),
}));
import { GET } from "./route";

const PLAN = {
  subject: "english",
  groups: [{ id: "g1", title: "새 줄", classIds: ["c1"] }],
  from: [{ id: "g0", title: "옛 줄", classIds: ["c1"] }],
};
const run = async () => {
  const response = await GET(new Request("https://example.test/api/cron/apply-due-class-updates", { headers: { authorization: "Bearer test-secret" } }));
  return (await response.json()) as { ok?: boolean; snapshots?: number; groupsApplied?: number };
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
  m.logs = [];
  m.audits = [];
  // 반 이름·담임 변경 없이 그룹 배치만 예약된 스냅샷(오늘 기한).
  m.snapshots = [{ id: "snap-1", tenant_id: "tenant-a", reference_date: kstToday(), updates: [], groups: PLAN }];
});

describe("그룹 반영이 실패한 예약", () => {
  it("🔴 실패해도 완료 표식을 남긴다 — 실패 사유가 표식에 함께 적힌다", async () => {
    m.applyGroups.mockResolvedValueOnce({ status: "error", reason: "설정이 동시에 바뀌어 그룹 배치를 반영하지 못했습니다" });
    const body = await run();
    expect(body).toMatchObject({ ok: true, snapshots: 1, groupsApplied: 0 });
    expect(m.logs).toHaveLength(1);
    expect(m.logs[0]!.result).toMatchObject({
      kind: CLASS_UPDATES_APPLIED_KIND,
      groups: { status: "error", reason: "설정이 동시에 바뀌어 그룹 배치를 반영하지 못했습니다" },
    });
    // 반영되지 않았으므로 '그룹을 바꿨다'는 감사 기록은 없다.
    expect(m.audits).toHaveLength(0);
  });

  it("🔴 다음 실행은 표식이 있는 예약을 건너뛴다 — 그룹 반영을 다시 시도하지 않는다", async () => {
    m.applyGroups.mockResolvedValue({ status: "error", reason: "설정이 동시에 바뀌어 그룹 배치를 반영하지 못했습니다" });
    await run();
    const second = await run();
    expect(second).toMatchObject({ ok: true, snapshots: 0 });
    expect(m.applyGroups).toHaveBeenCalledTimes(1);
    expect(m.logs).toHaveLength(1);
  });

  it("반영 도중 예외가 나도 표식은 남는다(다음 날 반 이름·담임이 통째로 재생되지 않게)", async () => {
    m.applyGroups.mockRejectedValueOnce(new Error("boom"));
    await run();
    expect(m.logs[0]!.result).toMatchObject({ kind: CLASS_UPDATES_APPLIED_KIND, groups: { status: "error" } });
    await run();
    expect(m.applyGroups).toHaveBeenCalledTimes(1);
  });
});

describe("그룹 반영이 성공한 예약", () => {
  it("표식과 감사 기록을 남기고, 다음 실행은 건너뛴다", async () => {
    m.applyGroups.mockResolvedValue({ status: "applied", groups: 1 });
    expect(await run()).toMatchObject({ ok: true, snapshots: 1, groupsApplied: 1 });
    expect(m.audits).toHaveLength(1);
    expect(await run()).toMatchObject({ ok: true, snapshots: 0 });
    expect(m.applyGroups).toHaveBeenCalledTimes(1);
  });
});
