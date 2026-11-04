import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { StudentDetail, StudentMemoRow, StudentConsultationRow } from "@/features/students/server/queries";
import type { UnifiedRow } from "@/features/grades/unified/model";

const invoiceQuery = vi.hoisted(() => vi.fn(async () => []));
const { memoQuery, consultationQuery, gradeQuery } = vi.hoisted(() => ({
  memoQuery: vi.fn(async (): Promise<StudentMemoRow[]> => []),
  consultationQuery: vi.fn(async (): Promise<StudentConsultationRow[]> => []),
  gradeQuery: vi.fn(async (): Promise<UnifiedRow[]> => []),
}));
vi.mock("@/features/students/server/queries", () => ({
  getStudentAttendanceStats: async () => ({ total: 0, present: 0, absent: 0, late: 0, rate: 0 }),
  getStudentEnrollments: async () => [], getStudentInvoices: invoiceQuery,
  getStudentConsultationHistory: consultationQuery, getStudentMemos: memoQuery,
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => DEFAULT_SETTINGS }));
vi.mock("@/features/teacher-view/server/lang", () => ({ getTeacherViewLang: async () => "ko" }));
vi.mock("@/features/teacher-view/server/teacher-names", () => ({ getTeacherEnglishNames: async () => ({}) }));
vi.mock("@/features/grades/unified/server/student-records", () => ({ getStudentUnifiedRows: gradeQuery }));
vi.mock("@/features/students/server/siblings", () => ({ getStudentSiblings: async () => ({ ready: false, siblings: [], review: [], autoIds: [] }) }));
vi.mock("../_components/tab-link", () => ({ TabLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
import { OverviewTab } from "./overview-tab";
const student = { id: "student", aiCareSummary: null, createdAt: "2026-10-03T00:00:00Z" } as StudentDetail;
beforeEach(() => {
  invoiceQuery.mockClear();
  memoQuery.mockReset().mockResolvedValue([]);
  consultationQuery.mockReset().mockResolvedValue([]);
  gradeQuery.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe("학생 개요 수납 권한", () => {
  it("권한이 없으면 조회·카드·죽은 링크 모두 생략한다", async () => {
    render(await OverviewTab({ student, canSeeBilling: false }));
    expect(invoiceQuery).not.toHaveBeenCalled();
    expect(screen.queryByText("수납 현황")).toBeNull();
    expect(screen.queryByText("청구 내역 없음")).toBeNull();
    expect(document.querySelector('a[href$="tab=billing"]')).toBeNull();
  });
  it("조회 권한이 있으면 기존 수납 카드와 링크를 유지한다", async () => {
    render(await OverviewTab({ student, canSeeBilling: true }));
    expect(invoiceQuery).toHaveBeenCalledExactlyOnceWith("student");
    expect(screen.getByText("수납 현황")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "수납" })).toHaveAttribute("href", "/students/student?tab=billing");
  });
});

const memo = (overrides: Partial<StudentMemoRow>): StudentMemoRow => ({
  id: "memo", category: "general", content: "수업 중 특이사항", pinned: false,
  searchable: true, createdAt: "2026-10-21T15:30:00Z", createdBy: "author", createdByName: "김선생",
  ...overrides,
});

describe("학생 개요 기록 정보", () => {
  it("최근 특이사항은 작성일·작성자를 표시하고 학생 수정용 정보와 별도로 보여준다", async () => {
    memoQuery.mockResolvedValue([memo({})]);
    render(await OverviewTab({ student: { ...student, notes: "문자 발행 시 참고" }, canSeeBilling: false }));

    expect(screen.getByText("최근 특이사항")).toBeInTheDocument();
    expect(screen.getByText(/김선생/)).toBeInTheDocument();
    // UTC 밤에 작성해도 한국 날짜·시각으로 표시한다.
    expect(screen.getByText("26.10.22 00:30")).toHaveAttribute("datetime", "2026-10-21T15:30:00Z");
    expect(screen.getByText("수업 중 특이사항")).toBeInTheDocument();
    expect(screen.queryByText("문자 발행 시 참고")).toBeNull();
    expect(screen.getByRole("link", { name: "특이사항" })).toHaveAttribute("href", "/students/student?tab=memos");
  });

  it("오래된 고정 기록에 가려지지 않게 최근 작성한 세 건을 보여준다", async () => {
    memoQuery.mockResolvedValue([
      memo({ id: "pinned", pinned: true, createdAt: "2026-01-01T00:00:00Z", content: "예전 고정 기록" }),
      memo({ id: "newest", createdAt: "2026-10-22T03:00:00Z", content: "가장 최근 기록" }),
      memo({ id: "second", createdAt: "2026-10-21T03:00:00Z", content: "두 번째 기록" }),
      memo({ id: "third", createdAt: "2026-10-20T03:00:00Z", content: "세 번째 기록" }),
    ]);
    render(await OverviewTab({ student, canSeeBilling: false }));
    expect(screen.getAllByRole("article").map((item) => item.querySelector("p")?.textContent)).toEqual([
      "가장 최근 기록", "두 번째 기록", "세 번째 기록",
    ]);
    expect(screen.queryByText("예전 고정 기록")).toBeNull();
  });

  it("작성자가 없는 기록은 정보 없음으로 안내하고 보호자 이름 없이도 관계·부분 주소를 표시한다", async () => {
    memoQuery.mockResolvedValue([memo({ createdByName: null })]);
    render(await OverviewTab({
      student: { ...student, parentName: null, parentRelation: "모", address: null, addressDetail: "상세 주소만 입력됨", zipCode: "12345" },
      canSeeBilling: false,
    }));
    expect(screen.getByText(/정보 없음/)).toBeInTheDocument();
    expect(screen.getByText("보호자 관계")).toBeInTheDocument();
    expect(screen.getByText("모")).toBeInTheDocument();
    expect(screen.getByText("(12345) 상세 주소만 입력됨")).toBeInTheDocument();
  });

  it("보호자2(s2_0022)는 적어 둔 칸만 프로필에 보인다 — 없으면 줄 자체가 없다", async () => {
    render(await OverviewTab({
      student: { ...student, parentName: "김아버지", parentPhone: "010-1111-2222", parent2Name: "김어머니", parent2Relation: "모", parent2Phone: "010-3333-4444" },
      canSeeBilling: false,
    }));
    expect(screen.getByText("보호자2 이름")).toBeInTheDocument();
    expect(screen.getByText("김어머니")).toBeInTheDocument();
    expect(screen.getByText("보호자2 관계")).toBeInTheDocument();
    expect(screen.getByText("010-3333-4444")).toBeInTheDocument();
    cleanup();
    render(await OverviewTab({ student: { ...student, parentName: "김아버지", parent2Phone: "010-3333-4444" }, canSeeBilling: false }));
    expect(screen.queryByText("보호자2 이름")).toBeNull();
    expect(screen.queryByText("보호자2 관계")).toBeNull();
    expect(screen.getByText("보호자2 연락처")).toBeInTheDocument();
  });

  it("상담자와 상담일, 성적의 시험일·반·만점 없는 점수·시험없음을 빠짐없이 표시한다", async () => {
    consultationQuery.mockResolvedValue([{
      id: "consultation", consultedAt: "2026-10-20", category: "general", subject: "math", audience: "parent",
      summary: "학습 상담 내용", followUpAction: null, followUpDate: null, followUpDone: false, counselorName: "이상담",
    }]);
    const grade: UnifiedRow = {
      key: "grade", source: "grade", sourceId: "grade", studentId: "student", name: "학생", school: null, grade: null,
      subject: "math", kind: "school", date: "2026-10-19", score: 87, maxScore: null, rawScore: null,
      classes: [{ id: "class", name: "수학 심화반", teacher: null, days: 2 }],
      consultationDate: null, manualConsultationDate: null, editHref: "/grades", previousScore: null,
      previousMaxScore: null, delta: null, deltaUnit: "점",
    };
    gradeQuery.mockResolvedValue([grade, { ...grade, key: "no-exam", date: "2026-10-18", noExam: true, score: null }]);
    render(await OverviewTab({ student, canSeeBilling: false }));
    expect(screen.getByText(/이상담/)).toBeInTheDocument();
    expect(screen.getByText("2026-10-20")).toHaveAttribute("datetime", "2026-10-20");
    expect(screen.getByText("2026-10-19 · 수학 심화반")).toBeInTheDocument();
    expect(screen.getByText("87점")).toBeInTheDocument();
    expect(screen.getByText("시험없음")).toBeInTheDocument();
  });
});
