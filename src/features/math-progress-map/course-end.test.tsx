import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildYearView } from "./derive";
import { courseEndMonth, isAfterCourseEnd } from "./course-end";
import { ProgressMapProvider, useProgressMap } from "./components/map-state";
import { YearRing } from "./components/year-ring";
import { YearList } from "./components/detail-lists";
import { MonthRing } from "./components/month-ring";
import { buildSampleProgress } from "./sample";
import { progressForYear } from "./years";
import type { LearningRoadmap, StudentProgress } from "./model";

const step = (id: string, startMonth: string, endMonth: string) => ({
  id, label: id, group: "g", startMonth, endMonth, estimated: false, description: "",
});
const roadmapOf = (...steps: ReturnType<typeof step>[]): LearningRoadmap => ({
  enrolledOn: "2026-01-05", targetLabel: "", estimateNote: "", steps,
});

describe("종강 달 판정", () => {
  it("로드맵 마지막 단계의 끝 달 — 단계 순서가 뒤섞여도 가장 늦은 달", () => {
    expect(courseEndMonth({ roadmap: roadmapOf(step("b", "2027-01", "2027-06"), step("a", "2026-01", "2026-12")) })).toBe("2027-06");
  });

  it("🔴 로드맵이 없거나 끝 달이 비면 null — 모르는 것을 '끝났다'로 읽지 않는다", () => {
    expect(courseEndMonth({ roadmap: undefined })).toBeNull();
    expect(courseEndMonth({ roadmap: roadmapOf(step("a", "2026-01", "")) })).toBeNull();
  });

  it("수학 지도는 미래 수업일이 비어도 저장된 최종 목표 월을 종점으로 삼는다", () => {
    expect(courseEndMonth({ roadmap: roadmapOf(step("old", "2026-04", "2026-09")),
      learningMap: {} as StudentProgress["learningMap"],
      plan: { startDate: "2026-04-01", targetDate: "2028-09-30", startPage: 0, targetPage: 120 } })).toBe("2028-09");
  });

  it("종강 달 자체는 살아 있고, 그 다음 달부터 뒤다", () => {
    expect(isAfterCourseEnd("2029-02", 2029, 2)).toBe(false);
    expect(isAfterCourseEnd("2029-02", 2029, 3)).toBe(true);
    expect(isAfterCourseEnd("2029-02", 2028, 12)).toBe(false);
    expect(isAfterCourseEnd("2029-02", 2030, 1)).toBe(true);
    // 종강을 모르면 아무것도 막지 않는다.
    expect(isAfterCourseEnd(null, 2099, 12)).toBe(false);
  });
});

/** 샘플의 종강 달 — 계획이 늘면 따라 밀리므로 숫자를 박지 않는다. */
function sampleEnd(progress: StudentProgress) {
  const end = courseEndMonth(progress);
  if (!end) throw new Error("샘플에 로드맵이 없습니다");
  return { year: Number(end.slice(0, 4)), month: Number(end.slice(5, 7)) };
}

