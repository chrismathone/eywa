import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { StudentCareView } from "../server/queries";
import { CareWorkspace } from "./care-workspace";
const m = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("../server/actions", () => ({ saveCare: m.save, getCareHistory: async () => ({ events: [], error: null }) }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
const content = { need: "중3 선행 희망", promise: "중2 진도 완료", criterion: "단원 평가 확인", dueOn: "2026-11-30", ownerId: "teacher", subject: "수학", sourceId: null };
const view = (): StudentCareView => ({ student: { id: "student", name: "검증 학생", enrolledOn: "2026-08-01" }, actor: { id: "teacher", canManage: false, canContribute: true }, today: "2026-11-01", error: null, more: false, page: 0,
  records: [{ id: "promise", studentId: "student", version: 1, updatedAt: "now", document: { revision: 1, content, acknowledged: null, evidence: [], state: "open", closed: null } }],
  references: { sources: [{ id: "intake", date: "2026-08-01", need: "상담 원문 요구사항" }], evidence: [{ kind: "lesson_report", id: "report", label: "11월 수업", href: "/lesson_reports/report/print" }], evidenceKinds: ["lesson_report"], warning: null }, staff: [{ id: "teacher", name: "담당 강사" }], staffError: false });
beforeEach(() => { vi.clearAllMocks(); m.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);
describe("약속 관리 실제 화면", () => {
  it("등록 전 인계는 상담 ID로 저장하며 학생용 증거 제출을 기다린다", async () => {
    const v = view(); v.student = null; v.intake = { id: "intake", name: "입학 상담 학생", studentId: null };
    v.records[0].studentId = null;
    render(<CareWorkspace view={v} />);
    expect(screen.getByText(/등록 전 인계입니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "증거 제출" })).toBeNull();
    expect(screen.queryByRole("link", { name: "학생 기록" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "내용 확인·인수" }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.objectContaining({ intakeId: "intake" })));
  });
  it("담당자는 인수·증거를 처리하며 관리자의 완료 버튼은 보지 않는다", async () => {
    render(<CareWorkspace view={view()} />);
    expect(screen.queryByRole("button", { name: "상담 약속 등록" })).toBeNull();
    expect(screen.queryByRole("button", { name: "이행 확인·완료" })).toBeNull();
    expect(screen.getByText(/90일 이후 계속 관리/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내용 확인·인수" }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith({ studentId: "student", id: "promise", version: 1, command: { kind: "acknowledge" } }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });
  it("읽기 전용에서는 변경 조작을 노출하지 않는다", () => {
    const v = view(); v.actor.canContribute = false;
    render(<CareWorkspace view={v} />);
    expect(screen.queryByRole("button", { name: "내용 확인·인수" })).toBeNull();
    expect(screen.queryByRole("button", { name: "증거 제출" })).toBeNull();
  });
  it("완료 기준을 갖추기 전 관리자의 완료 버튼을 잠근다", () => {
    const v = view(); v.actor = { id: "manager", canManage: true, canContribute: true };
    render(<CareWorkspace view={v} />);
    fireEvent.change(screen.getByLabelText("완료 확인 또는 취소 사유"), { target: { value: "확인" } });
    expect(screen.getByRole("button", { name: "이행 확인·완료" })).toBeDisabled();
  });
  it("조회 불가를 약속 없음이나 완료로 표시하지 않는다", () => {
    const v = view(); v.error = "저장 기능 준비 중";
    render(<CareWorkspace view={v} />);
    expect(screen.getByRole("status")).toHaveTextContent("저장 기능 준비 중");
    expect(screen.queryByText("표시할 상담 약속이 없습니다.")).toBeNull();
  });
  it("저장 충돌을 표시하고 성공한 것처럼 새로고침하지 않는다", async () => {
    m.save.mockResolvedValue({ ok: false, error: "다른 변경이 있습니다" });
    render(<CareWorkspace view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "내용 확인·인수" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("다른 변경"));
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
