/**
 * 데스크 확인 큐 **학생 검색** — 이름을 치면 그 학생 줄만 남는다(원장 2026-08-19).
 * 🔴 '미입력 반' 레인은 학생 이름이 없는 줄이라 검색 대상이 아니다 — **감췄다는 사실을 말하는지**가 핵심.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OperationsProvider } from "@/features/owner/operations-context";
import type { DeskQueue, QueueClass, QueueStudent } from "@/features/attendance/live/queue";
import { DeskView } from "./desk-view";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/attendance/live/server/actions", () => ({
  saveFollowup: vi.fn(),
  requestClassInput: vi.fn(),
}));
// 과목 필터는 계정에 저장한다 — 저장 왕복은 렌더 스모크의 관심사가 아니라 성공만 흉내 낸다.
const saveSubject = vi.fn(async (_subject: string) => ({ ok: true }));
vi.mock("@/features/attendance/live/server/prefs-actions", () => ({
  saveLiveSubjectFilter: (v: string) => saveSubject(v),
  loadLiveViewPrefs: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

afterEach(cleanup);

const student = (name: string, over: Partial<QueueStudent> = {}): QueueStudent => ({
  studentId: name,
  studentName: name,
  schoolGrade: "경명여중2",
  classId: "c1",
  className: "가반",
  subject: "math",
  slotStart: "16:20",
  saveSlot: null,
  teacherName: "김강사",
  signal: "absent",
  phase: "due",
  note: null,
  parentPhone: null,
  studentPhone: null,
  followup: null,
  ...over,
});

const klass: QueueClass = {
  classId: "c2",
  className: "나반",
  subject: "math",
  slotStart: "17:20",
  teacherId: "t1",
  teacherName: "김강사",
  teacherPhone: null,
  slotTeacherLabel: null,
  expected: 12,
  phase: "due",
  saveSlot: null,
  requested: false,
  slotCount: 1,
  slotEnd: "17:20",
};

const QUEUE: DeskQueue = {
  lanes: {
    classes: [klass],
    students: [student("이도윤"), student("박서준", { signal: "unmarked" })],
  },
  done: [student("최유나", { studentId: "최유나", followup: null })],
  counts: { classes: 1, students: 2, done: 1 },
};

function renderDesk() {
  const view = render(
    <OperationsProvider
      subjects={[{ key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 }]}
      gradeLevels={["중2"]}
    >
      <DeskView queue={QUEUE} date="2026-08-19" canEdit carryOver={null} />
    </OperationsProvider>,
  );
  // 입력칸은 토글(§10) 뒤에 있다 — 접혀 있으면 '검색'을 눌러 펼친다.
  if (!screen.queryByLabelText("학생 검색")) fireEvent.click(screen.getByRole("button", { name: "검색" }));
  return { ...view, input: screen.getByLabelText("학생 검색") as HTMLInputElement };
}
const type = (input: HTMLInputElement, v: string) => fireEvent.change(input, { target: { value: v } });

describe("데스크 큐 학생 검색", () => {
  it("이름을 치면 그 학생 줄만 남는다(처리함까지 같은 규칙)", () => {
    const { input } = renderDesk();
    expect(screen.getByText("박서준")).toBeTruthy();
    type(input, "이도");
    expect(screen.getByText("이도윤")).toBeTruthy();
    expect(screen.queryByText("박서준")).toBeNull();
    expect(screen.queryByText("최유나")).toBeNull();
  });

  it("🔴 학생 이름이 없는 '미입력 반' 줄은 감추되 **몇 건을 감췄는지 말한다**", () => {
    const { container, input } = renderDesk();
    expect(screen.getByText("나반")).toBeTruthy();
    type(input, "이도");
    expect(screen.queryByText("나반")).toBeNull();
    expect(container.textContent).toContain("미입력 반 1건은 학생 이름이 없어 검색에서 빠집니다");
  });

  it("걸린 필터를 칩으로 밝힌다 — 탭 배지(확인 N건)는 전체 기준이라", () => {
    const { container, input } = renderDesk();
    type(input, "이도");
    expect(container.textContent).toContain("검색 중 · 1/3건 표시");
    expect(container.textContent).toContain("탭의 확인 건수는 전체 기준");
  });

  it("0건이면 왜 비었는지 밝히고 되돌릴 버튼을 준다", () => {
    const { container, input } = renderDesk();
    type(input, "없는이름");
    expect(container.textContent).toContain("‘없는이름’과 맞는 학생이 이 날 확인 목록에 없습니다");
    fireEvent.click(screen.getByText("검색 지우기"));
    expect(screen.getByText("박서준")).toBeTruthy();
  });

  it("검색 중엔 '확인할 건이 없습니다' 빈 화면을 띄우지 않는다 — 필터 탓인데 큐가 빈 것처럼 읽힌다", () => {
    const { container, input } = renderDesk();
    type(input, "없는이름");
    expect(container.textContent).not.toContain("확인할 건이 없습니다");
  });
});

/**
 * 과목별 필터(원장 2026-08-20) — 이 화면은 이미 과목 섹션이라 **섹션 표시 여부**만 바뀐다.
 * 🔴 탭 배지(확인 N건)는 전체 기준 그대로다 — 좁힌 사실은 칩이 크게 말한다.
 */
