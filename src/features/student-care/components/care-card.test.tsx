import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StudentCareCard } from "./care-card";
import { buildCareCard } from "../build";
import { careFixture } from "../fixtures";
import { EmbedProvider } from "@/components/workspace/embed-context";
afterEach(cleanup);

describe("관리 요약 화면", () => {
  it("학생 창에서 근거 탭을 열 때 창 표시를 유지한다", () => {
    const card = buildCareCard(careFixture());
    render(<EmbedProvider embed><StudentCareCard card={card} /></EmbedProvider>);
    expect(screen.getByRole("link", { name: "숙제 수행 근거 보기" }))
      .toHaveAttribute("href", `/students/${card.studentId}?tab=progress&embed=1`);
  });
  it("일곱 영역과 실제 후속 상담으로 연결한다", () => {
    const card = buildCareCard(careFixture());
    render(<StudentCareCard card={card} action={<button>지원 상담 기록</button>} />);
    expect(screen.getByRole("heading", { name: "집중 관리" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /근거 보기/ })).toHaveLength(7);
    expect(screen.getByRole("link", { name: "처리·결과 확인" })).toHaveAttribute("href", `/consultations/${card.followups[0]!.id}`);
    expect(screen.getByText(/직접 만족도 점수 미수집/)).toBeInTheDocument();
    expect(screen.getByText(/시험 난도 미보정/)).toBeInTheDocument();
  });
  it("권한 없는 금액·근거 링크·작성 버튼을 노출하지 않는다", () => {
    const raw = careFixture(); raw.invoices = { state: "restricted", rows: [] }; raw.canWriteConsultation = false;
    render(<StudentCareCard card={buildCareCard(raw)} action={<button>지원 상담 기록</button>} />);
    expect(screen.queryByText(/300,000/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "누적 수강료 근거 보기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "지원 상담 기록" })).not.toBeInTheDocument();
  });
  it("상담 조회 실패를 미완료 없음으로 숨기지 않는다", () => {
    const raw = careFixture(); raw.consultations = { state: "failed", rows: [] };
    render(<StudentCareCard card={buildCareCard(raw)} />);
    expect(screen.getByText("후속 상담 기록을 불러오지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/예정된 미완료 후속조치가 없습니다/)).not.toBeInTheDocument();
  });
});
