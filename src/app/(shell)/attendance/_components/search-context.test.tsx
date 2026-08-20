import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import { rowKey } from "@/features/attendance/grid/model";
import * as actions from "@/features/attendance/server/actions";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./matrix-table";
import { GridProvider } from "./grid-context";
import { AttendanceSearchBox, AttendanceSearchProvider } from "./search-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: vi.fn(async () => ({ ok: true })),
  setAttendanceRange: vi.fn(async () => ({ ok: true, applied: 0, blocked: 0 })),
}));
const { savePrefs } = vi.hoisted(() => ({ savePrefs: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/features/attendance/server/prefs-actions", () => ({ saveAttendanceCollapsed: savePrefs }));

const CA = "aaaaaaaa-1111-1111-1111-111111111111";
const CB = "bbbbbbbb-2222-2222-2222-222222222222";
const S1 = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const S2 = "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const S3 = "33333333-cccc-cccc-cccc-cccccccccccc";
const D1 = "2026-07-01";
const D2 = "2026-07-02";
const DAYS: AttendanceMatrix["days"] = [
  { date: D1, day: 1, dow: 3, label: "수", isWeekend: false, isToday: false },
  { date: D2, day: 2, dow: 4, label: "목", isWeekend: false, isToday: false },
];

function matrix(students: AttendanceMatrix["students"]): AttendanceMatrix {
  return {
    classes: [],
    selectedClassId: null,
    month: "2026-07",
    window: { kind: "month", scope: null, start: "2026-07-01", end: "2026-07-31", label: "2026년 7월", defId: null },
    days: DAYS,
    classDows: [3],
    students,
    marks: {},
    notes: {},
    units: {},
    slots: {},
    ghosts: {},
    dayAxis: {},
    derived: {},
    derivedActive: false,
    stats: {
      totalStudents: students.length,
      presentRate: 0,
      presentCount: 0,
      absentCount: 0,
      lateCount: 0,
      makeupCount: 0,
      totalRecords: 0,
    },
  };
}

const student = (id: string, name: string, school: string, grade: string) => ({
  id,
  name,
  grade,
  school,
  enrolledAt: null,
  attendDows: [3],
  spans: [],
  badges: [],
});

const GROUPS: MatrixGroup[] = [
  {
    classId: CA,
    className: "가반",
    subjectLabel: "수학",
    matrix: matrix([student(S1, "이도윤", "경명여자중학교", "고1"), student(S2, "박서준", "대구중", "중2")]),
  },
  {
    classId: CB,
    className: "나반",
    subjectLabel: "수학",
    matrix: matrix([student(S3, "최유나", "대구중", "중2")]),
  },
];
const ORDERED = [
  { classId: CA, studentId: S1 },
  { classId: CA, studentId: S2 },
  { classId: CB, studentId: S3 },
];
const SEARCH_ROWS = [
  { row: rowKey(CA, S1), studentId: S1, name: "이도윤", school: "경명여자중학교", grade: "고1", schoolGrade: "경명여자중학교1" },
  { row: rowKey(CA, S2), studentId: S2, name: "박서준", school: "대구중", grade: "중2", schoolGrade: "대구중2" },
  { row: rowKey(CB, S3), studentId: S3, name: "최유나", school: "대구중", grade: "중2", schoolGrade: "대구중2" },
];

function sheet(showGroups: boolean, initialQuery?: string) {
  const src = buildGridSource(GROUPS, DAYS, ORDERED);
  return (
    <AttendanceSearchProvider rows={SEARCH_ROWS} initialQuery={initialQuery}>
      <GridProvider rows={src.rows} cols={src.cols} initial={src.initial} lockBefore={null}>
        <AttendanceSearchBox />
        <MatrixTable groups={GROUPS} days={DAYS} holidays={{}} showGroups={showGroups} ordered={ORDERED} />
      </GridProvider>
    </AttendanceSearchProvider>
  );
}

function renderSheet(showGroups = true, initialQuery?: string) {
  const view = render(sheet(showGroups, initialQuery));
  return { ...view, input: screen.getByLabelText("학생 검색") as HTMLInputElement };
}

const type = (input: HTMLInputElement, v: string) => fireEvent.change(input, { target: { value: v } });
const cellsOf = (c: HTMLElement, date: string) =>
  [...c.querySelectorAll<HTMLElement>(`[data-cell-key$="${date}"]`)];

beforeEach(() => vi.clearAllMocks());

describe("출석부 학생 검색 — 좁히기", () => {
  it("이름 부분 일치로 그 학생 줄만 남는다", () => {
    const { input } = renderSheet();
    expect(screen.getByText("박서준")).toBeTruthy();
    type(input, "이도");
    expect(screen.getByText("이도윤")).toBeTruthy();
    expect(screen.queryByText("박서준")).toBeNull();
    expect(screen.queryByText("최유나")).toBeNull();
  });

  it("🔴 안 맞는 행은 감추는 게 아니라 **DOM에 없다** — 남으면 키보드가 그 칸으로 들어간다", () => {
    const { container, input } = renderSheet();
    expect(cellsOf(container, D1)).toHaveLength(3);
    type(input, "이도");
    const keys = cellsOf(container, D1).map((el) => el.getAttribute("data-cell-key"));
    expect(keys).toEqual([`${rowKey(CA, S1)}|${D1}`]);
  });

  it("🔴 매칭 학생이 없는 반은 **머리행째** 사라진다 — 반 이름만 남으면 펼쳐 보게 된다", () => {
    const { input } = renderSheet();
    expect(screen.getByText("나반")).toBeTruthy();
    type(input, "이도");
    expect(screen.queryByText("나반")).toBeNull();
    expect(screen.getByText("가반")).toBeTruthy();
  });

  it("반 머리행은 검색에 걸린 인원을 함께 적는다 — 전체 인원만 두면 숫자가 거짓말한다", () => {
    const { input } = renderSheet();
    type(input, "이도");
    expect(screen.getByText("검색 1명")).toBeTruthy();
  });

  it("학교·학년(붙여 쓴 표기)으로도 찾힌다", () => {
    const { input } = renderSheet();
    type(input, "대구중2");
    expect(screen.getByText("박서준")).toBeTruthy();
    expect(screen.getByText("최유나")).toBeTruthy();
    expect(screen.queryByText("이도윤")).toBeNull();
  });

  it("반 구분 없는 정렬(반 머리행 없음)에서도 같은 규칙으로 좁아진다", () => {
    const { container, input } = renderSheet(false);
    type(input, "최유");
    expect(cellsOf(container, D1)).toHaveLength(1);
    expect(screen.getByText("최유나")).toBeTruthy();
  });
});

describe("접힌 반과 검색", () => {
  it("🔴 접힌 반 안의 학생도 검색하면 보인다 — 안 그러면 '검색했는데 없다'가 된다", () => {
    const { container, input } = renderSheet();
    // '나반'을 접는다(머리행 클릭).
    fireEvent.click(screen.getByText("나반").closest("button")!);
    expect(screen.queryByText("최유나")).toBeNull();
    type(input, "최유");
    expect(screen.getByText("최유나")).toBeTruthy();
    // 격자 좌표도 같은 판정이어야 한다 — 그려진 칸이 곧 움직일 수 있는 칸이다.
    expect(cellsOf(container, D1)).toHaveLength(1);
  });

  it("검색 중엔 전체 접기 컨트롤이 물러난다 — 눌러도 아무 일이 안 나는 버튼을 남기지 않는다", () => {
    // 이름 칸 머리의 아이콘 버튼(글자 없는 짝)과 툴바 칩이 같은 판정을 쓴다.
    const { input } = renderSheet();
    expect(screen.getByLabelText("전체 접기")).toBeTruthy();
    type(input, "이도");
    expect(screen.queryByLabelText("전체 접기")).toBeNull();
    expect(screen.queryByLabelText("전체 펼치기")).toBeNull();
  });

  it("검색을 지우면 접힘이 그대로 되돌아온다 — 접기 상태를 건드리지 않는다", () => {
    const { input } = renderSheet();
    fireEvent.click(screen.getByText("나반").closest("button")!);
    type(input, "최유");
    expect(screen.getByText("최유나")).toBeTruthy();
    type(input, "");
    expect(screen.queryByText("최유나")).toBeNull();
  });
});

describe("🔴 필터 상태에서 저장·범위 입력 — 안 보이는 행은 못 건드린다", () => {
  it("Shift 범위가 숨은 행으로 번지지 않는다", () => {
    const { container, input } = renderSheet();
    type(input, "이도");
    const cell = cellsOf(container, D1)[0]!;
    fireEvent.mouseDown(cell, { button: 0 });
    // 필터가 없었다면 아래 두 줄(박서준·최유나)까지 잡혔을 조작.
    fireEvent.keyDown(cell, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(cell, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(cell, { key: "Delete" });
    // 범위가 한 칸으로 접혔으니 단건 경로로 간다 — 그리고 그 한 칸은 보이는 학생의 것이다.
    expect(actions.setAttendanceRange).not.toHaveBeenCalled();
    expect(actions.setAttendanceCell).toHaveBeenCalledTimes(1);
    expect(vi.mocked(actions.setAttendanceCell).mock.calls[0]![0]).toMatchObject({ studentId: S1 });
  });

  it("🔴 검색으로 사라진 칸에 타이핑이 들어가지 않는다 — 키 입력은 document가 받는다", () => {
    const { container, input } = renderSheet();
    // 박서준 칸을 고른 **뒤** 그 학생을 필터로 지운다.
    const cell = cellsOf(container, D1)[1]!;
    fireEvent.mouseDown(cell, { button: 0 });
    type(input, "이도");
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(actions.setAttendanceCell).not.toHaveBeenCalled();
    expect(actions.setAttendanceRange).not.toHaveBeenCalled();
  });

  it("(대조군) 필터가 없으면 같은 조작이 그대로 저장된다 — 위 두 테스트가 헛통과가 아니다", () => {
    const { container } = renderSheet();
    const cell = cellsOf(container, D1)[1]!;
    fireEvent.mouseDown(cell, { button: 0 });
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(vi.mocked(actions.setAttendanceCell).mock.calls[0]![0]).toMatchObject({ studentId: S2 });
  });
});

describe("해제와 빈 결과", () => {
  it("결과 0명이면 **왜 비었는지** 한 줄로 밝히고 되돌릴 버튼을 준다", () => {
    const { container, input } = renderSheet();
    type(input, "없는이름");
    expect(container.textContent).toContain("‘없는이름’과 맞는 학생이 이 달 출석부에 없습니다");
    fireEvent.click(screen.getByText("검색 지우기"));
    expect(screen.getByText("박서준")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("Esc로 즉시 해제된다", () => {
    const { input } = renderSheet();
    type(input, "이도");
    expect(screen.queryByText("박서준")).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.value).toBe("");
    expect(screen.getByText("박서준")).toBeTruthy();
  });

  it("지우기 버튼은 검색어가 있을 때만 뜬다", () => {
    const { input } = renderSheet();
    expect(screen.queryByLabelText("검색 지우기")).toBeNull();
    type(input, "이도");
    fireEvent.click(screen.getByLabelText("검색 지우기"));
    expect(input.value).toBe("");
  });

  it("🔴 검색어는 계정에 저장하지 않는다 — 다음 방문에 필터가 걸린 채 열리면 '출석부가 비었다'로 읽힌다", () => {
    const { input } = renderSheet();
    type(input, "이도");
    expect(savePrefs).not.toHaveBeenCalled();
  });
});

describe("숫자가 거짓말하지 않는다", () => {
  it("🔴 'N명'은 **실인원**이다 — 강사 전체 보기는 한 학생이 여러 반에 나와 줄이 둘 이상이다", () => {
    // 같은 학생(S1)이 두 반에 있는 표: 줄은 3개지만 사람은 2명이다.
    render(
      <AttendanceSearchProvider
        rows={[
          { row: rowKey(CA, S1), studentId: S1, name: "이도윤" },
          { row: rowKey(CB, S1), studentId: S1, name: "이도윤" },
          { row: rowKey(CB, S3), studentId: S3, name: "최유나" },
        ]}
      >
        <AttendanceSearchBox />
      </AttendanceSearchProvider>,
    );
    const box = screen.getByLabelText("학생 검색") as HTMLInputElement;
    type(box, "이도");
    expect(screen.getByText(/검색 중 · 1\/2명 표시/)).toBeTruthy();
  });

  it("합계는 전체 기준 그대로 두되 **걸린 필터를 눈에 보이게** 적는다", () => {
    const { container, input } = renderSheet();
    expect(container.textContent).not.toContain("검색 중");
    type(input, "이도");
    expect(container.textContent).toContain("검색 중 · 1/3명 표시");
    expect(container.textContent).toContain("시수·출석률·금액은 전체 기준");
  });
});

/**
 * URL 씨앗(`?q=`) — 허브에서 학생을 눌러 **검색어를 들고** 들어오는 동선(원장 2026-08-20).
 * 🔴 저장이 아니라 씨앗이다: 화면 값과 주소창이 어긋나면 강사·과목을 바꿀 때 옛 검색어가 되살아난다.
 */
describe("URL 씨앗으로 들어오기", () => {
  const at = (search: string) => window.history.replaceState(null, "", `/attendance${search}`);

  it("씨앗이 있으면 **첫 화면부터** 그 학생 줄만 남는다(허브 결과 클릭)", () => {
    at("?q=이도");
    const { container } = renderSheet(true, "이도");
    expect(screen.getByText("이도윤")).toBeTruthy();
    expect(screen.queryByText("박서준")).toBeNull();
    expect(screen.queryByText("나반")).toBeNull();
    expect(container.textContent).toContain("검색 중 · 1/3명 표시");
    expect((screen.getByLabelText("학생 검색") as HTMLInputElement).value).toBe("이도");
    // 🔴 격자 좌표도 첫 렌더부터 좁아져 있어야 한다 — 안 그러면 방향키가 안 보이는 칸으로 들어간다.
    expect(cellsOf(container, D1).map((el) => el.getAttribute("data-cell-key"))).toEqual([
      `${rowKey(CA, S1)}|${D1}`,
    ]);
  });

  it("한 학생이 여러 반이면 **반 그룹이 둘 다** 남는다(원장 스크린샷의 윤현소)", () => {
    at("?q=대구중2");
    renderSheet(true, "대구중2");
    expect(screen.getByText("가반")).toBeTruthy();
    expect(screen.getByText("나반")).toBeTruthy();
    expect(screen.getByText("박서준")).toBeTruthy();
    expect(screen.getByText("최유나")).toBeTruthy();
    expect(screen.queryByText("이도윤")).toBeNull();
  });

  it("🔴 지우기(X)는 URL의 q도 **즉시** 뗀다 — 안 지우면 새로고침에 되살아난다", () => {
    at("?month=2026-07&q=이도");
    const { input } = renderSheet(true, "이도");
    fireEvent.click(screen.getByLabelText("검색 지우기"));
    expect(input.value).toBe("");
    expect(window.location.search).toBe("?month=2026-07");
    expect(screen.getByText("박서준")).toBeTruthy();
  });

  it("Esc도 같은 경로로 URL을 정리한다", () => {
    at("?q=이도");
    const { input } = renderSheet(true, "이도");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(window.location.search).toBe("");
  });

  it("검색어를 바꾸면 주소창도 따라온다 — 강사·과목 드롭다운이 그 값을 그대로 들고 간다", () => {
    vi.useFakeTimers();
    try {
      at("?month=2026-07&q=이도");
      const { input } = renderSheet(true, "이도");
      type(input, "최유");
      // 디바운스 전에는 아직 옛 값(타이핑마다 replaceState를 쏘지 않는다).
      expect(window.location.search).toBe("?month=2026-07&q=%EC%9D%B4%EB%8F%84");
      vi.advanceTimersByTime(300);
      expect(new URLSearchParams(window.location.search).get("q")).toBe("최유");
      expect(new URLSearchParams(window.location.search).get("month")).toBe("2026-07");
    } finally {
      vi.useRealTimers();
    }
  });

  it("🔴 새 씨앗이 오면(다른 학생 링크) 화면 값이 그 씨앗으로 되돌아간다", () => {
    at("?q=이도");
    const { rerender, input } = renderSheet(true, "이도");
    type(input, "최유");
    expect(screen.getByText("최유나")).toBeTruthy();
    // 같은 라우트 소프트 내비 — 공급자는 remount되지 않고 prop만 바뀐다.
    rerender(sheet(true, "박서"));
    expect(screen.getByText("박서준")).toBeTruthy();
    expect(screen.queryByText("최유나")).toBeNull();
    expect((screen.getByLabelText("학생 검색") as HTMLInputElement).value).toBe("박서");
  });

  it("🔴 씨앗이 그대로면 방금 친 값이 살아남는다 — 저장 뒤 router.refresh()에 검색이 풀리면 안 된다", () => {
    at("?q=이도");
    const { rerender, input } = renderSheet(true, "이도");
    type(input, "최유");
    rerender(sheet(true, "이도"));
    expect((screen.getByLabelText("학생 검색") as HTMLInputElement).value).toBe("최유");
    expect(screen.getByText("최유나")).toBeTruthy();
  });

  it("씨앗이 없으면 종전 그대로 빈 검색으로 열린다", () => {
    at("");
    const { input } = renderSheet();
    expect(input.value).toBe("");
    expect(screen.getByText("이도윤")).toBeTruthy();
    expect(screen.getByText("최유나")).toBeTruthy();
  });
});
