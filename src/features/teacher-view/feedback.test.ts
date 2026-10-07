import { expect, it } from "vitest";
import { sheetFeedback, sheetCarrySummary } from "./feedback";
import { timetableText } from "./timetable-labels";
it.each(["로그인이 필요합니다", "담당 반이 아닙니다", "읽기 전용입니다", "다른 창에서 변경되었습니다", "80자 이내로 입력하세요", "저장 실패: 임의의 DB 오류"]) ("shows English feedback for %s", (text) => {
  expect(sheetFeedback("en", text)).not.toMatch(/[가-힣]/);
  expect(sheetFeedback("ko", text)).toBe(text);
});
it("translates generated carry counts and timetable labels without changing notes", () => {
  expect(sheetCarrySummary("en", "듣기 레벨 2명 / 누적 암기 단어수 3명")).toBe("Listening level 2 students / Vocabulary total 3 students");
  expect(timetableText("en", "통합뷰")).toBe("Integrated");
  expect(timetableText("ko", "통합뷰")).toBe("통합뷰");
  expect(timetableText("en", "개인 메모")).toBe("개인 메모");
});
