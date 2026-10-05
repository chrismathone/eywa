import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MakeupIntakeForm } from "./intake-form";
import { ReconciliationItems } from "./reconciliation-panel";
import { FulfillmentReview } from "./fulfillment-review";
import type { MakeupCaseDetail, MakeupFulfillment } from "../server/read-types";

const calls = vi.hoisted(() => ({ search: vi.fn(), push: vi.fn(), payload: vi.fn() }));
vi.mock("../server/actions", () => ({ searchMakeupOptions: calls.search }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: calls.push }) }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock("@/components/workspace/embed-context", () => ({ useEmbed: () => false }));
vi.mock("./command-form", () => ({ CommandForm: ({ children, payload, label }: { children: ReactNode; payload: (data: FormData) => unknown; label: string }) =>
  <form onSubmit={event => { event.preventDefault(); calls.payload(payload(new FormData(event.currentTarget))); }}>{children}<button>{label}</button></form> }));

const studentId = "00000000-0000-4000-8000-000000000061";
const classId = "00000000-0000-4000-8000-000000000051";
describe("보강 접수·복구 선택 조건", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    calls.search.mockImplementation(async (args: { kind: string }) => ({ data: {
      rows: args.kind === "students" ? [{ id: studentId, name: "김학생", school: "침산중", grade: "중1", class_names: ["수학A"] }]
        : [{ id: classId, name: "수학A", active: false }], page: 1, page_size: 30, total: 1,
    } }));
  });
  it("학생·원수업 날짜에 맞춰 반을 조회하고 학생이 바뀌면 선택을 지운다", async () => {
    render(<MakeupIntakeForm subjects={[{ key: "math", label: "수학", color: "primary", weekdayGrouping: "none", testMax: 20 }]} />);
    expect(screen.getByRole("combobox", { name: "반" })).toBeDisabled();
    fireEvent.focus(screen.getByRole("combobox", { name: "학생" }));
    await screen.findByRole("option", { name: "김학생 · 침산중1 · 수학A" });
    fireEvent.change(screen.getByRole("combobox", { name: "학생" }), { target: { value: studentId } });
    fireEvent.change(screen.getByLabelText("결석일"), { target: { value: "2026-10-03" } });
    fireEvent.focus(screen.getByRole("combobox", { name: "반" }));
    await screen.findByRole("option", { name: "수학A · 종료된 반" });
    expect(calls.search).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "classes", purpose: "original", student_id: studentId, session_date: "2026-10-03", subject_key: "math" }));
    fireEvent.change(screen.getByRole("combobox", { name: "반" }), { target: { value: classId } });
    fireEvent.change(screen.getByRole("combobox", { name: "학생" }), { target: { value: "" } });
    expect(screen.getByRole("combobox", { name: "반" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "반" })).toBeDisabled();
  });
  it("전역 대사 화면에서도 복구할 반 번호를 명령에 전달한다", async () => {
    render(<ReconciliationItems canResolve canAcceptManual={false} jobs={[]} items={[{ id: classId, revision: 2, state: "open", kind: "anchor_missing",
      anchor_context: { student_id: studentId, subject_key: "math", session_date: "2026-10-03" } }]} />);
    fireEvent.focus(screen.getByRole("combobox", { name: "출결·보고서를 연결할 반" }));
    await screen.findByRole("option", { name: "수학A · 종료된 반" });
    expect(calls.search).toHaveBeenLastCalledWith(expect.objectContaining({ purpose: "anchor", student_id: studentId }));
    fireEvent.change(screen.getByRole("combobox", { name: "출결·보고서를 연결할 반" }), { target: { value: classId } });
    fireEvent.change(screen.getByRole("textbox", { name: "확인 근거·조치 내용" }), { target: { value: "원수업과 실시 날짜 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "대사 확인·처리" }));
    await waitFor(() => expect(calls.payload).toHaveBeenCalledWith(expect.objectContaining({ anchor_class_id: classId, reconciliation_id: classId })));
  });
  it("복구할 반이 없으면 다음 조치를 알리고 포커스만으로 반복 조회하지 않는다", async () => {
    calls.search.mockResolvedValue({ data: { rows: [], total: 0, page: 1, page_size: 30 } });
    render(<ReconciliationItems canResolve canAcceptManual={false} jobs={[]} items={[{ id: classId, revision: 2, state: "open", kind: "anchor_missing",
      anchor_context: { student_id: studentId, subject_key: "math", session_date: "2026-10-03" } }]} />);
    const select = screen.getByRole("combobox", { name: "출결·보고서를 연결할 반" });
    fireEvent.focus(select);
    await screen.findByText(/원생목록에서 수강 반과 수강 기간을 확인/);
    fireEvent.blur(select); fireEvent.focus(select);
    expect(calls.search).toHaveBeenCalledOnce();
  });
  it("서버가 보낸 재인정 상한을 사용하고 구버전 응답에는 잘못된 상한을 강제하지 않는다", () => {
    const fulfillment: MakeupFulfillment = { id: classId, participant_id: studentId, revision: 1, actual_teacher_id: "other", state: "submitted", actual_minutes: 90,
      report_id: null, attendance_record_id: null, learning_summary: "실제 지도", homework: null, return_reason: null };
    const detail = { permissions: { verify: true }, allocations: [{ id: classId, case_id: classId, participant_id: studentId, original_date: "2026-10-03", allocated_minutes: 90, released_minutes: 90, recognizable_minutes: 90 }] } as unknown as MakeupCaseDetail;
    const view = render(<FulfillmentReview actorId="reviewer" detail={detail} fulfillment={fulfillment} />);
    expect(screen.getByRole("spinbutton")).toHaveAttribute("max", "90");
    const legacy = { ...detail, allocations: detail.allocations.map(row => { const older = { ...row }; delete older.recognizable_minutes; return older; }) };
    view.rerender(<FulfillmentReview actorId="reviewer" detail={legacy} fulfillment={fulfillment} />);
    expect(screen.getByRole("spinbutton")).not.toHaveAttribute("max");
  });
});
