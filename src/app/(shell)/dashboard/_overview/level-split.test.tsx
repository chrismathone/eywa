import { cleanup, render, screen } from "@testing-library/react";
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
  expect(link("초등 영어만 2명").parentElement).toHaveStyle({ background: C.english });
  expect(link("초등 동시수강 3명").parentElement).toHaveStyle({ background: C.both });
  expect(link("초등 수학만 4명").parentElement).toHaveStyle({ background: C.math });
  expect(screen.getAllByRole("link", { name: "기타 과목 재원생 1명 원생목록 열기" }).length).toBeGreaterThan(0);
  expect(screen.getAllByRole("link", { name: "미수강 재원생 1명 원생목록 열기" })[1].parentElement).toHaveStyle({
    background: C.unenrolled,
  });
  expect(container.textContent).toContain("전체 재원생11명");
});

/** 원장 2026-09-28 — 막대를 누르면 그 조건의 원생목록. 목록은 막대와 같은 함수로 거른다(composition-filter-parity.test.ts). */
it("조각 = 학교급 × 구성, 줄 = 학교급 × 세 구성, 기타 과목 = mix=other, 미수강 = 수강 과목 '미수강'", () => {
  const split = { rows: [{ label: "중등", englishOnly: 1, both: 1, mathOnly: 1, neither: 2, total: 5 }] };
  render(<LevelSplitChart split={split} noEnrollment={1} />);
  const seg = query(link("중등 동시수강 1명"));
  expect(seg.get("level")).toBe("middle");
  expect(seg.get("mix")).toBe("both");
  expect(seg.get("status")).toBe("enrolled");
  expect(seg.get("from")).toBe("dashboard");
  const row = query(screen.getAllByRole("link", { name: "중등 재원생 3명 원생목록 열기" })[0]);
  expect(row.get("mix")).toBe("englishOnly,both,mathOnly");
  expect(query(screen.getAllByRole("link", { name: "기타 과목 재원생 1명 원생목록 열기" })[0]).get("mix")).toBe("other");
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
