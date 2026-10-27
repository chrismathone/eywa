import { describe, expect, it } from "vitest";
import { planBulkApply } from "./grid";
import {
  attendanceMarkIsEnough,
  attendanceMarkOf,
  attendanceSentence,
  makeupFactsOf,
} from "./attendance-sentence";
import {
  attitudeNoteComplete,
  needsAttitudeNote,
  pilotAttitudeText,
  pilotBody,
  pilotFactsSig,
} from "./math-report-pilot-sections";

describe("수업 태도 — 상·중상·중은 문구 없음, 하·중하는 강사 의견(원장 2026-10-26)", () => {
  it("좋은 쪽은 항목을 비운다", () => {
    for (const a of ["매우 좋음", "좋음", "보통"]) expect(pilotAttitudeText(a)).toBe("");
  });
  it("낮은 쪽은 강사 원문 그대로", () => {
    expect(pilotAttitudeText("안좋음", "줄1\n줄2\n줄3")).toBe("줄1\n줄2\n줄3");
    expect(pilotAttitudeText("매우 안좋음", "")).toBe("");
  });
  it("옛 자유입력 값은 예전 문장", () => {
    expect(pilotAttitudeText("집중 잘함")).toContain("오늘 수업 태도는");
  });
  it("3줄 이상 또는 90자 이상이어야 채운 것", () => {
    expect(attitudeNoteComplete("a\nb")).toBe(false);
    expect(attitudeNoteComplete("a\n\nb\nc")).toBe(true);
    expect(attitudeNoteComplete("가".repeat(90))).toBe(true);
    expect(needsAttitudeNote("좋음", "")).toBe(false);
    expect(needsAttitudeNote("안좋음", "짧음")).toBe(true);
  });
  it("보고서 글 · 서명", () => {
    const base = { dailyTest: "", checkTest: "", homework: "", homeworkToday: "" };
    expect(pilotBody({ ...base, attitude: "좋음" }, {})).not.toContain("■ 수업 태도");
    expect(pilotBody({ ...base, attitude: "안좋음", attitudeNote: "a\nb\nc" }, {})).toContain("■ 수업 태도\na\nb\nc");
    // 좋은 쪽 서명은 예전과 같은 모양(문자열), 낮은 쪽은 의견이 바뀌면 서명도 바뀐다.
    expect(pilotFactsSig({ ...base, attitude: "안좋음", attitudeNote: "x" }, [])).not.toBe(
      pilotFactsSig({ ...base, attitude: "안좋음", attitudeNote: "y" }, []),
    );
  });
});

describe("보강 출결 문장(원장 2026-10-26)", () => {
  const reserved = [{ start: "17:00", end: "18:00", absenceDate: "2026-10-19", mode: "separate" as const }];
  const row = (over: Partial<Parameters<typeof makeupFactsOf>[0]> = {}) =>
    makeupFactsOf({ isMakeupStudent: false, rowMakeup: true, classId: null, reserved, units: 1, reason: "", ...over });
  it("예약에서 결석 날짜·시간을 읽어 문장을 만든다 · 사유를 묻지 않는다", () => {
    const m = row();
    expect(attendanceSentence("makeup", null, m)).toBe("오늘은 10월 19일 결석에 대한 1교시 보강 수업을 진행했습니다.");
  });
  it("사유가 있으면 끝에 붙는다", () => {
    expect(attendanceSentence("present", null, row({ reason: "가족 여행" }))).toBe(
      "오늘은 10월 19일 결석에 대한 1교시 보강 수업을 진행했습니다(사유: 가족 여행).",
    );
  });
  it("예약이 없으면 날짜를 몰라 사유가 있으면 붙이고, 없어도 문장은 선다(원장 2026-10-27 — 사유는 발송 조건 아님)", () => {
    const m = row({ reserved: [], units: 1.5 });
    expect(attendanceSentence("makeup", null, m)).toBe("오늘은 보강 수업에 출석했습니다.");
    expect(attendanceSentence("makeup", null, { ...m!, reason: "결석 보충" })).toBe("오늘은 보강 수업에 출석했습니다(사유: 결석 보충).");
  });
  it("'정규+보강'은 정규 문장 뒤에 한 문장 · 정규 줄은 손대지 않는다", () => {
    const merged = makeupFactsOf({
      isMakeupStudent: false, rowMakeup: true, classId: "c1",
      reserved: [{ start: "16:00", end: "17:30", absenceDate: "2026-10-21", mode: "merge" }], units: 2, reason: "",
    });
    expect(attendanceSentence("present", null, merged)).toBe(
      "오늘 수업에 정상적으로 출석했습니다. 10월 21일 결석에 대한 1교시 보강 수업도 함께 진행했습니다.",
    );
    expect(makeupFactsOf({ isMakeupStudent: false, rowMakeup: false, classId: "c1", reserved, units: 1, reason: "" })).toBeNull();
  });
  it("머리 표시 — 날짜·사유가 붙은 보강은 '보강' + 띠도 세운다", () => {
    const withDate = attendanceMarkOf(attendanceSentence("makeup", null, row()));
    expect(withDate?.label).toBe("보강");
    expect(attendanceMarkIsEnough(withDate)).toBe(false);
    const withReason = attendanceMarkOf(attendanceSentence("makeup", null, { ...row({ reserved: [] })!, reason: "보충" }));
    expect(withReason?.label).toBe("보강");
    expect(attendanceMarkIsEnough(withReason)).toBe(false);
    expect(attendanceMarkIsEnough(attendanceMarkOf("오늘은 보강 수업에 출석했습니다."))).toBe(true);
    const merged = attendanceMarkOf("오늘 수업에 정상적으로 출석했습니다. 10월 21일 결석에 대한 보강 수업도 함께 진행했습니다.");
    expect(merged?.label).toBe("출석");
    expect(attendanceMarkIsEnough(merged)).toBe(false);
  });
});

describe("일괄 입력의 수업 태도 의견(2026-10-26)", () => {
  const target = (over: Record<string, unknown> = {}) =>
    ({ studentId: "s1", subjectName: "수학", subjectIndex: 0, subjectKey: "math", today: "", attitude: null, homework: "", textbook: "", homeworkToday: "", attitudeNoteOk: true, ...over }) as never;
  it("태도를 하·중하로 바꾸는 행에 의견을 함께 넣는다", () => {
    const plan = planBulkApply([target()], { attitude: "안좋음", attitudeNote: "a\nb\nc" }, false);
    expect(plan[0]?.set).toEqual({ attitude: "안좋음", attitudeNote: "a\nb\nc" });
  });
  it("좋은 태도 행·의견을 안 쓰는 행에는 넣지 않는다 · '빈 칸만'은 적어 둔 의견을 지킨다", () => {
    expect(planBulkApply([target({ attitude: "좋음" })], { attitudeNote: "x" }, false)).toEqual([]);
    expect(planBulkApply([target({ attitude: "안좋음", attitudeNoteOk: false })], { attitudeNote: "x" }, false)).toEqual([]);
    expect(planBulkApply([target({ attitude: "안좋음", attitudeNote: "기존" })], { attitudeNote: "x" }, true)).toEqual([]);
  });
});
