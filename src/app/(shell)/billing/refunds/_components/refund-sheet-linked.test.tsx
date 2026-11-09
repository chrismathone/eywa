import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

/**
 * 퇴원보고서에 이어진 환불 요청서 화면(리뷰 r2 I4·I6·B1 · 원장 2026-11-09) — 보기 화면 맨 위 경고(대체됨 · 잠금 사유) · 상한 줄 ·
 * 고치기·지우기 잠금(단추를 숨기고 사유) · 이어진 요청서의 삭제 확인 문구 · 결재란 담당 자리 '대체됨'.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/features/billing/server/refund-actions", () => ({ saveRefundRequest: vi.fn(), deleteRefundRequest: vi.fn(), loadRefundStudentOptions: vi.fn(async () => ({ options: [] })), loadRefundPrefill: vi.fn() }));
vi.mock("@/components/forms/use-form-draft", () => ({ useFormDraft: () => ({ clear: vi.fn(), restore: vi.fn(), discard: vi.fn(), draftSavedAt: null }) }));
vi.mock("@/components/workspace/use-in-frame", () => ({ useInFrame: () => false }));

import { RefundSheet } from "./refund-sheet";
import { emptyRefund } from "@/features/billing/refund-request";
import { COMPLETION_SUPERSEDED, LINKED_CLEAR_DIRECTOR_ONLY, LINKED_CLEAR_WARNING, LINKED_DELETE_CONFIRM, LINKED_DELETE_CONFIRM_CANCELED, linkedEditLockReason } from "@/features/withdrawal-reports/refund-decision";

afterEach(cleanup);
const ID = "00000000-0000-4000-8000-000000000099";
const data = () => { const d = emptyRefund(); d.student.name = "가학생"; d.approval.staff = "옛데스크"; d.refund.totalAmount = "315,000원"; return d; };
const buttons = () => screen.queryAllByRole("button").map((b) => (b.textContent ?? "").trim());
const base = { superseded: null, lock: null, cap: 315000, capLines: 1, editLock: null, deleteLock: null, canceledOnly: false, clearLock: null };
/** 수정 화면의 이름 칸 값(숨은 칸 포함 — 잠근 칸은 숨은 칸으로 지금 값을 보낸다). */
const field = (name: string) => document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);

describe("이어진 환불 요청서 화면", () => {
  it("🔴 대체된 옛 요청서 — 보기 화면 맨 위 경고(새 요청서 링크·담당) · 결재란 담당 자리 '대체됨'", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite completionLock={COMPLETION_SUPERSEDED}
      linked={{ ...base, superseded: { documentId: "new-doc", deskName: "새데스크" }, lock: COMPLETION_SUPERSEDED }} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("이 요청서로 환불하지 마세요 — 새 요청서로 처리합니다.");
    expect(alert.textContent).toContain("담당 새데스크");
    expect(screen.getByRole("link", { name: "새 요청서 열기" }).getAttribute("href")).toContain("/billing/refunds/new-doc");
    expect(screen.getByText("대체됨")).toBeTruthy();
  });

  it("상한 줄 — 원장 승인 N건 · 낸 돈 합계(상한) · 모르면 '상한 모름 — 원장 확인'", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite linked={base} />);
    expect(screen.getByLabelText("원장 승인 상한").textContent).toBe("원장 승인 1건 · 낸 돈 합계(상한) 315,000원 — 총 환불금액은 이 금액을 넘을 수 없습니다(숫자와 쉼표·'원'만 씁니다 — 예: 315,000원).");
    cleanup();
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite linked={{ ...base, cap: null, capLines: 0 }} />);
    expect(screen.getByLabelText("원장 승인 상한").textContent).toContain("원장 승인 금액(상한) 모름 — 원장 확인");
  });

  it("🔴 담당 아닌 사람 — 수정·삭제 단추를 숨기고 사유를 보인다(인쇄는 남는다)", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite completionLock="잠금"
      linked={{ ...base, lock: "잠금", editLock: linkedEditLockReason("옛데스크"), deleteLock: "지우기 잠금 사유" }} />);
    expect(buttons()).toEqual(["인쇄"]);
    expect(document.body.textContent).toContain(linkedEditLockReason("옛데스크"));
    expect(document.body.textContent).toContain("지우기 잠금 사유");
  });

  it("🔴 담당 데스크 — 이어진 요청서를 지울 때 확인 칸에 '원장 환불 결정 대기로 돌아갑니다'", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite linked={base} />);
    expect(buttons()).toEqual(["수정", "인쇄", "삭제"]);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByRole("note").textContent).toBe(LINKED_DELETE_CONFIRM);
  });

  it("취소된 요청의 요청서 — 삭제 확인을 가른다(결정 대기로 돌아갈 것이 없다 · 리뷰 r3 R2-m9)", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite linked={{ ...base, canceledOnly: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.getByRole("note").textContent).toBe(LINKED_DELETE_CONFIRM_CANCELED);
  });

  it("🔴 상한 모름이면 수정 화면에서 총 환불금액·결제내역 칸을 잠근다(지금 값을 숨은 칸으로 · 리뷰 r3 R2-m8) · 완료일자는 받는다", () => {
    const d = data(); d.refund.paymentDetails = "2026-12 수업 315,000원";
    render(<RefundSheet data={d} id={ID} userId="u" canWrite startEditing linked={{ ...base, cap: null, capLines: 0 }} />);
    expect(field("r_totalAmount")?.type).toBe("hidden");
    expect(field("r_totalAmount")?.value).toBe("315,000원");
    expect(field("r_paymentDetails")?.type).toBe("hidden");
    expect(document.body.textContent).toContain("원장 승인 금액(상한)을 알 수 없어 바꿀 수 없습니다 — 원장 확인.");
    expect(field("res_completedDate")?.type).toBe("date");
  });

  it("🔴 환불을 마친 이어진 요청서 — 원장 수정 화면은 완료일자 칸 + 비우기 경고 · 담당 데스크는 완료일자 읽기 전용(비우기는 원장만 · 리뷰 r3 R2-I2·R2-m8)", () => {
    const d = data(); d.result.completedDate = "2026-11-08";
    const a = render(<RefundSheet data={d} id={ID} userId="u" canWrite startEditing linked={base} />);
    expect(field("res_completedDate")?.type).toBe("date");
    expect(document.body.textContent).toContain(LINKED_CLEAR_WARNING);
    a.unmount();
    render(<RefundSheet data={d} id={ID} userId="u" canWrite startEditing linked={{ ...base, clearLock: LINKED_CLEAR_DIRECTOR_ONLY }} />);
    expect(field("res_completedDate")?.type).toBe("hidden");
    expect(field("res_completedDate")?.value).toBe("2026-11-08");
    expect(document.body.textContent).toContain(LINKED_CLEAR_DIRECTOR_ONLY);
    expect(document.body.textContent).not.toContain(LINKED_CLEAR_WARNING);
  });

  it("이어지지 않은 요청서는 종전대로 — 경고·상한 없음 · 삭제 확인에 연결 문구 없음", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("원장 승인 상한")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "삭제" }));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("연결 사정을 못 받은 호출이어도 잠금 사유가 있으면 보기 화면 맨 위 경고 상자(I4)", () => {
    render(<RefundSheet data={data()} id={ID} userId="u" canWrite completionLock={COMPLETION_SUPERSEDED} />);
    expect(screen.getByRole("alert").textContent).toBe(COMPLETION_SUPERSEDED);
  });
});
