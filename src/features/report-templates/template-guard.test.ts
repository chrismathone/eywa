import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 사용자 템플릿 서버 액션 — **테넌트·주인 격리 구조 검사**.
 *
 * admin 클라이언트는 RLS를 우회한다(report_templates는 정책 0개 = 서버 전용). 호출 하나에서
 * tenant_id나 owner_id가 빠지면 남의 템플릿을 읽거나 고친다 — 그래서 호출 모양을 세어 잠근다
 * (todays-math tenant-guard 선례: 낱말이 아니라 **호출 모양**을 세고, 가드의 가드로 실제로 잡는지 확인).
 */

const SOURCE = readFileSync(path.join(__dirname, "server", "actions.ts"), "utf8");

/** `.from("report_templates")`부터 그 문장 끝(`;`)까지를 잘라 낸다. */
function statements(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf('.from("report_templates")', i)) !== -1) {
    const end = src.indexOf(";", i);
    out.push(src.slice(i, end === -1 ? undefined : end));
    i += 1;
  }
  return out;
}

function isolated(stmt: string): boolean {
  if (stmt.includes(".insert(")) return /tenant_id:\s*who\.tenantId/.test(stmt) && /owner_id:\s*who\.userId/.test(stmt);
  return /\.eq\("tenant_id",\s*who\.tenantId\)/.test(stmt) && /\.eq\("owner_id",\s*who\.userId\)/.test(stmt);
}

describe("report-templates 서버 액션 — 테넌트·주인 격리", () => {
  it("모든 report_templates 호출이 tenant_id·owner_id를 건다", () => {
    const stmts = statements(SOURCE);
    expect(stmts.length).toBeGreaterThanOrEqual(4); // list·update·insert·delete
    const bad = stmts.filter((s) => !isolated(s)).map((s) => s.slice(0, 120));
    expect(bad).toEqual([]);
  });

  it("[가드의 가드] 격리가 빠진 모양을 실제로 잡는다", () => {
    const bad = `
      admin.from("report_templates").select("id").eq("tenant_id", who.tenantId);
      admin.from("report_templates").insert({ tenant_id: who.tenantId, name });
    `;
    expect(statements(bad).map(isolated)).toEqual([false, false]);
  });

  it("async 함수만 export한다(#119 — use server 파일의 동기 export는 빌드만 깬다)", () => {
    const exports = [...SOURCE.matchAll(/^export\s+(?!async function)(\w+)/gm)].map((m) => m[1]);
    expect(exports).toEqual([]);
  });
});
