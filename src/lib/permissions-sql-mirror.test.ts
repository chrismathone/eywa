import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { MENU_ACCESS, SYSTEM_ROLES, type MenuKey } from "./permissions";

/**
 * 0158a RLS 정책은 역할 매트릭스를 **DB 안에서** 다시 판정한다(PostgREST 직결 우회를 막기 위해).
 * override는 tenant_settings에서 읽지만 **코드 기본값은 SQL 안 jsonb 리터럴로 복제**돼 있어
 * permissions.ts와 드리프트할 수 있다 — 드리프트하면 "설정은 켰는데 DB가 잠그는" 조용한 회귀가 난다.
 *
 * 이 테스트가 마이그레이션 파일을 파싱해 두 소스가 같은지 잠근다.
 * 실패하면 **permissions.ts가 아니라 마이그레이션 SQL을 고쳐라**(SQL이 미러다).
 */
const MIGRATION = join(
  __dirname,
  "../../supabase/migrations/0158a_rls_role_gates_for_invoices_expenses.sql",
);

/** SQL 안의 defaults jsonb 리터럴을 뽑아 파싱. */
function readSqlDefaults(): Record<string, Record<string, string>> {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("select '{", sql.indexOf("defaults as ("));
  expect(start, "defaults jsonb 리터럴을 찾지 못했다 — 마이그레이션 구조가 바뀌었는지 확인").toBeGreaterThan(0);
  const open = sql.indexOf("{", start);
  const close = sql.indexOf("}'::jsonb", open);
  expect(close, "defaults 리터럴의 끝(}'::jsonb)을 찾지 못했다").toBeGreaterThan(open);
  return JSON.parse(sql.slice(open, close + 1));
}

describe("0158a RLS 기본 권한 = permissions.ts MENU_ACCESS 미러", () => {
  const sqlDefaults = readSqlDefaults();
  const mirrored = Object.keys(sqlDefaults) as MenuKey[];

  it("미러 대상 메뉴는 billing·expense_requests 두 개다", () => {
    expect(mirrored.sort()).toEqual(["billing", "expense_requests"]);
  });

  it.each(mirrored)("%s — 8개 역할의 기본 접근수준이 코드와 일치", (menu) => {
    for (const role of SYSTEM_ROLES) {
      expect(
        sqlDefaults[menu]?.[role],
        `${menu}.${role}: SQL=${sqlDefaults[menu]?.[role]} vs permissions.ts=${MENU_ACCESS[menu][role]}`,
      ).toBe(MENU_ACCESS[menu][role]);
    }
  });

  it.each(mirrored)("%s — SQL에 코드에 없는 역할 키가 없다", (menu) => {
    expect(Object.keys(sqlDefaults[menu]!).sort()).toEqual([...SYSTEM_ROLES].sort());
  });

  it("master는 override와 무관하게 항상 통과한다(복구불능 락아웃 방지, gotchas #60)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(/when \(select role from me\) = 'master' then 'full'/);
  });

  it("textbook_orders는 잠그지 않는다(created_by 부재 — 강사 교재요청 락아웃 방지)", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).not.toMatch(/create policy \w*textbook_orders\w*_role_gate/);
  });
});
