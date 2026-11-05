import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { MakeupCaseDetail } from "../server/read-types";
import type { PeriodsConfig } from "@/features/timetable/lib/periods";
import { CaseDetailView, withoutMakeupWrites } from "./case-detail-view";
import { useCaseDetailReload } from "./case-detail-context";

const calls = vi.hoisted(() => ({ reload: vi.fn() }));
vi.mock("../server/actions", () => ({ reloadMakeupCaseDetail: calls.reload }));
vi.mock("./case-records", () => ({ CaseRecords: ({ detail }: { detail: MakeupCaseDetail }) => <p>기록 {detail.case.eligibility} r{detail.case.revision}</p> }));
vi.mock("./reconciliation-panel", () => ({ ReconciliationPanel: () => null }));
vi.mock("./session-operations", () => ({ SessionOperations: () => null }));
vi.mock("./reserve-form", () => ({ ReserveForm: () => <p>예정 회차 예약</p> }));
// A section with an unsaved input and a command that reloads through the view's context.
vi.mock("./case-decisions", () => ({ CaseDecisions: function Decisions() {
  const view = useCaseDetailReload();
  const [result, setResult] = useState("");
  return <div><label>메모<input defaultValue="" /></label>
    <button onClick={async () => setResult(String(await view?.reload()))}>다시 읽기</button><span>결과 {result}</span><span>갱신 {view?.version ?? 0}</span></div>;
} }));

const CASE = "00000000-0000-4000-8000-000000000061";
const detail = (eligibility: string, revision: number) => ({
  case: { id: CASE, eligibility, lifecycle: "open", revision }, permissions: { reserve: true },
}) as unknown as MakeupCaseDetail;
const periods = {} as PeriodsConfig;
const view = (initial: MakeupCaseDetail) => <CaseDetailView initial={initial} periods={periods} actorId="actor" reserveOn canWrite />;

