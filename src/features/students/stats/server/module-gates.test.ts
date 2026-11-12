import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

describe("원생 매일 기록의 기능 판정", () => {
  it("운영실과 같은 모듈 값으로 캘린더 조회와 신규생 기록을 가른다", () => {
    const snapshot = read("src", "features", "students", "stats", "server", "daily-snapshot.ts");
    const ops = read("src", "features", "students", "stats", "server", "ops-daily.ts");
    expect(snapshot).toContain('calendar: isModuleEnabled(settings.modules.disabled, "calendar")');
    expect(snapshot).toContain('newcomers: isModuleEnabled(settings.modules.disabled, "newcomers")');
    expect(ops).toContain("modules.calendar");
    expect(ops).toMatch(/modules\.newcomers\s*\?\s*\(async/);
  });

  it("같은 날의 옛 기록도 꺼진 기능 값은 다시 합치지 않는다", () => {
    const snapshot = read("src", "features", "students", "stats", "server", "daily-snapshot.ts");
    expect(snapshot).toContain("if (!opsModules.calendar) delete kept.consult");
    expect(snapshot).toContain("if (!opsModules.newcomers) delete kept.newcomers");
  });
});
