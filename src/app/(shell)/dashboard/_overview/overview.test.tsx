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
import type {
  OverviewData,
  OverviewSnapshot,
} from "@/features/dashboard/overview/model";
import { Overview } from "./overview";
import { kpiGridVars } from "./kpi-strip";

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
          kind: "levelTest",
        },
      ],
      at: 100,
      error: false,
    };
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain("레벨테스트 및 첫수업 일정");
    expect(html).toContain("레벨테스트");
    expect(html).not.toContain('href="/calendar"');
    // 금일입테 카드는 서지만 ↗(목적지 링크)가 없다.
    expect(html).toContain('aria-label="금일입테 0건.');
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

const KPI_LABELS = ["재원생", "퇴원생", "신규문의", "금일입테", "오늘첫수업", "결석학생"];
const ALL_MENUS: OverviewSnapshot["allowed"] = [
  "dashboard",
  "students",
  "withdrawals",
  "enrollment",
  "attendance",
  "calendar",
];
const ok = { at: 100, error: false } as const;
const studentsData = (): OverviewData["students"] => ({
  enrolled: 10,
  subjects: [],
  levels: [],
  schools: [],
  concurrent: 3,
  programs: { eie: 4, injaewon: 5, math: 6, both: 3, noEnrollment: 1, otherOnly: 0 },
  gradeSplit: {
    rows: [
      { label: "중1", englishOnly: 2, both: 3, mathOnly: 1 },
      { label: "중2", englishOnly: 0, both: 0, mathOnly: 0 },
      { label: "기타·미입력", englishOnly: 1, both: 0, mathOnly: 2 },
    ],
    neither: 1,
  },
});
function kpiSnapshot(allowed = ALL_MENUS): OverviewSnapshot {
  return {
    ...snapshot(),
    allowed,
    subjects: { math: "수학", english: "영어" },
    sections: {
      students: { data: studentsData(), ...ok },
      withdrawals: {
        data: {
          month: "2026-09",
          rows: [
            { id: "w1", name: "퇴원가", schoolGrade: "침산중1", withdrawnAt: "2026-09-03", program: "eie" },
            { id: "w2", name: "퇴원나", schoolGrade: null, withdrawnAt: "2026-09-05", program: null },
          ],
        },
        ...ok,
      },
      intake: { data: [{ id: "i1", name: "문의가", time: "14:32" }], ...ok },
      calendar: {
        data: [
          { id: "e1", title: "영어 레테", startDate: "2026-09-10", endDate: "2026-09-10", startTime: "15:00", source: "manual", kind: "levelTest" },
          { id: "e2", title: "수학 첫수업", startDate: "2026-09-10", endDate: "2026-09-10", startTime: "17:00", source: "manual", kind: "firstClass" },
          { id: "e3", title: "내일 입테", startDate: "2026-09-11", endDate: "2026-09-11", startTime: "15:00", source: "manual", kind: "levelTest" },
        ],
        ...ok,
      },
      firstClass: {
        data: [
          { studentId: "f1", name: "첫가", kind: "first", subjects: ["math"] },
          { studentId: "f2", name: "첫나", kind: "newSubject", subjects: ["english"] },
        ],
        ...ok,
      },
      absent: {
        data: {
          // 결석학생 기준일 = **어제**(snapshot.today "2026-09-10" → "2026-09-09" 수요일).
          date: "2026-09-09",
          absent: [
            {
              studentId: "a1",
              name: "결가",
              subject: "math",
              classes: [{ id: "c1", name: "M1", subject: "math" }],
              preNotified: false,
              statuses: ["absent"],
            },
            {
              studentId: "a2",
              name: "결나",
              subject: "english",
              classes: [{ id: "c2", name: "E1", subject: "english" }],
              preNotified: true,
              statuses: ["excused"],
            },
          ],
          partial: [
            {
              studentId: "p1",
              name: "부분가",
              subject: "math",
              classes: [{ id: "c1", name: "M1", subject: "math" }],
              preNotified: false,
              statuses: ["absent"],
            },
          ],
        },
        ...ok,
      },
    },
  };
}
const kpiButtons = () =>
  screen
    .getAllByRole("button")
    .filter((b) => KPI_LABELS.some((label) => (b.getAttribute("aria-label") ?? "").startsWith(`${label} `)));

