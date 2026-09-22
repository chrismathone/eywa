import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

  it("🔴 반 상세에서 학생을 빠르게 바꿔도 **앞 학생의 수강**으로 이동하지 않는다(응답 순서 뒤집힘)", async () => {
    // A의 조회가 늦게, B의 조회가 먼저 돌아온다 → 늦게 온 A 목록이 B 화면에 서면 A가 옮겨진다.
    let resolveA!: (v: unknown) => void;
    listMovable.mockImplementation((id: string) =>
      id === "s-a"
        ? new Promise((r) => (resolveA = r))
        : Promise.resolve({ ok: true, items: [{ ...MOVABLE[0]!, enrollmentId: "e-b" }] }),
    );
    const user = userEvent.setup();
    render(
      <EnrollmentAssignDialog
        open
        onClose={() => {}}
        mode="add-student-to-class"
        fixedClass={CLASSES[0]}
        studentOptions={[
          { id: "s-a", name: "가학생", grade: "고1" },
          { id: "s-b", name: "나학생", grade: "고1" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "반이동" }));
    await user.click(screen.getByText("학생 선택..."));
    await user.click(screen.getByText("가학생"));
    await user.click(screen.getByText("가학생"));
    await user.click(screen.getByText("나학생"));
    await waitFor(() => expect(listMovable).toHaveBeenCalledWith("s-b"));
    // 이제서야 A의 늦은 응답이 도착한다.
    resolveA({ ok: true, items: [{ ...MOVABLE[0]!, enrollmentId: "e-a" }] });
    await user.click(screen.getByRole("button", { name: "배정" }));
    await waitFor(() => expect(moveBatch).toHaveBeenCalled());
    expect(moveBatch.mock.calls[0]![0][0].enrollmentId).toBe("e-b");
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
