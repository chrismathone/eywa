import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * makeedu 수동 전송 게이트(`canPushToMakeedu`) — 콜&상담 머리글 'makeedu 보내기' 버튼과 전송 서버 액션이 함께 쓴다.
 * 권한 매트릭스(perm-matrix·permissions·modules)는 **실물**을 태우고 학원 설정·로그인만 바꿔 끼운다 — 모듈이 꺼진
 * 지점이 "흔적 없이" 막히는 건 매트릭스 맨 끝의 capDisabledModules 덕분이라, 그 연결을 실제로 지나가야 의미가 있다.
 */
const g = vi.hoisted(() => ({
  role: "master" as string,
  disabled: [] as string[],
  overrides: [] as { menu: string; role: string; access: string }[],
  userOverrides: [] as { userId: string; menu: string; access: string }[],
  superAdmin: false,
  readonlyView: false,
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => ({
    preset: "generic",
    permissions: { overrides: g.overrides, userOverrides: g.userOverrides },
    modules: { disabled: g.disabled },
  }),
}));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: async () => ({ id: "u-1", tenantId: "t-1", systemRole: g.role }),
}));
vi.mock("@/lib/auth/super-admin", () => ({ isCurrentUserSuperAdmin: async () => g.superAdmin, isSignedInSuperAdmin: async () => g.superAdmin }));
// 실물과 같은 관계로 바꿔 끼운다 — 열람 전용 판정은 '보는 대상 강사'에서 나온다(`isReadonlyTeacherView` = 대상의 access가 readonly).
// 🔑 매트릭스(`getUserPermMatrix`)가 대상 강사를 직접 묻기 때문에(2026-10-07 — 강사 뷰는 그 강사의 권한을 따른다) 둘 다 있어야 한다.
vi.mock("@/lib/auth/view-as", () => ({
  viewAsTeacher: async () => (g.readonlyView ? { id: "u-9", tenantId: "t-1", systemRole: "teacher", access: "readonly" } : null),
  isReadonlyTeacherView: async () => g.readonlyView,
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true, isFeatureOptedIn: async () => false }));
// 실험실 덮개(perm-matrix capLaboratory)는 평소 상태로 — `integrations`는 실험실에 배정되지 않았고 지점은 실험실 꺼짐.
// 실물은 DB로 배정표를 읽고, 조회가 실패하면 배정 가능한 메뉴 전부(`integrations` 포함)를 닫아 이 게이트와 무관하게 막힌다.
vi.mock("@/lib/laboratory/server", () => ({ getLaboratoryMenus: async () => ["student_contribution"] }));

import { canPushToMakeedu } from "./makeedu-push-access";
import type { SystemRole } from "@/lib/permissions";

beforeEach(() => {
  g.role = "master";
  g.disabled = [];
  g.overrides = [];
  g.userOverrides = [];
  g.superAdmin = false;
  g.readonlyView = false;
});

describe("canPushToMakeedu — 버튼과 전송 액션의 한 게이트", () => {
  it("기본값: 원장·관리자·실장만 보낸다", async () => {
    for (const role of ["master", "admin", "manager"] as SystemRole[]) {
      g.role = role;
      expect(await canPushToMakeedu(role)).toBe(true);
    }
    for (const role of ["teacher", "counselor", "accountant", "viewer"] as SystemRole[]) {
      g.role = role;
      expect(await canPushToMakeedu(role)).toBe(false);
    }
  });

  it("makeedu 모듈이 꺼진 지점은 원장도 못 연다(흔적 없이)", async () => {
    g.disabled = ["makeedu"];
    expect(await canPushToMakeedu("master")).toBe(false);
  });

  // super_admin 병합 분기는 override가 있어야 탄다(perm-matrix getPermMatrix) — 대조군(모듈 켜짐 = 열림)과 함께 본다.
  it("super_admin 병합(원장이 잠근 셀을 기본값으로 되살림)도 꺼진 모듈은 못 연다", async () => {
    g.superAdmin = true;
    g.overrides = [{ menu: "integrations", role: "master", access: "none" }];
    expect(await canPushToMakeedu("master")).toBe(true); // 대조군: 병합이 잠금을 무시한다
    g.disabled = ["makeedu"];
    expect(await canPushToMakeedu("master")).toBe(false);
  });

  it("개인 예외로 연 강사도 꺼진 모듈에선 막힌다", async () => {
    g.role = "teacher";
    g.userOverrides = [{ userId: "u-1", menu: "integrations", access: "full" }];
    expect(await canPushToMakeedu("teacher")).toBe(true); // 대조군: 개인 예외가 실제로 연다
    g.disabled = ["makeedu"];
    expect(await canPushToMakeedu("teacher")).toBe(false);
  });

  it("원장이 역할·권한 면에서 닫으면 그 역할은 막힌다(override 반영)", async () => {
    g.role = "manager";
    g.overrides = [{ menu: "integrations", role: "manager", access: "none" }];
    expect(await canPushToMakeedu("manager")).toBe(false);
  });

  it("열람 전용(readonly)·'다른 강사 뷰'에선 보내지 못한다", async () => {
    g.role = "admin";
    g.overrides = [{ menu: "integrations", role: "admin", access: "readonly" }];
    expect(await canPushToMakeedu("admin")).toBe(false);
    g.overrides = [];
    g.readonlyView = true;
    expect(await canPushToMakeedu("admin")).toBe(false);
  });
});
