import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomTimeColumnTable } from "./room-panel-tables";
import type { RoomTimelineCell, RoomTimelineRow, TimelineAxis } from "@/features/timetable/lib/room-metrics";

// 세로 시간축 표의 **구조** 회귀 가드 — 병합(rowSpan) 표는 "덮인 칸에 td를 또 그리면 오른쪽으로 밀린다"가
// 유일하면서 조용한 실패 모드다(화면에선 열이 한 칸씩 어긋난 그림으로만 보인다).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// 정원 칸이 끌고 오는 서버 액션(server-only) — 이 표의 구조 검증엔 필요 없다.
vi.mock("@/features/owner/server/classroom-actions", () => ({ updateClassroomCapacity: vi.fn() }));
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({ labelOf: (k: string) => (k === "math" ? "수학" : k) }),
  useGradeLevels: () => [],
}));

afterEach(cleanup);

// 14:00~16:00 = 10분 12칸.
const AXIS: TimelineAxis = { startMin: 840, endMin: 960, slots: 12, hours: [] };

const cls = (span: number, over: Partial<Extract<RoomTimelineCell, { kind: "class" }>> = {}) =>
  ({
    kind: "class",
    span,
    classId: "c1",
    className: "중등M 중1",
    teacherLabel: "김강사",
    subject: "math",
    startMin: 900,
    endMin: 960,
    students: 8,
    seatPct: 80,
    isSpecialLecture: false,
    overlap: null,
    ...over,
  }) satisfies RoomTimelineCell;

const gap = (span: number): RoomTimelineCell => ({ kind: "gap", span });

// 본원201(2층) → 본원305(3층). groupRooms가 층 순으로 세우므로 입력 순서를 일부러 뒤집어 넣는다.
const ROWS: RoomTimelineRow[] = [
  { key: "r2", name: "본원305", registered: true, capacity: 8, cells: [cls(3), gap(9)] },
  { key: "r1", name: "본원201", registered: true, capacity: 10, cells: [gap(6), cls(6)] },
];

const body = (c: HTMLElement) => [...c.querySelectorAll("tbody tr")];

describe("RoomTimeColumnTable — 시간이 세로, 강의실이 가로", () => {
  it("본문 행 수 = 10분 격자 칸 수(수업이 병합돼도 시간 눈금은 그대로)", () => {
    const { container } = render(
      <RoomTimeColumnTable axis={AXIS} rows={ROWS} canEditCapacity={false} focusSubject={null} groupLines />,
    );
    expect(body(container)).toHaveLength(12);
  });

  it("강의실은 건물·층 순으로 가로에 선다(가로 모드와 같은 정렬)", () => {
    const { container } = render(
      <RoomTimeColumnTable axis={AXIS} rows={ROWS} canEditCapacity={false} focusSubject={null} groupLines />,
    );
    const heads = [...container.querySelectorAll("thead tr")][0]!.querySelectorAll("th");
    expect([...heads].map((h) => h.textContent?.trim())).toEqual(["시각", "본원201", "본원305"]);
  });

  it("병합에 덮인 칸엔 td를 안 그린다(그리면 표가 오른쪽으로 밀린다)", () => {
    const { container } = render(
      <RoomTimeColumnTable axis={AXIS} rows={ROWS} canEditCapacity={false} focusSubject={null} groupLines />,
    );
    const rows = body(container);
    // 0행: 시각 + 201 빈칸 + 305 수업(rowSpan 3) = 3칸 / 1·2행: 305가 덮여 2칸.
    expect(rows.map((r) => r.querySelectorAll("td").length)).toEqual([3, 2, 2, 3, 3, 3, 3, 2, 2, 2, 2, 2]);
    expect(rows[0]!.querySelectorAll("td")[2]!.getAttribute("rowspan")).toBe("3");
    // 6행: 201의 60분 수업이 시작 — 6칸을 덮고 나머지 5행은 305만 남는다.
    expect(rows[6]!.querySelectorAll("td")[1]!.getAttribute("rowspan")).toBe("6");
  });

  it("정시에만 시각 라벨(10분 눈금은 선으로만 말한다)", () => {
    const { container } = render(
      <RoomTimeColumnTable axis={AXIS} rows={ROWS} canEditCapacity={false} focusSubject={null} groupLines />,
    );
    const labels = body(container).map((r) => r.querySelector("td")!.textContent?.trim());
    expect(labels.filter(Boolean)).toEqual(["14시", "15시"]);
  });

  it("블록은 인원·인원률을 그대로 싣고, 낮은 블록(3칸 미만)은 인원만 남긴다", () => {
    const rows: RoomTimelineRow[] = [
      { key: "r1", name: "본원201", registered: true, capacity: 10, cells: [cls(6, { students: 9, seatPct: 90 }), gap(6)] },
      { key: "r3", name: "본원202", registered: true, capacity: 10, cells: [cls(2, { students: 4, seatPct: 40 }), gap(10)] },
    ];
    const { container } = render(
      <RoomTimeColumnTable axis={AXIS} rows={rows} canEditCapacity={false} focusSubject={null} groupLines />,
    );
    const first = body(container)[0]!.querySelectorAll("td");
    expect(first[1]!.textContent).toContain("9명");
    expect(first[1]!.textContent).toContain("90%");
    expect(first[2]!.textContent).toBe("4"); // 낮은 블록 = 인원만(나머지는 툴팁)
    // 접힌 %는 툴팁이 말한다(글자를 접어도 정보가 사라지면 안 된다).
    expect(first[2]!.querySelector("div")!.getAttribute("title")).toContain("정원의 40%");
  });

  it("운영 시간이 없으면 표 대신 이유를 말한다", () => {
    const { container } = render(
      <RoomTimeColumnTable
        axis={{ startMin: 0, endMin: 0, slots: 0, hours: [] }}
        rows={ROWS}
        canEditCapacity={false}
        focusSubject={null}
        groupLines
      />,
    );
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("운영 시간이 없어");
  });
});
