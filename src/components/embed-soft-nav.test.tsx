import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * 창(iframe) 안의 **소프트 이동이 embed=1을 지우지 않는다** — 메뉴·창 이동 전수검사(2026-09-11) `$[6].findings[2]`.
 *
 * 🔑 왜 문제인가: 소프트 이동은 셸 레이아웃을 다시 그리지 않아 **당장은 멀쩡하다**. 그런데 그 뒤의
 *    `router.refresh()`(출석부 정렬·기간 저장)나 서버 액션 재검증은 **지금 주소**로 공유 레이아웃까지 다시 받는다
 *    (Next 16 refresh-reducer: *"existing dynamic data (including in shared layouts) is re-fetched"*). 주소에 embed가
 *    없으면 proxy가 x-embed를 안 붙이고 (shell)/layout이 **전체 셸 갈래**를 돌려준다 = 창 안에 셸이 뜬다.
 * 규칙은 FaceTabs와 같다 — 창 안(`useEmbed`)이면 이동 주소에 `withEmbed`. 호출부 주소 빌더는 그대로다.
 * ⚠️ `<a href>`(수식키 클릭 = 새 탭)는 **원래 주소**를 유지한다 — 새 탭은 최상위라 embed를 실으면 셸 없는 화면이 뜬다.
 */
const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/attendance",
  useSearchParams: () => new URLSearchParams(),
}));

import { EmbedProvider } from "@/components/workspace/embed-context";
import { PeriodNav } from "./period-nav";
import { HrefSelect } from "./href-select";
import { ParamLink } from "@/app/(shell)/timetable/_components/param-link";
import { WeekPeriodNav } from "@/app/(shell)/timetable/_components/week-period-nav";
import { EcsDatePicker } from "@/app/(shell)/ecs/_components/today-date-picker";

afterEach(cleanup);
beforeEach(() => router.push.mockClear());

const inWindow = (ui: ReactNode) => render(<EmbedProvider embed>{ui}</EmbedProvider>);

const MONTH_NAV = {
  label: "2026년 9월",
  prevHref: "/attendance?month=2026-08",
  nextHref: "/attendance?month=2026-10",
  currentHref: "/attendance?month=2026-09",
} as const;

