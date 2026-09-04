/**
 * 좌석표 **학생 검색** — 이름을 치면 그 학생이 있는 반만 남는다(원장 2026-08-19).
 * 판정은 `student-search.ts` 한 곳이고, 여기서 보는 건 **화면이 그 판정을 어떻게 그리는가**다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OperationsProvider } from "@/features/owner/operations-context";
import type { LiveBoard, LiveBoardSlot } from "../types";
import { SeatingChart } from "./seating-chart";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/attendance/server/actions", () => ({
  setAttendanceCell: vi.fn(async () => ({ ok: true })),
}));
// 과목 필터는 계정에 저장한다 — 저장 왕복은 여기 관심사가 아니라 성공만 흉내 낸다.
const saveSubject = vi.fn(async (_subject: string) => ({ ok: true }));
vi.mock("@/features/attendance/live/server/prefs-actions", () => ({
  saveLiveSubjectFilter: (v: string) => saveSubject(v),
  loadLiveViewPrefs: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

afterEach(cleanup);

const student = (name: string) => ({
  studentId: name,
  studentName: name,
  schoolGrade: "경명여중2",
  parentPhone: null,
  studentPhone: null,
  status: null,
  note: null,
  signal: "unmarked" as const,
});

const slot = (over: Partial<LiveBoardSlot> & { classId: string; className: string }): LiveBoardSlot => ({
  key: `${over.classId}@16:20`,
  subject: "math",
  slotStart: "16:20",
  saveSlot: null,
  slotEnd: "17:20",
  periodLabel: null,
  teacherId: "t1",
  teacherName: "김강사",
  slotTeacherLabel: null,
  roomName: "601호",
  students: [],
  hasAnyRecord: false,
  recordedCount: 0,
  phase: "due",
  band: "now",
  ownedByMe: false,
  ...over,
});

/** '지금' 반 하나 + '곧 시작' 반 하나 — 뒤엣것은 평소 접힌 띠(`<details>`) 안에 들어간다. */
const BOARD: LiveBoard = {
  date: "2026-08-19",
  isToday: true,
  scopedToSelf: false,
  canEdit: true,
  totals: { expected: 3, recorded: 0, slots: 2 },
  teachers: [
    {
      teacherId: "t1",
      seatLabel: null, // 사람 줄(자리면 teacherId가 null이고 여기가 "LAB"·"JJ")
      teacherName: "김강사",
      teacherPhone: null,
      expected: 3,
      recorded: 0,
      slots: [
        slot({ classId: "c1", className: "가반", students: [student("이도윤"), student("박서준")] }),
        slot({
          classId: "c2",
          className: "나반",
          slotStart: "18:20",
          slotEnd: "19:20",
          band: "upcoming",
          phase: "before",
          roomName: "602호",
          students: [student("최유나")],
        }),
      ],
    },
  ],
};

const renderChart = () => {
  const view = render(<SeatingChart board={BOARD} />);
  // 입력칸은 토글(§10) 뒤에 있다 — 접혀 있으면 '검색'을 눌러 펼친다.
  if (!screen.queryByLabelText("학생 검색")) fireEvent.click(screen.getByRole("button", { name: "검색" }));
  return { ...view, input: screen.getByLabelText("학생 검색") as HTMLInputElement };
};
const type = (input: HTMLInputElement, v: string) => fireEvent.change(input, { target: { value: v } });

beforeEach(() => vi.clearAllMocks());

