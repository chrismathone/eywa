import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("성적 급락 알림 기능 스위치", () => {
  it("이탈 방어 모듈을 확인한 뒤에만 후보를 읽는다", () => {
    const source = readFileSync(join(process.cwd(), "src", "features", "notifications", "server", "events.ts"), "utf8");
    const body = source.slice(source.indexOf("async function detectGradeDrop"), source.indexOf("async function detectProgressAnomaly"));
    expect(body).toContain('isModuleOnForTenant(tenantId, "retention")');
    expect(body.indexOf("isModuleOnForTenant")).toBeLessThan(body.indexOf('from("student_grades")'));
  });
});