describe("KPI 여섯 칸 (원장 2026-09-11)", () => {
  it("정해진 순서로 여섯 칸이 선다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    expect(kpiButtons().map((b) => b.getAttribute("aria-label")!.split(" ")[0])).toEqual(KPI_LABELS);
    cleanup();
  });

  it("카드 몸통은 팝업을 열고 숫자가 같다 — ↗는 버튼 밖의 형제 링크", async () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^재원생 10명\./ });
    expect(card.querySelector("a")).toBeNull();
    const jump = screen.getByRole("link", { name: "원생목록에서 재원생 보기" });
    expect(jump.getAttribute("href")).toBe(
      "/students?status=enrolled&subject=all&grade=all&teacher=all&noenr=0&from=dashboard",
    );
    expect(jump.closest("button")).toBeNull();
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("재원생 10명");
    expect(
      within(popup).getByRole("link", { name: "EiE 4명 목록 열기" }).getAttribute("href"),
    ).toBe("/students?status=enrolled&subject=all&grade=all&teacher=all&noenr=0&from=dashboard&program=eie");
    expect(popup.textContent).toContain("수강 없음");
    expect(popup.textContent).toContain("합계가 재원생 수보다 클 수 있습니다");
    cleanup();
  });

  it("각 ↗는 카드와 같은 집합을 여는 주소다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href("퇴원관리에서 이번 달 퇴원 보기")).toBe("/withdrawals?range=month&month=2026-09");
    expect(href("콜&상담에서 오늘 접수 보기")).toBe("/enrollment?view=table&received=2026-09-10");
    expect(href("원생목록에서 오늘 첫 수업 보기")).toBe(
      "/students?first=2026-09-10&status=all&subject=all&grade=all&teacher=all&noenr=0&from=dashboard",
    );
    // 결석학생만 어제 기준(원장 2026-09-12) — 나머지 다섯 칸은 오늘 그대로.
    expect(href("출석부에서 어제 9/9 (수) 결석 학생 보기")).toBe("/attendance/2026-09-09?status=absent");
    cleanup();
  });

  it("↗는 목적지 메뉴를 열 수 있을 때만 선다(카드는 그대로)", () => {
    mocks.data = kpiSnapshot(["dashboard", "students", "enrollment", "calendar"]);
    render(<Overview initial={mocks.data} />);
    expect(screen.queryByRole("link", { name: "퇴원관리에서 이번 달 퇴원 보기" })).toBeNull();
    expect(screen.queryByRole("link", { name: "출석부에서 어제 9/9 (수) 결석 학생 보기" })).toBeNull();
    expect(screen.getByRole("button", { name: /^퇴원생 2명\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^결석학생 2명\./ })).toBeTruthy();
    cleanup();
  });

  it("금일입테 = 오늘 레벨테스트만(첫 수업·내일 제외), ↗ 없음", () => {
    mocks.data = kpiSnapshot();
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain('aria-label="금일입테 1건.');
    expect(html).not.toContain('href="/calendar');
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^금일입테 1건\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("영어 레테");
    expect(popup.textContent).not.toContain("수학 첫수업");
    expect(popup.textContent).not.toContain("내일 입테");
    expect(within(popup).queryByRole("link")).toBeNull();
    cleanup();
  });

  it("퇴원생 팝업 — 프로그램별 합 = 퇴원생 수(기타·미상 포함), 명단은 원생 상세로", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^퇴원생 2명\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("9월 퇴원생 2명");
    expect(
      within(popup).getByRole("link", { name: "EiE 1명 목록 열기" }).getAttribute("href"),
    ).toBe("/withdrawals?range=month&month=2026-09&program=eie");
    expect(popup.textContent).toContain("기타·미상");
    expect(within(popup).getByRole("link", { name: "퇴원가 원생 상세" }).getAttribute("href")).toBe("/students/w1");
    cleanup();
  });

  it("결석학생 — 한 교시도 안 온 학생만 세고, 일부 교시 결석은 세지 않고 따로 보인다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    // 카드 숫자 = 결석 무리(2) — 일부 교시 결석(1)은 안 센다.
    fireEvent.click(screen.getByRole("button", { name: /^결석학생 2명\./ }));
    const popup = screen.getByRole("dialog");
    // 날짜는 다이얼로그 머리가 말한다 — 합계 줄은 되풀이하지 않는다(한 화면에 '어제'를 두 번 적지 않게).
    expect(popup.textContent).toContain("결석 학생 2명");
    expect(popup.textContent).toContain("연락 필요 1명 · 사전 통보 1명");
    expect(popup.textContent).toContain("공결");
    expect(
      within(popup).getByRole("link", { name: "결가 출결 상세" }).getAttribute("href"),
    ).toBe("/students/a1?tab=attendance");
    // 일부 교시 결석 — 따로 모이고 '연락 필요'로 부르지 않는다.
    expect(popup.textContent).toContain("일부 교시 결석 1명");
    expect(within(popup).getByRole("link", { name: "부분가 출결 상세" })).toBeTruthy();
    expect(within(popup).getAllByText("연락 필요")).toHaveLength(1);
    cleanup();
  });

  /**
   * 원장 2026-09-12: *"대시보드 결석학생은 어제 결석으로 해야지. 오늘은 수업을 안하면 볼 수가 없잖아"* —
   * 카드 보조 줄·자세히 보기 머리·↗가 **한 날짜**(어제)를 말한다. 사람이 오늘로 오해하지 않게 날짜·요일을 적는다.
   */
  it("결석학생은 어제 기준 — 카드 보조 줄·팝업 머리·↗가 같은 날(어제 9/9 (수))을 말한다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^결석학생 2명\./ });
    expect(card.getAttribute("aria-label")).toContain("어제 9/9 (수)");
    expect(card.textContent).toContain("어제 9/9 (수)");
    expect(screen.getByRole("link", { name: "출석부에서 어제 9/9 (수) 결석 학생 보기" }).getAttribute("href")).toBe(
      "/attendance/2026-09-09?status=absent",
    );
    fireEvent.click(card);
    expect(screen.getByRole("dialog").textContent).toContain("어제 9/9 (수) 결석 학생");
    cleanup();
  });

  it("결석 조회가 실패해도 ↗·머리·보조 줄은 어제를 가리킨다(오늘로 새지 않는다)", () => {
    const snap = kpiSnapshot();
    snap.sections.absent = { data: null, at: null, error: true };
    mocks.data = snap;
    render(<Overview initial={mocks.data} />);
    expect(screen.getByRole("link", { name: "출석부에서 어제 9/9 (수) 결석 학생 보기" }).getAttribute("href")).toBe(
      "/attendance/2026-09-09?status=absent",
    );
    const card = screen.getByRole("button", { name: /^결석학생 —\./ });
    expect(card.getAttribute("aria-label")).toContain("어제 9/9 (수) · 조회 실패");
    fireEvent.click(card);
    expect(screen.getByRole("dialog").textContent).toContain("어제 9/9 (수) 결석 학생");
    cleanup();
  });

  /**
   * 🔴 30초 갱신이 **한 번** 실패하면 `mergeSnapshot`이 이전 숫자를 남기고 error만 세운다. 그때 보조 줄이
   *    실패 문구로 통째로 바뀌면서 기준일이 사라지면, 형제 다섯 칸이 모두 오늘이라 어제 숫자가 오늘 결석으로 읽힌다.
   */
  it("갱신이 한 번 실패해도 카드에 기준일이 남는다(어제 숫자를 오늘로 읽지 않게)", () => {
    const snap = kpiSnapshot();
    snap.sections.absent = { ...snap.sections.absent!, error: true };
    mocks.data = snap;
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^결석학생 2명\./ });
    expect(card.getAttribute("aria-label")).toContain("어제 9/9 (수) · 갱신 실패");
    expect(card.textContent).toContain("어제 9/9 (수)");
    cleanup();
  });

  it("어제 결석이 0명이면 그 날짜로 사실만 적는다(주말·휴일이면 0이 맞다)", () => {
    const snap = kpiSnapshot();
    snap.sections.absent = { data: { date: "2026-09-09", absent: [], partial: [] }, ...ok };
    mocks.data = snap;
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^결석학생 0명\./ }));
    expect(screen.getByRole("dialog").textContent).toContain("9/9 (수)엔 한 교시도 안 온 학생이 없습니다.");
    cleanup();
  });

  it("KPI 열 수는 실제로 선 카드 수에서 나온다 — 5칸이면 빈 칸 없이(마지막 카드가 남는 자리를 채운다)", () => {
    expect(kpiGridVars(6)).toMatchObject({ "--kpi-n": 6, "--kpi-mid": 3, "--kpi-last-mid": "auto" });
    expect(kpiGridVars(5)).toMatchObject({ "--kpi-n": 5, "--kpi-mid": 3, "--kpi-last-mid": "span 2" });
    expect(kpiGridVars(4)).toMatchObject({ "--kpi-n": 4, "--kpi-mid": 2, "--kpi-last-mid": "auto" });
    expect(kpiGridVars(1)).toMatchObject({ "--kpi-n": 1, "--kpi-mid": 1, "--kpi-last-mid": "auto" });
    // 운영실은 역할에 따라 칸 수가 다르다 — 결석학생(출석부 권한)이 없는 역할이면 5칸.
    const snap = kpiSnapshot(["dashboard", "students", "withdrawals", "enrollment", "calendar"]);
    delete snap.sections.absent;
    mocks.data = snap;
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain("--kpi-n:5");
  });

  it("동시 수강 = 영어+수학, N명 (n%)", () => {
    mocks.data = kpiSnapshot();
    const view = render(<Overview initial={mocks.data} />);
    expect(view.container.textContent).toContain("동시 수강(영어+수학)");
    expect(view.container.textContent).toContain("3명 (30%)");
    cleanup();
  });

  it("학년별 재원생 — 세 조각 막대(글자 없음), 호버는 N명, 빈 학년 줄 없음, 각주로 재원생과 맞춘다", () => {
    mocks.data = kpiSnapshot();
    const view = render(<Overview initial={mocks.data} />);
    const both = screen.getByRole("img", { name: "중1 영어+수학 3명" });
    expect(both.getAttribute("title")).toBe("3명");
    expect(both.textContent).toBe("");
    expect(both.getAttribute("style")).toContain("--purple");
    expect(screen.getByRole("img", { name: "중1 영어만 2명" }).getAttribute("style")).toContain("--danger");
    expect(screen.getByRole("img", { name: "기타·미입력 수학만 2명" }).getAttribute("style")).toContain("--blue");
    expect(screen.queryByRole("img", { name: /^중2 / })).toBeNull();
    expect(view.container.textContent).toContain("영어·수학 모두 없는 재원생 1명 · 합계 10명");
    cleanup();
  });
});
