import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RosterTable } from "./roster-table";
import { TodayRosterTable } from "./today-roster-table";
import type { ClassSheetWeekData } from "../server/queries";
import type { GridDay, RosterEntry } from "../lib/grid";
import type { SheetHandlers } from "./sheet-client";

/**
 * 원장 2026-08-18: *"퇴원생은 이름 학교학년(예: 침산중2)만 표시, 뒤에는 필요 없음"* →
 * *"날짜도 있어야겠네. **이름 학교학년 (퇴원일, 퇴원사유)** 정도."*
 *
 * 지켜야 할 것:
 *  ① 퇴원 행엔 입력칸이 **하나도 없다**(쓸 수 없는 빈 칸이 자리만 먹던 것 = 지시의 발단).
 *  ② 요약은 `이름 · 학교학년 · (퇴원일, 사유)` — 학교학년은 압축 표기(공백 join 금지).
 *  ③ 사유가 표준 코드(other 등)면 **한글**로 나온다(raw enum 노출 금지).
 *  🔴 ④ 남아 있는 기록은 사라지지 않는다 — 접는 건 빈 칸이지 값이 아니다.
 *  ⑤ 재원·기록 섹션은 종전 그대로(이번 변경은 '퇴원' 섹션 표시만).
 */
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./attendance-check", () => ({ AttendanceCheck: () => <span>출결칸</span> }));
vi.mock("./attitude-check", () => ({ AttitudeCheck: () => <span>태도칸</span> }));
vi.mock("@/features/onescreen/components/attendance-pills", () => ({
  SessionUnitsField: () => <span>유닛칸</span>,
}));

afterEach(cleanup);

const DATE = "2026-08-18";
const SLOT = "16:20";
const handlers = { saveMark: vi.fn(), setAttendanceNote: vi.fn() } as unknown as SheetHandlers;

const gone = (over?: Partial<RosterEntry>): RosterEntry => ({
  studentId: "out-1",
  eligible: false,
  historical: true,
  endedOn: "2026-08-14",
  endedReason: "이사",
  ...over,
});
const here: RosterEntry = { studentId: "in-1", eligible: true, historical: false, endedOn: null };

const data = {
  canMarkAttendanceByDate: { [DATE]: true },
  canNoteAttendance: true,
  students: {
    "out-1": { name: "박퇴원", school: "침산중", grade: "중2", englishName: null },
    "in-1": { name: "김재원", school: "침산중", grade: "중1", englishName: null },
  },
} as unknown as ClassSheetWeekData;

function renderWeekly(roster: RosterEntry[], marks = {}, attendance = {}) {
  return render(
    <RosterTable
      date={DATE}
      slotStart={SLOT}
      roster={roster}
      data={data}
      marks={marks}
      attendance={attendance}
      handlers={handlers}
      canEdit
      collapsedGroups={[]}
      onToggleGroup={vi.fn()}
      form="default"
    />,
  );
}

describe("주간 시트 — 퇴원 행은 한 줄 요약", () => {
  it("② 이름 · 학교학년 · (퇴원일, 사유) — 압축 표기 '침산중2'", () => {
    const { container } = renderWeekly([gone()]);
    expect(container.textContent).toContain("박퇴원");
    expect(container.textContent).toContain("침산중2 · (08-14, 이사)");
    // 공백 join("침산중 중2")로 새로 만들지 않는다(전역 표기 규칙).
    expect(container.textContent).not.toContain("침산중 중2");
  });

  it("① 퇴원 행엔 입력칸이 하나도 없다(빈 칸이 자리만 먹던 것)", () => {
    const { container } = renderWeekly([gone()]);
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.textContent).not.toContain("출결칸");
    expect(container.textContent).not.toContain("유닛칸");
  });

  it("③ 표준 사유 코드는 한글로 — raw enum('other')을 화면에 흘리지 않는다", () => {
    const { container } = renderWeekly([gone({ endedReason: "other" })]);
    expect(container.textContent).toContain("(08-14, 기타)");
    expect(container.textContent).not.toContain("other");
  });

  it("사유가 없으면 괄호 안에 날짜만 — 빈 괄호를 만들지 않는다", () => {
    const { container } = renderWeekly([gone({ endedReason: null })]);
    expect(container.textContent).toContain("(08-14)");
    expect(container.textContent).not.toContain("(08-14,");
  });

  it("🔴 ④ 이미 적힌 기록은 요약 뒤에 남는다 — 칸을 접어도 값이 증발하지 않는다", () => {
    const key = `out-1|${DATE}|${SLOT}`;
    const { container } = renderWeekly(
      [gone()],
      { [key]: { status: "좋음", progressNote: "마지막 수업", score: "18/20", listeningLevel: null, memorizedWords: null } },
      { [key]: { status: "late", note: "버스 지연", units: null, slot: SLOT } },
    );
    expect(container.textContent).toContain("지각(버스 지연)");
    expect(container.textContent).toContain("태도 좋음");
    expect(container.textContent).toContain("시험 점수 18/20");
    expect(container.textContent).toContain("마지막 수업");
  });

  it("⑤ 재원 행은 종전 그대로 입력칸을 그린다", () => {
    const { container } = renderWeekly([here, gone()]);
    expect(container.textContent).toContain("출결칸");
    expect(screen.getByLabelText("김재원 시험 점수")).toBeTruthy();
    // 퇴원생 것은 없다.
    expect(screen.queryByLabelText("박퇴원 시험 점수")).toBeNull();
  });
});

describe("오늘 면 통합 표 — 같은 문장(두 화면이 갈리지 않게)", () => {
  const day = {
    date: DATE,
    slots: [
      { slotStart: "16:20", teacherLabel: "Hannah", roster: [here, gone()] },
      { slotStart: "17:20", teacherLabel: "Hannah", roster: [here, gone()] },
    ],
  } as unknown as GridDay;

  it("퇴원 행은 교시가 여럿이어도 한 줄 요약 — 값이 있는 교시만 뒤에 붙는다", () => {
    const { container } = render(
      <TodayRosterTable
        day={day}
        data={data}
        marks={{}}
        attendance={{
          [`out-1|${DATE}|17:20`]: { status: "absent", note: null, units: null, slot: "17:20" },
        }}
        handlers={handlers}
        canEdit
        collapsedGroups={[]}
        onToggleGroup={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("침산중2 · (08-14, 이사)");
    // 값이 있는 교시가 하나뿐이라 교시 시각은 안 붙는다.
    expect(container.textContent).toContain("· 결석");
    expect(container.textContent).not.toContain("17:20 결석");
  });
});
