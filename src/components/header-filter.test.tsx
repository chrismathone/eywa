import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const push = vi.fn();
let search = "subject=math&from=dashboard&page=3";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/students",
  useSearchParams: () => new URLSearchParams(search),
}));

import { HeaderFilter } from "./header-filter";

afterEach(cleanup);
beforeEach(() => push.mockClear());

const OPTIONS = [
  { value: "math", label: "수학" },
  { value: "english", label: "영어" },
  { value: "__none__", label: "미수강" },
];
const pushed = () => new URL(push.mock.calls.at(-1)?.[0] as string, "http://x").searchParams;

/** 원장 2026-09-28 *"이런 류의 드랍다운 선택은 중복 선택가능하게"* — 열 머리 필터 다중 선택. */
it("다중 선택 — 누르면 더해지고(선택지 순서) 목록은 열린 채 · 쪽 번호와 지정 파라미터는 지운다", () => {
  render(
    <HeaderFilter paramName="subject" value="math" options={OPTIONS} axisLabel="수강 과목" allValue="all" explicitAll multiple clearParams={["from"]} />,
  );
  fireEvent.click(screen.getByRole("button", { name: /수강 과목 필터/ }));
  fireEvent.click(screen.getByRole("button", { name: "미수강" }));
  expect(pushed().get("subject")).toBe("math,__none__");
  expect(pushed().get("page")).toBeNull();
  expect(pushed().get("from")).toBeNull();
  // 닫히지 않는다 — 둘째 항목을 바로 누를 수 있다.
  expect(screen.getByRole("button", { name: "영어" })).toBeTruthy();
});

it("다중 선택 — 골라진 값을 누르면 빠지고, 다 빠지면 '전체'(explicitAll = all)", () => {
  search = "subject=math";
  render(<HeaderFilter paramName="subject" value="math" options={OPTIONS} axisLabel="수강 과목" allValue="all" explicitAll multiple />);
  fireEvent.click(screen.getByRole("button", { name: /수강 과목 필터/ }));
  fireEvent.click(screen.getByRole("button", { name: "수학" }));
  expect(pushed().get("subject")).toBe("all");
});

it("다중 선택 — 트리거는 `첫 이름 외 N`, 목록엔 고른 것마다 표시 · 선택지 밖 값도 세운다", () => {
  render(
    <HeaderFilter paramName="subject" value="english,math,gone" options={OPTIONS} axisLabel="수강 과목" allValue="all" explicitAll multiple />,
  );
  const trigger = screen.getByRole("button", { name: /수강 과목 필터/ });
  expect(trigger.textContent).toContain("수강 과목: 수학 외 2");
  fireEvent.click(trigger);
  expect(screen.getByRole("button", { name: "수학" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "영어" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "미수강" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("button", { name: "(선택지에 없는 값)" }).getAttribute("aria-pressed")).toBe("true");
});

it("단일 선택(multiple 없음)은 종전 그대로 — 값을 바꾸고 닫힌다", () => {
  search = "status=enrolled";
  render(<HeaderFilter paramName="status" value="enrolled" options={[{ value: "withdrawn", label: "퇴원" }]} axisLabel="상태" allValue="enrolled" />);
  fireEvent.click(screen.getByRole("button", { name: /상태 필터/ }));
  fireEvent.click(screen.getByRole("button", { name: "퇴원" }));
  expect(pushed().get("status")).toBe("withdrawn");
  expect(screen.queryByRole("button", { name: "퇴원" })).toBeNull();
});