describe("보강 상세 — 저장 뒤 페이지 재렌더 없이 건 데이터만 다시 읽는다", () => {
  beforeEach(() => vi.resetAllMocks());
  it("다시 읽은 데이터로 모든 구역을 바꾸고 작성 중인 다른 입력값은 유지한다", async () => {
    calls.reload.mockResolvedValue({ data: detail("approved", 2) });
    render(view(detail("pending", 1)));
    expect(screen.queryByText("예정 회차 예약")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "메모" }), { target: { value: "작성 중" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 읽기" })); });
    expect(calls.reload).toHaveBeenCalledWith({ case_id: CASE });
    expect(await screen.findByText("기록 approved r2")).toBeTruthy();
    expect(screen.getByText("예정 회차 예약")).toBeTruthy();
    expect(screen.getByText("결과 true")).toBeTruthy();
    expect(screen.getByText("갱신 1")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "메모" })).toHaveValue("작성 중");
  });
  it("다시 읽기가 실패하면 기존 데이터를 지키고 실패를 알린다", async () => {
    calls.reload.mockResolvedValueOnce({ error: "보강 기록을 불러오지 못했습니다" }).mockRejectedValueOnce(new Error("network"));
    render(view(detail("pending", 1)));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 읽기" })); });
    expect(screen.getByText("결과 false")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 읽기" })); });
    expect(screen.getByText("결과 false")).toBeTruthy();
    expect(screen.getByText("기록 pending r1")).toBeTruthy();
    expect(screen.getByText("갱신 0")).toBeTruthy();
  });
  it("새 서버 데이터(이동·창 새로고침)가 오면 다시 읽은 사본 대신 그것을 쓴다", async () => {
    calls.reload.mockResolvedValue({ data: detail("approved", 2) });
    const screenView = render(view(detail("pending", 1)));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 읽기" })); });
    expect(await screen.findByText("기록 approved r2")).toBeTruthy();
    screenView.rerender(view(detail("approved", 3)));
    expect(screen.getByText("기록 approved r3")).toBeTruthy();
    expect(screen.getByText("갱신 2")).toBeTruthy();
  });
  it("연달아 저장해 다시 읽기가 겹치면 늦게 끝난 옛 응답이 새 응답을 덮지 않는다", async () => {
    let older!: (value: unknown) => void;
    calls.reload.mockImplementationOnce(() => new Promise(resolve => { older = resolve; })).mockResolvedValueOnce({ data: detail("approved", 3) });
    render(view(detail("pending", 1)));
    fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "다시 읽기" })); });
    expect(await screen.findByText("기록 approved r3")).toBeTruthy();
    await act(async () => { older({ data: detail("approved", 2) }); });
    expect(screen.getByText("기록 approved r3")).toBeTruthy();
    expect(screen.getByText("갱신 1")).toBeTruthy();
  });
  it("이동 전에 시작한 다시 읽기는 새로 열린 다른 건을 덮지 않는다", async () => {
    let older!: (value: unknown) => void;
    calls.reload.mockImplementationOnce(() => new Promise(resolve => { older = resolve; }));
    const rendered = render(view(detail("pending", 1)));
    fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
    const other = { ...detail("approved", 3), case: { ...detail("approved", 3).case, id: "00000000-0000-4000-8000-000000000099" } } as MakeupCaseDetail;
    rendered.rerender(view(other));
    await act(async () => { older({ data: detail("pending", 2) }); });
    expect(screen.getByText("기록 approved r3")).toBeTruthy();
  });
  it("같은 건이라도 다시 읽기 도중 새 서버 데이터가 오면 그 데이터를 지킨다", async () => {
    let older!: (value: unknown) => void;
    calls.reload.mockImplementationOnce(() => new Promise(resolve => { older = resolve; }));
    const rendered = render(view(detail("pending", 1)));
    fireEvent.click(screen.getByRole("button", { name: "다시 읽기" }));
    rendered.rerender(view(detail("approved", 4)));
    await act(async () => { older({ data: detail("approved", 2) }); });
    expect(screen.getByText("기록 approved r4")).toBeTruthy();
    expect(screen.getByText("갱신 1")).toBeTruthy();
  });
});

describe("보강 상세 — 서버 쓰기 판정이 거짓이면 DB가 연 쓰기도 닫는다(원장 2026-11-05)", () => {
  beforeEach(() => vi.resetAllMocks());
  const open = () => ({ ...detail("approved", 1), participants: [{ id: "p1", actions: { record: true, cancel: true }, blocked: { record: null } }],
    permissions: { reserve: true, approve: true, assign: true, cancel: true, read_billing: true } }) as unknown as MakeupCaseDetail;

  it("쓰기 권한은 전부 내리고 읽기 표시(read_billing)는 남긴다 · 참가자 조작은 read_only 사유로 막는다", () => {
    const capped = withoutMakeupWrites(open());
    expect(capped.permissions).toEqual({ reserve: false, approve: false, assign: false, cancel: false, read_billing: true });
    expect(capped.participants[0].actions).toEqual({ record: false, submit: false, cancel: false, reschedule: false });
    expect(capped.participants[0].blocked).toEqual({ record: "read_only", submit: "read_only", cancel: "read_only", reschedule: "read_only" });
  });

  it("canWrite=false면 예약 양식을 그리지 않고 읽기 권한 안내를 한 줄 보인다", () => {
    render(<CaseDetailView initial={open()} periods={periods} actorId="actor" reserveOn canWrite={false} />);
    expect(screen.queryByText("예정 회차 예약")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("보강관리 작성 권한이 필요합니다");
  });

  it("canWrite=true면 DB 권한 그대로 — 안내 없이 예약 양식을 그린다", () => {
    render(<CaseDetailView initial={open()} periods={periods} actorId="actor" reserveOn canWrite />);
    expect(screen.getByText("예정 회차 예약")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
