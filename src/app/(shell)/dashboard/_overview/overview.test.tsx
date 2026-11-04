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

vi.mock("@/features/demo-roster/server/actions", () => ({
  switchDemoRoster: vi.fn(async () => ({ ok: true as const, label: "동네형" })),
}));
import { summarizeInvoices } from "@/features/billing/calc";
import type {
  OverviewData,
  OverviewSnapshot,
} from "@/features/dashboard/overview/model";
import { Overview } from "./overview";
import { kpiGridVars } from "./kpi-strip";
import { DASHBOARD_SUBJECT_COLORS } from "@/features/dashboard/overview/subject-colors";

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
  it("출결 현황 ↗는 오늘 출결로, 최근 14일 등원율 ↗는 출결 통계(강사 범위는 출석부)로 간다", () => {
    // 원장 2026-09-14: "출결 현황 바로가기를 오늘의 출결과 연결시키는게 자연스러울듯." — 카드가 오늘 칸만 세므로(09-13)
    // 목적지도 오늘 화면이다. 14일 추이는 날짜를 가로지르는 기록이라 월별 그대로 둔다.
    mocks.data = snapshot();
    mocks.data.sections = {
      attendance: {
        data: { date: "2026-09-10", total: 3, present: 1, absent: 1, late: 0, excused: 0, rate: 33.3 },
        at: 100,
        error: false,
      },
      attendanceTrend: { data: null, at: 100, error: false },
    };
    render(<Overview initial={mocks.data} />);
    expect(screen.getByRole("link", { name: "출결 현황 상세" }).getAttribute("href")).toBe("/attendance/live");
    // 14일 추이의 상세 = 출결 통계의 등원율 추이(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*).
    expect(screen.getByRole("link", { name: "최근 14일 등원율 상세" }).getAttribute("href")).toBe("/attendance/stats#rate");
    cleanup();
    // 강사 범위엔 출결 통계가 없다 — 종전처럼 출석부로.
    mocks.data = { ...mocks.data, teacherView: true };
    render(<Overview initial={mocks.data} />);
    expect(screen.getByRole("link", { name: "최근 14일 등원율 상세" }).getAttribute("href")).toBe("/attendance");
    cleanup();
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
    // 전일 입테 카드는 서지만 ↗(목적지 링크)가 없다.
    expect(html).toContain('aria-label="전일 입테 0건.');
  });
  it("반복 결석: 첫 화면엔 이름 없이 횟수별 인원 · 명단은 팝업에서 회 단위로, 학생 출결 상세로 연결(원장 2026-10-29)", async () => {
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
    expect(within(view.container).queryByRole("link", { name: "학생0 출결 상세 · 결석 3회" })).toBeNull();
    expect(view.container.textContent).toContain("3회 7명 · 4회 0명 · 5회 이상 0명");
    fireEvent.click(
      screen.getByRole("button", { name: "반복 결석 학생 명단 보기 (7명)" }),
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

const KPI_LABELS = ["재원생", "강좌수", "퇴원", "신규문의", "전일 입테", "전일 / 이달 신규", "오늘첫수업", "최근 결석", "보강예정"];
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
      // 보강예정(0264a) — 오늘부터 한 달(원장 2026-09-16) 예약 두 건(오늘 하나·지난 미이행 하나) + 창 뒤 하나.
      makeup: {
        data: {
          range: { start: "2026-09-10", end: "2026-10-09" },
          rows: [
            {
              id: "m1",
              studentId: "s1",
              name: "보강가",
              schoolGrade: "침산중1",
              classId: "c1",
              className: "M1",
              makeupDate: "2026-09-10",
              slotStart: "16:20",
              slotEnd: "17:15",
              createdByName: "예약강사",
              absenceDate: "2026-09-03",
              overdue: false,
              origin: "reservation",
            },
            {
              id: "m2",
              studentId: "s2",
              name: "보강나",
              schoolGrade: null,
              classId: "c2",
              className: "E1",
              makeupDate: "2026-09-08",
              slotStart: "17:20",
              slotEnd: "18:00",
              createdByName: null,
              absenceDate: "2026-09-01",
              overdue: true,
              origin: "native",
            },
          ],
          later: 1,
        },
        ...ok,
      },
      students: { data: studentsData(), ...ok },
      // 강좌수(원장 2026-10-20) — 학생 10명 중 1과목 6명 · 2과목 4명 = 14강좌(영어 7 · 수학 7).
      courses: {
        data: {
          total: 14,
          basis: "student-subject", students: 10, subjects: { english: 7, math: 7 },
          perStudent: [{ courses: 1, students: 6 }, { courses: 2, students: 4 }, { courses: 3, students: 0 }, { courses: 4, students: 0 }],
          combos: [
            { bucket: 1, parts: [{ subject: "english", count: 1 }], students: 3 },
            { bucket: 1, parts: [{ subject: "math", count: 1 }], students: 3 },
            { bucket: 2, parts: [{ subject: "english", count: 1 }, { subject: "math", count: 1 }], students: 4 },
          ],
        },
        ...ok,
      },
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
      // 전일 / 이달 신규(원장 2026-10-21) — 오늘 하나(반 배정) · 어제 하나(배정 전) · 지난달 말 하나(창 밖이라 안 센다).
      enrolledToday: {
        data: [
          { id: "r1", name: "등록가", schoolGrade: "침산중1", date: "2026-09-10", time: "15:10", assigned: true, classes: [{ name: "M1A", subject: "수학" }], subject: null },
          { id: "r2", name: "등록나", schoolGrade: null, date: "2026-09-09", time: "11:02", assigned: false, subject: null },
          { id: "r3", name: "등록다", schoolGrade: null, date: "2026-08-31", time: "10:00", assigned: false, subject: null },
        ],
        ...ok,
      },
      calendar: {
        data: [
          // 어제 입테(KPI '전일 입테') — 일정 패널엔 안 선다(오늘부터).
          { id: "e0", title: "어제 레테", startDate: "2026-09-09", endDate: "2026-09-09", startTime: "16:00", source: "manual", kind: "levelTest" },
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
          // 최근 결석 창 = 어제까지 7일(snapshot.today "2026-09-10" → 9/3 (목) ~ 9/9 (수)).
          from: "2026-09-03",
          to: "2026-09-09",
          students: [
            {
              studentId: "a1",
              name: "결가",
              count: 2,
              unnotified: 2,
              absences: [
                { date: "2026-09-04", classId: "c1", className: "M1", subject: "math", preNotified: false, teachers: ["김수학"] },
                { date: "2026-09-08", classId: "c1", className: "M1", subject: "math", preNotified: false, teachers: ["김수학"] },
              ],
            },
            {
              studentId: "a2",
              name: "결나",
              count: 1,
              unnotified: 0,
              absences: [
                { date: "2026-09-09", classId: "c2", className: "E1", subject: "english", preNotified: true, teachers: ["Jane", "박영어"] },
              ],
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
    // 라벨에 공백이 있을 수 있다('최근 결석') — 첫 낱말로 자르지 말고 라벨 집합에서 되찾는다.
    const labelOf = (b: Element) =>
      KPI_LABELS.find((label) => (b.getAttribute("aria-label") ?? "").startsWith(`${label} `));
    expect(kpiButtons().map(labelOf)).toEqual(KPI_LABELS);
    cleanup();
  });

  it("카드 몸통은 팝업을 열고 숫자가 같다 — ↗는 버튼 밖의 형제 링크", async () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^재원생 10명\./ });
    expect(card.querySelector("a")).toBeNull();
    // ↗ = 원생 통계의 재원생 추이(원장 2026-10-20 "상세를 누르면 통계, 그냥 카드를 누르면 팝업").
    const jump = screen.getByRole("link", { name: "원생 통계에서 재원생 추이 보기" });
    expect(jump.getAttribute("href")).toBe("/students/stats#trend");
    expect(jump.closest("button")).toBeNull();
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("재원생 10명");
    expect(
      within(popup).getByRole("link", { name: "EiE 4명 목록 열기" }).getAttribute("href"),
    ).toBe("/students?status=enrolled&subject=all&grade=all&teacher=all&noenr=0&from=dashboard&program=eie");
    expect(popup.textContent).toContain("미수강");
    expect(within(popup).getByRole("link", { name: "미수강 1명 목록 열기" }).getAttribute("href"))
      .toBe("/students?status=enrolled&subject=__none__&grade=all&teacher=all&noenr=0&from=dashboard");
    expect(popup.textContent).toContain("합계가 재원생 수보다 클 수 있습니다");
    cleanup();
  });

  it("강좌수 칸(원장 2026-10-20) = 팝업 숫자 · 강좌 수마다 무엇으로 듣는지 · ↗ = 원생 통계 강좌수 추이", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^강좌수 14개\./ });
    expect(card.getAttribute("aria-label")).toContain("영어 7 · 수학 7");
    const jump = screen.getByRole("link", { name: "원생 통계에서 강좌수 추이 보기" });
    expect(jump.getAttribute("href")).toBe("/students/stats#courses");
    expect(jump.closest("button")).toBeNull();
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("강좌수 14개");
    // 칸마다 조합 인원의 합 = 그 칸 학생 수(2개 4명 = 영어 1 + 수학 1 · 4명).
    expect(popup.textContent).toContain("2개4명");
    expect(popup.textContent).toContain("수학 13명");
    expect(popup.textContent).toContain("영어 1 + 수학 14명");
    cleanup();
  });

  it("각 ↗는 카드와 같은 집합을 여는 주소다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const href = (name: string) => screen.getByRole("link", { name }).getAttribute("href");
    expect(href("퇴원관리에서 26.09 퇴원(수강종료) 보기")).toBe("/withdrawals?type=all&range=month&month=2026-09");
    // 신규문의 ↗ = 통계 보기의 신규 문의 추이(이번 달 일별 — 오늘 칸 = 카드 숫자 · 원장 2026-10-20).
    expect(href("신규 콜&상담 통계에서 문의 추이 보기")).toBe("/enrollment?view=stats&trend=day&from=dashboard#intake");
    // 오늘첫수업 ↗ = 원생 통계의 첫 수업 추이(이번 달 일별 — 오늘 칸 = 카드 · 원장 2026-10-20). 그날 학생 목록은 그 카드 머리 링크.
    expect(href("원생 통계에서 첫 수업 추이 보기")).toBe("/students/stats?fc=day#first");
    // 최근 결석은 ↗가 없다 — 7일을 한 번에 보이는 출결 화면이 아직 없다(하루 결석 보기로 보내면 숫자가 갈린다).
    expect(screen.queryByRole("link", { name: /결석 학생 보기/ })).toBeNull();
    cleanup();
  });

  it("보강예정 카드·팝업과 일정 패널이 같은 '오늘부터 한 달' 끝 날짜를 말한다(원장 2026-09-16)", () => {
    mocks.data = kpiSnapshot([...ALL_MENUS, "timetable"]);
    render(<Overview initial={mocks.data} />);
    // 오늘 2026-09-10 → 창 끝 10/9 (금). 카드 보조 줄 · 팝업 머리 · 일정 패널 머리가 한 날짜다.
    const card = screen.getByRole("button", { name: "보강예정 2건. 10/9 (금)까지 · 오늘 1 · 지남 1 · 그 뒤 1. 자세히 보기" });
    expect(screen.getByRole("link", { name: "시간표 보강 탭에서 주별로 보기" }).getAttribute("href")).toBe(
      "/timetable?kind=makeup",
    );
    expect(document.body.textContent).toContain("오늘부터 한 달 · 10/9 (금)까지");
    expect(document.body.textContent).not.toMatch(/오늘부터 7일|이번 주 보강/);
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("10/9 (금)까지 보강 예약 2건");
    expect(popup.textContent).toContain("그 뒤로 잡힌 1건은 시간표 보강 탭에서 주를 옮겨 보세요");
    expect(popup.textContent).toContain("16:20");
    expect(popup.textContent).toContain("예약: 예약강사");
    expect(popup.textContent).toContain("예약자 미상");
    expect(within(popup).getByText("지남")).toBeTruthy();
    cleanup();
  });

  it("일정이 없으면 빈 문구도 같은 끝 날짜를 말한다", () => {
    mocks.data = kpiSnapshot();
    mocks.data.sections.calendar = { data: [], at: 100, error: false };
    render(<Overview initial={mocks.data} />);
    expect(document.body.textContent).toContain("오늘부터 10/9 (금)까지 레벨테스트·첫 수업 일정이 없습니다.");
    cleanup();
  });

  it("↗는 목적지 메뉴를 열 수 있을 때만 선다(카드는 그대로)", () => {
    mocks.data = kpiSnapshot(["dashboard", "students", "enrollment", "calendar"]);
    render(<Overview initial={mocks.data} />);
    expect(screen.queryByRole("link", { name: "퇴원관리에서 26.09 퇴원(수강종료) 보기" })).toBeNull();
    expect(screen.getByRole("button", { name: /^퇴원 2명\./ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^최근 결석 2명\./ })).toBeTruthy();
    cleanup();
  });

  it("전일 / 이달 신규 = 어제 / 이번 달 등록 완료로 옮긴 상담, 이름은 상담 상세로(↗ 없음)", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^전일 \/ 이달 신규 1 \/ 2명\./ });
    expect(card.getAttribute("aria-label")).toContain("전일 1 · 이달 2 · 이달 반 배정 1 · 배정 전 1");
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("전일 신규 1명");
    expect(popup.textContent).toContain("이달(9월) 신규 2명");
    expect(popup.textContent).toContain("9/9 11:02");
    expect(popup.textContent).toContain("전일");
    expect(popup.textContent).not.toContain("등록다");
    // 배정 반 = 과목 · 반 이름(원장 2026-10-22).
    expect(popup.textContent).toContain("수학 · M1A");
    expect(popup.textContent).toContain("배정 전");
    expect(within(popup).getByRole("link", { name: "등록가 상담 상세" }).getAttribute("href")).toContain("/enrollment/r1");
    cleanup();
  });

  it("전일 입테 = 어제 레벨테스트만(오늘·첫 수업·내일 제외), ↗ 없음", () => {
    mocks.data = kpiSnapshot();
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain('aria-label="전일 입테 1건.');
    expect(html).not.toContain('href="/calendar');
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^전일 입테 1건\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("어제 레테");
    expect(popup.textContent).not.toContain("영어 레테");
    expect(popup.textContent).not.toContain("수학 첫수업");
    expect(popup.textContent).not.toContain("내일 입테");
    expect(within(popup).queryByRole("link")).toBeNull();
    cleanup();
  });

  it("퇴원&수업종료 팝업 — 프로그램별 합 = 퇴원&수업종료 수(기타·미상 포함), 명단은 원생 상세로", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^퇴원 2명\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("26.09 퇴원(수강종료) 2명");
    expect(popup.textContent).toContain("퇴원 2명 · 수강종료 0명");
    // 세는 기준을 숫자 바로 아래에 적는다(원장 2026-11-03 *"오해 소지가 없도록"*) — 앞 달로 센 줄이 없으면 그 묶음은 서지 않는다.
    // 팝업 아래 = 보여 주는 달(10일 기준) · 날짜는 마지막 수업일 · 달은 수업료 납부(원장 2026-11-03).
    expect(popup.textContent).toContain("매달 1~10일에는 지난달, 11일부터 다음 달 10일까지는 이번 달 퇴원(수강종료)을 보여 줍니다.");
    expect(popup.textContent).toContain("퇴원·수강종료 날짜는 마지막 수업일이고, 어느 달로 셀지는 수업료 납부로 정합니다 — 퇴원은 수업료를 낸 마지막 달, 수강종료는 그 과목 수업료를 낸 마지막 달(낸 기록이 없으면 마지막 수업일의 달). 예: 마지막 수업일이 9월 1일이어도 8월분까지만 냈으면 8월로 셉니다.");
    expect(popup.textContent).not.toContain("앞 달로 센");
    expect(
      within(popup).getByRole("link", { name: "EiE 1명 목록 열기" }).getAttribute("href"),
    ).toBe("/withdrawals?type=all&range=month&month=2026-09&program=eie");
    expect(popup.textContent).toContain("기타·미상");
    expect(within(popup).getByRole("link", { name: "퇴원가 원생 상세" }).getAttribute("href")).toBe("/students/w1");
    cleanup();
  });

  it("이번 달에 처리했지만 앞 달로 센 학생은 숫자에 넣지 않고 따로 밝힌다(원장 2026-11-03)", () => {
    mocks.data = kpiSnapshot();
    const wd = mocks.data.sections.withdrawals!.data!;
    wd.rows = [];
    wd.carried = [
      { id: "c1", eventKey: "c1|math", name: "앞달가", schoolGrade: "침산초4", withdrawnAt: "2026-09-01", program: "math", subject: "math", kind: "subject-ended", countMonth: "2026-08" },
      { id: "c2", eventKey: "c2|math", name: "앞달나", schoolGrade: "침산중2", withdrawnAt: "2026-09-01", program: "math", subject: "math", kind: "withdrawn", countMonth: "2026-08" },
    ];
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^퇴원 0명\./ });
    expect(card.getAttribute("aria-label")).toContain("마지막 수업일이 9월이지만 앞 달로 센 2명");
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("26.09 퇴원(수강종료) 0명");
    expect(popup.textContent).toContain("26.09 퇴원(수강종료) 학생이 없습니다.");
    expect(popup.textContent).toContain("마지막 수업일이 9월이지만 앞 달로 센 2명 — 위 숫자에 들지 않습니다");
    // 열 맞춘 표 — 반·마지막 수업일·센 달 열(원장 2026-11-03 *"반까지 표시하고 열정렬"*).
    expect(popup.textContent).toContain("센 달");
    expect(within(popup).getAllByTitle("8월로 셈")).toHaveLength(2);
    expect(within(popup).getByRole("link", { name: "앞달가 원생 상세" }).getAttribute("href")).toBe("/students/c1");
    cleanup();
  });

  it("퇴원 꼬리표는 달을 먼저 놓고(좁으면 앞말만 빠짐), 6줄부터 두 명단을 같은 2단 틀에 넣는다(원장 2026-11-03)", () => {
    mocks.data = kpiSnapshot();
    const wd = mocks.data.sections.withdrawals!.data!;
    wd.rows = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, name: `퇴원${i}`, schoolGrade: "침산중1", withdrawnAt: "2026-09-03", program: "math" as const, className: `M${i}` }));
    wd.carried = [
      { id: "c1", eventKey: "c1|math", name: "앞달가", schoolGrade: "침산초4", withdrawnAt: "2026-09-01", program: "math", subject: "math", kind: "subject-ended", countMonth: "2026-08" },
    ];
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^퇴원 6명\./ });
    // 꼬리표 = 달 칸이 DOM 앞(거꾸로 놓아 화면엔 '이번달 (26.09)') — 말줄임으로 달이 잘리지 않게.
    const tag = within(card).getByTitle("이번달 (26.09)");
    expect([...tag.children].map((el) => el.textContent)).toEqual(["(26.09)", "이번달"]);
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    // 6줄 → 두 단(3 + 3) · 앞 달로 센 1줄도 같은 틀의 왼쪽 단(열 위치가 섹션마다 같다).
    const rowsOf = (ul: Element) => ul.querySelectorAll("li:not([aria-hidden])").length;
    const exitTables = [...popup.querySelectorAll("ul")].filter((ul) => ul.querySelector("li > time"));
    expect(exitTables.map(rowsOf)).toEqual([3, 3, 1]);
    // 앞 두 표 = 한 틀(2단) · 앞 달로 센 표 = 따로 선 틀의 왼쪽 단 하나.
    expect(exitTables[0]!.parentElement).toBe(exitTables[1]!.parentElement);
    expect(exitTables[2]!.parentElement).not.toBe(exitTables[0]!.parentElement);
    expect(exitTables[2]!.parentElement!.children).toHaveLength(1);
    expect(within(popup).getByTitle("M5").textContent).toBe("M5");
    cleanup();
  });

  it("짧은 퇴원 명단은 종전 폭 팝업에 한 표로 놓는다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^퇴원 2명\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.className).toContain("sm:max-w-xl");
    expect(popup.querySelector("[class*='exitColumns']")).toBeNull();
    cleanup();
  });

  it("퇴원 팝업에서 퇴원과 과목 수강종료의 인원·학생 라벨을 구분한다", () => {
    mocks.data = kpiSnapshot();
    mocks.data.sections.withdrawals!.data!.rows[1]!.kind = "subject-ended";
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^퇴원 2명\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("퇴원 1명 · 수강종료 1명");
    expect(within(popup).getByText("퇴원")).toBeInTheDocument();
    expect(within(popup).getByText("수강종료")).toBeInTheDocument();
    cleanup();
  });

  it("한 학생의 두 과목 종료를 총 2명과 과목별 두 줄로 보여 준다", () => {
    mocks.data = kpiSnapshot();
    mocks.data.sections.withdrawals!.data!.rows = [
      { id: "w1", eventKey: "w1|english", name: "퇴원가", schoolGrade: "침산중1", withdrawnAt: "2026-09-03", program: "injaewon", kind: "subject-ended" },
      { id: "w1", eventKey: "w1|math", name: "퇴원가", schoolGrade: "침산중1", withdrawnAt: "2026-09-03", program: "math", kind: "subject-ended" },
    ];
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^퇴원 2명\./ }));
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("퇴원 0명 · 수강종료 2명");
    expect(within(popup).getAllByRole("link", { name: "퇴원가 원생 상세" })).toHaveLength(2);
    cleanup();
  });

  it("최근 결석 — 학생별 누적 결석 많은 순 · 결석마다 날짜·반·그 수업 선생님(원장 2026-10-20)", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    // 카드 숫자 = 7일 안에 결석한 학생 수(2) · 보조 줄 = 결석 횟수(빠진 수업) + 연락 필요.
    const card = screen.getByRole("button", { name: /^최근 결석 2명\./ });
    expect(card.getAttribute("aria-label")).toContain("9/3~9/9 · 결석 3회 · 연락 필요 1명");
    fireEvent.click(card);
    const popup = screen.getByRole("dialog");
    expect(popup.textContent).toContain("결석 학생 2명");
    expect(popup.textContent).toContain("결석 3회 · 연락 필요 1명");
    // 누적 많은 순(결가 2회 → 결나 1회) · 결석한 날(요일) · 반 · 담당(입력한 사람이 아니라 그 수업을 가르친 사람).
    const text = popup.textContent ?? "";
    expect(text.indexOf("결가")).toBeLessThan(text.indexOf("결나"));
    expect(text).toContain("9/4 금");
    expect(text).toContain("김수학");
    expect(text).toContain("Jane · 박영어");
    expect(text).toContain("(사전 통보)");
    expect(within(popup).getByRole("link", { name: "결가 출결 상세" }).getAttribute("href")).toBe("/students/a1?tab=attendance");
    expect(within(popup).getAllByText("연락 필요")).toHaveLength(1);
    cleanup();
  });

  it("최근 결석 — 카드 라벨에 '7일' 꼬리표 · 팝업 머리가 서버가 센 기간을 말하고 ↗는 없다", () => {
    mocks.data = kpiSnapshot();
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^최근 결석 2명\./ });
    expect(card.textContent).toContain("최근 결석");
    expect(card.textContent).toContain("7일");
    expect(screen.queryByRole("link", { name: /결석 학생 보기/ })).toBeNull();
    fireEvent.click(card);
    expect(screen.getByRole("dialog").textContent).toContain("최근 7일 결석 (9/3~9/9)");
    cleanup();
  });

  it("결석 조회가 실패해도 머리·보조 줄은 같은 기간(어제까지 7일)을 가리킨다", () => {
    const snap = kpiSnapshot();
    snap.sections.absent = { data: null, at: null, error: true };
    mocks.data = snap;
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^최근 결석 —\./ });
    expect(card.getAttribute("aria-label")).toContain("9/3~9/9 · 조회 실패");
    fireEvent.click(card);
    expect(screen.getByRole("dialog").textContent).toContain("최근 7일 결석 (9/3~9/9)");
    cleanup();
  });

  /**
   * 🔴 30초 갱신이 **한 번** 실패하면 `mergeSnapshot`이 이전 숫자를 남기고 error만 세운다. 그때 보조 줄이
   *    실패 문구로 통째로 바뀌면서 기간이 사라지면, 형제 칸(오늘)들 사이에서 숫자가 무슨 기간인지 알 수 없다.
   */
  it("갱신이 한 번 실패해도 카드에 기간이 남는다", () => {
    const snap = kpiSnapshot();
    snap.sections.absent = { ...snap.sections.absent!, error: true };
    mocks.data = snap;
    render(<Overview initial={mocks.data} />);
    const card = screen.getByRole("button", { name: /^최근 결석 2명\./ });
    expect(card.getAttribute("aria-label")).toContain("9/3~9/9 · 갱신 실패");
    cleanup();
  });

  it("7일 동안 결석이 없으면 그 기간으로 사실만 적는다", () => {
    const snap = kpiSnapshot();
    snap.sections.absent = { data: { from: "2026-09-03", to: "2026-09-09", students: [] }, ...ok };
    mocks.data = snap;
    render(<Overview initial={mocks.data} />);
    fireEvent.click(screen.getByRole("button", { name: /^최근 결석 0명\./ }));
    expect(screen.getByRole("dialog").textContent).toContain("9/3 (목) ~ 9/9 (수)엔 결석한 학생이 없습니다.");
    cleanup();
  });

  it("KPI 열 수는 실제로 선 카드 수에서 나온다 — 5칸이면 빈 칸 없이(마지막 카드가 남는 자리를 채운다)", () => {
    expect(kpiGridVars(6)).toMatchObject({ "--kpi-n": 6, "--kpi-mid": 3, "--kpi-last-mid": "auto" });
    expect(kpiGridVars(5)).toMatchObject({ "--kpi-n": 5, "--kpi-mid": 3, "--kpi-last-mid": "span 2" });
    expect(kpiGridVars(4)).toMatchObject({ "--kpi-n": 4, "--kpi-mid": 2, "--kpi-last-mid": "auto" });
    expect(kpiGridVars(1)).toMatchObject({ "--kpi-n": 1, "--kpi-mid": 1, "--kpi-last-mid": "auto" });
    // 여덟 칸(금일 등록 포함)은 4 × 2 — 마지막 칸이 넓어지지 않는다. 아홉 칸(강좌수 2026-10-20)은 3 × 3.
    expect(kpiGridVars(8)).toMatchObject({ "--kpi-n": 8, "--kpi-mid": 4, "--kpi-last-mid": "auto" });
    expect(kpiGridVars(9)).toMatchObject({ "--kpi-n": 9, "--kpi-mid": 3, "--kpi-last-mid": "auto" });
    // 운영실은 역할에 따라 칸 수가 다르다 — 출석부 권한이 없는 역할이면 최근 결석·보강예정(둘 다 출석부 영역)이 빠져
    // 7칸(강좌수는 원생 권한 · 금일 등록은 콜&상담 권한이라 남는다), 콜&상담 권한까지 없으면 금일 등록도 빠진다.
    const snap = kpiSnapshot(["dashboard", "students", "withdrawals", "enrollment", "calendar"]);
    delete snap.sections.absent;
    delete snap.sections.makeup;
    mocks.data = snap;
    expect(renderToStaticMarkup(<Overview initial={mocks.data} />)).toContain("--kpi-n:7");
    delete snap.sections.enrolledToday;
    const html = renderToStaticMarkup(<Overview initial={mocks.data} />);
    expect(html).toContain("--kpi-n:6");
  });

  it("동시 수강 = 영어+수학, N명 (n%)", () => {
    mocks.data = kpiSnapshot();
    const view = render(<Overview initial={mocks.data} />);
    expect(view.container.textContent).toContain("동시 수강(영어+수학)");
    expect(view.container.textContent).toContain("3명 (30%)");
    cleanup();
  });

  it("학년별 재원생 — 세 조각 막대와 마지막 미수강 막대, 호버는 N명", () => {
    mocks.data = kpiSnapshot();
    const view = render(<Overview initial={mocks.data} />);
    const both = screen.getByRole("img", { name: "중1 영어+수학 3명" });
    expect(both.getAttribute("title")).toBe("3명");
    expect(both.textContent).toBe("");
    // 줄 오른쪽에 그 줄 합계(원장 2026-09-12) — 중1 = 영어만 2 + 영어+수학 3 + 수학만 1.
    expect(both.closest("div")?.textContent).toContain("6명");
    expect(screen.getByRole("img", { name: "미수강 재원생 1명" }).closest("div")?.textContent).toContain("1명");
    expect(both).toHaveStyle({ background: DASHBOARD_SUBJECT_COLORS.both });
    expect(screen.getByRole("img", { name: "중1 영어만 2명" })).toHaveStyle({ background: DASHBOARD_SUBJECT_COLORS.english });
    expect(screen.getByRole("img", { name: "기타·미입력 수학만 2명" })).toHaveStyle({ background: DASHBOARD_SUBJECT_COLORS.math });
    expect(screen.queryByRole("img", { name: /^중2 / })).toBeNull();
    expect(screen.getByRole("img", { name: "미수강 재원생 1명" })).toHaveStyle({ background: DASHBOARD_SUBJECT_COLORS.unenrolled });
    expect(view.container.textContent).not.toContain("영어·수학 모두 없는 재원생");
    cleanup();
  });
});
