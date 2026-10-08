import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LearningGoalRevisionDialog } from "./learning-goal-revision-dialog";
import { loadMathLearningGoalRevision, reviseMathLearningGoal } from "../server/learning-revision-actions";
import { curriculumForGradeSemester, flatLessons } from "@/features/onescreen/curriculum";
import { buildLearningProgress, planLearningGoal } from "../lib/learning-plan";

vi.mock("../server/learning-revision-actions", () => ({ loadMathLearningGoalRevision: vi.fn(), reviseMathLearningGoal: vi.fn() }));
afterEach(cleanup);
const onClose = vi.fn();
let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
  const semester = curriculumForGradeSemester("중1", 1).flatMap(unit => unit.lessons);
  const first = planLearningGoal({ studentId: "student", studyGrade: "중1", startBlock: semester[0], endBlock: semester.at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
  const goal = { ...planLearningGoal({ ...first, endBlock: flatLessons("중1").at(-1)! }, first), updatedAt: "version" };
  const context = { schedules: [{ dayOfWeek: "wed", startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null }], holidays: {}, spans: { student: [{ start: "2026-09-01", end: null }] } };
  const progress = buildLearningProgress(goal, context, [{ date: "2026-12-02", progress: flatLessons("중1")[semester.length + 1], textbook: null }], "2026-12-05");
  vi.mocked(loadMathLearningGoalRevision).mockResolvedValue({ ok: true, data: { goal, progress, context, today: "2026-12-05" } });
  vi.mocked(reviseMathLearningGoal).mockResolvedValue({ ok: true });
});
function open() { return render(<LearningGoalRevisionDialog classId="class" studentId="student" studentName="합성 학생" startDate="2026-09-01" track="regular" goalNumber={2} onClose={onClose} />); }

describe("목표 클릭 편집창", () => {
  it("선택한 목표를 바로 편집하고 지난 목표는 잠그며 날짜·분량·교재를 함께 저장한다", async () => {
    open();
    const date = await screen.findByLabelText("2차 목표 완료 예정일");
    expect(date).toHaveFocus();
    expect(screen.getByLabelText("1차 목표 완료 예정일")).toBeDisabled();
    fireEvent.change(date, { target: { value: "2027-01-31" } });
    fireEvent.change(screen.getByLabelText("2차 목표 구간 블록 수"), { target: { value: "6" } });
    fireEvent.change(screen.getByLabelText("수정 목표 교재"), { target: { value: "수정 교재" } });
    fireEvent.click(screen.getByRole("button", { name: "남은 계획 저장" }));
    await vi.waitFor(() => expect(reviseMathLearningGoal).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: "version", textbook: "수정 교재",
      milestones: [expect.objectContaining({ endDate: "2026-11-30", blockCount: 12 }), expect.objectContaining({ endDate: "2027-01-31", blockCount: 18 })] })));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled()); expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "화면 갱신 중…" })).toBeDisabled();
  });
  it("저장 오류 시 입력한 날짜를 보존하고 취소로 닫는다", async () => {
    vi.mocked(reviseMathLearningGoal).mockResolvedValue({ ok: false, error: "다른 곳에서 변경됨" });
    open(); const date = await screen.findByLabelText("2차 목표 완료 예정일");
    fireEvent.change(date, { target: { value: "2027-01-31" } }); fireEvent.click(screen.getByRole("button", { name: "남은 계획 저장" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("다른 곳에서 변경됨");
    expect(date).toHaveValue("2027-01-31"); expect(onClose).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "취소" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "취소" })); expect(onClose).toHaveBeenCalled();
  });
  it("조회 실패를 편집 가능한 빈 목표로 표시하지 않는다", async () => {
    vi.mocked(loadMathLearningGoalRevision).mockResolvedValue({ ok: false, error: "조회 실패" });
    open(); expect(await screen.findByRole("alert")).toHaveTextContent("조회 실패");
    expect(screen.queryByRole("button", { name: "남은 계획 저장" })).not.toBeInTheDocument();
  });
});
