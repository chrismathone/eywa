/**
 * 학원 비서 권한 범위 가드(s2_0096) — DB 대응표(SQL)와 앱 묶음 규칙(scope-groups.ts)이 어긋나지 않게.
 * - SQL에 쓴 묶음 키는 모두 앱 규칙이 안다(모르는 키는 아무에게도 열리지 않아 조용히 '원장만'이 된다).
 * - 카탈로그의 모든 표는 대응표에 **명시**돼 있다(새 표는 원장만이 기본이지만, 사람이 정했는지 보이게 — 'master'도 적는다).
 * - onto 보기의 원본 목록(ONTO_SOURCES)은 카탈로그의 onto 보기와 같다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSISTANT_DOCS, ONTOLOGY_DOCS } from "./catalog";
import { MENU_KEYS, SYSTEM_ROLES } from "@/lib/permissions";
import {
  covers,
  deniedMessage,
  hiddenColumnsUsed,
  MASTER_SCOPE,
  ONTO_SOURCES,
  PAYSLIP_SCOPE,
  requiredKeys,
  SCOPE_GROUPS,
  scopeKeysFor,
  viewAllowed,
  viewKeys,
  type ScopeMap,
} from "./scope";

const MIGRATIONS = join(process.cwd(), "supabase/migrations");

/** s2_*.sql의 대응표 insert 줄을 차례대로 읽는다(뒤 파일이 이긴다). */
function sqlMap(): { tables: Map<string, string>; columns: Array<{ table: string; column: string; key: string }> } {
  const tables = new Map<string, string>();
  const columns = new Map<string, { table: string; column: string; key: string }>();
  const files = readdirSync(MIGRATIONS).filter((f) => /^s2_\d{4}_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    for (const block of sql.matchAll(/insert into assistant_private\.scope_tables[^;]*?values([\s\S]*?)on conflict/g)) {
      for (const m of block[1]!.matchAll(/\('([a-z0-9_]+)',\s*'([a-z0-9_]+)'\)/g)) tables.set(m[1]!, m[2]!);
    }
    for (const block of sql.matchAll(/insert into assistant_private\.scope_columns[^;]*?values([\s\S]*?)on conflict/g)) {
      for (const m of block[1]!.matchAll(/\('([a-z0-9_]+)',\s*'([a-z0-9_]+)',\s*'([a-z0-9_]+)'\)/g)) {
        columns.set(`${m[1]}.${m[2]}`, { table: m[1]!, column: m[2]!, key: m[3]! });
      }
    }
  }
  return { tables, columns: [...columns.values()] };
}

const KNOWN = new Set([MASTER_SCOPE, PAYSLIP_SCOPE, ...SCOPE_GROUPS.map((g) => g.key)]);

