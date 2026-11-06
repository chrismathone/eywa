import { beforeEach, describe, expect, it, vi } from "vitest";

// 업무 비서 저장 · AI 정리는 강사뷰(전체 · 읽기)에서 하지 않는다(2026-11-05 강사뷰 적대 리뷰 중요).
// 할 일 게이트(getStaffTaskViewer)가 강사뷰면 대상 X를 돌려주므로, 막지 않으면 직접 호출 · 다른 탭의 자동 전송이 X 명의 후보를 덮고
// X 명의로 AI를 불렀다. 업무 비서는 학원 대시보드 것이라 강사뷰 화면에는 없다.
type U = { id: string; tenantId: string; systemRole: string; tenantView?: unknown };
const m = vi.hoisted(() => ({
  real: { id: "A-master", tenantId: "t1", systemRole: "master" } as U,
  // 읽기 강사뷰의 대상 X — 반을 맡은 매니저(겸직 · 강사뷰 피커에 뜬다)
  target: { id: "X-manager", tenantId: "t1", systemRole: "manager" } as U | null,
  captured: [] as { userId: string; tenantId: string }[],
  asked: [] as { userId: string }[],
  access: "readonly" as "readonly" | "full",
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async (o?: { teacherView: boolean }) => (o?.teacherView && m.target ? m.target : m.real),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => false }));
vi.mock("@/lib/auth/tenant-view", () => ({ isTenantViewWriteBlocked: async () => false }));
// 지금 요청은 '읽기' 강사뷰다 — 쓰기 가드가 있다면 이 값으로 막혀야 한다.
vi.mock("@/lib/auth/view-as", () => ({
  viewAsTeacher: async () => (m.target ? { ...m.target, access: "readonly" } : null),
  isReadonlyTeacherView: async () => !!m.target,
  readonlyTeacherViewError: async () => (m.target ? "읽기 전용 강사뷰" : null),
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({ permissions: { specialAccess: { staffTaskMonitorIds: [] } } }),
}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: () => {} }));
vi.mock("@/features/dashboard/instruments/secretary-server", () => ({
  captureSecretaryInput: async (viewer: { user: U }) => (m.captured.push({ userId: viewer.user.id, tenantId: viewer.user.tenantId }), { ok: true }),
  askSecretary: async (viewer: { user: U }) => (m.asked.push({ userId: viewer.user.id }), { ok: true, note: { at: "x" } }),
  loadSecretaryNote: async () => ({ enabled: true, note: null, runs: [] }),
}));

import { POST as postInput } from "@/app/api/dashboard/secretary/input/route";
import { POST as postAsk } from "@/app/api/dashboard/secretary/route";

const body = () => JSON.stringify({
  today: "2026-11-05", weekday: "목", day: 5,
  candidates: [{ ref: "r1", title: "t", why: "w", count: 1, facts: [], act: "request" }],
  delegated: [], names: [],
});
const req = () => new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: body() });

beforeEach(() => {
  m.captured = []; m.asked = []; m.access = "readonly";
  m.target = { id: "X-manager", tenantId: "t1", systemRole: "manager" };
});

describe("업무 비서 라우트 — 강사뷰에서는 남기지도 정리하지도 않는다", () => {
  for (const access of ["readonly", "full"] as const) {
    it(`${access === "readonly" ? "읽기" : "전체"} 강사뷰: 후보 남기기 · AI 정리 모두 403이고 X 명의로 아무것도 하지 않는다`, async () => {
      m.access = access;
      expect((await postInput(req())).status).toBe(403);
      expect((await postAsk(req())).status).toBe(403);
      expect(m.captured).toEqual([]);
      expect(m.asked).toEqual([]);
    });
  }
  it("평소(강사뷰 아님)에는 본인 명의로 그대로 동작한다", async () => {
    m.target = null;
    expect((await postInput(req())).status).toBe(200);
    expect((await postAsk(req())).status).toBe(200);
    expect(m.captured).toEqual([{ userId: "A-master", tenantId: "t1" }]);
    expect(m.asked).toEqual([{ userId: "A-master" }]);
  });
});
