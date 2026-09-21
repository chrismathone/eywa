import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HUB_GROUPS, SUPPORT_GROUPS, hubGroupsFor } from "@/lib/menu-hub";
import { MENU_ACCESS, type AccessMatrix } from "@/lib/permissions";

/**
 * 감사로그 **읽기**는 원장(master)·총괄(super_admin) 전용이다 — 원장 2026-09-09 *"감사로그는 마스터
 * 이상급으러만"*. 자물쇠는 RLS(0253a·0253b)이고 화면은 그 사실을 반영할 뿐이다([[#77]]).
 *
 * 이 가드가 잠그는 것은 **두 번 실제로 어긋났던 것들**이다:
 *  ① 화면이 정책보다 넓었다 — 이 학원은 `owner` 메뉴를 admin·manager에게 위임해 뒀는데(실측 활성 11명)
 *     `/owner`의 감사로그 면이 그들에게 그대로 서 있었다. 눌러도 **에러 없이 빈 목록**이라 고장으로 안 보인다.
 *  ② 정책이 총괄을 빠뜨렸다 — 0253a가 `auth_system_role() in ('master','super_admin')`으로 썼는데
 *     `system_role` enum엔 **`super_admin` 값이 없다**(총괄은 별도 표 `super_admins` + `is_super_admin()`).
 *     그래서 그 가지는 죽은 코드였고 실제 총괄 1명이 0행을 받고 있었다 → 0253b가 바로잡았다.
 */

const REPO = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

const AUDIT_HREF = "/owner?tab=audit";
const matrix: AccessMatrix = MENU_ACCESS;

/** owner 메뉴가 열려 있는 계정 — 이 학원의 실제 배선(admin·manager 위임)을 재현한다. */
const delegatedOwner: AccessMatrix = {
  ...matrix,
  owner: { ...matrix.owner, admin: "full", manager: "full" },
};

function auditDestVisible(gate: Parameters<typeof hubGroupsFor>[1]): boolean {
  return hubGroupsFor([...HUB_GROUPS, ...SUPPORT_GROUPS], gate)
    .flatMap((g) => g.items)
    .some((d) => d.href === AUDIT_HREF);
}

describe("감사로그 읽기 게이트 — 원장·총괄만", () => {
  it("🔴 원장(master)은 감사로그 입구를 본다", () => {
    expect(auditDestVisible({ systemRole: "master", permMatrix: delegatedOwner, isMaster: true })).toBe(true);
  });

  it("🔴 학원 설정을 위임받은 admin·manager에게는 입구가 서지 않는다(눌러 봐야 빈 목록 = 조용한 거짓말)", () => {
    for (const role of ["admin", "manager"] as const) {
      expect(
        auditDestVisible({ systemRole: role, permMatrix: delegatedOwner, isMaster: false }),
        `${role}에게 감사로그 입구가 남아 있다`,
      ).toBe(false);
    }
  });

  it("🔴 총괄(super_admin)은 system_role이 master가 아니어도 입구를 본다 — 총괄은 모든 게이트를 자동 통과한다", () => {
    // 실측: 총괄 2명 중 1명의 users.system_role은 'admin'이다. `systemRole === "master"`만 보면 잠긴다.
    expect(auditDestVisible({ systemRole: "admin", permMatrix: delegatedOwner, isMaster: true })).toBe(true);
  });
});

describe("감사로그 게이트 배선 — 한쪽만 고치면 화면과 정책이 갈린다", () => {
  it("🔴 /owner 면 목록과 본문이 **같은 판정**(canReadAudit)을 통과한다", () => {
    const src = read("src/app/(shell)/owner/page.tsx");
    // 면 목록에서 감사로그를 거른다.
    expect(src, "면 목록이 권한을 안 본다").toMatch(/facesFor\(canReadAudit[,)]/); // 둘째 인자 = 설정 '기능' 면(일반판만, 2026-09-22)
    // 주소를 직접 쳐도 조회가 안 돈다 — 감추기만 하면 그건 게이트가 아니다([[#77]]).
    expect(src.replace(/\s+/g, " "), "본문이 권한 없이 AuditFace를 그린다").toMatch(
      /tab === "audit" \? \( canReadAudit \? \( <AuditFace/,
    );
    // 총괄을 빠뜨리지 않는다.
    expect(src, "canReadAudit이 총괄을 안 본다").toMatch(/canReadAudit\s*=\s*isMaster\s*\|\|\s*\(await isCurrentUserSuperAdmin\(\)\)/);
  });

  it("🔴 사이드바·허브·검색 팰릿의 master 전용 판정에 총괄이 함께 들어간다", () => {
    // 검색 팰릿이 셋째 입구다 — 09-10 브랜치 뒤에 main이 붙인 입구라 처음엔 빠져 있었다(적대 리뷰 2026-09-15).
    for (const rel of [
      "src/components/app-sidebar.tsx",
      "src/components/workspace/menu-hub-panel.tsx",
      "src/components/command-palette.tsx",
    ]) {
      expect(read(rel), `${rel}: 총괄이 master 전용 목적지에서 빠진다`).toMatch(
        /isMaster:\s*systemRole === "master" \|\| isSuperAdmin/,
      );
    }
    // 🔴 판정만 있고 값을 안 넘기면 기본값 false로 조용히 빠진다 — 셸이 팰릿에 실제로 넘기는지.
    expect(
      read("src/app/(shell)/layout.tsx").replace(/\s+/g, " "),
      "셸이 검색 팰릿에 isSuperAdmin을 안 넘긴다",
    ).toMatch(/<CommandPalette [^>]*isSuperAdmin=\{isSuperAdmin\}/);
  });

  it("🔴 가장 최근 audit_logs SELECT 정책이 총괄을 `is_super_admin()`으로 알아본다(enum 값이 아니라)", () => {
    const dir = join(REPO, "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql") && /audit_logs/.test(f) && /select|read/.test(f))
      .sort();
    expect(files.length, "audit_logs select 정책 마이그레이션을 못 찾음 — 스캔 방식을 갱신할 것").toBeGreaterThan(0);
    const latest = readFileSync(join(dir, files[files.length - 1]), "utf8");
    const body = latest
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    expect(body, "총괄 판정이 없다 — system_role enum엔 super_admin 값이 없어 그 리터럴은 죽은 코드다").toContain(
      "is_super_admin",
    );
    expect(body, "테넌트 격리가 빠졌다 — 총괄이라도 남의 학원 로그가 이 화면에 섞이면 안 된다").toContain(
      "auth_tenant_id()",
    );
  });
});
