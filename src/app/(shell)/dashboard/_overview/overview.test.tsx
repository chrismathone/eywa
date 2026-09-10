import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { summarizeInvoices } from "@/features/billing/calc";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { Overview } from "./overview";

const mocks = vi.hoisted(() => ({ data: null as unknown as OverviewSnapshot }));
vi.mock("./use-overview", () => ({
  useOverview: () => ({
    data: mocks.data,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({
    href,
    children,
    className,
    ariaLabel,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    ariaLabel?: string;
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

const snapshot = (): OverviewSnapshot => ({
  scope: "tenant:user:master:all",
  tenantId: "tenant",
  academy: "학원",
  today: "2026-09-10",
  requestedAt: 100,
  allowed: ["dashboard"],
  subjects: {},
  sections: {},
});

describe("overview display contracts", () => {
  it("keeps attendance cells and invoices in their own units", () => {
    mocks.data = snapshot();
    mocks.data.sections = {
      attendance: {
        data: {
          date: "2026-09-10",
          total: 3,
          present: 1,
          absent: 1,
          late: 0,
          excused: 0,
          rate: 33.3,
        },
        at: 100,
        error: false,
      },
      billing: {
        data: [
          summarizeInvoices(
            [
              {
                amountTotal: 100,
                amountPaid: 100,
                amountDiscount: 0,
                status: "paid",
              },
            ],
            "2026-09",
          ),
        ],
        at: 100,
        error: false,
      },
    };
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain('aria-label="출결 기록 3칸.');
    expect(html).toContain('aria-label="청구서 1건.');
    expect(html).toContain("보강·조퇴 1칸");
    expect(html).not.toContain("청구서 1칸");
  });
  it("does not claim there was an earlier successful value on an initial load failure", () => {
    mocks.data = snapshot();
    mocks.data.sections.students = { data: null, at: null, error: true };
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain("조회 실패 · 다시 확인 필요");
    expect(html).not.toContain("이전 확인값");
    expect(html).not.toContain("전체 재원생 0명");
  });
  it("does not provide links to the removed calendar menu", () => {
    mocks.data = snapshot();
    mocks.data.sections.calendar = {
      data: [
        {
          id: "event",
          title: "학부모 설명회",
          startDate: "2026-09-11",
          endDate: "2026-09-11",
          startTime: "18:00",
          source: "manual",
        },
      ],
      at: 100,
      error: false,
    };
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain("학부모 설명회");
    expect(html).not.toContain('href="/calendar"');
  });
});
