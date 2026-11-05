import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { kstToday } from "@/lib/date-kst";

/**
 * 수강 배정 창의 **'반이동' 토글**(원장 2026-09-18) — 켜면 새 배정이 아니라 *옛 반 종료 + 새 반 시작*
 * 한 쌍을 만든다. 잘못 배선하면 **옛 반이 안 닫힌 이중 등록**이 되므로(이 토글이 막으려던 바로 그것)
 * "어떤 액션이 불렸나"를 행동 단위로 잠근다.
 */
const moveBatch = vi.fn();
const createEnrollment = vi.fn();
const listMovable = vi.fn();
const createBulk = vi.fn();
const listClassCandidates = vi.fn();
const listSourceClasses = vi.fn();
const listRoster = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({ labelOf: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k }),
}));
vi.mock("@/lib/ui/conflict-toast", () => ({ conflictToast: vi.fn() }));
vi.mock("@/features/billing/session-terms/plan-change-signal", () => ({
  notifyTermPlansChanged: vi.fn(),
}));
vi.mock("@/features/enrollments/server/actions", () => ({
  createEnrollment: (...a: unknown[]) => createEnrollment(...a),
  moveEnrollmentsBatch: (...a: unknown[]) => moveBatch(...a),
}));
vi.mock("@/features/enrollments/server/movable-actions", () => ({
  listMovableEnrollments: (...a: unknown[]) => listMovable(...a),
  listClassTransferCandidates: (...a: unknown[]) => listClassCandidates(...a),
}));
vi.mock("@/features/enrollments/server/bulk-assign-actions", () => ({
  createEnrollmentsBulk: (...a: unknown[]) => createBulk(...a),
}));
vi.mock("@/features/enrollments/server/transfer-source-actions", () => ({
  listTransferSourceClasses: (...a: unknown[]) => listSourceClasses(...a),
  listClassTransferRoster: (...a: unknown[]) => listRoster(...a),
}));

import { EnrollmentAssignDialog } from "./enrollment-assign-dialog";

const STUDENT = { id: "s-1", name: "김담희", grade: "고1" };
const CLASSES = [
  { id: "c-new", className: "고등M 고1 BS4F 수", subject: "math", teacherName: "이성우", studentCount: 5, days: ["mon", "thu"] },
  { id: "c-old", className: "주말내신특강(고1)", subject: "math", teacherName: "이성우", studentCount: 3 },
];
const MOVABLE = [
  {
    enrollmentId: "e-old",
    classId: "c-old",
    className: "주말내신특강(고1)",
    subject: "math",
    startDate: "2026-03-01",
    endDate: null,
    attendanceDays: null,
  },
];

function open() {
  return render(
    <EnrollmentAssignDialog
      open
      onClose={() => {}}
      mode="add-class-to-student"
      student={STUDENT}
      classes={CLASSES}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  moveBatch.mockResolvedValue({ results: [{ enrollmentId: "e-old", ok: true }] });
  listMovable.mockResolvedValue({ ok: true, items: MOVABLE });
  listSourceClasses.mockResolvedValue({ ok: true, items: [] });
  listRoster.mockResolvedValue({ ok: true, items: [] });
});

