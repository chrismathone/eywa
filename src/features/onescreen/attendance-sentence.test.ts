import { describe, expect, it } from "vitest";
import { attendanceSentence } from "./attendance-sentence";
import { NO_DAILY_TEST_TEXT, NO_HOMEWORK_TEXT, NO_HOMEWORK_TODAY_TEXT, pilotBody, pilotFactsSig } from "./math-report-pilot-sections";

describe("출결 문장(원장 2026-10-26)", () => {
  it("지각·조퇴·공결 + 사유 원문", () => {
    expect(attendanceSentence("late", "병원 진료")).toBe("오늘은 조금 늦게 도착했습니다(사유: 병원 진료).");
    expect(attendanceSentence("early_leave", "가족 행사.\n")).toBe("오늘은 수업 중간에 먼저 귀가했습니다(사유: 가족 행사).");
    expect(attendanceSentence("excused", "")).toBe("오늘은 공결로 처리되었습니다.");
  });
  it("사유가 없으면 이유를 짓지 않고 상태만", () => {
    expect(attendanceSentence("late", null)).toBe("오늘은 조금 늦게 도착했습니다.");
  });
  it("출석·보강도 적되 메모는 싣지 않는다(원장 2026-10-26)", () => {
    expect(attendanceSentence("present", "내부 메모")).toBe("오늘 수업에 정상적으로 출석했습니다.");
    expect(attendanceSentence("makeup", "메모")).toBe("오늘은 보강 수업에 출석했습니다.");
  });
  it("결석·기록 없음은 말하지 않는다", () => {
    for (const s of ["absent", null, undefined, "weird"]) expect(attendanceSentence(s, "메모")).toBe("");
  });
});

const BASE = { dailyTest: "", checkTest: "", attitude: "", homework: "", homeworkToday: "" };

describe("빈 항목도 '없었다'로 남긴다(원장 2026-10-26)", () => {
  it("테스트·숙제가 없으면 항목을 지우지 않는다", () => {
    const body = pilotBody(BASE, {});
    expect(body).toContain(`■ 일일 테스트\n${NO_DAILY_TEST_TEXT}`);
    expect(body).toContain(`■ 숙제 완성도\n${NO_HOMEWORK_TEXT}`);
    expect(body).toContain(`■ 오늘의 숙제\n${NO_HOMEWORK_TODAY_TEXT}`);
    expect(pilotBody({ ...BASE, homework: "없음" }, {})).toContain(NO_HOMEWORK_TEXT);
  });
  it("값이 있으면 그 값을 쓴다", () => {
    const body = pilotBody({ ...BASE, dailyTest: "20문제 중 18개 맞음", homework: "100%", homeworkToday: "p.30~32" }, {});
    expect(body).not.toContain(NO_DAILY_TEST_TEXT);
    expect(body).not.toContain(NO_HOMEWORK_TEXT);
    expect(body).not.toContain(NO_HOMEWORK_TODAY_TEXT);
  });
  it("영상 숙제만 있는 날은 '숙제 없음'이라 하지 않는다", () => {
    expect(pilotBody({ ...BASE, videoHomework: true }, {})).not.toContain(NO_HOMEWORK_TODAY_TEXT);
  });
  it("출결은 맨 앞 항목 · 바뀌면 사실 서명도 바뀐다", () => {
    const att = attendanceSentence("late", "병원");
    expect(pilotBody({ ...BASE, attendance: att }, {}).startsWith(`■ 출결\n${att}`)).toBe(true);
    expect(pilotBody(BASE, {})).not.toContain("■ 출결");
    expect(pilotFactsSig({ ...BASE, attendance: att }, [])).not.toBe(pilotFactsSig(BASE, []));
  });
});
