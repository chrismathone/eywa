import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect } from "./searchable-select";

afterEach(cleanup);

const OPTIONS = [
  { value: "all", label: "전체" },
  { value: "math", label: "수학" },
];

it("표 밖에 열린 목록에서도 마우스로 선택할 수 있다", async () => {
  const onValueChange = vi.fn();
  render(<SearchableSelect options={OPTIONS} value="all" ariaLabel="과목" portal onValueChange={onValueChange} />);
  fireEvent.click(screen.getByRole("button", { name: "과목: 전체" }));
  const option = await screen.findByRole("button", { name: "수학" });
  fireEvent.mouseDown(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
  expect(onValueChange).toHaveBeenCalledWith("math");
});

/**
 * 🔴 `aria-label`은 **버튼 안의 글자를 덮는다** — 축 이름만 주면 낭독기가 "과목 필터"까지만 읽고
 *    지금 고른 값을 영영 안 읽는다(재리뷰 2026-09-04). 필터 트리거 100여 곳이 이 부품을 쓴다.
 *    (같은 일을 하는 `HrefSelect`는 처음부터 트리거에 aria-label을 안 달아 보이는 글자가 곧 이름이다.)
 */
describe("SearchableSelect 트리거 접근성 이름", () => {
  it("서술 라벨을 주면 **값을 붙여** 한 이름으로 만든다", () => {
    render(<SearchableSelect options={OPTIONS} value="math" ariaLabel="과목 필터" valuePrefix="과목" />);
    expect(screen.getByRole("button", { name: "과목 필터: 수학" })).toBeTruthy();
  });

  it("고른 게 없으면 placeholder가 값 자리에 선다(이름이 축만 남지 않는다)", () => {
    render(<SearchableSelect options={OPTIONS} value="" ariaLabel="담임 필터" placeholder="전체" />);
    expect(screen.getByRole("button", { name: "담임 필터: 전체" })).toBeTruthy();
  });

  it("서술 라벨이 없으면 aria-label을 달지 않는다 — 보이는 글자가 곧 이름", () => {
    const { container } = render(<SearchableSelect options={OPTIONS} value="math" />);
    const trigger = container.querySelector("button")!;
    expect(trigger.hasAttribute("aria-label")).toBe(false);
    expect(trigger.textContent).toContain("수학");
  });
});

/**
 * 열 맞춤 폭 지정(`sideColumns`, 원장 2026-09-18 *"이름 / 과목 / 날짜 이렇게 열맞춤"*).
 * 🔴 두 가지가 깨지면 열이 어긋난다 — 빈 hint가 칸을 안 세우거나, 선택된 줄만 체크 폭만큼 밀리거나.
 */
describe("SearchableSelect 열 맞춤(sideColumns)", () => {
  const ROWS = [
    { value: "a", label: "고등M 개별 BS4F 토", hint: "수학", meta: "2026-07-04~" },
    { value: "b", label: "과목 없는 반", hint: "", meta: "2026-09-03~" },
  ];
  const cols = { hint: "w-16 text-left", meta: "w-24 text-left" };

  it("빈 hint도 같은 폭의 칸을 세운다 — 안 세우면 그 줄만 날짜 열이 왼쪽으로 붙는다", () => {
    render(<SearchableSelect options={ROWS} value="a" defaultOpen sideColumns={cols} />);
    const row = screen.getByText("과목 없는 반").closest("button")!;
    expect(row.querySelectorAll(".w-16")).toHaveLength(1);
    expect(row.querySelectorAll(".w-24")).toHaveLength(1);
  });

  it("선택 안 된 줄도 체크 자리를 비워 둔다 — 선택된 줄만 열이 밀리지 않게", () => {
    render(<SearchableSelect options={ROWS} value="a" defaultOpen sideColumns={cols} />);
    const other = screen.getByText("과목 없는 반").closest("button")!;
    expect(other.querySelector('span[aria-hidden][class~="size-3.5"]')).not.toBeNull();
  });

  it("안 주면 종전 모양 그대로 — 다른 화면(교재 단가표 등)은 바뀌지 않는다", () => {
    render(<SearchableSelect options={ROWS} value="a" defaultOpen />);
    const other = screen.getByText("과목 없는 반").closest("button")!;
    expect(other.querySelector(".w-12")).not.toBeNull();
    expect(other.querySelector('span[aria-hidden][class~="size-3.5"]')).toBeNull();
  });
});

describe("SearchableSelect 묶음 제목", () => {
  const TEACHERS = [
    { value: "", label: "전체" },
    { value: "a", label: "재직강사" },
    { value: "b", label: "퇴사강사", group: "퇴사자" },
    { value: "c", label: "다른퇴사", group: "퇴사자" },
  ];
  it("묶음 위에 제목이 한 번만 서고, 검색해도 남은 줄 위에 선다", async () => {
    render(<SearchableSelect options={TEACHERS} value="" ariaLabel="강사" />);
    fireEvent.click(screen.getByRole("button", { name: /강사/ }));
    expect(await screen.findAllByText("퇴사자")).toHaveLength(1);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "다른" } });
    expect(screen.getByText("퇴사자")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "재직강사" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "재직" } });
    expect(screen.queryByText("퇴사자")).toBeNull();
  });
});
