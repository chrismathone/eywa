import { expect, it } from "vitest";
import { lessonReportFaces } from "./lesson-report-faces";
it.each([[true, false], [false, true], [true, true], [false, false]])("설정 메뉴를 각각 표시한다: 보고서 %s, AI %s", (report, ai) => {
  const faces = lessonReportFaces({ canReportSettings: report, canAiMent: ai, canSend: false, classnoteOn: false });
  expect(faces.some(f => f.key === "report")).toBe(report);
  expect(faces.some(f => f.key === "ai_ment")).toBe(ai);
  expect(faces.some(f => f.key === "compose")).toBe(false);
});
it("직급에서 허용해도 AI 기능이 꺼진 학원에는 AI 설정을 표시하지 않는다", () => {
  expect(lessonReportFaces({ canReportSettings: true, canAiMent: true, canSend: true, classnoteOn: true, aiOn: false }).some(f => f.key === "ai_ment")).toBe(false);
});