describe("좌석표 학생 검색", () => {
  it("검색하면 그 학생이 **있는 반 카드**만 남는다", () => {
    const { input } = renderChart();
    expect(screen.getByText("최유나")).toBeTruthy();
    type(input, "이도");
    expect(screen.getByText("가반")).toBeTruthy();
    expect(screen.queryByText("나반")).toBeNull();
    expect(screen.queryByText("최유나")).toBeNull();
  });

  it("🔴 카드 안 명단은 안 줄인다 — 줄이면 미입력이 남은 반이 '입력 완료'로 칠해진다", () => {
    const { input } = renderChart();
    type(input, "이도");
    // 같은 반 짝꿍은 그대로 있고(카드 = 그 반의 상태),
    expect(screen.getByText("박서준")).toBeTruthy();
    // 찾은 학생만 테두리로 짚는다(칸 색은 출결 상태 자리라 건드리지 않는다).
    // ⚠️ 기본 클래스에 `hover:ring-primary/40`이 있어 부분일치가 헛맞는다 — 강조 토큰 쌍으로 본다.
    expect(screen.getByText("이도윤").closest("button")!.className).toContain("ring-primary ring-2");
    expect(screen.getByText("박서준").closest("button")!.className).not.toContain("ring-primary ring-2");
  });

  it("🔴 검색 중엔 시간 띠로 접지 않는다 — 접힌 띠 안에 있으면 '검색했는데 없다'가 된다", () => {
    const { container, input } = renderChart();
    expect(container.querySelectorAll("details").length).toBeGreaterThan(0);
    type(input, "최유");
    expect(container.querySelectorAll("details")).toHaveLength(0);
    // '곧 시작' 띠 안에 있던 반이 그대로 펼쳐진 채 보인다.
    expect(screen.getByText("최유나")).toBeTruthy();
  });

  it("합계(미출결·입력)는 하루 전체 기준 그대로 두고 걸린 필터를 칩으로 밝힌다", () => {
    const { container, input } = renderChart();
    // 필터 전 머리줄 숫자 — 하루 전체 기준(대기 중인 '곧 시작' 반은 미출결로 안 센다).
    expect(container.textContent).toContain("미출결 2");
    expect(container.textContent).toContain("입력 0/3");
    type(input, "이도");
    // 🔴 좁힌 뒤에도 **같은 숫자**여야 한다 — 분모가 줄면 "오늘 얼마나 남았나"를 아무도 못 본다.
    expect(container.textContent).toContain("미출결 2");
    expect(container.textContent).toContain("입력 0/3");
    // 대신 걸린 필터를 크게 말한다(접히지 않는 칩). 단위는 좁히는 축과 같은 **반**이다.
    expect(container.textContent).toContain("검색 중 · 1/2개 반 표시");
    expect(container.textContent).toContain("위 합계는 하루 전체 기준");
  });

  it("0명이면 왜 비었는지 밝히고 되돌릴 버튼을 준다", () => {
    const { container, input } = renderChart();
    type(input, "없는이름");
    expect(container.textContent).toContain("‘없는이름’과 맞는 학생이 이 날 수업에 없습니다");
    fireEvent.click(screen.getByText("검색 지우기"));
    expect(screen.getByText("최유나")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("학교·학년으로도 찾힌다 — 그 칸에 함께 실리는 값이라", () => {
    const { container, input } = renderChart();
    type(input, "경명여중2");
    // 셋 다 같은 학교·학년이라 두 반 모두 남는다.
    expect(container.textContent).toContain("검색 중 · 2/2개 반 표시");
    expect(screen.getByText("최유나").closest("button")!.className).toContain("ring-primary ring-2");
  });
});

/**
 * 과목별 필터(원장 2026-08-20) — 좁히는 축은 학생 검색과 같은 **반 카드**다.
 * 🔴 카드 안 명단은 여기서도 안 줄인다(줄이면 미출결이 남은 반이 '입력 완료'로 칠해진다).
 */
describe("좌석표 과목 필터", () => {
  const MIXED: LiveBoard = {
    ...BOARD,
    teachers: [
      {
        ...BOARD.teachers[0]!,
        slots: [
          slot({ classId: "c1", className: "수학반", students: [student("이도윤"), student("박서준")] }),
          slot({
            classId: "c3",
            className: "영어반",
            subject: "english",
            students: [student("최유나")],
          }),
        ],
      },
    ],
  };

  const renderMixed = (initialSubject = "all") =>
    render(
      <OperationsProvider
        subjects={[
          { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
          { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
        ]}
        gradeLevels={["중2"]}
      >
        <SeatingChart board={MIXED} initialSubject={initialSubject} />
      </OperationsProvider>,
    );

  it("과목 드롭다운에서 고르면 그 과목 반 카드만 남는다", () => {
    renderMixed();
    expect(screen.getByText("영어반")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "과목 필터" }));
    fireEvent.click(screen.getByRole("button", { name: "수학" }));
    expect(screen.getByText("수학반")).toBeTruthy();
    expect(screen.queryByText("영어반")).toBeNull();
  });

  it("🔴 카드 안 명단은 안 줄인다 — 그 반 학생은 전부 그대로다", () => {
    renderMixed("math");
    expect(screen.getByText("이도윤")).toBeTruthy();
    expect(screen.getByText("박서준")).toBeTruthy();
  });

  it("합계(미출결·입력)는 하루 전체 기준 그대로 두고 좁힌 사실을 칩으로 밝힌다", () => {
    const { container } = renderMixed("math");
    // 전체 3명이 미출결인데 수학만 보고 있어도 머리줄 숫자는 안 줄어든다.
    expect(container.textContent).toContain("미출결");
    expect(container.textContent).toContain("수학만 보는 중 · 1/2개 반 표시");
    expect(container.textContent).toContain("위 합계는 하루 전체 기준");
  });

  it("고르면 계정에 저장한다(뷰 세팅은 계정 귀속)", () => {
    renderMixed();
    fireEvent.click(screen.getByRole("button", { name: "과목 필터" }));
    fireEvent.click(screen.getByRole("button", { name: "영어" }));
    expect(saveSubject).toHaveBeenCalledWith("english");
  });

  it("🔴 띠는 좁힌 집합에서 나눈다 — 전체 기준으로 나누면 모든 띠가 접힌 채 열린다", () => {
    // 수학은 '지금'에만, 영어는 '곧 시작'에만 있는 편성. 영어로 좁히면 '곧 시작' 띠가 **처음 열릴 띠**라
    // 펼쳐져 있어야 한다(전체 기준으로 나누면 firstBand가 '지금'이라 아무 띠도 안 열린다).
    const split: LiveBoard = {
      ...BOARD,
      teachers: [
        {
          ...BOARD.teachers[0]!,
          slots: [
            slot({ classId: "c1", className: "수학반", students: [student("이도윤")] }),
            slot({
              classId: "c3",
              className: "영어반",
              subject: "english",
              slotStart: "18:20",
              slotEnd: "19:20",
              band: "upcoming",
              phase: "before",
              students: [student("최유나")],
            }),
          ],
        },
      ],
    };
    const { container } = render(
      <OperationsProvider
        subjects={[
          { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
          { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
        ]}
        gradeLevels={["중2"]}
      >
        <SeatingChart board={split} initialSubject="english" />
      </OperationsProvider>,
    );
    // 🔑 `<details>`는 접혀 있어도 jsdom에선 자식이 남는다 — 그래서 **열림 속성**을 직접 본다
    //    (getByText로는 이 회귀를 못 잡는다).
    const bands = [...container.querySelectorAll("details")];
    expect(bands).toHaveLength(1); // 수학 '지금' 띠는 아예 안 그려진다
    expect(bands[0]!.textContent).toContain("곧 시작");
    expect(bands[0]!.hasAttribute("open")).toBe(true);
    expect(screen.getByText("영어반")).toBeTruthy();
    expect(screen.queryByText("수학반")).toBeNull();
  });

  it("그 과목에 수업이 없으면 왜 비었는지 밝히고 되돌릴 버튼을 준다", () => {
    const onlyMath: LiveBoard = {
      ...MIXED,
      teachers: [
        {
          ...MIXED.teachers[0]!,
          slots: [slot({ classId: "c1", className: "수학반", students: [student("이도윤")] })],
        },
      ],
    };
    const { container } = render(
      <OperationsProvider
        subjects={[
          { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
          { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
        ]}
        gradeLevels={["중2"]}
      >
        <SeatingChart board={onlyMath} initialSubject="english" />
      </OperationsProvider>,
    );
    expect(container.textContent).toContain("고른 과목에는 이 날 수업이 없습니다");
    fireEvent.click(screen.getByText("전체 보기"));
    expect(screen.getByText("수학반")).toBeTruthy();
  });
});
