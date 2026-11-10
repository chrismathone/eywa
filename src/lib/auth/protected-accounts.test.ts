import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { protectedIdsFrom, protectionStatusOf } from "./protected-accounts-core";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
/**
 * 보호 계정(super_admins 명단) — 원장 2026-09-30 *"다음에 이런 일이 있어도 변경 안되게 강력 가드. 꼭 물어봐야하는걸로"*.
 * 순수 판정 + **모든 역할·재직·삭제 경로가 보호 문을 지나는지** 전수 배선 가드.
 */
describe("protectedIdsFrom · protectionStatusOf", () => {
  it("명단에 있는 id만 고른다", () => {
    const r = protectedIdsFrom(["a", "b", "c"], [{ id: "b" }]);
    expect([...r.protectedIds]).toEqual(["b"]);
    expect(protectionStatusOf(r, "b")).toBe("protected");
    expect(protectionStatusOf(r, "a")).toBe("clear");
  });
  it("🔴 조회 실패(null)는 '보호'가 아니라 'unknown' — 막되 거짓 거절 기록·보호 안내는 안 낸다", () => {
    const r = protectedIdsFrom(["a", "b"], null);
    expect(r.lookupFailed).toBe(true);
    expect(protectionStatusOf(r, "a")).toBe("unknown");
  });
  it("빈 명단이면 아무도 보호하지 않는다", () => {
    expect(protectionStatusOf(protectedIdsFrom(["a"], []), "a")).toBe("clear");
  });
});

const SRC = path.join(process.cwd(), "src");
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), "utf8");
/** `export async function name(` 부터 다음 `export ` 전까지 — 그 함수 본문. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name}을 찾지 못함 — 가드 스캔 갱신 필요`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("배선 — 보호 계정은 앱 어느 경로로도 역할·재직·삭제가 안 바뀐다", () => {
  it("직원관리: 역할 변경·퇴사·인계 후 퇴사·삭제가 보호 문을 먼저 지난다", () => {
    const actions = read("features/staff/server/actions.ts");
    for (const [fn, attempt] of [
      ["changeStaffRole", "role"],
      ["deactivateStaff", "status"],
      ["handoverAndDeactivate", "status"],
    ] as const) {
      const body = fnBody(actions, fn);
      const guard = body.indexOf(`refuseIfProtectedStaff(id, "${attempt}"`);
      expect(guard, `${fn}에 보호 문이 없다`).toBeGreaterThan(-1);
      // 쓰기(users update)보다 **앞**에 있어야 한다.
      const write = body.search(/\.update\(\{ (system_role|status)/);
      expect(write, `${fn}의 쓰기를 찾지 못함`).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(write);
    }
    const account = read("features/staff/server/account-actions.ts");
    const del = fnBody(account, "deleteStaff");
    expect(del.indexOf('refuseIfProtectedStaff(id, "delete"')).toBeGreaterThan(-1);
    // 삭제는 한 거래로 하는 DB 함수 호출 하나다(2026-11-11 — 전엔 auth.admin.deleteUser) · 보호 문은 그 앞에.
    const wipe = del.indexOf("deleteStaffAccount(actor.tenantId, id)");
    expect(wipe, "deleteStaff의 삭제 호출을 찾지 못함").toBeGreaterThan(-1);
    expect(del.indexOf('refuseIfProtectedStaff(id, "delete"')).toBeLessThan(wipe);
  });
  it("총괄 콘솔: 역할 변경·활성/비활성도 보호 계정이면 거절한다", () => {
    const sa = read("features/super-admin/server/actions.ts");
    for (const fn of ["changeUserRole", "setUserActive"]) {
      const body = fnBody(sa, fn);
      const guard = body.indexOf("protectionStatus(userId)");
      expect(guard, `${fn}에 보호 문이 없다`).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(body.indexOf("updateUserById"));
    }
  });
  it("엑셀 직원 가져오기는 총괄 계정을 건너뛰고 기존 직원의 역할·재직을 바꾸지 않는다", () => {
    const imp = read("features/excel-import/importers/staff.ts");
    expect(imp).toContain("superIds.has(cur.id)");
    expect(imp).toMatch(/역할은 바꾸지 않았습니다/);
  });
  it("DB 마지막 선(0309a) — users·auth.users·super_admins 세 트리거와 우회 스위치", () => {
    const sql = readMigration("0309a_protect_super_admin_accounts.sql");
    expect(sql).toContain("before update or delete on public.users");
    expect(sql).toContain("before update or delete on auth.users");
    expect(sql).toContain("before update or delete on public.super_admins");
    expect(sql).toContain("app.allow_protected_change");
    // 행 트리거는 TRUNCATE에 안 걸린다 — 명단 비우기·users 통째 비우기를 문장 트리거로 막는다.
    expect(sql).toContain("before truncate on public.super_admins");
    expect(sql).toContain("before truncate on public.users");
    // 값이 실제로 바뀔 때만 — 미러 트리거가 같은 값을 다시 쓰는 로그인·이름 변경을 막지 않게.
    expect(sql).toContain("new.system_role is distinct from old.system_role");
  });
});

describe("지점 화면 문구 — 총괄 정체를 드러내지 않는다(displayRoleFor 위장)", () => {
  it("거절 문구·계정 관리 안내·감사로그 요약·DB 예외에 '슈퍼관리자'·'총괄'이 없다", () => {
    const helper = read("lib/auth/protected-accounts.ts");
    const msgs = [...helper.matchAll(/_MSG =\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(msgs.length).toBe(2);
    const card = read("app/(shell)/staff/[id]/_components/account-actions.tsx");
    const describeTs = read("features/audit/describe.ts");
    const refused = describeTs.slice(
      describeTs.indexOf('case "staff_protected_refused"'),
      describeTs.indexOf('case "staff_status_change"'),
    );
    expect(refused.length).toBeGreaterThan(0);
    const sql = readMigration("0309a_protect_super_admin_accounts.sql");
    const sqlMsgs = [...sql.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]);
    expect(sqlMsgs.length).toBeGreaterThan(0);
    // 카드는 주석 줄을 빼고 본다(주석은 "쓰지 말라"는 규칙 설명이라 그 단어가 나온다).
    const cardCode = card.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("/**") && !l.trim().startsWith("*")).join("\n");
    for (const text of [...msgs, cardCode, refused, ...sqlMsgs]) {
      expect(text).not.toMatch(/슈퍼관리자|총괄/);
    }
  });
});
