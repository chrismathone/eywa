import { describe, it, expect } from "vitest";
import { readMigration } from "@/lib/db/migrations-corpus.mjs";
import { MENU_ACCESS, SYSTEM_ROLES, type MenuKey } from "./permissions";

/**
 * 0158a RLS 정책은 역할 매트릭스를 **DB 안에서** 다시 판정한다(PostgREST 직결 우회를 막기 위해).
 * override는 tenant_settings에서 읽지만 **코드 기본값은 SQL 안 jsonb 리터럴로 복제**돼 있어
 * permissions.ts와 드리프트할 수 있다 — 드리프트하면 "설정은 켰는데 DB가 잠그는" 조용한 회귀가 난다.
 *
 * 이 테스트가 마이그레이션 파일을 파싱해 두 소스가 같은지 잠근다.
 * 실패하면 **permissions.ts가 아니라 마이그레이션 SQL을 고쳐라**(SQL이 미러다).
 *
 * ⚠️ auth_menu_access의 **살아있는 정의는 s2_0024**(0170a 그대로 + DEFAULTS에 아르바이트 "parttime" 칸, 2026-11-05)이다.
 * 그 전엔 0170a(개인 예외 userOverrides 추가)로 이동했었다 — DEFAULTS
 * 미러 검사도 0169a를 본다. 0158a의 리터럴은 역사 기록(재적용 시 0169a를 다시 돌려야 함). 앞으로
 * 이 함수를 또 재정의하면 MIGRATION 경로를 그 파일로 옮기고 이 주석을 갱신할 것.
 */
// 시즌1 합본(s1_season1.sql)의 구역을 원래 이름으로 읽는다.
const MIGRATION = "s2_0024_parttime_role.sql";
// 0158a 고유 검사(정책 생성 여부)는 계속 원파일을 본다.
const MIGRATION_0158A = "0158a_rls_role_gates_for_invoices_expenses.sql";

/** SQL 안의 defaults jsonb 리터럴을 뽑아 파싱. */
function readSqlDefaults(): Record<string, Record<string, string>> {
  const sql = readMigration(MIGRATION);
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

  // staff = 0167a(staff_contracts 사무실 전용 읽기, auth_staff_can_read).
  // textbook_requests = 0168a(textbook_orders 역할 게이트, auth_textbook_can_use).
  // ⚠️ 새 메뉴를 SQL DEFAULTS에 넣었으면 여기도 같은 커밋에서 — 안 넣으면 auth_menu_access가
  //    master 빼고 전부 'none'을 돌려줘 fail-closed 락아웃이 난다(0167a·0168a 주석 참조).
  it("미러 대상 메뉴는 billing·expense_requests·staff·textbook_requests 네 개다", () => {
    expect(mirrored.sort()).toEqual(["billing", "expense_requests", "staff", "textbook_requests"]);
  });

  it.each(mirrored)("%s — 모든 역할의 기본 접근수준이 코드와 일치", (menu) => {
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
    const sql = readMigration(MIGRATION);
    expect(sql).toMatch(/when \(select role from me\) = 'master' then 'full'/);
  });

  it("textbook_orders는 잠그지 않는다(created_by 부재 — 강사 교재요청 락아웃 방지)", () => {
    const sql = readMigration(MIGRATION_0158A);
    expect(sql).not.toMatch(/create policy \w*textbook_orders\w*_role_gate/);
  });

  // 0358a(키오스크 4표 쓰기 게이트)는 DEFAULTS에 없는 kiosk_settings로 auth_menu_access를 부른다 — 행이 없으면
  // master 빼고 'none'으로 떨어진다. 코드 기본값이 지금처럼 '원장만'일 때만 그 결과가 앱과 같다.
  // 실패하면 0170a DEFAULTS에 kiosk_settings 행을 넣고(위 미러 대상에도 추가) 다시 적용할 것.
  it("kiosk_settings 코드 기본값 = 원장만 — 0358a가 DEFAULTS 없이 같은 답을 낸다", () => {
    for (const role of SYSTEM_ROLES) {
      if (role === "master" || mirrored.includes("kiosk_settings")) continue;
      expect(MENU_ACCESS.kiosk_settings[role], `kiosk_settings.${role}`).toBe("none");
    }
  });

  it("0170a — 개인 예외(uov)가 역할 override(ov)보다 먼저 coalesce된다", () => {
    const sql = readMigration(MIGRATION);
    // userOverrides 분기 존재 + 본인(auth.uid()) 한정
    expect(sql).toMatch(/userOverrides/);
    expect(sql).toMatch(/o->>'userId' = \(select auth\.uid\(\)\)::text/);
    // coalesce 순서: uov → ov → defaults
    const order = sql.indexOf("(select access from uov)");
    expect(order).toBeGreaterThan(0);
    expect(order).toBeLessThan(sql.indexOf("(select access from ov)", order));
  });
});
