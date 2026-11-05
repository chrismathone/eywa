import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { ReportDetail } from "./report-detail";
import { EMPTY_BODY, type WithdrawalReport } from "@/features/withdrawal-reports/model";
const mocks = vi.hoisted(() => ({ change: vi.fn(), autosave: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/withdrawal-reports/server/actions", () => ({ changeWithdrawalReport: mocks.change, autosaveWithdrawalReport: mocks.autosave }));
// 자동 저장기의 기다림(1.2초)보다 넉넉히.
const AUTOSAVE_WAIT = { timeout: 4000 };
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const teacher = "10000000-0000-4000-8000-000000000002";
const manager = "10000000-0000-4000-8000-000000000003";
const director = "10000000-0000-4000-8000-000000000004";
const r: WithdrawalReport = { id: "10000000-0000-4000-8000-000000000001", tenant_id: "tenant", student_id: "student", requested_by: manager, teacher_id: teacher, manager_id: manager, director_id: director,
  exit_kind: "withdrawal", subjects: ["math"], effective_date: "2026-10-13", request_note: "", snapshot: { name: "테스트 학생", school: "테스트중", grade: "중1", enrolledAt: "2026-01-01", status: "enrolled", withdrawnAt: null, courses: [] },
  body: EMPTY_BODY, status: "requested", revision: 3, manager_approved_at: null, director_approved_at: null, applied_at: null, last_comment: null, created_at: "2026-10-13T01:00:00Z", updated_at: "2026-10-13T01:00:00Z" };
const props = { report: r, staff: [], labels: { math: "수학" }, userId: teacher, writable: true, events: [] };
describe("report submission and review", () => {
  it("saves an internal subreason and a selected student consultation, clearing stale subreasons on category change", async () => {
    const consultation = { id: "10000000-0000-4000-8000-000000000007", consultedAt: "2026-10-01T01:00:00Z", audience: "parent" as const, summary: "학부모 상담 내용" };
    render(<ReportDetail {...props} consultations={[consultation]} />);
    fireEvent.change(screen.getByLabelText("퇴원사유"), { target: { value: "grades" } });
    fireEvent.change(screen.getByLabelText("세부 퇴원사유"), { target: { value: "school_grades" } });
    fireEvent.click(screen.getByText("등록된 상담 연결"));
    fireEvent.click(screen.getByRole("checkbox"));
    // 실시간 저장(원장 2026-11-05) — 저장 단추 없이 입력이 멎으면 한 번 저장한다.
    expect(screen.queryByRole("button", { name: "임시 저장" })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.autosave).toHaveBeenCalledWith(r.id, r.revision, expect.objectContaining({ reasonDetail: "school_grades", consultationIds: [consultation.id] })), AUTOSAVE_WAIT);
    expect(mocks.autosave).toHaveBeenCalledTimes(1);
    expect(mocks.change).not.toHaveBeenCalled();
    await screen.findByText(/자동 저장됨/);
    fireEvent.change(screen.getByLabelText("퇴원사유"), { target: { value: "dissatisfaction" } });
    expect(screen.getByLabelText("세부 퇴원사유")).toHaveValue("");
  });
  it("자동 저장 뒤 제출은 자동 저장이 올린 revision으로 간다 · 연 직후에는 저장하지 않는다", async () => {
    render(<ReportDetail {...props} />);
    expect(screen.getByRole("status")).toHaveTextContent("입력하면 자동으로 저장됩니다.");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(mocks.autosave).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("퇴원 상세사유"), { target: { value: "상담 결과 ".repeat(40) } });
    await waitFor(() => expect(mocks.autosave).toHaveBeenCalledWith(r.id, 3, expect.objectContaining({ detail: "상담 결과 ".repeat(40) })), AUTOSAVE_WAIT);
    await screen.findByText(/자동 저장됨/);
    fireEvent.click(screen.getByRole("button", { name: "관리자에게 제출" }));
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "submit", 4, expect.objectContaining({ detail: "상담 결과 ".repeat(40) })));
  });
  it("다른 화면이 먼저 고쳤으면 자동 저장을 멈추고 제출을 막는다", async () => {
    mocks.autosave.mockResolvedValue({ ok: false, conflict: true, error: "다른 화면에서 이 보고서가 바뀌었습니다." });
    render(<ReportDetail {...props} />);
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "의견" } });
    await screen.findByText(/자동 저장을 멈췄습니다/, undefined, AUTOSAVE_WAIT);
    expect(screen.getByRole("button", { name: "관리자에게 제출" })).toBeDisabled();
    expect(screen.getByLabelText("담임 의견")).toHaveValue("의견");
  });
  it("only the requester sees cancellation, including when the author has an administrator role", () => {
    const { rerender } = render(<ReportDetail {...props} />);
    expect(screen.queryByRole("button", { name: "요청 취소" })).not.toBeInTheDocument();
    rerender(<ReportDetail {...props} userId={manager} />);
    expect(screen.getByRole("button", { name: "요청 취소" })).toBeInTheDocument();
  });
  it("shows the original table with automatic fields and saves the user's corrections", async () => {
    render(<ReportDetail {...props} prefill={{ attendance: "최근 출석 5회", tuition: "청구 300,000원", arrears: "no", arrearsNote: "수납 확인" }} />);
    expect(screen.getByRole("table", { name: "결재란" })).toHaveTextContent("담임관리자원장");
    expect(screen.getByRole("table", { name: "퇴원 보고 내용" })).toHaveTextContent("테스트 학생");
    expect(screen.getByLabelText("최근 3개월 출결 현황")).toHaveValue("최근 출석 5회");
    expect(screen.getByText("청구 300,000원")).toBeInTheDocument();
    expect(screen.getByText("미납 없음")).toBeInTheDocument();
    expect(screen.queryByLabelText("미납 여부")).not.toBeInTheDocument();
    // 자동으로 채운 칸은 사람이 한 칸이라도 고치면 함께 저장된다.
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "확인" } });
    await waitFor(() => expect(mocks.autosave).toHaveBeenCalledWith(r.id, r.revision, expect.objectContaining({ tuition: "청구 300,000원", attendance: "최근 출석 5회", arrears: "no", arrearsNote: "수납 확인", teacherOpinion: "확인" })), AUTOSAVE_WAIT);
  });
  it("a grouped report shows only its own homeroom classes even when another teacher teaches the same subject", () => {
    const course = { id: "course", classId: "class", className: "내 담당반", subject: "math", teacherId: teacher, teacherName: "담임", startDate: "2026-01-01", endDate: null, onHold: false };
    render(<ReportDetail {...props} report={{ ...r, group_id: "group", snapshot: { ...r.snapshot, courses: [course, { ...course, id: "other", classId: "other", className: "다른 강사반", teacherId: "someone_else" }] } }} />);
    expect(screen.getAllByText(/내 담당반/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/다른 강사반/)).not.toBeInTheDocument();
  });
  it("warns about a changed live assignment and blocks submission while keeping the draft editable", () => {
    render(<ReportDetail {...props} assignmentChanged />);
    expect(screen.getByRole("alert")).toHaveTextContent("담당 강사가 변경");
    expect(screen.getByRole("button", { name: "관리자에게 제출" })).toBeDisabled();
    expect(screen.getByLabelText("담임 의견")).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent("입력하면 자동으로 저장됩니다.");
  });
  it("shows only the selected enrollment even when its teacher has another class in the same subject", () => {
    const course = { id: "course", classId: "class", className: "종료할 반", subject: "math", teacherId: teacher, teacherName: "담임", startDate: "2026-10-01", endDate: null, onHold: false };
    render(<ReportDetail {...props} report={{ ...r, group_id: "group", enrollment_ids: ["course"], snapshot: { ...r.snapshot, courses: [course, { ...course, id: "other", classId: "other", className: "계속 다닐 반", startDate: "2025-01-01" }] } }} />);
    expect(screen.getAllByText(/종료할 반/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/계속 다닐 반/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2025-01-01/)).not.toBeInTheDocument();
  });
  it("a single representative author sees both selected homeroom and assistant classes in the merged report", () => {
    const course = { id: "main", classId: "main", className: "담임 수업", subject: "math", teacherId: teacher, teacherName: "담임", startDate: "2026-10-01", endDate: null, onHold: false };
    render(<ReportDetail {...props} report={{ ...r, group_id: "group", enrollment_ids: ["main", "assistant"], snapshot: { ...r.snapshot, courses: [course, { ...course, id: "assistant", classId: "assistant", className: "부담임 수업", teacherId: "another-teacher" }] } }} />);
    expect(screen.getAllByText(/담임 수업/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/부담임 수업/).length).toBeGreaterThan(0);
  });
  beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.change.mockResolvedValue({ ok: true, id: r.id }); mocks.autosave.mockResolvedValue({ ok: true, revision: r.revision + 1, savedAt: "2026-10-13T01:05:00Z" }); });
  it("submits the entered report only after explicit confirmation", async () => {
    render(<ReportDetail {...props} />);
    fireEvent.change(screen.getByLabelText("퇴원 상세사유"), { target: { value: "상담 결과 ".repeat(40) } });
    fireEvent.change(screen.getByLabelText("학생상담"), { target: { value: "학생 상담 완료" } });
    fireEvent.change(screen.getByLabelText("학부모상담"), { target: { value: "학부모 상담 완료" } });
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "종료 요청 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자에게 제출" }));
    expect(mocks.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출 확인" }));
    // 제출 직전에 남은 글을 자동 저장으로 마저 보내고(revision 3 → 4) 그 revision으로 제출한다.
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "submit", r.revision + 1, expect.objectContaining({ studentConsultation: "학생 상담 완료", detail: "상담 결과 ".repeat(40) })));
    expect(mocks.autosave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  });
  it("shows the detail length rule as a placeholder, not as a label note", () => {
    render(<ReportDetail {...props} />);
    expect(screen.getByLabelText("퇴원 상세사유")).toHaveAttribute("placeholder", "100자 이상 작성해 주세요");
    expect(screen.getByRole("rowheader", { name: "퇴원 상세 사유" })).toBeInTheDocument();
    expect(screen.queryByText(/10pt/)).not.toBeInTheDocument();
  });
  it("displays server rejection and preserves the written text", async () => {
    mocks.change.mockResolvedValue({ error: "퇴원 상세사유를 100자 이상 작성해 주세요." });
    render(<ReportDetail {...props} />);
    fireEvent.change(screen.getByLabelText("퇴원 상세사유"), { target: { value: "짧은 사유" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자에게 제출" }));
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출 확인" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("퇴원 상세사유")).toHaveValue("짧은 사유");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("requires a rejection reason and routes the decision to the current revision", async () => {
    render(<ReportDetail {...props} report={{ ...r, status: "manager_pending" }} userId={manager} />);
    expect(screen.queryByRole("button", { name: "관리자에게 제출" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "반려" }));
    expect(screen.getByRole("button", { name: "반려 확인" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("반려 사유"), { target: { value: "학부모 상담 내용을 보충해 주세요." } });
    fireEvent.click(screen.getByRole("button", { name: "반려 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "reject", 3, "학부모 상담 내용을 보충해 주세요."));
  });
  it("shows final withdrawal consequences before director approval", async () => {
    render(<ReportDetail {...props} report={{ ...r, status: "director_pending", manager_approved_at: r.created_at }} userId={director} />);
    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(screen.getByText(/퇴원을 처리합니다/)).toBeInTheDocument();
    expect(mocks.change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "승인 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "approve", 3, undefined));
  });
  it("관리자 승인 생략 보고서 — '보고서 제출' · 결재란 관리자 '생략' · 원장 칸 없음(원장 2026-11-03)", async () => {
    render(<ReportDetail {...props} report={{ ...r, manager_id: null, manager_ids: [], director_id: null, director_ids: [] }} />);
    expect(screen.getByText(/관리자 승인 생략 — 작성 강사가 이 과목 관리자입니다/)).toBeInTheDocument();
    const approval = screen.getByRole("table", { name: "결재란" });
    expect(approval).toHaveTextContent("담임관리자");
    expect(approval).toHaveTextContent("생략");
    expect(approval).not.toHaveTextContent("원장");
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출" }));
    expect(screen.getByText(/관리자 승인 없이 바로 승인 완료로 넘어갑니다/)).toBeInTheDocument();
  });
  it("데스크 환불 대기 — 상태 칩 둘 · 안내 · 결재란 '데스크' 칸(담당 · 환불완료일)", () => {
    const steps = [{ documentId: "doc", deskId: "desk", deskName: "데스크A", completedDate: null }];
    render(<ReportDetail {...props} report={{ ...r, status: "approved", director_id: null, director_ids: [] }} userId={manager} refundSteps={steps} />);
    expect(screen.getByText("관리자 승인 완료")).toBeInTheDocument();
    expect(screen.getByText("데스크 환불 요청")).toBeInTheDocument();
    expect(screen.getByText(/데스크 환불 처리\(환불 요청서의 환불완료일자\)가 끝나면/)).toBeInTheDocument();
    const approval = screen.getByRole("table", { name: "결재란" });
    expect(approval).toHaveTextContent("데스크");
    expect(approval).toHaveTextContent("데스크A");
    expect(approval).toHaveTextContent("환불완료일 :");
  });
  it("readonly views cannot submit, approve or cancel", () => {
    render(<ReportDetail {...props} writable={false} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "퇴원 상세사유" })).not.toBeInTheDocument();
  });
});

// 2026-11-05 실시간 저장 리뷰(치명 · 중요) — 상세는 상태가 바뀔 때만 다시 마운트된다(page.tsx key). 같은 상태로 다시 그려질 때(숨었던 창이
// 다시 보이며 새로고침 등) 본문이 처음 연 값으로 남으면 다른 기기의 글을 덮거나, 보지 않은 본문을 승인했다.
describe("같은 상태로 다시 그려질 때 — 본문은 서버와 함께 간다", () => {
  const key = `${r.id}:requested`;
  beforeEach(() => {
    cleanup(); vi.clearAllMocks();
    mocks.change.mockResolvedValue({ ok: true, id: r.id });
    mocks.autosave.mockImplementation(async (_id: string, rev: number) => ({ ok: true, revision: rev + 1, savedAt: "2026-10-13T01:05:00Z" }));
  });
  const pcBody = { ...r, body: { ...EMPTY_BODY, detail: "PC에서 쓴 옛 글" } } as WithdrawalReport;
  const phoneBody = { ...pcBody, revision: 9, body: { ...EMPTY_BODY, detail: "휴대폰에서 고친 최신 글" } } as WithdrawalReport;

  it("작성 강사 · 안 간 글이 없으면 다른 기기의 최신 본문으로 다시 맞추고, 이어 쓰면 그 위에 저장한다", async () => {
    const { rerender } = render(<ReportDetail key={key} {...props} report={pcBody} />);
    rerender(<ReportDetail key={key} {...props} report={phoneBody} />);
    expect(screen.getByLabelText("퇴원 상세사유")).toHaveValue("휴대폰에서 고친 최신 글");
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "한 글자" } });
    await waitFor(() => expect(mocks.autosave).toHaveBeenCalled(), AUTOSAVE_WAIT);
    expect(mocks.autosave).toHaveBeenCalledWith(r.id, 9, expect.objectContaining({ detail: "휴대폰에서 고친 최신 글", teacherOpinion: "한 글자" }));
  });

  it("작성 강사 · 안 간 글이 있는데 다른 기기가 앞서면 충돌로 멈춘다 — 내 글로 덮지 않고, 쓴 글은 화면에 남는다", async () => {
    const { rerender } = render(<ReportDetail key={key} {...props} report={pcBody} />);
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "PC에서 막 쓴 의견" } });
    rerender(<ReportDetail key={key} {...props} report={phoneBody} />);
    expect(screen.getByRole("status")).toHaveTextContent("자동 저장을 멈췄습니다");
    expect(screen.getByLabelText("담임 의견")).toHaveValue("PC에서 막 쓴 의견");
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(mocks.autosave).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "관리자에게 제출" })).toBeDisabled();
  });

  it("승인 관리자 · 반려 뒤 고쳐 다시 낸 본문이 보이고, 열려 있던 승인 확인은 닫힌다(보지 않은 본문을 승인하지 않게)", async () => {
    const m2 = "10000000-0000-4000-8000-000000000005";
    const first = { ...r, status: "manager_pending", manager_ids: [manager, m2], director_ids: [], manager_decisions: {}, director_decisions: {}, body: { ...EMPTY_BODY, detail: "1차 제출 글" }, revision: 5 } as unknown as WithdrawalReport;
    const second = { ...first, revision: 8, body: { ...EMPTY_BODY, detail: "반려 뒤 고쳐 다시 낸 글" } } as unknown as WithdrawalReport;
    const pendingKey = `${r.id}:manager_pending`;
    const { rerender } = render(<ReportDetail key={pendingKey} {...props} report={first} userId={m2} />);
    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(screen.getByRole("button", { name: "승인 확인" })).toBeInTheDocument();
    rerender(<ReportDetail key={pendingKey} {...props} report={second} userId={m2} />);
    expect(screen.getByText("반려 뒤 고쳐 다시 낸 글")).toBeInTheDocument();
    expect(screen.queryByText("1차 제출 글")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인 확인" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    fireEvent.click(screen.getByRole("button", { name: "승인 확인" }));
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(r.id, "approve", 8, undefined));
  });

  it("제출 직전 마저 저장하다 충돌하면 제출하지 않는다(렌더를 기다리지 않고 settle 값으로 판정)", async () => {
    mocks.autosave.mockResolvedValue({ ok: false, conflict: true, error: "다른 화면에서 이 보고서가 바뀌었습니다." });
    render(<ReportDetail key={key} {...props} report={pcBody} />);
    fireEvent.change(screen.getByLabelText("담임 의견"), { target: { value: "의견" } });
    fireEvent.click(screen.getByRole("button", { name: "관리자에게 제출" }));
    fireEvent.click(screen.getByRole("button", { name: "보고서 제출 확인" }));
    await screen.findByText(/처리를 멈췄습니다/);
    expect(mocks.autosave).toHaveBeenCalledTimes(1);
    expect(mocks.change).not.toHaveBeenCalled();
  });
});
