import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { LearningOverview } from "./learning-overview";
import { learningMapFixture } from "@/features/math-progress-map/learning-map.test-fixture";
import type { MathSheetMonthData, MathStudentRow } from "../server/month-queries";
import type { LearningData } from "../lib/learning-plan";
import { learningRailMetrics } from "../lib/learning-axis";
import { buildStudentBasics } from "../lib/student-basics";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// Next의 App Router 번들러가 사용하는 동적 로더를 테스트에서도 사용한다.
vi.mock("next/dynamic", async () => ({ default: (await import("next/dist/shared/lib/app-dynamic")).default }));
vi.mock("../server/actions", () => ({ setMyMcsFontSize: vi.fn() }));
vi.mock("../server/learning-actions", () => ({ setMathClassLearningTrack: vi.fn() }));
vi.mock("./learning-goal-dialog", () => ({ LearningGoalDialog: ({ studentId, canReset }: { studentId: string; canReset: boolean }) => <div role="dialog">{studentId} · {canReset ? "초기화 가능" : "초기화 불가"}</div> }));
vi.mock("@/features/class-sheets/components/sheet-chrome", () => ({ SheetClassPicker: () => null, SheetBarDivider: () => null }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));

function fixture() {
  const f = learningMapFixture();
  const first: MathStudentRow = { ...f.student, cells: {}, records: { "2026-09-14": { textbook: "교재", progress: "내신대비", homework: "오답 정리", dailyTest: "18/20", checkTest: null, examInfo: null, homeworkScore: null, offGoal: false } }, stalledDates: [], rail: null, rosterPhase: "on", badges: [] };
  const second: MathStudentRow = { ...first, studentId: "second", name: "다른 학생", records: {} };
  const data = { classId: f.classId, className: f.className, month: f.month, monthLabel: "2026년 9월", today: "2026-09-18", teacherName: "담임", fontSize: "sm", canEdit: true,
    students: [first, second], goals: { [first.studentId]: { textbook: "기존 교재", targetProgress: "기존 월 목표" } }, days: [], learningContext: f.context } as unknown as MathSheetMonthData;
  const learning: LearningData = { context: f.context, status: "ok", referenceDate: "2026-09-18", track: "regular", goals: { [first.studentId]: f.goal }, progress: { [first.studentId]: f.progress }, records: { [first.studentId]: [...f.records].reverse(), second: [{ date: "2026-09-10", progress: "다각형", textbook: "다른 교재" }] } };
  return { f, data, learning, first, second };
}
// 실제 동적 청크의 첫 변환 시간은 사용자 동작 대기 시간에 포함하지 않는다.
beforeAll(async () => { await import("@/features/math-progress-map/components/linked-learning-map"); }, 60000);
beforeEach(() => window.history.replaceState(null, "", "/mcs/test/month?month=2026-09&embed=1"));
afterEach(cleanup);