describe("뷰 트리 — afterEnd", () => {
  it("종강 해의 달들이 종강 달을 경계로 갈린다", () => {
    const source = buildSampleProgress();
    const { year, month } = sampleEnd(source);
    expect(month).toBeLessThan(12); // 경계를 볼 수 있는 샘플이어야 이 테스트가 뜻이 있다
    const view = buildYearView(progressForYear(source, year));
    expect(view.months[month - 1]!.afterEnd).toBe(false);
    expect(view.months[month]!.afterEnd).toBe(true);
    expect(view.months[11]!.afterEnd).toBe(true);
  });

  it("분기는 석 달이 **모두** 뒤일 때만 — 종강이 낀 분기는 살아 있다", () => {
    const source = buildSampleProgress();
    const { year, month } = sampleEnd(source);
    const view = buildYearView(progressForYear(source, year));
    const endQuarter = view.quarters[Math.floor((month - 1) / 3)]!;
    expect(endQuarter.afterEnd).toBe(false);
    expect(view.quarters[3]!.afterEnd).toBe(true);
  });

  it("🔴 로드맵이 낡아 종강 뒤에 기록이 있으면 막지 않는다 — 기록이 있는데 못 여는 달을 만들지 않는다", () => {
    const source = buildSampleProgress();
    const { year, month } = sampleEnd(source);
    const base = progressForYear(source, year);
    const after = `${year}-${String(month + 1).padStart(2, "0")}`;
    const withRecord: StudentProgress = {
      ...base,
      dailyProgress: [...base.dailyProgress, {
        date: `${after}-05`, bookName: "교재", chapter: "대단원", subChapter: "소단원",
        startPage: 1, endPage: 10, completedPage: 10, status: "completed",
      }],
    };
    expect(buildYearView(withRecord).months[month]!.afterEnd).toBe(false);
    // 그 달에 기록이 없으면 종전대로 막힌다(같은 데이터에서 조건만 갈린다).
    expect(buildYearView(base).months[month]!.afterEnd).toBe(true);
  });

  it("종강 전 해는 한 달도 막히지 않는다", () => {
    const source = buildSampleProgress();
    const view = buildYearView(source);
    expect(view.months.every((m) => !m.afterEnd)).toBe(true);
  });
});

function Jump({ year, month }: { year: number; month: number }) {
  const { selectPeriod, selectMonth, focus } = useProgressMap();
  return <>
    <button onClick={() => selectPeriod(year, month)}>종강 달로</button>
    <button onClick={() => selectMonth(month + 1)}>종강 다음 달 고르기</button>
    <output>{`초점 ${focus.month}월`}</output>
  </>;
}

describe("시계 — 종강 뒤 달은 누를 수 없다", () => {
  it("칸은 남지만 버튼이 아니고, 뜻 없는 `—` 알약도 안 그린다", () => {
    const source = buildSampleProgress();
    const { year, month } = sampleEnd(source);
    render(
      <ProgressMapProvider progress={source}>
        <svg><YearRing /><MonthRing /></svg>
        <Jump year={year} month={month} />
      </ProgressMapProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "종강 달로" }));

    // 종강 달은 그대로 고를 수 있다.
    expect(screen.getByRole("button", { name: new RegExp(`^${month}월 ·`) })).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(`^${month}월 1주차 ·`) })).toBeTruthy();
    // 그 다음 달부터는 버튼이 아니다(칸 자체는 aria-label을 달고 남아 있다).
    expect(screen.queryByRole("button", { name: new RegExp(`^${month + 1}월 ·`) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`^${month + 1}월 1주차 ·`) })).toBeNull();
    expect(screen.getByLabelText(`${month + 1}월 · 종강 이후`)).toBeTruthy();
    // 진도율 자리의 `—`(원장 지적)는 사라진다.
    expect(screen.queryAllByText("—")).toHaveLength(0);
  });

  it("🔴 세로 목록엔 줄을 아예 안 세운다 — 눌러도 무반응인 줄을 남기지 않는다", () => {
    const source = buildSampleProgress();
    const { year, month } = sampleEnd(source);
    const view = buildYearView(progressForYear(source, year));
    render(
      <ProgressMapProvider progress={source}>
        <YearList months={view.months} />
      </ProgressMapProvider>,
    );
    expect(screen.getByRole("button", { name: new RegExp(`^${month}월 `) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(`^${month + 1}월 `) })).toBeNull();
  });

  it("🔴 화면 밖 경로(드릴다운·목록·키보드)로도 못 고른다 — 게이트는 상태에 있다", () => {
    const source = buildSampleProgress();
    const { year, month } = sampleEnd(source);
    render(
      <ProgressMapProvider progress={source}>
        <Jump year={year} month={month} />
      </ProgressMapProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "종강 달로" }));
    expect(screen.getByText(`초점 ${month}월`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "종강 다음 달 고르기" }));
    expect(screen.getByText(`초점 ${month}월`)).toBeTruthy();
  });
});
