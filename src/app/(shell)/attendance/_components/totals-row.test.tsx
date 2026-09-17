// 하단 합계 줄 — **검색을 걸면 숫자도 검색 기준**(원장 제보 2026-08-20 "학생 검색시 하단 숫자는 안바뀌네").
//
// 여기서 보는 것: ① 검색 전 표기가 종전 그대로인가 ② 검색하면 시수·청구·납입·정산액이 매치된 학생만으로
// 다시 세는가 ③ **전체 값이 함께 서는가**(좁혀 놓고 전체인 척하지 않기, [[#89]]) ④ 지우면 흔적 없이 복귀.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AttendanceMatrix } from "@/features/attendance/server/queries";
import type { TeacherMoney } from "@/features/attendance/server/teacher-money";
import { rowKey } from "@/features/attendance/grid/model";
import { MatrixTable, buildGridSource, type MatrixGroup } from "./matrix-table";
import { GridProvider } from "./grid-context";
import { AttendanceSearchProvider, AttendanceSearchToggle } from "./search-context";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: vi.fn(async () => ({ ok: true })),
  setAttendanceRange: vi.fn(async () => ({ ok: true, applied: 0, blocked: 0 })),
}));
vi.mock("@/features/attendance/server/prefs-actions", () => ({
  saveAttendanceCollapsed: vi.fn(async () => ({ ok: true })),
}));

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

const student = (id: string, name: string) => ({
  id,
  name,
  grade: "중2",
  school: "대구중",
  enrolledAt: null,
  attendDows: [3],
  spans: [],
  badges: [],
});

