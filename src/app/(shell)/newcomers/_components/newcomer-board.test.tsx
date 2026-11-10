import { act, cleanup, fireEvent, render as renderUI, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from "react";
import { OperationsProvider } from "@/features/owner/operations-context";
import { NewcomerBoard } from "./newcomer-board";
import { TEST_TODAY, testView } from "@/features/newcomers/board-fixtures.test-support";
import { EMPTY_FILTERS, boardStats, withCheckPatches } from "@/features/newcomers/board-model";

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/newcomers/server/actions", () => ({ setOnboardingCheck: mocks.save }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));

const task = (key = "student-a|math|pre_call") => document.querySelector<HTMLButtonElement>(`[data-task-key="${key}"]`)!;
const completion={action:"학부모 적응 전화",result:"수업 적응 확인 완료",next:"다음 주 재확인"};
const submitCompletion=()=>{for(const [label,key] of [["실행한 액션","action"],["처리 결과","result"],["다음 조치·기한 (선택)","next"]])fireEvent.change(screen.getByLabelText(label),{target:{value:completion[key as keyof typeof completion]}});fireEvent.click(screen.getByRole("button",{name:"액션·결과 저장 후 완료"}));};
const metric = (label: string) => document.querySelector(`[data-metric="${label}"]`)!;
const rowKeys = () => Array.from(document.querySelectorAll("tbody tr")).map(el => el.getAttribute("data-row-key"));
const render = (ui: ReactElement) => renderUI(ui, { wrapper: ({ children }: { children: ReactNode }) => <OperationsProvider subjects={[{ key: "math", label: "수학", color: "primary", weekdayGrouping: "none", testMax: 100 }, { key: "english", label: "영어", color: "primary", weekdayGrouping: "none", testMax: 100 }]} gradeLevels={[]}>{children}</OperationsProvider> });

beforeEach(() => { mocks.save.mockReset(); mocks.refresh.mockReset(); mocks.save.mockResolvedValue({ ok: true }); window.history.replaceState(null, "", "/newcomers?embed=1"); });
afterEach(cleanup);

describe("실제 신규생 보드 상호작용", () => {
  it("원래 7단계·등록/첫수업 날짜·과목별 행과 이름 링크를 보존한다", () => {
    render(<NewcomerBoard view={testView()} canWrite />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(12);
    expect(screen.getByRole("columnheader", { name: /2개월 콜 선택/ })).toBeInTheDocument();
    expect(screen.getAllByText("26.09.10")).toHaveLength(3);
    expect(screen.getAllByText("D+5").length).toBeGreaterThan(0);
    expect(rowKeys()).toEqual(testView().subjectRows.map(row => row.rowKey));
    expect(screen.getAllByRole("link", { name: "테스트가A" })[0]).toHaveAttribute("href", "/students/student-a?back=/newcomers");
    expect(metric("전체 관리 대상")).toHaveTextContent("3명");
    expect(metric("전체 관리 대상")).toHaveTextContent("4개 학생·과목 행");
  });
  it("검색·구간·과목·상태를 함께 적용하고 전체 집계는 유지한다", () => {
    render(<NewcomerBoard view={testView()} canWrite />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "별빛 초5" } });
    fireEvent.change(screen.getByRole("combobox", { name: "과목 필터" }), { target: { value: "math" } });
    fireEvent.change(screen.getByRole("combobox", { name: "등록 경과 구간" }), { target: { value: "d30" } });
    fireEvent.click(within(screen.getByRole("group", { name: "상태 필터" })).getByRole("button", { name: /^기한 경과/ }));
    expect(rowKeys()).toEqual(["student-b|math"]);
    expect(metric("전체 관리 대상")).toHaveTextContent("3명");
    expect(window.location.search).toContain("embed=1");
    expect(window.location.search).toContain("status=overdue");
    fireEvent.change(screen.getByRole("combobox", { name: "과목 필터" }), { target: { value: "english" } });
    expect(screen.getByText("조건에 맞는 학생이 없습니다")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "필터 초기화" })[0]);
    expect(rowKeys()).toHaveLength(4);
  });
  it("정렬 후 저장도 올바른 학생·과목에 연결된다", async () => {
    render(<NewcomerBoard view={testView()} canWrite />);
    fireEvent.change(screen.getByRole("combobox", { name: "정렬" }), { target: { value: "firstClass" } });
    expect(rowKeys()).toEqual(["student-a|math", "student-a|english", "student-b|math", "student-c|"]);
    fireEvent.click(task("student-b|math|pre_call")); submitCompletion();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ studentId: "student-b", subject: "math", itemKey: "pre_call", done: true, completion, doneOn:TEST_TODAY }));
  });
  it("완료 중 중복 실행을 막고 표·집계·우선 업무를 함께 갱신한다", async () => {
    let resolve!: (result: { ok: boolean }) => void;
    mocks.save.mockImplementation(() => new Promise(r => { resolve = r; }));
    const view = testView(), before = boardStats(view.subjectRows, TEST_TODAY);
    const { rerender } = render(<NewcomerBoard view={view} canWrite />);
    fireEvent.click(task()); submitCompletion();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(task()).toBeDisabled();
    expect(task()).toHaveAttribute("aria-pressed", "true");
    expect(task("student-a|english|pre_call")).toHaveAttribute("aria-pressed", "false");
    expect(metric("기한 경과 업무")).toHaveTextContent(`${before.overdue - 1}건`);
    expect(screen.getByRole("button", { name: /우선 처리/,hidden:true })).toHaveTextContent(`${before.overdue + before.dueSoon - 1}건`);
    await act(async () => { resolve({ ok: true }); });
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    const saved = { ...view, subjectRows: withCheckPatches(view.subjectRows, { "student-a|math|pre_call": TEST_TODAY }, TEST_TODAY) };
    rerender(<NewcomerBoard view={saved} canWrite />);
    expect(task()).toHaveAttribute("aria-pressed", "true");
    expect(task()).toHaveAttribute("title", expect.stringContaining(`완료일 ${TEST_TODAY}`));
  });
  it("완료 취소는 같은 저장 경로에 done=false로 보내고 재조회 결과를 반영한다", async () => {
    const base = testView();
    const saved = { ...base, subjectRows: withCheckPatches(base.subjectRows, { "student-a|math|pre_call": TEST_TODAY }, TEST_TODAY) };
    const { rerender } = render(<NewcomerBoard view={saved} canWrite />);
    fireEvent.click(task()); fireEvent.click(screen.getByRole("button",{name:"완료 취소"}));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ studentId: "student-a", subject: "math", itemKey: "pre_call", done: false })));
    await waitFor(() => expect(task()).not.toBeDisabled());
    rerender(<NewcomerBoard view={base} canWrite />);
    expect(task()).toHaveAttribute("aria-pressed", "false");
  });
  it("화면을 연 뒤 자정을 넘어도 서버가 KST로 저장한 실제 완료일을 표시한다", async () => {
    mocks.save.mockResolvedValue({ ok: true, doneOn: "2026-09-17" });
    render(<NewcomerBoard view={testView()} canWrite />);
    fireEvent.click(task()); submitCompletion();
    await waitFor(() => expect(task()).not.toBeDisabled());
    expect(task()).toHaveAttribute("title", expect.stringContaining("완료일 2026-09-17"));
    expect(mocks.save.mock.calls[0][0]).toHaveProperty("doneOn",TEST_TODAY);
    expect(screen.queryByText("한국 시간")).not.toBeInTheDocument();
  });
  it.each(["result", "throw"])("저장 실패(%s)는 집계까지 복구하고 실제 재시도가 가능하다", async failureMode => {
    if (failureMode === "throw") mocks.save.mockRejectedValueOnce(new Error("연결 오류"));
    else mocks.save.mockResolvedValueOnce({ ok: false, error: "저장 오류" });
    const view = testView(), before = boardStats(view.subjectRows, TEST_TODAY);
    render(<NewcomerBoard view={view} canWrite />);
    fireEvent.click(task()); submitCompletion();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("변경 사항을 되돌렸습니다"));
    expect(task()).toHaveAttribute("aria-pressed", "false");
    expect(metric("기한 경과 업무")).toHaveTextContent(`${before.overdue}건`);
    expect(mocks.refresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(task()).not.toBeDisabled());
    expect(task()).toHaveAttribute("aria-pressed", "true");
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("우선 업무가 필터에 가려져도 이유를 알리고 정확한 상세를 연다", async () => {
    render(<NewcomerBoard view={testView()} canWrite initialFilters={{ ...EMPTY_FILTERS, subject: "english" }} />);
    const strip = screen.getByRole("region", { name: "우선 처리 업무" });
    // 우선 처리는 접힌 채로 시작 — 건수만, 이름은 펼쳐야(원장 2026-10-30)
    expect(within(strip).queryByRole("button", { name: /테스트가A/ })).toBeNull();
    fireEvent.click(within(strip).getByRole("button", { name: /우선 처리/ }));
    fireEvent.click(within(strip).getByRole("button", { name: /D\+6.*테스트가A.*수학.*사전 콜/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "상세 관리 업무" })).toHaveValue("pre_call");
    expect(within(dialog).getByText("2026-09-10")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "과목 필터", hidden: true })).toHaveValue("all");
    expect(screen.getByText("선택한 업무를 확인할 수 있도록 표의 필터를 초기화했습니다.")).toBeInTheDocument();
    submitCompletion();
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ studentId: "student-a", subject: "math", itemKey: "pre_call", done: true, completion, doneOn:TEST_TODAY }));
  });
  it("체크 조회 실패를 0건이나 미완료로 표시하지 않고 변경을 막는다", () => {
    render(<NewcomerBoard view={{ ...testView(), checksAvailable: false, checksError: { summary: "기록을 불러오지 못했습니다", raw: "test" } }} canWrite />);
    expect(metric("기한 경과 업무")).toHaveTextContent("—");
    expect(task()).toHaveTextContent("확인 불가");
    expect(task()).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 불러오기" })).toBeInTheDocument();
  });
  it("읽기 권한과 기존 학생 공통 체크 저장 방식도 보존한다", async () => {
    const view = { ...testView(), subjectChecks: false };
    const { rerender } = render(<NewcomerBoard view={view} canWrite={false} />);
    expect(task()).not.toBeDisabled();
    fireEvent.click(task());
    expect(screen.getByRole("button",{name:"액션·결과 저장 후 완료"})).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
    rerender(<NewcomerBoard view={view} canWrite />);
    expect(screen.getByText(/같은 학생의 모든 과목에/)).toBeInTheDocument();
    fireEvent.click(task()); submitCompletion();
    await waitFor(() => expect(task()).not.toBeDisabled());
    expect(task("student-a|english|pre_call")).toHaveAttribute("aria-pressed", "true");
    expect(task("student-b|math|pre_call")).toHaveAttribute("aria-pressed", "false");
  });
  it("필터와 표 스크롤 위치는 저장·재조회 후에도 유지한다", async () => {
    const view = testView();
    const { rerender } = render(<NewcomerBoard view={view} canWrite />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "테스트가A" } });
    const scroll = screen.getByRole("region", { name: "학생 관리 표 · 가로와 세로 스크롤" });
    scroll.scrollTop = 150; scroll.scrollLeft = 90;
    fireEvent.click(task()); submitCompletion();
    await waitFor(() => expect(task()).not.toBeDisabled());
    rerender(<NewcomerBoard view={{ ...view, subjectRows: withCheckPatches(view.subjectRows, { "student-a|math|pre_call": TEST_TODAY }, TEST_TODAY) }} canWrite />);
    expect(screen.getByRole("searchbox",{hidden:true})).toHaveValue("테스트가A");
    expect(scroll.scrollTop).toBe(150); expect(scroll.scrollLeft).toBe(90);
  });
});
