import { expect, it } from "vitest";
import { CLASSNOTE_REPORT_TABS, classnoteReportFaces, lessonReportFaces, resolveLessonReportTab, type LessonReportFaceOptions } from "./lesson-report-faces";

const enabled: LessonReportFaceOptions = { canReportSettings: true, canAiMent: true, canSend: true, classnoteOn: true, replyOn: true };
it.each([[true, false], [false, true], [true, true], [false, false]])("설정 메뉴를 각각 표시한다: 보고서 %s, AI %s", (report, ai) => {
  const faces = lessonReportFaces({ canReportSettings: report, canAiMent: ai, canSend: false, classnoteOn: false });
  expect(faces.some(f => f.key === "report")).toBe(report);
  expect(faces.some(f => f.key === "ai_ment")).toBe(ai);
  expect(faces.some(f => f.key === "compose")).toBe(false);
});
it("직급에서 허용해도 AI 기능이 꺼진 학원에는 AI 설정을 표시하지 않는다", () => {
  expect(lessonReportFaces({ canReportSettings: true, canAiMent: true, canSend: true, classnoteOn: true, aiOn: false }).some(f => f.key === "ai_ment")).toBe(false);
});

it("클래스노트 기능 여섯 개는 상위 한 탭 아래에만 있고 일반 보고서 기능은 독립이다", () => {
  expect(lessonReportFaces(enabled).map(f => f.key)).toEqual(["video_homework", "writing", "list", "classnote", "report", "ai_ment"]);
  expect(classnoteReportFaces(enabled).map(f => f.key)).toEqual(["queue", "boards", "notice", "compose", "recall", "parent_replies"]);
});

it("모듈을 끄면 하위 전체가 사라지고 영상·작성률·목록·설정은 남는다", () => {
  const off = { ...enabled, classnoteOn: false };
  expect(classnoteReportFaces(off)).toEqual([]);
  expect(lessonReportFaces(off).map(f => f.key)).toEqual(["video_homework", "writing", "list", "report", "ai_ment"]);
});

it.each(CLASSNOTE_REPORT_TABS)("새 주소와 기존 즐겨찾기 %s는 같은 기능을 열고, 모듈 끔이면 모두 닫힌다", section => {
  expect(resolveLessonReportTab({ tab: "classnote", section }, enabled)).toBe(section);
  expect(resolveLessonReportTab({ tab: section }, enabled)).toBe(section);
  const off = { ...enabled, classnoteOn: false };
  expect(resolveLessonReportTab({ tab: "classnote", section }, off)).toBe("writing");
  expect(resolveLessonReportTab({ tab: section }, off)).toBe("writing");
});

it("상위 탭 입구는 큐로 열리고 하위 링크도 서버에서 같은 면으로 해석된다", () => {
  expect(resolveLessonReportTab({ tab: "classnote" }, enabled)).toBe("queue");
  expect(resolveLessonReportTab({ tab: "classnote" }, { ...enabled, classnoteOn: false })).toBe("writing");
  for (const face of classnoteReportFaces(enabled)) {
    const params = new URL(face.href, "https://test.invalid").searchParams;
    expect(params.get("tab")).toBe("classnote");
    expect(resolveLessonReportTab({ tab: params.get("tab")!, section: params.get("section")! }, enabled)).toBe(face.key);
  }
});

it("열람자는 발송·회수·답글 입구와 직접 주소가 모두 닫힌다", () => {
  const readonly = { ...enabled, canSend: false };
  expect(classnoteReportFaces(readonly).map(f => f.key)).toEqual(["queue", "boards", "notice"]);
  for (const section of ["compose", "recall", "parent_replies"]) {
    expect(resolveLessonReportTab({ tab: "classnote", section }, readonly)).toBe("writing");
    expect(resolveLessonReportTab({ tab: section }, readonly)).toBe("writing");
  }
});

it("답글 별도 설정이 끔이면 다른 클래스노트 기능은 유지하고 답글만 닫힌다", () => {
  const noReply = { ...enabled, replyOn: false };
  expect(classnoteReportFaces(noReply).map(f => f.key)).toEqual(["queue", "boards", "notice", "compose", "recall"]);
  expect(resolveLessonReportTab({ tab: "classnote", section: "parent_replies" }, noReply)).toBe("writing");
});

it("보고서 메뉴 권한 없이 설정만 위임받아도 클래스노트 입구는 생기지 않는다", () => {
  const settingsOnly = { ...enabled, canReports: false };
  expect(lessonReportFaces(settingsOnly).map(f => f.key)).toEqual(["report", "ai_ment"]);
  expect(classnoteReportFaces(settingsOnly)).toEqual([]);
  expect(resolveLessonReportTab({ tab: "classnote", section: "compose" }, settingsOnly)).toBe("writing");
});

it.each(["report", "ai_ment", "list", "javascript:alert(1)", "https://example.com", "QUEUE"])("하위 주소 %s로 다른 면·외부 목적지를 열지 않는다", section => {
  expect(resolveLessonReportTab({ tab: "classnote", section }, enabled)).toBe("writing");
});
