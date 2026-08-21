/**
 * 분석 요약표 — **숫자를 누르면 그 칸의 일정이 모달로 열린다**(원장 2026-08-20).
 *
 * 🔑 이 테스트가 지키는 성질은 "모달이 열린다"가 아니라 **표의 숫자와 모달의 목록이 같은 일정을
 *    가리킨다**는 것이다. 건수와 목록이 다른 규칙으로 뽑히면 조사 도구로서 거짓말이 된다.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { CalendarEvent, CalendarTag } from "@/features/calendar/types";
import { StatsMatrix } from "./stats-matrix";

afterEach(cleanup);

const TAGS: CalendarTag[] = [
  { id: "t-brief", name: "설명회", color: "blue" },
  { id: "t-event", name: "행사", color: "#7c3aed" }, // 사용자 지정 hex 태그도 표에 뜬다
];

function ev(over: Partial<CalendarEvent> & { id: string; startDate: string }): CalendarEvent {
  return {
    title: `일정 ${over.id}`,
    memo: null,
    endDate: over.startDate,
    startTime: null,
    endTime: null,
    color: "primary",
    createdByName: null,
    source: "manual",
    seriesId: null,
    tag: null,
    ...over,
  } as CalendarEvent;
}

/**
 * 픽스처는 **세 축을 모두 가른다** — 태그(설명회/행사/없음) · 연도(2025/2026) · **월(5월/9월)**.
 * 🔴 월이 갈리는 조합이 없으면 월 필터를 통째로 지워도 테스트가 통과한다(2026-08-20 적대 리뷰가
 *    뮤테이션으로 실증). 그래서 '가을 설명회'(같은 태그·같은 해·다른 달)가 반드시 필요하다.
 */
const EVENTS: CalendarEvent[] = [
  ev({ id: "a", startDate: "2026-05-04", title: "봄 설명회", tag: TAGS[0] }),
  ev({ id: "b", startDate: "2026-05-20", title: "여름 설명회", tag: TAGS[0] }),
  ev({ id: "f", startDate: "2026-09-15", title: "가을 설명회", tag: TAGS[0] }), // 월 축 가드
  ev({ id: "c", startDate: "2026-05-11", title: "체육대회", tag: TAGS[1] }),
  ev({ id: "d", startDate: "2025-05-02", title: "작년 설명회", tag: TAGS[0] }),
  ev({ id: "e", startDate: "2026-08-01", title: "태그 없는 일정" }),
  // 해를 걸치는 일정 — 집계·목록 모두 **시작일 기준**이라 2025년 12월에만 잡혀야 한다.
  ev({ id: "g", startDate: "2025-12-30", endDate: "2026-01-05", title: "겨울 특강", tag: TAGS[1] }),
];

const YEARS = [2025, 2026, 2027];

function renderMatrix() {
  return render(<StatsMatrix years={YEARS} events={EVENTS} tags={TAGS} />);
}

/** 접근 이름으로 칸 버튼을 집는다(라벨이 곧 화면 설명 — "설명회 2026년 5월 2건 보기"). */
const cell = (name: RegExp) => screen.getByRole("button", { name });

describe("분석 요약표 숫자 칸", () => {
  it("건수가 있는 칸은 버튼, 0건은 버튼이 아니다(누를 게 없다)", () => {
    renderMatrix();
    expect(cell(/설명회 2026년 5월 2건 보기/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /설명회 2026년 1월/ })).toBeNull();
  });

  it("월 칸을 누르면 그 태그·그 달의 일정만 모달에 뜬다", () => {
    renderMatrix();
    fireEvent.click(cell(/설명회 2026년 5월 2건 보기/));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("봄 설명회")).toBeTruthy();
    expect(within(dialog).getByText("여름 설명회")).toBeTruthy();
    // 🔴 같은 태그·같은 해라도 **다른 달**은 섞이지 않는다(이 단언이 없으면 월 필터가 안 잠긴다)
    expect(within(dialog).queryByText("가을 설명회")).toBeNull();
    // 같은 달 다른 태그·같은 태그 다른 해도 섞이지 않는다
    expect(within(dialog).queryByText("체육대회")).toBeNull();
    expect(within(dialog).queryByText("작년 설명회")).toBeNull();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  });

  it("합계 칸을 누르면 그 해 전체가 뜬다(달을 가리지 않는다)", () => {
    renderMatrix();
    fireEvent.click(cell(/전체 2026년 전체 5건 보기/));

    const dialog = screen.getByRole("dialog");
    for (const title of ["봄 설명회", "여름 설명회", "가을 설명회", "체육대회", "태그 없는 일정"]) {
      expect(within(dialog).getByText(title)).toBeTruthy();
    }
    expect(within(dialog).queryByText("작년 설명회")).toBeNull();
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(5);
  });

  it("해를 걸치는 일정은 시작일이 있는 달에만 잡힌다(표·목록 규칙 일치)", () => {
    renderMatrix();
    // 2025-12-30 시작 → 2025년 12월에 있다
    fireEvent.click(cell(/행사 2025년 12월 1건 보기/));
    expect(within(screen.getByRole("dialog")).getByText("겨울 특강")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    // 종료일이 걸친 2026년 1월에는 없다 — 그 칸은 아예 버튼이 아니다
    expect(screen.queryByRole("button", { name: /행사 2026년 1월/ })).toBeNull();
  });

  it("표의 숫자와 모달 건수가 일치한다(같은 필터에서 나온다)", () => {
    renderMatrix();
    fireEvent.click(cell(/행사 2026년 5월 1건 보기/));
    const dialog = screen.getByRole("dialog");
    // 헤더 건수는 "일정 N건" 자리의 숫자 — 목록 길이와 같은 값이어야 한다.
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(within(dialog).getByText("일정", { exact: false }).textContent).toContain("1");
  });

  it("닫기와 Escape로 모달이 닫힌다", () => {
    renderMatrix();
    fireEvent.click(cell(/설명회 2026년 5월 2건 보기/));
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(cell(/설명회 2026년 5월 2건 보기/));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("태그 없는 일정도 자기 행에서 열린다(집계에서 빠지지 않는다)", () => {
    renderMatrix();
    fireEvent.click(cell(/태그 없음 2026년 8월 1건 보기/));
    expect(within(screen.getByRole("dialog")).getByText("태그 없는 일정")).toBeTruthy();
  });
});
