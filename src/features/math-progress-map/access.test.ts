import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROGRESS_MAP_PREVIEW_USER_IDS, isProgressMapPreviewUser } from "./access";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("progress-map access — 숨은 기능 명단", () => {
  it("명단은 user id(uuid)로만 잠근다 — 이름·이메일 매칭 없음", () => {
    expect(PROGRESS_MAP_PREVIEW_USER_IDS.length).toBeGreaterThan(0);
    for (const id of PROGRESS_MAP_PREVIEW_USER_IDS) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(isProgressMapPreviewUser("fcf735fa-edf7-4095-8fa6-724285a018ed")).toBe(true);
    expect(isProgressMapPreviewUser("00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isProgressMapPreviewUser("st2000423@gmail.com")).toBe(false);
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