describe("학생 집중 보기의 진도맵 통합", { timeout: 15000 }, () => {
  it("반 전체 카드와 학생 상세에서 수강정보를 유지하고 학생을 바꾸면 함께 전환한다", async () => {
    const { data, learning, first, second } = fixture();
    first.basicInfo = buildStudentBasics(["english", "math"].map(subject => ({ subject: subject as "english" | "math", startDate: "2026-03-01", endDate: null,
      isTransferred: false, onHold: false, classActive: true, closedAt: null, teacherAssigned: true, teacherName: subject === "english" ? "영어 테스트 담임" : "수학 테스트 담임" })), "2026-11-02");
    second.basicInfo = buildStudentBasics([], "2026-11-02");
    render(<LearningOverview data={data} learning={learning} classOptions={[]} />);
    expect(screen.getByRole("region", { name: `${first.name} 수강 기본정보` })).toHaveTextContent("영어·수학 동시수강");
    fireEvent.click(screen.getByRole("button", { name: first.name }));
    await screen.findByLabelText("전체 진도율");
    expect(screen.getByRole("region", { name: `${first.name} 수강 기본정보` })).toHaveTextContent("영어 테스트 담임");
    expect(screen.getByRole("region", { name: `${first.name} 수강 기본정보` })).toHaveTextContent("2026.11.02 기준");
    fireEvent.click(within(screen.getByRole("complementary", { name: "학생 선택" })).getByRole("button", { name: new RegExp(second.name) }));
    expect(screen.getByRole("region", { name: `${second.name} 수강 기본정보` })).toHaveTextContent("현재 수강 없음");
    expect(screen.queryByText("영어 테스트 담임")).not.toBeInTheDocument();
  });
  it("저장 시각이 다른 동일 목표는 공통 요약을 유지하고 실제 내용 차이만 개별로 표시한다", () => {
    const { data, learning, first, second, f } = fixture();
    const goals = { [first.studentId]: { ...f.goal, updatedAt: "first" }, [second.studentId]: { ...f.goal, studentId: second.studentId, updatedAt: "second" } };
    const view = render(<LearningOverview data={data} learning={{ ...learning, goals }} classOptions={[]} />);
    expect(screen.queryByText("학생별 목표")).not.toBeInTheDocument();
    expect(screen.getByText(`${f.goal.startDate} – ${f.goal.endDate}`)).toBeVisible();
    view.rerender(<LearningOverview data={data} learning={{ ...learning, goals: { ...goals, [second.studentId]: { ...goals[second.studentId], textbook: "다른 교재" } } }} classOptions={[]} />);
    expect(screen.getByText("학생별 목표")).toBeVisible();
    expect(screen.queryByText(`${f.goal.startDate} – ${f.goal.endDate}`)).not.toBeInTheDocument();
  });
  it.each(["regular", "supplement"] as const)("%s의 반 전체·학생 목록·집중 보기 지표는 같은 눈금을 사용한다", async track => {
    const { data, learning, first, f } = fixture();
    learning.track = track;
    learning.goals[first.studentId] = { ...f.goal, track };
    const metric = learningRailMetrics(learning.goals[first.studentId], f.progress);
    const view = render(<LearningOverview data={data} learning={learning} classOptions={[]} />);
    // 학생 계획 카드(2026-10-20) — 전체 목표 구역이 같은 눈금의 숫자를 쓴다.
    const card = view.container.querySelector("article")!;
    expect(card).toHaveTextContent(`${metric.current}/${metric.total}차시 · ${metric.percent}% · ${Math.max(0, metric.total - metric.current!)}차시 남음`);
    expect(card).toHaveTextContent(`남은 수업${metric.remainingDays}회`);
    fireEvent.click(screen.getByRole("button", { name: first.name }));
    expect(await screen.findByLabelText("전체 진도율")).toHaveTextContent(`${metric.percent}%${metric.current} / ${metric.total}차시`);
    expect(within(screen.getByRole("complementary", { name: "학생 선택" })).getByRole("button", { name: new RegExp(first.name) })).toHaveTextContent(`${metric.percent}%`);
  });
  it("학생 행에서 세 지도를 열고 목표 편집·기존 월 목표·블록 계획·시험 결과를 유지한다", async () => {
    const { data, learning, first } = fixture();
    render(<LearningOverview data={data} learning={learning} classOptions={[]} canResetGoals />);
    fireEvent.click(screen.getByRole("button", { name: first.name }));
    expect(await screen.findByRole("button", { name: "단계별 지도" }, { timeout: 10000 })).toBeVisible();
    for (const name of ["연간 지도", "연속 지도", "단계별 지도"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%59 / 155차시");
    }
    expect(screen.queryByRole("link", { name: "MCS로 돌아가기" })).not.toBeInTheDocument();
    expect(screen.getByText("블록별 계획과 일간 목표")).toBeInTheDocument();
    expect(screen.getByText("2026년 9월 기존 월간 목표")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("진도맵 날짜"), { target: { value: "2026-09-14" } });
    expect(screen.getByText("일일 18/20")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "목표 확장" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(first.studentId + " · 초기화 가능");
  });
  it("다른 학생과 목표 없는 학생으로 전환할 때 선택 차시·보고서가 섞이지 않으며 뒤로 가기로 복원한다", async () => {
    const { data, learning, first, second } = fixture();
    const query = `month=2026-09&student=${first.studentId}&date=2026-08-27&view=day&topic=${encodeURIComponent("중2:직각삼각형의 합동")}&embed=1`;
    window.history.replaceState(null, "", `/mcs/test/month?${query}`);
    render(<LearningOverview data={data} learning={learning} classOptions={[]} initialStudentId={first.studentId} initialQuery={query} />);
    await screen.findByRole("button", { name: "단계별 지도" }, { timeout: 10000 });
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    fireEvent.click(within(screen.getByRole("complementary", { name: "학생 선택" })).getByRole("button", { name: new RegExp(first.name) }));
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    expect(window.location.search).toContain("topic=");
    fireEvent.click(within(screen.getByRole("complementary", { name: "학생 선택" })).getByRole("button", { name: new RegExp(second.name) }));
    expect(screen.queryByLabelText("전체 진도율")).not.toBeInTheDocument();
    expect(screen.getByText("전체 학습 목표를 설정해 주세요.")).toBeVisible();
    expect(screen.getByText("다른 교재")).toBeVisible();
    expect(screen.queryByText("2026-08-27")).not.toBeInTheDocument();
    expect(window.location.search).toContain("embed=1");
    expect(window.location.search).not.toContain("topic=");
    act(() => { window.history.replaceState(null, "", `/mcs/test/month?${query}`); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(await screen.findByRole("button", { name: "단계별 지도" })).toBeVisible();
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    expect(screen.queryByText("다른 교재")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "‹ 반 전체 진도" }));
    expect(screen.queryByLabelText("진도맵 날짜")).not.toBeInTheDocument();
    expect(window.location.search).not.toContain("student=");
  });
  it("읽기 전용에서는 목표 편집을 열 수 없다", async () => {
    const { data, learning, first } = fixture();
    render(<LearningOverview data={{ ...data, canEdit: false }} learning={learning} classOptions={[]} initialStudentId={first.studentId} />);
    await screen.findByRole("button", { name: "단계별 지도" });
    expect(screen.queryByRole("button", { name: "목표 확장" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "전체 목표 설정" })).not.toBeInTheDocument();
  });
  it("보고서 조회 실패를 전체 0건으로 표시하지 않는다", () => {
    const { data, learning, first } = fixture();
    render(<LearningOverview data={data} learning={{ ...learning, status: "failed", goals: {}, progress: {}, records: {} }} classOptions={[]} initialStudentId={first.studentId} />);
    expect(screen.queryByText(/발송 수업보고서 전체 0건/)).not.toBeInTheDocument();
    expect(screen.queryByText("전체 학습 목표를 설정해 주세요.")).not.toBeInTheDocument();
    expect(screen.getByText("목표 또는 수업보고서를 불러오지 못했습니다. 새로고침해 주세요.")).toBeVisible();
  });
});
