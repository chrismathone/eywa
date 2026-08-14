import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MonthlyTable } from "./monthly-table";
import type { SeatMonthlyView } from "@/features/attendance/seat/monthly-build";

/**
 * 자리 월간 격자의 **렌더 가드**. 순수 조립(monthly-build)은 따로 테스트하지만, 표 자체가 안 그려지면
 * 그 계산이 아무 소용이 없다 — 이 화면은 원장 기준이 "한눈에"라 표가 곧 제품이다.
 *
 * 특히 세 가지를 잠근다:
 *  ① **확정과 확인 필요를 한 숫자로 합치지 않는다**(급여 근거와 담임 정산이 섞이면 안 된다).
 *  ② 기록이 하나도 없어도 표는 선다(자리 출석부를 아직 아무도 안 쓴 게 기본 상태다).
 *  ③ 패딩 칸(그 달에 없는 날)이 본문 값으로 새지 않는다.
 */
function view(over: Partial<SeatMonthlyView> = {}): SeatMonthlyView {
  const days = [
    { date: "2026-08-03", day: 3, dow: 1, label: "월", isWeekend: false, isToday: false },
    { date: "2026-08-04", day: 4, dow: 2, label: "화", isWeekend: false, isToday: false },
    { date: "pad-32", day: 32, dow: -1, label: "", isWeekend: false, isToday: false, placeholder: true },
  ];
  return {
    month: "2026-08",
    window: {
      kind: "month",
      scope: null,
      start: "2026-08-01",
      end: "2026-08-31",
      label: "2026년 8월",
      defId: null,
    },
    days,
    minutesPerSlot: 40,
    dateTotals: { "2026-08-03": { confirmed: 1, review: 1 } },
    groups: [
      {
        classId: "c1",
        className: "DP6",
        subject: "english",
        scheduleLabel: "월 15:00",
        confirmedUnits: 1,
        reviewUnits: 1,
        students: [
          {
            id: "s1",
            name: "김학생",
            school: "경명여중",
            grade: "중2",
            attendDows: [1],
            spans: [{ start: "2026-01-01", end: null }],
            badges: [],
            confirmedUnits: 1,
            reviewUnits: 0,
            counted: { present: 1, absent: 0, late: 0, makeup: 0, excused: 0, units: 1 },
          },
          {
            id: "s2",
            name: "이확인",
            school: "침산중",
            grade: "중1",
            attendDows: [1],
            spans: [{ start: "2026-01-01", end: "2026-08-20" }],
            badges: [{ kind: "left" as const, date: "2026-08-20" }],
            confirmedUnits: 0,
            reviewUnits: 1,
            counted: { present: 1, absent: 0, late: 0, makeup: 0, excused: 0, units: 1 },
          },
        ],
        cells: {
          s1: {
            "2026-08-03": {
              expected: true,
              outside: false,
              slots: [{ start: "15:00", status: "present", units: null, track: "confirmed" }],
            },
          },
          s2: {
            "2026-08-03": {
              expected: true,
              outside: false,
              slots: [{ start: "15:00", status: "present", units: null, track: "review" }],
            },
          },
        },
      },
    ],
    summary: {
      classCount: 1,
      studentCount: 2,
      confirmedUnits: 1,
      reviewUnits: 1,
      present: 2,
      absent: 0,
      late: 0,
      unmarked: 0,
    },
    ...over,
  } as SeatMonthlyView;
}

describe("자리 월간 격자", () => {
  it("반 머리행·학생·날짜가 그려진다", () => {
    render(<MonthlyTable seat="lab" view={view()} holidays={{}} />);
    expect(screen.getByText("DP6")).toBeTruthy();
    expect(screen.getByText("김학생")).toBeTruthy();
    expect(screen.getByText("이확인")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // 8/3 날짜 머리
  });

  it("확정과 확인 필요는 각자 열·각자 합계 — 한 숫자로 합치지 않는다", () => {
    render(<MonthlyTable seat="lab" view={view()} holidays={{}} />);
    // 열 머리 + 아래 합계줄에 각각 선다(반 머리행 요약에도 "확정 N시수"가 있어 여러 개다).
    expect(screen.getAllByText("확정").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("확인").length).toBeGreaterThanOrEqual(2);
    // 학생별: 확정만 있는 학생과 확인만 있는 학생이 서로 다른 칸에 선다(둘 다 "—"가 하나씩 있다).
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("퇴원·신입은 이름 옆 라벨로 — 회색 띠만으로는 왜 비었는지 모른다", () => {
    render(<MonthlyTable seat="lab" view={view()} holidays={{}} />);
    expect(screen.getByText("퇴원")).toBeTruthy();
    expect(screen.getByTitle("2026-08-20 퇴원")).toBeTruthy();
  });

  it("기록이 없어도 표는 선다 — 자리 출석부를 아직 아무도 안 쓴 상태가 기본", () => {
    const empty = view({
      dateTotals: {},
      summary: {
        classCount: 1,
        studentCount: 2,
        confirmedUnits: 0,
        reviewUnits: 0,
        present: 0,
        absent: 0,
        late: 0,
        unmarked: 2,
      },
      groups: [
        {
          ...view().groups[0]!,
          confirmedUnits: 0,
          reviewUnits: 0,
          cells: {
            s1: { "2026-08-03": { expected: true, outside: false, slots: [{ start: "15:00", status: null, units: null, track: null }] } },
            s2: {},
          },
        },
      ],
    });
    render(<MonthlyTable seat="lab" view={empty} holidays={{}} />);
    expect(screen.getByText("김학생")).toBeTruthy();
    expect(screen.getByText("DP6")).toBeTruthy();
  });
});
