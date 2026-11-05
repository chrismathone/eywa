import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 답글·공감의 첫 문 — '다른 강사 뷰'면 **대상 직원**이 사람이다(자격·게시 명의·'내 답글'·관리자급 판정).
 * 로그인 계정(원장)으로 판정하면 강사 X 화면에서 쓴 답글이 원장 이름으로 학부모에게 나간다(원장 2026-11-05 강사뷰 전수).
 */
const m = vi.hoisted(() => ({ user: vi.fn(), superAdmin: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: m.superAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => "admin-db" }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => "session-db" }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: m.settings }));
vi.mock("@/features/owner/classnote-gate", () => ({ classnoteReplyMode: () => "on", classnoteSendOn: () => true }));
import { replyGate, replyNotificationScope } from "./reply-gate";

const actual = { id: "actual", tenantId: "t1", systemRole: "master", displayName: "원장", email: "", jobTitle: null };
const target = { id: "target", tenantId: "t1", systemRole: "teacher", displayName: "수진", email: "", jobTitle: null };
const teacherView = () => m.user.mockImplementation(async (o?: { teacherView: boolean }) => (o?.teacherView ? target : actual));

beforeEach(() => {
  vi.clearAllMocks();
  m.superAdmin.mockResolvedValue(false);
  m.settings.mockResolvedValue({});
});

describe("replyGate — 사람은 강사뷰 대상", () => {
  it("강사뷰면 대상 강사로 열고, 관리자급은 대상 역할로 판정한다(원장 자격이 새지 않는다)", async () => {
    teacherView();
    const g = await replyGate();
    expect(m.user).toHaveBeenCalledWith({ teacherView: true });
    expect(g).toMatchObject({ ok: true, user: target, manager: false });
  });

  it("강사뷰가 아니면 본인 그대로 — 원장은 관리자급", async () => {
    m.user.mockResolvedValue(actual);
    expect(await replyGate()).toMatchObject({ ok: true, user: actual, manager: true });
  });

  it("학생·비로그인은 없는 기능", async () => {
    m.user.mockResolvedValue(null);
    expect(await replyGate()).toEqual({ ok: false, error: "사용할 수 없는 기능입니다" });
    m.user.mockResolvedValue({ ...actual, systemRole: "student" });
    expect((await replyGate()).ok).toBe(false);
  });
});

describe("replyNotificationScope — 벨 알림을 읽는 자리", () => {
  it("평소엔 세션 클라이언트(RLS = 내 알림), 받는 사람은 본인", async () => {
    m.user.mockResolvedValue(actual);
    expect(await replyNotificationScope(actual as never)).toEqual({ db: "session-db", recipients: ["actual"] });
  });

  it("강사뷰면 관리 클라이언트 + 받는 사람(대상 · 로그인 계정)을 명시한다 — DB의 auth.uid()는 로그인 계정이라 대상 알림이 RLS에 막힌다", async () => {
    teacherView();
    expect(await replyNotificationScope(target as never)).toEqual({ db: "admin-db", recipients: ["target", "actual"] });
  });
});
