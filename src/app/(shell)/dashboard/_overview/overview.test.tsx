import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import {
  act,
  render,
  fireEvent,
  screen,
  within,
  cleanup,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { summarizeInvoices } from "@/features/billing/calc";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { Overview } from "./overview";

const mocks = vi.hoisted(() => ({
  data: null as unknown as OverviewSnapshot,
  isFetching: false,
}));
vi.mock("./use-overview", () => ({
  useOverview: () => ({
    data: mocks.data,
    isFetching: mocks.isFetching,
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
  it("브라우저가 갱신을 먼저 시작해도 서버가 그린 대시보드를 다시 만들지 않는다", async () => {
    mocks.data = snapshot();
    mocks.isFetching = false;
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Overview initial={mocks.data} />);
    document.body.append(container);
    const header = container.querySelector("header");
    const onRecoverableError = vi.fn();
    mocks.isFetching = true;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <Overview initial={mocks.data} />, {
          onRecoverableError,
        });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.querySelector("header")).toBe(header);
      expect(container.textContent).toContain("최신 정보 확인 중");
      expect(container.querySelector("button")?.disabled).toBe(true);
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      mocks.isFetching = false;
    }
  });
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
          title: "레벨테스트",
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
    expect(html).toContain("레벨테스트 및 첫수업 일정");
    expect(html).toContain("레벨테스트");
    expect(html).not.toContain('href="/calendar"');
  });
  it("반복 결석 전체 목록은 별도 팝업에서 회 단위로 표시하고 학생 출결 상세로 연결한다", async () => {
    mocks.data = snapshot();
    mocks.data.sections.absences = {
      at: 100,
      error: false,
      data: {
        anchor: "2026-09-10",
        rows: Array.from({ length: 7 }, (_, i) => ({
          studentId: `s${i}`,
          studentName: `학생${i}`,
          absences: 3,
          unexplained: 3,
        })),
      },
    };
    const view = render(<Overview initial={mocks.data} />);
    expect(view.container.textContent).toContain("3회 이상");
    expect(view.container.textContent).not.toContain("일일 브리핑");
    expect(
      within(view.container)
        .getByRole("link", { name: "학생0 출결 상세 · 결석 3회" })
        .getAttribute("href"),
    ).toBe("/students/s0?tab=attendance");
    fireEvent.click(
      screen.getByRole("button", { name: "반복 결석 학생 자세히 보기" }),
    );
    const popup = screen.getByRole("dialog");
    expect(view.container.contains(popup)).toBe(false);
    expect(within(popup).getByText("학생0")).toBeTruthy();
    expect(within(popup).getByText("학생6")).toBeTruthy();
    expect(popup.textContent).not.toContain("칸");
    const link = within(popup).getByRole("link", {
      name: "학생6 출결 상세 · 결석 3회",
    });
    expect(link.getAttribute("href")).toBe("/students/s6?tab=attendance");
    link.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    cleanup();
  });
});
