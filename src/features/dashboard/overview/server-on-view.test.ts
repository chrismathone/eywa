import { describe, expect, it, vi } from "vitest";
import type { ResolvedView } from "@/features/dashboard/layout/view";

/**
 * `loadOverview`의 `onView` — 운영실 본문 뼈대(`overview-server.tsx`의 Suspense fallback)가 이 알림을 기다린다.
 * 🔴 알림이 무거운 영역 조회 **뒤로** 밀리면(또는 빠지면) 뼈대가 스냅샷 끝까지 안 떠 원장 첫 화면이 옛 loading 그대로 머문다.
 * 실제 `loadOverview`를 부르되 가벼운 판정 재료(사용자·권한·설정·역할)만 가짜로 두고, 배치는 공지 카드 하나 → 무거운 조회는
 * `getRecentAnnouncements` 하나뿐이다. 그 조회를 붙잡아 둔 채 알림이 왔는지 본다.
 */
const mocks = vi.hoisted(() => {
  const gate: { release: (rows: unknown[]) => void } = { release: () => undefined };
  return {
    gate,
    bundle: vi.fn(async (_viewer: unknown) => ({ bundle: "accountant", subjects: [], subjectScoped: false })),
    notices: vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          gate.release = resolve;
        }),
    ),
    settings: {
      profile: { name: "테스트 학원" },
      operations: { subjects: [] },
      modules: { disabled: [] },
      dashboard: { version: 1, layouts: [{ role: "accountant", items: [{ id: "panel:notices", w: 6, h: 1 }] }], assignments: [] },
    },
  };
});
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: vi.fn(async () => ({ id: "u1", tenantId: "t1", systemRole: "master" })) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ getUserPermMatrix: vi.fn(async () => ({})) }));
vi.mock("@/lib/permissions", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/permissions")>()), canAccess: () => true }));
vi.mock("@/lib/auth/view-mode", () => ({ effectiveTeacherId: vi.fn(async () => null) }));
vi.mock("@/lib/auth/teacher-scope", () => ({ getTeacherScope: vi.fn(async () => null) }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn(async () => mocks.settings) }));
vi.mock("@/features/dashboard/layout/viewer-server", () => ({
  loadViewerBundle: mocks.bundle,
}));
// '다른 강사 뷰' — 로그인 계정(원장 u1)이 회계 직원 x의 화면을 연다. 운영실의 사람(배치·공지 대상)은 x다.
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async (o?: { teacherView: boolean }) =>
    o?.teacherView ? { id: "x", tenantId: "t1", systemRole: "accountant" } : { id: "u1", tenantId: "t1", systemRole: "master" }),
}));
vi.mock("@/features/dashboard/server/queries", () => ({
  getRecentAnnouncements: mocks.notices,
  getAbsenceRiskStudents: vi.fn(),
  getAbsenceRiskAnchor: vi.fn(),
  getAbsenceBreakdown: vi.fn(),
}));

import { loadOverview } from "./server";

describe("loadOverview onView — 배치를 무거운 조회보다 먼저 알린다", () => {
  it("무거운 영역 조회가 끝나기 전에 한 번 알리고, 알린 값이 스냅샷의 view 그대로다", async () => {
    const onView = vi.fn<(view: ResolvedView) => void>();
    let settled = false;
    const snapshot = loadOverview({ onView }).finally(() => {
      settled = true;
    });
    // 무거운 조회(공지)가 시작될 때까지 — 그 조회는 아직 안 끝났다.
    await vi.waitFor(() => expect(mocks.notices, "배치 판정 뒤 공지 조회가 시작되지 않았다").toHaveBeenCalledTimes(1), { timeout: 3_000 });
    expect(onView).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    expect(onView.mock.calls[0]![0]).toMatchObject({ bundle: "accountant", mode: "grid", items: [{ id: "panel:notices" }] });
    mocks.gate.release([]);
    // 조회를 풀었는데도 안 끝나면 30초 시간 초과 대신 원인을 적고 빨리 실패한다.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const snap = await Promise.race([
      snapshot,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("공지 조회를 풀어도 스냅샷이 5초 안에 끝나지 않음")), 5_000);
      }),
    ]).finally(() => clearTimeout(timer));
    expect(snap.view).toBe(onView.mock.calls[0]![0]);
    expect(onView).toHaveBeenCalledTimes(1);
    // 강사뷰 대상 기준 — 배치 판정과 공지 대상(역할)이 로그인 계정(원장)이 아니라 대상 직원(회계)이다.
    expect(mocks.bundle).toHaveBeenCalledWith(expect.objectContaining({ id: "x", systemRole: "accountant" }));
    expect(mocks.notices).toHaveBeenCalledWith("accountant", 4);
  });
});
