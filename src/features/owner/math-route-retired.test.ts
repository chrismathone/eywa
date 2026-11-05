import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { resolveSettings } from "./resolve";
import { reportSchema } from "./settings-types";

/**
 * 옛 보고서 설정 '수학 발송 경로'(`classnoteMathRoute` 기존 방식·반별·일부 선생님만 + `classnoteMathRoutePilot`)는 없다 —
 * 원장 2026-11-05 *"이제 안쓰는 기능들 정리하고 반 보드 동기화만 남기면 될듯"*. 수학은 늘 반별(send-class.ts `classRouteActive`).
 */
describe("옛 '수학 발송 경로' 설정은 없다(2026-11-05)", () => {
  it("저장돼 있던 두 키는 보고서 설정을 읽고 저장할 때 버려진다(DB에서는 그 지점의 다음 보고서 설정 저장 때 빠진다)", () => {
    const parsed = reportSchema.parse({
      ...DEFAULT_SETTINGS.report,
      classnoteMathRoute: "personal",
      classnoteMathRoutePilot: ["이수진"],
    });
    expect(parsed).not.toHaveProperty("classnoteMathRoute");
    expect(parsed).not.toHaveProperty("classnoteMathRoutePilot");
    expect(DEFAULT_SETTINGS.report).not.toHaveProperty("classnoteMathRoute");
    // 읽기 — 저장된 원문에 남아 있어도 풀린 설정(앱이 쓰는 값)에는 나오지 않는다.
    const resolved = resolveSettings({ report: { classnoteMathRoute: "personal", classnoteMathRoutePilot: ["이수진"] } }, { name: "" }).report;
    expect(resolved).not.toHaveProperty("classnoteMathRoute");
    expect(resolved).not.toHaveProperty("classnoteMathRoutePilot");
  });

  it("학원 설정 보고서 면은 '수학 반 보드'(설명 + 지금 반 보드 동기화)만 그린다", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(shell)/owner/_components/report-section.tsx"), "utf8");
    expect(src).toContain("<ClassnoteMathBoardField />");
    expect(src).not.toMatch(/classnoteMathRoute|ClassnoteRouteField/);
  });
});
