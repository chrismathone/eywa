import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatDayTable } from "./seat-day-table";
import { SEAT_BADGE_W, seatFixedCols, seatTableMinWidth } from "../lib/seat-day-columns";
import type { RosterForm } from "../lib/roster-form";
import type { SeatDayStudent } from "../server/seat-day-types";
import type { SheetHandlers } from "./sheet-client";

// className까지 넘긴다 — 이름 칸의 "안 줄고 안 꺾인다"(shrink-0·nowrap)를 이 테스트가 잠근다.
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({
    href,
    className,
    children,
  }: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("./attendance-check", () => ({ AttendanceCheck: () => <span>출결칸</span> }));
vi.mock("./attitude-check", () => ({ AttitudeCheck: () => <span>태도칸</span> }));
vi.mock("@/features/onescreen/components/attendance-pills", () => ({
  SessionUnitsField: () => <span>유닛칸</span>,
}));

afterEach(cleanup);

const student: SeatDayStudent = {
  studentId: "s1",
  classId: "c1",
  className: "중등E_초등 브릿지 A",
  name: "김수민",
  englishName: null,
  school: null,
  grade: null,
  eligible: true,
  historical: false,
  endedOn: null,
  mark: null,
  attendance: null,
  canMarkAttendance: true,
  canEditMark: true,
};

function renderTable(form: RosterForm, students: SeatDayStudent[] = [student]) {
  return render(
    <SeatDayTable
      date="2026-08-14"
      slotStart="16:20"
      form={form}
      students={students}
      handlersOf={() => ({}) as SheetHandlers}
      collapsedGroups={[]}
      onToggleGroup={() => undefined}
    />,
  );
}

describe("305 합명단 표", () => {
  it("JJ 폼 머리 — 듣기 레벨·누적 암기 단어수, 시험 점수 없음", () => {
    renderTable("selfStudy");
    expect(screen.getByText("듣기 레벨")).toBeInTheDocument();
    expect(screen.getByText("누적 암기 단어수")).toBeInTheDocument();
    expect(screen.queryByText("시험 점수")).not.toBeInTheDocument();
    expect(screen.getByText("김수민")).toBeInTheDocument();
    expect(screen.getByText("초등 브릿지 A")).toBeInTheDocument();
  });

  // 원장 2026-09-10: "영어강사시트 → JJ 뷰에서 반별로 정렬".
  // 🔴 순수 함수(seat-day-order)가 있는 것만으로는 부족하다 — **표가 실제로 그 순서로 그려지는지**를 잠근다.
  it("줄은 반별로 묶이고, 반 안에서는 가나다 — 반을 모르는 줄은 맨 뒤", () => {
    const at = (name: string, classId: string, className: string): SeatDayStudent => ({
      ...student,
      studentId: `s-${name}`,
      name,
      classId,
      className,
    });
    const { container } = renderTable("selfStudy", [
      // 서버가 넘기는 순서 = 가나다(반이 뒤섞인 상태) 그대로.
      at("김근호", "c-med", "중등E_중1 MED"),
      at("류지훈", "c-sky", "초등E_초6 SKY"),
      at("류혜정", "c-med", "중등E_중1 MED"),
      at("박서연D", "c-reg", "중등E_중2 정규 A"),
      at("반없음", "c-none", ""),
    ]);
    const names = [...container.querySelectorAll("tbody tr td:first-child a")].map((a) => a.textContent);
    expect(names).toEqual(["김근호", "류혜정", "박서연D", "류지훈", "반없음"]);
    // navRow는 정렬 **뒤에** 매긴다 — Enter 세로 이동이 눈에 보이는 순서를 따라가야 한다.
    const navRows = [...container.querySelectorAll("tbody tr [data-nav-row]")].map((el) =>
      el.getAttribute("data-nav-row"),
    );
    expect(navRows.length).toBeGreaterThan(0);
    expect([...new Set(navRows)]).toEqual(["0", "1", "2", "3", "4"]);
  });

  // ── 열 구성 불변식(2026-08-19) ───────────────────────────────────────────────
  // 교시 블록이 여러 개 쌓이는 면이라, 열 폭이 블록마다 갈리면 같은 열이 다른 x에 온다.
  it("colgroup = seat-day-columns 단일 소스 · 특이사항만 잔여(폭 무지정)", () => {
    for (const form of ["default", "selfStudy"] as const) {
      cleanup();
      const { container } = renderTable(form);
      const cols = [...container.querySelectorAll("colgroup col")];
      const fixed = seatFixedCols(form);
      expect(cols).toHaveLength(fixed.length + 1);
      expect(cols.slice(0, fixed.length).map((c) => (c as HTMLElement).style.width)).toEqual(
        fixed.map((w) => `${w}px`),
      );
      // 마지막(특이사항)은 남는 폭을 받아야 하므로 width를 주지 않는다.
      expect((cols[cols.length - 1] as HTMLElement).style.width).toBe("");
      const table = container.querySelector("table") as HTMLElement;
      expect(table.style.minWidth).toBe(`${seatTableMinWidth(form)}px`);
    }
  });

  it("앞 4열(이름·출결·유닛·태도)은 폼이 달라도 같은 폭 — 블록끼리 같은 x", () => {
    const widthsOf = (form: RosterForm) => {
      cleanup();
      const { container } = renderTable(form);
      return [...container.querySelectorAll("colgroup col")]
        .slice(0, 4)
        .map((c) => (c as HTMLElement).style.width);
    };
    expect(widthsOf("default")).toEqual(widthsOf("selfStudy"));
  });

  it("열 구분선은 표 **한 곳**에서 옅게(border-l-line-faint) — 첫 칸 제외", () => {
    const { container } = renderTable("selfStudy");
    const cls = (container.querySelector("table") as HTMLElement).className;
    expect(cls).toContain("[&_tr>*:not(:first-child)]:border-l");
    expect(cls).toContain("[&_tr>*:not(:first-child)]:border-l-line-faint");
  });

  // 원장 2026-08-19: "이름에 문자가 붙는 학생 때문에 열이 흐트러짐" — 접미사로 이름이 길어지면
  // 인라인 배지가 둘째 줄로 꺾여 그 행만 키가 커졌다. 이름은 안 줄고, 배지가 먼저 줄어야 한다.
  it("이름 칸 = 한 줄(이름 shrink-0·nowrap / 배지가 먼저 truncate)", () => {
    const { container } = renderTable("selfStudy", [{ ...student, name: "이서온A" }]);
    const row = container.querySelector("tbody tr td div") as HTMLElement;
    expect(row.className).toContain("flex");
    // 최종 클램프 — 비정상적으로 긴 이름도 옆 열을 침범하지 않는다.
    expect(row.className).toContain("overflow-hidden");
    const link = screen.getByText("이서온A").closest("a") as HTMLElement;
    expect(link.className).toContain("shrink-0");
    expect(link.className).toContain("whitespace-nowrap");
    const badge = screen.getByText("초등 브릿지 A");
    expect(badge.className).toContain("truncate");
    expect(badge.className).toContain("min-w-0"); // 없으면 flex 항목이 안 줄어 이름을 밀어낸다
    expect(badge.style.maxWidth).toBe(`${SEAT_BADGE_W}px`);
  });
});
