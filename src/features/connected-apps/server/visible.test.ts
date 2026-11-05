// 연결 앱 — 바깥 앱에 그 사람으로 로그인시키는 인증(SSO) 입구라 **실제 로그인 계정** 기준이고, '다른 강사 뷰' 중에는 세우지도 열지도 않는다
// (적대 리뷰 2026-11-05: 강사뷰 대상의 과목으로 판정하면 영어 전담 A가 수학 강사 X 화면에서 A 신원의 표를 받았다).
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  viewAs: vi.fn(),
  superAdmin: vi.fn(),
  subjectsById: {} as Record<string, string[]>,
  asked: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: (fn: unknown) => fn }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: m.viewAs }));
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
vi.mock("@/features/connected-apps/sso", () => ({
  usableSsoSecret: () => "s".repeat(64),
  signSsoToken: (payload: Record<string, unknown>) => `TOKEN(${JSON.stringify(payload)})`,
}));
vi.mock("@/features/integrations/todays-math/sync-server", () => ({
  sourceBindingForTenant: () => null,
  sourceControl: vi.fn(),
  syncErrorResponse: vi.fn(),
}));

import { getMyConnectedApps } from "./visible";
import { GET } from "@/app/api/connected-apps/todays-math/launch/route";

const A = { id: "a-eng", tenantId: "t1", systemRole: "master", email: "a@x", displayName: "영어원장" };
const X = { id: "x-math", tenantId: "t1", systemRole: "teacher", email: "x@x", displayName: "수학선생" };
const launch = async () => (await GET(new Request("https://app.test/api/connected-apps/todays-math/launch"))).headers.get("location");

beforeEach(() => {
  vi.clearAllMocks();
  m.asked = [];
  m.subjectsById = { "a-eng": ["english"], "x-math": ["math"], "a-math": ["math"] };
  m.superAdmin.mockResolvedValue(false);
  m.viewAs.mockResolvedValue(null);
  // getCurrentUser({ teacherView: true })를 부르면 X가 나온다 — 이 판정이 그 길을 쓰지 않는지 본다.
  m.user.mockImplementation(async (o?: { teacherView?: boolean }) => (o?.teacherView ? X : A));
});

describe("연결 앱 — 실제 계정 기준", () => {
  it("평소: 실제 계정의 과목으로 판정한다(영어 전담 A는 오늘 수학이 안 선다)", async () => {
    expect(await getMyConnectedApps()).toEqual([]);
    expect(m.asked).toEqual(["a-eng"]);
    expect(m.user).not.toHaveBeenCalledWith({ teacherView: true });
  });

  it("평소: 수학 담당 실제 계정에는 선다", async () => {
    m.user.mockResolvedValue({ ...A, id: "a-math" });
    expect((await getMyConnectedApps()).map((a) => a.feature)).toEqual(["todays_math"]);
  });

  it("🔴 강사뷰 중에는 세우지 않는다 — 대상 X(수학)의 과목을 빌리지 않는다", async () => {
    m.viewAs.mockResolvedValue({ ...X, access: "full" });
    m.user.mockResolvedValue({ ...A, id: "a-math" });
    expect(await getMyConnectedApps()).toEqual([]);
  });
});

describe("오늘 수학 출발 라우트", () => {
  it("평소: 영어 전담 A는 출발이 막힌다(/home)", async () => {
    expect(await launch()).toBe("https://app.test/home");
  });

  it("🔴 강사뷰(대상 = 수학 X)에서 A가 주소를 쳐도 표를 받지 못한다(/home)", async () => {
    m.viewAs.mockResolvedValue({ ...X, access: "full" });
    const loc = await launch();
    expect(loc).toBe("https://app.test/home");
    expect(decodeURIComponent(loc ?? "")).not.toContain("TOKEN");
  });

  it("평소: 수학 담당 실제 계정은 자기 신원(sub)의 표를 받는다", async () => {
    m.user.mockResolvedValue({ ...A, id: "a-math" });
    const loc = decodeURIComponent((await launch()) ?? "");
    expect(loc).toContain('"sub":"a-math"');
  });
});
