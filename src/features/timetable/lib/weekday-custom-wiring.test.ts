import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

describe("만든 요일 병합이 화면까지 간다", () => {
  it("과목 운영에서 만들고 드롭다운에 넘긴다", () => {
    const section = read("src/app/(shell)/owner/_components/subjects-section.tsx");
    expect(section).toContain("WeekdayGroupingEditor");
    expect(section).toContain("weekdayGroupingChoices");
    expect(read("src/features/owner/defaults.ts")).toContain("weekdayGroupings:");
  });

  it("시간표 기본뷰는 풀어 둔 묶음을 그린다", () => {
    for (const page of ["src/app/(shell)/timetable/page.tsx", "src/app/(shell)/timetable-dev/page.tsx"]) {
      const src = read(page);
      expect(src).toContain("resolveWeekdayGroups");
      expect(src).toContain("dayGroups={weekdayGroups}");
    }
  });
});
