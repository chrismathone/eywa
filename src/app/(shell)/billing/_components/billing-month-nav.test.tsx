import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BillingMonthNav } from "./billing-month-nav";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/billing",
  useSearchParams: () => new URLSearchParams("tab=refunds&period=2026-08&status=pending&q=test&page=3&embed=1"),
}));
vi.mock("@/features/billing/calc", () => ({ currentPeriod: () => "2026-09" }));
// 메뉴의 포털·검색 UI 대신 선택 입력을 사용하고 실제 FilterSelect의 URL 변경을 검증한다.
vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ value, onValueChange, options, ariaLabel }: {
    value: string; onValueChange: (value: string) => void;
    options: { value: string; label: string }[]; ariaLabel: string;
  }) => <select aria-label={ariaLabel} value={value} onChange={(e) => onValueChange(e.target.value)}>
    {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("수납 월 이동", () => {
  const hrefFor = (period: string) => `/billing?tab=refunds&period=${period}`;
  it("과거 달이 기본인 환불도 이번 달로 이동할 수 있고 필터·embed를 보존한다", () => {
    render(<BillingMonthNav period="2026-08" defaultPeriod="2026-08" months={["2026-08"]} hrefFor={hrefFor} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-09" } });
    const params = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
    expect(Object.fromEntries(params)).toEqual({ tab: "refunds", period: "2026-09", status: "pending", q: "test", embed: "1" });
  });
  it("기본 달을 선택하면 period를 지우고 목록 밖의 조회 달도 선택값으로 유지한다", () => {
    render(<BillingMonthNav period="2025-01" defaultPeriod="2026-08" months={["2026-08", "2026-08"]} hrefFor={hrefFor} />);
    expect(screen.getByRole("combobox")).toHaveValue("2025-01");
    expect(screen.getAllByRole("option", { name: "2026년 8월" })).toHaveLength(1);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "2026-08" } });
    const params = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
    expect(params.has("period")).toBe(false);
    expect(params.get("tab")).toBe("refunds");
    expect(params.has("page")).toBe(false);
  });
});
