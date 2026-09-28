import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LevelSplitChart } from "./level-split";
import { GradeSplitChart } from "./grade-split";
import { DASHBOARD_SUBJECT_COLORS as C } from "@/features/dashboard/overview/subject-colors";
import { NO_SUBJECT } from "@/features/students/list-filter-values";
afterEach(cleanup);

const link = (name: string) => screen.getByRole("link", { name: `${name} 원생목록 열기` });
const query = (el: HTMLElement) => new URL(el.getAttribute("href") ?? "", "http://x").searchParams;

it("급별 세 조각과 별도의 미수강 막대가 전체 인원을 보존한다", () => {
  const split = { rows: [{ label: "초등", englishOnly: 2, both: 3, mathOnly: 4, neither: 2, total: 11 }] };
  const { container } = render(<LevelSplitChart split={split} noEnrollment={1} />);
  expect(screen.getByRole("img", { name: "초등 영어만 2명" })).toHaveStyle({ background: C.english });
  expect(screen.getByRole("img", { name: "초등 수학만 4명" })).toHaveStyle({ background: C.math });
  expect(screen.getByRole("img", { name: "기타 과목 재원생 1명" })).toHaveStyle({ background: C.other });
  expect(container.textContent).toContain("전체 재원생11명");
});

/**
 * 원장 2026-09-28 정정 — *"'미수강' 막대그래프 누르면 이동하는걸로 나머지는 현재 그대로"* · 학교급 팝업 *"이 안에서 누르면 이동"*.
 * 학교급 막대 = 팝업(막대 자체는 링크가 아니다) · 팝업 줄 = 학교급 × 구성 원생목록 · 미수강 = 수강 과목 '미수강' · 기타 과목 = 링크 없음.
 */
it("학교급 막대는 팝업 · 팝업 줄이 원생목록 · 미수강 막대만 바로 이동", () => {
  const split = { rows: [{ label: "중등", englishOnly: 1, both: 1, mathOnly: 1, neither: 2, total: 5 }] };
  render(<LevelSplitChart split={split} noEnrollment={1} />);
  expect(screen.queryByRole("link", { name: /중등 재원생/ })).toBeNull();
  expect(screen.queryByRole("link", { name: /기타 과목/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "중등 수강 구성 보기" }));
  const seg = query(link("중등 동시수강 1명"));
  expect(seg.get("level")).toBe("middle");
  expect(seg.get("mix")).toBe("both");
  expect(seg.get("status")).toBe("enrolled");
  expect(seg.get("from")).toBe("dashboard");
  const none = query(screen.getAllByRole("link", { name: "미수강 재원생 1명 원생목록 열기" })[0]);
  expect(none.get("subject")).toBe(NO_SUBJECT);
  expect(none.get("noenr")).toBe("0");
  expect(none.get("level")).toBeNull();
});

it("학년별도 실제 미수강과 기타 과목만 수강을 혼동하지 않는다", () => {
  render(<GradeSplitChart split={{ rows: [], neither: 3 }} noEnrollment={2} />);
  expect(screen.getByRole("img", { name: "미수강 재원생 2명" })).toHaveStyle({ background: C.unenrolled });
  expect(screen.getByRole("img", { name: "기타 과목 재원생 1명" })).toBeTruthy();
  expect(screen.queryByText(/모두 없는 재원생/)).toBeNull();
});
