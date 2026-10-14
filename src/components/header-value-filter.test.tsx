import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BLANK_LABEL, BLANK_VALUE } from "@/lib/value-filter";
import { HeaderValueFilter } from "./header-value-filter";

const push = vi.fn();
let query = "tab=records&embed=1&page=3";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/exams",
  useSearchParams: () => new URLSearchParams(query),
}));
afterEach(() => { cleanup(); push.mockClear(); query = "tab=records&embed=1&page=3"; });

const options = [
  { value: "c1", label: "A반" },
  { value: "c2", label: "B반" },
  { value: "c3", label: "C반" },
  { value: BLANK_VALUE, label: BLANK_LABEL },
];
const open = () => fireEvent.click(screen.getByRole("button", { name: "반 필터" }));

describe("엑셀식 열 머리 필터(원장 2026-10-14)", () => {
  it("열면 전부 체크 · 하나를 끄고 확인 = '이것만 뺀다' 한 줄로 · 다른 주소 값(embed)은 남기고 쪽은 1쪽으로", () => {
    render(<HeaderValueFilter paramName="fClass" axisLabel="반" filter={null} options={options} />);
    open();
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "B반" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    const url = new URL(push.mock.calls[0]![0], "http://x");
    expect(url.pathname).toBe("/exams");
    expect(url.searchParams.get("fClass")).toBe("!c2");
    expect(url.searchParams.get("embed")).toBe("1");
    expect(url.searchParams.get("page")).toBeNull();
  });

  it("검색 → 지우기는 보이는 것만 끈다 · 하나도 안 고르면 확인이 잠긴다 · 취소는 아무것도 안 바꾼다", () => {
    render(<HeaderValueFilter paramName="fClass" axisLabel="반" filter={null} options={options} />);
    open();
    fireEvent.change(screen.getByRole("searchbox", { name: "값 검색" }), { target: { value: "A" } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "값 검색" }), { target: { value: "" } });
    expect(screen.getByRole("checkbox", { name: "A반" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B반" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "모두 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(push).not.toHaveBeenCalled();
    open();
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    expect(screen.getByRole("button", { name: "확인" })).toBeDisabled();
  });

  it("검색칸 Enter = 검색 결과만 건다 — 다른 값이 걸려 있어도 · 결과 중 체크한 게 있으면 그것만(리뷰 2026-10-14)", () => {
    render(<HeaderValueFilter paramName="fClass" axisLabel="반" filter={{ mode: "in", values: ["c1"] }} options={options} />);
    open();
    const search = screen.getByRole("searchbox", { name: "값 검색" });
    fireEvent.change(search, { target: { value: "B" } });
    fireEvent.keyDown(search, { key: "Enter", isComposing: true, keyCode: 229 });
    expect(push).not.toHaveBeenCalled(); // 한글 조합 확정 Enter는 걸지 않는다.
    fireEvent.keyDown(search, { key: "Enter" });
    expect(new URL(push.mock.calls[0]![0], "http://x").searchParams.get("fClass")).toBe("c2");
  });

  it("'뺀다'로 걸린 값이 목록에 없어도 꺼진 채로 세운다 — 열고 확인만 눌러도 제외가 풀리지 않게", () => {
    render(<HeaderValueFilter paramName="fClass" axisLabel="반" filter={{ mode: "out", values: ["gone"] }} options={options} />);
    open();
    expect(screen.getByRole("checkbox", { name: "(선택지에 없는 값)" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(new URL(push.mock.calls[0]![0], "http://x").searchParams.get("fClass")).toBe("!gone");
  });

  it("걸린 필터는 그 체크로 열리고, 전부 다시 켜면 필터를 지운다", () => {
    query = "fClass=c1%2Cc3&tab=records";
    render(<HeaderValueFilter paramName="fClass" axisLabel="반" filter={{ mode: "in", values: ["c1", "c3"] }} options={options} />);
    expect(screen.getByRole("button", { name: "반 필터" })).toHaveAttribute("data-filtered");
    open();
    expect(screen.getByRole("checkbox", { name: "B반" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "C반" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "모두 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    expect(new URL(push.mock.calls[0]![0], "http://x").searchParams.has("fClass")).toBe(false);
  });
});
