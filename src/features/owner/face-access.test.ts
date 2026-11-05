import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyUserOverrides, resolveMatrix, type AccessMatrix, type PermissionOverride, type SystemRole } from "@/lib/permissions";
import { canOpenOwnerFace, fallbackOwnerFace, ownerFaceHref, ownerFaceMenu, type OwnerFaceGate } from "./face-access";
import { OWNER_FACES } from "./tabs";

/**
 * 학원 설정 면의 입구 판정(2026-10-06).
 *
 * 설정은 면마다 권한이 따로다. 운영 설정만 위임받은 사람이 왼쪽 '설정'을 누르면 기본 면(프로필)으로 가는데, 그 면의 권한이
 * 없어서 **운영실로 튕겼다** — 맡은 면이 있는데도 설정에 못 들어갔다. 요청한 면의 권한이 없으면 열 수 있는 첫 면으로 보낸다.
 */
const grant = (role: SystemRole, menus: readonly string[], access: "full" | "readonly" = "full"): PermissionOverride[] =>
  menus.map((menu) => ({ menu, role, access }) as PermissionOverride);
const gate = (systemRole: SystemRole, matrix: AccessMatrix, extra: Partial<OwnerFaceGate> = {}): OwnerFaceGate => ({
  systemRole,
  matrix,
  isMasterLevel: systemRole === "master",
  isGeneric: false,
  ...extra,
});
const DEFAULTS = resolveMatrix([]);

describe("면의 권한 키", () => {
  it("설정별 권한이 있는 면은 그 키, 나머지는 학원 설정", () => {
    expect(ownerFaceMenu("profile")).toBe("profile_settings");
    expect(ownerFaceMenu("operations")).toBe("operations_settings");
    expect(ownerFaceMenu("subjects")).toBe("operations_settings");
    expect(ownerFaceMenu("sheets")).toBe("integration_settings");
    expect(ownerFaceMenu("popups")).toBe("popup_settings");
    for (const key of ["permissions", "dashboard", "data", "import", "audit", "modules"] as const) expect(ownerFaceMenu(key)).toBe("owner");
  });
});

