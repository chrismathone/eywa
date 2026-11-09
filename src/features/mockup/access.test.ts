import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MENU_ACCESS } from "@/lib/permissions";

/**
 * 시안 화면의 문(2026-11-09 권한 줄 정비) — 코드의 역할 판정 대신 제 권한 키를 본다.
 *  · 경영 분석·지식그래프 = management · 조직·OKR = okr · 연간 운영계획·홍보·마케팅 = marketing · 업무 작성센터 = work_records
 *  · 운영 계정은 늘 통과(결정 로그 2026-08-13) — 권한 판정을 부르지 않는다.
 *  · 메뉴 판의 그 버튼도 같은 키를 쓴다(menu-hub) — 메뉴엔 보이는데 페이지가 대시보드로 돌려보내는 일이 없게.
 */
const m = vi.hoisted(() => ({ superAdmin: false, required: [] as string[], user: { id: "u-1", systemRole: "manager" } }));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => m.superAdmin }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/require-access", () => ({
  requireAccess: async (menu: string) => {
    m.required.push(menu);
    return m.user;
  },
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect:${to}`); } }));

const { requireManagementSample } = await import("./access");
const marketing = await import("@/features/marketing/sample-access");
const okr = await import("@/features/organization-okr/sample-access");

beforeEach(() => {
  m.superAdmin = false;
  m.required = [];
});

describe("시안 화면의 문 = 제 권한 키", () => {
  it("경영 분석·지식그래프 → management · 홍보·마케팅 → marketing · 조직·OKR → okr", async () => {
    await requireManagementSample();
    await marketing.requireSampleViewer();
    await okr.requireSampleViewer();
    expect(m.required).toEqual(["management", "marketing", "okr"]);
  });

  it("운영 계정은 권한 판정 없이 통과", async () => {
    m.superAdmin = true;
    await requireManagementSample();
    await marketing.requireSampleViewer();
    await okr.requireSampleViewer();
    expect(m.required).toEqual([]);
  });

  it("업무 작성센터 두 화면은 work_records로 막는다(전엔 대시보드 권한)", () => {
    for (const file of ["src/app/(shell)/work-records/page.tsx", "src/app/(shell)/work-records/knowledge/page.tsx"]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      expect(src, file).toContain('requireAccess("work_records")');
      expect(src, file).not.toContain('requireAccess("dashboard")');
    }
  });

  it("🔴 임시 기본값 = 권한 줄을 만들기 전 코드가 열던 역할 그대로(원장 결정 전 — 지금 쓰는 사람을 잠그지 않는다)", () => {
    const open = (menu: keyof typeof MENU_ACCESS) => Object.entries(MENU_ACCESS[menu]).filter(([, a]) => a !== "none").map(([r]) => r).sort();
    expect(open("management")).toEqual(["admin", "master"]);
    expect(open("okr")).toEqual(["admin", "manager", "master"]);
    expect(open("marketing")).toEqual(["admin", "manager", "master"]);
    expect(MENU_ACCESS.work_records).toEqual(MENU_ACCESS.dashboard);
  });
});
