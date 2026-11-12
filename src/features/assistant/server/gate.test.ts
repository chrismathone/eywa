import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 학원 비서의 문(assistantViewer) — 학원 설정 → 역할·권한의 '학원 비서' 권한으로 판정한다(원장 2026-11-09 *"기본 디폴트로 원장하고 나머지 비활성화"*).
 * 지키는 것: ① 권한(`canAccessTenant("assistant")` — 학원 설정·개인별 권한 반영) 또는 운영 계정만 통과 ② 지점 보기 · 다른 강사 뷰는 권한과 무관하게 막는다
 * ③ 화면(셸 레이아웃의 단추·단축키)도 같은 함수를 지난다 — 화면엔 보이는데 서버가 막는 일이 없게.
 */
const m = vi.hoisted(() => ({
  user: null as null | { id: string; tenantId: string; systemRole: string; tenantView?: unknown },
  allowed: false,
  superAdmin: false,
  viewAs: null as null | { id: string },
  asked: [] as [string, string][],
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canAccessTenant: async (role: string, menu: string) => {
    m.asked.push([role, menu]);
    return m.allowed;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => m.superAdmin }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: async () => m.viewAs }));

const { assistantViewer, isGateFailure } = await import("./gate");

beforeEach(() => {
  m.user = { id: "u-1", tenantId: "t-1", systemRole: "admin" };
  m.allowed = false;
  m.superAdmin = false;
  m.viewAs = null;
  m.asked = [];
});

describe("학원 비서 문 = '학원 비서' 권한", () => {
  it("권한이 있으면 통과 — 역할이 원장이 아니어도(원장이 역할·권한에서 연 경우)", async () => {
    m.allowed = true;
    const v = await assistantViewer();
    expect(isGateFailure(v)).toBe(false);
    if (!isGateFailure(v)) expect(v.owner).toEqual({ tenantId: "t-1", userId: "u-1" });
    expect(m.asked).toEqual([["admin", "assistant"]]);
  });

  it("🔴 권한이 없으면 원장 역할이어도 막는다 — 역할이 아니라 권한을 본다(원장이 원장 칸을 끈 경우)", async () => {
    m.user = { id: "u-1", tenantId: "t-1", systemRole: "master" };
    const v = await assistantViewer();
    expect(v).toEqual({ error: "학원 비서를 쓸 권한이 없습니다", status: 403 });
  });

  it("운영 계정은 권한과 무관하게 통과(결정 로그 2026-08-13)", async () => {
    m.superAdmin = true;
    expect(isGateFailure(await assistantViewer())).toBe(false);
  });

  it("🔴 지점 보기 · 다른 강사 뷰는 권한이 있어도 막는다", async () => {
    m.allowed = true;
    m.superAdmin = true;
    m.user = { id: "u-1", tenantId: "t-1", systemRole: "master", tenantView: { tenantId: "t-1" } };
    expect((await assistantViewer()) as { status: number }).toMatchObject({ status: 403 });
    m.user = { id: "u-1", tenantId: "t-1", systemRole: "master" };
    m.viewAs = { id: "teacher-1" };
    expect((await assistantViewer()) as { status: number }).toMatchObject({ status: 403 });
  });

  it("로그인이 없으면 401", async () => {
    m.user = null;
    expect(await assistantViewer()).toEqual({ error: "로그인이 필요합니다", status: 401 });
  });

  it("문구에 내부 역할 이름을 쓰지 않는다(AGENTS.md)", async () => {
    const src = readFileSync(join(process.cwd(), "src/features/assistant/server/gate.ts"), "utf8");
    const messages = [...src.matchAll(/error: "([^"]+)"/g)].map((x) => x[1]!);
    expect(messages.length).toBeGreaterThan(3);
    for (const text of messages) expect(text, text).not.toMatch(/슈퍼|super|총괄|원장만/);
  });
});

describe("지점 AI가 꺼지면 학원 비서 권한도 닫힌다(꺼진 기능은 있었는지조차 모르게)", () => {
  it("권한 표의 AI 라이선스 덮개가 AI 멘트와 함께 학원 비서를 닫는다 — 문(canAccessTenant)이 그 표를 본다", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/auth/perm-matrix.ts"), "utf8");
    const body = src.slice(src.indexOf("async function capSettingFeatures"), src.indexOf("async function capSettingFeatures") + 700);
    expect(body).toMatch(/matrix\.assistant\[role\] === "none"/);
    expect(body).toMatch(/return \{ \.\.\.matrix, ai_ment: closed, assistant: closed \};/);
  });
});

describe("🔴 화면도 같은 문을 지난다(셸 레이아웃) — 역할을 따로 적어 판정하지 않는다", () => {
  const layout = readFileSync(join(process.cwd(), "src/app/(shell)/layout.tsx"), "utf8");
  it("단추(canUseAssistant)와 창 안 단축키(embedAssistant)가 assistantViewer 결과를 쓴다", () => {
    expect(layout).toMatch(/const canUseAssistant = !isGateFailure\(await assistantViewer\(\)\)/);
    expect(layout).toMatch(/const embedAssistant =[\s\S]{0,80}!isGateFailure\(await assistantViewer\(\)\)/);
    // 옛 판정(원장 역할 직접 비교)이 다시 생기지 않게.
    const block = layout.slice(layout.indexOf("const embedAssistant"), layout.indexOf("const embedAssistant") + 300);
    expect(block).not.toMatch(/systemRole === "master"/);
  });
});
