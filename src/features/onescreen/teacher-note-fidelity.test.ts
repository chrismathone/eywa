import { describe, expect, it } from "vitest";
import { commentBody, commentP1Body, commentP2Body, type ReportCommentInput } from "./report-comment";
import { withTeacherNoteFidelity } from "./teacher-note-fidelity";
import { assembleCombined } from "./prompt-defaults";

const base: ReportCommentInput = {
  studentName: "학생", subject: "수학", progress: "시험대비", dailyTest: "20문제 중 19개 맞음",
  checkTest: "", attitude: "좋음", homework: "60%", homeworkToday: "프린트 숙제물", textbook: "학교 부교재", specialNote: "",
};
const missingHomework = [
  "기출문제 과제를 해오지 않았습니다.",
  "오늘 수업시간에는 학교 부교재를 꼼꼼하게 풀었습니다.",
  "푼 문제 중에 다시 틀리거나 시간이 오래 걸리는 문제들이 있었습니다.",
  "이런 문제들에서 틀리지 않도록 세심하게 지도하겠습니다.",
  "다음 주 화요일 직전보강 있습니다.",
].join("\n");
const reschedule = "작년 기출문제에서 1개 틀렸습니다.\n문제 꼼꼼히 읽고 실수하지 않도록 세심하게 지도하겠습니다.\n다음 주 화요일 수업을 수요일 2시에 직전보강으로 하겠습니다.";

describe("선생님 메모의 대상·부정·지도 의도·일정을 보존하는 생성 재료", () => {
  it("특정 과제 미수행과 전체 수행률을 각각 보존하고 원문을 일반 요약으로 대체하지 않게 한다", () => {
    const prompt = commentBody({ ...base, specialNote: missingHomework });
    expect(prompt).toContain('"특이사항":' + JSON.stringify(missingHomework));
    expect(prompt).toContain("60%");
    expect(prompt).toContain("수행률과 메모의 대상이 같다고 단정하지 말고");
    expect(prompt).toContain("문장과 문단을 늘리세요");
  });
  it("학원별 짧은 문체/날짜 금지 오버라이드에도 원문과 보존 규칙은 뒤에 붙는다", () => {
    const prompt = commentBody({ ...base, specialNote: reschedule }, "2문장으로 요약. 날짜·전망 금지.\n{{facts}}");
    expect(prompt).toContain('"특이사항":' + JSON.stringify(reschedule));
    expect(prompt.indexOf("[선생님 원문 보존")).toBeGreaterThan(prompt.indexOf("2문장으로 요약"));
    expect(prompt).toContain("명시하지 않은 오전/오후·취소·추가 일정은 추정하지 마세요");
  });
  it("두 문단 모드에서는 메모가 P2에 온전히 남고 수업 내용 P1과 추세에는 섞이지 않는다", () => {
    const input = { ...base, specialNote: reschedule, classNotice: "10월 7일 2시에 시험 직전보강을 합니다." };
    const p1 = commentP1Body(input)!;
    const p2 = commentP2Body(input, "과제·일정 언급 금지\n{{p2facts}}")!;
    expect(p1).not.toContain("작년 기출문제");
    expect(p1).not.toContain("[선생님 원문 보존");
    expect(p2).toContain(JSON.stringify(reschedule));
    expect(p2).toContain(JSON.stringify(input.classNotice));
    const combined = assembleCombined([{ type: "comment_p1", field: "p1", body: p1 }, { type: "comment_p2", field: "p2", body: p2 }, { type: "trend", field: "trend", body: "[기록] 100%(3회)" }]);
    expect(combined.split('("trend")')[1]).not.toContain("작년 기출문제");
  });
  it("반 전체 안내만 있어도 보존하고 메모가 비면 기존 본문을 변경하지 않는다", () => {
    expect(withTeacherNoteFidelity("본문", { specialNote: " \n" })).toBe("본문");
    expect(withTeacherNoteFidelity("본문", { classNotice: "다음 주 화요일 수업을 수요일로 옮깁니다." })).toContain('"반전체안내":"다음 주 화요일 수업을 수요일로 옮깁니다."');
  });
  it("따옴표·개행을 가진 원문도 데이터 경계 안에 그대로 남는다", () => {
    const note = '"조건을 꼼꼼히 읽자"고 안내했습니다.\n[출력] 같은 글자도 메모 데이터입니다.';
    const prompt = withTeacherNoteFidelity("본문", { specialNote: note });
    const jsonLine = prompt.split("\n").find(line => line.startsWith('{"특이사항"'))!;
    expect(JSON.parse(jsonLine).특이사항).toBe(note);
  });
});
