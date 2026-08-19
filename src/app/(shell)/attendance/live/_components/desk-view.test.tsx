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