describe("요청한 면의 권한이 없을 때 보낼 면", () => {
  it("🔴 운영 설정만 맡은 사람이 기본 면(프로필)으로 오면 운영 체계로 보낸다 — 운영실로 튕기지 않는다", () => {
    const matrix = resolveMatrix(grant("manager", ["operations_settings"]));
    expect(fallbackOwnerFace("profile", gate("manager", matrix))?.key).toBe("operations");
  });

  it("맡은 면이 여럿이면 면 목록 순서로 첫 면", () => {
    const matrix = resolveMatrix(grant("manager", ["popup_settings", "billing_settings", "notification_settings"]));
    expect(fallbackOwnerFace("profile", gate("manager", matrix))?.key).toBe("billing");
  });

  it("조회만 맡은 면도 후보다(열 수는 있다)", () => {
    const matrix = resolveMatrix(grant("manager", ["consultation_settings"], "readonly"));
    expect(fallbackOwnerFace("profile", gate("manager", matrix))?.key).toBe("consultations");
  });

  it("개인별 예외로 받은 면도 후보다 — 최종 권한 표로 판정한다", () => {
    const person = "11111111-1111-4111-8111-111111111111";
    const matrix = applyUserOverrides(DEFAULTS, person, "teacher", [{ userId: person, menu: "integration_settings", access: "full" }]);
    expect(fallbackOwnerFace("profile", gate("teacher", matrix))?.key).toBe("sheets");
    // 다른 사람의 예외는 이 사람의 후보가 아니다.
    expect(fallbackOwnerFace("profile", gate("teacher", DEFAULTS))).toBeNull();
  });

  it("요청한 면의 권한이 있으면 보내지 않는다", () => {
    const matrix = resolveMatrix(grant("manager", ["profile_settings", "operations_settings"]));
    expect(fallbackOwnerFace("profile", gate("manager", matrix))).toBeNull();
    expect(fallbackOwnerFace("operations", gate("manager", matrix))).toBeNull();
  });

  it("맡은 면이 하나도 없으면 보낼 곳이 없다(기존 가드가 처리한다)", () => {
    expect(fallbackOwnerFace("profile", gate("teacher", DEFAULTS))).toBeNull();
    expect(fallbackOwnerFace("audit", gate("viewer", DEFAULTS))).toBeNull();
  });

  it("🔴 요청한 면 자신으로는 보내지 않는다(같은 권한 키를 쓰는 다른 면으로는 보낼 수 있다)", () => {
    // 역할·권한 · 데이터 정리 · 감사로그는 같은 키(학원 설정)를 쓴다 — 그 키가 없으면 셋 다 후보가 아니다.
    const matrix = resolveMatrix(grant("manager", ["operations_settings"]));
    for (const requested of ["permissions", "data", "audit"] as const) {
      const fallback = fallbackOwnerFace(requested, gate("manager", matrix));
      expect(fallback?.key).toBe("operations");
      expect(fallback?.key).not.toBe(requested);
    }
  });

  describe("🔴 안내 문구뿐인 면으로 보내지 않는다 — 원장 위 전용 · 일반판 전용 · 원장만 고치는 면", () => {
    // 학원 설정(owner)만 위임받은 관리자: 그 키를 쓰는 면은 역할·권한 · 대시보드 관리 · 데이터 정리 · 가져오기 · 감사로그 · 기능.
    const matrix = resolveMatrix(grant("admin", ["owner"]));

    it("위임 계정 → 원장 위 전용(대시보드 관리 · 감사로그)과 원장만 고치는 역할·권한을 건너뛰고 쓸 수 있는 면으로", () => {
      const fallback = fallbackOwnerFace("profile", gate("admin", matrix));
      // 역할·권한이 목록에서 먼저지만 위임 계정에게 그 본문은 안내뿐이다 → 다음으로 쓸 수 있는 면(데이터 정리).
      expect(fallback?.key).toBe("data");
      expect(canOpenOwnerFace("dashboard", gate("admin", matrix))).toBe(false);
      expect(canOpenOwnerFace("audit", gate("admin", matrix))).toBe(false);
      // 입구(탭) 자체는 선다 — 직접 오면 그 면이 왜 못 바꾸는지 안내한다.
      expect(canOpenOwnerFace("permissions", gate("admin", matrix))).toBe(true);
    });

    it("학원 설정 + 메뉴 구성을 맡은 위임 계정 → 바로 쓸 수 있는 '탭 및 메뉴 구성'으로(안내뿐인 역할·권한이 아니라)", () => {
      const both = resolveMatrix(grant("admin", ["owner", "navigation_settings"]));
      expect(fallbackOwnerFace("profile", gate("admin", both))?.key).toBe("navigation");
    });

    it("원장 위 계정(역할은 관리자)에게도 역할·권한 본문은 안내뿐이다 — 폼의 조건은 '역할이 원장'이다", () => {
      const level = gate("admin", resolveMatrix(grant("admin", ["owner"])), { isMasterLevel: true });
      // 원장 위 전용 면은 쓸 수 있으므로 그리로 간다 — 목록에서 먼저 나오는 보강 운영.
      expect(fallbackOwnerFace("profile", level)?.key).toBe("makeups");
    });

    it("원장 위(역할은 관리자) → 원장 위 전용 면도 열 수 있다", () => {
      const level = gate("admin", matrix, { isMasterLevel: true });
      expect(canOpenOwnerFace("dashboard", level)).toBe(true);
      expect(canOpenOwnerFace("audit", level)).toBe(true);
    });

    it("'기능' 면은 일반판 + 원장 위일 때만", () => {
      expect(canOpenOwnerFace("modules", gate("admin", matrix, { isMasterLevel: true }))).toBe(false);
      expect(canOpenOwnerFace("modules", gate("admin", matrix, { isGeneric: true }))).toBe(false);
      expect(canOpenOwnerFace("modules", gate("admin", matrix, { isGeneric: true, isMasterLevel: true }))).toBe(true);
      // 일반판 원장 위라도 학원 설정 권한이 없으면 아니다.
      expect(canOpenOwnerFace("modules", gate("admin", DEFAULTS, { isGeneric: true, isMasterLevel: true }))).toBe(false);
    });

    it("원장 위 전용 면에 위임 계정이 **권한은 있는 채로** 오면 보내지 않는다 — 그 면이 직접 안내한다", () => {
      expect(fallbackOwnerFace("audit", gate("admin", matrix))).toBeNull();
      expect(fallbackOwnerFace("dashboard", gate("admin", matrix))).toBeNull();
    });
  });

  it("원장은 어디로도 보내지지 않는다(모든 면의 권한이 있다)", () => {
    for (const face of OWNER_FACES) expect(fallbackOwnerFace(face.key, gate("master", DEFAULTS, { isGeneric: true })), face.key).toBeNull();
  });
});