describe("데스크 큐 과목 필터", () => {
  const MIXED: DeskQueue = {
    lanes: {
      classes: [],
      students: [
        student("수학생", { subject: "math", classId: "m1", className: "수학반" }),
        student("영어생", { subject: "english", classId: "e1", className: "영어반" }),
      ],
    },
    done: [],
    counts: { classes: 0, students: 2, done: 0 },
  };

  function renderMixed(initialSubject = "all") {
    return render(
      <OperationsProvider
        subjects={[
          { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu", testMax: 5 },
          { key: "english", label: "영어", color: "gold", weekdayGrouping: "mon-thu", testMax: 5 },
        ]}
        gradeLevels={["중2"]}
      >
        <DeskView queue={MIXED} date="2026-08-19" canEdit carryOver={null} initialSubject={initialSubject} />
      </OperationsProvider>,
    );
  }

  it("과목 드롭다운에서 고르면 그 과목 섹션만 남는다(선택지는 학원설정 단일 소스)", () => {
    renderMixed();
    expect(screen.getByText("수학생")).toBeTruthy();
    expect(screen.getByText("영어생")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "과목 필터" }));
    fireEvent.click(screen.getByRole("button", { name: "영어" }));
    expect(screen.queryByText("수학생")).toBeNull();
    expect(screen.getByText("영어생")).toBeTruthy();
  });

  it("계정에 저장된 과목으로 열린다 — 뷰 세팅은 계정 귀속", () => {
    renderMixed("math");
    expect(screen.getByText("수학생")).toBeTruthy();
    expect(screen.queryByText("영어생")).toBeNull();
    expect(screen.getByRole("button", { name: "과목 필터" }).textContent).toContain("과목: 수학");
  });

  it("🔴 설정에서 사라진 과목이 저장돼 있으면 전체로 되돌린다 — 빈 화면은 '출결이 사라졌다'로 읽힌다", () => {
    renderMixed("arts");
    expect(screen.getByText("수학생")).toBeTruthy();
    expect(screen.getByText("영어생")).toBeTruthy();
  });

  it("고르면 계정에 저장한다", () => {
    renderMixed();
    fireEvent.click(screen.getByRole("button", { name: "과목 필터" }));
    fireEvent.click(screen.getByRole("button", { name: "영어" }));
    expect(saveSubject).toHaveBeenCalledWith("english");
  });

  it("좁힌 사실을 칩으로 밝힌다(탭 배지는 전체 기준)", () => {
    const { container } = renderMixed("english");
    expect(container.textContent).toContain("영어만 보는 중");
    expect(container.textContent).toContain("탭의 확인 건수는 전체 기준");
  });
});