describe("학원 비서 권한 범위 — 대응표 가드", () => {
  const map = sqlMap();

  it("SQL 대응표가 비어 있지 않다(읽는 규칙이 깨지면 가드가 헛돈다)", () => {
    expect(map.tables.size).toBeGreaterThan(200);
    expect(map.columns.length).toBeGreaterThan(10);
  });

  it("SQL에 쓴 묶음 키는 모두 앱 규칙이 안다", () => {
    const unknown = [...new Set([...map.tables.values(), ...map.columns.map((c) => c.key)])].filter((k) => !KNOWN.has(k));
    expect(unknown).toEqual([]);
  });

  it("카탈로그의 표는 모두 대응표에 명시돼 있다(원장만이어도 'master'로 적는다)", () => {
    const onto = new Set(ONTOLOGY_DOCS.map((d) => d.name));
    const missing = ASSISTANT_DOCS.filter((d) => !onto.has(d.name) && !d.name.startsWith("onto_")).map((d) => d.name).filter((n) => !map.tables.has(n));
    expect(missing).toEqual([]);
  });

  it("onto 보기의 원본 목록은 카탈로그의 onto 보기와 같다", () => {
    const docs = ASSISTANT_DOCS.filter((d) => d.name.startsWith("onto_")).map((d) => d.name).sort();
    expect(Object.keys(ONTO_SOURCES).sort()).toEqual(docs);
  });

  it("묶음 규칙의 메뉴·역할은 있는 값이고 키는 겹치지 않는다", () => {
    const keys = SCOPE_GROUPS.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(MASTER_SCOPE);
    expect(keys).not.toContain(PAYSLIP_SCOPE);
    for (const g of SCOPE_GROUPS) {
      expect(g.menus.length).toBeGreaterThan(0);
      for (const m of g.menus) expect(MENU_KEYS).toContain(m);
      for (const r of g.roles) expect(SYSTEM_ROLES).toContain(r);
      expect(g.label).toBeTruthy();
    }
  });

  it("🔴 가로지르는 기록·급여 원장은 원장만", () => {
    for (const t of ["audit_logs", "activity_log", "notifications", "tenant_settings", "payroll_records", "ai_usage_logs"]) {
      if (map.tables.has(t)) expect([t, map.tables.get(t)]).toEqual([t, MASTER_SCOPE]);
    }
  });

  it("🔴 외부 AI 전송 금지 필드(급여·명세서·계좌·이력서)는 원장 밖 역할에 열지 않는다(CLAUDE.md 불변 · 11-06 예외는 원장 때의 것)", () => {
    for (const t of ["payslips", "class_salary_settings", "salary_tiers", "invoice_teacher_splits", "attendance_salary_rates", "attendance_salary_teacher_view", "academy_documents", "withdrawal_report_refunds", "users"]) {
      // users = 직원관리 묶음(규칙상 원장만 — 아래 묶음 규칙 검사) · 나머지는 원장 묶음.
      expect([t, map.tables.get(t) ?? MASTER_SCOPE]).toEqual([t, t === "users" ? "staff" : MASTER_SCOPE]);
    }
    expect(SCOPE_GROUPS.find((g) => g.key === "staff")?.roles).toEqual(["master"]);
    const col = (t: string, c: string) => map.columns.find((x) => x.table === t && x.column === c)?.key;
    for (const [t, c] of [["expenses", "account_number"], ["expenses", "bank_name"], ["users", "hourly_rate"], ["users", "monthly_base"], ["enrollments", "salary_tier"], ["attendance_records", "salary_tier"]] as const) {
      expect([t, c, col(t, c)]).toEqual([t, c, MASTER_SCOPE]);
    }
    // 원장 밖에 열린 묶음은 급여 묶음(salary · payslip)을 표에도 칸에도 쓰지 않는다.
    expect([...map.tables.values(), ...map.columns.map((c) => c.key)].filter((k) => k === "salary" || k === PAYSLIP_SCOPE)).toEqual([]);
  });
});

