// 진도맵(시안) 노출 — '다른 강사 뷰'면 대상 직원 X의 역할로 판정한다(원장 2026-11-05 강사뷰 전수).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ user: vi.fn(), superAdmin: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));

import { canPreviewProgressMap } from "./access";

const A = { id: "a1", tenantId: "t1", systemRole: "master" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher" };

beforeEach(() => {
  vi.clearAllMocks();
  m.superAdmin.mockResolvedValue(false);
});

describe("진도맵(시안) — 강사뷰 역할", () => {
  it("🔴 원장 A가 강사 X 화면을 보면 X(강사)에게 없는 시안 링크는 서지 않는다", async () => {
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
    expect(await canPreviewProgressMap()).toBe(false);
  });

  it("강사뷰가 아니면 실제 계정의 역할 그대로(원장 = 본다)", async () => {
    m.user.mockResolvedValue(A);
    expect(await canPreviewProgressMap()).toBe(true);
  });
});
