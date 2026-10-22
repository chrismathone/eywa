import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StudentFact } from "@/features/students/ontology/types";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../server/referral-actions", () => ({ searchReviewedReferrers: vi.fn(), linkReviewedReferral: vi.fn() }));
vi.mock("../server/actions", () => ({ changePositiveSignal: vi.fn() }));
import { FactsTable } from "./facts-table";
import { ReferralReview } from "./referral-review";
import { SignalControls } from "./signal-controls";
import { CorrectionDetails } from "./correction-details";
afterEach(cleanup);
const facts: StudentFact[] = Array.from({ length: 23 }, (_, i) => ({ id: `a:${i}`, studentId: "s", tenantId: "t", kind: i === 22 ? "exam" : "attendance",
  value: i === 22 ? { subject: "수학", score: 95, max: 100 } : { status: "present", slot: `${i + 1}교시` }, occurred: { precision: "day", value: "2026-10-01" },
  recordedAt: "2026-10-02", related: [], evidence: [{ source: "attendance_records", id: String(i), studentId: "s" }], basis: "recorded", access: "student", state: "active" }));
it("근거는 10건씩 표시하고 유형 변경 시 첫 페이지로 돌아간다", () => {
  render(<FactsTable facts={facts} />);
  expect(screen.getAllByRole("link", { name: "원본 보기" })).toHaveLength(10);
  expect(screen.queryByText("출석 · 11교시")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "학생 기록 다음 페이지" }));
  expect(screen.getByText("출석 · 11교시")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("기록 종류"), { target: { value: "exam" } });
  expect(screen.getByText("수학 · 95 / 100점")).toBeTruthy();
  expect((screen.getByRole("button", { name: "학생 기록 이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
});
it("소개 검토 15건 페이지, 상태 필터와 펼침을 적용하며 읽기 전용에 연결 입력을 숨긴다", () => {
  const rows = Array.from({ length: 17 }, (_, i) => ({ consultationId: `c${i}`, state: i === 16 ? "automatic" as const : "review" as const, candidates: [], candidateId: null, guards: [], reasons: [`확인 ${i}`], evidence: `근거 ${i}` }));
  render(<ReferralReview report={{ rows, counts: { automatic: 1, review: 16, unavailable: 0, linked: 0, total: 17 }, checkedAt: "2026-10-22", cutoff: "2026-10-22" }} students={[]} canWrite={false} />);
  expect(screen.getAllByRole("button", { name: "자세히 보기" })).toHaveLength(15);
  fireEvent.click(screen.getByRole("button", { name: "소개 확인 다음 페이지" }));
  expect(screen.getAllByRole("button", { name: "자세히 보기" })).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("소개 확인 상태"), { target: { value: "automatic" } });
  fireEvent.click(screen.getByRole("button", { name: "자세히 보기" }));
  expect(screen.getByText("근거 16")).toBeTruthy();
  expect(screen.getByRole("link", { name: "상담 원본 보기" }).getAttribute("href")).toBe("/enrollment/c16");
  expect(screen.queryByLabelText("소개 연결 확인 근거")).toBeNull();
});
it("긍정 신호는 8건씩 보이고 읽기 전용에는 판정 변경 입력이 없다", () => {
  const signals = Array.from({ length: 9 }, (_, i) => ({ id: `signal:${i}`, source: "parent" as const, source_id: `p${i}`, student_id: "s", source_hash: "hash",
    occurred_on: "2026-10-01", author_label: `학부모${i}`, classification: "observed" as const, evidence: `관찰 내용 ${i}`, model_label: "Claude", judged_at: "2026-10-02",
    cancelled_at: null, cancel_reason: null, rejudge_requested_at: null }));
  render(<SignalControls signals={signals} canWrite={false} />);
  expect(screen.queryByText("관찰 내용 8")).toBeNull();
  expect(screen.queryByRole("button", { name: "판정 검토" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "긍정 신호 다음 페이지" }));
  expect(screen.getByText("관찰 내용 8")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("긍정 신호 상태"), { target: { value: "cancelled" } });
  expect((screen.getByRole("button", { name: "긍정 신호 이전 페이지" }) as HTMLButtonElement).disabled).toBe(true);
});
it("정정 페이지는 같은 원래 달의 변경과 이미 반영한 차감을 나누지 않는다", () => {
  const entries = Array.from({ length: 7 }, (_, i) => ({ month: `2026-0${i + 1}`, metric: "subjectMonths" as const, before: 1, after: 2, delta: 1, evidenceIds: ["source:1"], kind: "source" as const }));
  render(<CorrectionDetails studentId="s" entries={[...entries, { ...entries[0]!, before: 1, after: 0, delta: -1, kind: "alreadyApplied" }]} />);
  expect(screen.getAllByRole("link")).toHaveLength(6);
  expect(screen.queryByRole("link", { name: "2026년 1월 원래 달 내역" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "정정 월 다음 페이지" }));
  expect(screen.getByRole("link", { name: "2026년 1월 원래 달 내역" }).getAttribute("href")).toBe("/student-contribution/s?month=2026-01");
  expect(screen.getByText("마감 시 1과목·개월 → 최근 확인 2과목·개월")).toBeTruthy();
  expect(screen.getByText("중복 반영을 막기 위해 이전 정정 1과목·개월 차감")).toBeTruthy();
});