describe("수강 배정 창의 '반이동' 토글", () => {
  it("기존 반이동에서 같은 반 학생을 여러 명 고르고, 이동 중에는 닫기와 입력을 잠근다", async () => {
    const user = userEvent.setup();
    const snapshot = { studentId: "s-1", startDate: "2026-03-01", endDate: null, onHold: false, isTransferred: false, attendanceDays: [] };
    listClassCandidates.mockResolvedValue({ ok: true, classId: "c-old", className: "출발 반", items: [
      { id: "e-old", name: "김담희", grade: "고1", snapshot },
      { id: "e-two", name: "박둘째", grade: "고1", snapshot: { ...snapshot, studentId: "s-2" } },
      { id: "e-moved", name: "이예약", grade: "고1", snapshot: { ...snapshot, studentId: "s-3", isTransferred: true } },
    ] });
    let resolve!: (value: unknown) => void;
    moveBatch.mockReturnValue(new Promise((r) => { resolve = r; }));
    const view = open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await user.click(screen.getByText("반 선택..."));
    await user.click(screen.getByText("고등M 고1 BS4F 수"));
    await user.click(await screen.findByRole("button", { name: "단체 반 이동" }));
    expect(await screen.findByRole("checkbox", { name: /이예약/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "보이는 2명 모두 선택" }));
    await user.click(screen.getByRole("button", { name: "2명 반 이동" }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalledOnce());
    expect(moveBatch.mock.calls[0][0].map((m: { enrollmentId: string }) => m.enrollmentId)).toEqual(["e-old", "e-two"]);
    expect(moveBatch.mock.calls[0][2]).toBe("c-old");
    expect(screen.getByRole("button", { name: "닫기" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "반이동" })).toBeDisabled();
    resolve({ results: [{ enrollmentId: "e-old", ok: true }, { enrollmentId: "e-two", ok: false, error: "overlap" }] });
    await screen.findByText(/1명 이동 완료/);
    // 이동한 학생의 새 목적지가 배경의 '배정 후보'에서 빠지는 RSC 갱신을 재현한다.
    view.rerender(<EnrollmentAssignDialog open onClose={() => {}} mode="add-class-to-student" student={STUDENT} classes={[]} />);
    expect(screen.getByRole("button", { name: "고등M 고1 BS4F 수" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "목" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1명 반 이동" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /김담희/ })).toBeDisabled();
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it("평소엔 꺼져 있고 시작일·종료일이 보인다(종전 배정 그대로)", () => {
    open();
    expect(screen.getByRole("button", { name: "반이동" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("시작일")).toBeInTheDocument();
    expect(screen.queryByText("반이동 날짜")).not.toBeInTheDocument();
  });

  it("🔴 반 이동 권한(classes full)이 없으면 토글을 그리지 않는다 — 배정은 그대로 된다(원장 2026-11-05)", () => {
    render(
      <EnrollmentAssignDialog
        open
        onClose={() => {}}
        mode="add-class-to-student"
        student={STUDENT}
        classes={CLASSES}
        allowTransfer={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "반이동" })).not.toBeInTheDocument();
    expect(screen.getByText("시작일")).toBeInTheDocument();
    expect(listMovable).not.toHaveBeenCalled();
  });

  it("🔴 켜면 시작일·종료일 대신 '이동 날짜' 한 칸이다 — 두 날짜가 함께 있으면 무엇이 진짜인지 갈린다", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() => expect(listMovable).toHaveBeenCalledWith("s-1"));
    expect(screen.getByText("반이동 날짜")).toBeInTheDocument();
    expect(screen.queryByText("시작일")).not.toBeInTheDocument();
    expect(screen.queryByText("종료일 (선택)")).not.toBeInTheDocument();
  });

  it("🔴 후보가 하나뿐이면 골라 두고, '배정'은 createEnrollment가 아니라 반이동을 부른다", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() => expect(screen.getByText("반이동 날짜")).toBeInTheDocument());
    // 목적지 반을 고른다(반 선택 드롭다운).
    await user.click(screen.getByText("반 선택..."));
    await user.click(screen.getByText("고등M 고1 BS4F 수"));
    await user.click(screen.getByRole("button", { name: /배정/ }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalledTimes(1));
    const [moves, effective] = moveBatch.mock.calls[0]!;
    expect(moves).toEqual([
      { enrollmentId: "e-old", newClassId: "c-new", attendanceDays: [] },
    ]);
    // 기본 적용일 = 내일(학생 상세 '반 이동' 창과 같은 기본값) → 오늘보다 뒤.
    expect(effective > new Date().toISOString().slice(0, 10)).toBe(true);
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it("🔴 분리등원을 좁히지 않았으면 빈 배열을 넘겨 옛 수강의 등원 요일을 승계한다", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() => expect(screen.getByText("반이동 날짜")).toBeInTheDocument());
    await user.click(screen.getByText("반 선택..."));
    await user.click(screen.getByText("고등M 고1 BS4F 수"));
    // 목적지 반 요일 칩이 떠 있지만 손대지 않는다 → 승계.
    await user.click(screen.getByRole("button", { name: /배정/ }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalled());
    expect(moveBatch.mock.calls[0]![0][0].attendanceDays).toEqual([]);
  });

  it("사람이 요일을 좁히면 그 요일만 명시한다", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() => expect(screen.getByText("반이동 날짜")).toBeInTheDocument());
    await user.click(screen.getByText("반 선택..."));
    await user.click(screen.getByText("고등M 고1 BS4F 수"));
    await user.click(screen.getByRole("button", { name: "월" })); // 월 해제 → 목만
    await user.click(screen.getByRole("button", { name: /배정/ }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalled());
    expect(moveBatch.mock.calls[0]![0][0].attendanceDays).toEqual(["thu"]);
  });

  it("🔴 옮길 기존 수업이 없으면 이유를 말하고 배정을 잠근다(조용한 무반응 금지)", async () => {
    listMovable.mockResolvedValue({ ok: true, items: [] });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() =>
      expect(screen.getByText(/옮길 수 있는 기존 수업이 없습니다/)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /배정/ })).toBeDisabled();
  });

  it("🔴 목적지와 같은 반은 출발지 후보에서 뺀다 — 자기 반으로의 이동은 이동이 아니다", async () => {
    listMovable.mockResolvedValue({
      ok: true,
      items: [MOVABLE[0]!, { ...MOVABLE[0]!, enrollmentId: "e-same", classId: "c-new", className: "고등M 고1 BS4F 수" }],
    });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByText("반 선택..."));
    await user.click(screen.getByText("고등M 고1 BS4F 수"));
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() => expect(screen.getByText("반이동 날짜")).toBeInTheDocument());
    // 목적지(c-new)를 뺀 뒤 후보가 하나뿐이라 자동으로 골라진다 → 그 하나가 **옛 반**이어야 한다.
    await user.click(screen.getByRole("button", { name: /배정/ }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalled());
    expect(moveBatch.mock.calls[0]![0][0].enrollmentId).toBe("e-old");
  });

  it("실패는 성공처럼 닫지 않고 사유를 적는다", async () => {
    moveBatch.mockResolvedValue({ results: [{ enrollmentId: "e-old", ok: false, error: "시간이 겹칩니다" }] });
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await waitFor(() => expect(screen.getByText("반이동 날짜")).toBeInTheDocument());
    await user.click(screen.getByText("반 선택..."));
    await user.click(screen.getByText("고등M 고1 BS4F 수"));
    await user.click(screen.getByRole("button", { name: /배정/ }));
    await waitFor(() => expect(screen.getByText("시간이 겹칩니다")).toBeInTheDocument());
  });
});

/**
 * 반 상세(반 → 학생)의 반이동 = **옮겨 올 반을 먼저, 그 반 명단에서 학생을 그다음**(원장 2026-10-01
 * *"반이동시에 학생이름을 먼저 고르지 않고 반을 골라서 할 수 있게 먼저 하는게 나을듯. 순서상으로도."*).
 * 🔴 저장 계약은 그대로다 — 고른 학생의 출발 반 수강 id가 종전처럼 `moveEnrollmentsBatch(moves, 이동일)`로 간다.
 */
describe("반 상세 반이동 — 반을 먼저, 학생은 그 반 명단에서", () => {
  const today = kstToday();
  const plus = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const SNAP = { startDate: "2026-03-01", endDate: null as string | null, onHold: false, isTransferred: false, attendanceDays: [] as string[] };
  const row = (id: string, studentId: string, name: string, extra: Partial<typeof SNAP> = {}) => ({
    id, name, grade: "고1", school: "경명여고", snapshot: { ...SNAP, studentId, ...extra },
  });
  // 배정 후보 = 이 반에 아직 없는 재원생(반 상세 page.tsx가 거른 그대로). s-in은 이미 이 반에 있어 빠져 있다.
  const PEOPLE = [
    { id: "s-a", name: "가학생", grade: "고1" },
    { id: "s-b", name: "나학생", grade: "고1" },
    { id: "s-c", name: "다학생", grade: "고1" },
    { id: "s-late", name: "라학생", grade: "고1" },
  ];
  const SOURCES = [
    { id: "c-a", className: "출발 A반", subject: "math", teacherName: "이성우" },
    { id: "c-b", className: "출발 B반", subject: "math", teacherName: "박강사" },
  ];
  const ROSTERS: Record<string, unknown[]> = {
    "c-a": [
      row("e-a", "s-a", "가학생"),
      row("e-b", "s-b", "나학생"),
      row("e-in", "s-in", "이미있음"),
      row("e-res", "s-c", "다학생", { isTransferred: true, endDate: plus(30) }),
      row("e-late", "s-late", "라학생", { startDate: plus(5) }),
    ],
    "c-b": [row("e-c", "s-c", "다학생")],
  };
  function openClassTransfer(people = PEOPLE) {
    return render(
      <EnrollmentAssignDialog open onClose={() => {}} mode="add-student-to-class" fixedClass={CLASSES[0]} studentOptions={people} />,
    );
  }
  async function pickSource(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await screen.findByText("기존 반 선택..."));
    await user.click(screen.getByText(name));
  }

  beforeEach(() => {
    listSourceClasses.mockResolvedValue({ ok: true, items: SOURCES });
    listRoster.mockImplementation(async (id: string) => ({ ok: true, items: ROSTERS[id] ?? [] }));
  });

  it("반을 고르기 전엔 학생을 못 고른다 — '어느 반에서 옮기나요'가 학생 칸보다 위에 선다", async () => {
    const user = userEvent.setup();
    openClassTransfer();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await screen.findByText("기존 반 선택...");
    expect(listSourceClasses).toHaveBeenCalledWith("c-new");
    const classLabel = screen.getByText("어느 반에서 옮기나요");
    const studentLabel = screen.getByText("학생 선택");
    expect(classLabel.compareDocumentPosition(studentLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "먼저 반을 선택해 주세요." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "배정" })).toBeDisabled();
    // 학생 기준 조회(종전 흐름)도, 명단 조회도 아직 안 나간다.
    expect(listMovable).not.toHaveBeenCalled();
    expect(listRoster).not.toHaveBeenCalled();
  });

  it("고른 반의 학생만 나온다 — 이미 이 반에 있는 학생·반이동 예약·이동일 뒤 시작은 빠지고, 저장은 종전 계약 그대로", async () => {
    const user = userEvent.setup();
    openClassTransfer();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await pickSource(user, "출발 A반");
    expect(listRoster).toHaveBeenCalledWith("c-a");
    await user.click(await screen.findByText("학생 선택..."));
    const list = screen.getByRole("list");
    expect(within(list).getByText("가학생")).toBeInTheDocument();
    expect(within(list).getByText("나학생")).toBeInTheDocument();
    expect(within(list).queryByText("다학생")).toBeNull(); // B반 학생 + A반의 예약된 이동
    expect(within(list).queryByText("이미있음")).toBeNull();
    expect(within(list).queryByText("라학생")).toBeNull();
    expect(
      screen.getByText(/반이동이 이미 걸린 1명 · 이 반에 이미 있거나 배정할 수 없는 1명 · 이동일 뒤에 수업을 시작하는 1명은 목록에서 뺐습니다/),
    ).toBeInTheDocument();
    await user.click(within(list).getByText("나학생"));
    // 출발지가 정해지면 같은 반 단체 이동 입구도 종전처럼 선다.
    expect(screen.getByRole("button", { name: "단체 반 이동" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "배정" }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalledTimes(1));
    expect(moveBatch.mock.calls[0]).toEqual([[{ enrollmentId: "e-b", newClassId: "c-new", attendanceDays: [] }], plus(1)]);
    expect(createEnrollment).not.toHaveBeenCalled();
  });

  it("반이동 날짜를 바꾸면 그날 명단으로 다시 계산한다(그날부터 다니는 학생이 들어온다)", async () => {
    const user = userEvent.setup();
    openClassTransfer();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await pickSource(user, "출발 A반");
    await screen.findByText("학생 선택...");
    fireEvent.change(screen.getByDisplayValue(plus(1)), { target: { value: plus(5) } });
    await user.click(screen.getByText("학생 선택..."));
    expect(within(screen.getByRole("list")).getByText("라학생")).toBeInTheDocument();
  });

  it("🔴 단체 반 이동이 일부 성공한 뒤 화면이 갱신돼(배정 후보에서 그 학생이 빠져도) 결과와 잠금이 남는다", async () => {
    const snapshot = { ...SNAP, studentId: "s-b" };
    listClassCandidates.mockResolvedValue({ ok: true, classId: "c-a", className: "출발 A반", items: [
      { id: "e-b", name: "나학생", grade: "고1", snapshot },
      { id: "e-a", name: "가학생", grade: "고1", snapshot: { ...snapshot, studentId: "s-a" } },
    ] });
    moveBatch.mockResolvedValue({ results: [{ enrollmentId: "e-b", ok: true }, { enrollmentId: "e-a", ok: false, error: "overlap" }] });
    const user = userEvent.setup();
    const view = openClassTransfer();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await pickSource(user, "출발 A반");
    await user.click(await screen.findByText("학생 선택..."));
    await user.click(within(screen.getByRole("list")).getByText("나학생"));
    await user.click(screen.getByRole("button", { name: "단체 반 이동" }));
    expect(listClassCandidates).toHaveBeenCalledWith("e-b");
    await user.click(await screen.findByRole("button", { name: "보이는 2명 모두 선택" }));
    await user.click(screen.getByRole("button", { name: "2명 반 이동" }));
    await screen.findByText(/1명 이동 완료/);
    expect(moveBatch.mock.calls[0][2]).toBe("c-a");
    // 이동한 나학생이 배경 RSC 갱신으로 이 반의 배정 후보에서 빠진다.
    view.rerender(
      <EnrollmentAssignDialog
        open
        onClose={() => {}}
        mode="add-student-to-class"
        fixedClass={CLASSES[0]}
        studentOptions={PEOPLE.filter((p) => p.id !== "s-b")}
      />,
    );
    expect(screen.getByText(/1명 이동 완료 · 1명 확인 필요/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "반이동" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "나학생" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "1명 반 이동" })).toBeEnabled();
  });

  it("이동일을 바꿔 고른 학생이 그날 명단에서 빠지면, 이름은 남기고 한 명 이동만 막는다", async () => {
    const user = userEvent.setup();
    openClassTransfer();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await pickSource(user, "출발 A반");
    fireEvent.change(screen.getByDisplayValue(plus(1)), { target: { value: plus(5) } });
    await user.click(await screen.findByText("학생 선택..."));
    await user.click(within(screen.getByRole("list")).getByText("라학생"));
    expect(screen.getByRole("button", { name: "배정" })).toBeEnabled();
    fireEvent.change(screen.getByDisplayValue(plus(5)), { target: { value: plus(1) } });
    expect(screen.getByRole("button", { name: "라학생" })).toBeInTheDocument();
    expect(screen.getByText(/라학생 학생은/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "배정" })).toBeDisabled();
    // 목록에 이름을 남긴 학생을 '뺐다'고 세지 않는다.
    expect(screen.getByText(/목록에서 뺐습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/이동일 뒤에 수업을 시작하는/)).toBeNull();
  });

  it("🔴 반을 빠르게 바꿔도 앞 반의 늦은 명단이 화면을 덮지 않는다(남의 수강으로 이동 금지)", async () => {
    let resolveA!: (v: unknown) => void;
    listRoster.mockImplementation((id: string) =>
      id === "c-a" ? new Promise((r) => (resolveA = r)) : Promise.resolve({ ok: true, items: ROSTERS[id] }),
    );
    const user = userEvent.setup();
    openClassTransfer();
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await pickSource(user, "출발 A반");
    await user.click(screen.getByText("출발 A반")); // 다시 열고
    await user.click(screen.getByText("출발 B반")); // B로 바꾼다
    await user.click(await screen.findByText("학생 선택..."));
    await user.click(within(screen.getByRole("list")).getByText("다학생"));
    // 이제서야 A의 늦은 응답이 도착한다.
    await act(async () => resolveA({ ok: true, items: ROSTERS["c-a"] }));
    expect(screen.getByRole("button", { name: "다학생" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "배정" }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalled());
    expect(moveBatch.mock.calls[0]![0][0].enrollmentId).toBe("e-c");
  });
});

