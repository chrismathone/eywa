// 이탈 방어 조치 기록·재등록 캠페인 — '다른 강사 뷰'면 담당(counselor_id)이 대상 직원 X다(원장 2026-11-05 강사뷰 전수).
// A 명의로 남으면 X의 상담 목록·퇴원보고서 상담 연결 후보(counselor_id 축)에 뜨지 않는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  canWrite: vi.fn(),
  log: vi.fn(),
  inserts: [] as { table: string; row: Record<string, unknown> }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: m.canWrite }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        m.inserts.push({ table, row });
        const done = { error: null, data: { id: "c1" } };
        return Object.assign(Promise.resolve(done), { select: () => ({ single: async () => done }) });
      },
    }),
  }),
}));

import { campaignAdd, logRetentionAction } from "./actions";

const A = { id: "a1", tenantId: "t1", systemRole: "master" };
const X = { id: "x1", tenantId: "t1", systemRole: "counselor" };

beforeEach(() => {
  vi.clearAllMocks();
  m.inserts = [];
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
  m.canWrite.mockResolvedValue(true);
});

describe("이탈 방어 — 강사뷰 신원", () => {
  it("🔴 조치 기록의 상담 담당(counselor_id)은 대상 X · 권한 판정도 X의 역할로", async () => {
    const fd = new FormData();
    fd.set("studentId", "s1");
    fd.set("summary", "학부모 통화");
    expect(await logRetentionAction(undefined, fd)).toEqual({ ok: true });
    expect(m.inserts[0]).toMatchObject({ table: "student_consultations", row: { tenant_id: "t1", student_id: "s1", counselor_id: "x1" } });
    expect(m.canWrite).toHaveBeenCalledWith("counselor", "retention");
  });

  it("🔴 캠페인 추가의 담당도 X", async () => {
    expect(await campaignAdd("s1")).toEqual({ ok: true });
    expect(m.inserts[0]).toMatchObject({ table: "reenrollment_campaign_targets", row: { counselor_id: "x1" } });
  });

  it("쓰기 권한이 없으면(읽기 강사뷰 포함 — canWriteTenant가 막는다) 아무것도 저장하지 않는다", async () => {
    m.canWrite.mockResolvedValue(false);
    expect(await campaignAdd("s1")).toEqual({ ok: false, error: "이탈 방어 권한이 없습니다" });
    expect(m.inserts).toEqual([]);
  });
});
