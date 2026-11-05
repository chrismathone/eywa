import { beforeEach, describe, expect, it, vi } from "vitest";

// '내 할 일'은 사람에게 묶인 기록 — '다른 강사 뷰'면 그 강사의 할 일이다(원장 2026-11-05 *"실제 그 사람으로 완벽하게 전환"*).
// 계기: 김태건 선생님의 '퇴원보고서 작성' 할 일이 강사뷰의 '내 할 일'에 안 뜨고 보는 관리자 본인 할 일이 떴다.
type U = { id: string; tenantId: string; systemRole: string; tenantView?: unknown };
const m = vi.hoisted(() => ({
  real: { id: "admin1", tenantId: "t1", systemRole: "master" } as U,
  target: null as U | null,
  monitors: [] as string[],
  superAdmin: false,
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (o?: { teacherView: boolean }) => (o?.teacherView && m.target ? m.target : m.real),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => m.superAdmin }));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewWriteBlocked: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ permissions: { specialAccess: { staffTaskMonitorIds: m.monitors } } }),
}));

import { getStaffTaskViewer } from "./gate";

beforeEach(() => {
  m.target = null;
  m.monitors = [];
  m.superAdmin = false;
});

describe("할 일을 읽는 사람(getStaffTaskViewer)", () => {
  it("평소엔 로그인한 본인 — 원장 역할이면 현황 권한", async () => {
    const viewer = await getStaffTaskViewer();
    expect(viewer?.user.id).toBe("admin1");
    expect(viewer?.canMonitor).toBe(true);
  });
  it("'다른 강사 뷰'면 그 강사 — 현황 권한도 그 강사 기준(보는 사람의 원장 권한을 물려받지 않는다)", async () => {
    m.target = { id: "kim", tenantId: "t1", systemRole: "teacher" };
    const viewer = await getStaffTaskViewer();
    expect(viewer?.user.id).toBe("kim");
    expect(viewer?.canMonitor).toBe(false);
  });
  it("그 강사가 현황 지정자면 강사뷰에서도 현황을 본다", async () => {
    m.target = { id: "kim", tenantId: "t1", systemRole: "teacher" };
    m.monitors = ["kim"];
    expect((await getStaffTaskViewer())?.canMonitor).toBe(true);
  });
  it("지점 보기 중이면 없음(할 일은 사람에게 묶인 기록이라 보는 지점의 것이 아니다)", async () => {
    m.real = { ...m.real, tenantView: { tenantId: "t2" } };
    expect(await getStaffTaskViewer()).toBeNull();
    m.real = { id: "admin1", tenantId: "t1", systemRole: "master" };
  });
});
