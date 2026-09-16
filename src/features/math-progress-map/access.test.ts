import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRESS_MAP_MIN_ROLE, canSeeProgressMapPreview } from "./access";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("progress-map access — 관리자 이상(숨은 기능)", () => {
  it("관리자 이상만 본다 — 매니저 이하는 아직 아니다", () => {
    expect(PROGRESS_MAP_MIN_ROLE).toBe("admin");
    expect(canSeeProgressMapPreview("master")).toBe(true);
    expect(canSeeProgressMapPreview("admin")).toBe(true);
    expect(canSeeProgressMapPreview("manager")).toBe(false);
    expect(canSeeProgressMapPreview("accountant")).toBe(false);
    expect(canSeeProgressMapPreview("counselor")).toBe(false);
    expect(canSeeProgressMapPreview("teacher")).toBe(false);
    expect(canSeeProgressMapPreview("viewer")).toBe(false);
    expect(canSeeProgressMapPreview("student")).toBe(false);
  });

  it("🔴 user id 명단으로 되돌아가지 않는다 — 판정은 역할 한 축", () => {
    const gate = read("src/features/math-progress-map/server/access.ts");
    expect(gate).toContain("canSeeProgressMapPreview");
    // uuid가 코드에 다시 박히면 "지금 누가 보는가"를 아무도 모르게 된다.
    expect(gate).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/);
    expect(read("src/features/math-progress-map/access.ts")).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/,
    );
  });

  it("페이지·링크 노출이 같은 서버 게이트(canPreviewProgressMap)를 지난다 — #77", () => {
    const page = read("src/app/(shell)/mcs/progress-map/page.tsx");
    expect(page).toContain("canPreviewProgressMap");
    expect(page).toContain('requireAccess("mcs")');
    expect(page).toContain("notFound()");
    const landing = read("src/app/(shell)/mcs/page.tsx");
    expect(landing).toContain("canPreviewProgressMap");
    expect(landing).toContain("/mcs/progress-map");
  });

  it("사이드바·메뉴키에 올리지 않는다(숨은 기능)", () => {
    expect(read("src/lib/navigation.ts")).not.toContain("progress-map");
    expect(read("src/lib/permissions.ts")).not.toContain("progress_map");
  });
});
