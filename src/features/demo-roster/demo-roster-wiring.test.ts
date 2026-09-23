import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditDetail } from "@/features/audit/describe";
import { AUDIT_ACTIONS, auditActionLabel } from "@/features/audit/server/log";
import { buildScenario, SCENARIOS } from "./plan.mjs";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("데모 재원 드롭다운", () => {
  it("네 구성이 영어 100·수학 100으로 만들어진다", () => {
    for (const id of Object.keys(SCENARIOS)) {
      const plan = buildScenario(id);
      expect(plan.stats.eng).toBe(100);
      expect(plan.stats.math).toBe(100);
      expect(plan.conflicts).toEqual([]);
    }
  });

  it("슬러그 demo가 아니면 지우기 전에 멈춘다", () => {
    const src = read("src/features/demo-roster/apply.ts");
    const gate = src.indexOf('tenant?.slug !== "demo"');
    const wipe = src.indexOf("tx.delete");
    const satellite = src.indexOf("await insertDashboardSatellite");
    expect(gate).toBeGreaterThan(-1);
    expect(wipe).toBeGreaterThan(gate);
    expect(satellite).toBeGreaterThan(wipe);
    expect(src).not.toContain('slug === "cs"');
    expect(src).not.toContain("delete from students");
  });

  it("화면 액션은 세션 테넌트만 넘기고 원장만 연다", () => {
    const src = read("src/features/demo-roster/server/actions.ts");
    expect(src).toContain('user.systemRole !== "master"');
    expect(src).toContain("replaceDemoRoster(user.tenantId, scenarioId)");
    expect(src).not.toMatch(/replaceDemoRoster\(\s*["']/);
  });

  it("드롭다운은 대시보드가 재료를 줄 때만 선다", () => {
    const server = read("src/app/(shell)/dashboard/_overview/overview-server.tsx");
    const overview = read("src/app/(shell)/dashboard/_overview/overview.tsx");
    expect(server).toContain("getDemoRosterControl()");
    expect(overview).toContain("demoRoster ? <DemoRosterSwitch");
    const sw = read("src/app/(shell)/dashboard/_components/demo-roster-switch.tsx");
    expect(sw).toContain('refetchQueries({ queryKey: ["dashboard-overview"], type: "active" })');
    expect(read("src/features/demo-roster/apply.ts")).toContain("insertDashboardSatellite");
    expect(read("src/features/demo-roster/dashboard-apply.ts")).toContain('id !== "newcomers"');
    expect(read("src/features/demo-roster/server/actions.ts")).toContain("updateTag(tenantSettingsTag(user.tenantId))");
    expect(read("src/features/demo-roster/server/actions.ts")).toContain("updateTag(`dashboard-invoice-trend:${user.tenantId}`)");
    expect(read("src/features/dashboard/overview/server.ts")).toContain("dashboard-invoice-trend-v2");
    expect(read("src/features/demo-roster/apply.ts")).toContain("ensureDemoStaff");
    expect(read("src/features/demo-roster/dashboard-apply.ts")).toContain("'{profile}'");
    const queries = read("src/features/demo-roster/server/queries.ts");
    expect(queries).toContain('tenant?.slug !== "demo"');
    expect(queries).toContain('user.systemRole !== "master"');
  });

  it("감사 문구는 구성 이름이다", () => {
    expect(AUDIT_ACTIONS.demo_roster_apply).toBe("데모 재원 구성 바꾸기");
    expect(auditActionLabel("demo_roster_apply")).toBe("데모 재원 구성 바꾸기");
    expect(
      auditDetail("demo_roster_apply", { label: "동네형", students: 160 }, { nameOf: () => null, subjectLabel: () => "" }),
    ).toBe("동네형 · 재원 160명");
  });
});
