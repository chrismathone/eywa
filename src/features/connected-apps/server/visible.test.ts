// 연결 앱 노출 — '다른 강사 뷰'면 대상 직원 X의 담당 과목으로 거른다(원장 2026-11-05 강사뷰 전수).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  superAdmin: vi.fn(),
  subjectsById: {} as Record<string, string[]>,
  asked: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/license/server", () => ({ isFeatureOptedIn: async () => true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => {
            m.asked.push(id);
            return { data: { subjects: m.subjectsById[id] ?? [] }, error: null };
          },
        }),
      }),
    }),
  }),
}));

import { getMyConnectedApps } from "./visible";

const A = { id: "a1", tenantId: "t1", systemRole: "master" };
const X = { id: "x1", tenantId: "t1", systemRole: "teacher" };

beforeEach(() => {
  vi.clearAllMocks();
  m.asked = [];
  m.subjectsById = { a1: ["math"], x1: ["english"] };
  m.superAdmin.mockResolvedValue(false);
});

describe("연결 앱 — 강사뷰 신원", () => {
  it("🔴 강사뷰면 대상 X(영어 전담)의 과목으로 거른다 — 원장 A(수학)의 링크가 X 화면에 서지 않는다", async () => {
    m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
    expect(await getMyConnectedApps()).toEqual([]);
    expect(m.asked).toEqual(["x1"]);
  });

  it("강사뷰가 아니면 본인 과목 그대로", async () => {
    m.user.mockResolvedValue(A);
    expect((await getMyConnectedApps()).map((a) => a.feature)).toEqual(["todays_math"]);
    expect(m.asked).toEqual(["a1"]);
  });
});