describe("학원 비서 권한 범위 — 판정", () => {
  const map: ScopeMap = {
    tables: new Map([
      ["students", "students"],
      ["enrollments", "students"],
      ["classes", "classes"],
      ["invoices", "billing"],
      ["student_siblings", "students"],
    ]),
    columns: [],
  };
  const level = (open: Record<string, "full" | "readonly" | "scoped" | "none">) => (m: string) => open[m] ?? "none";

  it("원장·운영 계정 = master 하나", () => {
    expect(scopeKeysFor({ role: "master", master: true, access: level({}), payslipViewer: false })).toEqual([MASTER_SCOPE]);
  });

  it("🔴 '담당'은 닫고 전체·읽기만 연다 · 역할 목록 밖이면 닫는다", () => {
    const students = SCOPE_GROUPS.find((g) => g.key === "students")!;
    const role = students.roles.find((r) => r !== "master")!;
    expect(scopeKeysFor({ role, master: false, access: level({ students: "readonly" }), payslipViewer: false })).toContain("students");
    expect(scopeKeysFor({ role, master: false, access: level({ students: "scoped" }), payslipViewer: false })).not.toContain("students");
    const outside = SYSTEM_ROLES.find((r) => !students.roles.includes(r) && r !== "master")!;
    expect(scopeKeysFor({ role: outside, master: false, access: level({ students: "full" }), payslipViewer: false })).not.toContain("students");
  });

  it("급여명세서 지정 열람은 따로 붙는다", () => {
    expect(scopeKeysFor({ role: "admin", master: false, access: level({}), payslipViewer: true })).toEqual([PAYSLIP_SCOPE]);
  });

  it("대응표에 없는 표는 원장만", () => {
    expect(viewKeys("audit_logs", map)).toEqual([MASTER_SCOPE]);
    expect(viewAllowed("audit_logs", ["students", "billing"], map)).toBe(false);
    expect(viewAllowed("audit_logs", [MASTER_SCOPE], map)).toBe(true);
  });

  it("onto 보기는 원본 묶음이 모두 열릴 때만(onto가 onto를 읽어도 끝까지)", () => {
    expect(viewKeys("onto_students", map)).toEqual(["students"]);
    expect(viewAllowed("onto_enrollments", ["students"], map)).toBe(false);
    expect(viewAllowed("onto_enrollments", ["classes", "students"], map)).toBe(true);
    // onto_households → onto_siblings → student_siblings · students
    expect(viewKeys("onto_households", map)).toEqual(["students"]);
    // onto_tuition_months → … onto_students
    expect(viewKeys("onto_tuition_months", map)).toEqual(["billing", "classes", "students"]);
  });

  it("저장 표지 — 쓴 표의 키 · 표지 없는 옛 답은 원장만 · 빈 표지는 누구나", () => {
    expect(requiredKeys(["students", "onto_enrollments"], map)).toEqual(["classes", "students"]);
    expect(covers(["students"], ["students"])).toBe(true);
    expect(covers(["students"], ["billing", "students"])).toBe(false);
    expect(covers(["students"], null)).toBe(false);
    expect(covers([MASTER_SCOPE], null)).toBe(true);
    expect(covers(["students"], [])).toBe(true);
  });

  it("저장 표지는 쓴 칸의 칸 키도 담는다(* = 그 표의 가린 칸 전부) · 가린 칸을 쓴 확인 지표를 가른다", () => {
    const withCols: ScopeMap = { ...map, columns: [{ table: "enrollments", column: "salary_tier", key: "master" }, { table: "students", column: "parent_phone", key: "students" }] };
    expect(requiredKeys(["enrollments"], withCols, ["student_id"])).toEqual(["students"]);
    expect(requiredKeys(["enrollments"], withCols, ["salary_tier"])).toEqual([MASTER_SCOPE, "students"]);
    expect(requiredKeys(["onto_enrollments"], withCols, ["*"])).toEqual(["classes", MASTER_SCOPE, "students"].sort());
    // 묻는 사람이 볼 수 없던 칸(DB가 null로 줬다)은 표지에 넣지 않는다 — 자기 답이 다시 열 때 사라지지 않게(재리뷰 2026-11-12).
    expect(requiredKeys(["enrollments"], withCols, ["*"], ["students"])).toEqual(["students"]);
    expect(requiredKeys(["enrollments"], withCols, ["*"], [MASTER_SCOPE])).toEqual([MASTER_SCOPE, "students"]);
    const hidden = (t: string) => new Set(t === "enrollments" ? ["salary_tier"] : []);
    expect(hiddenColumnsUsed(["enrollments"], ["salary_tier"], hidden)).toEqual(["salary_tier"]);
    expect(hiddenColumnsUsed(["enrollments"], ["*"], hidden)).toEqual(["salary_tier"]);
    expect(hiddenColumnsUsed(["enrollments"], ["student_id"], hidden)).toEqual([]);
  });

  it("거절 안내는 권한 이름만(숨긴 표 이름을 말하지 않는다)", () => {
    expect(deniedMessage(["students"])).toMatch(/권한이 있어야 볼 수 있는 자료입니다/);
    expect(deniedMessage([MASTER_SCOPE])).toBe("원장만 볼 수 있는 자료입니다");
  });
});