/**
 * **단체 배정 모드**(원장 2026-09-18 *"수업에서 원생 배정할떄는 단체 배정 가능하게"*) — 반 상세에서만 선다.
 * 🔴 잘못 배선하면 한 명용 `createEnrollment`가 돌아 첫 학생만 들어가거나, 반이동과 섞여 이중 등록이 된다.
 */
describe("수강 배정 창의 '단체 배정' 모드", () => {
  const PEOPLE = [
    { id: "s-a", name: "가학생", grade: "고1", school: "경명여고" },
    { id: "s-b", name: "나학생", grade: "고1", school: "대구고" },
    { id: "s-c", name: "다학생", grade: "중3", school: "경명여중" },
  ];
  function openClass(onClose: (assigned: boolean) => void = () => {}) {
    return render(
      <EnrollmentAssignDialog
        open
        onClose={onClose}
        mode="add-student-to-class"
        fixedClass={CLASSES[0]}
        studentOptions={PEOPLE}
      />,
    );
  }

  it("🔴 원생 상세(학생 → 반)엔 단체 배정 토글이 없다", () => {
    open();
    expect(screen.queryByRole("button", { name: "단체 배정" })).toBeNull();
  });

  it("켜면 체크 목록이 되고, 학년으로 좁혀 모두 고른 뒤 한 번에 배정한다(한 명용 액션은 안 탄다)", async () => {
    createBulk.mockResolvedValue({
      results: [
        { studentId: "s-a", ok: true, enrollmentId: "e-1" },
        { studentId: "s-b", ok: true, enrollmentId: "e-2" },
      ],
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    openClass(onClose);
    await user.click(screen.getByRole("button", { name: "단체 배정" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(3);
    await user.type(screen.getByRole("searchbox"), "고1");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "보이는 2명 모두 선택" }));
    await user.click(screen.getByRole("button", { name: "2명 배정" }));
    await waitFor(() => expect(createBulk).toHaveBeenCalledTimes(1));
    const arg = createBulk.mock.calls[0]![0];
    expect(arg.classId).toBe("c-new");
    expect(arg.studentIds).toEqual(["s-a", "s-b"]);
    expect(arg.endDate).toBeNull();
    // 반 전 요일(월·목) 그대로 — 서버가 '전 요일'로 정리한다.
    expect(arg.attendanceDays).toEqual(["mon", "thu"]);
    expect(createEnrollment).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it("🔴 일부가 막히면 닫지 않고, 막힌 학생과 이유를 적고, 그 학생만 선택에 남긴다", async () => {
    createBulk.mockResolvedValue({
      results: [
        { studentId: "s-a", ok: true, enrollmentId: "e-1" },
        { studentId: "s-b", ok: false, error: "휴원 중인 학생은 배정할 수 없습니다" },
      ],
    });
    const onClose = vi.fn();
    const user = userEvent.setup();
    openClass(onClose);
    await user.click(screen.getByRole("button", { name: "단체 배정" }));
    await user.click(screen.getByRole("checkbox", { name: /가학생/ }));
    await user.click(screen.getByRole("checkbox", { name: /나학생/ }));
    await user.click(screen.getByRole("button", { name: "2명 배정" }));
    await waitFor(() => expect(screen.getByText(/1명은 배정하지 못했습니다/)).toBeInTheDocument());
    expect(screen.getByText(/1명은 배정했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/휴원 중인 학생은 배정할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1명 배정" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("🔴 반이동을 켜면 단체 배정이 꺼진다 — 둘은 함께 설 수 없다", async () => {
    const user = userEvent.setup();
    openClass();
    await user.click(screen.getByRole("button", { name: "단체 배정" }));
    expect(screen.getByRole("button", { name: "단체 배정" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "반이동" }));
    expect(screen.getByRole("button", { name: "단체 배정" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