describe("보낼 주소", () => {
  it("창(embed) 안에서는 embed 표식을 유지한다 — 빼면 창 안에 전체 화면 틀이 뜬다", () => {
    expect(ownerFaceHref({ href: "/owner" }, false)).toBe("/owner");
    expect(ownerFaceHref({ href: "/owner" }, true)).toBe("/owner?embed=1");
    expect(ownerFaceHref({ href: "/owner?tab=operations" }, false)).toBe("/owner?tab=operations");
    expect(ownerFaceHref({ href: "/owner?tab=operations" }, true)).toBe("/owner?tab=operations&embed=1");
  });
});

describe("배선 — 설정 화면", () => {
  const page = readFileSync(join(process.cwd(), "src", "app", "(shell)", "owner", "page.tsx"), "utf8");
  const code = page.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("보내는 판정은 최종 권한 표로 하고, 도착한 면은 제 가드를 다시 지난다", () => {
    expect(code).toContain("const matrix = await getUserPermMatrix();");
    expect(code).toContain("if (!canAccess(actor.systemRole, menu, matrix)) {");
    expect(code).toContain('if (fallback) redirect(ownerFaceHref(fallback, sp.embed === "1"));');
    // 보낸 뒤에도, 보내지 않은 때도 가드는 그대로 선다(이 판정은 허락이 아니다).
    expect(code.indexOf("const viewer = await requireAccess(menu);")).toBeGreaterThan(code.indexOf("fallbackOwnerFace("));
  });

  it("🔴 '기능' 면의 게이트는 학원 설정 권한이다(일반판에서만) — 침산에서는 기본 면의 게이트로 떨어진다", () => {
    expect(code).toMatch(/const requestedFace: OwnerFaceKey =\s*sp\.tab === "modules" && isGenericTenant\(await getTenantSettings\(\)\) \? "modules" : requested;/);
    expect(code).toContain("const menu = ownerFaceMenu(requestedFace);");
    expect(ownerFaceMenu("modules")).toBe("owner");
  });

  it("탭 목록도 같은 권한 키로 거른다('기능' 포함)", () => {
    expect(code).toContain("OWNER_FACES.map(async (face) => [face.key, await canAccessTenant(viewer.systemRole, ownerFaceMenu(face.key))] as const)");
    expect(code).toContain(".filter((face) => allowedTabs.get(face.key))");
  });

  it("🔴 자체 판정을 하는 면(데이터 정리 · 데이터 가져오기 · 감사로그 · 강사평가)은 학원 설정 fieldset 밖에 선다", () => {
    // 2026-10-22 원생 기여도 설정 면(contribution)이 같은 자리(자체 판정 · fieldset 밖)로 더해졌다.
    expect(code).toContain('const SELF_GATED_TABS: ReadonlySet<OwnerTab | "modules"> = new Set(["data", "import", "audit", "evaluation", "contribution"]);');
    const fieldsetEnd = code.indexOf("</fieldset>");
    expect(fieldsetEnd).toBeGreaterThan(-1);
    for (const tag of ["<DataFace ", "<DuplicatesFace ", "<ImportHubFace ", "<AuditFace ", "<EvaluationFace ", "<ContributionSettingsFace "]) {
      expect(code.indexOf(tag), tag).toBeGreaterThan(fieldsetEnd);
    }
    // 설정 '읽기 권한' 안내도 이 면들에는 서지 않는다(섹션 폼 면은 폼이 직접 적는다 — FACE_WRITES_OWN_NOTE, 2026-11-05).
    expect(code).toContain("!canEditSettings && !FACE_WRITES_OWN_NOTE.has(tab) && !SELF_GATED_TABS.has(tab)");
  });
});
