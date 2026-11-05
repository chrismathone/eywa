import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { tipText } from "@/components/hover-tip/tip";
import type { ListItem } from "@/features/withdrawal-reports/list-items";
import { ReportList } from "./report-list";

const item = (over: Partial<ListItem>): ListItem => ({
  key: "r:1", href: "/withdrawal-reports/1", name: "김학생", schoolGrade: "경명여중1", detail: "퇴원 · 수학", subjectText: "수학", kindText: "퇴원", kind: "withdrawal", classText: "", requestedAt: "2026-10-08T00:00:00Z", mine: "none", date: "2026-10-10", dateText: "2026-10-10", requestedText: "2026-10-08",
  teacher: "이성우", reason: { text: "이사", note: null }, subjects: ["math"], status: "pending", statusLabel: "관리자 승인 대기", statusChips: ["관리자 승인 대기"], tone: "muted",
  approval: [{ text: "관리자 ○ 관리자" }], link: null, myTurn: false, search: "",
  ...over,
});

describe("퇴원보고서 목록 표 — 웹 보고서와 기존 기록 한 표(원장 2026-10-14)", () => {
  afterEach(cleanup);
  it("기존 기록은 원문 화면으로 열리고 학생 연결 상태가 상태 칸에 선다", () => {
    render(
      <ReportList
        items={[
          item({ myTurn: true }),
          item({ key: "a:9", href: "/withdrawal-reports/archive/9", name: "박원생", status: "archive", statusLabel: "스프레드시트 기록", statusChips: ["스프레드시트 기록"], link: "unmapped", approval: [{ text: "원본 · 9월 퇴원", muted: true }] }),
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "박원생" })).toHaveAttribute("href", "/withdrawal-reports/archive/9");
    expect(screen.queryByText("학생 연결 필요")).not.toBeInTheDocument();
    expect(screen.getByText("원본 · 9월 퇴원")).toBeInTheDocument();
    expect(screen.getByText("내 작성 대기")).toBeInTheDocument();
  });
  it("퇴원 사유 칸 — 우리 사유, '기타'는 아래에 설명(전체는 메모 카드)", () => {
    render(
      <ReportList
        items={[
          item({ key: "r:1" }),
          item({ key: "a:2", name: "박원생", reason: { text: "기타", note: "학습태도 불량 / 금전적인 문제(집안사정)" } }),
        ]}
      />,
    );
    expect(screen.getByRole("columnheader", { name: "퇴원 사유" })).toBeInTheDocument();
    // 원장 2026-10-29 — 요청일 열(날짜 열 왼쪽) · 이름 옆 학교학년 / 2026-11-03 — 이름: '퇴원요청일' · '마지막 수업일'
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads.indexOf("퇴원요청일")).toBe(heads.indexOf("마지막 수업일") - 1);
    expect(heads).not.toContain("요청일");
    expect(heads).not.toContain("퇴원·종료일");
    expect(screen.getByText("이사")).toBeInTheDocument();
    expect(screen.getByText("기타")).toBeInTheDocument();
    const note = screen.getByText("학습태도 불량 / 금전적인 문제(집안사정)");
    expect(note).not.toHaveAttribute("title");
    expect(tipText(note.getAttribute("data-tip"))).toContain("학습태도 불량 / 금전적인 문제(집안사정)");
  });
  it("데스크 환불이 남으면 상태 칩 둘 · 데스크 차례는 '내 환불 처리 필요'(원장 2026-11-03)", () => {
    render(<ReportList items={[
      item({ statusLabel: "관리자 승인 요청 · 데스크 환불 요청", statusChips: ["관리자 승인 요청", "데스크 환불 요청"], approval: [{ text: "관리자 ○ 관리자" }, { text: "데스크 ○ 데스크A" }] }),
      item({ key: "r:2", name: "박학생", mine: "approve", deskTurn: true, statusLabel: "관리자 승인 완료 · 데스크 환불 요청", statusChips: ["관리자 승인 완료", "데스크 환불 요청"] }),
    ]} />);
    expect(screen.getByText("관리자 승인 요청")).toBeInTheDocument();
    expect(screen.getAllByText("데스크 환불 요청")).toHaveLength(1);
    expect(screen.getByText("데스크 ○ 데스크A")).toBeInTheDocument();
    expect(screen.getByText("내 환불 처리 필요")).toBeInTheDocument();
    expect(screen.getByText("관리자 승인 완료 · 데스크 환불 요청")).toBeInTheDocument();
  });
  it("없으면 빈 안내", () => {
    render(<ReportList items={[]} />);
    expect(screen.getByText("해당하는 퇴원보고서가 없습니다.")).toBeInTheDocument();
  });
});