function matrix(
  students: AttendanceMatrix["students"],
  marks: AttendanceMatrix["marks"],
  units: AttendanceMatrix["units"] = {},
): AttendanceMatrix {
  return {
    classes: [],
    selectedClassId: null,
    month: "2026-07",
    window: { kind: "month", scope: null, start: "2026-07-01", end: "2026-07-31", label: "2026년 7월", defId: null },
    days: DAYS,
    classDows: [3],
    students,
    marks,
    notes: {},
    units,
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

// 이도윤 = 출석 1 + 보강 2 = 시수 3 · 박서준 1 · 최유나 1 → 표 전체 시수 5(가반 4 · 나반 1).
const GROUPS: MatrixGroup[] = [
  {
    classId: CA,
    className: "가반",
    subjectLabel: "수학",
    matrix: matrix(
      [student(S1, "이도윤"), student(S2, "박서준")],
      { [S1]: { [D1]: "present", [D2]: "makeup" }, [S2]: { [D1]: "present" } },
      { [S1]: { [D2]: 2 } },
    ),
  },
  {
    classId: CB,
    className: "나반",
    subjectLabel: "수학",
    matrix: matrix([student(S3, "최유나")], { [S3]: { [D1]: "present" } }),
  },
];
const ORDERED = [
  { classId: CA, studentId: S1 },
  { classId: CA, studentId: S2 },
  { classId: CB, studentId: S3 },
];
const SEARCH_ROWS = [
  { row: rowKey(CA, S1), studentId: S1, name: "이도윤", school: "대구중", grade: "중2", schoolGrade: "대구중2" },
  { row: rowKey(CA, S2), studentId: S2, name: "박서준", school: "대구중", grade: "중2", schoolGrade: "대구중2" },
  { row: rowKey(CB, S3), studentId: S3, name: "최유나", school: "대구중", grade: "중2", schoolGrade: "대구중2" },
];

/** 정산 행 — 서버가 이미 floor1로 확정한 금액을 그대로 들고 있다(화면은 고르고 더하기만). */
const MONEY: TeacherMoney = {
  byStudent: {
    [S1]: { billed: 300_000, paid: 300_000, shared: false },
    [S2]: { billed: 250_000, paid: 100_000, shared: true },
    [S3]: { billed: 400_000, paid: 0, shared: false },
  },
  totals: { billed: 950_000, paid: 400_000, students: 3, sharedStudents: 1 },
  splitRows: 3,
  commissionRate: 45,
  tierSettlement: {
    status: "ready",
    total: 300_000,
    unitsTotal: 6,
    rowCount: 3,
    missingTierStudents: ["최유나"],
    missingTierStudentIds: [S3],
    missingPriceTiers: [],
    excludedUnits: 1,
    tierByStudent: {},
    settlementLines: [
      { studentId: S1, units: 4, amount: 200_000.5 },
      { studentId: S2, units: 1, amount: 60_000.2 },
      { studentId: S3, units: 1, amount: 39_999.9 },
    ],
    excludedLines: [
      { studentId: S3, studentName: "최유나", units: 1, reason: "no-tier", tierLabel: null },
    ],
  },
};

function renderSheet(money: TeacherMoney | null = MONEY) {
  const src = buildGridSource(GROUPS, DAYS, ORDERED);
  const view = render(
    <AttendanceSearchProvider rows={SEARCH_ROWS}>
      <GridProvider rows={src.rows} cols={src.cols} initial={src.initial} lockBefore={null}>
        <AttendanceSearchToggle />
        <MatrixTable groups={GROUPS} days={DAYS} holidays={{}} showGroups money={money} ordered={ORDERED} />
      </GridProvider>
    </AttendanceSearchProvider>,
  );
  // 입력칸은 토글(§10) 뒤에 있다 — 접혀 있으면 '검색'을 눌러 펼친다.
  if (!screen.queryByLabelText("학생 검색")) fireEvent.click(screen.getByRole("button", { name: "검색" }));
  return { ...view, input: screen.getByLabelText("학생 검색") as HTMLInputElement };
}

const type = (input: HTMLInputElement, v: string) => fireEvent.change(input, { target: { value: v } });
/** 공백을 접어 비교 — JSX 조각 사이의 개행·들여쓰기가 textContent에 섞인다. */
const flat = (el: HTMLElement) => el.textContent!.replace(/\s+/g, " ");

describe("하단 합계 줄 — 검색 전에는 종전 표기 그대로", () => {
  it("학생 행 맨 오른쪽 청구·납입 열은 없다 — 합계 줄의 청구·납입은 그대로(원장 2026-09-17)", () => {
    const { container } = renderSheet();
    expect(screen.queryByRole("columnheader", { name: "청구" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "납입" })).toBeNull();
    // 이름·학교학년 + 날짜 + 시수·출석률 — 금액 칸 없음.
    expect(screen.getByText("박서준").closest("tr")!.children).toHaveLength(DAYS.length + 4);
    expect(container.querySelector("tfoot td")).toHaveAttribute("colspan", String(DAYS.length + 4));
    expect(flat(container.querySelector("tfoot")!)).toContain("납입 400,000");
  });
  it("라벨은 '합계'이고 병기(`/ 전체`)도 칩도 없다", () => {
    const { container } = renderSheet();
    const t = flat(container);
    expect(t).toContain("합계");
    expect(t).not.toContain("검색 합계");
    expect(t).not.toContain("검색 중 — 전체 아님");
    expect(t).toContain("2개 반");
    expect(t).toContain("시수 5");
    expect(t).toContain("청구 950,000");
    expect(t).toContain("납입 400,000");
    expect(t).toContain("(3명 기준)");
    expect(t).toContain("정산액 300,000");
  });
});

describe("🔴 검색을 걸면 하단 숫자가 검색 기준으로 바뀐다", () => {
  it("라벨·검색어·칩이 함께 뜬다 — 툴팁이 아니라 보이는 글씨로", () => {
    const { container, input } = renderSheet();
    type(input, "이도");
    const t = flat(container);
    expect(t).toContain("검색 합계");
    expect(t).toContain("‘이도’");
    expect(t).toContain("검색 중 — 전체 아님");
  });

  it("반 수·시수·청구·납입·인원이 전부 `검색분 / 전체`로 선다", () => {
    const { container, input } = renderSheet();
    type(input, "이도");
    const t = flat(container);
    expect(t).toContain("1 / 2개 반");
    // 이도윤: 출석 1 + 보강 2 = 시수 3 / 표 전체 5(박서준 1 · 최유나 1).
    expect(t).toContain("시수 3 / 5");
    expect(t).toContain("청구 300,000 / 950,000");
    expect(t).toContain("납입 300,000 / 400,000");
    expect(t).toContain("(1 / 3명 기준)");
  });

  it("🔴 정산액도 그 학생 행만 — 전체 값은 옆에 그대로 남는다", () => {
    const { container, input } = renderSheet();
    type(input, "이도");
    // Math.floor(200,000.5) = 200,000
    expect(flat(container)).toContain("정산액 200,000 / 300,000");
  });

  it("🔴 '단가 미지정' 경고도 같은 모수로 좁는다 — 1명 검색에 '미지정 1명'이 남으면 거짓말이다", () => {
    const { container, input } = renderSheet();
    expect(flat(container)).toContain("단가 미지정 1명");
    type(input, "이도"); // 미지정자(최유나)는 안 걸린다
    expect(flat(container)).not.toContain("단가 미지정");
    type(input, "최유"); // 미지정자만 걸린다
    expect(flat(container)).toContain("단가 미지정 1명");
  });

  it("공유 학생 표식도 검색 기준 — 안 걸리면 아예 사라진다", () => {
    const { container, input } = renderSheet();
    expect(flat(container)).toContain("공유 1");
    type(input, "이도");
    expect(flat(container)).not.toContain("공유 ");
  });

  it("걸린 학생이 정산 대상이 아니면 '—'로 둔다 — 0원을 지어내지 않는다", () => {
    const { container, input } = renderSheet();
    type(input, "없는이름");
    expect(flat(container)).toContain("정산액 — / 300,000");
  });

  it("반 머리행도 같은 규약 — `검색 1명 · 시수 3 / 4`", () => {
    const { container, input } = renderSheet();
    type(input, "이도");
    const t = flat(container);
    expect(t).toContain("검색 1명");
    expect(t).toContain("시수 3 / 4"); // 가반 = 이도윤 3 + 박서준 1
  });

  it("금액 열이 없는 강사 화면에서도 시수만 같은 규약으로 좁는다", () => {
    const { container, input } = renderSheet(null);
    type(input, "이도");
    const t = flat(container);
    expect(t).toContain("시수 3 / 5");
    expect(t).not.toContain("청구");
  });
});

describe("검색을 지우면 원래 표기 그대로 돌아온다", () => {
  it("라벨·칩·병기가 한 글자도 안 남는다", () => {
    const { container, input } = renderSheet();
    const before = flat(container);
    type(input, "이도");
    expect(flat(container)).not.toBe(before);
    type(input, "");
    expect(flat(container)).toBe(before);
  });
});
