import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_GUARD_TRIGGERS,
  judgeProtectedIntegrity,
  type IntegrityAuth,
  type IntegrityUserRow,
} from "./protected-integrity-core";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
const NOW = new Date("2026-09-30T00:00:00Z");
const T = "t-1";
const baseline = ["a", "b", "login"];
const users: IntegrityUserRow[] = [
  { id: "a", system_role: "master", status: "active", tenant_id: T },
  { id: "b", system_role: "master", status: "active", tenant_id: T },
];
const auth = (over: Partial<IntegrityAuth> & { id: string }): IntegrityAuth => ({
  found: true,
  appRole: "master",
  appTenant: T,
  bannedUntil: null,
  deletedAt: null,
  ...over,
});
const okAuth = [auth({ id: "a" }), auth({ id: "b" }), auth({ id: "login", appRole: null, appTenant: null })];
const okTriggers = EXPECTED_GUARD_TRIGGERS.map((n) => ({ trigger_name: n, enabled: "O" }));
const run = (over: Partial<Parameters<typeof judgeProtectedIntegrity>[0]> = {}) =>
  judgeProtectedIntegrity({ members: baseline, users, auth: okAuth, triggers: okTriggers, now: NOW, baseline, ...over });
const codes = (xs: { code: string }[]) => xs.map((x) => x.code).sort();

describe("judgeProtectedIntegrity — 보호 계정 매일 점검(3선)", () => {
  it("정상이면 이상 0건(로그인 전용 계정은 직원 행이 없어도 정상)", () => {
    expect(run()).toEqual([]);
  });
  it("명단에서 빠지거나 기준 밖 계정이 추가되면 알린다", () => {
    expect(codes(run({ members: ["a", "b", "x"] }))).toEqual(["auth_missing", "member_added", "member_removed"]);
  });
  it("역할·재직·로그인 역할·지점 어긋남을 각각 잡는다", () => {
    const r = run({
      users: [{ id: "a", system_role: "admin", status: "inactive", tenant_id: T }, users[1]],
      auth: [auth({ id: "a", appRole: "teacher", appTenant: "other" }), okAuth[1], okAuth[2]],
    });
    expect(codes(r)).toEqual(["app_role_changed", "role_changed", "status_changed", "tenant_mismatch"]);
  });
  it("로그인 차단(미래)·소프트 삭제·로그인 계정 소실을 잡는다 — 지난 차단은 무시", () => {
    const r = run({
      auth: [
        auth({ id: "a", bannedUntil: "2027-01-01T00:00:00Z" }),
        auth({ id: "b", bannedUntil: "2026-01-01T00:00:00Z", deletedAt: "2026-09-29T00:00:00Z" }),
        { ...okAuth[2], found: false },
      ],
    });
    expect(codes(r)).toEqual(["auth_banned", "auth_deleted", "auth_missing"]);
  });
  it("직원 행이 지워졌는데 로그인 계정엔 역할이 남아 있으면 잡는다", () => {
    expect(codes(run({ users: [users[1]] }))).toEqual(["users_row_missing"]);
  });
  it("가드 트리거가 없거나 꺼지면 잡는다 · 조회 불가(null)는 판정에서 뺀다", () => {
    const tr = okTriggers.filter((t) => t.trigger_name !== "tg_guard_super_admins")
      .map((t) => (t.trigger_name === "tg_guard_protected_users" ? { ...t, enabled: "D" } : t));
    expect(codes(run({ triggers: tr }))).toEqual(["trigger_disabled", "trigger_missing"]);
    expect(run({ triggers: null })).toEqual([]);
  });
});

describe("배선 — 점검이 매일 돈다", () => {
  it("notification-maintenance 크론이 보호 계정 점검을 부르고, 앞 단계 실패로 건너뛰지 않는다", () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/cron/notification-maintenance/route.ts"),
      "utf8",
    );
    const call = route.indexOf("checkProtectedAccountIntegrity(");
    expect(call).toBeGreaterThan(-1);
    // 테넌트 조회 실패 시 조기 반환(return … 500)보다 **앞**에서 돌아야 한다.
    expect(call).toBeLessThan(route.indexOf("status: 500"));
  });
  it("super_admin 권한 매트릭스 — 저장된 개인 예외 none이 코드 예외(전자결재 full)를 덮지 못한다", () => {
    const pm = fs.readFileSync(path.join(process.cwd(), "src/lib/auth/perm-matrix.ts"), "utf8");
    expect(pm).toContain("applyUserOverrides(base, user.id, user.systemRole, codeOverrides)");
    expect(pm).toMatch(/mergeMostPermissive\(mergeMostPermissive\(base, applied\), codeOnly\)/);
  });
  it("0312a 트리거 목록과 코드의 기대 목록이 같다", () => {
    const sql = readMigration("0312a_protect_super_admin_accounts_hardening.sql");
    for (const n of EXPECTED_GUARD_TRIGGERS) expect(sql).toContain(`'${n}'`);
    expect(sql).toContain("new.deleted_at is not null");
  });
});