describe("PeriodNav — 기간 이동", () => {
  it("🔴 창 안: ›가 embed=1을 실어 이동한다(출석부 월 이동 뒤 정렬 저장 = 전체 셸로 뒤집히던 경로)", () => {
    inWindow(<PeriodNav {...MONTH_NAV} relation="current" />);
    fireEvent.click(screen.getByLabelText("다음"));
    expect(router.push).toHaveBeenCalledWith("/attendance?month=2026-10&embed=1");
  });

  it("창 안: 가운데 라벨(이번 기간으로)도 embed를 유지한다", () => {
    inWindow(<PeriodNav {...MONTH_NAV} relation="past" />);
    fireEvent.click(screen.getByText("2026년 9월"));
    expect(router.push).toHaveBeenCalledWith("/attendance?month=2026-09&embed=1");
  });

  it("창 밖(최상위·폰): 주소 그대로", () => {
    render(<PeriodNav {...MONTH_NAV} relation="current" />);
    fireEvent.click(screen.getByLabelText("이전"));
    expect(router.push).toHaveBeenCalledWith("/attendance?month=2026-08");
  });

  it("가로챈 화면(onNavigate — ECS·MCS 저장 flush)도 embed가 실린 주소를 받는다", () => {
    const onNavigate = vi.fn();
    inWindow(
      <PeriodNav
        label="9월 3주차"
        prevHref="/ecs/c1?week=2026-09-07"
        nextHref="/ecs/c1?week=2026-09-21"
        currentHref="/ecs/c1"
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByLabelText("다음"));
    expect(onNavigate).toHaveBeenCalledWith("/ecs/c1?week=2026-09-21&embed=1");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("🔴 주소가 아닌 값(원스크린은 날짜 문자열을 넘긴다)은 손대지 않는다", () => {
    const onNavigate = vi.fn();
    inWindow(
      <PeriodNav
        label="2026년 9월 11일 (금)"
        prevHref="2026-09-10"
        nextHref="2026-09-12"
        currentHref="2026-09-11"
        onNavigate={onNavigate}
      />,
    );
    fireEvent.click(screen.getByLabelText("이전"));
    expect(onNavigate).toHaveBeenCalledWith("2026-09-10");
  });
});

describe("WeekPeriodNav — 시간표 주 이동(미저장 가드 래퍼)", () => {
  it("창 안: 다음 주로 가도 embed가 남는다", () => {
    inWindow(
      <WeekPeriodNav
        label="9월 3주차"
        prevHref="/timetable?week=2026-09-07"
        nextHref="/timetable?week=2026-09-21"
        currentHref="/timetable"
        relation="past"
      />,
    );
    fireEvent.click(screen.getByLabelText("다음 주"));
    expect(router.push).toHaveBeenCalledWith("/timetable?week=2026-09-21&embed=1", { scroll: false });
  });
});

describe("HrefSelect — 링크 모드", () => {
  const OPTIONS = [
    { value: "class", label: "반별", href: "/attendance?mode=class&month=2026-09" },
    { value: "teacher", label: "강사 전체", href: "/attendance?mode=teacher&month=2026-09" },
  ];

  it("🔴 창 안: 고른 항목으로 embed를 실어 이동하고, 링크 href는 원래 주소(새 탭용)", async () => {
    inWindow(<HrefSelect axisLabel="보기" ariaLabel="보기 선택" value="class" options={OPTIONS} />);
    fireEvent.click(screen.getByText("보기: 반별"));
    const item = await screen.findByRole("menuitem", { name: /강사 전체/ });
    expect(item.getAttribute("href")).toBe("/attendance?mode=teacher&month=2026-09");
    fireEvent.click(item);
    expect(router.push).toHaveBeenCalledWith("/attendance?mode=teacher&month=2026-09&embed=1", { scroll: false });
  });

  it("창 밖: 주소 그대로", async () => {
    render(<HrefSelect axisLabel="보기" ariaLabel="보기 선택" value="class" options={OPTIONS} />);
    fireEvent.click(screen.getByText("보기: 반별"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /강사 전체/ }));
    expect(router.push).toHaveBeenCalledWith("/attendance?mode=teacher&month=2026-09", { scroll: false });
  });
});

describe("ParamLink — 시간표 칩", () => {
  it("🔴 창 안: 과목 칩이 embed를 실어 이동하고, 링크 href는 원래 주소", () => {
    inWindow(<ParamLink href="/timetable?subject=english">영어</ParamLink>);
    const a = screen.getByText("영어");
    expect(a.getAttribute("href")).toBe("/timetable?subject=english");
    fireEvent.click(a);
    expect(router.push).toHaveBeenCalledWith("/timetable?subject=english&embed=1", { scroll: false });
  });
});

describe("EcsDatePicker — ECS 오늘·자리 면 달력", () => {
  it("🔴 창 안: 고른 날짜로 embed를 실어 이동한다", () => {
    inWindow(<EcsDatePicker date="2026-09-11" mode="cards" />);
    fireEvent.change(screen.getByLabelText("날짜 선택"), { target: { value: "2026-09-15" } });
    expect(router.push).toHaveBeenCalledWith("/ecs?view=today&date=2026-09-15&mode=cards&embed=1");
  });

  it("창 밖: 주소 그대로", () => {
    render(<EcsDatePicker date="2026-09-11" view="room" />);
    fireEvent.change(screen.getByLabelText("날짜 선택"), { target: { value: "2026-09-15" } });
    expect(router.push).toHaveBeenCalledWith("/ecs?view=room&date=2026-09-15");
  });
});
