import { describe, expect, it } from "vitest";
import { buildDayRecap, type RecapSlotInput } from "./digest";
import { buildRangeRecap, recapDatesFor, recapRangeDates, RECAP_MAX_DAYS, type RecapDay } from "./range";

function day(date: string, over: Partial<RecapSlotInput> = {}, holiday: string | null = null): RecapDay {
  return {
    ...buildDayRecap({
      date,
      slots: [
        {
          classId: "c1",
          className: "중2 A",
          subject: "math",
          slotStart: "16:20",
          saveSlot: null,
          teacherName: "김강사",
          slotTeacherLabel: null,
          hasAnyRecord: true,
          students: [
            { studentId: "s1", studentName: "이학생", schoolGrade: null, status: "absent", note: null },
          ],
          ...over,
        },
      ],
    }),
    holiday,
  };
}

describe("recapDatesFor", () => {
  it("월요일은 금·토·일 사흘을 덮는다 (원장 2026-08-19 정정)", () => {
    // 2026-08-24는 월요일.
    expect(recapDatesFor("2026-08-24")).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
  });

  it("그 밖의 요일은 어제 하루", () => {
    expect(recapDatesFor("2026-08-19")).toEqual(["2026-08-18"]); // 수 → 화
    expect(recapDatesFor("2026-08-22")).toEqual(["2026-08-21"]); // 토 → 금
  });

  it("월요일의 '어제'인 일요일이 목록에서 빠지지 않는다 — 보강·특강이 있었다면 그날도 봐야 한다", () => {
    expect(recapDatesFor("2026-08-24")).toContain("2026-08-23");
  });
});

describe("recapRangeDates", () => {
  it("from~to를 날짜로 편다", () => {
    expect(recapRangeDates("2026-08-21", "2026-08-23")).toEqual([
      "2026-08-21",
      "2026-08-22",
      "2026-08-23",
    ]);
  });

  it("from이 없거나 뒤집혀 있으면 하루로 접는다", () => {
    expect(recapRangeDates("", "2026-08-23")).toEqual(["2026-08-23"]);
    expect(recapRangeDates("2026-08-25", "2026-08-23")).toEqual(["2026-08-23"]);
  });

  it("URL로 아무 범위나 넣어 보드를 N번 적재시키지 못하게 상한을 건다", () => {
    const dates = recapRangeDates("2026-01-01", "2026-08-23");
    expect(dates).toHaveLength(RECAP_MAX_DAYS);
    // 🔴 잘릴 때 **마지막 날은 반드시 to** — 아니면 AI 정리 행의 키(from~to)가 화면과 어긋나
    //    저장된 요약이 영영 안 보인다.
    expect(dates[dates.length - 1]).toBe("2026-08-23");
  });
});

describe("buildRangeRecap", () => {
  it("합계는 더하고 내용은 날짜별로 남긴다", () => {
    const range = buildRangeRecap([day("2026-08-22"), day("2026-08-21")]);
    expect(range.from).toBe("2026-08-21");
    expect(range.to).toBe("2026-08-22");
    // 오름차순으로 정렬 — 금 → 토 순으로 읽는다.
    expect(range.days.map((d) => d.date)).toEqual(["2026-08-21", "2026-08-22"]);
    // 같은 학생이 이틀 빠지면 2건이 맞다("빠진 수업"을 센다).
    expect(range.totals.absent).toBe(2);
    expect(range.days[0]!.absences).toHaveLength(1);
    expect(range.days[1]!.absences).toHaveLength(1);
  });

  it("입력률은 범위 전체 칸으로 다시 계산한다(하루치 비율의 평균이 아니다)", () => {
    const full = day("2026-08-21");
    const empty = day("2026-08-22", {
      students: [{ studentId: "s9", studentName: "미입력", schoolGrade: null, status: null, note: null }],
      hasAnyRecord: false,
    });
    const range = buildRangeRecap([full, empty]);
    expect(range.totals.cells).toBe(2);
    expect(range.totals.recorded).toBe(1);
    expect(range.totals.inputRate).toBe(50);
  });

  it("강사는 날짜를 가로질러 합친다 — 같은 사람이 두 줄로 갈리면 '누가 계속 안 찍나'가 안 보인다", () => {
    const range = buildRangeRecap([day("2026-08-21"), day("2026-08-22")]);
    expect(range.teachers).toHaveLength(1);
    expect(range.teachers[0]!.cells).toBe(2);
  });

  it("휴원일은 그 사실을 달고 남는다(빈 날과 구분)", () => {
    const range = buildRangeRecap([
      { ...day("2026-08-15", { students: [] }), holiday: "광복절" },
      day("2026-08-16"),
    ]);
    expect(range.days[0]!.holiday).toBe("광복절");
    expect(range.days[1]!.holiday).toBeNull();
  });
});
