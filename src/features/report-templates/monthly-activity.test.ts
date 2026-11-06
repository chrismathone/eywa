import { describe, expect, it } from "vitest";
import {
  LEVELS,
  monthlyActivityMarker,
  monthlyActivityOfLine,
  monthlyActivityOfText,
  summarizeMonthlyActivity,
  type MonthlyActivity,
} from "./monthly-activity";
import { LEVELS as PILOT_LEVELS } from "@/features/onescreen/math-report-pilot-sections";
import { pickMonthlyActivities, type MonthlyReportRow } from "@/features/onescreen/english-monthly-activity-pick";
import { englishSheetValues } from "@/features/onescreen/english-sheet";
import { isPilotTitle, splitRetest } from "@/features/onescreen/pilot-notes";
import { stripImageSlots } from "./image-slots";

const A: MonthlyActivity = {
  month: "2026-10",
  lessons: [
    { date: "2026-10-06", homework: 100, attitude: "상", word: { right: 18, total: 20 }, retest: false },
    { date: "2026-10-08", homework: null, attitude: null, word: null, retest: false },
    { date: "2026-10-13", homework: 60, attitude: "중", word: { right: 10, total: 20 }, retest: true },
  ],
};

describe("한 달 학습 기록 줄", () => {
  it("눈금 순서는 수학 보고서 표와 같다", () => {
    expect([...LEVELS]).toEqual([...PILOT_LEVELS]);
  });

  it("줄로 쓰고 그대로 읽는다", () => {
    const line = monthlyActivityMarker(A);
    expect(line).toBe("[월간학습 2026-10 | 10-06:100:5:18/20:- | 10-08:-:-:-:- | 10-13:60:3:10/20:R]");
    expect(monthlyActivityOfLine(line)).toEqual(A);
    expect(monthlyActivityOfText(`안녕\n${line}\n코멘트`)).toEqual(A);
  });

  it("모양이 어긋나면 글자 그대로 · 수업이 없으면 빈 값", () => {
    expect(monthlyActivityOfLine("[월간학습 2026-10 | 10-06:100:9:-:-]")).toBeNull();
    expect(monthlyActivityOfLine("[월간학습 2026-10 | 10-06:100:5:21/20:-]")).toBeNull();
    expect(monthlyActivityOfLine("문장 속 [월간학습 2026-10 | 10-06:100:5:-:-]")).toBeNull();
    expect(monthlyActivityMarker({ month: "2026-10", lessons: [] })).toBe("");
  });

  it("학부모에게 나가는 글자에선 빠진다", () => {
    expect(stripImageSlots(`${monthlyActivityMarker(A)}\n\n잘했어요`)).toBe("잘했어요");
  });

  it("요약 — 값이 없는 수업은 평균에서 뺀다", () => {
    const s = summarizeMonthlyActivity(A);
    expect(s).toMatchObject({ lessons: 3, homeworkAvg: 80, homeworkCount: 2, wordAvg: 70, wordCount: 2, retestCount: 1, attitudeCount: 2 });
    expect(s.attitudeCounts.상).toBe(1);
    expect(s.attitudeCounts.중).toBe(1);
  });
});

describe("한 달 기록 고르기", () => {
  const row = (date: string, extra: Partial<MonthlyReportRow> = {}): MonthlyReportRow => ({
    student_id: "s1",
    class_id: "c1",
    report_date: date,
    homework_score: "100%",
    attitude: "좋음",
    daily_test: "20문제 중 18개 맞음",
    ...extra,
  });

  it("보고서 날짜 당일 줄은 빼고 · 재시험은 점수가 있을 때만", () => {
    const rows = [row("2026-11-03"), row("2026-11-05", { daily_test: null }), row("2026-11-06")];
    const got = pickMonthlyActivities(rows, new Set(["c1|s1|2026-11-05", "c1|s1|2026-11-03"]), "2026-11-06", () => undefined);
    const a = got.get("c1|s1")!;
    expect(a.month).toBe("2026-11");
    expect(a.lessons.map((l) => l.date)).toEqual(["2026-11-03", "2026-11-05"]);
    expect(a.lessons[0]).toMatchObject({ homework: 100, attitude: "중상", word: { right: 18, total: 20 }, retest: true });
    expect(a.lessons[1]!.retest).toBe(false);
  });

  it("이번 달 기록이 아직 없으면 지난달 · Monthly Test 달이 있으면 그 달", () => {
    const rows = [row("2026-10-20"), row("2026-10-27")];
    expect(pickMonthlyActivities(rows, new Set(), "2026-11-02", () => undefined).get("c1|s1")!.month).toBe("2026-10");
    const mixed = [row("2026-10-20"), row("2026-11-03")];
    expect(pickMonthlyActivities(mixed, new Set(), "2026-11-05", () => "2026-10").get("c1|s1")!.lessons).toHaveLength(1);
    expect(pickMonthlyActivities(mixed, new Set(), "2026-11-05", () => undefined).get("c1|s1")!.month).toBe("2026-11");
  });
});

describe("EiE 일일 보고서 단어 테스트", () => {
  const base = { dailyTest: "20문제 중 12개 맞음", checkTest: "", attitude: "", homework: "", homeworkToday: "", note: "" };

  it("재시험이면 맨 윗줄에 표시 · 피드백은 원문", () => {
    const v = englishSheetValues({ ...base, wordRetest: true, wordFeedback: "  철자 복습  " });
    expect(v.단어테스트.split("\n")[0]).toBe("[재시험]");
    expect(v.단어테스트).toContain("20문제 중 12개 맞음");
    expect(v.단어피드백).toBe("철자 복습");
    expect(englishSheetValues(base).단어테스트.startsWith("20문제 중 12개 맞음")).toBe(true);
    expect(splitRetest(v.단어테스트)).toEqual({ retest: true, body: v.단어테스트.split("\n").slice(1).join("\n") });
  });

  it("'단어 테스트' 제목은 일일 테스트와 같은 항목", () => {
    expect(isPilotTitle("단어 테스트", "daily")).toBe(true);
    expect(isPilotTitle("일일 테스트", "daily")).toBe(true);
  });
});
