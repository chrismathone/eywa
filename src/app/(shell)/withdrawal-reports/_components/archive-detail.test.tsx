import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ArchiveDetail } from "@/features/withdrawal-reports/archive-model";
import { EmbedProvider } from "@/components/workspace/embed-context";
import { ArchiveDetailView } from "./archive-detail";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/withdrawal-reports/server/archive-actions", () => ({ mapArchive: vi.fn() }));

const archive: ArchiveDetail = {
  id: "archive-1", spreadsheet_id: "source-sheet", sheet_id: 123, sheet_title: "26.10 퇴원", source_range: "C25:P47",
  student_name: "김학생", school_grade: "테스트중2", class_name: "수학반", subject: "math", exit_date: "2026-10-13",
  raw_exit_date: "26년 10월 13일", teacher_name: "서명담임", mapped_student_id: null, mapping_kind: "unmapped", revision: 1,
  fields: {
    성명: "김학생", 학년: "테스트중2", 반명: "수학반", 퇴원일: "26년 10월 13일", 수강기간: "1년",
    담임명: "", 출결현황: "결석 없음", 퇴원사유: "원문 사유 / 기타", 상세사유: "첫 줄\n둘째 줄",
    상담결과: "상담 공통 메모", 학생상담: "학생의 원문", 학부모상담: "학부모의 원문", 담임의견: "담임의 원문",
    원비: "10월 납부", 미납여부: "x", 퇴원처리: "원본 처리 메모", 교무처진행담당자: "진행 담당자",
    추가메모: "다른 양식에만 있는 내용",
  },
  signatures: [{ role: "담임", date: "작성일 : 10/13", name: "서명담임" }, { role: "팀장", date: "결재일 :", name: "" }, { role: "원장", date: "", name: "" }],
  raw_grid: [["퇴원 처리서", ""], ["과목", ""], ["수학 원문", ""]],
};

afterEach(cleanup);

describe("기존 퇴원보고서 원본 양식", () => {
  it("keeps source wording, dates, line breaks and additional fields without filling blank fields or signatures", () => {
    render(<ArchiveDetailView archive={archive} students={[]} />);
    const body = screen.getByRole("table", { name: "퇴원 보고 내용" });
    for (const value of Object.values(archive.fields).filter(Boolean)) {
      expect(body.textContent).toContain(value);
    }
    const teacherRow = within(body).getByRole("rowheader", { name: "담임명" }).closest("tr")!;
    expect(within(teacherRow).getAllByRole("cell")[0]).toBeEmptyDOMElement();
    const approval = screen.getByRole("table", { name: "원본 결재란" });
    expect(approval).toHaveTextContent("수학 원문");
    expect(approval).toHaveTextContent("작성일 : 10/13");
    const signatures = within(approval).getAllByRole("row")[2];
    expect(within(signatures).getAllByRole("cell").map(cell => cell.textContent)).toEqual(["서명담임", "", ""]);
    expect(approval).not.toHaveTextContent("승인 완료");
  });

  it("opens the populated form within the app and retains expandable student linking", () => {
    render(<EmbedProvider embed><ArchiveDetailView archive={archive} students={[]} /></EmbedProvider>);
    expect(screen.getByRole("heading", { name: "퇴원 처리서" })).toBeVisible();
    expect(screen.getByRole("table", { name: "퇴원 보고 내용" })).toHaveTextContent("김학생");
    expect(screen.getAllByRole("link").every(link => link.getAttribute("href")?.startsWith("/withdrawal-reports"))).toBe(true);
    expect(screen.queryByText("원본 셀 전체 보기")).not.toBeInTheDocument();
    expect(screen.queryByText(/C25:P47/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← 퇴원보고서 목록" })).toHaveAttribute("href", "/withdrawal-reports?embed=1");
    const summary = screen.getByText("학생 연결 관리 · 학생 연결 필요");
    expect(summary.closest("details")).not.toHaveAttribute("open");
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByRole("button", { name: "학생 연결 저장" })).toBeDisabled();
  });
});
