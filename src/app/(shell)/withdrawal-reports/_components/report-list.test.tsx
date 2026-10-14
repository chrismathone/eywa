import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ListItem } from "@/features/withdrawal-reports/list-items";
import { ReportList } from "./report-list";

const item = (over: Partial<ListItem>): ListItem => ({
  key: "r:1", href: "/withdrawal-reports/1", name: "김학생", detail: "전체 퇴원 · 수학", date: "2026-10-10", dateText: "2026-10-10",
  teacher: "이성우", subjects: ["math"], status: "pending", statusLabel: "관리자 승인 대기", tone: "muted",
  approval: [{ text: "관리자 ○ 관리자" }, { text: "관리자가 최종 승인", muted: true }], link: null, myTurn: false, search: "",
  ...over,
});

describe("퇴원보고서 목록 표 — 웹 보고서와 기존 기록 한 표(원장 2026-10-14)", () => {
  afterEach(cleanup);
  it("기존 기록은 원문 화면으로 열리고 학생 연결 상태가 상태 칸에 선다", () => {
    render(
      <ReportList
        items={[
          item({ myTurn: true }),
          item({ key: "a:9", href: "/withdrawal-reports/archive/9", name: "박원생", status: "archive", statusLabel: "스프레드시트 기록", link: "unmapped", approval: [{ text: "원본 · 9월 퇴원", muted: true }] }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "박원생" })).toHaveAttribute("href", "/withdrawal-reports/archive/9");
    expect(screen.getByText("학생 연결 필요")).toBeInTheDocument();
    expect(screen.getByText("원본 · 9월 퇴원")).toBeInTheDocument();
    expect(screen.getByText("내 작성 대기")).toBeInTheDocument();
  });
  it("없으면 빈 안내", () => {
    render(<ReportList items={[]} />);
    expect(screen.getByText("해당하는 퇴원보고서가 없습니다.")).toBeInTheDocument();
  });
});
