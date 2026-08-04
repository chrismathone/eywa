import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomWeekPanel } from "./room-week-panel";
import type { RoomConflictRow, RoomSeatOverRow } from "@/features/timetable/lib/room-metrics";

// 하단 경고 목록의 **모양** 회귀 가드 — 원장 2026-08-04: *"너무 나열되어있어 가독성 현저히 떨어짐"*.
// 지켜야 할 것 두 가지: ① 한 건 = 한 줄(<li>) ② 반 이름은 수업 상세로 가는 링크.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/owner/server/classroom-actions", () => ({ updateClassroomCapacity: vi.fn() }));
vi.mock("@/features/timetable/server/view-prefs-actions", () => ({ saveTimetableViewPrefs: vi.fn() }));
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({ labelOf: (k: string) => (k === "math" ? "수학" : k) }),
  useGradeLevels: () => [],
}));
vi.mock("@/components/workspace/window-link", () => ({
  WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

afterEach(cleanup);

const seatOver: RoomSeatOverRow[] = [
  {
    key: "s1", roomName: "본원205", capacity: 8, day: "mon",
    startMin: 900, endMin: 1010, students: 9,
    classes: [{ classId: "cls-1", className: "중등M 초6 JJ2A", students: 9 }],
  },
  {
    key: "s2", roomName: "본원301", capacity: 10, day: "mon",
    startMin: 1040, endMin: 1150, students: 12,
    classes: [{ classId: "cls-2", className: "초등M 초5 MS1A", students: 12 }],
  },
];

const conflicts: RoomConflictRow[] = [
  {
    key: "c1", roomName: "본원305", day: "mon", startMin: 930, endMin: 960,
    classes: [
      { classId: "cls-3", className: "중등M 중1", startMin: 900, endMin: 960 },
      { classId: "cls-4", className: "중등M 중2", startMin: 930, endMin: 990 },
    ],
  },
];

const panel = (over: Partial<React.ComponentProps<typeof RoomWeekPanel>> = {}) =>
  render(
    <RoomWeekPanel
      rows={[]}
      axis={{ startMin: 840, endMin: 960, slots: 12, hours: [] }}
      hourRows={[]}
      hourDayLabel="월"
      focusSubject={null}
      groupLines
      timeVertical={false}
      conflicts={[]}
      seatOver={[]}
      unassigned={[]}
      canEditCapacity={false}
      {...over}
    />,
  );

describe("교실뷰 하단 경고 목록 — 한 건 = 한 줄", () => {
  it("정원 초과는 건마다 <li> 하나 + 반 이름이 수업 상세 링크", () => {
    const { container } = panel({ seatOver });
    const items = [...container.querySelectorAll("li")];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("본원205");
    expect(items[0]!.textContent).toContain("9/8명");
    expect(items[0]!.querySelector("a")?.getAttribute("href")).toBe("/classes/cls-1");
  });

  it("시간 겹침은 한 줄에 두 반 — **둘 다** 링크(가려진 반이 여기서만 보인다)", () => {
    const { container } = panel({ conflicts });
    const items = [...container.querySelectorAll("li")];
    expect(items).toHaveLength(1);
    const links = [...items[0]!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/classes/cls-3", "/classes/cls-4"]);
    // 줄이 말하는 시각 = 두 반이 실제로 겹치는 구간.
    expect(items[0]!.textContent).toContain("15:30~16:00");
  });

  it("머리글이 **선택 요일**과 건수를 말한다(주간이 아니라 하루)", () => {
    const { container } = panel({ seatOver, conflicts });
    expect(container.textContent).toContain("정원 초과 · 월요일");
    expect(container.textContent).toContain("시간 겹침 · 월요일");
  });

  it("건이 없으면 블록 자체가 없다(빈 제목이 자리를 먹지 않게)", () => {
    const { container } = panel();
    expect(container.textContent).not.toContain("정원 초과");
    expect(container.textContent).not.toContain("시간 겹침");
  });
});
